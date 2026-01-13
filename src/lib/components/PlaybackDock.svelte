<script lang="ts">
	import { getContext } from 'svelte';
	import { Play, Pause, X } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import EqVisualizer from './EqVisualizer.svelte';

	interface Props {
		playingAudio: HTMLAudioElement | null;
		currentPlayingSessionId: number | null;
		onClose?: () => void;
	}

	let { playingAudio, currentPlayingSessionId, onClose }: Props = $props();

	// Get audio context from provider
	const audioPlayback = getContext<{
		audio: HTMLAudioElement | null;
		audioContext: AudioContext | null;
		analyser: AnalyserNode | null;
		isConnected: boolean;
	}>('audioPlayback');

	function formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	}

	// Create reactive states for display
	let currentTime = $state(0);
	let duration = $state(0);
	let isPaused = $state(true);

	// Update time display
	$effect(() => {
		if (playingAudio) {
			const updateTime = () => {
				currentTime = playingAudio!.currentTime * 1000;
				duration = playingAudio!.duration * 1000;
				isPaused = playingAudio!.paused;
			};

			playingAudio.addEventListener('timeupdate', updateTime);
			playingAudio.addEventListener('loadedmetadata', updateTime);
			playingAudio.addEventListener('play', updateTime);
			playingAudio.addEventListener('pause', updateTime);

			return () => {
				playingAudio?.removeEventListener('timeupdate', updateTime);
				playingAudio?.removeEventListener('loadedmetadata', updateTime);
				playingAudio?.removeEventListener('play', updateTime);
				playingAudio?.removeEventListener('pause', updateTime);
			};
		}
	});
</script>

<Card class="bg-background border-t border-border rounded-none border-l-0 border-r-0">
	<CardContent class="py-3 space-y-3">
		<!-- Playback Controls Row -->
		<div class="flex items-center justify-between">
			<div class="flex items-center space-x-4">
				<Button
					onclick={() => {
						if (playingAudio) {
							if (playingAudio.paused) {
								playingAudio.play();
							} else {
								playingAudio.pause();
							}
						}
					}}
					variant="ghost"
					size="icon"
					class="p-2"
					disabled={false}
				>
					{#if isPaused}
						<Play class="h-4 w-4" />
					{:else}
						<Pause class="h-4 w-4" />
					{/if}
				</Button>
				<div>
					<p class="text-sm font-medium text-foreground">Playing Audio</p>
					<p class="text-xs text-muted-foreground tabular-nums">
						{formatTime(currentTime)} / {formatTime(duration)}
					</p>
				</div>
			</div>
			<Button
				onclick={() => {
					if (playingAudio) {
						playingAudio.pause();
					}
					onClose?.();
				}}
				variant="ghost"
				size="icon"
				class="p-2 text-muted-foreground"
				disabled={false}
			>
				<X class="h-4 w-4" />
			</Button>
		</div>

		<!-- EQ Visualizer for Playback -->
		{#if audioPlayback?.analyser}
			<div class="w-full">
				<EqVisualizer
					recordingAnalyser={audioPlayback.analyser}
					barCount={32}
					height={80}
					disabled={false}
					frozen={isPaused}
				/>
			</div>
		{/if}
	</CardContent>
</Card>
