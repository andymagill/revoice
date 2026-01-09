<script lang="ts">
	import { onMount } from 'svelte';
	import { checkApiSupport, getBrowserName, getBrowserSpecificNotes } from '$lib/compat';
	import type { ApiSupport } from '$lib/compat';

	/**
	 * CompatibilityShield Component
	 * 
	 * A guard component that checks browser API compatibility before rendering child content.
	 * If critical APIs are missing (Web Speech, MediaRecorder, Web Audio, IndexedDB), displays
	 * a modal warning with the list of missing features and browser-specific notes.
	 * 
	 * **Purpose**: Prevent silent failures in unsupported browsers by informing users upfront.
	 * 
	 * **Features**:
	 * - Automatically detects browser and checks all required APIs
	 * - Displays visual checkmarks/crosses for each API
	 * - Shows browser-specific warnings (e.g., "Safari requires user gesture")
	 * - Allows users to continue anyway (may not work properly)
	 * - Uses modal overlay to prevent interaction with broken app
	 * 
	 * **Usage**:
	 * ```svelte
	 * <CompatibilityShield>
	 *   <MainApp />
	 * </CompatibilityShield>
	 * ```
	 * 
	 * **Supported Browsers**:
	 * - Chrome/Chromium 25+ (Web Speech API)
	 * - Safari 14.1+ (iOS 14.5+, macOS 11.3+)
	 * - Firefox 25+ (Web Speech API not stable)
	 * 
	 * **API Requirements** (all must be present):
	 * 1. Web Speech API (for transcription)
	 * 2. MediaRecorder API (for audio recording)
	 * 3. Web Audio API (for visualization)
	 * 4. IndexedDB (for persistent storage)
	 * 
	 * **Lifecycle**:
	 * 1. Mount: check APIs via `checkApiSupport()`
	 * 2. If missing APIs: show warning modal
	 * 3. User can dismiss modal with "Continue Anyway" button
	 * 4. Always render children (whether warning shown or not)
	 * 
	 * **Modal Behavior**:
	 * - Blocks interaction with app until dismissed
	 * - Shows semi-transparent dark overlay
	 * - Lists supported browser recommendations
	 * - Non-blocking: clicking "Continue Anyway" hides modal but app may fail
	 */

	interface Props {
		/**
		 * Child components to render (usually the main app)
		 * Rendered AFTER modal, so app is still interactive if modal dismissed
		 */
		children?: any;
	}

	let { children }: Props = $props();

	/**
	 * API support status object
	 * Tracks which browser APIs are available
	 */
	let support: ApiSupport = $state({
		webSpeech: false,
		mediaRecorder: false,
		webAudio: false,
		indexedDB: false,
		allSupported: false
	});

	/**
	 * Detected browser name for display (e.g., "Chrome", "Safari", "Firefox")
	 */
	let browser: string = $state('');

	/**
	 * Browser-specific warnings/notes (e.g., "Safari: requires user gesture")
	 */
	let notes: string[] = $state([]);

	/**
	 * Controls visibility of compatibility warning modal
	 * Set to true if any required API is missing
	 */
	let showWarning: boolean = $state(false);

	/**
	 * Initialize compatibility check on mount
	 * 
	 * This lifecycle hook:
	 * 1. Checks all required APIs using checkApiSupport()
	 * 2. Detects browser type for user-friendly messaging
	 * 3. Retrieves browser-specific notes/caveats
	 * 4. Shows warning modal if any API is missing
	 * 
	 * @see {checkApiSupport} in $lib/compat.ts
	 * @see {getBrowserName} in $lib/compat.ts
	 * @see {getBrowserSpecificNotes} in $lib/compat.ts
	 */
	onMount(() => {
		// Run API detection - all results cached by compat module
		support = checkApiSupport();
		browser = getBrowserName();
		notes = getBrowserSpecificNotes();

		// Display warning modal if any required API is missing
		// User can dismiss with "Continue Anyway" but app may not work
		if (!support.allSupported) {
			showWarning = true;
		}
	});
</script>

{#if showWarning && !support.allSupported}
	<!-- 
		Compatibility Warning Modal
		
		Displayed as a fixed overlay preventing interaction with app content.
		User can dismiss with "Continue Anyway" but should understand that
		the app may not function properly with missing APIs.
		
		Layout:
		- Dark semi-transparent backdrop (bg-black/50)
		- White card centered on screen (max-width: 28rem)
		- Title, description, API checklist, notes, recommendation
		- Single action button to dismiss
	-->
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
		<div class="bg-white rounded-lg p-8 max-w-md w-full mx-4">
			<h2 class="text-2xl font-bold mb-4 text-red-600">⚠️ Compatibility Issue</h2>

			<p class="mb-4 text-gray-700">
				Your browser is missing some required APIs. ReVoice may not work properly.
			</p>

			<!-- 
				API Support Checklist
				Shows visual status (✓ or ✗) for each required API.
				Green check = supported, red cross = missing
			-->
			<div class="mb-6 space-y-2">
				<!-- Web Speech API support indicator -->
				<div class="flex items-center">
					<span class={support.webSpeech ? '✓ text-green-600' : '✗ text-red-600'}>
						{support.webSpeech ? '✓' : '✗'}
					</span>
					<span class="ml-2">Web Speech API</span>
				</div>

				<!-- MediaRecorder API support indicator -->
				<div class="flex items-center">
					<span class={support.mediaRecorder ? '✓ text-green-600' : '✗ text-red-600'}>
						{support.mediaRecorder ? '✓' : '✗'}
					</span>
					<span class="ml-2">MediaRecorder API</span>
				</div>

				<!-- Web Audio API support indicator -->
				<div class="flex items-center">
					<span class={support.webAudio ? '✓ text-green-600' : '✗ text-red-600'}>
						{support.webAudio ? '✓' : '✗'}
					</span>
					<span class="ml-2">Web Audio API</span>
				</div>

				<!-- IndexedDB support indicator -->
				<div class="flex items-center">
					<span class={support.indexedDB ? '✓ text-green-600' : '✗ text-red-600'}>
						{support.indexedDB ? '✓' : '✗'}
					</span>
					<span class="ml-2">IndexedDB</span>
				</div>
			</div>

			<!-- 
				Browser-Specific Notes
				Displays warnings/caveats that users should be aware of.
				Examples: "Safari requires user gesture", "Firefox may have delays"
			-->
			{#if notes.length > 0}
				<div class="mb-6 bg-blue-50 p-4 rounded">
					<p class="font-semibold text-blue-900 mb-2">Browser Notes:</p>
					<ul class="text-sm text-blue-800 space-y-1">
						{#each notes as note}
							<li>• {note}</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- 
				Recommended Browsers
				Shows list of browsers where ReVoice is tested and working
			-->
			<div class="text-sm text-gray-600 mb-6">
				<p class="font-semibold mb-1">Recommended Browsers:</p>
				<p>• Chrome/Chromium (latest)</p>
				<p>• Safari (iOS 14+, macOS 11+)</p>
			</div>

			<!-- 
				Dismiss Button
				Clicking hides the warning modal and allows app to render.
				Warning: App may not work if APIs are missing
				
				Accessibility: 
				- Uses click handler (not keyboard accessible in this version)
				- TODO: Add onkeydown handler for Enter/Escape keys
			-->
			<button
				onclick={() => (showWarning = false)}
				class="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700"
			>
				Continue Anyway
			</button>
		</div>
	</div>
{/if}

<!-- 
	Child Content
	Always rendered, but may be blocked by modal overlay if warning shown.
	Contains the actual ReVoice application (Main App component).
-->
{@render children?.()}
