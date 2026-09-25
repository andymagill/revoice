<script lang="ts">
	import { Mic } from '@lucide/svelte';
	import { formatDuration } from '$lib/utils';
	import type { RecordingState } from '$lib/recorder.svelte';

	/**
	 * Large microphone button, timer and status text.
	 *
	 * Purely presentational: the parent decides what a click means for the current state
	 * (start / pause / resume) and whether recording is currently allowed.
	 */
	interface Props {
		recordingState: RecordingState;
		/** Elapsed time in milliseconds. */
		recordingTime: number;
		/** Disable the button (e.g. while viewing a past session, which cannot be appended to). */
		disabled?: boolean;
		onMicClick: () => void;
	}

	let { recordingState, recordingTime, disabled = false, onMicClick }: Props = $props();

	const isRecording = $derived(recordingState === 'recording');
	const isPaused = $derived(recordingState === 'paused');

	const buttonTitle = $derived(
		disabled
			? 'Click "New Session" to start a new recording'
			: isRecording
				? 'Click to pause recording'
				: isPaused
					? 'Click to resume recording'
					: 'Click to start recording'
	);
</script>

<div class="flex flex-col items-center justify-center gap-2 p-4">
	<div class="relative">
		<!-- Spinning + throbbing ring while recording -->
		{#if isRecording}
			<div
				class="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 border-r-red-500 pointer-events-none animate-spin"
				style="animation-duration: 2s;"
			></div>
			<div
				class="throb absolute inset-0 rounded-full border-2 border-red-500 opacity-20 pointer-events-none"
			></div>
		{/if}

		<button
			onclick={onMicClick}
			{disabled}
			title={buttonTitle}
			class="
				w-40 h-40 rounded-full flex flex-col items-center justify-center
				transition-all duration-300 transform
				focus:outline-none focus:ring-4 focus:ring-offset-2
				disabled:opacity-50 disabled:cursor-not-allowed
				{isRecording
				? 'bg-red-500 text-white shadow-xl shadow-red-500/50 hover:shadow-2xl hover:shadow-red-500/70 focus:ring-red-500/50'
				: isPaused
					? 'bg-amber-500 text-white shadow-xl shadow-amber-500/50 hover:shadow-2xl hover:shadow-amber-500/70 focus:ring-amber-500/50'
					: 'bg-blue-600 text-white shadow-lg focus:ring-blue-500/50 enabled:hover:bg-blue-700 enabled:hover:scale-110 enabled:hover:shadow-2xl enabled:hover:shadow-blue-500/50 enabled:active:scale-95'}
			"
		>
			<Mic class="w-20 h-20" strokeWidth={1.5} />
			<p class="text-xs font-semibold mt-2">
				{#if isRecording}
					Recording
				{:else if isPaused}
					Paused
				{:else}
					Ready
				{/if}
			</p>
		</button>
	</div>

	<div
		class="text-5xl font-mono font-bold transition-colors duration-300 {isRecording
			? 'text-red-500'
			: isPaused
				? 'text-amber-500'
				: 'text-gray-600'}"
	>
		{formatDuration(recordingTime)}
	</div>

	<p class="text-sm text-muted-foreground text-center max-w-xs">
		{#if disabled}
			Viewing a saved session. Click New Session to record again.
		{:else if isPaused}
			Paused. Use playback controls to review. Click mic to resume recording.
		{:else if isRecording}
			Recording in progress. Click to pause and preview.
		{:else}
			Record your voice and see real-time transcription
		{/if}
	</p>
</div>

<style>
	@keyframes throb {
		0%,
		100% {
			opacity: 0.2;
			transform: scale(1);
		}
		50% {
			opacity: 0;
			transform: scale(1.1);
		}
	}

	.throb {
		animation: throb 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
</style>
