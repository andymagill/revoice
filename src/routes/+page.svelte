<script lang="ts">
	import { onMount } from 'svelte';
	import { createSession, updateSessionDuration, storeAudioData, storeTranscript } from '$lib/db';
	import { NativeEngine } from '$lib/engines/native';
	import { createMediaRecorder, getSupportedAudioFormat } from '$lib/audio';
	import EqVisualizer from '$lib/components/EqVisualizer.svelte';
	import TranscriptionProvider from '$lib/components/TranscriptionProvider.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
	} from '$lib/components/ui/card/index.js';
	import { Mic } from 'lucide-svelte';
	import type { TranscriptionResult } from '$lib/types';

	/**
	 * Main Recording Dashboard
	 * Live transcription with audio visualizer and message bubbles
	 */

	let isRecording: boolean = $state(false);
	let isPaused: boolean = $state(false);

	/**
	 * STREAMING TRANSCRIPTION STATE PATTERN
	 *
	 * Instead of storing all results (interim + final) in a single array,
	 * we separate state into two distinct categories:
	 *
	 * 1. finalResults: Array of completed transcriptions
	 *    - Only contains finalized speech segments
	 *    - Never changes once added
	 *    - Displayed as chat-like messages (right-aligned)
	 *
	 * 2. currentInterim: Single interim result that updates in real-time
	 *    - Represents what's currently being spoken
	 *    - Updates as speech recognition processes audio
	 *    - Replaced with null when finalized
	 *    - Displayed as temporary preview (left-aligned, semi-transparent)
	 *
	 * ## Benefits:
	 * - No duplicate entries in UI (old problem: "Hello", "Hello world", "Hello world")
	 * - Clean visual progression: interim updates → becomes final
	 * - Efficient re-renders (only current interim changes, finals are immutable)
	 * - Clear separation of temporary vs permanent transcriptions
	 *
	 * ## Example Flow:
	 * User says "Hello world":
	 * 1. currentInterim = { text: "Hello", isFinal: false }
	 * 2. currentInterim = { text: "Hello world", isFinal: false }  // Updates in place
	 * 3. finalResults.push({ text: "Hello world", isFinal: true }) // Added to finals
	 *    currentInterim = null                                       // Cleared
	 */
	let finalResults: TranscriptionResult[] = $state([]);
	let currentInterim: TranscriptionResult | null = $state(null);
	let recordingTime: number = $state(0);
	let sessionId: number | null = null;
	let showClearConfirm: boolean = $state(false);
	let suppressTranscriptionErrors: boolean = false;

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
					/**
					 * RESULT HANDLER PATTERN
					 *
					 * This handler receives transcription results from the engine and manages
					 * the state transition from interim → final results.
					 *
					 * ## State Transitions:
					 *
					 * INTERIM RESULTS (isFinal = false):
					 * - Replace currentInterim with the new result
					 * - This creates an "updating in place" effect in the UI
					 * - Not persisted to database (only shown in live view)
					 *
					 * FINAL RESULTS (isFinal = true):
					 * - Append to finalResults array (immutable pattern)
					 * - Clear currentInterim (it's now finalized)
					 * - Persist to database for long-term storage
					 *
					 * ## Why This Works:
					 * The engine (NativeEngine) ensures each result is emitted only once,
					 * with interim results updating and final results marking completion.
					 * This handler simply routes results to the appropriate state container.
					 */

					// Only process results if not paused
					if (!isPaused) {
						if (result.isFinal) {
							// Add final result to the immutable list
							finalResults = [...finalResults, result];
							// Clear interim result since it's now final
							currentInterim = null;
							// Persist final result to database
							if (sessionId) {
								storeTranscript(sessionId, result.text, Date.now() - (startTime || 0), true);
							}
						} else {
							// Update current interim result (replaces previous interim)
						}
					}
				});

				const unsubscribeError = engine.onError((error) => {
					// Suppress errors when paused since the recognition times out naturally
					if (suppressTranscriptionErrors) {
						console.debug('Suppressed error during pause:', error.message);
						return;
					}
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

	async function confirmClearRecording() {
		showClearConfirm = false;
		await clearRecording();
	}

	async function clearRecording() {
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

			// Clear all recording state
			isRecording = false;
			isPaused = false;
			finalResults = [];
			currentInterim = null;
			recordingTime = 0;
			analyser = null;
			sessionId = null;
		} catch (error) {
			console.error('Failed to clear recording:', error);
		}
	}

	async function pauseRecording() {
		if (!isRecording || !mediaRecorder) return;
		try {
			mediaRecorder.pause();
			isPaused = true;
			suppressTranscriptionErrors = true;

			// Stop the timer when paused
			if (timerInterval) {
				clearInterval(timerInterval);
				timerInterval = null;
			}

			console.log('Recording paused');
		} catch (error) {
			console.error('Error pausing recording:', error);
		}
	}

	async function resumeRecording() {
		if (!isRecording || !mediaRecorder) return;
		try {
			mediaRecorder.resume();
			suppressTranscriptionErrors = false;

			// Restart timer
			timerInterval = setInterval(() => {
				recordingTime = Date.now() - (startTime || 0);
			}, 100);

			isPaused = false;
			console.log('Recording resumed');
		} catch (error) {
			console.error('Error resuming recording:', error);
		}
	}

	function formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	}

	async function handleMicClick() {
		if (!isRecording) {
			// Start recording
			await startRecording();
		} else if (isPaused) {
			// Resume recording
			await resumeRecording();
		} else {
			// Pause recording
			await pauseRecording();
		}
	}

	let startTime: number | null = null;
</script>

<TranscriptionProvider {engine}>
	<div class="max-w-6xl mx-auto space-y-6 px-4">
		<!-- Recording Controls Section -->
		<div class="lg:flex lg:gap-6 lg:items-start">
			<!-- Left Column: Centered Controls -->
			<div class="flex-1 flex flex-col items-center justify-center gap-4 py-8 lg:py-0">
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
						onclick={handleMicClick}
						class="
							w-40 h-40 rounded-full flex items-center justify-center
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

				<!-- State Label and Clear Button -->
				<div class="flex flex-col items-center gap-3">
					<!-- Status Label below time -->
					<p
						class="text-sm font-medium {isRecording && !isPaused
							? 'text-red-500'
							: isRecording && isPaused
								? 'text-amber-500'
								: 'text-blue-600'} transition-colors duration-300"
					>
						{#if !isRecording}
							Ready
						{:else if isPaused}
							Paused
						{:else}
							Recording
						{/if}
					</p>

					<!-- Clear Recording Button (only show during recording) -->
					{#if isRecording}
						<Button
							onclick={() => (showClearConfirm = true)}
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
					{#if !isRecording}
						Record your voice and see real-time transcription
					{:else if isPaused}
						Recording paused. Click the microphone to resume.
					{:else}
						Recording in progress. Click to pause.
					{/if}
				</p>
			</div>

			<!-- Right Column: EQ Visualizer (hidden on mobile) -->
			<div class="hidden lg:flex lg:flex-1 lg:items-center lg:justify-center">
				<div class="w-full">
					<EqVisualizer
						{analyser}
						barCount={32}
						height={250}
						barColor={isRecording && !isPaused
							? '#ef4444'
							: isRecording && isPaused
								? '#f59e0b'
								: '#3b82f6'}
						disabledBarColor="#d1d5db"
						disabled={!isRecording}
					/>
				</div>
			</div>
		</div>

		<!-- Mobile EQ Visualizer (shown below controls on mobile) -->
		<div class="lg:hidden">
			<EqVisualizer
				{analyser}
				barCount={32}
				height={200}
				barColor={isRecording && !isPaused
					? '#ef4444'
					: isRecording && isPaused
						? '#f59e0b'
						: '#3b82f6'}
				disabledBarColor="#d1d5db"
				disabled={!isRecording}
			/>
		</div>

		<!-- Confirmation Dialog -->
		{#if showClearConfirm}
			<div
				class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
				onclick={() => (showClearConfirm = false)}
			>
				<Card class="w-full max-w-sm mx-4" onclick={(e) => e.stopPropagation()}>
					<CardHeader>
						<CardTitle>Clear Recording?</CardTitle>
						<CardDescription>
							This will stop the current recording and clear the transcript. This action cannot be
							undone.
						</CardDescription>
					</CardHeader>
					<CardContent class="flex gap-3">
						<Button onclick={() => (showClearConfirm = false)} variant="outline" class="flex-1">
							Cancel
						</Button>
						<Button onclick={confirmClearRecording} variant="destructive" class="flex-1">
							Clear
						</Button>
					</CardContent>
				</Card>
			</div>
		{/if}

		<!-- Transcription Display -->
		<Card>
			<CardHeader>
				<CardTitle class="text-lg">Transcript</CardTitle>
			</CardHeader>
			<CardContent>
				<!--
				DISPLAY RENDERING PATTERN
				
				This component renders transcription results in a chat-like interface:
				
				1. FINAL RESULTS (right-aligned, primary color, solid):
				   - Completed transcriptions that won't change
				   - Each rendered as a separate message bubble
				   - Visually distinct as "committed" transcriptions
				
				2. CURRENT INTERIM (left-aligned, muted color, semi-transparent):
				   - Live preview of what's being spoken
				   - Updates in place as speech recognition progresses
				   - Visual feedback: "This is still being processed"
				   - Disappears when finalized (becomes a final result)
				
				Visual Hierarchy:
				- Opacity difference (100% vs 70%) indicates confidence
				- Alignment (right vs left) shows status
				- Color scheme differentiates temporary vs permanent
			-->
				{#if finalResults.length === 0 && !currentInterim}
					<p class="text-muted-foreground text-center py-8">
						No transcription yet. Start recording to begin.
					</p>
				{:else}
					<div class="space-y-3">
						<!-- FINAL RESULTS: Immutable list of completed transcriptions -->
						{#each finalResults as item, idx (idx)}
							<div class="flex justify-end">
								<div class="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-xs">
									<p class="text-sm">{item.text}</p>
									{#if item.confidence !== undefined}
										<p class="text-xs text-primary-foreground/70 mt-1">
											Confidence: {(item.confidence * 100).toFixed(0)}%
										</p>
									{/if}
								</div>
							</div>
						{/each}

						<!-- 
						CURRENT INTERIM RESULT:
						Only one interim result exists at any time (not an array).
						It updates in place as the user speaks, creating a "typewriter" effect.
						Once finalized, it moves to the finalResults array above.
						The opacity-70 class provides visual feedback that this is temporary.
					-->
						{#if currentInterim}
							<div class="flex justify-start">
								<div class="bg-accent/10 text-foreground rounded-lg px-4 py-2 max-w-xs opacity-70">
									<p class="text-sm">{currentInterim.text}</p>
									{#if currentInterim.confidence !== undefined}
										<p class="text-xs text-muted-foreground mt-1">
											Confidence: {(currentInterim.confidence * 100).toFixed(0)}%
										</p>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>
</TranscriptionProvider>

<style>
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes throb {
		0% {
			opacity: 0.2;
			transform: scale(1);
		}
		50% {
			opacity: 0;
			transform: scale(1.1);
		}
		100% {
			opacity: 0.2;
			transform: scale(1);
		}
	}
</style>
