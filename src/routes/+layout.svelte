<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { getAllSessions, type Session } from '$lib/db';
	import CompatibilityShield from '$lib/components/CompatibilityShield.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card/index.js';

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
	<div class="flex h-screen bg-background">
		<!-- Sidebar -->
		<div
			class={`${sidebarOpen ? 'w-64' : 'w-0'} bg-background border-r border-border transition-all duration-300 overflow-hidden flex flex-col`}
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
							onkeydown={(e) => e.key === 'Enter' && (currentSession = session)}
						>
							<p class="font-medium text-sm text-foreground">{session.title}</p>
							<div class="flex justify-between items-center mt-2 text-xs text-muted-foreground">
								<span>{formatTime(session.duration)}</span>
								<div class="space-x-1">
									<Button
										onclick={(e) => {
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
										onclick={(e) => {
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
					class="p-2"
				>
					☰
				</Button>
				<h2 class="text-lg font-semibold text-foreground">
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
				<Card class="bg-background border-t border-border rounded-none border-l-0 border-r-0">
					<CardContent class="flex items-center justify-between py-3">
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
							>
								{playingAudio?.paused ? '▶' : '⏸'}
							</Button>
							<div>
								<p class="text-sm font-medium text-foreground">Playing Audio</p>
								<p class="text-xs text-muted-foreground">
									{playingAudio ? formatTime(playingAudio.currentTime * 1000) : '0:00'} /
									{playingAudio ? formatTime(playingAudio.duration * 1000) : '0:00'}
								</p>
							</div>
						</div>
						<Button
							onclick={() => {
								if (playingAudio) {
									playingAudio.pause();
									playingAudio = null;
									currentPlayingSessionId = null;
								}
							}}
							variant="ghost"
							size="icon"
							class="p-2 text-muted-foreground"
						>
							✕
						</Button>
					</CardContent>
				</Card>
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
