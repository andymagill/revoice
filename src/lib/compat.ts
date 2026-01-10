/**
 * Compatibility detection for ReVoice
 * Handles browser differences and API support checks
 */

/**
 * Check if Web Speech API is supported
 */
export function isWebSpeechSupported(): boolean {
	const SpeechRecognition =
		(window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
	return !!SpeechRecognition;
}

/**
 * Check if MediaRecorder API is supported
 */
export function isMediaRecorderSupported(): boolean {
	return !!window.MediaRecorder;
}

/**
 * Check if Web Audio API is supported
 */
export function isWebAudioSupported(): boolean {
	return !!(window.AudioContext || (window as any).webkitAudioContext);
}

/**
 * Check if IndexedDB is supported
 */
export function isIndexedDBSupported(): boolean {
	return !!(window.indexedDB && typeof window.indexedDB.open === 'function');
}

/**
 * Get current browser name
 */
export function getBrowserName(): 'chrome' | 'safari' | 'firefox' | 'edge' | 'unknown' {
	const ua = navigator.userAgent;

	if (/Edge\/|Edg\//.test(ua)) return 'edge';
	if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'chrome';
	if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'safari';
	if (/Firefox\//.test(ua)) return 'firefox';

	return 'unknown';
}

/**
 * Check if running on iOS
 */
export function isIOS(): boolean {
	return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
	return /Mac/.test(navigator.userAgent) && !isIOS();
}

/**
 * Comprehensive API support check
 */
export interface ApiSupport {
	webSpeech: boolean;
	mediaRecorder: boolean;
	webAudio: boolean;
	indexedDB: boolean;
	allSupported: boolean;
}

export function checkApiSupport(): ApiSupport {
	const support = {
		webSpeech: isWebSpeechSupported(),
		mediaRecorder: isMediaRecorderSupported(),
		webAudio: isWebAudioSupported(),
		indexedDB: isIndexedDBSupported(),
	};

	return {
		...support,
		allSupported: Object.values(support).every((v) => v === true),
	};
}

/**
 * Get recommended engine for current browser
 */
export function getRecommendedEngine(): 'native' {
	// For PoC, only native engine is available
	// Future: return 'deepgram' | 'assemblyai' | 'native' etc.
	return 'native';
}

/**
 * Browser-specific initialization notes
 */
export function getBrowserSpecificNotes(): string[] {
	const browser = getBrowserName();
	const notes: string[] = [];

	if (browser === 'safari') {
		notes.push('Safari: SpeechRecognition must be started from a click handler');
		notes.push('Safari: Use audio/mp4 for MediaRecorder');
		notes.push('Safari: AudioContext may require user gesture');
	}

	if (browser === 'chrome') {
		notes.push('Chrome: Prefers audio/webm;codecs=opus for MediaRecorder');
		notes.push('Chrome: Excellent Web Speech API support');
	}

	return notes;
}
