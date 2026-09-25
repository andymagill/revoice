/**
 * Abstract base class for transcription engines.
 *
 * Owns the parts every engine shares — subscriber sets, the state machine and safe
 * emission — so a concrete engine only implements `start`, `stop` and `getMetadata`
 * and calls `emitResult` / `emitError` / `setState` as its backend reports progress.
 *
 * @example
 * class MyEngine extends TranscriptionEngine {
 *   async start(stream, config) {
 *     this.setState('connecting');
 *     // ...open the backend, then on first audio: this.setState('listening')
 *   }
 *   private onTranscript(text: string, isFinal: boolean) {
 *     this.emitResult({ text, isFinal });
 *   }
 * }
 */

import type {
	EngineConfig,
	EngineMetadata,
	EngineState,
	ITranscriptionEngine,
	TranscriptionResult,
} from '../types';

export abstract class TranscriptionEngine implements ITranscriptionEngine {
	protected state: EngineState = 'idle';
	protected resultCallbacks = new Set<(result: TranscriptionResult) => void>();
	protected errorCallbacks = new Set<(error: Error) => void>();
	protected stateChangeCallbacks = new Set<(state: EngineState) => void>();

	/** Begin transcribing. Engines that capture audio themselves may ignore `stream`. */
	abstract start(stream: MediaStream, config?: EngineConfig): Promise<void>;

	/** Stop transcribing. Must be safe to call when idle and resolve once the engine is idle. */
	abstract stop(): Promise<void>;

	abstract getMetadata(): EngineMetadata;

	getState(): EngineState {
		return this.state;
	}

	/**
	 * Move to a new state and notify subscribers. No-op when the state is unchanged, so
	 * subclasses can call it unconditionally.
	 */
	protected setState(state: EngineState): void {
		if (this.state === state) return;
		console.log(`[TranscriptionEngine] State transition: ${this.state} → ${state}`);
		this.state = state;
		this.emit(this.stateChangeCallbacks, state);
	}

	/**
	 * Subscribe to transcription results (interim and final).
	 * @returns Unsubscribe function.
	 */
	onResult(callback: (result: TranscriptionResult) => void): () => void {
		this.resultCallbacks.add(callback);
		return () => this.resultCallbacks.delete(callback);
	}

	/**
	 * Subscribe to engine errors (e.g. permission denied, network failure).
	 * @returns Unsubscribe function.
	 */
	onError(callback: (error: Error) => void): () => void {
		this.errorCallbacks.add(callback);
		return () => this.errorCallbacks.delete(callback);
	}

	/**
	 * Subscribe to state changes (idle ↔ connecting ↔ listening).
	 * @returns Unsubscribe function.
	 */
	onStateChange(callback: (state: EngineState) => void): () => void {
		this.stateChangeCallbacks.add(callback);
		return () => this.stateChangeCallbacks.delete(callback);
	}

	protected emitResult(result: TranscriptionResult): void {
		this.emit(this.resultCallbacks, result);
	}

	protected emitError(error: Error): void {
		this.emit(this.errorCallbacks, error);
	}

	/**
	 * Deliver a value to every subscriber, isolating failures: one throwing listener must
	 * not stop the others from seeing the event or break the engine's own event handler.
	 */
	private emit<T>(callbacks: Set<(value: T) => void>, value: T): void {
		for (const callback of [...callbacks]) {
			try {
				callback(value);
			} catch (error) {
				console.error('[TranscriptionEngine] Subscriber threw:', error);
			}
		}
	}
}
