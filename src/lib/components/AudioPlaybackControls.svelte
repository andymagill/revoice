<script lang="ts">
	import { untrack } from 'svelte';
	import { Play, Pause } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { formatDuration } from '$lib/utils';

	/**
	 * Play/pause button and seek bar for one audio blob.
	 *
	 * Owns the HTMLAudioElement for the blob it is given and reports it to the parent via
	 * `onAudioChange` so the parent can wire it into the Web Audio graph (visualizer).
	 */
	interface Props {
		/** Audio to play; `null` disables the controls. */
		blob: Blob | null;
		/** Playback is unavailable, e.g. while recording. Also pauses anything playing. */
		disabled?: boolean;
		/**
		 * Known duration in milliseconds. Needed because MediaRecorder WebM blobs usually
		 * report `Infinity` for `audio.duration`; this is the fallback whenever the element
		 * cannot supply a finite duration.
		 */
		durationMs?: number;
		/** Called with the new element whenever the blob changes (or `null` when cleared). */
		onAudioChange?: (audio: HTMLAudioElement | null) => void;
	}

	let { blob, disabled = false, durationMs = 0, onAudioChange }: Props = $props();

	let audio = $state.raw<HTMLAudioElement | null>(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let mediaDuration = $state(0);
	let isSeeking = $state(false);

	/** Seconds. Prefer the element's own finite duration, else the caller-supplied one. */
	const duration = $derived(mediaDuration > 0 ? mediaDuration : durationMs / 1000);
	const canPlay = $derived(audio !== null && !disabled);

	/**
	 * Create an audio element per blob and dispose of it when the blob changes.
	 *
	 * Lifecycle rules:
	 * - The object URL lives exactly as long as its element: it is revoked in this
	 *   effect's cleanup, which runs before the next element is created, so a new blob
	 *   can never be handed a revoked URL.
	 * - Listeners are registered with an AbortSignal so teardown is a single `abort()`
	 *   (removing anonymous handlers by reference is impossible and would leak them).
	 * - `onAudioChange` is read untracked: it is a callback, not a dependency, and the
	 *   parent's handler writes state we must not re-run on.
	 */
	$effect(() => {
		const currentBlob = blob;

		isPlaying = false;
		currentTime = 0;
		mediaDuration = 0;
		isSeeking = false;

		if (!currentBlob) {
			audio = null;
			untrack(() => onAudioChange?.(null));
			return;
		}

		const url = URL.createObjectURL(currentBlob);
		const element = new Audio(url);
		const abort = new AbortController();
		const { signal } = abort;

		element.addEventListener(
			'loadedmetadata',
			() => {
				if (Number.isFinite(element.duration) && element.duration > 0) {
					mediaDuration = element.duration;
				}
			},
			{ signal }
		);
		element.addEventListener(
			'timeupdate',
			() => {
				if (!isSeeking) currentTime = element.currentTime;
			},
			{ signal }
		);
		element.addEventListener(
			'ended',
			() => {
				isPlaying = false;
				currentTime = 0;
			},
			{ signal }
		);
		element.addEventListener('play', () => (isPlaying = true), { signal });
		element.addEventListener('pause', () => (isPlaying = false), { signal });

		audio = element;
		untrack(() => onAudioChange?.(element));

		return () => {
			abort.abort();
			element.pause();
			URL.revokeObjectURL(url);
		};
	});

	// Recording starts → stop any playback in progress.
	$effect(() => {
		if (disabled) audio?.pause();
	});

	function togglePlayPause() {
		if (!audio || disabled) return;

		if (isPlaying) {
			audio.pause();
		} else {
			audio.play().catch((error) => {
				console.error('[AudioPlaybackControls] Playback failed:', error);
			});
		}
	}

	function handleSeekEnd(value: number) {
		isSeeking = false;
		if (!audio || disabled) return;
		audio.currentTime = value;
		currentTime = value;
	}
</script>

<div class="flex items-center gap-3 w-full">
	<Button
		variant="outline"
		size="icon"
		onclick={togglePlayPause}
		disabled={!canPlay}
		class="flex-shrink-0"
		aria-label={isPlaying ? 'Pause playback' : 'Play recording'}
	>
		{#if isPlaying}
			<Pause class="h-4 w-4" />
		{:else}
			<Play class="h-4 w-4" />
		{/if}
	</Button>

	<div class="flex-1 flex items-center gap-2">
		<span class="text-sm text-foreground tabular-nums min-w-[3rem] text-right">
			{formatDuration(currentTime * 1000)}
		</span>
		<Slider
			bind:value={currentTime}
			min={0}
			max={duration > 0 ? duration : 1}
			step={0.1}
			disabled={!canPlay}
			onValueChange={() => (isSeeking = true)}
			onValueCommit={handleSeekEnd}
			class="flex-1 playback-slider"
		/>
		<span class="text-sm text-foreground tabular-nums min-w-[3rem]">
			{formatDuration(duration * 1000)}
		</span>
	</div>
</div>

<style>
	/* Playback timeline styling (overrides the generic slider colours) */
	:global(.playback-slider .bg-secondary) {
		background-color: rgb(229 231 235) !important; /* gray-200: unplayed */
	}

	:global(.playback-slider .bg-primary) {
		background-color: rgb(249 115 22) !important; /* orange-500: played */
	}

	:global(.playback-slider .border-primary) {
		border-color: rgb(249 115 22) !important;
		border-width: 3px !important;
	}

	:global(.playback-slider button[role='slider']) {
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2) !important;
	}

	/* Disabled state */
	:global(.playback-slider:has([disabled]) .bg-secondary) {
		background-color: rgb(229 231 235) !important;
	}

	:global(.playback-slider:has([disabled]) .bg-primary) {
		background-color: rgb(209 213 219) !important; /* gray-300 */
	}

	:global(.playback-slider:has([disabled]) button[role='slider']) {
		border-color: rgb(209 213 219) !important;
	}
</style>
