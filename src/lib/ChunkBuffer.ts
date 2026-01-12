/**
 * ChunkBuffer - Audio Chunk Accumulation and Batch Writing
 *
 * Accumulates audio chunks in memory and periodically writes them to IndexedDB.
 * This prevents memory bloat from large audio recordings while maintaining
 * reasonable write performance.
 *
 * **Strategy:**
 * - Buffer chunks in memory until 500ms has elapsed OR 10 chunks accumulated
 * - Whichever condition triggers first, write batch to IndexedDB
 * - This keeps memory footprint low while minimizing transaction overhead
 */

import type { ReVoiceDB } from './db';

interface StoredChunk {
	sessionId: number;
	sequence: number;
	blob: Blob;
	timestamp: number;
}

export class ChunkBuffer {
	private chunks: Blob[] = [];
	private sessionId: number;
	private sequence: number = 0;
	private db: ReVoiceDB;
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly FLUSH_INTERVAL = 500; // milliseconds
	private readonly FLUSH_COUNT = 10; // chunks
	private totalMemoryBytes = 0;

	/**
	 * Initialize a new ChunkBuffer for a recording session
	 *
	 * @param sessionId - The session ID to associate chunks with
	 * @param db - The database instance for writing chunks
	 */
	constructor(sessionId: number, db: ReVoiceDB) {
		this.sessionId = sessionId;
		this.db = db;
	}

	/**
	 * Add a chunk to the buffer
	 *
	 * Accumulates the chunk in memory and schedules a flush if needed.
	 * Safe to call frequently from MediaRecorder's dataavailable event.
	 *
	 * @param chunk - The audio blob chunk to add
	 * @returns Promise that resolves when the chunk is added (not necessarily flushed)
	 */
	async addChunk(chunk: Blob): Promise<void> {
		this.chunks.push(chunk);
		this.totalMemoryBytes += chunk.size;

		// Start timer on first chunk if not already running
		if (this.flushTimer === null) {
			this.flushTimer = setTimeout(() => {
				this.flush();
			}, this.FLUSH_INTERVAL);
		}

		// Flush if buffer reaches threshold
		if (this.chunks.length >= this.FLUSH_COUNT) {
			if (this.flushTimer !== null) {
				clearTimeout(this.flushTimer);
				this.flushTimer = null;
			}
			await this.flush();
		}
	}

	/**
	 * Write all buffered chunks to IndexedDB
	 *
	 * Performs a batch write of all accumulated chunks and clears the buffer.
	 * Called automatically by addChunk or manually via flush().
	 *
	 * @returns Promise that resolves when all chunks are written
	 */
	async flush(): Promise<void> {
		if (this.chunks.length === 0) {
			return;
		}

		// Clear timer since we're flushing
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		try {
			// Prepare records for batch insert
			const records: StoredChunk[] = this.chunks.map((blob) => ({
				sessionId: this.sessionId,
				sequence: this.sequence++,
				blob,
				timestamp: Date.now(),
			}));

			// Batch write to recordingChunks store
			await (this.db.recordingChunks as any).bulkAdd(records);

			// Clear memory
			this.chunks = [];
			this.totalMemoryBytes = 0;
		} catch (error) {
			console.error('[ChunkBuffer] Failed to flush chunks to IndexedDB:', error);
			// Chunks remain in memory as fallback
			// Application can decide how to handle this (e.g., show warning)
			throw error;
		}
	}

	/**
	 * Get current memory footprint of buffered chunks
	 *
	 * Useful for monitoring memory usage during recording.
	 *
	 * @returns Size in bytes of chunks currently in memory
	 */
	getMemorySize(): number {
		return this.totalMemoryBytes;
	}

	/**
	 * Get count of chunks currently buffered
	 *
	 * @returns Number of chunks waiting to be flushed
	 */
	getChunkCount(): number {
		return this.chunks.length;
	}

	/**
	 * Get the current sequence number
	 *
	 * @returns The sequence of the next chunk that will be written
	 */
	getSequence(): number {
		return this.sequence;
	}

	/**
	 * Clear the buffer without writing to database
	 *
	 * Used when canceling a recording that hasn't been fully flushed.
	 * Note: Already-flushed chunks remain in database.
	 *
	 * @returns Promise that resolves when buffer is cleared
	 */
	async clear(): Promise<void> {
		if (this.flushTimer !== null) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.chunks = [];
		this.totalMemoryBytes = 0;
	}

	/**
	 * Ensure all chunks are written before cleanup
	 *
	 * Called when recording is complete. Flushes any remaining chunks
	 * and ensures database write is complete.
	 *
	 * @returns Promise that resolves when all chunks are persisted
	 */
	async finalize(): Promise<void> {
		await this.flush();
	}
}
