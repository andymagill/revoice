<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Mic } from 'lucide-svelte';

	interface Props {
		/** Current recording state: 'idle' | 'recording' | 'paused' */
		recordingState: 'idle' | 'recording' | 'paused';

		/** Elapsed recording time in milliseconds */
		recordingTime: number;

		/** Callback when microphone button is clicked */
		onMicClick: () => void;

		/** Callback to show clear confirmation dialog */
		onShowClearConfirm: () => void;
	}

	let { recordingState, recordingTime, onMicClick, onShowClearConfirm }: Props = $props();

	// Derived state for convenience
	const isRecording = $derived(recordingState === 'recording');
	const isPaused = $derived(recordingState === 'paused');
	const isActive = $derived(recordingState !== 'idle');

	function formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<div class="flex flex-col items-center justify-center gap-2 py-2">
	<!-- Large Microphone Button with Animation -->
	<div class="relative">
		<!-- Rotating/Throbbing border when recording -->
		{#if isRecording && !isPaused}
			<div
				class="absolute inset-0 rounded-full border-2 border-transparent border-t-red-500 border-r-red-500 pointer-events-none"
				style="animation: spin 2s linear infinite;"
			></div>
			<div
				class="absolute inset-0 rounded-full border-2 border-red-500 opacity-20 pointer-events-none"
				style="animation: throb 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;"
			></div>
		{/if}

		<!-- Main Button Circle -->
		<button
			onclick={onMicClick}
			class="
			w-40 h-40 rounded-full flex flex-col items-center justify-center
			transition-all duration-300 transform
			{isRecording && !isPaused
				? 'bg-red-500 text-white shadow-xl shadow-red-500/50 hover:shadow-2xl hover:shadow-red-500/70'
				: isRecording && isPaused
					? 'bg-amber-500 text-white shadow-xl shadow-amber-500/50 hover:shadow-2xl hover:amber-500/70'
					: 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-110 hover:shadow-2xl hover:shadow-blue-500/50 active:scale-95 shadow-lg'}
			focus:outline-none focus:ring-4 focus:ring-offset-2
			{isRecording && !isPaused
				? 'focus:ring-red-500/50'
				: isRecording && isPaused
					? 'focus:ring-amber-500/50'
					: 'focus:ring-blue-500/50'}
		"
			title={isRecording
				? isPaused
					? 'Click to resume recording'
					: 'Click to pause recording'
				: 'Click to start recording'}
		>
			<!-- Microphone Icon from lucide-svelte -->
			<Mic class="w-20 h-20" strokeWidth={1.5} />
			<!-- Status Label inside button -->
			<p class="text-xs font-semibold mt-2">
				{#if !isRecording}
					Ready
				{:else if isPaused}
					Paused
				{:else}
					Recording
				{/if}
			</p>
		</button>
	</div>

	<!-- Recording Time Display -->
	<div class="text-center">
		<div
			class="text-5xl font-mono font-bold {isRecording && !isPaused
				? 'text-red-500'
				: isRecording && isPaused
					? 'text-amber-500'
					: 'text-gray-600'} transition-colors duration-300"
		>
			{formatTime(recordingTime)}
		</div>
	</div>

	<!-- Clear Button -->
	<div class="flex flex-col items-center gap-3">
		{#if isActive}
			<Button
				onclick={onShowClearConfirm}
				variant="outline"
				size="sm"
				class="flex items-center gap-2"
			>
				✕ Clear
			</Button>
		{/if}
	</div>

	<!-- Status Description -->
	<p class="text-sm text-muted-foreground text-center max-w-xs">
		{#if recordingState === 'idle'}
			Record your voice and see real-time transcription
		{:else if recordingState === 'paused'}
			Paused. Use playback controls to review. Click mic to resume recording.
		{:else}
			Recording in progress. Click to pause and preview.
		{/if}
	</p>
</div>
