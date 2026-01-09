<script lang="ts">
	import { setContext } from 'svelte';
	import type { ITranscriptionEngine } from '$lib/types';

	/**
	 * TranscriptionProvider Component
	 * 
	 * A context provider component that injects a transcription engine instance
	 * into the Svelte component tree, making it available to all descendants.
	 * 
	 * Purpose: Enable any child component to access the active transcription engine
	 * without passing it as a prop through every intermediate component (prop drilling).
	 * 
	 * Pattern: Implements the Svelte Context API pattern for dependency injection
	 * 
	 * How It Works:
	 * 1. Parent component creates TranscriptionProvider with engine instance
	 * 2. Provider uses setContext() to inject engine into Svelte's context system
	 * 3. Any child/descendant can call getContext() to retrieve engine
	 * 4. Engine is shared across entire subtree
	 * 
	 * Context Key: 'transcriptionEngine' (string constant)
	 * 
	 * Benefits Over Props:
	 * - No prop drilling through 5+ intermediate components
	 * - Cleaner component APIs (fewer required props)
	 * - Easier to change engine implementation
	 * 
	 * Limitations:
	 * - getContext() must be called during component initialization
	 * - If context not set, getContext() returns undefined
	 * - Can only access context in descendants, not siblings/parents
	 * 
	 * Current Usage in App:
	 * - Defined in: src/routes/+page.svelte
	 * - Wraps: Sidebar, Header, MainContent
	 * - Accessed by: Recording controls, playback logic
	 */

	interface Props {
		engine: ITranscriptionEngine;
		children?: any;
	}

	let { engine, children }: Props = $props();

	setContext<ITranscriptionEngine>('transcriptionEngine', (() => engine)());
</script>

{#if children}
	{@render children()}
{/if}
