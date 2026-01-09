<script lang="ts">
	import { onMount } from 'svelte';
	import { createSession, updateSessionDuration, storeAudioData, storeTranscript } from '$lib/db';
	import { NativeEngine } from '$lib/engines/native';
	import { createMediaRecorder, getSupportedAudioFormat } from '$lib/audio';
	import EqVisualizer from '$lib/components/EqVisualizer.svelte';
	import TranscriptionProvider from '$lib/components/TranscriptionProvider.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';
	import type { TranscriptionResult } from '$lib/types';

	/**
	 * Main Recording Dashboard
	 * Live transcription with audio visualizer and message bubbles
	 */

	let isRecording: boolean = $state(false);
	let isPaused: boolean = $state(false);
	let transcript: TranscriptionResult[] = $state([]);
	let recordingTime: number = $state(0);
	let sessionId: number | null = null;

	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = [];
	let stream: MediaStream | null = null;
	let audioContext: AudioContext | null = $state(null);
	let analyser: AnalyserNode | null = $state(null);
	let engine: NativeEngine | null = $state(null);
	let timerInterval: NodeJS.Timeout | null = null;

	onMount(() => {
		try {
			engine = new NativeEngine();
		} catch (error) {
			console.error('Failed to initialize engine:', error);
		}
	});

	async function startRecording() {
		if (isRecording) return;

		try {
			// Request microphone access
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });

			// Set up audio context and analyser for visualizer
			if (!audioContext) {
				audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
			}
			analyser = audioContext.createAnalyser();
			const source = audioContext.createMediaStreamSource(stream);
			source.connect(analyser);

			// Set up MediaRecorder
			const format = getSupportedAudioFormat();
			mediaRecorder = new MediaRecorder(stream, { mimeType: format.mimeType });
			audioChunks = [];

			mediaRecorder.ondataavailable = (event) => {
				audioChunks.push(event.data);
			};

			mediaRecorder.onstop = async () => {
				const audioBlob = new Blob(audioChunks, { type: format.mimeType });
				if (sessionId) {
					await storeAudioData(sessionId, audioBlob);
					const duration = Date.now() - (startTime || 0);
					await updateSessionDuration(sessionId, duration);
				}
			};

			// Start recording
			mediaRecorder.start();
			isRecording = true;
			isPaused = false;
			recordingTime = 0;
			startTime = Date.now();

			// Create session
			const format_ext = format.mimeType.includes('webm') ? 'WebM' : 'MP4';
			sessionId = await createSession(
				`Session ${new Date().toLocaleTimeString()}`,
				'native',
				format.mimeType
			);

			// Start transcription engine
			if (engine) {
				await engine.start(stream);

				const unsubscribeResult = engine.onResult((result: TranscriptionResult) => {
					transcript = [...transcript, result];
					if (result.isFinal && sessionId) {
						storeTranscript(sessionId, result.text, Date.now() - (startTime || 0), true);
					}
				});

				const unsubscribeError = engine.onError((error) => {
					console.error('Transcription error:', error);
				});
			}

			// Start timer
			timerInterval = setInterval(() => {
				recordingTime = Date.now() - (startTime || 0);
			}, 100);
		} catch (error) {
			console.error('Failed to start recording:', error);
			isRecording = false;
		}
	}

	async function stopRecording() {
		if (!isRecording) return;

		try {
			if (mediaRecorder) {
				mediaRecorder.stop();
			}

			if (engine) {
				await engine.stop();
			}

			if (stream) {
				stream.getTracks().forEach((track) => track.stop());
			}

			if (timerInterval) {
				clearInterval(timerInterval);
			}

			isRecording = false;
			isPaused = false;
		} catch (error) {
			console.error('Failed to stop recording:', error);
		}
	}

	function pauseRecording() {
		if (!isRecording || !mediaRecorder) return;
		mediaRecorder.pause();
		isPaused = true;
	}

	function resumeRecording() {
		if (!isRecording || !mediaRecorder) return;
		mediaRecorder.resume();
		isPaused = false;
	}

	function formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	}

	let startTime: number | null = null;
</script>

<TranscriptionProvider {engine}>
	<div class="max-w-4xl mx-auto space-y-6">
		<!-- Recording Controls -->
		<Card>
			<CardHeader>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle>Live Transcription</CardTitle>
						<CardDescription>Record your voice and see real-time transcription</CardDescription>
					</div>
					<div class="text-3xl font-mono font-bold text-primary">
						{formatTime(recordingTime)}
					</div>
				</div>
			</CardHeader>
			<CardContent class="space-y-6">
				{#if analyser}
					<div>
						<EqVisualizer {analyser} barCount={32} height={150} />
					</div>
				{/if}

				<div class="flex gap-3 flex-wrap">
					{#if !isRecording}
						<Button
							onclick={startRecording}
							variant="destructive"
							class="flex items-center gap-2"
						>
							● Record
						</Button>
					{:else}
						{#if !isPaused}
							<Button
								onclick={pauseRecording}
								variant="secondary"
								class="flex items-center gap-2"
							>
								⏸ Pause
							</Button>
						{:else}
							<Button
								onclick={resumeRecording}
								variant="default"
								class="flex items-center gap-2"
							>
								▶ Resume
							</Button>
						{/if}

						<Button
							onclick={stopRecording}
							variant="outline"
							class="flex items-center gap-2"
						>
							⏹ Stop
						</Button>
					{/if}
				</div>
			</CardContent>
		</Card>

		<!-- Transcription Display -->
		<Card>
			<CardHeader>
				<CardTitle class="text-lg">Transcript</CardTitle>
			</CardHeader>
			<CardContent>
				{#if transcript.length === 0}
					<p class="text-muted-foreground text-center py-8">No transcription yet. Start recording to begin.</p>
				{:else}
					<div class="space-y-3">
						{#each transcript as item, idx (idx)}
							<div class="flex {item.isFinal ? 'justify-end' : 'justify-start'}">
								<div
									class="{item.isFinal
										? 'bg-primary text-primary-foreground'
										: 'bg-accent/10 text-foreground'} rounded-lg px-4 py-2 max-w-xs"
								>
									<p class="text-sm">{item.text}</p>
									{#if item.confidence !== undefined}
										<p class="text-xs {item.isFinal ? 'text-primary-foreground/70' : 'text-muted-foreground'} mt-1">
											Confidence: {(item.confidence * 100).toFixed(0)}%
										</p>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>
</TranscriptionProvider>
