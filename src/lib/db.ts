import Dexie, { type Table } from 'dexie';
import type { Session, AudioData, Transcript } from './types';
export type { Session, AudioData, Transcript };

/**
 * ReVoice database layer.
 *
 * All persistence goes through Dexie (an IndexedDB wrapper). Data stays on the user's
 * device; the app never uploads recordings or transcripts.
 *
 * Database: "ReVoiceDB"
 *
 * Tables:
 * - sessions: recording metadata (timestamp, duration, title, engine, MIME type)
 * - audioData: at most ONE audio blob per session (see `storeAudioData`)
 * - transcripts: final transcript segments, indexed by session and time
 */
export class ReVoiceDB extends Dexie {
	sessions!: Table<Session, number>;
	audioData!: Table<AudioData, number>;
	transcripts!: Table<Transcript, number>;

	constructor() {
		super('ReVoiceDB');

		// Dexie keeps every historical version so it can upgrade databases created by any
		// older release. Never edit a released version; add a new one.
		this.version(1).stores({
			sessions: '++id, timestamp, duration, title, mimeType, engineType',
			audioData: '++id, sessionId',
			transcripts: '++id, sessionId, text, time',
		});

		// v2 added streaming tables (recordingChunks, playbackCache) that were never used;
		// v3 removes them again.
		this.version(2).stores({
			sessions: '++id, timestamp, duration, title, mimeType, engineType',
			audioData: '++id, sessionId',
			transcripts: '++id, sessionId, text, time',
			recordingChunks: '[sessionId+sequence], sessionId, timestamp',
			playbackCache: 'sessionId',
		});

		// v3:
		// - drops the unused v2 tables and the never-queried `transcripts.text` index;
		// - repairs `audioData`. Earlier releases appended a new row on every pause while
		//   readers used `.first()` (the OLDEST row), so sessions reloaded with truncated
		//   audio. Keep only the newest row per session, which is the complete recording.
		this.version(3)
			.stores({
				sessions: '++id, timestamp, duration, title, mimeType, engineType',
				audioData: '++id, sessionId',
				transcripts: '++id, sessionId, time',
				recordingChunks: null,
				playbackCache: null,
			})
			.upgrade(async (tx) => {
				const audio = tx.table<AudioData, number>('audioData');
				const newestIdBySession = new Map<number, number>();
				await audio.each((row) => {
					const current = newestIdBySession.get(row.sessionId);
					if (current === undefined || row.id! > current) {
						newestIdBySession.set(row.sessionId, row.id!);
					}
				});
				await audio.filter((row) => newestIdBySession.get(row.sessionId) !== row.id).delete();
			});
	}
}

/** Singleton database instance shared by the whole app. */
export const db = new ReVoiceDB();

/**
 * Create a new recording session.
 *
 * @param title - Human-readable title shown in the sidebar
 * @param engineType - Transcription engine identifier (e.g. "native")
 * @param mimeType - Audio format the session is recorded in
 * @returns The auto-generated session ID
 */
export async function createSession(
	title: string,
	engineType: string,
	mimeType: string
): Promise<number> {
	return db.sessions.add({
		timestamp: Date.now(),
		duration: 0,
		title,
		mimeType,
		engineType,
		transcriptLength: 0,
	});
}

/** All sessions, newest first (drives the history sidebar). */
export async function getAllSessions(): Promise<Session[]> {
	return db.sessions.orderBy('timestamp').reverse().toArray();
}

/** A single session by ID, or `undefined` if it no longer exists. */
export async function getSession(id: number): Promise<Session | undefined> {
	return db.sessions.get(id);
}

/**
 * Persist a session's total recording duration (milliseconds).
 * Called after each save so the duration survives a page reload.
 */
export async function updateSessionDuration(id: number, duration: number): Promise<void> {
	await db.sessions.update(id, { duration });
}

/**
 * Store the audio for a session, replacing any audio already stored for it.
 *
 * Each save is the COMPLETE recording so far (all MediaRecorder chunks concatenated), so
 * this is an upsert: appending a row per save would grow storage on every pause and make
 * readers return a stale, shorter clip. Delete and add run in one transaction so a failed
 * write cannot leave the session without audio.
 *
 * @returns The ID of the stored audio row
 */
export async function storeAudioData(sessionId: number, blob: Blob): Promise<number> {
	return db.transaction('rw', db.audioData, async () => {
		await db.audioData.where('sessionId').equals(sessionId).delete();
		return db.audioData.add({ sessionId, blob, uploadedAt: Date.now() });
	});
}

/** The stored audio blob for a session, or `null` if none has been saved yet. */
export async function getSessionAudio(sessionId: number): Promise<Blob | null> {
	const audio = await db.audioData.where('sessionId').equals(sessionId).first();
	return audio?.blob ?? null;
}

/**
 * Store one transcript segment.
 *
 * @param time - Milliseconds from the start of the session's recording
 * @param isFinal - Only final segments are persisted by the app; kept for completeness
 * @returns The auto-generated transcript ID
 */
export async function storeTranscript(
	sessionId: number,
	text: string,
	time: number,
	isFinal: boolean = true
): Promise<number> {
	return db.transcripts.add({ sessionId, text, time, isFinal });
}

/** All transcript segments for a session, in spoken order. */
export async function getSessionTranscripts(sessionId: number): Promise<Transcript[]> {
	return db.transcripts.where('sessionId').equals(sessionId).sortBy('time');
}

/**
 * Permanently delete a session together with its audio and transcripts.
 * Runs in a single transaction so a failure cannot leave orphaned rows.
 */
export async function deleteSession(sessionId: number): Promise<void> {
	await db.transaction('rw', db.sessions, db.audioData, db.transcripts, async () => {
		await db.sessions.delete(sessionId);
		await db.audioData.where('sessionId').equals(sessionId).delete();
		await db.transcripts.where('sessionId').equals(sessionId).delete();
	});
}

/** Permanently delete every session, audio blob and transcript. */
export async function clearAllData(): Promise<void> {
	await db.transaction('rw', db.sessions, db.audioData, db.transcripts, async () => {
		await Promise.all([db.sessions.clear(), db.audioData.clear(), db.transcripts.clear()]);
	});
}

/**
 * Remove `revoice-backup-*` entries from localStorage.
 *
 * Earlier releases wrote a base64 copy of every recording to localStorage on pause. It
 * was never read back and quickly exhausted the ~5 MB quota, so it was removed; this
 * reclaims the space for users who still have those entries.
 */
export function purgeLegacyBackups(): void {
	try {
		const stale: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith('revoice-backup-')) stale.push(key);
		}
		stale.forEach((key) => localStorage.removeItem(key));
	} catch {
		// localStorage can be unavailable (privacy modes); there is nothing to clean up then.
	}
}
