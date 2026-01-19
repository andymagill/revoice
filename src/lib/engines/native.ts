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
	 * Index of the last processed result.
	 * Used to deduplicate results when the engine emits duplicate events.
	 * @private
	 */
	private lastResultIndex: number = 0;

	/**
	 * Flag to track if we're explicitly stopping the engine.
	 * Used to distinguish between explicit stop() calls and Web Speech API
	 * naturally ending recognition (e.g., due to silence on Android).
	 * @private
	 */
	private isStopping: boolean = false;

	/**
	 * Flag to track if we're in the middle of reconnecting.
	 * When true, onstart won't transition to listening; we wait for onresult instead.
	 * @private
	 */
	private isReconnecting: boolean = false;

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
		console.log('[NativeEngine] Initializing Web Speech API engine');
		this.initializeRecognition();
		console.log('[NativeEngine] Initialization complete');
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
			const error = 'Web Speech API not supported in this browser';
			console.error('[NativeEngine]', error);
			throw new Error(error);
		}

		console.log('[NativeEngine] Web Speech API available');
		this.recognition = new SpeechRecognition();

		// Configure for continuous recognition with interim results
		this.recognition.continuous = true;
		this.recognition.interimResults = true;
		this.recognition.lang = 'en-US';

		console.log(
			'[NativeEngine] Recognition configured: continuous=true, interimResults=true, lang=en-US'
		);

		// Event handler: Recognition started listening
		this.recognition.onstart = () => {
			console.log(
				'[NativeEngine] onstart: Recognition started listening (isReconnecting=' +
					this.isReconnecting +
					')'
			);
			// Only transition to 'listening' if this is a fresh start
			// If reconnecting, stay in 'connecting' until we get actual results
			if (!this.isReconnecting) {
				this.setState('listening');
			}
		};

		// Event handler: Transcription results arrived
		this.recognition.onresult = (event: any) => {
			console.log(
				`[NativeEngine] onresult: ${event.results.length} total results, index=${event.resultIndex}`
			);

			// If we were in connecting state (waiting for first result), transition to listening
			if (this.isReconnecting) {
				console.log(
					'[NativeEngine] First result after reconnect, transitioning from connecting to listening'
				);
				this.isReconnecting = false;
				this.setState('listening');
			}

			/**
			 * STREAMING TRANSCRIPTION PATTERN
			 *
			 * The Web Speech API emits `onresult` events as the user speaks. Each event contains:
			 * - `event.results`: Cumulative array of all speech results from session start
			 * - `event.resultIndex`: Starting index of new/updated results in this event
			 *
			 * ## Problem:
			 * Without tracking, emitting every result in the array causes duplicates:
			 * - Same phrases appear multiple times (interim → interim → final)
			 * - UI shows: "Hello", "Hello world", "Hello world" (3 separate entries)
			 *
			 * ## Solution:
			 * Track which results have been finalized using `lastResultIndex`.
			 * Only emit:
			 * - New results (index >= lastResultIndex)
			 * - Updated interim results (index < lastResultIndex but !isFinal)
			 *
			 * This ensures interim results update in place, and final results are emitted once.
			 */

			// Process results starting from last processed index
			for (let i = event.resultIndex; i < event.results.length; i++) {
				const result = event.results[i];
				const transcript = result[0].transcript;
				const confidence = result[0].confidence;
				const isFinal = result.isFinal;

				/**
				 * EMISSION LOGIC:
				 * - Emit if result is new (i >= lastResultIndex)
				 * - Emit if result is interim (!isFinal) to allow real-time updates
				 * - Skip if result is final but already processed (prevents duplicates)
				 */
				if (i >= this.lastResultIndex || !isFinal) {
					console.log(
						`[NativeEngine] Emitting result[${i}]: "${transcript}" (isFinal=${isFinal}, confidence=${confidence.toFixed(2)})`
					);
					this.emitResult({
						text: transcript,
						isFinal: isFinal,
						confidence,
						resultIndex: i,
					});
				} else {
					console.log(`[NativeEngine] Skipping result[${i}]: already processed and finalized`);
				}

				/**
				 * INDEX MANAGEMENT:
				 * When a result becomes final, advance lastResultIndex past it.
				 * This marks the result as processed and prevents re-emission.
				 */
				if (isFinal) {
					this.lastResultIndex = i + 1;
				}
			}
		};

		// Event handler: Recognition encountered an error
		this.recognition.onerror = (event: any) => {
			console.error('[NativeEngine] onerror event:', event.error);
			// Common error types: "no-speech", "network", "timeout", "permission-denied"
			const error = new Error(`Speech recognition error: ${event.error}`);
			this.emitError(error);
		};

		// Event handler: Recognition ended
		this.recognition.onend = () => {
			console.log(`[NativeEngine] onend: Recognition ended (isStopping=${this.isStopping})`);
			// Only transition to idle if we explicitly called stop()
			// Otherwise, if recognition ended naturally (e.g., due to silence on Android),
			// we stay active since the user is still recording
			if (this.isStopping) {
				this.isStopping = false;
				console.log('[NativeEngine] Explicit stop detected, transitioning to idle');
				this.setState('idle');
			} else if (this.state === 'listening') {
				// Recognition ended naturally, but we're still actively recording.
				// Set state to connecting and attempt to restart recognition
				console.log('[NativeEngine] Natural end detected during active listening, reconnecting...');
				this.isReconnecting = true;
				this.setState('connecting');
				try {
					this.recognition.start();
					console.log('[NativeEngine] Reconnection started');
				} catch (error) {
					console.error('[NativeEngine] Failed to restart recognition:', error);
					// If restart fails, emit an error
					this.emitError(
						new Error(`Failed to restart recognition after natural end: ${(error as any).message}`)
					);
				}
			}
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
		console.log('[NativeEngine] start() called, current state:', this.state);

		if (this.state === 'listening') {
			const error = 'Engine is already listening';
			console.error('[NativeEngine]', error);
			throw new Error(error);
		}

		this.stream = stream;
		console.log('[NativeEngine] Audio stream acquired');

		// Apply configuration overrides
		if (config?.language) {
			this.recognition.lang = config.language;
			console.log('[NativeEngine] Language configured:', config.language);
		}
		if (config?.continuous !== undefined) {
			this.recognition.continuous = config.continuous;
			console.log('[NativeEngine] Continuous mode:', config.continuous);
		}
		if (config?.interimResults !== undefined) {
			this.recognition.interimResults = config.interimResults;
			console.log('[NativeEngine] Interim results:', config.interimResults);
		}

		// Start recognition
		try {
			console.log('[NativeEngine] Calling recognition.start()');
			this.recognition.start();
			this.setState('listening');
			console.log('[NativeEngine] Recognition started successfully');
		} catch (error) {
			console.warn('[NativeEngine] recognition.start() threw error:', error);
			// Handle case where recognition is already running
			// (user clicked start multiple times quickly)
			if ((error as any).message?.includes('already started')) {
				console.log('[NativeEngine] Recognition already started, aborting and restarting');
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
		console.log('[NativeEngine] stop() called, current state:', this.state);

		if (this.state === 'idle') {
			console.log('[NativeEngine] Already idle, nothing to stop');
			return;
		}

		try {
			// Set flag to indicate we're explicitly stopping
			// This prevents onend handler from restarting recognition
			this.isStopping = true;
			console.log('[NativeEngine] isStopping flag set to true');

			// Tell recognition to stop accepting audio
			console.log('[NativeEngine] Calling recognition.stop()');
			this.recognition.stop();
		} catch (error) {
			console.warn('[NativeEngine] Error stopping recognition:', error);
		}

		// Release the audio stream and stop all tracks
		if (this.stream) {
			console.log('[NativeEngine] Stopping audio tracks');
			this.stream.getTracks().forEach((track) => {
				console.log(`[NativeEngine] Stopping track: ${track.kind} (${track.readyState})`);
				track.stop();
			});
			this.stream = null;
		}

		console.log('[NativeEngine] stop() complete');
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
				'pt-BR',
				// Note: Actual support depends on browser and OS
				// Full list available at: https://www.w3.org/TR/speech-api/
			],
		};
	}
}
