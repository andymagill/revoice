/**
 * Recorder: the recording state machine and the data for the session on screen.
 *
 * Coordinates the microphone stream, MediaRecorder (audio), the analyser (visualizer),
 * the transcription engine and persistence, and exposes reactive state for the UI.
 *
 * ```
 *            start()                pause()
 *   idle ─────────────► recording ───────────► paused
 *     ▲                     ▲                     │
 *     │                     └──────resume()───────┘
 *     └────────── finalize() (from recording or paused)
 * ```
 *
 * Why it is shaped this way:
 * - One MediaRecorder lives from `start` to `finalize`; pause/resume reuse it. All its
 *   chunks therefore form a single valid WebM/MP4 file, which is why a loaded session can
 *   only be *viewed*, not appended to (a second recorder would produce a second file
 *   with its own container header).
 * - Every pause persists the COMPLETE audio so far, so nothing is lost if the tab closes
 *   while paused. `finalize` persists once more if anything was recorded since.
 * - The Recorder owns the microphone stream and always releases it in `teardown`. The
 *   transcription engine never stops the stream (see NativeEngine).
 * - Elapsed time is the sum of recording segments and excludes paused time, so the
 *   stored duration and transcript timestamps line up with the audio.
 * - State-changing commands never overlap: `start`/`pause`/`resume` are ignored while
 *   another command is running, and `finalize` waits for it. That makes rapid clicks and
 *   "New Session while pausing" safe.
 */

import { getSharedAudioContext, getSupportedAudioFormat } from './audio';
import {
	createSession,
	getSession,
	getSessionAudio,
	getSessionTranscripts,
	storeAudioData,
	storeTranscript,
	updateSessionDuration,
	type Session,
} from './db';
import type { ITranscriptionEngine, TranscriptionResult } from './types';

export type RecordingState = 'idle' | 'recording' | 'paused';

/** Notifications for the owner (the page) so it can keep the sidebar in sync. */
export interface RecorderHooks {
	/** A new session row was created and recording has begun. */
	sessionCreated?(session: Session): void;
	/** Audio and duration were written to IndexedDB. */
	audioSaved?(): void;
}

/** MediaRecorder timeslice: how often it emits a chunk while recording. */
const CHUNK_INTERVAL_MS = 1000;
/** Upper bound on waiting for MediaRecorder to flush data after `requestData`/`stop`. */
const FLUSH_TIMEOUT_MS = 1000;
/** How often the on-screen timer updates. */
const TICK_INTERVAL_MS = 100;

/** Turn a getUserMedia/MediaRecorder failure into a message a user can act on. */
function describeError(error: unknown): string {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError') {
			return 'Microphone access was denied. Allow it in your browser settings and try again.';
		}
		if (error.name === 'NotFoundError') {
			return 'No microphone was found.';
		}
	}
	return error instanceof Error ? error.message : String(error);
}

export class Recorder {
	/** Current position in the state machine. */
	state = $state<RecordingState>('idle');

	/**
	 * Milliseconds to show on the timer: live while recording, the total when paused, or
	 * the stored duration of a loaded session.
	 */
	elapsedMs = $state(0);

	/** ID of the session being recorded (`null` while idle). */
	sessionId = $state<number | null>(null);

	/** Completed transcript segments for the session on screen. Replaced, never mutated. */
	finals = $state.raw<TranscriptionResult[]>([]);

	/** The in-progress (not yet final) segment, or `null`. */
	interim = $state.raw<TranscriptionResult | null>(null);

	/** Playable audio for the session on screen, or `null`. */
	audioBlob = $state.raw<Blob | null>(null);

	/** Live microphone analyser for the visualizer while a recording exists. */
	analyser = $state.raw<AnalyserNode | null>(null);

	/** Latest user-facing problem (permission denied, save failed, ...), or `null`. */
	error = $state<string | null>(null);

	private engine: ITranscriptionEngine | null;
	private hooks: RecorderHooks;
	private unsubscribers: Array<() => void> = [];

	private stream: MediaStream | null = null;
	private source: MediaStreamAudioSourceNode | null = null;
	private mediaRecorder: MediaRecorder | null = null;
	private mimeType = '';
	private chunks: Blob[] = [];
	/** True when `chunks` holds audio that has not been written to IndexedDB yet. */
	private dirty = false;

	private timer: ReturnType<typeof setInterval> | null = null;
	/** Milliseconds recorded in finished segments. */
	private accumulatedMs = 0;
	/** Start of the running segment, or `null` when not recording. */
	private segmentStart: number | null = null;

	private inFlight: Promise<void> | null = null;
	private finalizing: Promise<void> | null = null;
	/** Bumped whenever the on-screen session changes, to discard stale async loads. */
	private viewToken = 0;

	constructor(engine: ITranscriptionEngine | null, hooks: RecorderHooks = {}) {
		this.engine = engine;
		this.hooks = hooks;

		if (engine) {
			this.unsubscribers.push(
				engine.onResult((result) => this.handleResult(result)),
				engine.onError((error) => this.handleEngineError(error))
			);
		}
	}

	/**
	 * Begin a new recording (and a new session). Ignored unless idle and not busy.
	 * Must be called from a user gesture (microphone permission, Safari AudioContext).
	 */
	start(): Promise<void> {
		if (this.state !== 'idle' || this.inFlight || this.finalizing) return Promise.resolve();
		return this.track(this.doStart());
	}

	/** Pause recording and persist the audio so far. Ignored unless recording. */
	pause(): Promise<void> {
		if (this.state !== 'recording' || this.inFlight || this.finalizing) return Promise.resolve();
		return this.track(this.doPause());
	}

	/** Continue recording into the same session. Ignored unless paused. */
	resume(): Promise<void> {
		if (this.state !== 'paused' || this.inFlight || this.finalizing) return Promise.resolve();
		return this.track(this.doResume());
	}

	/**
	 * Stop whatever is in progress, save it, release the microphone and return to idle.
	 * Safe to call when idle and from several places at once. The on-screen session (audio,
	 * transcript, duration) is left in place; call `reset` or `open` to change it.
	 */
	finalize(): Promise<void> {
		if (!this.finalizing) {
			this.finalizing = (async () => {
				while (this.inFlight) await this.inFlight;
				if (this.state !== 'idle') await this.track(this.doFinalize());
			})().finally(() => {
				this.finalizing = null;
			});
		}
		return this.finalizing;
	}

	/**
	 * Show a stored session (audio, transcript, duration). Only valid while idle; callers
	 * `finalize()` first. If called again before it finishes, the older call is discarded.
	 */
	async open(session: Session): Promise<void> {
		const id = session.id;
		if (this.state !== 'idle' || id === undefined) return;

		const token = ++this.viewToken;
		this.finals = [];
		this.interim = null;
		this.audioBlob = null;
		this.elapsedMs = session.duration;
		this.error = null;

		try {
			const [blob, transcripts] = await Promise.all([
				getSessionAudio(id),
				getSessionTranscripts(id),
			]);
			if (token !== this.viewToken) return;

			this.audioBlob = blob;
			this.finals = transcripts.map((t) => ({ text: t.text, isFinal: true }));
		} catch (error) {
			console.error('[Recorder] Failed to load session:', error);
			if (token === this.viewToken) this.error = 'Could not load this session.';
		}
	}

	/** Clear the on-screen session. Only valid while idle. */
	reset(): void {
		if (this.state !== 'idle') return;
		this.viewToken++;
		this.finals = [];
		this.interim = null;
		this.audioBlob = null;
		this.elapsedMs = 0;
		this.accumulatedMs = 0;
		this.error = null;
	}

	/** Detach from the engine and save/stop any active recording. Call on unmount. */
	dispose(): void {
		void this.finalize().finally(() => {
			this.unsubscribers.forEach((unsubscribe) => unsubscribe());
			this.unsubscribers = [];
		});
	}

	// ── Commands ────────────────────────────────────────────────────────────

	private async doStart(): Promise<void> {
		this.error = null;
		try {
			// Web Speech captures its own audio; this stream feeds MediaRecorder + analyser.
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			this.stream = stream;

			const context = getSharedAudioContext();
			const analyser = context.createAnalyser();
			// 64-point FFT → 32 bins, one per visualizer bar (see EqVisualizer).
			analyser.fftSize = 64;
			const source = context.createMediaStreamSource(stream);
			source.connect(analyser);
			this.source = source;

			const format = getSupportedAudioFormat();
			const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
			this.mimeType = format.mimeType;
			this.chunks = [];
			this.dirty = false;
			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					this.chunks.push(event.data);
					this.dirty = true;
				}
			};
			this.mediaRecorder = recorder;

			const id = await createSession(
				`Session ${new Date().toLocaleTimeString()}`,
				'native',
				format.mimeType
			);

			this.finals = [];
			this.interim = null;
			this.audioBlob = null;
			this.accumulatedMs = 0;
			this.elapsedMs = 0;
			this.sessionId = id;
			this.analyser = analyser;

			recorder.start(CHUNK_INTERVAL_MS);
			this.beginSegment();
			this.state = 'recording';

			const session = await getSession(id);
			if (session) this.hooks.sessionCreated?.(session);

			await this.startEngine();
		} catch (error) {
			console.error('[Recorder] Failed to start recording:', error);
			this.teardown();
			this.sessionId = null;
			this.state = 'idle';
			this.error = describeError(error);
		}
	}

	private async doPause(): Promise<void> {
		const recorder = this.mediaRecorder;
		if (!recorder) return;

		this.freezeClock();
		try {
			// Stop the engine first and wait: the browser flushes pending speech as final
			// results during stop, and those must land before we go quiet.
			await this.engine?.stop();
			this.interim = null;

			recorder.pause();
			await this.flush(recorder);
			await this.persist();
		} catch (error) {
			console.error('[Recorder] Error while pausing:', error);
			this.error = `Could not pause cleanly: ${describeError(error)}`;
		}
		this.state = 'paused';
	}

	private async doResume(): Promise<void> {
		const recorder = this.mediaRecorder;
		if (!recorder) return;

		this.error = null;
		try {
			recorder.resume();
		} catch (error) {
			console.error('[Recorder] Failed to resume:', error);
			this.error = describeError(error);
			return;
		}
		this.beginSegment();
		this.state = 'recording';
		await this.startEngine();
	}

	private async doFinalize(): Promise<void> {
		this.freezeClock();
		try {
			await this.engine?.stop();
		} catch (error) {
			console.error('[Recorder] Engine failed to stop:', error);
		}
		this.interim = null;

		const recorder = this.mediaRecorder;
		if (recorder && recorder.state !== 'inactive') {
			await this.stopRecorder(recorder);
		}
		await this.persist();

		this.teardown();
		this.sessionId = null;
		this.state = 'idle';
	}

	// ── Internals ───────────────────────────────────────────────────────────

	/**
	 * Run a command and record it as in flight. Errors are reported instead of rejected so
	 * callers that ignore the returned promise cannot cause unhandled rejections.
	 */
	private track(work: Promise<void>): Promise<void> {
		const tracked: Promise<void> = work
			.catch((error) => {
				console.error('[Recorder] Unexpected error:', error);
				this.error = describeError(error);
			})
			.finally(() => {
				if (this.inFlight === tracked) this.inFlight = null;
			});
		this.inFlight = tracked;
		return tracked;
	}

	/** Start (or restart after pause) the engine; a failure degrades to audio-only. */
	private async startEngine(): Promise<void> {
		if (!this.engine || !this.stream) return;
		try {
			await this.engine.start(this.stream);
		} catch (error) {
			console.error('[Recorder] Transcription failed to start:', error);
			this.error = `Transcription unavailable: ${describeError(error)}`;
		}
	}

	private handleResult(result: TranscriptionResult): void {
		if (this.state === 'idle' || this.sessionId === null) return;

		if (!result.isFinal) {
			this.interim = result;
			return;
		}

		this.interim = null;
		const text = result.text.trim();
		if (!text) return;

		this.finals = [...this.finals, { ...result, text }];
		storeTranscript(this.sessionId, text, this.currentElapsed(), true).catch((error) => {
			console.error('[Recorder] Failed to store transcript:', error);
		});
	}

	private handleEngineError(error: Error): void {
		if (this.state === 'recording') {
			this.error = `Transcription problem: ${error.message}`;
		}
	}

	/**
	 * Write the complete audio and current duration to IndexedDB (no-op if nothing new).
	 * The blob is exposed for playback BEFORE the write, so a storage failure (e.g. quota)
	 * still leaves the user with playable audio and a visible error.
	 */
	private async persist(): Promise<void> {
		const id = this.sessionId;
		if (id === null || !this.dirty) return;

		const blob = new Blob(this.chunks, { type: this.mimeType });
		this.audioBlob = blob;
		this.elapsedMs = this.accumulatedMs;
		this.dirty = false;

		try {
			await storeAudioData(id, blob);
			await updateSessionDuration(id, this.accumulatedMs);
			this.hooks.audioSaved?.();
		} catch (error) {
			console.error('[Recorder] Failed to save audio:', error);
			this.dirty = true;
			this.error = `Could not save audio: ${describeError(error)}`;
		}
	}

	/** Ask MediaRecorder to emit buffered data and wait for it (bounded by a timeout). */
	private flush(recorder: MediaRecorder): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timeout);
				recorder.removeEventListener('dataavailable', done);
				resolve();
			};
			const timeout = setTimeout(done, FLUSH_TIMEOUT_MS);
			recorder.addEventListener('dataavailable', done);
			recorder.requestData();
		});
	}

	/** Stop MediaRecorder and wait for its final chunk (`stop` fires after `dataavailable`). */
	private stopRecorder(recorder: MediaRecorder): Promise<void> {
		return new Promise((resolve) => {
			const done = () => {
				clearTimeout(timeout);
				resolve();
			};
			const timeout = setTimeout(done, FLUSH_TIMEOUT_MS);
			recorder.addEventListener('stop', done, { once: true });
			recorder.stop();
		});
	}

	/** Release the microphone, analyser and recorder. Does not touch reactive view state. */
	private teardown(): void {
		this.stopTimer();
		this.segmentStart = null;

		if (this.mediaRecorder) this.mediaRecorder.ondataavailable = null;
		this.mediaRecorder = null;

		this.source?.disconnect();
		this.source = null;
		this.analyser?.disconnect();
		this.analyser = null;

		this.stream?.getTracks().forEach((track) => track.stop());
		this.stream = null;

		this.chunks = [];
		this.dirty = false;
	}

	private currentElapsed(): number {
		return this.accumulatedMs + (this.segmentStart === null ? 0 : Date.now() - this.segmentStart);
	}

	private beginSegment(): void {
		this.segmentStart = Date.now();
		this.stopTimer();
		this.timer = setInterval(() => {
			this.elapsedMs = this.currentElapsed();
		}, TICK_INTERVAL_MS);
	}

	/** End the running segment and freeze the displayed time. */
	private freezeClock(): void {
		this.stopTimer();
		if (this.segmentStart !== null) {
			this.accumulatedMs += Date.now() - this.segmentStart;
			this.segmentStart = null;
		}
		this.elapsedMs = this.accumulatedMs;
	}

	private stopTimer(): void {
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}
}
