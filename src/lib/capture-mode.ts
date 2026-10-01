/**
 * What a recording captures, and the user's remembered choice on devices where it matters.
 *
 * On Android, Chrome runs speech recognition in the system speech service, which cannot
 * share the microphone with the page's own capture (getUserMedia/MediaRecorder): with both
 * running, recognition hears silence and keeps restarting. So on Android the user picks
 * one of the two; everywhere else both run together.
 *
 * - `both`: record audio and transcribe (desktop browsers)
 * - `audio`: record audio only (no live transcript)
 * - `transcript`: transcribe only; the page never opens the microphone, so nothing is saved
 */

import { isAndroid } from './compat';

export type CaptureMode = 'both' | 'audio' | 'transcript';

const STORAGE_KEY = 'revoiceCaptureMode';

/** Whether the user has to choose between audio and transcript on this device. */
export function needsCaptureChoice(speechAvailable: boolean): boolean {
	return speechAvailable && isAndroid();
}

/**
 * The mode to start in: the remembered choice on devices that need one (Transcribe the
 * first time), otherwise `both`. Reading storage can throw, which just means no memory.
 */
export function loadCaptureMode(speechAvailable: boolean): CaptureMode {
	if (!needsCaptureChoice(speechAvailable)) return 'both';
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'audio' || saved === 'transcript') return saved;
	} catch {
		// Storage blocked: fall through to the default.
	}
	return 'transcript';
}

export function saveCaptureMode(mode: CaptureMode): void {
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch {
		// Not remembering the choice is harmless.
	}
}
