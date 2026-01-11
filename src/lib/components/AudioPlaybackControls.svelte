<script lang="ts">
	import { untrack } from 'svelte';
	import { Play, Pause } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { formatTime } from '$lib/audio';
	import AudioPlaybackProvider from './AudioPlaybackProvider.svelte';

	interface Props {
		blob: Blob | null;
		headerChunk?: Blob | null; // First chunk with headers for immediate playback
		audioChunks?: Blob[];
		mimeType?: string;
		disabled?: boolean;
		/**
		 * Explicit duration in milliseconds.
		 * REQUIRED for MediaRecorder blobs in Chrome, which often report 'Infinity' duration used directly.
		 * If provided, this overrides audio.duration when the latter is infinite.
		 */
		durationMs?: number;
	}

	let {
		blob,
		headerChunk = null,
		audioChunks = [],
		mimeType = '',
		disabled = false,
		durationMs = 0,
	}: Props = $props();

	let audio: HTMLAudioElement | null = $state(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(durationMs > 0 ? durationMs / 1000 : 0);
	let isSeeking = $state(false);
	let localBlob: Blob | null = $state(null);

	// Update duration if prop changes
	$effect(() => {
		if (durationMs > 0 && duration === 0) {
			duration = durationMs / 1000;
		}
	});

	// Determine the actual blob to use (either from prop or locally created)
	const activeBlob = $derived(blob || localBlob);

	// Determine if we have playable content (either blob or header chunk when not disabled)
	const hasContent = $derived(activeBlob !== null || (!disabled && headerChunk !== null));

	// Event handlers (defined outside effect to prevent circular dependencies)
	const handleLoadedMetadata = (el: HTMLAudioElement) => {
		if (Number.isFinite(el.duration)) {
			duration = el.duration;
		} else if (durationMs > 0) {
			// Fallback to explicit duration if metadata is missing/infinite (common with WebM blobs)
			duration = durationMs / 1000;
		}
	};

	const handleTimeUpdate = (el: HTMLAudioElement) => {
		if (!isSeeking) {
			currentTime = el.currentTime;
		}
	};

	const handleEnded = () => {
		isPlaying = false;
		currentTime = 0;
	};

	const handlePlay = () => {
		isPlaying = true;
	};

	const handlePause = () => {
		isPlaying = false;
	};

	// Create audio element when blob is provided
	$effect(() => {
		const currentBlob = activeBlob;

		/**
		 * CRITICAL FIX: UNTRACKING DEPENDENCIES
		 *
		 * We must use `untrack()` when accessing `audio` here.
		 *
		 * PROBLEM:
		 * Accessing `audio` directly inside this effect creates a circular dependency:
		 * 1. $effect runs when `activeBlob` changes
		 * 2. We read `audio` (to clean it up) -> registers `audio` as a dependency
		 * 3. We set `audio = newAudio` at the end
		 * 4. This triggers the effect again immediately -> Infinite Loop!
		 * 5. Result: "effect_update_depth_exceeded" and browser crash.
		 *
		 * SOLUTION:
		 * `untrack(() => audio)` reads the value without registering the dependency.
		 * This ensures the effect ONLY runs when `activeBlob` changes, not when we update `audio`.
		 */
		const prevAudio = untrack(() => audio);
		if (prevAudio) {
			prevAudio.pause();
			URL.revokeObjectURL(prevAudio.src);
		}

		let newAudio: HTMLAudioElement | null = null;

		if (currentBlob) {
			const url = URL.createObjectURL(currentBlob);
			newAudio = new Audio(url);

			// Setup event listeners using the handler functions
			newAudio.addEventListener('loadedmetadata', () => handleLoadedMetadata(newAudio!));
			newAudio.addEventListener('timeupdate', () => handleTimeUpdate(newAudio!));
			newAudio.addEventListener('ended', handleEnded);
			newAudio.addEventListener('play', handlePlay);
			newAudio.addEventListener('pause', handlePause);

			audio = newAudio;
		} else {
			audio = null;
		}

		return () => {
			if (newAudio) {
				newAudio.pause();
				URL.revokeObjectURL(newAudio.src);
			}
		};
	});

	function togglePlayPause() {
		if (disabled) return;

		// If we don't have a blob yet but have chunks, construct the full blob
		if (!activeBlob && audioChunks.length > 0 && mimeType) {
			// Construct blob from all chunks to ensure full playback duration
			// The first chunk contains the initialization header, subsequent chunks are appended
			const audioBlob = new Blob(audioChunks, { type: mimeType });
			localBlob = audioBlob;

			// Wait for the effect to run and create audio element, then play
			setTimeout(() => {
				if (audio) {
					audio.play().catch((error) => {
						console.error('Failed to play audio:', error);
					});
				}
			}, 100);
			return;
		}

		if (!audio) return;

		if (isPlaying) {
			audio.pause();
		} else {
			audio.play().catch((error) => {
				console.error('Failed to play audio:', error);
			});
		}
	}

	function handleSeek(value: number) {
		if (!audio || disabled) return;
		audio.currentTime = value;
		currentTime = value;
	}

	function handleSeekStart() {
		isSeeking = true;
	}

	function handleSeekEnd(value: number) {
		isSeeking = false;
		handleSeek(value);
	}
</script>

<AudioPlaybackProvider {audio}>
	<div class="flex items-center gap-3 w-full">
		<!-- Play/Pause Button -->
		<Button
			variant="outline"
			size="icon"
			onclick={togglePlayPause}
			disabled={disabled || !hasContent}
			class="flex-shrink-0"
		>
			{#if isPlaying}
				<Pause class="h-4 w-4" />
			{:else}
				<Play class="h-4 w-4" />
			{/if}
		</Button>

		<!-- Timeline Slider -->
		<div class="flex-1 flex items-center gap-2">
			<span class="text-sm text-muted-foreground tabular-nums min-w-[3rem] text-right">
				{formatTime(currentTime)}
			</span>
			<Slider
				bind:value={currentTime}
				min={0}
				max={duration || 100}
				step={0.1}
				disabled={disabled || !hasContent}
				onValueChange={(value) => {
					if (isSeeking) {
						currentTime = value;
					}
				}}
				onValueCommit={handleSeekEnd}
				class="flex-1"
			/>
			<span class="text-sm text-muted-foreground tabular-nums min-w-[3rem]">
				{formatTime(duration)}
			</span>
		</div>
	</div>
</AudioPlaybackProvider>
