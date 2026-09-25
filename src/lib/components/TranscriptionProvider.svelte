<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { setTranscriptionEngine } from '$lib/context';
	import type { ITranscriptionEngine } from '$lib/types';

	/**
	 * Makes the transcription engine available to descendants through context, so widgets
	 * like TranscriptionStatusIndicator can subscribe to it without prop drilling.
	 *
	 * The engine is fixed for the provider's lifetime, so it is captured once. `null` is a
	 * valid value and means the browser has no speech recognition; consumers must cope.
	 */
	interface Props {
		engine: ITranscriptionEngine | null;
		children?: Snippet;
	}

	let { engine, children }: Props = $props();

	setTranscriptionEngine(untrack(() => engine));
</script>

{#if children}
	{@render children()}
{/if}
