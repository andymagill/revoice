<script lang="ts">
	import { setContext, onMount, untrack } from 'svelte';
	import type { Snippet } from 'svelte';

	interface AudioPlaybackContext {
		audio: HTMLAudioElement | null;
		audioContext: AudioContext | null;
		analyser: AnalyserNode | null;
		isConnected: boolean;
	}

	interface Props {
		audio: HTMLAudioElement | null;
		children?: Snippet;
	}

	let { audio, children }: Props = $props();

	let audioContext: AudioContext | null = $state(null);
	let analyser: AnalyserNode | null = $state(null);
	let mediaSource: MediaElementAudioSourceNode | null = $state(null);
	let isConnected = false; // Non-reactive, just for tracking

	// Context object (create once, properties will update reactively)
	const context: AudioPlaybackContext = {
		get audio() {
			return audio;
		},
		get audioContext() {
			return audioContext;
		},
		get analyser() {
			return analyser;
		},
		get isConnected() {
			return isConnected;
		},
	};

	// Provide context to children
	setContext<AudioPlaybackContext>('audioPlayback', context);

	// Cache for MediaElementSourceNodes to prevent duplicate creation errors
	const sourceNodeCache = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

	// Setup Web Audio API connection when audio element is provided
	$effect(() => {
		const currentAudio = audio;

		/**
		 * CRITICAL FIX: UNTRACKING ALL STATE MODIFICATIONS
		 *
		 * This effect ONLY depends on the `audio` prop.
		 * All reads of `mediaSource`, `analyser`, and `audioContext` (which we modify)
		 * are wrapped in `untrack()` to prevent circular dependencies.
		 *
		 * PROBLEM PREVENTED:
		 * If we read reactive state variables that we also WRITE to in the same effect,
		 * the effect re-runs after the write, triggering the cleanup code again.
		 * This creates an infinite loop.
		 *
		 * SOLUTION:
		 * Use `untrack()` to read old values without registering dependencies.
		 * This ensures the effect ONLY runs when `audio` (the prop) changes.
		 */

		// Read old state without creating dependencies
		const oldMediaSource = untrack(() => mediaSource);
		const oldAnalyser = untrack(() => analyser);
		const oldAudioContext = untrack(() => audioContext);

		// CRITICAL: Cleanup previous connection COMPLETELY before creating new one
		if (oldMediaSource) {
			try {
				oldMediaSource.disconnect();
			} catch (e) {
				// Already disconnected
			}
		}

		if (oldAnalyser) {
			try {
				oldAnalyser.disconnect();
			} catch (e) {
				// Already disconnected
			}
		}

		isConnected = false;
		mediaSource = null;
		analyser = null;

		// CRITICAL: Clear cache entry for old audio to force fresh connection setup
		if (currentAudio && oldMediaSource) {
			sourceNodeCache.delete(currentAudio);
		}

		// Setup new connection if audio element exists
		if (currentAudio) {
			try {
				// Create or reuse AudioContext
				let ctx = oldAudioContext;
				if (!ctx) {
					ctx = new (window.AudioContext || (window as any).webkitAudioContext)() as AudioContext;
					audioContext = ctx;
				}

				// Resume context (required for Safari)
				if (ctx.state === 'suspended') {
					ctx.resume();
				}

				// Create analyser
				const newAnalyser = ctx.createAnalyser();
				newAnalyser.fftSize = 64; // Matches EqVisualizer default for 32 bars
				newAnalyser.smoothingTimeConstant = 0.8;
				analyser = newAnalyser;

				// Create media source (can only be called once per element)
				// Use cache to prevent InvalidStateError: HTMLMediaElement already connected...
				let source: MediaElementAudioSourceNode;
				if (sourceNodeCache.has(currentAudio)) {
					source = sourceNodeCache.get(currentAudio)!;
				} else {
					source = ctx.createMediaElementSource(currentAudio);
					sourceNodeCache.set(currentAudio, source);
				}
				mediaSource = source;

				// Connect: source -> analyser -> destination (critical for audio output)
				source.connect(newAnalyser);
				newAnalyser.connect(ctx.destination);

				isConnected = true;
			} catch (error) {
				console.error('Failed to setup audio visualization:', error);
				isConnected = false;
			}
		}
	});

	// Cleanup on unmount
	onMount(() => {
		return () => {
			if (mediaSource) {
				try {
					mediaSource.disconnect();
				} catch (e) {
					// Already disconnected
				}
			}
			if (analyser) {
				try {
					analyser.disconnect();
				} catch (e) {
					// Already disconnected
				}
			}
			// Note: Don't close audioContext to allow reuse across sessions
		};
	});
</script>

{#if children}
	{@render children()}
{/if}
