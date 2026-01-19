<script lang="ts">
	import { getContext } from 'svelte';
	import type { ITranscriptionEngine } from '$lib/types';

	/**
	 * TranscriptionStatusIndicator Component
	 *
	 * Displays real-time transcription engine state with a colored icon and label.
	 * Updates reactively as the engine transitions between states: idle → connecting → listening
	 *
	 * States:
	 * - Idle (gray): Engine stopped, not recording
	 * - Connecting (blue): Audio stream active, awaiting first transcription result
	 * - Listening (green): Actively receiving transcription results
	 *
	 * Responsive Layout:
	 * - Flex-row, right-aligned on all screen sizes
	 *
	 * Updates: Real-time via engine state subscription
	 */

	const engine = getContext<ITranscriptionEngine>('transcriptionEngine');

	let engineState: 'idle' | 'connecting' | 'listening' = $state('idle');

	$effect(() => {
		if (!engine) {
			console.log('[TranscriptionStatusIndicator] No engine context available');
			return;
		}

		console.log('[TranscriptionStatusIndicator] Subscribing to engine state changes');

		// Subscribe to engine state changes
		const unsubscribe = engine.onStateChange((newState) => {
			console.log('[TranscriptionStatusIndicator] Engine state changed:', newState);
			engineState = newState;
		});

		return () => {
			console.log('[TranscriptionStatusIndicator] Unsubscribing from engine state changes');
			unsubscribe();
		};
	});

	// Map engine state to UI properties
	function getStateInfo() {
		switch (engineState) {
			case 'connecting':
				return {
					label: 'Connecting',
					color: 'text-blue-500',
					bgIcon: 'bg-blue-500/10',
					icon: 'REFRESH',
				};
			case 'listening':
				return {
					label: 'Listening',
					color: 'text-green-500',
					bgIcon: 'bg-green-500/10',
					icon: 'MIC',
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
			{:else if stateInfo.icon === 'REFRESH'}
				<svg
					class="w-3 h-3 {stateInfo.color} animate-spin"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M4 12a8 8 0 018-8V0m0 16a8 8 0 01-8-8m16 0a8 8 0 01-8 8v8m0-16a8 8 0 018 8m0-16v8m-8 16a8 8 0 008-8m-16 0a8 8 0 0016 0"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
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
			{:else if stateInfo.icon === 'REFRESH'}
				<svg
					class="w-3 h-3 {stateInfo.color} animate-spin"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M4 12a8 8 0 018-8V0m0 16a8 8 0 01-8-8m16 0a8 8 0 01-8 8v8m0-16a8 8 0 018 8m0-16v8m-8 16a8 8 0 008-8m-16 0a8 8 0 0016 0"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
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
