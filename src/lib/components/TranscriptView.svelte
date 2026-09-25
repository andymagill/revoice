<script lang="ts">
	import type { TranscriptionResult } from '$lib/types';

	/**
	 * Chat-style transcript.
	 *
	 * - Final segments: right-aligned solid bubbles that never change once shown.
	 * - Interim segment: at most one, left-aligned and faded, updated in place while the
	 *   user speaks and replaced by a final bubble when the recognizer commits it. Keeping
	 *   the interim separate from the finals is what prevents the "Hello", "Hello world",
	 *   "Hello world" duplicates a single append-only list would show.
	 */
	interface Props {
		finals: TranscriptionResult[];
		interim: TranscriptionResult | null;
		/** Shown instead of the empty-state text, e.g. when speech recognition is unavailable. */
		notice?: string;
	}

	let { finals, interim, notice }: Props = $props();
</script>

{#if notice}
	<p class="text-muted-foreground text-center py-8">{notice}</p>
{:else if finals.length === 0 && !interim}
	<p class="text-muted-foreground text-center py-8">
		No transcription yet. Start recording to begin.
	</p>
{:else}
	<div class="space-y-3">
		{#each finals as item, index (index)}
			<div class="flex justify-end">
				<div class="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-xs">
					<p class="text-sm">{item.text}</p>
					{#if item.confidence !== undefined}
						<p class="text-xs text-primary-foreground/70 mt-1">
							Confidence: {(item.confidence * 100).toFixed(0)}%
						</p>
					{/if}
				</div>
			</div>
		{/each}

		{#if interim}
			<div class="flex justify-start">
				<div class="bg-accent/10 text-foreground rounded-lg px-4 py-2 max-w-xs opacity-70">
					<p class="text-sm">{interim.text}</p>
					{#if interim.confidence !== undefined}
						<p class="text-xs text-muted-foreground mt-1">
							Confidence: {(interim.confidence * 100).toFixed(0)}%
						</p>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
