<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { getAllSessions, type Session } from '$lib/db';
	import CompatibilityShield from '$lib/components/CompatibilityShield.svelte';

	/**
	 * Root Layout
	 * Contains the main navigation, history sidebar, and persistent playback dock
	 */

	let sessions: Session[] = $state([]);
	let currentSession: Session | null = $state(null);
	let sidebarOpen: boolean = $state(true);
	let playingAudio: HTMLAudioElement | null = $state(null);
	let currentPlayingSessionId: number | null = $state(null);

	let { children } = $props();

	onMount(async () => {
		sessions = await getAllSessions();
	});

	async function deleteSession(id: number) {
		const { deleteSession: deleteSessionDB } = await import('$lib/db');
		await deleteSessionDB(id);
		sessions = await getAllSessions();
		if (currentSession?.id === id) {
			currentSession = null;
		}
	}

	async function playSession(session: Session) {
		const { getSessionAudio } = await import('$lib/db');
		const blob = await getSessionAudio(session.id!);
		if (!blob) return;

		if (playingAudio) {
			playingAudio.pause();
		}

		const url = URL.createObjectURL(blob);
		playingAudio = new Audio(url);
		currentPlayingSessionId = session.id!;
		playingAudio.play();

		playingAudio.onended = () => {
			currentPlayingSessionId = null;
			URL.revokeObjectURL(url);
		};
	}

	function formatTime(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		const minutes = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${minutes}:${secs.toString().padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>ReVoice - Voice Transcription</title>
</svelte:head>

<CompatibilityShield>
	<div class="flex h-screen bg-gray-100">
		<!-- Sidebar -->
		<div
			class={`${sidebarOpen ? 'w-64' : 'w-0'} bg-white border-r border-gray-200 transition-all duration-300 overflow-hidden flex flex-col`}
		>
			<div class="p-4 border-b border-gray-200">
				<h1 class="text-xl font-bold text-gray-900">ReVoice</h1>
				<p class="text-xs text-gray-500 mt-1">Voice Transcription</p>
			</div>

			<div class="flex-1 overflow-y-auto p-4 space-y-2">
				<p class="text-xs font-semibold text-gray-600 uppercase">Recent Sessions</p>
				{#if sessions.length === 0}
					<p class="text-sm text-gray-500 text-center py-8">No sessions yet</p>
				{:else}
					{#each sessions as session (session.id)}
						<div
							class="p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 transition"
							onclick={() => (currentSession = session)}
							role="button"
							tabindex="0"
							onkeydown={(e) => e.key === 'Enter' && (currentSession = session)}
						>
							<p class="font-medium text-sm text-gray-900">{session.title}</p>
							<div class="flex justify-between items-center mt-2 text-xs text-gray-500">
								<span>{formatTime(session.duration)}</span>
								<div class="space-x-1">
									<button
										onclick={(e) => {
											e.stopPropagation();
											playSession(session);
										}}
										class="text-blue-600 hover:text-blue-700"
									>
										▶
									</button>
									<button
										onclick={(e) => {
											e.stopPropagation();
											deleteSession(session.id!);
										}}
										class="text-red-600 hover:text-red-700"
									>
										×
									</button>
								</div>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="p-4 border-t border-gray-200">
				<button
					onclick={async () => {
						const { clearAllData } = await import('$lib/db');
						await clearAllData();
						sessions = [];
						currentSession = null;
					}}
					class="w-full text-xs text-red-600 hover:text-red-700 py-2"
				>
					Clear All Data
				</button>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex-1 flex flex-col">
			<!-- Header -->
			<div class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
				<button
					onclick={() => (sidebarOpen = !sidebarOpen)}
					class="p-2 hover:bg-gray-100 rounded"
				>
					☰
				</button>
				<h2 class="text-lg font-semibold text-gray-900">
					{currentSession ? currentSession.title : 'New Session'}
				</h2>
				<div class="w-8"></div>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-auto p-4">
				{@render children()}
			</div>

			<!-- Playback Dock -->
			{#if currentPlayingSessionId !== null}
				<div class="bg-white border-t border-gray-200 px-4 py-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center space-x-4">
							<button
								onclick={() => {
									if (playingAudio) {
										if (playingAudio.paused) {
											playingAudio.play();
										} else {
											playingAudio.pause();
										}
									}
								}}
								class="p-2 hover:bg-gray-100 rounded"
							>
								{playingAudio?.paused ? '▶' : '⏸'}
							</button>
							<div>
								<p class="text-sm font-medium text-gray-900">Playing Audio</p>
								<p class="text-xs text-gray-500">
									{playingAudio ? formatTime(playingAudio.currentTime * 1000) : '0:00'} /
									{playingAudio ? formatTime(playingAudio.duration * 1000) : '0:00'}
								</p>
							</div>
						</div>
						<button
							onclick={() => {
								if (playingAudio) {
									playingAudio.pause();
									playingAudio = null;
									currentPlayingSessionId = null;
								}
							}}
							class="p-2 hover:bg-gray-100 rounded text-gray-500"
						>
							✕
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
</CompatibilityShield>

<style>
	:global(html, body) {
		margin: 0;
		padding: 0;
		height: 100%;
	}
</style>
