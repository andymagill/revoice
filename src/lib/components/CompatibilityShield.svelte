<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { checkApiSupport, getBrowserSpecificNotes, type ApiSupport } from '$lib/compat';

	/**
	 * Warns up front when the browser lacks an API ReVoice needs, instead of letting the
	 * app fail silently.
	 *
	 * Required APIs (all must be present): Web Speech (transcription), MediaRecorder
	 * (audio capture), Web Audio (visualizer) and IndexedDB (storage).
	 *
	 * Behaviour: checks on mount; if anything is missing, shows a modal listing what is
	 * and is not supported plus browser-specific notes. "Continue Anyway" dismisses it.
	 * Children are ALWAYS rendered, so the app stays usable (with reduced function, e.g.
	 * audio without transcription) after the warning is dismissed.
	 */
	interface Props {
		children?: Snippet;
	}

	let { children }: Props = $props();

	let support = $state<ApiSupport | null>(null);
	let notes: string[] = $state([]);
	let dismissed = $state(false);

	const rows = $derived(
		support
			? [
					{ label: 'Web Speech API', ok: support.webSpeech },
					{ label: 'MediaRecorder API', ok: support.mediaRecorder },
					{ label: 'Web Audio API', ok: support.webAudio },
					{ label: 'IndexedDB', ok: support.indexedDB },
				]
			: []
	);

	onMount(() => {
		support = checkApiSupport();
		notes = getBrowserSpecificNotes();
	});
</script>

{#if support && !support.allSupported && !dismissed}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
		<div class="bg-white rounded-lg p-8 max-w-md w-full mx-4" role="alertdialog" aria-modal="true">
			<h2 class="text-2xl font-bold mb-4 text-red-600">⚠️ Compatibility Issue</h2>

			<p class="mb-4 text-gray-700">
				Your browser is missing some required APIs. ReVoice may not work properly.
			</p>

			<div class="mb-6 space-y-2">
				{#each rows as row (row.label)}
					<div class="flex items-center">
						<span class={row.ok ? 'text-green-600' : 'text-red-600'}>{row.ok ? '✓' : '✗'}</span>
						<span class="ml-2">{row.label}</span>
					</div>
				{/each}
			</div>

			{#if notes.length > 0}
				<div class="mb-6 bg-blue-50 p-4 rounded">
					<p class="font-semibold text-blue-900 mb-2">Browser Notes:</p>
					<ul class="text-sm text-blue-800 space-y-1">
						{#each notes as note (note)}
							<li>• {note}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<div class="text-sm text-gray-600 mb-6">
				<p class="font-semibold mb-1">Recommended Browsers:</p>
				<p>• Chrome/Chromium (latest)</p>
				<p>• Safari (iOS 14+, macOS 11+)</p>
			</div>

			<button
				onclick={() => (dismissed = true)}
				class="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700"
			>
				Continue Anyway
			</button>
		</div>
	</div>
{/if}

{@render children?.()}
