# ReVoice AI Agent Instructions

**Project**: Browser-based voice recording and transcription PoC  
**Tech Stack**: SvelteKit 5, Vite, Tailwind, shadCN/UI, Dexie (IndexedDB), Web Speech API

## Architecture Overview

ReVoice implements a **modular, layered architecture** with clear separation of concerns:

1. **Engine Layer** (`src/lib/engines/`) - Pluggable transcription backends implementing `ITranscriptionEngine`
2. **Storage Layer** (`src/lib/db.ts`) - Dexie.js (IndexedDB) wrapper for persistent local storage
3. **Audio Layer** (`src/lib/audio.ts`) - Cross-browser audio handling and MIME detection
4. **UI Layer** (`src/lib/components/`) - Reactive Svelte 5 components using shadCN/UI
5. **Router** (`src/routes/`) - SvelteKit static SPA with `fallback: 'index.html'`

**Key Principle**: Data never leaves the user's device. All audio/transcripts stored locally.

## Critical Patterns & Gotchas

### 1. Svelte 5 `$effect` Infinite Loops

**Problem**: Reading and updating the same state in `$effect` creates infinite loops.

**Solution**: Use `untrack()` for cleanup or read-only access:

```typescript
// ❌ BAD: Infinite loop
$effect(() => {
	if (audio) audio.pause(); // Reading 'audio' registers dependency
	audio = newAudio; // Then updating it triggers effect again!
});

// ✅ GOOD: Untracked cleanup
$effect(() => {
	const prevAudio = untrack(() => audio); // Hide from dependencies
	if (prevAudio) prevAudio.pause();
	audio = newAudio; // Safe to update
});
```

**See**: [ARCHITECTURE.md](../../ARCHITECTURE.md#1-svelte-5-responsivity-vs-resource-management)

### 2. MediaRecorder Blob Duration Bug

**Problem**: Chrome's WebM blobs lack duration metadata, so `audio.duration` returns `Infinity`, breaking sliders.

**Solution**: Always track duration separately; use as fallback:

```typescript
const duration = Number.isFinite(audio.duration) ? audio.duration : knownDurationMs / 1000;
```

**See**: [ARCHITECTURE.md](../../ARCHITECTURE.md#2-mediarecorder-blob-duration)

### 3. Recording State Machine

ReVoice uses a finite state machine (FSM) with three states:

| State       | Description                    | Playback    | Save Status    |
| ----------- | ------------------------------ | ----------- | -------------- |
| `idle`      | No active recording            | N/A         | N/A            |
| `recording` | Capturing audio                | Disabled    | Not saved      |
| `paused`    | Recording paused, review ready | **Enabled** | **Auto-saved** |

**Critical**: On pause, audio is **immediately saved to IndexedDB**. Resuming appends to the same session.

**See**: [RECORDING_FLOW.md](../../RECORDING_FLOW.md)

## Development Workflows

### Build & Dev

```bash
pnpm dev              # Vite dev server (localhost:5173)
pnpm build            # Static SPA build → build/
pnpm check            # svelte-check + type checking
pnpm format           # Prettier format
```

### Database

**All data** lives in IndexedDB (`ReVoiceDB`):

- `sessions` - Recording metadata (timestamp, duration, title, MIME type, engine type)
- `audioData` - Binary audio blobs (indexed by `sessionId`)
- `transcripts` - Transcript segments (indexed by `sessionId` + `time`)
- `recordingChunks` - Streaming chunks (v2 schema)
- `playbackCache` - Cached reconstructed blobs

**Never rely on `audio.duration`** for stored blobs—always use the recorded duration from the session.

## Component Integration Points

### TranscriptionProvider.svelte

Manages transcription engine lifecycle. Exposes:

- `engine: ITranscriptionEngine` - Active engine instance
- `results: TranscriptionResult[]` - Accumulated results with deduplication by `resultIndex`

### AudioPlaybackProvider.svelte

Manages playback context. Connects:

- `HTMLAudioElement` → `AudioContext` → `AnalyserNode` for EQ visualization
- Syncs playback state with `PlaybackDock` controls

### EqVisualizer.svelte

32-bar frequency analyzer. States:

- **Red** during recording (from `AnalyserNode` connected to mic)
- **Amber/frozen** when paused
- **Green** during playback (from `AudioContext.createMediaElementSource()`)

## Adding a New Transcription Engine

1. Create `src/lib/engines/myengine.ts`
2. Extend `TranscriptionEngine` from `base.ts`
3. Implement: `start()`, `stop()`, `getMetadata()`, `getState()`
4. Emit results via `emitResult({ text, isFinal, resultIndex })`
5. Handle errors via `emitError(error)`

**Example**:

```typescript
import { TranscriptionEngine } from './base';

export class MyEngine extends TranscriptionEngine {
	async start(stream, config) {
		this.setState('listening');
		// Initialize service, connect stream, etc.
	}

	async stop() {
		this.setState('idle');
		// Cleanup
	}

	getMetadata() {
		return { id: 'myengine', name: 'My Engine', supportedLanguages: ['en-US'] };
	}
}
```

## UI Component Library

**shadCN/UI** for Svelte. All button, card, and slider components use shadCN.

**Import pattern**:

```typescript
import { Button } from '$lib/components/ui/button/index.js';
import { Card, CardHeader, CardTitle, CardContent } from '$lib/components/ui/card/index.js';
```

**Utility**: `cn()` in `utils.ts` for Tailwind class merging (handles conflicts).

## Deployment

- **Static adapter**: `@sveltejs/adapter-static` with `fallback: 'index.html'`
- **No prerendering**: `prerender.crawl: false` (dynamic app)
- **Target**: Cloudflare Pages, Vercel, or any static host
- **No server-side rendering** - pure browser execution

## Testing & Debugging

- **No Jest/Vitest configured** - focus on integration testing in browser
- **Console logs**: Check browser DevTools for transcription, audio state, and DB operations
- **IndexedDB inspection**: Use Chrome DevTools → Application → IndexedDB → ReVoiceDB
- **Type safety**: Always run `pnpm check` before committing

## File Reference Guide

| Path                      | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `src/lib/engines/base.ts` | Abstract engine class (read first for extending)                |
| `src/lib/db.ts`           | Database operations and schema                                  |
| `src/lib/types.ts`        | Core interfaces (`ITranscriptionEngine`, `TranscriptionResult`) |
| `ARCHITECTURE.md`         | Detailed layer descriptions and patterns                        |
| `RECORDING_FLOW.md`       | FSM states and user flow documentation                          |
