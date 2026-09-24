# ReVoice Architecture

ReVoice is a static SvelteKit 5 single-page app (no server) that records microphone audio, transcribes it live with the browser's Web Speech API, and stores everything locally in IndexedDB.

Companion docs: [RECORDING_FLOW.md](RECORDING_FLOW.md) (expected recording behavior), [API.md](API.md) (public function/type reference), [README.md](README.md) (setup and usage).

## Entry points

| Entry                                                  | Role                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [src/routes/+layout.js](src/routes/+layout.js)         | `ssr = false`, `prerender = true`: builds a client-only SPA (`adapter-static`, fallback `index.html`)         |
| [src/routes/+layout.svelte](src/routes/+layout.svelte) | App shell: compatibility check, history sidebar, header. Creates the `SessionStore` and shares it via context |
| [src/routes/+page.svelte](src/routes/+page.svelte)     | Dashboard. Creates the engine and the `Recorder`, wires them to the store, lays out the widgets               |

## File map

```
src/
├── routes/
│   ├── +layout.js / +layout.svelte / +page.svelte     (entry points above)
└── lib/
    ├── recorder.svelte.ts     Recorder: recording state machine + data for the session on screen
    ├── sessions.svelte.ts     SessionStore: session list, selection, new/delete/clear commands
    ├── db.ts                  Dexie schema (v3) and queries
    ├── audio.ts               MIME-type detection, shared AudioContext
    ├── compat.ts              Browser/API capability checks
    ├── context.ts             Typed Svelte-context helpers (engine, playback graph, store)
    ├── types.ts               Shared types (EngineState, Session, Transcript, ...)
    ├── utils.ts               cn(), formatDuration()
    ├── engines/
    │   ├── base.ts                 TranscriptionEngine: subscribers + state machine
    │   ├── native.ts               NativeEngine: Web Speech API implementation
    │   └── speech-recognition.ts   Minimal Web Speech typings + constructor lookup
    └── components/
        ├── RecordingControls       Mic button, timer, status text (presentational)
        ├── AudioPlaybackControls   Play/pause + seek for one blob; owns the <audio> element
        ├── AudioPlaybackProvider   Routes the <audio> through an AnalyserNode; shares it via context
        ├── EqVisualizer            Canvas frequency bars (live / frozen / disabled)
        ├── TranscriptView          Chat-style final + interim transcript bubbles
        ├── TranscriptionProvider   Puts the engine into context
        ├── TranscriptionStatusIndicator   idle / connecting / listening badge
        ├── CompatibilityShield     Missing-API warning modal
        ├── Footer
        └── ui/                     shadcn-svelte primitives (button, card, slider)
```

## Layers and responsibilities

```
 UI components ──► Recorder ──► TranscriptionEngine (NativeEngine)
       │              │
       │              ├──► MediaRecorder + AnalyserNode (one shared mic stream)
       │              └──► db.ts (IndexedDB)
       └──► SessionStore ──► db.ts
```

- **Engine layer** (`engines/`): a pluggable interface (`ITranscriptionEngine` in `types.ts`). `TranscriptionEngine` supplies subscribers and the `idle → connecting → listening` state machine; `NativeEngine` adapts `webkitSpeechRecognition`. To add a backend (Deepgram, ...), extend `TranscriptionEngine`; nothing above it changes.
- **Recorder** (`recorder.svelte.ts`): the only place that touches the microphone, MediaRecorder and the engine during a recording. Exposes reactive state (`state`, `elapsedMs`, `finals`, `interim`, `audioBlob`, `analyser`, `error`).
- **SessionStore** (`sessions.svelte.ts`): "what is selected" plus the commands that change it. It never touches the recorder directly; the page registers handlers with `store.attach()` and the store awaits them (see below).
- **Persistence** (`db.ts`): local only. Nothing is uploaded by ReVoice (the browser's speech service may process audio remotely; the footer says so).

## Recording state machine

```
        start()                 pause()
 idle ───────────► recording ───────────► paused
   ▲                   ▲                     │
   │                   └────── resume() ─────┘
   └────────── finalize()  (from recording or paused)
```

- One `MediaRecorder` lives from `start` to `finalize`; pause/resume reuse it, so all chunks form one valid file.
- Every **pause** saves the complete audio so far (`storeAudioData` is an upsert: one row per session) and the duration.
- `finalize()` = stop engine → stop recorder (wait for its last chunk) → save if new audio → release mic → idle.
- Commands never overlap: `start/pause/resume` are ignored while another command runs; `finalize` waits for it.
- Elapsed time sums recording segments and excludes paused time.
- A saved session is **view-only**. Its audio is one finished file; a second MediaRecorder would produce a second container that cannot be joined. The mic is disabled while one is open; the user starts a New Session.

## Key data flows

**Record → pause → resume**
`mic click` → `Recorder.start()` → getUserMedia → analyser + MediaRecorder → `createSession` → `sessionCreated` hook → page calls `store.adopt(session)` + `store.refresh()` → engine starts. Results arrive via `engine.onResult` → `finals`/`interim` (final segments also `storeTranscript`).
`pause()` → engine.stop (awaited, so flushed finals land) → recorder.pause → requestData → save audio + duration → `paused`. `resume()` → recorder.resume → engine.start.

**Open a saved session**
sidebar click → `store.select(session)` → handler: `recorder.finalize()` then `recorder.open(session)` (loads audio + transcripts; a newer call discards an older in-flight load).

**New session / delete / clear all**
`store.startNew()` → handler: `finalize()` then `recorder.reset()`. `store.remove(id)` and `store.clearAll()` call `startNew()` first when needed, so an active recording is saved _before_ its rows are deleted (no orphan rows).

## Context keys (see `context.ts`)

| Key                   | Provider                                      | Consumers                      |
| --------------------- | --------------------------------------------- | ------------------------------ |
| `transcriptionEngine` | `TranscriptionProvider` (engine or `null`)    | `TranscriptionStatusIndicator` |
| `audioPlayback`       | `AudioPlaybackProvider` (`audio`, `analyser`) | `EqVisualizer`                 |
| `sessionStore`        | `+layout.svelte`                              | `+page.svelte`                 |

## Storage (IndexedDB "ReVoiceDB", Dexie schema v3)

| Table         | Key                     | Notes                                            |
| ------------- | ----------------------- | ------------------------------------------------ |
| `sessions`    | `++id`                  | title, timestamp, duration, mimeType, engineType |
| `audioData`   | `++id`, sessionId       | at most one row per session (upsert)             |
| `transcripts` | `++id`, sessionId, time | final segments only, read back sorted by `time`  |

v3 dropped the unused v2 tables and, on upgrade, keeps only the newest `audioData` row per session (older releases appended one per pause and read the oldest).

## Gotchas (read before changing things)

1. **`$effect` and cycles.** Reading state you also write inside an effect loops forever. Read callbacks/props you do not want as dependencies with `untrack()`, and prefer returning cleanup from the effect over reading state to undo it (see `AudioPlaybackControls`, `AudioPlaybackProvider`).
2. **One `createMediaElementSource` per element.** A second call throws. `AudioPlaybackProvider` caches the node per element in a `WeakMap`; never delete that entry while the element lives.
3. **Blob URLs live as long as their element.** `AudioPlaybackControls` revokes in effect cleanup, which runs before the next element is created.
4. **MediaRecorder WebM blobs report `duration = Infinity`.** Pass `durationMs` and let the controls fall back to it.
5. **The engine must not stop the mic stream.** Web Speech uses its own capture; the Recorder owns and releases the stream.
6. **`SpeechRecognition.stop()` is async.** Wait for `engine.stop()` before starting again. Fatal errors (`not-allowed`, `network`, ...) end the session instead of auto-reconnecting.
7. **Safari.** Start recognition and the AudioContext from a click handler; recording is `audio/mp4`.
8. **Analyser size.** 64-point FFT (32 bins) to match the 32 visualizer bars; `EqVisualizer` also sets this on whichever analyser it is given.
9. **Engine may be missing.** `NativeEngine` throws where Web Speech is unsupported; the page passes `null` and records audio only.

## Extending: adding an engine

1. Create `src/lib/engines/myengine.ts` extending `TranscriptionEngine`; implement `start`, `stop` (resolve once idle) and `getMetadata`; call `setState`, `emitResult`, `emitError`.
2. Construct it in `+page.svelte` instead of (or based on a choice between) `NativeEngine`. `Recorder`, `TranscriptionProvider` and the status indicator depend only on `ITranscriptionEngine`.
