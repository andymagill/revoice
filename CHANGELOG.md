# Changelog

All notable changes to ReVoice are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may include breaking changes).

## [Unreleased]

### Fixed

- **Transcription stuck on "Connecting" on Android Chrome.** When speech recognition could not get audio (typically because the recorder held the microphone), the engine restarted it endlessly with no delay and never reported a problem. Restarts now back off, and after four rapid empty sessions the engine stops and shows an error while audio recording continues. A start watchdog also aborts a recognizer that never reports `onstart`.
- `language-not-supported` and `bad-grammar` recognition errors now end the session instead of restarting it.
- `stop()` during a pending restart resolves immediately instead of waiting for the stop timeout.

### Added

- **On-screen diagnostics** (`?debug=1`): a copyable event log covering the recorder, microphone, MediaRecorder, speech-recognition lifecycle (including `audiostart`/`soundstart`), AudioContext state, connectivity and page visibility, plus an environment snapshot. `?probe=nogum` runs speech recognition without the recorder's microphone to isolate contention.
- `acquireMicrophone()` classifies microphone failures (`denied`, `not-found`, `in-use`, `insecure`, ...) into `MicrophoneError`, verifies the track is live and reports it being muted or ended. "Microphone in use" (`NotReadableError`) now has its own message.
- Android note in the compatibility warning.

## [0.1.0] - 2026-09-24

Stabilization release: the record → pause → resume → reopen flow now works end to end, and the recording logic moved out of the page component into testable classes.

### Fixed

- **Resume never worked.** Clicking the mic while paused started a second recording (new stream and MediaRecorder, chunks wiped, first mic stream leaked) and the amber "Paused" UI was unreachable. Resume now continues the same recording.
- **Transcription stopped the microphone.** `NativeEngine.stop()` stopped the shared stream's tracks, so audio recorded after a pause was silent. The engine no longer touches the stream.
- **Opening a session while recording** reset the UI but left the recorder, timer and microphone running. Selecting a session, New Session, delete and Clear All now save the active recording first and release the microphone.
- **Reloaded sessions played truncated audio.** A new audio row was added on every pause while readers took the oldest. Audio is now an upsert (one row per session); a database migration keeps only the newest row of existing sessions.
- **Duplicate transcript lines.** Each start added another result listener that was never removed, so segments were shown and stored several times.
- **Transcripts dropped after resume or reconnect.** The engine's de-duplication index was not reset when the browser started a new recognition session.
- **Fast pause → resume** could leave the engine reported as idle while listening (`SpeechRecognition.stop()` is asynchronous). `stop()` now resolves when recognition has ended and `start()` waits for it.
- **Reconnect loops.** Fatal recognition errors (`not-allowed`, `audio-capture`, `network`, ...) now end the session instead of restarting endlessly.
- **Timer and duration** no longer restart from zero on resume or count paused time; transcript timestamps match the audio.
- **Failed starts leaked the microphone** and errors were only logged. A denied or missing microphone now shows an inline message and creates no session.
- **Blank page in browsers without speech recognition.** The dashboard renders, records audio and explains that transcription is unavailable.
- **Deleting the open session** left the UI pointing at deleted data; `deleteSession`/`clearAllData` now run in transactions.
- **Visualizer** now uses a 64-point FFT for the recording analyser (it previously showed only the lowest frequencies) and no longer risks running two draw loops.
- Playback: listeners and blob URLs are cleaned up, state resets when the blob changes, and re-attaching a previously used audio element no longer throws.
- Unhandled rejection when storing a transcript fails.
- **Pre-commit hook and `pnpm` scripts failed on pnpm 11** (`ERR_PNPM_IGNORED_BUILDS`) because pnpm 11 ignores `pnpm.onlyBuiltDependencies` in `package.json`. Added `pnpm-workspace.yaml` with `allowBuilds` for esbuild.
- **Duplicate icon packages.** `lucide-svelte` and `@lucide/svelte` were both installed; icons now come only from the maintained `@lucide/svelte` and `lucide-svelte` is removed.

### Changed

- New `Recorder` (`src/lib/recorder.svelte.ts`) and `SessionStore` (`src/lib/sessions.svelte.ts`) own recording and session state; `+page.svelte` shrank from 732 to about 150 lines.
- Saved sessions are **view-only**: the mic is disabled until New Session is clicked (a second recording cannot be joined to a finished WebM/MP4 file).
- Engine states: `connecting` now covers the wait for the browser to confirm it is listening.
- Database schema v3: drops the unused `recordingChunks`/`playbackCache` tables and the `transcripts.text` index.
- Duration display is unified as `m:ss` / `h:mm:ss` (`formatDuration`).
- Typed Svelte context helpers (`src/lib/context.ts`) and Web Speech typings replace inline shapes and `any`.
- `TranscriptView`, `RecordingControls` and `CompatibilityShield` simplified; noisy debug logging removed.

### Removed

- The never-shown `PlaybackDock` and the layout's `playSession` path.
- Unused helpers: `cloneMediaStream`, `createMediaRecorder`, `blobToBase64`, `base64ToBlob`, `getAudioFileExtension`, `createAudioElementFromBlob`, `getSessionFullTranscript`, `getDBStats`, `isIOS`, `isMacOS`, `getRecommendedEngine`.
- The localStorage base64 audio backup (never read back, exhausted the quota). Existing `revoice-backup-*` entries are purged on startup.
- `DOCUMENTATION.md` (a stale summary of the docs themselves).

### Documentation

- Rewrote `ARCHITECTURE.md` (file map, entry points, state machine, data flows, gotchas) and `RECORDING_FLOW.md`; updated `README.md` and `API.md`.

[0.1.0]: https://github.com/andymagill/revoice/releases/tag/v0.1.0
