import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names, resolving conflicts (used by the shadcn-svelte components). */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Format a duration in milliseconds as `m:ss` (or `h:mm:ss` from one hour up).
 *
 * Non-finite and negative input renders as `0:00`. This matters because
 * `HTMLMediaElement.duration` is `Infinity`/`NaN` for MediaRecorder blobs until
 * metadata is resolved, and callers pass it straight through.
 */
export function formatDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return '0:00';

	const totalSeconds = Math.floor(ms / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = String(totalSeconds % 60).padStart(2, '0');

	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
		: `${minutes}:${seconds}`;
}
