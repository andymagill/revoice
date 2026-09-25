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
 *   while the engine is meant to be running we transparently restart it.
 * - Each recognition session numbers its results from 0 again, so the de-duplication
 *   index is reset whenever a session (re)starts.
 * - Safari requires `start()` to run inside a user-gesture handler.
 *
 * @example
 * const engine = new NativeEngine();
 * engine.onResult((r) => console.log(r.text, r.isFinal));
 * engine.onError((e) => console.error(e.message));
 * await engine.start(stream, { language: 'en-US' });
 * // ...
 * await engine.stop();
 */

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
 * Errors that will not fix themselves on retry. Auto-reconnecting after these would spin
 * forever (and, for permission errors, re-prompt), so they end the session instead.
 */
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'network']);

/** Errors that are routine during normal use and are not worth surfacing to the user. */
const BENIGN_ERRORS = new Set(['no-speech', 'aborted']);

export class NativeEngine extends TranscriptionEngine {
	private recognition: SpeechRecognitionLike;

	/** Index after the last final result of the current recognition session (dedupe guard). */
	private lastResultIndex = 0;

	/** True from `stop()` until the recognizer's `onend`; tells our stop apart from a natural end. */
	private isStopping = false;

	/** True while auto-restarting after a natural end; we stay `connecting` until a result arrives. */
	private isReconnecting = false;

	/** Set by a fatal `onerror` so the following `onend` goes idle instead of reconnecting. */
	private fatalErrorSeen = false;

	private stopPromise: Promise<void> | null = null;
	private resolveStop: (() => void) | null = null;
	private stopTimer: ReturnType<typeof setTimeout> | null = null;

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
		this.setState('connecting');

		try {
			this.recognition.start();
		} catch (error) {
			// Chrome throws InvalidStateError if a session is somehow still open. That
			// session is live, so keep waiting for its onstart rather than failing.
			if (error instanceof Error && error.message.includes('already started')) {
				console.warn('[NativeEngine] recognition already started; reusing running session');
				return;
			}
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

		this.isStopping = true;
		const stopped = new Promise<void>((resolve) => {
			this.resolveStop = resolve;
			// If onend never arrives (recognizer already dead), don't hang the caller.
			this.stopTimer = setTimeout(() => this.completeStop(), STOP_TIMEOUT_MS);
		});
		this.stopPromise = stopped;

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

	/** Finish an explicit stop: clear bookkeeping, go idle, release the waiting caller. */
	private completeStop(): void {
		if (this.stopTimer) clearTimeout(this.stopTimer);
		this.stopTimer = null;
		this.isStopping = false;
		this.isReconnecting = false;
		this.setState('idle');

		const resolve = this.resolveStop;
		this.resolveStop = null;
		this.stopPromise = null;
		resolve?.();
	}

	private handleStart(): void {
		this.lastResultIndex = 0;
		// After an auto-restart we stay `connecting` until real results confirm audio flows.
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
		if (this.isReconnecting) {
			this.isReconnecting = false;
			this.setState('listening');
		}

		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			const { transcript, confidence } = result[0];

			if (i >= this.lastResultIndex || !result.isFinal) {
				this.emitResult({ text: transcript, isFinal: result.isFinal, confidence, resultIndex: i });
			}
			if (result.isFinal) {
				this.lastResultIndex = i + 1;
			}
		}
	}

	private handleError(event: SpeechRecognitionErrorEventLike): void {
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
	 * Recognizer ended. Three cases: we asked for it (finish the stop), a fatal error
	 * occurred (go idle, do not retry), or the browser ended it on its own (restart).
	 */
	private handleEnd(): void {
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

		console.log('[NativeEngine] recognition ended on its own, reconnecting');
		this.isReconnecting = true;
		this.lastResultIndex = 0;
		this.setState('connecting');
		try {
			this.recognition.start();
		} catch (error) {
			console.error('[NativeEngine] failed to restart recognition:', error);
			this.isReconnecting = false;
			this.setState('idle');
			const reason = error instanceof Error ? error.message : String(error);
			this.emitError(new Error(`Failed to restart recognition: ${reason}`));
		}
	}
}
