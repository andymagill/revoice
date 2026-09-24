# Recording Flow & Expected Behavior

Defines how recording, pausing, resuming and viewing sessions should behave. Use it to guide changes and to write regression checks. Implementation: [src/lib/recorder.svelte.ts](src/lib/recorder.svelte.ts); UI wiring: [src/routes/+page.svelte](src/routes/+page.svelte). Design background: [ARCHITECTURE.md](ARCHITECTURE.md).

## States

```
        start()                 pause()
 idle ───────────► recording ───────────► paused
   ▲                   ▲                     │
   │                   └────── resume() ─────┘
   └────────── finalize()  (from recording or paused)
```

| State         | Mic button  | Playback controls                 | Mic + engine                  | Audio saved              |
| ------------- | ----------- | --------------------------------- | ----------------------------- | ------------------------ |
| **idle**      | blue, Ready | enabled if a session is on screen | off                           | n/a                      |
| **recording** | red         | disabled                          | on                            | not until pause/finalize |
| **paused**    | amber       | **enabled**                       | mic stream on, engine stopped | yes, on every pause      |

### Transitions

| From → To               | Trigger                                                                                     | What happens                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| idle → recording        | mic click                                                                                   | Get mic, create analyser + MediaRecorder, create session row, start timer and engine               |
| recording → paused      | mic click                                                                                   | Stop engine (wait), pause recorder, flush, **save complete audio + duration**, freeze timer        |
| paused → recording      | mic click                                                                                   | Resume the **same** recorder, restart engine, continue timer                                       |
| recording/paused → idle | New Session, selecting another session, Clear All, delete of the open session, page unmount | `finalize()`: stop engine, stop recorder (wait for last chunk), save anything new, release the mic |

Invalid transitions are ignored (e.g. pause while idle). Commands never overlap: while one is running, `start`/`pause`/`resume` are ignored and `finalize` waits for it. Double-clicking the mic therefore starts exactly one session.

## Behaviors that must hold

**Audio**

- One MediaRecorder per session, so all chunks form one valid WebM/MP4 file across any number of pause/resume cycles.
- Each pause writes the **complete** audio so far. `audioData` has exactly one row per session (upsert); the stored blob grows with each pause.
- Playback becomes available as soon as the pause completes. If the database write fails, the audio is still playable from memory and an error is shown.
- Chrome WebM blobs report an infinite duration; the UI uses the tracked duration instead.

**Timer and duration**

- Elapsed time is the sum of recording segments; time spent paused is not counted.
- The stored session duration equals the elapsed time at the last save. Ending a session while recording (e.g. New Session) saves the final segment too.

**Transcript**

- Interim text is a single faded bubble that updates in place; a final result replaces it and is appended once. Final segments are stored once each, with the elapsed time at which they arrived.
- The engine is stopped and awaited on pause, so speech the browser flushes on stop is still captured; it is restarted on resume.
- After resume, result numbering restarts in the browser; the engine resets its de-duplication index so new segments are not dropped.
- If speech recognition is unavailable, or fails to start, recording continues audio-only and the transcript panel explains why. Benign errors (`no-speech`, `aborted`) are not shown; fatal ones (`not-allowed`, `network`, ...) are shown and do not cause reconnect loops.

**Microphone**

- The mic stream opens once per session and is reused across resume. `finalize` (and any failed start) stops every track.
- A denied or missing microphone shows an inline message, leaves the app idle and creates no session row.

**Saved sessions are view-only**

- Selecting a session loads its audio, transcript and duration. The mic button is disabled with the hint "Click New Session to record again", because a new MediaRecorder would produce a second container that cannot be joined to the stored file.
- Selecting a session, or New Session, while recording first saves the recording, then switches. Deleting or clearing while recording saves first, then deletes, so no orphan rows remain.

## Visual states

| State         | Mic button                   | Timer colour | EQ visualizer                          |
| ------------- | ---------------------------- | ------------ | -------------------------------------- |
| idle (empty)  | blue "Ready"                 | grey `0:00`  | grey baseline bars                     |
| recording     | red, spinning + pulsing ring | red          | live red bars (microphone)             |
| paused        | amber "Paused"               | amber        | playback analyser (green when playing) |
| viewing saved | blue, disabled               | grey         | playback analyser                      |

## Regression checklist

1. Start → speak → pause: paused UI, playback works, sidebar lists the session, one `audioData` row.
2. Resume → speak → pause: playback covers both segments; stored size grew; still one row; each phrase shown and stored once.
3. Stay paused ~3 s: timer does not advance; engine stopped.
4. Rapid pause/resume: engine ends `listening`; no "already started" errors.
5. New Session while recording: mic indicator turns off; view clears; session saved with full duration.
6. Open a saved session: transcript in order, saved duration shown, playback works, mic disabled.
7. Delete the open session / Clear All while recording: no orphan `sessions`, `audioData` or `transcripts` rows.
8. Deny mic permission: inline error, still Ready, no session created.
9. Browser without Web Speech: page renders, audio records, transcript panel shows the notice.
