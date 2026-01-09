/**
 * Audio Utilities for ReVoice
 * 
 * Handles all audio-related operations including:
 * - MIME type detection and compatibility checking
 * - Audio stream management and cloning
 * - MediaRecorder configuration
 * - Audio blob conversion
 * 
 * Browser Audio Landscape:
 * - Chrome: Prefers WebM with Opus codec (better compression)
 * - Safari: Uses MP4 format (WebM not supported)
 * - Firefox: Supports both WebM and WAV
 * 
 * Dual-Track Approach:
 * 1. MediaRecorder: Captures audio for persistence in IndexedDB
 * 2. Web Audio API: Powers the frequency visualizer
 * Both consume the same audio stream, fed via stream.clone()
 */

import type { AudioFormat } from './types';

/**
 * Detect the best supported audio format for the current browser
 * 
 * Tries formats in order of preference, falling back gracefully:
 * 1. audio/webm;codecs=opus (Chrome - best compression)
 * 2. audio/webm (Chrome fallback)
 * 3. audio/mp4 (Safari)
 * 4. audio/webm (default fallback)
 * 
 * Result is cached at browser session start for efficiency.
 * 
 * @returns AudioFormat object with MIME type and optional codec info
 * 
 * @example
 * const format = getSupportedAudioFormat();
 * console.log(format.mimeType); // "audio/webm;codecs=opus"
 * const recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
 */
export function getSupportedAudioFormat(): AudioFormat {
	// Check for WebM/Opus first (preferred for Chrome)
	// Opus provides excellent compression for speech (< 20KB/min)
	if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
		return {
			mimeType: 'audio/webm;codecs=opus',
			codecs: ['opus']
		};
	}

	// Fall back to audio/webm without specific codec (Chrome)
	if (MediaRecorder.isTypeSupported('audio/webm')) {
		return {
			mimeType: 'audio/webm',
			codecs: []
		};
	}

	// Fall back to audio/mp4 (Safari)
	// Safari on iOS/macOS uses AAC codec by default
	if (MediaRecorder.isTypeSupported('audio/mp4')) {
		return {
			mimeType: 'audio/mp4',
			codecs: []
		};
	}

	// Last resort default (shouldn't reach here in modern browsers)
	return {
		mimeType: 'audio/webm',
		codecs: []
	};
}

/**
 * Clone a MediaStream for use with multiple consumers
 * 
 * Web Audio API and MediaRecorder both need to consume audio from the
 * microphone. Rather than creating two separate getUserMedia() calls,
 * this creates a cloned stream that can feed both.
 * 
 * Technical approach:
 * 1. Create AudioContext and connect source to microphone stream
 * 2. Create destination (output track)
 * 3. Return destination.stream (new stream)
 * 
 * Now both MediaRecorder and AnalyserNode can consume this clone.
 * 
 * @param stream - Original MediaStream from getUserMedia()
 * @returns New cloned MediaStream safe to pass to multiple consumers
 * 
 * @example
 * const originalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
 * const clonedStream = cloneMediaStream(originalStream);
 * 
 * const recorder = new MediaRecorder(clonedStream);
 * const audioContext = new AudioContext();
 * const source = audioContext.createMediaStreamSource(clonedStream);
 * const analyser = audioContext.createAnalyser();
 * source.connect(analyser);
 */
export function cloneMediaStream(stream: MediaStream): MediaStream {
	// Get or create AudioContext (webkit prefix for Safari)
	const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
	
	// Connect microphone stream to audio context
	const source = audioContext.createMediaStreamSource(stream);
	
	// Create a new output stream we can pass to both recorder and analyser
	const destination = audioContext.createMediaStreamDestination();

	// Connect source directly to destination (pass-through)
	source.connect(destination);

	// Return the cloned stream
	return destination.stream;
}

/**
 * Create a MediaRecorder configured for the current browser
 * 
 * Automatically detects supported audio format and creates recorder
 * with appropriate MIME type. Handles browser differences transparently.
 * 
 * @param stream - MediaStream to record from
 * @param mimeType - Optional override MIME type (uses detected if omitted)
 * @returns Configured MediaRecorder instance
 * 
 * @example
 * const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 * const recorder = createMediaRecorder(stream);
 * 
 * recorder.ondataavailable = (event) => {
 *   storeAudioData(sessionId, event.data);
 * };
 * 
 * recorder.start();
 */
export function createMediaRecorder(
	stream: MediaStream,
	mimeType?: string
): MediaRecorder {
	const format = getSupportedAudioFormat();
	const type = mimeType || format.mimeType;

	return new MediaRecorder(stream, { mimeType: type });
}

/**
 * Convert a Blob to base64-encoded data URL
 * 
 * Useful for storing blobs as strings in localStorage or for
 * transmission over network. Note: base64 is ~33% larger than binary.
 * 
 * @param blob - Blob to convert
 * @returns Promise resolving to data URL (e.g., "data:audio/webm;base64,...")
 * 
 * @example
 * const blob = audioRecorder.getBlobData();
 * const dataUrl = await blobToBase64(blob);
 * localStorage.setItem('audio', dataUrl); // Not recommended for large files
 */
export async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			resolve(reader.result as string);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/**
 * Convert a base64 data URL back to a Blob
 * 
 * Reverses the blobToBase64() operation to reconstruct the original binary data.
 * Used when reading audio from localStorage or other string-based storage.
 * 
 * @param base64 - Data URL string (e.g., "data:audio/webm;base64,...")
 * @param mimeType - MIME type for the blob (defaults to audio/webm)
 * @returns Reconstructed Blob with original audio data
 * 
 * @example
 * const dataUrl = localStorage.getItem('audio');
 * const blob = base64ToBlob(dataUrl, 'audio/webm');
 * const audio = new Audio(URL.createObjectURL(blob));
 * audio.play();
 */
export function base64ToBlob(base64: string, mimeType: string = 'audio/webm'): Blob {
	// Extract the base64 content (skip "data:audio/webm;base64," prefix)
	const byteCharacters = atob(base64.split(',')[1]);
	
	// Convert each character to a byte
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	
	// Create Uint8Array (binary data)
	const byteArray = new Uint8Array(byteNumbers);
	
	// Wrap in Blob with correct MIME type
	return new Blob([byteArray], { type: mimeType });
}

/**
 * Get the file extension for a given audio MIME type
 * 
 * Useful for generating filenames when exporting audio.
 * Maps MIME types to standard file extensions.
 * 
 * @param mimeType - Audio MIME type (e.g., "audio/webm")
 * @returns File extension with dot (e.g., ".webm")
 * 
 * @example
 * const mimeType = getSupportedAudioFormat().mimeType;
 * const filename = `recording-${Date.now()}${getAudioFileExtension(mimeType)}`;
 * // "recording-1641009000000.webm"
 */
export function getAudioFileExtension(mimeType: string): string {
	if (mimeType.includes('webm')) return '.webm';
	if (mimeType.includes('mp4')) return '.mp4';
	if (mimeType.includes('wav')) return '.wav';
	if (mimeType.includes('ogg')) return '.ogg';
	return '.audio';
}
