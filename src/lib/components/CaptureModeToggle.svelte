<script lang="ts">
	import { Mic, FileText } from '@lucide/svelte';
	import type { CaptureMode } from '$lib/capture-mode';

	/**
	 * Audio / Transcribe switch for devices where the two cannot run together (Android).
	 *
	 * Purely presentational: the parent owns the mode and decides when it may change.
	 */
	interface Props {
		mode: CaptureMode;
		/** Locked while a recording is in progress. */
		disabled?: boolean;
		onChange: (mode: CaptureMode) => void;
	}

	let { mode, disabled = false, onChange }: Props = $props();

	const OPTIONS = [
		{ value: 'transcript', label: 'Transcribe', icon: FileText },
		{ value: 'audio', label: 'Record audio', icon: Mic },
	] as const;
</script>

<div class="flex flex-col items-center gap-2 px-4">
	<div class="inline-flex rounded-md border p-0.5" role="group" aria-label="What to capture">
		{#each OPTIONS as option (option.value)}
			<button
				type="button"
				{disabled}
				aria-pressed={mode === option.value}
				onclick={() => onChange(option.value)}
				class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 {mode ===
				option.value
					? 'bg-primary text-primary-foreground'
					: 'text-muted-foreground enabled:hover:text-foreground'}"
			>
				<option.icon class="size-4" />
				{option.label}
			</button>
		{/each}
	</div>
	<p class="text-xs text-muted-foreground text-center max-w-xs">
		{#if mode === 'transcript'}
			Live transcript only; no audio is saved. Android plays a sound each time speech recognition
			restarts.
		{:else}
			Audio is saved; live transcription is off. Android cannot do both at once.
		{/if}
	</p>
</div>
