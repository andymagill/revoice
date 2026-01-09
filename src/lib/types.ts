/**
 * Core TypeScript interfaces and types for ReVoice
 * 
 * This module defines the contract for all transcription engines and
 * the data structures used throughout the application.
 */

/**
 * Result returned from a transcription engine
 * 
 * @interface TranscriptionResult
 * @property {string} text - The transcribed text content
 * @property {boolean} isFinal - Whether this is final (won't change) or interim (might change)
 * @property {number} [confidence] - Optional confidence score (0-1)
 */
export interface TranscriptionResult {
	text: string;
	isFinal: boolean;
	confidence?: number;
}

/**
 * Configuration options for a transcription engine
 * 
 * @interface EngineConfig
 * @property {string} [language] - Language code (e.g., 'en-US', 'fr-FR')
 * @property {boolean} [continuous] - Whether to recognize continuously or stop after silence
 * @property {boolean} [interimResults] - Whether to return interim results while speaking
 */
export interface EngineConfig {
	language?: string;
	continuous?: boolean;
	interimResults?: boolean;
}

/**
 * Standard interface that all transcription engines must implement
 * 
 * This interface enables pluggable transcription backends. New engines can be
 * added by creating a class that extends TranscriptionEngine (base.ts) and
 * implements these methods. The UI layer remains unchanged.
 * 
 * @interface ITranscriptionEngine
 * 
 * @example
 * // Implementing a new engine
 * class DeepgramEngine extends TranscriptionEngine {
 *   async start(stream, config) { ... }
 *   async stop() { ... }
 *   getState() { ... }
 *   onResult(callback) { ... }
 *   onError(callback) { ... }
 *   getMetadata() { ... }
 * }
 */
export interface ITranscriptionEngine {
	/**
	 * Start transcription with the given audio stream
	 * 
	 * @param stream - The MediaStream to transcribe (from getUserMedia)
	 * @param config - Optional engine-specific configuration
	 * @throws Error if engine is already running or stream is invalid
	 */
	start(stream: MediaStream, config?: EngineConfig): Promise<void>;

	/**
	 * Stop transcription and clean up resources
	 * 
	 * Should stop listening, abort any pending operations, and release
	 * the audio stream. Safe to call even if not started.
	 */
	stop(): Promise<void>;

	/**
	 * Get the current state of the engine
	 * 
	 * @returns 'idle' - Not running
	 * @returns 'listening' - Waiting for audio input
	 * @returns 'processing' - Processing audio (final results pending)
	 */
	getState(): 'idle' | 'listening' | 'processing';

	/**
	 * Subscribe to transcription results
	 * 
	 * Calls callback whenever a transcription result is available.
	 * Results may be interim (mid-sentence) or final (speaker paused).
	 * 
	 * @param callback - Called with each transcription result
	 * @returns Unsubscribe function to remove listener
	 * 
	 * @example
	 * const unsubscribe = engine.onResult((result) => {
	 *   console.log(result.text, result.isFinal);
	 * });
	 * // Later...
	 * unsubscribe();
	 */
	onResult(callback: (result: TranscriptionResult) => void): () => void;

	/**
	 * Subscribe to transcription errors
	 * 
	 * Calls callback if the engine encounters an error during
	 * recognition (e.g., no speech detected, service error).
	 * 
	 * @param callback - Called with error details
	 * @returns Unsubscribe function to remove listener
	 */
	onError(callback: (error: Error) => void): () => void;

	/**
	 * Get metadata about the engine
	 * 
	 * Returns information like name, version, type, and supported languages.
	 * Useful for UI display and debugging.
	 */
	getMetadata(): EngineMetadata;
}

/**
 * Metadata describing a transcription engine
 * 
 * @interface EngineMetadata
 * @property {string} name - Human-readable engine name (e.g., "Web Speech API")
 * @property {string} version - Semantic version of the engine implementation
 * @property {'native' | 'api' | 'ml'} type - Category: native browser API, cloud API, or ML model
 * @property {string[]} [supportedLanguages] - Optional list of supported language codes
 */
export interface EngineMetadata {
	name: string;
	version: string;
	type: 'native' | 'api' | 'ml';
	supportedLanguages?: string[];
}

/**
 * Database record for a recording session
 * 
 * A session represents a single recording/transcription session with metadata
 * about when it was recorded, its duration, and which engine was used.
 * 
 * @interface Session
 * @property {number} [id] - Auto-increment primary key (auto-generated)
 * @property {number} timestamp - Unix timestamp (ms) when session was created
 * @property {number} duration - Total recording duration in milliseconds
 * @property {string} title - Human-readable session title (e.g., "Meeting Notes")
 * @property {string} mimeType - Audio MIME type (e.g., "audio/webm;codecs=opus")
 * @property {string} engineType - Transcription engine used (e.g., "native")
 * @property {number} [transcriptLength] - Optional: total transcript character count
 */
export interface Session {
	id?: number;
	timestamp: number;
	duration: number;
	title: string;
	mimeType: string;
	engineType: string;
	transcriptLength?: number;
}

/**
 * Database record for audio data
 * 
 * Stores the actual binary audio blob for a session in IndexedDB.
 * Separated from Session for storage efficiency.
 * 
 * @interface AudioData
 * @property {number} [id] - Auto-increment primary key (auto-generated)
 * @property {number} sessionId - Foreign key to Session.id
 * @property {Blob} blob - The audio data (binary format depends on MIME type)
 * @property {number} uploadedAt - Unix timestamp (ms) when audio was stored
 */
export interface AudioData {
	id?: number;
	sessionId: number;
	blob: Blob;
	uploadedAt: number;
}

/**
 * Database record for a transcript segment
 * 
 * Stores individual text segments from transcription. Multiple segments
 * per session allow reconstruction of full transcript with timing.
 * 
 * @interface Transcript
 * @property {number} [id] - Auto-increment primary key (auto-generated)
 * @property {number} sessionId - Foreign key to Session.id
 * @property {string} text - The transcribed text for this segment
 * @property {number} time - Timestamp (ms from start of session) when this was spoken
 * @property {boolean} isFinal - Whether this segment is final or interim
 */
export interface Transcript {
	id?: number;
	sessionId: number;
	text: string;
	time: number;
	isFinal: boolean;
}

/**
 * Audio format configuration for recording
 * 
 * Encapsulates browser-specific audio format information including
 * MIME type and codec details.
 * 
 * @interface AudioFormat
 * @property {string} mimeType - Full MIME type string (e.g., "audio/webm;codecs=opus")
 * @property {string[]} [codecs] - Optional list of codec names used
 * 
 * @example
 * const format = getSupportedAudioFormat();
 * // Chrome: { mimeType: 'audio/webm;codecs=opus', codecs: ['opus'] }
 * // Safari: { mimeType: 'audio/mp4', codecs: [] }
 */
export interface AudioFormat {
	mimeType: string;
	codecs?: string[];
}
