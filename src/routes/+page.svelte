<script lang="ts">
	import { onMount } from 'svelte';
	import { getSessionStore } from '$lib/context';
	import { NativeEngine } from '$lib/engines/native';
	import { Recorder } from '$lib/recorder.svelte';
	import AudioPlaybackControls from '$lib/components/AudioPlaybackControls.svelte';
	import AudioPlaybackProvider from '$lib/components/AudioPlaybackProvider.svelte';
	import EqVisualizer from '$lib/components/EqVisualizer.svelte';
	import RecordingControls from '$lib/components/RecordingControls.svelte';
	import TranscriptionProvider from '$lib/components/TranscriptionProvider.svelte';
	import TranscriptionStatusIndicator from '$lib/components/TranscriptionStatusIndicator.svelte';
	import TranscriptView from '$lib/components/TranscriptView.svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';

	/**
	 * Recording dashboard.
	 *
	 * Pure composition: the Recorder owns the recording state machine and the data on
	 * screen, the SessionStore (from the layout) owns which session is selected, and this
	 * page wires them together and lays out the widgets.
	 */

	const store = getSessionStore();

	/**
	 * Speech recognition can be unavailable (e.g. Firefox). Audio recording still works, so a
	 * missing engine degrades the transcript panel instead of blanking the page.
	 */
	function createEngine(): NativeEngine | null {
		try {
			return new NativeEngine();
		} catch (error) {
			console.warn('Speech recognition unavailable:', error);
			return null;
		}
	}

	const engine = createEngine();

	const recorder = new Recorder(engine, {
		// The recorder created a session: show it as selected and list it in the sidebar.
		sessionCreated: (session) => {
			store.adopt(session);
			void store.refresh();
		},
		// Durations in the sidebar change after each save.
		audioSaved: () => void store.refresh(),
	});

	/** Element currently loaded by the playback controls; drives the visualizer source. */
	let playbackAudio = $state.raw<HTMLAudioElement | null>(null);

	/**
	 * A saved session is view-only: its audio is one finished file, and a new MediaRecorder
	 * would produce a second file that cannot be joined to it. The user starts a new
	 * session instead.
	 */
	const micDisabled = $derived(recorder.state === 'idle' && store.selected !== null);

	function handleMicClick() {
		switch (recorder.state) {
			case 'idle':
				void recorder.start();
				break;
			case 'recording':
				void recorder.pause();
				break;
			case 'paused':
				void recorder.resume();
				break;
		}
	}

	onMount(() => {
		// Selecting or resetting a session must first save whatever is being recorded.
		const detach = store.attach({
			open: async (session) => {
				await recorder.finalize();
				await recorder.open(session);
			},
			reset: async () => {
				await recorder.finalize();
				recorder.reset();
			},
		});

		return () => {
			detach();
			recorder.dispose();
		};
	});
</script>

<TranscriptionProvider {engine}>
	<AudioPlaybackProvider audio={playbackAudio}>
		<div class="space-y-6 sm:p-4">
			<!-- Two columns on large screens: controls | playback + visualizer -->
			<div
				class="lg:grid lg:gap-6 lg:items-start space-y-6 lg:space-y-0"
				style="grid-template-columns: auto 1fr;"
			>
				<div class="flex flex-col items-center lg:items-start">
					<RecordingControls
						recordingState={recorder.state}
						recordingTime={recorder.elapsedMs}
						disabled={micDisabled}
						onMicClick={handleMicClick}
					/>
					{#if recorder.error}
						<p class="text-sm text-destructive text-center max-w-xs px-4" role="alert">
							{recorder.error}
						</p>
					{/if}
				</div>

				<div class="space-y-6">
					<Card>
						<CardContent>
							<AudioPlaybackControls
								blob={recorder.audioBlob}
								disabled={recorder.state === 'recording'}
								durationMs={recorder.elapsedMs}
								onAudioChange={(audio) => (playbackAudio = audio)}
							/>
						</CardContent>
					</Card>

					<div class="space-y-2">
						<p class="text-xs text-muted-foreground px-2">
							{playbackAudio ? 'Audio Output' : 'Recording Input'}
						</p>
						<EqVisualizer
							recordingAnalyser={recorder.analyser ?? undefined}
							barCount={32}
							height={150}
							disabled={recorder.state === 'idle' && !playbackAudio}
							frozen={recorder.state === 'paused' && !playbackAudio}
						/>
					</div>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div class="flex flex-row justify-between gap-2">
						<CardTitle class="text-lg">Transcript</CardTitle>
						<TranscriptionStatusIndicator />
					</div>
				</CardHeader>
				<CardContent>
					<TranscriptView
						finals={recorder.finals}
						interim={recorder.interim}
						notice={engine
							? undefined
							: 'Live transcription is not supported in this browser. Audio will still be recorded.'}
					/>
				</CardContent>
			</Card>
		</div>
	</AudioPlaybackProvider>
</TranscriptionProvider>
