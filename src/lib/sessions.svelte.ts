/**
 * Session history and selection state, shared by the sidebar (layout) and the
 * recording dashboard (page) through Svelte context.
 *
 * Design note: the store holds *what the user picked* and exposes explicit commands
 * (`select`, `startNew`, `remove`, `clearAll`). The page registers handlers via `attach`
 * that do the heavy lifting (stop any recording, then load or clear the view). Commands
 * await those handlers, so callers can sequence work correctly — e.g. `remove` waits for
 * an active recording to be saved before deleting its rows, which an effect-based
 * "watch the selection" design cannot guarantee.
 */

import { clearAllData, deleteSession, getAllSessions, type Session } from './db';

/** Work the dashboard performs when the user changes what is on screen. */
export interface SessionViewHandlers {
	/** Stop any recording, then load `session` into the view. */
	open(session: Session): Promise<void>;
	/** Stop any recording, then clear the view for a new session. */
	reset(): Promise<void>;
}

export class SessionStore {
	/** All sessions, newest first. */
	sessions = $state.raw<Session[]>([]);

	/** Session shown in the dashboard, or `null` for a new/empty session. */
	selected = $state.raw<Session | null>(null);

	private handlers: SessionViewHandlers | null = null;

	/**
	 * Register the dashboard's handlers.
	 * @returns Function that unregisters them (only if they are still the active ones).
	 */
	attach(handlers: SessionViewHandlers): () => void {
		this.handlers = handlers;
		return () => {
			if (this.handlers === handlers) this.handlers = null;
		};
	}

	/** Reload the session list from IndexedDB. Failures are logged; the old list is kept. */
	async refresh(): Promise<void> {
		try {
			this.sessions = await getAllSessions();
		} catch (error) {
			console.error('[SessionStore] Failed to load sessions:', error);
		}
	}

	/**
	 * Mark a session as selected WITHOUT loading it. Used when the recorder has just
	 * created the session itself and already holds its live state.
	 */
	adopt(session: Session): void {
		this.selected = session;
	}

	/** User picked a past session: stop any recording and load it. */
	async select(session: Session): Promise<void> {
		this.selected = session;
		await this.handlers?.open(session);
	}

	/** User asked for a new session: stop any recording and clear the view. */
	async startNew(): Promise<void> {
		this.selected = null;
		await this.handlers?.reset();
	}

	/**
	 * Delete one session. If it is the one on screen (possibly mid-recording) the view is
	 * reset FIRST so the recorder finishes writing before its rows are removed.
	 */
	async remove(id: number): Promise<void> {
		if (this.selected?.id === id) {
			await this.startNew();
		}
		await deleteSession(id);
		await this.refresh();
	}

	/** Delete every session, after stopping any recording. */
	async clearAll(): Promise<void> {
		await this.startNew();
		await clearAllData();
		await this.refresh();
	}
}
