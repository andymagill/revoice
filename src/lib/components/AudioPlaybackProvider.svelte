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
		 * CRITICAL FIX: UNTRACKING CLEANUP STATE
		 *
		 * We use `untrack()` to read the current values of `mediaSource`, `analyser`, etc.
		 *
		 * PROBLEM:
		 * If we read `mediaSource` directly, this effect becomes dependent on it.
		 * Later in this effect, we perform `mediaSource = null` or `mediaSource = ...`.
		 * This circular dependency causes the effect to re-run infinitely, rapidly creating/destroying
		 * Web Audio nodes until the browser crashes or runs out of memory.
		 *
		 * SOLUTION:
		 * By untracking these reads, we ensure this effect ONLY runs when `audio` (the prop) changes.
		 * This stabilizes the audio graph construction.
		 */
		const cleanupState = untrack(() => ({ mediaSource, analyser, audioContext }));

		// Cleanup previous connection
		if (cleanupState.mediaSource) {
			try {
				cleanupState.mediaSource.disconnect();
			} catch (e) {
				// Already disconnected
			}
			mediaSource = null;
		}

		if (cleanupState.analyser) {
			try {
				cleanupState.analyser.disconnect();
			} catch (e) {
				// Already disconnected
			}
			analyser = null;
		}

		isConnected = false;

		// Setup new connection if audio element exists
		if (currentAudio) {
			try {
				// Create or reuse AudioContext
				let ctx = cleanupState.audioContext;
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
				// If createMediaElementSource fails (already connected), we still need the connection
				// This can happen if the element was already connected elsewhere
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
