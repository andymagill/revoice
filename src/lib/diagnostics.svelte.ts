/**
 * Diagnostics: a bounded event log, an environment snapshot and the debug-mode switches.
 *
 * Built for debugging on a phone, where DevTools is awkward: every layer (recorder, mic
 * capture, speech engine) calls `diag()`, the entries are shown in `DebugPanel` and can be
 * copied out as JSON. Entries are always mirrored to `console.debug`, so `chrome://inspect`
 * works too.
 *
 * Switches (URL query, read once at load):
 * - `?debug=1` shows the panel and remembers that in localStorage; `?debug=0` turns it off.
 * - `?probe=nogum` (only with debug on) runs speech recognition WITHOUT opening the
 *   microphone ourselves. If transcription works with it but not without, the recorder's
 *   own capture is starving the speech service (common on Android).
 *
 * `diag()` never throws, so it is safe to call from any handler.
 */

const MAX_ENTRIES = 400;
const DEBUG_STORAGE_KEY = 'revoiceDebug';

export interface DiagEntry {
	/** Milliseconds since page load. */
	t: number;
	scope: string;
	event: string;
	data?: unknown;
}

function readDebugFlag(): boolean {
	if (typeof window === 'undefined') return false;
	const param = new URLSearchParams(window.location.search).get('debug');
	try {
		if (param === '1') {
			localStorage.setItem(DEBUG_STORAGE_KEY, '1');
			return true;
		}
		if (param === '0') {
			localStorage.removeItem(DEBUG_STORAGE_KEY);
			return false;
		}
		return localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
	} catch {
		// Storage can throw (private mode, blocked site data): fall back to the URL alone.
		return param === '1';
	}
}

/** Reactive flags for the UI. `revision` ticks whenever the log changes. */
class DiagState {
	debug = $state(readDebugFlag());
	revision = $state(0);
}

export const diagState = new DiagState();

let entries: DiagEntry[] = [];

/** Copy `data` into something JSON-safe (Errors and DOMExceptions become {name, message}). */
function normalize(data: unknown): unknown {
	if (data === undefined) return undefined;
	try {
		return JSON.parse(
			JSON.stringify(data, (_key, value) =>
				value instanceof Error ? { name: value.name, message: value.message } : value
			)
		);
	} catch {
		return String(data);
	}
}

/** Record one event. `scope` names the layer (recorder, mic, speech, ...). */
export function diag(scope: string, event: string, data?: unknown): void {
	try {
		entries.push({ t: Math.round(performance.now()), scope, event, data: normalize(data) });
		if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
		console.debug(`[${scope}] ${event}`, data ?? '');
		if (diagState.debug) diagState.revision++;
	} catch {
		// Diagnostics must never break the app.
	}
}

/** Snapshot of the log. Reading it inside `$derived`/`$effect` subscribes to changes. */
export function getEntries(): DiagEntry[] {
	void diagState.revision;
	return entries.slice();
}

export function clearDiag(): void {
	entries = [];
	diagState.revision++;
}

/** Hide the panel and forget the setting (until `?debug=1` is used again). */
export function disableDebug(): void {
	try {
		localStorage.removeItem(DEBUG_STORAGE_KEY);
	} catch {
		// ignore
	}
	diagState.debug = false;
}

/** The whole log as pretty JSON, for the Copy button. */
export function exportDiag(): string {
	return JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2);
}

/** Active A/B probe, or `null`. Only honoured while debug mode is on. */
export function getProbe(): 'nogum' | null {
	if (!diagState.debug || typeof window === 'undefined') return null;
	return new URLSearchParams(window.location.search).get('probe') === 'nogum' ? 'nogum' : null;
}

interface UserAgentDataLike {
	mobile: boolean;
	platform: string;
	brands: Array<{ brand: string; version: string }>;
}

/** Log the facts that usually explain a device-specific failure. */
async function snapshotEnvironment(onCleanup: (fn: () => void) => void): Promise<void> {
	const nav = navigator as Navigator & {
		userAgentData?: UserAgentDataLike;
		connection?: { effectiveType?: string; saveData?: boolean };
	};
	const canProbeMime = typeof MediaRecorder !== 'undefined';

	diag('env', 'snapshot', {
		userAgent: nav.userAgent,
		uaData: nav.userAgentData && {
			mobile: nav.userAgentData.mobile,
			platform: nav.userAgentData.platform,
			brands: nav.userAgentData.brands,
		},
		language: nav.language,
		secureContext: window.isSecureContext,
		online: nav.onLine,
		connection: nav.connection && {
			effectiveType: nav.connection.effectiveType,
			saveData: nav.connection.saveData,
		},
		speechRecognition: 'SpeechRecognition' in window,
		webkitSpeechRecognition: 'webkitSpeechRecognition' in window,
		mediaRecorder: canProbeMime,
		mime: canProbeMime && {
			opus: MediaRecorder.isTypeSupported('audio/webm;codecs=opus'),
			webm: MediaRecorder.isTypeSupported('audio/webm'),
			mp4: MediaRecorder.isTypeSupported('audio/mp4'),
		},
		audioContext: 'AudioContext' in window || 'webkitAudioContext' in window,
	});

	try {
		const status = await nav.permissions.query({ name: 'microphone' as PermissionName });
		diag('env', 'mic-permission', { state: status.state });
		const onChange = () => diag('env', 'mic-permission-changed', { state: status.state });
		status.addEventListener('change', onChange);
		onCleanup(() => status.removeEventListener('change', onChange));
	} catch (error) {
		diag('env', 'mic-permission-unavailable', error);
	}

	try {
		const devices = await nav.mediaDevices.enumerateDevices();
		const counts: Record<string, number> = {};
		for (const device of devices) counts[device.kind] = (counts[device.kind] ?? 0) + 1;
		diag('env', 'devices', counts);
	} catch (error) {
		diag('env', 'enumerate-devices-failed', error);
	}
}

/**
 * Start page-wide diagnostics: environment snapshot plus listeners for the events that most
 * often explain a stall on mobile (backgrounding, connectivity, uncaught errors).
 *
 * @returns Cleanup function that removes the listeners.
 */
export function installDiagnostics(): () => void {
	const cleanups: Array<() => void> = [];
	let disposed = false;
	const listen = <T extends EventTarget>(target: T, type: string, handler: EventListener) => {
		target.addEventListener(type, handler);
		cleanups.push(() => target.removeEventListener(type, handler));
	};

	listen(document, 'visibilitychange', () =>
		diag('page', 'visibilitychange', { state: document.visibilityState })
	);
	listen(window, 'online', () => diag('page', 'online'));
	listen(window, 'offline', () => diag('page', 'offline'));
	listen(window, 'error', (event) => {
		const e = event as ErrorEvent;
		diag('page', 'error', { message: e.message, file: e.filename, line: e.lineno });
	});
	listen(window, 'unhandledrejection', (event) =>
		diag('page', 'unhandledrejection', (event as PromiseRejectionEvent).reason)
	);

	void snapshotEnvironment((fn) => {
		// The snapshot is async: if we were disposed meanwhile, undo immediately.
		if (disposed) fn();
		else cleanups.push(fn);
	});

	return () => {
		disposed = true;
		cleanups.forEach((fn) => fn());
	};
}
