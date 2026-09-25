<script lang="ts">
	import { Circle, LoaderCircle, Mic } from '@lucide/svelte';
	import { getTranscriptionEngine } from '$lib/context';
	import type { EngineState } from '$lib/types';

	/**
	 * Small status badge showing the transcription engine's state:
	 * idle (grey) → connecting (blue, spinning) → listening (green).
	 * Updates live by subscribing to the engine from context; shows "Idle" when there is
	 * no engine.
	 */
	const engine = getTranscriptionEngine();

	let engineState = $state<EngineState>(engine?.getState() ?? 'idle');

	$effect(() => {
		if (!engine) return;
		engineState = engine.getState();
		// onStateChange returns its unsubscribe function, which serves as the cleanup.
		return engine.onStateChange((next) => {
			engineState = next;
		});
	});

	const STATE_INFO: Record<EngineState, { label: string; color: string; background: string }> = {
		idle: { label: 'Idle', color: 'text-muted-foreground', background: 'bg-muted' },
		connecting: { label: 'Connecting', color: 'text-blue-500', background: 'bg-blue-500/10' },
		listening: { label: 'Listening', color: 'text-green-500', background: 'bg-green-500/10' },
	};

	const info = $derived(STATE_INFO[engineState]);
</script>

<div class="flex flex-row items-center gap-2 justify-end text-sm" aria-live="polite">
	<div class="flex-shrink-0 {info.background} p-1.5 rounded-full">
		{#if engineState === 'listening'}
			<Mic class="w-3 h-3 {info.color}" />
		{:else if engineState === 'connecting'}
			<LoaderCircle class="w-3 h-3 {info.color} animate-spin" />
		{:else}
			<Circle class="w-3 h-3 {info.color} fill-current" />
		{/if}
	</div>
	<span class="text-muted-foreground text-xs font-medium">{info.label}</span>
</div>
