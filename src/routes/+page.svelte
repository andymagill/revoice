<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import {
		createSession,
		updateSessionDuration,
		storeAudioData,
		storeTranscript,
		getSessionAudio,
		getSessionTranscripts,
		type Session,
	} from '$lib/db';
	import { NativeEngine } from '$lib/engines/native';
	import {
		createMediaRecorder,
		getSupportedAudioFormat,
		getSharedAudioContext,
		blobToBase64,
	} from '$lib/audio';
	import EqVisualizer from '$lib/components/EqVisualizer.svelte';
	import AudioPlaybackControls from '$lib/components/AudioPlaybackControls.svelte';
	import RecordingControls from '$lib/components/RecordingControls.svelte';
	import AudioPlaybackProvider from '$lib/components/AudioPlaybackProvider.svelte';
	import TranscriptionProvider from '$lib/components/TranscriptionProvider.svelte';
	import TranscriptionStatusIndicator from '$lib/components/TranscriptionStatusIndicator.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle,
	} from '$lib/components/ui/card/index.js';
	import type { TranscriptionResult } from '$lib/types';

	/**
	 * Main Recording Dashboard
	 * Live transcription with audio visualizer and message bubbles
	 */

	/**
	 * FINITE STATE MACHINE FOR RECORDING
	 *
	 * States:
	 * - 'idle': No recording session, ready to start
	 * - 'recording': Active recording in progress, playback disabled
	 * - 'paused': Recording paused, auto-saved to IndexedDB, playback enabled
	 *
	 * Valid Transitions:
	 * idle -> recording (start)
	 * recording -> paused (pause, auto-saves)
	 * paused -> recording (resume, continues recording)
	 * paused -> idle (clear/discard)
	 *
	 * Key Behaviors:
	 * - Pausing creates blob from all chunks and saves to IndexedDB
	 * - Resuming continues recording, chunks accumulate
	 * - Pausing again overwrites IndexedDB with complete audio
	 * - No data loss: every pause = auto-save
	 */
	type RecordingState = 'idle' | 'recording' | 'paused';
	let recordingState = $state<RecordingState>('idle');

	// Derived state for convenience
	const isRecording = $derived(recordingState === 'recording');
	const isPaused = $derived(recordingState === 'paused');
	const isActive = $derived(recordingState !== 'idle');

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
	let sessionDuration: number = $state(0); // Duration of loaded/paused session for playback
	let sessionId: number | null = null;
	let suppressTranscriptionErrors: boolean = false;

	let mediaRecorder: MediaRecorder | null = null;
	let audioChunks: Blob[] = $state([]);
	let headerChunk: Blob | null = $state(null); // First chunk with container headers
	let stream: MediaStream | null = null;
	let audioContext: AudioContext | null = $state(null);
	let analyser: AnalyserNode | null = $state(null);
	let currentAudioBlob: Blob | null = $state(null);
	let playbackAudio: HTMLAudioElement | null = $state(null);
	let engine: NativeEngine | null = $state(null);
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	// Get currentSession context from layout
	const sessionContext = getContext<{
		current: Session | null;
		set(value: Session | null): void;
		clearRequested: boolean;
	}>('currentSession');

	// Load session data when currentSession changes from sidebar selection
	/**
	 * CRITICAL: This effect responds to context changes from the layout sidebar.
	 * It handles THREE distinct use cases:
	 *
	 * 1. USER CLICKS SESSION IN SIDEBAR (selectedSession?.id is set):
	 *    - Load blob from IndexedDB
	 *    - Load transcripts from database
	 *    - Set local sessionId to loaded session ID
	 *    - Reset recordingState to 'idle' (not recording the loaded session)
	 *
	 * 2. USER CLICKS "NEW SESSION" BUTTON (clearRequested === true):
	 *    - ALWAYS clear all state (recording, playback, transcripts)
	 *    - Stop current playback audio
	 *    - Reset recording state to 'idle'
	 *    - Clear sessionId to start fresh
	 *
	 * 3. NORMAL NAVIGATION (selectedSession === null && !clearRequested):
	 *    - DON'T clear state (prevents wiping on pause)
	 *    - Preserves transcripts during active recording sessions
	 *
	 * REGRESSION RISK: If you check only selectedSession === null, this effect will
	 * clear finalResults whenever currentSession becomes null, which happens after
	 * pausing a new recording. The clearRequested flag distinguishes explicit user
	 * intent ("New Session" button) from normal state changes (pause/navigation).
	 */
	$effect(() => {
		const selectedSession = sessionContext?.current;
		const clearFlag = sessionContext?.clearRequested ?? false;
		console.log('[+page.svelte] Session selection effect triggered:', {
			selectedSessionId: selectedSession?.id ?? null,
			currentSessionId: sessionId,
			isRecording,
			clearRequested: clearFlag,
		});
		if (selectedSession?.id) {
			(async () => {
				try {
					// Load the audio blob for this session
					console.log('[+page.svelte] Loading blob from sidebar selection:', selectedSession.id);
					const blob = await getSessionAudio(selectedSession.id!);
					console.log('[+page.svelte] Blob loaded from sidebar:', {
						blobExists: blob !== null,
						blobSize: blob?.size ?? null,
					});
					if (blob) {
						currentAudioBlob = blob;
					}

					// Load all transcripts for this session
					const transcripts = await getSessionTranscripts(selectedSession.id!);
					// Convert stored transcripts to TranscriptionResult format
					finalResults = transcripts.map((t) => ({
						text: t.text,
						isFinal: true,
						timestamp: Date.now(), // Note: stored transcripts don't have client timestamp
					}));

					// Set sessionId so recording controls know which session we're viewing
					sessionId = selectedSession.id!;

					// Reset recording state when loading a session
					recordingState = 'idle';
					currentInterim = null;
					// Set both recordingTime and sessionDuration for playback
					recordingTime = selectedSession.duration || 0;
					sessionDuration = selectedSession.duration || 0;
				} catch (error) {
					console.error('Failed to load session data:', error);
				}
			})();
		} else if (clearFlag) {
			// New Session explicitly clicked - clear everything
			console.log('[+page.svelte] Clearing all state due to explicit New Session request');

			// Stop the recording engine if active before resetting state
			if (engine && recordingState !== 'idle') {
				engine.stop();
			}

			// Stop any currently playing audio
			if (playbackAudio) {
				playbackAudio.pause();
				playbackAudio = null;
			}

			// Clear all recording and transcription state
			currentAudioBlob = null;
			finalResults = [];
			currentInterim = null;
			recordingTime = 0;
			sessionDuration = 0;
			sessionId = null;
			recordingState = 'idle';

			// Reset the clear flag
			if (sessionContext) {
				sessionContext.clearRequested = false;
			}
		}
	});

	onMount(() => {
		try {
			engine = new NativeEngine();
		} catch (error) {
			console.error('Failed to initialize engine:', error);
		}
	});

	/**
	 * Helper to flush MediaRecorder and wait for final dataavailable event
	 *
	 * This ensures we don't construct the blob before MediaRecorder has
	 * emitted all pending data. Returns a Promise that resolves when the
	 * next dataavailable event fires, or after 1 second timeout as fallback.
	 *
	 * @param recorder - Active MediaRecorder instance
	 * @returns Promise that resolves when flush is complete
	 */
	function flushRecorderAndWait(recorder: MediaRecorder): Promise<void> {
		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				recorder.removeEventListener('dataavailable', handler);
				resolve();
			}, 1000);

			const handler = (event: BlobEvent) => {
				if (event.data.size > 0) {
					clearTimeout(timeout);
					recorder.removeEventListener('dataavailable', handler);
					resolve();
				}
			};

			recorder.addEventListener('dataavailable', handler, { once: true });
		});
	}

	async function startRecording() {
		if (isRecording) return;

		try {
			// Request microphone access
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });

			// Set up audio context and analyser for visualizer
			if (!audioContext) {
				audioContext = getSharedAudioContext();
			}
			analyser = audioContext.createAnalyser();
			const source = audioContext.createMediaStreamSource(stream);
			source.connect(analyser);

			// Set up MediaRecorder
			const format = getSupportedAudioFormat();
			mediaRecorder = new MediaRecorder(stream, { mimeType: format.mimeType });
			audioChunks = [];
			headerChunk = null;

			mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					console.log('[+page.svelte] Chunk received:', {
						size: event.data.size,
						type: event.data.type,
						chunkCount: audioChunks.length + 1,
					});
					// Store first chunk separately - it contains essential container headers
					if (!headerChunk) {
						headerChunk = event.data;
					}
					// Accumulate all chunks for final save
					audioChunks = [...audioChunks, event.data];
				}
			};

			// Start recording
			mediaRecorder.start(1000); // Collect chunks every 1 second
			recordingState = 'recording';
			recordingTime = 0;
			startTime = Date.now();

			// Create new session OR resume existing session
			// If sessionId is already set (from loading a session), append to it
			// Otherwise create a new session
			if (!sessionId) {
				const format_ext = format.mimeType.includes('webm') ? 'WebM' : 'MP4';
				sessionId = await createSession(
					`Session ${new Date().toLocaleTimeString()}`,
					'native',
					format.mimeType
				);
				// Clear transcripts when starting fresh
				finalResults = [];
			} else {
				// Resuming on an existing session - keep loaded transcripts
				// Clear any interim results from previous recording session
				currentInterim = null;
			}

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
							currentInterim = result;
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
			recordingState = 'idle';
		}
	}

	async function clearRecording() {
		if (recordingState === 'idle') return;

		try {
			if (mediaRecorder && mediaRecorder.state !== 'inactive') {
				// If still recording/paused, stop the recorder
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

			// Audio already saved to IndexedDB (on pause), just update duration
			if (sessionId && recordingState === 'recording') {
				// If clearing from recording state (not paused), do final save with flush
				if (mediaRecorder) {
					mediaRecorder.requestData();
					await flushRecorderAndWait(mediaRecorder);
				}
				const format = getSupportedAudioFormat();
				const audioBlob = new Blob(audioChunks, { type: format.mimeType });
				await storeAudioData(sessionId, audioBlob);
				const duration = Date.now() - (startTime || 0);
				await updateSessionDuration(sessionId, duration);
				currentAudioBlob = audioBlob;
			} else if (sessionId && recordingState === 'paused') {
				// Already saved on pause, just update final duration
				const duration = Date.now() - (startTime || 0);
				await updateSessionDuration(sessionId, duration);
			}

			// Clear all recording state
			recordingState = 'idle';
			finalResults = [];
			currentInterim = null;
			recordingTime = 0;
			sessionDuration = 0;
			analyser = null;
			// Don't clear sessionId or currentAudioBlob - keep for playback
			console.log('Recording cleared');
		} catch (error) {
			console.error('Failed to clear recording:', error);
		}
	}

	async function pauseRecording() {
		if (recordingState !== 'recording' || !mediaRecorder) return;
		try {
			suppressTranscriptionErrors = true;

			// Stop the timer when paused
			if (timerInterval) {
				clearInterval(timerInterval);
				timerInterval = null;
			}

			// Stop transcription engine FIRST to prevent hanging
			if (engine) {
				engine.stop().catch((error) => {
					console.error('Failed to stop engine:', error);
				});
			}

			// Pause mediaRecorder
			mediaRecorder.pause();

			// Request one final data flush and wait for it
			mediaRecorder.requestData();
			await flushRecorderAndWait(mediaRecorder);

			// Create and save blob from accumulated chunks on pause
			// This ensures audio is persisted and available for playback
			console.log('[+page.svelte] Pausing recording:', {
				sessionId,
				audioChunksCount: audioChunks.length,
				totalChunkSize: audioChunks.reduce((sum, chunk) => sum + chunk.size, 0),
			});

			if (sessionId && audioChunks.length > 0) {
				const format = getSupportedAudioFormat();
				const audioBlob = new Blob(audioChunks, { type: format.mimeType });

				console.log('[+page.svelte] Created blob for playback:', {
					sessionId,
					blobSize: audioBlob.size,
					blobType: audioBlob.type,
					mimeType: format.mimeType,
				});

				// Save to IndexedDB
				await storeAudioData(sessionId, audioBlob);
				currentAudioBlob = audioBlob;

				console.log('[+page.svelte] Audio saved, currentAudioBlob set:', {
					currentAudioBlobSize: currentAudioBlob.size,
					currentAudioBlobType: currentAudioBlob.type,
					isBlobStillValid: currentAudioBlob instanceof Blob,
				});

				// Update session duration
				const duration = Date.now() - (startTime || 0);
				await updateSessionDuration(sessionId, duration);
				// Store duration for playback controls
				sessionDuration = duration;

				// Best-effort localStorage backup (base64) for recovery
				try {
					const base64 = await blobToBase64(audioBlob);
					localStorage.setItem(`revoice-backup-${sessionId}`, base64);
					console.log('Audio saved to IndexedDB and localStorage backup created');
				} catch (backupError) {
					// Non-critical: localStorage may be full or unavailable
					console.warn('Failed to create localStorage backup:', backupError);
				}
			}

			// Only update state after save is complete
			recordingState = 'paused';
		} catch (error) {
			console.error('Error pausing recording:', error);
		}
	}

	async function resumeRecording() {
		if (recordingState !== 'paused' || !mediaRecorder || !stream) return;
		try {
			// Resume mediaRecorder first
			mediaRecorder.resume();
			suppressTranscriptionErrors = false;

			// Restart transcription engine
			if (engine) {
				await engine.start(stream);
			}

			// Restart timer
			timerInterval = setInterval(() => {
				recordingTime = Date.now() - (startTime || 0);
			}, 100);

			recordingState = 'recording';
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

	// Debug: log currentAudioBlob changes
	$effect(() => {
		console.log('[+page.svelte] currentAudioBlob state changed:', {
			blobExists: currentAudioBlob !== null,
			blobSize: currentAudioBlob?.size ?? null,
			isBlobValid: currentAudioBlob instanceof Blob,
		});
	});
</script>

{#if engine}
	<TranscriptionProvider {engine}>
		<AudioPlaybackProvider audio={playbackAudio}>
			<div class="space-y-6 sm:p-4">
				<!-- Main Content Section: 2-column responsive layout -->
				<div
					class="lg:grid lg:gap-6 lg:items-start space-y-6 lg:space-y-0"
					style="grid-template-columns: auto 1fr;"
				>
					<!-- Left Column: Recording Controls (centered on mobile, left-aligned on desktop) -->
					<div class="flex justify-center lg:justify-start">
						<RecordingControls {recordingState} {recordingTime} onMicClick={handleMicClick} />
					</div>

					<!-- Right Column: Playback Controls and Visualizer (stacked) -->
					<div class="space-y-6">
						<!-- Playback Controls Card -->
						<Card>
							<CardContent>
								<AudioPlaybackControls
									blob={currentAudioBlob}
									{headerChunk}
									{audioChunks}
									mimeType={getSupportedAudioFormat().mimeType}
									disabled={recordingState === 'recording'}
									durationMs={recordingState === 'recording' ? recordingTime : sessionDuration}
									onAudioChange={(audio) => (playbackAudio = audio)}
								/>
							</CardContent>
						</Card>

						<!-- EQ Visualizer -->
						<div class="space-y-2">
							<p class="text-xs text-muted-foreground px-2">
								{#if playbackAudio}
									Audio Output
								{:else}
									Recording Input
								{/if}
							</p>
							<EqVisualizer
								recordingAnalyser={analyser ?? undefined}
								barCount={32}
								height={150}
								disabled={!isRecording && !playbackAudio}
								frozen={isPaused && !playbackAudio}
							/>
						</div>
					</div>
				</div>

				<!-- Transcription Display -->
				<Card>
					<CardHeader>
						<div class="flex flex-row justify-between gap-2">
							<CardTitle class="text-lg">Transcript</CardTitle>
							<TranscriptionStatusIndicator />
						</div>
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
										<div
											class="bg-accent/10 text-foreground rounded-lg px-4 py-2 max-w-xs opacity-70"
										>
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
		</AudioPlaybackProvider>
	</TranscriptionProvider>
{/if}

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
