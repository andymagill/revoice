<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getSharedAudioContext } from '$lib/audio';
	import { setAudioPlayback } from '$lib/context';

	/**
	 * Routes a playback `<audio>` element through an AnalyserNode so the visualizer can
	 * draw it, and shares that analyser with descendants via context (see `context.ts`).
	 *
	 * Graph: element → MediaElementSource → analyser → speakers. The analyser must feed
	 * `destination`, otherwise routing the element into Web Audio would mute it.
	 */
	interface Props {
		/** Element to analyse; `null` tears the graph down. */
		audio: HTMLAudioElement | null;
		children?: Snippet;
	}

	let { audio, children }: Props = $props();

	let audioContext = $state.raw<AudioContext | null>(null);
	let analyser = $state.raw<AnalyserNode | null>(null);

	setAudioPlayback({
		get audio() {
			return audio;
		},
		get audioContext() {
			return audioContext;
		},
		get analyser() {
			return analyser;
		},
	});

	/**
	 * `createMediaElementSource` may be called only once per element; a second call throws
	 * InvalidStateError. Remember the node for every element seen so an element that is
	 * attached again reuses it. (The entry is never deleted: the WeakMap drops it with the
	 * element, and deleting it while the element lives would make the reuse throw.)
	 */
	const sourceNodes = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

	// Depends only on the `audio` prop. State written here is never read here, so the
	// effect cannot re-trigger itself; teardown is the returned cleanup.
	$effect(() => {
		const element = audio;
		if (!element) return;

		try {
			const context = getSharedAudioContext();

			const nextAnalyser = context.createAnalyser();
			nextAnalyser.fftSize = 64; // 32 bins, matching EqVisualizer's default bar count
			nextAnalyser.smoothingTimeConstant = 0.8;

			let source = sourceNodes.get(element);
			if (!source) {
				source = context.createMediaElementSource(element);
				sourceNodes.set(element, source);
			}

			source.connect(nextAnalyser);
			nextAnalyser.connect(context.destination);

			audioContext = context;
			analyser = nextAnalyser;

			return () => {
				source.disconnect();
				nextAnalyser.disconnect();
				analyser = null;
			};
		} catch (error) {
			console.error('[AudioPlaybackProvider] Failed to set up audio analysis:', error);
			analyser = null;
		}
	});
</script>

{#if children}
	{@render children()}
{/if}
