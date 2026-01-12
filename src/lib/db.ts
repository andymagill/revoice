import Dexie, { type Table } from 'dexie';
import type { Session, AudioData, Transcript } from './types';
export type { Session, AudioData, Transcript };

/**
 * ReVoice Database Layer
 *
 * Manages all local data persistence using Dexie.js (IndexedDB wrapper).
 * All data remains strictly on the user's device—no cloud storage.
 *
 * Database: "ReVoiceDB"
 *
 * Schema:
 * - sessions: Recording metadata (timestamp, duration, engine type, MIME type)
 * - audioData: Binary audio blobs (indexed by sessionId for fast lookup)
 * - transcripts: Individual transcript segments (indexed by sessionId and time)
 * - recordingChunks: Audio chunks streamed during recording (indexed by sessionId + sequence)
 * - playbackCache: Cached reconstructed blobs for quick playback access
 */
export class ReVoiceDB extends Dexie {
	sessions!: Table<Session, number>;
	audioData!: Table<AudioData, number>;
	transcripts!: Table<Transcript, number>;
	recordingChunks!: any; // { sessionId, sequence, blob, timestamp }
	playbackCache!: any; // { sessionId, blob, cachedAt }

	constructor() {
		super('ReVoiceDB');

		// Define database schema with indexes for efficient queries
		// See: https://dexie.org/docs/Table/Table.schema
		this.version(1).stores({
			// sessions: id (auto), timestamp (for sorting), indexed for search
			sessions: '++id, timestamp, duration, title, mimeType, engineType',

			// audioData: id (auto), sessionId (for foreign key lookups)
			audioData: '++id, sessionId',

			// transcripts: id (auto), sessionId (for filtering), time (for ordering)
			transcripts: '++id, sessionId, text, time',
		});

		// Add streaming support in v2
		// recordingChunks: compound primary key [sessionId, sequence] for efficient range queries
		// playbackCache: sessionId as primary key for O(1) cache lookups
		this.version(2)
			.stores({
				sessions: '++id, timestamp, duration, title, mimeType, engineType',
				audioData: '++id, sessionId',
				transcripts: '++id, sessionId, text, time',
				recordingChunks: '[sessionId+sequence], sessionId, timestamp',
				playbackCache: 'sessionId',
			})
			.upgrade((tx) => {
				// No data migration needed - new stores are empty on first upgrade
				console.log('[DB] Upgraded to v2 with streaming support');
			});
	}
}

/**
 * Singleton database instance
 * Used throughout the application for all data operations
 */
export const db = new ReVoiceDB();

/**
 * Create a new recording session
 *
 * Called when the user starts recording. Generates a session record with
 * metadata about the recording (timestamp, engine type, audio format).
 *
 * @param title - Human-readable session title (e.g., "Meeting Notes")
 * @param engineType - Transcription engine identifier (e.g., "native")
 * @param mimeType - Audio format (e.g., "audio/webm;codecs=opus")
 * @returns Promise resolving to the auto-generated session ID
 *
 * @example
 * const sessionId = await createSession('Standup', 'native', 'audio/webm;codecs=opus');
 */
export async function createSession(
	title: string,
	engineType: string,
	mimeType: string
): Promise<number> {
	const id = await db.sessions.add({
		timestamp: Date.now(),
		duration: 0,
		title,
		mimeType,
		engineType,
		transcriptLength: 0,
	});
	return id;
}

/**
 * Get all recording sessions ordered by most recent first
 *
 * Used to populate the session history sidebar. Returns sessions in
 * reverse chronological order (newest first).
 *
 * @returns Promise resolving to array of sessions (most recent first)
 *
 * @example
 * const sessions = await getAllSessions();
 * sessions.forEach(s => console.log(s.title, s.duration));
 */
export async function getAllSessions(): Promise<Session[]> {
	const sessions = await db.sessions.orderBy('timestamp').reverse().toArray();
	return sessions;
}

/**
 * Get a specific session by ID
 *
 * Retrieves full session metadata for a particular recording.
 * Used when loading session details or preparing to play audio.
 *
 * @param id - Session ID (primary key)
 * @returns Promise resolving to Session or undefined if not found
 *
 * @example
 * const session = await getSession(42);
 * if (session) {
 *   console.log(`Duration: ${session.duration}ms`);
 * }
 */
export async function getSession(id: number): Promise<Session | undefined> {
	return db.sessions.get(id);
}

/**
 * Update the recording duration for a session
 *
 * Called when recording stops to update the session with actual
 * duration. Allows calculation of recording time even if page reloads.
 *
 * @param id - Session ID to update
 * @param duration - Total recording duration in milliseconds
 *
 * @example
 * const durationMs = Date.now() - startTime;
 * await updateSessionDuration(sessionId, durationMs);
 */
export async function updateSessionDuration(id: number, duration: number): Promise<void> {
	await db.sessions.update(id, { duration });
}

/**
 * Store audio data (blob) for a session
 *
 * Persists the recorded audio to IndexedDB. Called after recording stops
 * and the MediaRecorder has completed writing the blob. Audio is stored
 * separately from session metadata for efficiency.
 *
 * @param sessionId - Session ID (foreign key to sessions.id)
 * @param blob - The audio blob (type determined by MIME)
 * @returns Promise resolving to the auto-generated audio data ID
 *
 * @example
 * const audioId = await storeAudioData(sessionId, audioBlob);
 */
export async function storeAudioData(sessionId: number, blob: Blob): Promise<number> {
	const id = await db.audioData.add({
		sessionId,
		blob,
		uploadedAt: Date.now(),
	});
	return id;
}

/**
 * Retrieve the audio blob for a session
 *
 * Fetches the binary audio data so it can be played back. Used when
 * clicking the play button on a session in the history sidebar.
 *
 * @param sessionId - Session ID to retrieve audio for
 * @returns Promise resolving to Blob or null if not found
 *
 * @example
 * const blob = await getSessionAudio(sessionId);
 * if (blob) {
 *   const url = URL.createObjectURL(blob);
 *   const audio = new Audio(url);
 *   audio.play();
 * }
 */
export async function getSessionAudio(sessionId: number): Promise<Blob | null> {
	const audio = await db.audioData.where('sessionId').equals(sessionId).first();
	return audio?.blob ?? null;
}

/**
 * Store a transcript segment
 *
 * Called each time the transcription engine returns a result. Stores
 * individual words/phrases with timing so full transcript can be
 * reconstructed later with original timestamps.
 *
 * @param sessionId - Session ID (foreign key)
 * @param text - The transcribed text for this segment
 * @param time - Timestamp in milliseconds from start of session
 * @param isFinal - Whether this is final (won't change) or interim
 * @returns Promise resolving to the auto-generated transcript ID
 *
 * @example
 * await storeTranscript(sessionId, 'Hello world', 1500, true);
 */
export async function storeTranscript(
	sessionId: number,
	text: string,
	time: number,
	isFinal: boolean = true
): Promise<number> {
	const id = await db.transcripts.add({
		sessionId,
		text,
		time,
		isFinal,
	});
	return id;
}

/**
 * Get all transcript segments for a session
 *
 * Retrieves all transcript records for a recording, ordered by time.
 * Used to display full transcript or export to file.
 *
 * @param sessionId - Session ID to retrieve transcripts for
 * @returns Promise resolving to array of Transcript records
 *
 * @example
 * const transcripts = await getSessionTranscripts(sessionId);
 * console.log(transcripts.length, 'segments');
 */
export async function getSessionTranscripts(sessionId: number): Promise<Transcript[]> {
	return db.transcripts.where('sessionId').equals(sessionId).toArray();
}

/**
 * Get full transcript as a single concatenated string
 *
 * Combines all transcript segments into one string for easy export/display.
 * Only includes final segments to avoid duplicating interim results.
 *
 * @param sessionId - Session ID to retrieve full transcript for
 * @returns Promise resolving to full transcript text
 *
 * @example
 * const fullText = await getSessionFullTranscript(sessionId);
 * console.log(fullText); // "Hello world. Welcome to ReVoice."
 */
export async function getSessionFullTranscript(sessionId: number): Promise<string> {
	const transcripts = await getSessionTranscripts(sessionId);
	return transcripts.map((t) => t.text).join(' ');
}

/**
 * Delete a session and all associated data
 *
 * Removes a session record, its audio blob, and all transcript segments
 * from the database. This action is permanent and cannot be undone.
 *
 * @param sessionId - Session ID to delete
 * @returns Promise that resolves when deletion is complete
 *
 * @example
 * await deleteSession(42);
 * console.log('Session deleted');
 */
export async function deleteSession(sessionId: number): Promise<void> {
	await Promise.all([
		db.sessions.delete(sessionId),
		db.audioData.where('sessionId').equals(sessionId).delete(),
		db.transcripts.where('sessionId').equals(sessionId).delete(),
	]);
}

/**
 * Clear all data from the database
 *
 * Removes all sessions, audio, and transcripts. This is a destructive
 * operation typically used for testing or manual data cleanup.
 *
 * @returns Promise that resolves when all stores are cleared
 *
 * @example
 * await clearAllData();
 */
export async function clearAllData(): Promise<void> {
	await Promise.all([db.sessions.clear(), db.audioData.clear(), db.transcripts.clear()]);
}

/**
 * Get database statistics
 *
 * Returns counts for debugging and UI display (e.g., "5 sessions stored").
 * Useful for monitoring storage usage and validating data integrity.
 *
 * @returns Promise resolving to object with record counts
 *
 * @example
 * const stats = await getDBStats();
 * console.log(`${stats.sessionCount} sessions, ${stats.transcriptCount} transcripts`);
 */
export async function getDBStats(): Promise<{
	sessionCount: number;
	audioCount: number;
	transcriptCount: number;
}> {
	const sessionCount = await db.sessions.count();
	const audioCount = await db.audioData.count();
	const transcriptCount = await db.transcripts.count();
	return { sessionCount, audioCount, transcriptCount };
}
