/**
 * Browser audio helpers for ReVoice.
 *
 * Browser landscape this module papers over:
 * - Chrome/Edge record WebM (Opus); Safari records MP4 (AAC) and has no WebM support.
 * - Browsers cap the number of live AudioContexts (often ~6), so one is shared.
 *
 * The recorder feeds ONE microphone MediaStream to both MediaRecorder (persistence) and
 * an AnalyserNode (visualizer); no stream cloning is needed.
 */

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
		sharedAudioContext = new Context();
	}
	if (sharedAudioContext.state === 'suspended') {
		sharedAudioContext.resume().catch((error) => {
			console.warn('[audio] Could not resume AudioContext:', error);
		});
	}
	return sharedAudioContext;
}
