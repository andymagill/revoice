/**
 * Browser capability detection for ReVoice.
 *
 * Used by CompatibilityShield to warn users up front instead of failing silently.
 * Every function touches `window`/`navigator`, so call them client-side only (the app
 * runs with `ssr = false`).
 */

import { getSpeechRecognitionConstructor } from './engines/speech-recognition';

/** Whether the Web Speech API (live transcription) is available. */
export function isWebSpeechSupported(): boolean {
	return getSpeechRecognitionConstructor() !== null;
}

/** Whether MediaRecorder (audio capture) is available. */
export function isMediaRecorderSupported(): boolean {
	return !!window.MediaRecorder;
}

/** Whether the Web Audio API (visualizer, playback analysis) is available. */
export function isWebAudioSupported(): boolean {
	return !!(
		window.AudioContext ||
		(window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext
	);
}

/** Whether IndexedDB (session storage) is available. */
export function isIndexedDBSupported(): boolean {
	return !!(window.indexedDB && typeof window.indexedDB.open === 'function');
}

/**
 * Best-effort browser family from the user agent.
 * Order matters: Edge and Chrome UAs both contain "Chrome/", and Chrome UAs contain "Safari/".
 */
export function getBrowserName(): 'chrome' | 'safari' | 'firefox' | 'edge' | 'unknown' {
	const ua = navigator.userAgent;

	if (/Edge\/|Edg\//.test(ua)) return 'edge';
	if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'chrome';
	if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
	if (/Firefox\//.test(ua)) return 'firefox';

	return 'unknown';
}

/** Result of `checkApiSupport`: one flag per required API plus their conjunction. */
export interface ApiSupport {
	webSpeech: boolean;
	mediaRecorder: boolean;
	webAudio: boolean;
	indexedDB: boolean;
	allSupported: boolean;
}

/** Check every API ReVoice depends on. */
export function checkApiSupport(): ApiSupport {
	const support = {
		webSpeech: isWebSpeechSupported(),
		mediaRecorder: isMediaRecorderSupported(),
		webAudio: isWebAudioSupported(),
		indexedDB: isIndexedDBSupported(),
	};

	return {
		...support,
		allSupported: Object.values(support).every(Boolean),
	};
}

/** Short, browser-specific caveats to show in the compatibility warning. */
export function getBrowserSpecificNotes(): string[] {
	const browser = getBrowserName();
	const notes: string[] = [];

	if (browser === 'safari') {
		notes.push('Safari: SpeechRecognition must be started from a click handler');
		notes.push('Safari: Use audio/mp4 for MediaRecorder');
		notes.push('Safari: AudioContext may require user gesture');
	}

	if (/Android/i.test(navigator.userAgent)) {
		notes.push('Android: live transcription may not work while audio is being recorded');
		notes.push('Android: add ?debug=1 to the URL to show an on-screen diagnostic log');
	}

	if (browser === 'chrome') {
		notes.push('Chrome: Prefers audio/webm;codecs=opus for MediaRecorder');
		notes.push('Chrome: Excellent Web Speech API support');
	}

	return notes;
}
