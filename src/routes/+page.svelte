<script lang="ts">
	import { onMount } from 'svelte';
	import { createSession, updateSessionDuration, storeAudioData, storeTranscript } from '$lib/db';
	import { NativeEngine } from '$lib/engines/native';
	import { createMediaRecorder, getSupportedAudioFormat } from '$lib/audio';
	import EqVisualizer from '$lib/components/EqVisualizer.svelte';
	import TranscriptionProvider from '$lib/components/TranscriptionProvider.svelte';
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
	<div class="max-w-4xl mx-auto">
		<!-- Recording Controls -->
		<div class="bg-white rounded-lg shadow p-6 mb-6">
			<div class="flex items-center justify-between mb-4">
				<div>
					<h2 class="text-2xl font-bold text-gray-900">Live Transcription</h2>
					<p class="text-gray-500 text-sm mt-1">Record your voice and see real-time transcription</p>
				</div>
				<div class="text-3xl font-mono font-bold text-blue-600">
					{formatTime(recordingTime)}
				</div>
			</div>

			{#if analyser}
				<div class="mb-6">
					<EqVisualizer {analyser} barCount={32} height={150} />
				</div>
			{/if}

			<div class="flex gap-3 flex-wrap">
				{#if !isRecording}
					<button
						onclick={startRecording}
						class="px-6 py-3 bg-red-600 text-white rounded font-semibold hover:bg-red-700 transition flex items-center gap-2"
					>
						● Record
					</button>
				{:else}
					{#if !isPaused}
						<button
							onclick={pauseRecording}
							class="px-6 py-3 bg-yellow-600 text-white rounded font-semibold hover:bg-yellow-700 transition flex items-center gap-2"
						>
							⏸ Pause
						</button>
					{:else}
						<button
							onclick={resumeRecording}
							class="px-6 py-3 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 transition flex items-center gap-2"
						>
							▶ Resume
						</button>
					{/if}

					<button
						onclick={stopRecording}
						class="px-6 py-3 bg-gray-600 text-white rounded font-semibold hover:bg-gray-700 transition flex items-center gap-2"
					>
						⏹ Stop
					</button>
				{/if}
			</div>
		</div>

		<!-- Transcription Display -->
		<div class="bg-white rounded-lg shadow p-6">
			<h3 class="text-lg font-semibold text-gray-900 mb-4">Transcript</h3>

			{#if transcript.length === 0}
				<p class="text-gray-500 text-center py-8">No transcription yet. Start recording to begin.</p>
			{:else}
				<div class="space-y-3">
					{#each transcript as item, idx (idx)}
						<div class="flex {item.isFinal ? 'justify-end' : 'justify-start'}">
							<div
								class="{item.isFinal
									? 'bg-blue-500 text-white'
									: 'bg-gray-200 text-gray-700'} rounded-lg px-4 py-2 max-w-xs"
							>
								<p class="text-sm">{item.text}</p>
								{#if item.confidence !== undefined}
									<p class="text-xs {item.isFinal ? 'text-blue-100' : 'text-gray-500'} mt-1">
										Confidence: {(item.confidence * 100).toFixed(0)}%
									</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</TranscriptionProvider>
