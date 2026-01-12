<script lang="ts">
	import '../app.css';
	import { onMount, getContext, setContext } from 'svelte';
	import { getAllSessions, type Session } from '$lib/db';
	import CompatibilityShield from '$lib/components/CompatibilityShield.svelte';
	import AudioPlaybackProvider from '$lib/components/AudioPlaybackProvider.svelte';
	import PlaybackDock from '$lib/components/PlaybackDock.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';

	/**
	 * Root Layout
	 * Contains the main navigation, history sidebar, and persistent playback dock
	 */

	let sessions: Session[] = $state([]);
	let currentSession: Session | null = $state(null);
	let sidebarOpen: boolean = $state(false);
	let playingAudio: HTMLAudioElement | null = $state(null);
	let currentPlayingSessionId: number | null = $state(null);

	let { children } = $props();

	// Provide currentSession to child components via Svelte 5 context
	setContext('currentSession', {
		get current() {
			return currentSession;
		},
		set(value: Session | null) {
			currentSession = value;
		},
	});

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

	async function handleNewSession() {
		currentSession = null;
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
	<div class="flex h-screen bg-background">
		<!-- Mobile Overlay -->
		{#if sidebarOpen}
			<div
				class="fixed inset-0 bg-black/50 z-40 md:hidden"
				onclick={() => (sidebarOpen = false)}
			></div>
		{/if}

		<!-- Sidebar -->
		<div
			class={`w-0 md:w-64 ${
				sidebarOpen ? 'w-64' : 'md:w-64'
			} bg-background border-r border-border transition-all duration-300 overflow-hidden flex flex-col fixed md:static z-50 md:z-auto h-full md:h-auto`}
		>
			<div class="p-4 border-b border-border">
				<h1 class="text-xl font-bold text-foreground">ReVoice</h1>
				<p class="text-xs text-muted-foreground mt-1">Voice Transcription</p>
			</div>

			<div class="flex-1 overflow-y-auto p-4 space-y-2">
				<p class="text-xs font-semibold text-muted-foreground uppercase">Recent Sessions</p>
				{#if sessions.length === 0}
					<p class="text-sm text-muted-foreground text-center py-8">No sessions yet</p>
				{:else}
					{#each sessions as session (session.id)}
						<Card
							class="p-3 cursor-pointer hover:bg-accent hover:text-accent-foreground transition bg-accent/10"
							onclick={() => (currentSession = session)}
							role="button"
							tabindex="0"
							onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && (currentSession = session)}
						>
							<p class="font-medium text-sm text-foreground">{session.title}</p>
							<div class="flex justify-between items-center mt-2 text-xs text-muted-foreground">
								<span>{formatTime(session.duration)}</span>
								<div class="space-x-1">
									<Button
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											playSession(session);
										}}
										variant="ghost"
										size="sm"
										class="h-6 px-1 text-accent"
									>
										▶
									</Button>
									<Button
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											deleteSession(session.id!);
										}}
										variant="ghost"
										size="sm"
										class="h-6 px-1 text-destructive"
									>
										×
									</Button>
								</div>
							</div>
						</Card>
					{/each}
				{/if}
			</div>

			<div class="p-4 border-t border-border">
				<Button
					onclick={async () => {
						const { clearAllData } = await import('$lib/db');
						await clearAllData();
						sessions = [];
						currentSession = null;
					}}
					variant="ghost"
					class="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 py-2"
				>
					Clear All Data
				</Button>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex-1 flex flex-col">
			<!-- Header -->
			<div class="bg-background border-b border-border px-4 py-3 flex items-center justify-between">
				<Button
					onclick={() => (sidebarOpen = !sidebarOpen)}
					variant="ghost"
					size="icon"
					class="p-2 md:hidden"
				>
					☰
				</Button>
				<h2 class="text-lg font-semibold text-foreground">
					{currentSession ? currentSession.title : 'New Session'}
				</h2>
				<Button onclick={handleNewSession} variant="outline" size="sm" class="text-xs">
					New Session
				</Button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-auto p-4">
				{@render children()}
			</div>

			<!-- Playback Dock -->
			{#if currentPlayingSessionId !== null}
				<AudioPlaybackProvider audio={playingAudio}>
					<PlaybackDock
						{playingAudio}
						{currentPlayingSessionId}
						onClose={() => {
							if (playingAudio) {
								playingAudio.pause();
								playingAudio = null;
								currentPlayingSessionId = null;
							}
						}}
					/>
				</AudioPlaybackProvider>
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
