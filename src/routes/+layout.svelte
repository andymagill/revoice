<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { purgeLegacyBackups, type Session } from '$lib/db';
	import { setSessionStore } from '$lib/context';
	import { SessionStore } from '$lib/sessions.svelte';
	import { formatDuration } from '$lib/utils';
	import CompatibilityShield from '$lib/components/CompatibilityShield.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Card } from '$lib/components/ui/card/index.js';

	/**
	 * Root layout: history sidebar, header and page outlet.
	 *
	 * Owns the SessionStore and shares it with the page through context; all selection,
	 * deletion and "new session" actions go through the store so they are sequenced with
	 * any recording in progress.
	 */

	let { children } = $props();

	const store = new SessionStore();
	setSessionStore(store);

	let sidebarOpen = $state(false);

	onMount(() => {
		purgeLegacyBackups();
		void store.refresh();
	});

	function selectSession(session: Session) {
		sidebarOpen = false;
		void store.select(session);
	}

	async function deleteSession(id: number) {
		if (!confirm('Delete this session? This cannot be undone.')) return;
		try {
			await store.remove(id);
		} catch (error) {
			console.error('Failed to delete session:', error);
		}
	}

	async function clearAllData() {
		if (!confirm('This will permanently delete all recorded sessions and audio. Continue?')) {
			return;
		}
		try {
			await store.clearAll();
		} catch (error) {
			console.error('Failed to clear data:', error);
		}
	}
</script>

<svelte:head>
	<title>ReVoice - Recording & Transcription</title>
	<meta
		name="description"
		content="ReVoice - A web app for recording and transcribing voice audio sessions."
	/>
</svelte:head>

<CompatibilityShield>
	<div class="flex h-screen bg-background">
		<!-- Mobile Overlay -->
		{#if sidebarOpen}
			<div
				class="fixed inset-0 bg-black/50 z-40 md:hidden"
				role="button"
				tabindex="0"
				onclick={() => (sidebarOpen = false)}
				onkeydown={(e: KeyboardEvent) => e.key === 'Escape' && (sidebarOpen = false)}
				aria-label="Close sidebar"
			></div>
		{/if}

		<!-- Sidebar -->
		<div
			class={`${
				sidebarOpen ? 'w-64' : 'w-0 md:w-64'
			} bg-background border-r border-border transition-all duration-300 overflow-hidden flex flex-col fixed md:static z-50 md:z-auto h-full md:h-auto`}
		>
			<div class="p-4 border-b border-border">
				<h1 class="text-xl font-bold text-foreground">ReVoice</h1>
				<p class="text-xs text-muted-foreground mt-1">Recording & Transcription</p>
			</div>

			<div class="flex-1 overflow-y-auto p-4 space-y-2">
				<p class="text-xs font-semibold text-muted-foreground uppercase">Recent Sessions</p>
				{#if store.sessions.length === 0}
					<p class="text-sm text-muted-foreground text-center py-8">No sessions yet</p>
				{:else}
					{#each store.sessions as session (session.id)}
						<Card
							class="p-3 cursor-pointer hover:bg-accent hover:text-accent-foreground transition bg-accent/10"
							onclick={() => selectSession(session)}
							role="button"
							tabindex="0"
							onkeydown={(e: KeyboardEvent) => {
								if (e.key === 'Enter') selectSession(session);
							}}
						>
							<p class="font-medium text-sm text-foreground">{session.title}</p>
							<div class="flex justify-between items-center mt-2 text-xs text-muted-foreground">
								<span>{formatDuration(session.duration)}</span>
								<div class="space-x-1">
									<Button
										onclick={(e: MouseEvent) => {
											e.stopPropagation();
											void deleteSession(session.id!);
										}}
										variant="ghost"
										size="sm"
										class="h-6 px-1 text-destructive"
										aria-label="Delete session"
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
					onclick={clearAllData}
					variant="ghost"
					class="w-full text-xs text-destructive hover:text-destructive hover:bg-destructive/10 py-2"
				>
					Clear All Data
				</Button>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex-1 flex flex-col">
			<div class="bg-background border-b border-border px-4 py-3 flex items-center justify-between">
				<Button
					onclick={() => (sidebarOpen = !sidebarOpen)}
					variant="ghost"
					size="icon"
					class="p-2 md:hidden"
					aria-label="Toggle sidebar"
				>
					☰
				</Button>
				<h2 class="text-lg font-semibold text-foreground">
					{store.selected ? store.selected.title : 'New Session'}
				</h2>
				<Button onclick={() => store.startNew()} variant="outline" size="sm" class="text-xs">
					New Session
				</Button>
			</div>

			<div class="flex-1 overflow-auto p-4 flex flex-col">
				{@render children()}

				<div class="mt-auto">
					<Footer />
				</div>
			</div>
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
