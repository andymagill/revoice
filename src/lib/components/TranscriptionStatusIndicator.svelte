<script lang="ts">
	import { getContext } from 'svelte';
	import type { ITranscriptionEngine } from '$lib/types';

	/**
	 * TranscriptionStatusIndicator Component
	 *
	 * Displays real-time transcription engine state with a colored icon and label.
	 * Updates reactively as the engine transitions between states: idle → listening → processing → idle
	 *
	 * States:
	 * - Idle (gray): Engine ready, not actively transcribing
	 * - Listening (green): Engine receiving audio input
	 * - Processing (amber): Engine processing audio, awaiting final results
	 *
	 * Responsive Layout:
	 * - Mobile (flex-col): Stacked vertically, aligned left
	 * - Desktop (md+, flex-row): Horizontal, aligned right
	 *
	 * Updates: Real-time via engine state subscription
	 */

	const engine = getContext<ITranscriptionEngine>('transcriptionEngine');

	let engineState: 'idle' | 'listening' | 'processing' = $state('idle');

	$effect(() => {
		if (!engine) return;

		// Subscribe to engine state changes
		const unsubscribe = engine.onStateChange((newState) => {
			engineState = newState;
		});

		return () => unsubscribe();
	});

	// Map engine state to UI properties
	function getStateInfo() {
		switch (engineState) {
			case 'listening':
				return {
					label: 'Listening',
					color: 'text-green-500',
					bgIcon: 'bg-green-500/10',
					icon: 'MIC',
				};
			case 'processing':
				return {
					label: 'Processing',
					color: 'text-amber-500',
					bgIcon: 'bg-amber-500/10',
					icon: 'CLOCK',
				};
			case 'idle':
			default:
				return {
					label: 'Idle',
					color: 'text-muted-foreground',
					bgIcon: 'bg-muted',
					icon: 'CIRCLE',
				};
		}
	}

	const stateInfo = $derived(getStateInfo());
</script>

<div class="flex flex-row items-center gap-2 justify-end text-sm">
	<div class="flex items-center gap-2">
		<!-- Icon -->
		<div class="flex-shrink-0 {stateInfo.bgIcon} p-1.5 rounded-full">
			{#if stateInfo.icon === 'MIC'}
				<svg
					class="w-3 h-3 {stateInfo.color}"
					fill="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
					<path
						d="M17 16.91c-1.48 1.46-3.5 2.36-5.7 2.36-2.2 0-4.2-.9-5.7-2.36M19 21h2v-2c0-2.76-1.79-5.12-4.29-6.02v2.82c2.04.87 3.29 2.75 3.29 4.2v1z"
					/>
				</svg>
			{:else if stateInfo.icon === 'CLOCK'}
				<svg
					class="w-3 h-3 {stateInfo.color}"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<circle cx="12" cy="12" r="10" stroke-width="2" />
					<polyline points="12 6 12 12 16 14" stroke-width="2" stroke-linecap="round" />
				</svg>
			{:else}
				<!-- CIRCLE for Idle -->
				<svg
					class="w-3 h-3 {stateInfo.color}"
					fill="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<circle cx="12" cy="12" r="10" />
				</svg>
			{/if}
		</div>

		<!-- Label -->
		<span class="text-muted-foreground text-xs font-medium">{stateInfo.label}</span>
	</div>
</div>
