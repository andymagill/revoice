/**
 * Typed wrappers around Svelte context for the app's three shared services.
 *
 * Centralising the keys and payload types here means providers and consumers cannot
 * drift apart (previously each component re-declared the shape inline).
 *
 * `setX` must be called during component initialisation, and `getX` from a descendant's
 * initialisation — the usual Svelte context rules.
 */

import { getContext, setContext } from 'svelte';
import type { SessionStore } from './sessions.svelte';
import type { ITranscriptionEngine } from './types';

const ENGINE_KEY = 'transcriptionEngine';
const PLAYBACK_KEY = 'audioPlayback';
const SESSIONS_KEY = 'sessionStore';

/** The active transcription engine, or `null` when the browser has no speech support. */
export function setTranscriptionEngine(engine: ITranscriptionEngine | null): void {
	setContext(ENGINE_KEY, engine);
}

export function getTranscriptionEngine(): ITranscriptionEngine | null {
	return getContext<ITranscriptionEngine | null | undefined>(ENGINE_KEY) ?? null;
}

/**
 * Web Audio graph for the audio element currently being played back.
 * Properties are getters over reactive state in AudioPlaybackProvider, so reading them
 * inside `$derived`/`$effect` tracks changes.
 */
export interface AudioPlaybackContext {
	readonly audio: HTMLAudioElement | null;
	readonly audioContext: AudioContext | null;
	readonly analyser: AnalyserNode | null;
}

export function setAudioPlayback(context: AudioPlaybackContext): void {
	setContext(PLAYBACK_KEY, context);
}

/** `null` when rendered outside an AudioPlaybackProvider. */
export function getAudioPlayback(): AudioPlaybackContext | null {
	return getContext<AudioPlaybackContext | undefined>(PLAYBACK_KEY) ?? null;
}

export function setSessionStore(store: SessionStore): void {
	setContext(SESSIONS_KEY, store);
}

export function getSessionStore(): SessionStore {
	const store = getContext<SessionStore | undefined>(SESSIONS_KEY);
	if (!store) {
		throw new Error('SessionStore context is missing; render inside the root layout');
	}
	return store;
}
