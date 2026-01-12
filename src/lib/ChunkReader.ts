/**
 * ChunkReader - Audio Reconstruction from IndexedDB Chunks
 *
 * Reconstructs complete audio blobs from chunks stored in IndexedDB.
 * Handles caching to avoid repeated reconstructions on subsequent plays.
 *
 * **Strategy:**
 * - Read all chunks for a session in sequence order
 * - Concatenate into single blob
 * - Cache in playbackCache for quick access on subsequent plays
 */

import type { ReVoiceDB } from './db';

interface CachedBlob {
	sessionId: number;
	blob: Blob;
	cachedAt: number;
}

export class ChunkReader {
	/**
	 * Reconstruct a complete audio blob from chunks
	 *
	 * Reads all recordingChunks for a session, concatenates them in order,
	 * and caches the result for quick playback on subsequent calls.
	 *
	 * **Performance:**
	 * - First call: ~50-200ms for typical 5min recording (depends on disk I/O)
	 * - Subsequent calls: <1ms (served from playbackCache)
	 *
	 * @param sessionId - The session ID to reconstruct audio for
	 * @param db - The database instance
	 * @returns Promise resolving to the reconstructed audio blob
	 *
	 * @example
	 * const blob = await ChunkReader.reconstruct(123, db);
	 * const url = URL.createObjectURL(blob);
	 * audio.src = url;
	 */
	static async reconstruct(sessionId: number, db: ReVoiceDB): Promise<Blob> {
		try {
			// Check if blob is already cached
			const cached = await (db.playbackCache as any).get(sessionId);
			if (cached) {
				return cached.blob;
			}

			// Fetch all chunks for this session in order
			const chunks = await (db.recordingChunks as any)
				.where('sessionId')
				.equals(sessionId)
				.sortBy('sequence');

			if (chunks.length === 0) {
				throw new Error(`No chunks found for session ${sessionId}`);
			}

			// Extract blobs from chunks
			const blobs = chunks.map((chunk: any) => chunk.blob);

			// Concatenate chunks into single blob
			const reconstructedBlob = new Blob(blobs, {
				type: 'audio/webm;codecs=opus',
			});

			// Cache the reconstructed blob
			await (db.playbackCache as any).put({
				sessionId,
				blob: reconstructedBlob,
				cachedAt: Date.now(),
			} as CachedBlob);

			return reconstructedBlob;
		} catch (error) {
			console.error(`[ChunkReader] Failed to reconstruct audio for session ${sessionId}:`, error);
			throw error;
		}
	}

	/**
	 * Stream chunks on-demand (advanced use case)
	 *
	 * Allows processing chunks one at a time without reconstructing the
	 * entire blob. Useful for streaming playback or analysis.
	 *
	 * @param sessionId - The session ID to stream chunks from
	 * @param db - The database instance
	 * @param callback - Called for each chunk in sequence order
	 * @returns Promise that resolves when all chunks have been processed
	 *
	 * @example
	 * await ChunkReader.streamChunks(123, db, (chunk) => {
	 *   console.log(`Chunk ${chunk.sequence}: ${chunk.blob.size} bytes`);
	 * });
	 */
	static async streamChunks(
		sessionId: number,
		db: ReVoiceDB,
		callback: (chunk: any) => Promise<void> | void
	): Promise<void> {
		try {
			// Fetch all chunks in order
			const chunks = await (db.recordingChunks as any)
				.where('sessionId')
				.equals(sessionId)
				.sortBy('sequence');

			if (chunks.length === 0) {
				throw new Error(`No chunks found for session ${sessionId}`);
			}

			// Process each chunk through callback
			for (const chunk of chunks) {
				await callback(chunk);
			}
		} catch (error) {
			console.error(`[ChunkReader] Failed to stream chunks for session ${sessionId}:`, error);
			throw error;
		}
	}

	/**
	 * Clear cached blob for a session
	 *
	 * Called when session is deleted or cache needs to be invalidated.
	 *
	 * @param sessionId - The session ID to clear cache for
	 * @param db - The database instance
	 * @returns Promise that resolves when cache is cleared
	 */
	static async clearCache(sessionId: number, db: ReVoiceDB): Promise<void> {
		try {
			await (db.playbackCache as any).delete(sessionId);
		} catch (error) {
			console.error(`[ChunkReader] Failed to clear cache for session ${sessionId}:`, error);
			// Non-fatal: cache miss is acceptable
		}
	}

	/**
	 * Estimate the size of reconstructed blob
	 *
	 * Sums the size of all chunks without reconstructing the blob.
	 * Useful for UI feedback (e.g., "Loading 5MB audio...").
	 *
	 * @param sessionId - The session ID to estimate size for
	 * @param db - The database instance
	 * @returns Promise resolving to estimated size in bytes
	 */
	static async estimateSize(sessionId: number, db: ReVoiceDB): Promise<number> {
		try {
			const chunks = await (db.recordingChunks as any)
				.where('sessionId')
				.equals(sessionId)
				.toArray();

			return chunks.reduce((total: number, chunk: any) => total + chunk.blob.size, 0);
		} catch (error) {
			console.error(`[ChunkReader] Failed to estimate size for session ${sessionId}:`, error);
			return 0;
		}
	}
}
