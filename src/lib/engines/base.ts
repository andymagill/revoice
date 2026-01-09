/**
 * Abstract Base Class for Transcription Engines
 * 
 * All transcription engines must extend this class to implement the
 * ITranscriptionEngine interface. This base class provides:
 * 
 * - Event management (onResult, onError subscriptions)
 * - State management (idle, listening, processing)
 * - Callback emission utilities
 * 
 * Concrete implementations should:
 * 1. Initialize their specific transcription service in constructor
 * 2. Implement start() to begin transcription
 * 3. Implement stop() to clean up resources
 * 4. Call emitResult() when transcription results arrive
 * 5. Call emitError() if errors occur
 * 6. Implement getMetadata() for engine identification
 * 
 * @example
 * class MyEngine extends TranscriptionEngine {
 *   async start(stream, config) {
 *     // Initialize transcription service
 *   }
 *   
 *   private onTranscription(text, isFinal) {
 *     this.emitResult({ text, isFinal });
 *   }
 * }
 */

import type { ITranscriptionEngine, TranscriptionResult, EngineConfig, EngineMetadata } from '../types';

export abstract class TranscriptionEngine implements ITranscriptionEngine {
	/**
	 * Current engine state: 'idle' | 'listening' | 'processing'
	 * @protected
	 */
	protected state: 'idle' | 'listening' | 'processing' = 'idle';

	/**
	 * Set of callbacks subscribed to transcription results
	 * @protected
	 */
	protected resultCallbacks: Set<(result: TranscriptionResult) => void> = new Set();

	/**
	 * Set of callbacks subscribed to errors
	 * @protected
	 */
	protected errorCallbacks: Set<(error: Error) => void> = new Set();

	/**
	 * Current engine configuration (language, continuous mode, etc.)
	 * @protected
	 */
	protected config: EngineConfig = {};

	/**
	 * Abstract method: Start transcription
	 * Must be implemented by subclasses to begin listening to the audio stream
	 */
	abstract start(stream: MediaStream, config?: EngineConfig): Promise<void>;

	/**
	 * Abstract method: Stop transcription
	 * Must be implemented by subclasses to clean up and release resources
	 */
	abstract stop(): Promise<void>;

	/**
	 * Abstract method: Get engine metadata
	 * Must be implemented by subclasses to provide engine identification
	 */
	abstract getMetadata(): EngineMetadata;

	/**
	 * Get the current engine state
	 * 
	 * @returns Current state: 'idle', 'listening', or 'processing'
	 */
	getState(): 'idle' | 'listening' | 'processing' {
		return this.state;
	}

	/**
	 * Protected helper to update engine state
	 * Called by subclasses when state changes
	 * 
	 * @protected
	 * @param state - New state value
	 */
	protected setState(state: 'idle' | 'listening' | 'processing'): void {
		this.state = state;
	}

	/**
	 * Subscribe to transcription results
	 * 
	 * Callback will be called each time transcription returns a result.
	 * Results may be interim (mid-word) or final (speaker paused).
	 * 
	 * @param callback - Function to call with each result
	 * @returns Unsubscribe function that removes the listener
	 * 
	 * @example
	 * const unsub = engine.onResult(result => {
	 *   console.log(result.text);
	 * });
	 * // Later...
	 * unsub();
	 */
	onResult(callback: (result: TranscriptionResult) => void): () => void {
		this.resultCallbacks.add(callback);
		// Return unsubscribe function
		return () => {
			this.resultCallbacks.delete(callback);
		};
	}

	/**
	 * Subscribe to transcription errors
	 * 
	 * Callback will be called if the engine encounters an error (e.g.,
	 * "no speech detected", "service unavailable", network errors).
	 * 
	 * @param callback - Function to call with error details
	 * @returns Unsubscribe function that removes the listener
	 * 
	 * @example
	 * engine.onError(error => {
	 *   console.error('Transcription failed:', error.message);
	 * });
	 */
	onError(callback: (error: Error) => void): () => void {
		this.errorCallbacks.add(callback);
		// Return unsubscribe function
		return () => {
			this.errorCallbacks.delete(callback);
		};
	}

	/**
	 * Protected helper to emit a transcription result to all subscribers
	 * Called by subclasses when transcription completes
	 * 
	 * @protected
	 * @param result - The transcription result to emit
	 */
	protected emitResult(result: TranscriptionResult): void {
		for (const callback of this.resultCallbacks) {
			callback(result);
		}
	}

	/**
	 * Protected helper to emit an error to all subscribers
	 * Called by subclasses when an error occurs
	 * 
	 * @protected
	 * @param error - The error to emit
	 */
	protected emitError(error: Error): void {
		for (const callback of this.errorCallbacks) {
			callback(error);
		}
	}
}
