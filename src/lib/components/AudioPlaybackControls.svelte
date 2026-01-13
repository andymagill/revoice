<script lang="ts">
	import { untrack } from 'svelte';
	import { Play, Pause } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Slider } from '$lib/components/ui/slider';
	import { formatTime } from '$lib/audio';
	import type { Snippet } from 'svelte';

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
		/** Callback when audio element is created/updated */
		onAudioChange?: (audio: HTMLAudioElement | null) => void;
		/** Children/fallback slot content */
		children?: Snippet;
	}

	let {
		blob,
		headerChunk = null,
		audioChunks = [],
		mimeType = '',
		disabled = false,
		durationMs = 0,
		onAudioChange,
		children,
	}: Props = $props();

	let audio: HTMLAudioElement | null = $state(null);
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(
		untrack(() => {
			return durationMs > 0 ? durationMs / 1000 : 0;
		})
	);
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

	// Create audio element when blob is provided
	/**
	 * BLOB URL LIFECYCLE MANAGEMENT
	 *
	 * This effect manages creation and cleanup of blob URLs with critical timing constraints:
	 *
	 * PROBLEM FIXED:
	 * - Creating audio elements from blob URLs can fail with ERR_FILE_NOT_FOUND
	 * - This happens when blob URLs are revoked too early or at the wrong time
	 * - Especially critical for new recordings where timing is tight (pause → play)
	 *
	 * SOLUTION PATTERN:
	 * 1. Create new audio element from blob URL IMMEDIATELY
	 * 2. Only revoke PREVIOUS audio's URL (not the current one)
	 * 3. Check if URL is actually a blob URL before revoking (safety check)
	 * 4. Wrap in try-catch to handle creation failures gracefully
	 *
	 * CRITICAL DETAILS:
	 * - Blob URLs (blob:http://...) are only valid while referenced by an element
	 * - Revoking too early = ERR_FILE_NOT_FOUND (404)
	 * - We must keep the URL alive while audio element is active
	 * - Only revoke when transitioning to a new audio element
	 *
	 * REGRESSION RISK:
	 * - If you move URL.revokeObjectURL after setting audio = newAudio, URLs may
	 *   be revoked before audio.play() is called
	 * - If you revoke in the cleanup function, URLs get revoked while audio might
	 *   still be loading or playing
	 * - If you remove the blob: check, you might try to revoke non-blob URLs
	 */
	$effect(() => {
		const currentBlob = activeBlob;

		console.log('[AudioPlaybackControls] Effect triggered:', {
			activeBlobExists: currentBlob !== null,
			activeBlobSize: currentBlob?.size ?? null,
		});

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

		// CRITICAL: Pause and clean up previous audio BEFORE creating new one
		if (prevAudio) {
			prevAudio.pause();
			// Remove all event listeners to break potential reference cycles
			prevAudio.removeEventListener('loadedmetadata', () => {});
			prevAudio.removeEventListener('timeupdate', () => {});
			prevAudio.removeEventListener('ended', () => {});
			prevAudio.removeEventListener('play', () => {});
			prevAudio.removeEventListener('pause', () => {});
			// SAFETY: Only revoke blob URLs (not data: or http: URLs)
			// This prevents attempting to revoke non-revocable URLs
			const prevUrl = prevAudio.src;
			if (prevUrl && prevUrl.startsWith('blob:')) {
				URL.revokeObjectURL(prevUrl);
			}
		}

		let newAudio: HTMLAudioElement | null = null;

		if (currentBlob) {
			try {
				const url = URL.createObjectURL(currentBlob);
				newAudio = new Audio(url);
				console.log('[AudioPlaybackControls] Created audio element:', {
					blobSize: currentBlob.size,
					blobType: currentBlob.type,
					url,
					durationMs,
					audioReady: newAudio.readyState,
				});

				// Setup event listeners with inline handlers that capture current state
				// Use untrack() so reading durationMs doesn't create a dependency on this effect
				newAudio.addEventListener('loadedmetadata', (event) => {
					const el = event.target as HTMLAudioElement;
					const currentDurationMs = untrack(() => durationMs);
					console.log('[AudioPlaybackControls] loadedmetadata event fired:', {
						duration: el.duration,
						readyState: el.readyState,
					});
					if (Number.isFinite(el.duration) && el.duration > 0) {
						duration = el.duration;
					} else if (currentDurationMs > 0) {
						// Fallback to explicit duration if metadata is missing/infinite (common with WebM blobs)
						duration = currentDurationMs / 1000;
					} else {
						// Ensure duration has a sane fallback for slider
						duration = Math.max(1, duration);
					}
				});

				newAudio.addEventListener('timeupdate', (event) => {
					const el = event.target as HTMLAudioElement;
					if (!isSeeking) {
						currentTime = el.currentTime;
					}
				});

				newAudio.addEventListener('ended', () => {
					isPlaying = false;
					currentTime = 0;
				});

				newAudio.addEventListener('play', () => {
					isPlaying = true;
				});

				newAudio.addEventListener('pause', () => {
					isPlaying = false;
				});

				audio = newAudio;
			} catch (error) {
				console.error('[AudioPlaybackControls] Failed to create audio element:', error);
				audio = null;
			}
		} else {
			audio = null;
		}

		// CRITICAL: Notify parent AFTER audio state is set and previous audio is cleaned up
		onAudioChange?.(newAudio ?? null);

		return () => {
			console.log('[AudioPlaybackControls] Effect cleanup running:', {
				hasNewAudio: newAudio !== null,
				audioSrc: newAudio?.src ?? null,
			});
			if (newAudio) {
				try {
					newAudio.pause();
					newAudio.removeEventListener('loadedmetadata', () => {});
					newAudio.removeEventListener('timeupdate', () => {});
					newAudio.removeEventListener('ended', () => {});
					newAudio.removeEventListener('play', () => {});
					newAudio.removeEventListener('pause', () => {});
				} catch (e) {
					// Element might already be cleaned up
				}
				// DON'T revoke blob URLs here - it's too aggressive
				// The browser will clean up the blob when it's no longer referenced
				// Only revoke when we're absolutely sure it's done loading
			}
		};
	});

	function togglePlayPause() {
		if (disabled) return;

		console.log('[AudioPlaybackControls] togglePlayPause called:', {
			activeBlob: activeBlob ? `Blob(${activeBlob.size} bytes)` : null,
			audio: audio ? 'exists' : 'null',
			audioChunks: audioChunks.length,
			isPlaying,
		});

		// If we don't have a blob yet but have chunks, construct the full blob
		if (!activeBlob && audioChunks.length > 0 && mimeType) {
			console.log('[AudioPlaybackControls] Constructing blob from chunks...');
			// Construct blob from all chunks to ensure full playback duration
			// The first chunk contains the initialization header, subsequent chunks are appended
			const audioBlob = new Blob(audioChunks, { type: mimeType });
			console.log('[AudioPlaybackControls] Created blob from chunks:', {
				size: audioBlob.size,
				type: audioBlob.type,
			});
			localBlob = audioBlob;

			// Wait for the effect to run and create audio element, then play
			setTimeout(() => {
				if (audio) {
					console.log('[AudioPlaybackControls] Playing audio from chunks...');
					audio.play().catch((error) => {
						console.error('Failed to play audio:', error);
					});
				}
			}, 100);
			return;
		}

		if (!audio) {
			console.log('[AudioPlaybackControls] No audio element available');
			return;
		}

		if (isPlaying) {
			console.log('[AudioPlaybackControls] Pausing audio');
			audio.pause();
		} else {
			console.log('[AudioPlaybackControls] Playing audio');
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
		<span class="text-sm text-foreground tabular-nums min-w-[3rem] text-right">
			{formatTime(currentTime)}
		</span>
		<Slider
			bind:value={currentTime}
			min={0}
			max={duration || 100}
			step={0.1}
			disabled={disabled || !hasContent}
			onValueChange={(value) => {
				isSeeking = true;
				currentTime = value;
			}}
			onValueCommit={handleSeekEnd}
			class="flex-1 playback-slider"
		/>
		<span class="text-sm text-foreground tabular-nums min-w-[3rem]">
			{formatTime(duration)}
		</span>
	</div>
</div>

{#if children}
	{@render children()}
{/if}

<style>
	/* Playback timeline styling */
	:global(.playback-slider .bg-secondary) {
		/* Light gray for unplayed/empty portion */
		background-color: rgb(229 231 235) !important; /* gray-200 */
	}

	:global(.playback-slider .bg-primary) {
		/* Orange for played/elapsed portion */
		background-color: rgb(249 115 22) !important; /* orange-500 */
	}

	:global(.playback-slider .border-primary) {
		/* Orange border for thumb indicator */
		border-color: rgb(249 115 22) !important; /* orange-500 */
		border-width: 3px !important;
	}

	:global(.playback-slider button[role='slider']) {
		/* Make thumb more visible */
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2) !important;
	}

	/* Disabled state - keep light gray */
	:global(.playback-slider:has([disabled]) .bg-secondary) {
		background-color: rgb(229 231 235) !important; /* gray-200 */
	}

	:global(.playback-slider:has([disabled]) .bg-primary) {
		background-color: rgb(209 213 219) !important; /* gray-300 */
	}

	:global(.playback-slider:has([disabled]) button[role='slider']) {
		border-color: rgb(209 213 219) !important; /* gray-300 */
	}
</style>
