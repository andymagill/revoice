/**
 * Browser audio helpers for ReVoice.
 *
 * Browser landscape this module papers over:
 * - Chrome/Edge record WebM (Opus); Safari records MP4 (AAC) and has no WebM support.
 * - Browsers cap the number of live AudioContexts (often ~6), so one is shared.
 * - Microphone failures surface as many different DOMExceptions; `acquireMicrophone`
 *   turns them into one `MicrophoneError` with a code and a message a user can act on.
 *
 * The recorder feeds ONE microphone MediaStream to both MediaRecorder (persistence) and
 * an AnalyserNode (visualizer); no stream cloning is needed.
 */

import { diag } from './diagnostics.svelte';
import type { AudioFormat } from './types';

/**
 * Pick the best audio container/codec the current browser can record.
 *
 * Preference order: WebM+Opus (best compression for speech), plain WebM, MP4 (Safari).
 * Falls back to `audio/webm` if nothing reports support, so callers always get a usable
 * MIME type string (recording will then fail loudly instead of silently mislabelling).
 */
export function getSupportedAudioFormat(): AudioFormat {
	if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
		return { mimeType: 'audio/webm;codecs=opus', codecs: ['opus'] };
	}
	if (MediaRecorder.isTypeSupported('audio/webm')) {
		return { mimeType: 'audio/webm', codecs: [] };
	}
	if (MediaRecorder.isTypeSupported('audio/mp4')) {
		return { mimeType: 'audio/mp4', codecs: [] };
	}
	return { mimeType: 'audio/webm', codecs: [] };
}

let sharedAudioContext: AudioContext | null = null;

/**
 * Get the app-wide AudioContext, creating it on first use.
 *
 * A singleton avoids hitting the browser's context limit across many recordings and
 * playbacks. The context is resumed on every call because browsers (notably Safari)
 * create it suspended until a user gesture; callers should therefore first reach this
 * from a click handler.
 */
export function getSharedAudioContext(): AudioContext {
	if (!sharedAudioContext) {
		const Context =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		const context = new Context();
		sharedAudioContext = context;
		diag('audio', 'context-created', { state: context.state, sampleRate: context.sampleRate });
		// Mobile browsers suspend/interrupt contexts (backgrounding, calls); worth seeing.
		context.addEventListener('statechange', () => diag('audio', 'context-state', context.state));
	}
	if (sharedAudioContext.state === 'suspended') {
		sharedAudioContext.resume().catch((error) => {
			console.warn('[audio] Could not resume AudioContext:', error);
			diag('audio', 'context-resume-failed', error);
		});
	}
	return sharedAudioContext;
}

export type MicrophoneErrorCode =
	| 'insecure'
	| 'unsupported'
	| 'denied'
	| 'not-found'
	| 'in-use'
	| 'aborted'
	| 'unknown';

/** A microphone failure classified into a stable code plus a user-facing message. */
export class MicrophoneError extends Error {
	readonly code: MicrophoneErrorCode;

	constructor(code: MicrophoneErrorCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = 'MicrophoneError';
		this.code = code;
	}
}

/** Map whatever `getUserMedia` threw onto a `MicrophoneError`. */
function classifyMicrophoneError(error: unknown): MicrophoneError {
	if (error instanceof MicrophoneError) return error;

	switch (error instanceof DOMException ? error.name : '') {
		case 'NotAllowedError':
		case 'SecurityError':
			return new MicrophoneError(
				'denied',
				'Microphone access was denied. Allow it in your browser settings and try again.',
				error
			);
		case 'NotFoundError':
			return new MicrophoneError('not-found', 'No microphone was found.', error);
		case 'NotReadableError':
		case 'TrackStartError':
			// Typical on Android when a call, assistant or another app holds the microphone.
			return new MicrophoneError(
				'in-use',
				'The microphone is in use by another app or tab. Close it and try again.',
				error
			);
		case 'AbortError':
			return new MicrophoneError('aborted', 'The microphone could not start. Try again.', error);
		default:
			return new MicrophoneError(
				'unknown',
				error instanceof Error ? error.message : String(error),
				error
			);
	}
}

/**
 * Open the microphone defensively.
 *
 * Checks the preconditions `getUserMedia` reports poorly (insecure context, missing API),
 * verifies the returned track is actually live, logs the device/settings, and watches the
 * track for `mute`/`ended`: Android mutes a track when another capturer, such as the
 * speech-recognition service, takes over the microphone.
 *
 * @throws MicrophoneError with a `code` the caller can branch on.
 */
export async function acquireMicrophone(): Promise<MediaStream> {
	if (!window.isSecureContext) {
		throw new MicrophoneError('insecure', 'The microphone needs a secure (HTTPS) connection.');
	}
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new MicrophoneError('unsupported', 'This browser cannot access the microphone.');
	}

	const started = performance.now();
	let stream: MediaStream;
	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	} catch (error) {
		diag('mic', 'getUserMedia-failed', {
			name: error instanceof Error ? error.name : typeof error,
			message: error instanceof Error ? error.message : String(error),
		});
		throw classifyMicrophoneError(error);
	}

	const [track] = stream.getAudioTracks();
	diag('mic', 'acquired', {
		ms: Math.round(performance.now() - started),
		label: track?.label,
		readyState: track?.readyState,
		muted: track?.muted,
		settings: track?.getSettings?.(),
	});

	if (!track || track.readyState !== 'live') {
		stream.getTracks().forEach((t) => t.stop());
		throw new MicrophoneError('in-use', 'The microphone did not provide a live audio track.');
	}

	track.addEventListener('mute', () => diag('mic', 'track-muted'));
	track.addEventListener('unmute', () => diag('mic', 'track-unmuted'));
	track.addEventListener('ended', () => diag('mic', 'track-ended'));
	return stream;
}

/**
 * Log a MediaRecorder's lifecycle and every chunk it emits. Uses listeners, so it does not
 * interfere with the recorder's own `ondataavailable`. Steadily growing chunk sizes prove
 * audio is being captured even when speech recognition hears nothing.
 */
export function attachRecorderDiagnostics(recorder: MediaRecorder): void {
	recorder.addEventListener('start', () => diag('mediarecorder', 'start'));
	recorder.addEventListener('pause', () => diag('mediarecorder', 'pause'));
	recorder.addEventListener('resume', () => diag('mediarecorder', 'resume'));
	recorder.addEventListener('stop', () => diag('mediarecorder', 'stop'));
	recorder.addEventListener('error', (event) =>
		diag('mediarecorder', 'error', (event as Event & { error?: unknown }).error ?? 'unknown')
	);
	recorder.addEventListener('dataavailable', (event) =>
		diag('mediarecorder', 'chunk', { bytes: event.data.size })
	);
}
