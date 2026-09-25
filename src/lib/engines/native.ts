/**
 * Native Web Speech API transcription engine — the default ReVoice engine.
 *
 * Wraps `webkitSpeechRecognition` (Chrome, Edge, Safari 14.1+) for low-latency,
 * continuous transcription with interim results. Speech recognition is performed by
 * the browser's speech service (which may be remote), not by ReVoice.
 *
 * Things worth knowing before changing this file:
 *
 * - The Web Speech API opens its own microphone capture, so the `MediaStream` passed to
 *   `start()` is accepted for interface compatibility but never touched. In particular
 *   `stop()` must NOT stop the stream's tracks: the recorder owns that stream and keeps
 *   using it across pause/resume.
 * - `SpeechRecognition.stop()` is asynchronous; the session only ends when `onend`
 *   fires. `stop()` therefore returns a promise that resolves on `onend`, and `start()`
 *   waits for any pending stop. Otherwise a fast pause then resume would call `start()`
 *   on a recognizer that is still shutting down, and the late `onend` would mark a live
 *   session as idle.
 * - Browsers end recognition on their own (silence timeouts, Android). If that happens
 *   while the engine is meant to be running we transparently restart it. Restarts are
 *   bounded: sessions that end within `MIN_HEALTHY_SESSION_MS` without a result count as
 *   "rapid empty"; they are retried with backoff and, after `MAX_RAPID_EMPTY_SESSIONS`
 *   in a row, the engine gives up with an error instead of spinning on "connecting"
 *   forever. This is what happens on Android when the recognizer cannot get audio while
 *   the page's own recorder holds the microphone.
 * - A start watchdog aborts a recognizer that never reports `onstart`.
 * - Each recognition session numbers its results from 0 again, so the de-duplication
 *   index is reset whenever a session (re)starts.
 * - Safari requires `start()` to run inside a user-gesture handler.
 * - Every lifecycle event is logged through `diag()` (see diagnostics.svelte.ts).
 *
 * @example
 * const engine = new NativeEngine();
 * engine.onResult((r) => console.log(r.text, r.isFinal));
 * engine.onError((e) => console.error(e.message));
 * await engine.start(stream, { language: 'en-US' });
 * // ...
 * await engine.stop();
 */

import { diag } from '../diagnostics.svelte';
import { TranscriptionEngine } from './base';
import {
	getSpeechRecognitionConstructor,
	type SpeechRecognitionErrorEventLike,
	type SpeechRecognitionEventLike,
	type SpeechRecognitionLike,
} from './speech-recognition';
import type { EngineConfig, EngineMetadata } from '../types';

/** How long `stop()` waits for `onend` before forcing the engine to idle. */
const STOP_TIMEOUT_MS = 1500;

/**
 * How long `start()` may take to report `onstart`. Generous because a speech-permission
 * prompt (when the page has not opened the microphone itself) blocks it.
 */
const START_TIMEOUT_MS = 15000;

/**
 * A session that lasts at least this long, or yields a result, is "healthy". Chrome ends a
 * genuinely silent session after several seconds, so legitimate quiet is not penalised;
 * only rapid-fire empty sessions (start, end, start, end...) are.
 */
const MIN_HEALTHY_SESSION_MS = 3000;

/** Consecutive rapid empty sessions tolerated before giving up. */
const MAX_RAPID_EMPTY_SESSIONS = 4;

/** Delay before restart number N of consecutive rapid empty sessions (last value repeats). */
const RESTART_BACKOFF_MS = [250, 500, 1000];

/**
 * Errors that will not fix themselves on retry. Auto-reconnecting after these would spin
 * forever (and, for permission errors, re-prompt), so they end the session instead.
 */
const FATAL_ERRORS = new Set([
	'not-allowed',
	'service-not-allowed',
	'audio-capture',
	'network',
	'language-not-supported',
	'bad-grammar',
]);

/** Errors that are routine during normal use and are not worth surfacing to the user. */
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

export class NativeEngine extends TranscriptionEngine {
	private recognition: SpeechRecognitionLike;

	/** Index after the last final result of the current recognition session (dedupe guard). */
	private lastResultIndex = 0;

	/** True from `stop()` until the recognizer's `onend`; tells our stop apart from a natural end. */
	private isStopping = false;

	/** True while auto-restarting after a natural end; we stay `connecting` until audio is confirmed. */
	private isReconnecting = false;

	/** Set by a fatal `onerror` so the following `onend` goes idle instead of reconnecting. */
	private fatalErrorSeen = false;

	private stopPromise: Promise<void> | null = null;
	private resolveStop: (() => void) | null = null;
	private stopTimer: ReturnType<typeof setTimeout> | null = null;

	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private startWatchdog: ReturnType<typeof setTimeout> | null = null;

	/** Number of recognition sessions begun, for correlating log lines. */
	private sessionNumber = 0;
	private sessionStartedAt = 0;
	private sawAudio = false;
	private sawSound = false;
	private sawResult = false;

	/** Consecutive sessions that ended quickly without a result. */
	private rapidEmptySessions = 0;

	/**
	 * @throws Error if the Web Speech API is not available in this browser.
	 */
	constructor() {
		super();
		const Recognition = getSpeechRecognitionConstructor();
		if (!Recognition) {
			throw new Error('Web Speech API not supported in this browser');
		}

		this.recognition = new Recognition();
		this.recognition.continuous = true;
		this.recognition.interimResults = true;
		this.recognition.lang = 'en-US';

		this.recognition.onstart = () => this.handleStart();
		this.recognition.onresult = (event) => this.handleResult(event);
		this.recognition.onerror = (event) => this.handleError(event);
		this.recognition.onend = () => this.handleEnd();

		// Audio lifecycle: purely diagnostic, except `soundstart` which confirms audio flows.
		this.recognition.onaudiostart = () => {
			this.sawAudio = true;
			diag('speech', 'audiostart', { session: this.sessionNumber });
		};
		this.recognition.onaudioend = () => diag('speech', 'audioend', { session: this.sessionNumber });
		this.recognition.onsoundstart = () => {
			this.sawSound = true;
			diag('speech', 'soundstart', { session: this.sessionNumber });
			this.confirmAudioFlowing();
		};
		this.recognition.onsoundend = () => diag('speech', 'soundend', { session: this.sessionNumber });
		this.recognition.onspeechstart = () =>
			diag('speech', 'speechstart', { session: this.sessionNumber });
		this.recognition.onspeechend = () =>
			diag('speech', 'speechend', { session: this.sessionNumber });
		this.recognition.onnomatch = () => diag('speech', 'nomatch', { session: this.sessionNumber });
	}

	/**
	 * Begin listening.
	 *
	 * Waits for any in-flight `stop()` first. The engine reports `connecting` until the
	 * browser confirms it is listening (`onstart`), which can take a moment while the
	 * microphone permission prompt is shown.
	 *
	 * @param _stream - Unused; see the file header.
	 * @param config - Optional language / continuous / interim overrides.
	 * @throws Error if the engine is already running, or the recognizer refuses to start.
	 */
	async start(_stream: MediaStream, config?: EngineConfig): Promise<void> {
		if (this.stopPromise) await this.stopPromise;

		if (this.state !== 'idle') {
			throw new Error('Engine is already running');
		}

		if (config?.language) this.recognition.lang = config.language;
		if (config?.continuous !== undefined) this.recognition.continuous = config.continuous;
		if (config?.interimResults !== undefined) {
			this.recognition.interimResults = config.interimResults;
		}

		this.fatalErrorSeen = false;
		this.isReconnecting = false;
		this.lastResultIndex = 0;
		this.rapidEmptySessions = 0;
		this.setState('connecting');

		try {
			this.beginSession('start');
		} catch (error) {
			// Chrome throws InvalidStateError if a session is somehow still open. That
			// session is live, so keep waiting for its onstart rather than failing.
			if (error instanceof Error && error.message.includes('already started')) {
				console.warn('[NativeEngine] recognition already started; reusing running session');
				diag('speech', 'already-started');
				return;
			}
			diag('speech', 'start-threw', error);
			this.setState('idle');
			throw error;
		}
	}

	/**
	 * Stop listening and resolve once the recognizer has actually ended.
	 *
	 * Final results that the browser flushes while stopping are still delivered before
	 * this resolves. Safe to call when idle or repeatedly. Does not touch the audio stream.
	 */
	stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		if (this.state === 'idle') return Promise.resolve();

		diag('speech', 'stop()', { state: this.state });
		// A pending restart means the recognizer is not running, so no `onend` will come.
		const recognizerIdle = this.restartTimer !== null;
		this.clearRestartTimer();
		this.clearStartWatchdog();

		this.isStopping = true;
		const stopped = new Promise<void>((resolve) => {
			this.resolveStop = resolve;
			// If onend never arrives (recognizer already dead), don't hang the caller.
			this.stopTimer = setTimeout(() => {
				diag('speech', 'stop-timeout');
				this.completeStop();
			}, STOP_TIMEOUT_MS);
		});
		this.stopPromise = stopped;

		if (recognizerIdle) {
			this.completeStop();
			return stopped;
		}

		try {
			this.recognition.stop();
		} catch (error) {
			console.warn('[NativeEngine] recognition.stop() threw:', error);
			this.completeStop();
		}

		return stopped;
	}

	getMetadata(): EngineMetadata {
		return {
			name: 'Web Speech API',
			version: '1.0.0',
			type: 'native',
			// Representative subset; actual support depends on the browser and OS.
			supportedLanguages: [
				'en-US',
				'en-GB',
				'es-ES',
				'fr-FR',
				'de-DE',
				'it-IT',
				'ja-JP',
				'zh-CN',
				'pt-BR',
			],
		};
	}

	/**
	 * Call `recognition.start()` and arm the watchdog. Throws whatever `start()` throws.
	 * Per-session bookkeeping is reset here so `handleEnd` can judge the session.
	 */
	private beginSession(reason: 'start' | 'restart'): void {
		this.sessionNumber++;
		this.sessionStartedAt = performance.now();
		this.sawAudio = false;
		this.sawSound = false;
		this.sawResult = false;

		diag('speech', 'recognition.start()', {
			session: this.sessionNumber,
			reason,
			lang: this.recognition.lang,
			continuous: this.recognition.continuous,
			rapidEmptySessions: this.rapidEmptySessions,
		});
		this.recognition.start();
		this.armStartWatchdog();
	}

	/** Abort a recognizer that never reports `onstart` instead of spinning on "connecting". */
	private armStartWatchdog(): void {
		this.clearStartWatchdog();
		this.startWatchdog = setTimeout(() => {
			this.startWatchdog = null;
			if (this.state === 'idle' || this.isStopping) return;
			diag('speech', 'start-timeout', { session: this.sessionNumber });
			this.isReconnecting = false;
			this.setState('idle');
			try {
				this.recognition.abort();
			} catch (error) {
				console.warn('[NativeEngine] recognition.abort() threw:', error);
			}
			this.emitError(
				new Error('Speech recognition did not start. Check your connection and retry.')
			);
		}, START_TIMEOUT_MS);
	}

	private clearStartWatchdog(): void {
		if (this.startWatchdog) clearTimeout(this.startWatchdog);
		this.startWatchdog = null;
	}

	private clearRestartTimer(): void {
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.restartTimer = null;
	}

	/** Finish an explicit stop: clear bookkeeping, go idle, release the waiting caller. */
	private completeStop(): void {
		if (this.stopTimer) clearTimeout(this.stopTimer);
		this.stopTimer = null;
		this.clearRestartTimer();
		this.clearStartWatchdog();
		this.isStopping = false;
		this.isReconnecting = false;
		this.setState('idle');

		const resolve = this.resolveStop;
		this.resolveStop = null;
		this.stopPromise = null;
		resolve?.();
	}

	/** After an auto-restart, audio (a result or a heard sound) proves we are really listening. */
	private confirmAudioFlowing(): void {
		if (this.isReconnecting) {
			this.isReconnecting = false;
			this.setState('listening');
		}
	}

	private handleStart(): void {
		this.clearStartWatchdog();
		this.lastResultIndex = 0;
		diag('speech', 'onstart', {
			session: this.sessionNumber,
			latencyMs: Math.round(performance.now() - this.sessionStartedAt),
		});
		// After an auto-restart we stay `connecting` until audio confirms it is flowing.
		if (!this.isReconnecting && !this.isStopping) {
			this.setState('listening');
		}
	}

	/**
	 * Route recognizer results to subscribers.
	 *
	 * `event.results` is cumulative for the session and `event.resultIndex` marks the first
	 * entry that changed. Interim entries are re-emitted as they update; a final entry is
	 * emitted once and then `lastResultIndex` moves past it, so a repeated event for the
	 * same final (seen on some Android builds) cannot duplicate it.
	 */
	private handleResult(event: SpeechRecognitionEventLike): void {
		this.sawResult = true;
		this.rapidEmptySessions = 0;
		this.confirmAudioFlowing();

		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			const { transcript, confidence } = result[0];

			diag('speech', 'onresult', {
				session: this.sessionNumber,
				index: i,
				isFinal: result.isFinal,
				chars: transcript.length,
			});
			if (i >= this.lastResultIndex || !result.isFinal) {
				this.emitResult({ text: transcript, isFinal: result.isFinal, confidence, resultIndex: i });
			}
			if (result.isFinal) {
				this.lastResultIndex = i + 1;
			}
		}
	}

	private handleError(event: SpeechRecognitionErrorEventLike): void {
		diag('speech', 'onerror', {
			session: this.sessionNumber,
			error: event.error,
			message: event.message,
		});
		if (BENIGN_ERRORS.has(event.error)) {
			console.debug('[NativeEngine] benign recognition error:', event.error);
			return;
		}
		console.error('[NativeEngine] recognition error:', event.error);
		if (FATAL_ERRORS.has(event.error)) {
			this.fatalErrorSeen = true;
		}
		this.emitError(new Error(`Speech recognition error: ${event.error}`));
	}

	/**
	 * Recognizer ended. Four cases: we asked for it (finish the stop), a fatal error
	 * occurred (go idle, do not retry), the browser ended it repeatedly without hearing
	 * anything (give up), or it ended on its own once (restart).
	 */
	private handleEnd(): void {
		const durationMs = Math.round(performance.now() - this.sessionStartedAt);
		diag('speech', 'onend', {
			session: this.sessionNumber,
			durationMs,
			sawAudio: this.sawAudio,
			sawSound: this.sawSound,
			sawResult: this.sawResult,
			stopping: this.isStopping,
			fatal: this.fatalErrorSeen,
		});
		this.clearStartWatchdog();

		if (this.isStopping) {
			this.completeStop();
			return;
		}
		if (this.fatalErrorSeen) {
			this.fatalErrorSeen = false;
			this.isReconnecting = false;
			this.setState('idle');
			return;
		}
		if (this.state === 'idle') return;

		const healthy = this.sawResult || durationMs >= MIN_HEALTHY_SESSION_MS;
		this.rapidEmptySessions = healthy ? 0 : this.rapidEmptySessions + 1;

		if (this.rapidEmptySessions >= MAX_RAPID_EMPTY_SESSIONS) {
			diag('speech', 'gave-up', {
				rapidEmptySessions: this.rapidEmptySessions,
				sawAudio: this.sawAudio,
				sawSound: this.sawSound,
			});
			this.isReconnecting = false;
			this.setState('idle');
			this.emitError(
				new Error(
					'Speech recognition keeps ending without hearing anything. On some phones the ' +
						'microphone cannot be shared with the recorder; audio is still being saved.'
				)
			);
			return;
		}

		console.log('[NativeEngine] recognition ended on its own, reconnecting');
		this.isReconnecting = true;
		this.lastResultIndex = 0;
		this.setState('connecting');

		// Restart at once after a healthy session; back off only while sessions keep failing fast.
		const delay =
			this.rapidEmptySessions === 0
				? 0
				: RESTART_BACKOFF_MS[Math.min(this.rapidEmptySessions, RESTART_BACKOFF_MS.length) - 1];
		if (delay === 0) {
			this.restartNow();
		} else {
			diag('speech', 'restart-scheduled', { delayMs: delay });
			this.restartTimer = setTimeout(() => {
				this.restartTimer = null;
				this.restartNow();
			}, delay);
		}
	}

	private restartNow(): void {
		if (this.state === 'idle' || this.isStopping) return;
		try {
			this.beginSession('restart');
		} catch (error) {
			console.error('[NativeEngine] failed to restart recognition:', error);
			diag('speech', 'restart-threw', error);
			this.isReconnecting = false;
			this.setState('idle');
			const reason = error instanceof Error ? error.message : String(error);
			this.emitError(new Error(`Failed to restart recognition: ${reason}`));
		}
	}
}
