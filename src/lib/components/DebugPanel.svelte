<script lang="ts">
	import { tick } from 'svelte';
	import { clearDiag, disableDebug, exportDiag, getEntries } from '$lib/diagnostics.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * On-screen diagnostic log for debugging on a phone (enable with `?debug=1`).
	 *
	 * Shows every `diag()` event (recorder, microphone, speech engine, page) and can copy
	 * the whole log as JSON. Collapsible so it does not cover the controls while recording.
	 */

	let collapsed = $state(false);
	let status = $state('');
	let logElement = $state<HTMLElement>();

	const entries = $derived(getEntries());

	// Keep the newest line in view.
	$effect(() => {
		void entries;
		if (collapsed || !logElement) return;
		void tick().then(() => {
			if (logElement) logElement.scrollTop = logElement.scrollHeight;
		});
	});

	function format(data: unknown): string {
		return data === undefined ? '' : ` ${JSON.stringify(data)}`;
	}

	async function copyLog() {
		const text = exportDiag();
		try {
			await navigator.clipboard.writeText(text);
			status = 'Copied';
		} catch {
			// Clipboard access can be blocked; fall back to a temporary textarea.
			const area = document.createElement('textarea');
			area.value = text;
			document.body.appendChild(area);
			area.select();
			const ok = document.execCommand('copy');
			area.remove();
			status = ok ? 'Copied' : 'Copy failed';
		}
		setTimeout(() => (status = ''), 2000);
	}
</script>

<div
	class="fixed inset-x-0 bottom-0 z-50 border-t bg-card text-card-foreground shadow-lg"
	role="region"
	aria-label="Debug log"
>
	<div class="flex flex-wrap items-center gap-2 px-3 py-2">
		<span class="text-xs font-semibold">Debug log ({entries.length})</span>
		<span class="text-xs text-muted-foreground" aria-live="polite">{status}</span>
		<div class="ml-auto flex gap-2">
			<Button size="sm" variant="outline" onclick={copyLog}>Copy</Button>
			<Button size="sm" variant="outline" onclick={clearDiag}>Clear</Button>
			<Button size="sm" variant="outline" onclick={() => (collapsed = !collapsed)}>
				{collapsed ? 'Show' : 'Hide'}
			</Button>
			<Button size="sm" variant="outline" onclick={disableDebug}>Close</Button>
		</div>
	</div>
	{#if !collapsed}
		<div
			bind:this={logElement}
			class="max-h-[40vh] overflow-y-auto border-t px-3 py-2 font-mono text-[11px] leading-snug"
		>
			{#each entries as entry, index (index)}
				<div class="break-all whitespace-pre-wrap">
					<span class="text-muted-foreground">{(entry.t / 1000).toFixed(2)}s</span>
					<span class="font-semibold">[{entry.scope}]</span>
					{entry.event}{format(entry.data)}
				</div>
			{/each}
		</div>
	{/if}
</div>
