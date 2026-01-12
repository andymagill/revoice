/**
 * SessionManager - Session Lifecycle and Cleanup
 *
 * Manages session creation, chunk deletion, and storage estimation.
 * Provides convenience methods for session-level operations that might
 * involve multiple database operations.
 */

import type { ReVoiceDB } from './db';
import { ChunkReader } from './ChunkReader';

export class SessionManager {
	/**
	 * Create a new recording session with metadata
	 *
	 * Wrapper around db.sessions.add() that also initializes
	 * related metadata (like zeroing out chunk counts).
	 *
	 * @param title - Human-readable session title
	 * @param engineType - Transcription engine type (e.g., "native")
	 * @param mimeType - Audio MIME type (e.g., "audio/webm;codecs=opus")
	 * @param db - The database instance
	 * @returns Promise resolving to the newly created session ID
	 *
	 * @example
	 * const sessionId = await SessionManager.createSession(
	 *   'Team Standup',
	 *   'native',
	 *   'audio/webm;codecs=opus',
	 *   db
	 * );
	 */
	static async createSession(
		title: string,
		engineType: string,
		mimeType: string,
		db: ReVoiceDB
	): Promise<number> {
		try {
			// Use existing db function for consistency
			const sessionId = await db.sessions.add({
				timestamp: Date.now(),
				duration: 0,
				title,
				mimeType,
				engineType,
				transcriptLength: 0,
			});
			return sessionId;
		} catch (error) {
			console.error('[SessionManager] Failed to create session:', error);
			throw error;
		}
	}

	/**
	 * Delete all chunks for a session
	 *
	 * Called when user clears a recording or deletes a session.
	 * Removes all recordingChunks associated with the session ID.
	 *
	 * @param sessionId - The session ID to clear chunks for
	 * @param db - The database instance
	 * @returns Promise that resolves when all chunks are deleted
	 *
	 * @example
	 * await SessionManager.clearSessionChunks(123, db);
	 */
	static async clearSessionChunks(sessionId: number, db: ReVoiceDB): Promise<void> {
		try {
			// Delete all chunks for this session
			const chunks = await (db.recordingChunks as any)
				.where('sessionId')
				.equals(sessionId)
				.delete();

			console.log(`[SessionManager] Deleted ${chunks} chunks for session ${sessionId}`);

			// Clear playback cache entry
			await ChunkReader.clearCache(sessionId, db);
		} catch (error) {
			console.error(`[SessionManager] Failed to clear chunks for session ${sessionId}:`, error);
			throw error;
		}
	}

	/**
	 * Estimate total storage used by a session's chunks
	 *
	 * Useful for:
	 * - Showing storage used in UI
	 * - Deciding when to suggest cleanup
	 * - Checking against storage quota
	 *
	 * @param sessionId - The session ID to estimate storage for
	 * @param db - The database instance
	 * @returns Promise resolving to size in bytes
	 *
	 * @example
	 * const bytes = await SessionManager.getSessionSize(123, db);
	 * console.log(`Session uses ${(bytes / 1024 / 1024).toFixed(2)} MB`);
	 */
	static async getSessionSize(sessionId: number, db: ReVoiceDB): Promise<number> {
		try {
			return await ChunkReader.estimateSize(sessionId, db);
		} catch (error) {
			console.error(`[SessionManager] Failed to estimate size for session ${sessionId}:`, error);
			return 0;
		}
	}

	/**
	 * Get total storage used by all sessions
	 *
	 * Useful for showing total storage quota usage.
	 *
	 * @param db - The database instance
	 * @returns Promise resolving to total size in bytes
	 */
	static async getTotalStorageSize(db: ReVoiceDB): Promise<number> {
		try {
			const allChunks = await (db.recordingChunks as any).toArray();
			return allChunks.reduce((total: number, chunk: any) => total + chunk.blob.size, 0);
		} catch (error) {
			console.error('[SessionManager] Failed to estimate total storage:', error);
			return 0;
		}
	}

	/**
	 * Get chunk count for a session
	 *
	 * Useful for debugging and understanding session structure.
	 *
	 * @param sessionId - The session ID to count chunks for
	 * @param db - The database instance
	 * @returns Promise resolving to number of chunks
	 */
	static async getChunkCount(sessionId: number, db: ReVoiceDB): Promise<number> {
		try {
			const count = await (db.recordingChunks as any).where('sessionId').equals(sessionId).count();
			return count;
		} catch (error) {
			console.error(`[SessionManager] Failed to count chunks for session ${sessionId}:`, error);
			return 0;
		}
	}

	/**
	 * Delete a complete session (metadata + chunks)
	 *
	 * Removes session record and all associated chunks and cache.
	 * Called when user confirms session deletion.
	 *
	 * @param sessionId - The session ID to delete
	 * @param db - The database instance
	 * @returns Promise that resolves when session is fully deleted
	 */
	static async deleteSession(sessionId: number, db: ReVoiceDB): Promise<void> {
		try {
			// Clear all associated data
			await SessionManager.clearSessionChunks(sessionId, db);

			// Delete session metadata
			await db.sessions.delete(sessionId);

			// Note: audioData and transcripts are left untouched
			// They can be cleaned up separately if needed

			console.log(`[SessionManager] Deleted session ${sessionId}`);
		} catch (error) {
			console.error(`[SessionManager] Failed to delete session ${sessionId}:`, error);
			throw error;
		}
	}
}
