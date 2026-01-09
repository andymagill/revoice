/**
 * Native Web Speech API Transcription Engine
 * 
 * This is the default, built-in transcription engine for ReVoice.
 * It uses the Web Speech API (webkitSpeechRecognition) available in
 * Chrome, Edge, and Safari for fast, low-latency transcription.
 * 
 * Features:
 * - Continuous mode: recognizes until explicitly stopped
 * - Interim results: returns partial text while user is still speaking
 * - Multilingual support: supports ~100+ languages via OS speech engine
 * - No external dependencies: works offline with system speech recognition
 * 
 * Browser Support:
 * - ✅ Chrome/Chromium 25+
 * - ✅ Safari 14.1+
 * - ✅ Edge 79+
 * - ⚠️  Firefox (behind flag)
 * 
 * Safari-Specific Notes:
 * - MUST be called from within a click handler (user gesture requirement)
 * - AudioContext also requires user gesture
 * - Uses audio/mp4 format instead of WebM
 * 
 * @example
 * const engine = new NativeEngine();
 * const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 * 
 * engine.onResult(result => {
 *   console.log(result.text, result.isFinal);
 * });
 * 
 * engine.onError(error => {
 *   console.error('Speech recognition error:', error);
 * });
 * 
 * await engine.start(stream, { language: 'en-US' });
 * // ...
 * await engine.stop();
 */

import { TranscriptionEngine } from './base';
import type { EngineConfig, EngineMetadata, TranscriptionResult } from '../types';

declare global {
	interface Window {
		webkitSpeechRecognition: any;
		SpeechRecognition: any;
	}
}

export class NativeEngine extends TranscriptionEngine {
	/**
	 * Reference to the Web Speech API recognition object
	 * @private
	 */
	private recognition: any = null;

	/**
	 * Reference to the audio stream being transcribed
	 * @private
	 */
	private stream: MediaStream | null = null;

	/**
	 * Constructor: Initialize the Web Speech API
	 * 
	 * Throws an error if the Web Speech API is not available in the browser.
	 * This is a synchronous operation.
	 * 
	 * @throws Error if Web Speech API not supported
	 */
	constructor() {
		super();
		this.initializeRecognition();
	}

	/**
	 * Initialize the Web Speech API recognition object
	 * 
	 * Sets up event handlers for:
	 * - onstart: Fired when recognition begins listening
	 * - onresult: Fired when transcription results arrive
	 * - onerror: Fired when recognition encounters an error
	 * - onend: Fired when recognition stops
	 * 
	 * @private
	 * @throws Error if Web Speech API not supported
	 */
	private initializeRecognition(): void {
		// Try both webkit and standard prefixed APIs
		const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;

		if (!SpeechRecognition) {
			throw new Error('Web Speech API not supported in this browser');
		}

		this.recognition = new SpeechRecognition();

		// Configure for continuous recognition with interim results
		this.recognition.continuous = true;
		this.recognition.interimResults = true;
		this.recognition.lang = 'en-US';

		// Event handler: Recognition started listening
		this.recognition.onstart = () => {
			this.setState('listening');
		};

		// Event handler: Transcription results arrived
		this.recognition.onresult = (event: any) => {
			let interimTranscript = '';
			let isFinal = false;

			// Process each result in the event
			// Results array grows incrementally as user speaks
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const transcript = event.results[i][0].transcript;
				const confidence = event.results[i][0].confidence;

				// Check if this result is final (speech was followed by silence)
				if (event.results[i].isFinal) {
					isFinal = true;
				} else {
					interimTranscript += transcript;
				}

				// Emit result for this phrase
				this.emitResult({
					text: transcript,
					isFinal: event.results[i].isFinal,
					confidence
				});
			}
		};

		// Event handler: Recognition encountered an error
		this.recognition.onerror = (event: any) => {
			// Common error types: "no-speech", "network", "timeout", "permission-denied"
			const error = new Error(`Speech recognition error: ${event.error}`);
			this.emitError(error);
		};

		// Event handler: Recognition ended
		this.recognition.onend = () => {
			this.setState('idle');
		};
	}

	/**
	 * Start transcription on the given audio stream
	 * 
	 * Begins listening to the audio stream and emitting transcription results.
	 * Can optionally apply configuration like language code.
	 * 
	 * Important: In Safari, this MUST be called from within a click handler
	 * or other user gesture handler due to browser security restrictions.
	 * 
	 * @param stream - The MediaStream to transcribe (from getUserMedia)
	 * @param config - Optional engine configuration
	 * @param config.language - Language code (e.g., 'en-US', 'fr-FR')
	 * @param config.continuous - Whether to recognize continuously (default: true)
	 * @param config.interimResults - Whether to return interim results (default: true)
	 * @throws Error if engine is already running
	 * 
	 * @example
	 * const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	 * await engine.start(stream, { language: 'en-US' });
	 */
	async start(stream: MediaStream, config?: EngineConfig): Promise<void> {
		if (this.state === 'listening') {
			throw new Error('Engine is already listening');
		}

		this.stream = stream;

		// Apply configuration overrides
		if (config?.language) {
			this.recognition.lang = config.language;
		}
		if (config?.continuous !== undefined) {
			this.recognition.continuous = config.continuous;
		}
		if (config?.interimResults !== undefined) {
			this.recognition.interimResults = config.interimResults;
		}

		// Start recognition
		try {
			this.recognition.start();
			this.setState('listening');
		} catch (error) {
			// Handle case where recognition is already running
			// (user clicked start multiple times quickly)
			if ((error as any).message?.includes('already started')) {
				this.recognition.abort();
				this.recognition.start();
			} else {
				throw error;
			}
		}
	}

	/**
	 * Stop transcription and clean up resources
	 * 
	 * Stops listening, releases the audio stream, and transitions to idle state.
	 * Safe to call even if not currently listening.
	 * 
	 * @returns Promise that resolves when stopped (immediately)
	 */
	async stop(): Promise<void> {
		if (this.state === 'idle') {
			return;
		}

		try {
			// Tell recognition to stop accepting audio
			this.recognition.stop();
			this.setState('idle');
		} catch (error) {
			console.warn('Error stopping recognition:', error);
		}

		// Release the audio stream and stop all tracks
		if (this.stream) {
			this.stream.getTracks().forEach((track) => track.stop());
			this.stream = null;
		}
	}

	/**
	 * Get metadata about this engine
	 * 
	 * Returns information for display in the UI and logging.
	 * 
	 * @returns Engine metadata object
	 */
	getMetadata(): EngineMetadata {
		return {
			name: 'Web Speech API',
			version: '1.0.0',
			type: 'native',
			supportedLanguages: [
				'en-US',
				'en-GB',
				'es-ES',
				'fr-FR',
				'de-DE',
				'it-IT',
				'ja-JP',
				'zh-CN',
				'pt-BR'
				// Note: Actual support depends on browser and OS
				// Full list available at: https://www.w3.org/TR/speech-api/
			]
		};
	}
}
