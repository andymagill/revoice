# Recording Flow & Expected Behavior

## Overview

ReVoice implements a finite state machine (FSM) pattern for managing recording sessions with automatic save-on-pause and integrated playback preview capabilities. This document defines the expected behavior to guide development and prevent regressions.

## Finite State Machine

### States

The recording system operates in one of three states:

```
┌─────────┐
│  idle   │ ← Initial state, no active session
└────┬────┘
     │ start recording
     ▼
┌──────────┐
│recording │ ← Active recording, audio streaming
└────┬─────┘
     │ pause (auto-saves)
     ▼
┌─────────┐
│ paused  │ ← Recording paused, playback enabled
└────┬────┘
     │ resume / clear
     ▼
(back to recording or idle)
```

#### State Definitions

| State         | Description                         | Playback Controls                         | Recording Active | Auto-Saved |
| ------------- | ----------------------------------- | ----------------------------------------- | ---------------- | ---------- |
| **idle**      | No active recording session         | Disabled (unless previous session exists) | ❌               | N/A        |
| **recording** | Audio actively being captured       | Disabled                                  | ✅               | ❌         |
| **paused**    | Recording paused, preview available | **Enabled**                               | ❌               | ✅         |

### Valid State Transitions

```typescript
type RecordingState = 'idle' | 'recording' | 'paused';

// Valid transitions:
idle      → recording  // Start recording
recording → paused     // Pause (triggers auto-save)
paused    → recording  // Resume recording
paused    → idle       // Clear session
recording → idle       // Clear session (saves first)
```

## User Flow

### Starting a Recording

**User Action:** Click microphone button (blue)

**System Behavior:**

1. Request microphone access
2. Initialize AudioContext and AnalyserNode
3. Create MediaRecorder with optimal audio format
4. Create session in IndexedDB
5. Transition to `recording` state
6. Start timer
7. Begin transcription engine

**UI State:**

- Microphone button: Red with pulsing shadow
- Status: "Recording"
- Timer: Active, counting up
- EQ Visualizer: Active red bars
- Playback Controls: Disabled
- Clear Button: Visible

### Pausing a Recording

**User Action:** Click microphone button (red) while recording

**System Behavior:**

1. Call `mediaRecorder.requestData()` to flush pending chunks
2. Call `mediaRecorder.pause()`
3. Create Blob from **all audio chunks** collected so far
4. **Auto-save blob to IndexedDB** (no user action required)
5. Update session duration in IndexedDB
6. Make blob available to playback controls
7. Stop timer
8. Suppress transcription timeout errors
9. Transition to `paused` state

**UI State:**

- Microphone button: Amber/orange
- Status: "Paused"
- Timer: Frozen at current time
- EQ Visualizer: Frozen amber bars (preserves last frame)
- Playback Controls: **Enabled** with current audio
- Clear Button: Visible
- Status Message: "Paused. Use playback controls to review. Click mic to resume recording."

**Critical Behavior:**

- ✅ Audio is immediately saved to IndexedDB
- ✅ No data loss if user closes tab
- ✅ User can play/pause/seek through recorded audio
- ✅ Audio chunks remain in memory for resuming

### Playing Back During Pause

**User Action:** Click play button on playback controls (while paused)

**System Behavior:**

1. AudioPlaybackProvider creates AudioContext
2. Connects HTMLAudioElement to AnalyserNode via `createMediaElementSource()`
3. Audio plays through speakers
4. EQ Visualizer switches to playback mode (green bars)
5. Timeline slider updates with current position
6. Time displays show current/total duration

**UI State:**

- Recording still in `paused` state
- Playback button: Shows pause icon (Lucide `Pause`)
- EQ Visualizer: Active green bars (playback mode)
- Timeline Slider: Active, user can drag to seek
- Microphone button: Still amber (recording paused)

**User Can:**

- ✅ Play/pause the audio
- ✅ Seek to any position using slider
- ✅ See time elapsed/remaining
- ✅ View frequency visualization of playback

**User Cannot:**

- ❌ Record new audio while playback is active
- ❌ See transcription updates (transcription paused)

### Resuming Recording

**User Action:** Click microphone button (amber) while paused

**System Behavior:**

1. Call `mediaRecorder.resume()`
2. Re-enable transcription error reporting
3. Restart timer from previous time
4. Transition to `recording` state
5. Continue accumulating audio chunks (append to existing)

**UI State:**

- Microphone button: Red with pulsing shadow
- Status: "Recording"
- Timer: Continues from paused time
- EQ Visualizer: Active red bars (recording mode)
- Playback Controls: Disabled
- Clear Button: Visible

**Critical Behavior:**

- ✅ New audio appends to existing chunks
- ✅ Previous recording is NOT lost
- ✅ Next pause will save complete audio (old + new)

### Pausing Again After Resume

**User Action:** Pause recording again after resuming

**System Behavior:**

1. Same as first pause, but with MORE chunks
2. Create blob from ALL chunks (including new ones)
3. **Overwrite IndexedDB** with updated, complete audio
4. Update session duration
5. Make new blob available for playback

**Critical Behavior:**

- ✅ Complete audio includes all segments (pre-pause + post-resume)
- ✅ IndexedDB contains the full, updated recording
- ✅ User can preview entire recording, including new parts

### Clearing a Recording

**User Action:** Click "Clear" button → Confirm in dialog

**System Behavior:**

1. Stop MediaRecorder if active
2. Stop transcription engine
3. Stop microphone stream
4. Clear timer
5. If currently in `recording` state (not paused):
   - Create final blob from chunks
   - Save to IndexedDB
   - Update duration
6. If in `paused` state:
   - Audio already saved, just update duration
7. Transition to `idle` state
8. Keep sessionId and currentAudioBlob for playback
9. Clear transcript results

**UI State:**

- Microphone button: Blue (ready to start)
- Status: "Ready"
- Timer: Reset to 0:00
- EQ Visualizer: Flat gray bars (disabled)
- Playback Controls: **Enabled** with saved audio
- Clear Button: Hidden
- Transcript: Cleared

**Critical Behavior:**

- ✅ Audio is saved before clearing
- ✅ User can still play back the completed recording
- ✅ User can start a new recording session
- ✅ No data loss

## Playback Controls Behavior

### When Disabled (recording state)

**Visual State:**

- Play/Pause button: Grayed out, not clickable
- Timeline slider: Grayed out, not draggable
- Time displays: Show 00:00 / 00:00

**Why Disabled:**

- Cannot play recorded audio while actively recording
- Prevents audio feedback loops
- Keeps UI simple and focused on recording

### When Enabled (idle or paused state)

**Visual State:**

- Play/Pause button: Active, shows appropriate icon
- Timeline slider: Active, responds to drag/click
- Time displays: Show current time / total duration

**Available Actions:**

- ✅ Play/pause audio
- ✅ Seek to any position
- ✅ See real-time progress
- ✅ View frequency visualization

## EQ Visualizer Behavior

### Recording Mode (Red)

**Active:** Recording in progress

- Color: Red (#ef4444)
- Bars: Dynamic, responding to microphone input
- Animation: 60 FPS updates

**Frozen:** Recording paused

- Color: Amber (#f59e0b)
- Bars: Frozen at last captured frame
- Animation: Stopped (CPU efficient)

**Disabled:** Not recording

- Color: Gray (#d1d5db)
- Bars: Flat at 30% height
- Animation: None

### Playback Mode (Green)

**Active:** Audio playing

- Color: Green (#10b981)
- Bars: Dynamic, responding to audio playback
- Animation: 60 FPS updates

**Frozen:** Audio paused

- Color: Amber (#f59e0b)
- Bars: Frozen at last frame
- Animation: Stopped

## Data Persistence

### Auto-Save Mechanism

**Trigger:** Every pause action

**What Gets Saved:**

1. Complete audio blob (all chunks so far)
2. Session metadata (title, timestamp, MIME type)
3. Duration (elapsed time)
4. Transcript segments with timestamps

**Storage Location:** IndexedDB

- Sessions table: Metadata
- AudioData table: Blob
- Transcripts table: Text segments

**Benefits:**

- ✅ No explicit "save" button needed
- ✅ Work is preserved on every pause
- ✅ Safe to close browser tab after pausing
- ✅ Automatic recovery from crashes (after pause)

### What Happens If User Closes Tab

| State When Closed | Data Preserved               | Can Recover |
| ----------------- | ---------------------------- | ----------- |
| **idle**          | Previous sessions            | ✅ Yes      |
| **recording**     | Nothing from current session | ❌ No       |
| **paused**        | Everything up to last pause  | ✅ Yes      |

**Recommendation to Users:**

- Pause recording periodically to auto-save
- Pausing = instant checkpoint

## Technical Implementation Details

### MediaRecorder Chunk Management

The save-on-pause implementation uses a robust flush-and-wait pattern to ensure all audio data is captured before constructing the final blob:

```javascript
// Helper function to ensure final chunk is received
function flushRecorderAndWait(recorder: MediaRecorder): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      recorder.removeEventListener('dataavailable', handler);
      resolve();
    }, 1000);

    const handler = (event: BlobEvent) => {
      if (event.data.size > 0) {
        clearTimeout(timeout);
        recorder.removeEventListener('dataavailable', handler);
        resolve();
      }
    };

    recorder.addEventListener('dataavailable', handler, { once: true });
  });
}

// On pause (flush remaining data and wait)
mediaRecorder.requestData(); // Forces final chunk
await flushRecorderAndWait(mediaRecorder); // Wait for final chunk

// Now safe to create blob from ALL chunks
const blob = new Blob(audioChunks, { type: format.mimeType });
await storeAudioData(sessionId, blob);
await updateSessionDuration(sessionId, duration);

// Best-effort localStorage backup (base64) for recovery
try {
  const base64 = await blobToBase64(audioBlob);
  localStorage.setItem(`revoice-backup-${sessionId}`, base64);
} catch (backupError) {
  // Non-critical: localStorage may be full
  console.warn('Failed to create localStorage backup:', backupError);
}

// Only update state after save is complete
recordingState = 'paused';

// On resume
mediaRecorder.resume();
// Chunks continue accumulating in same array
```

**Key Implementation Details:**

- `flushRecorderAndWait()` attaches a one-time event handler to avoid race conditions
- Includes 1-second timeout fallback if event is not emitted
- localStorage backup is best-effort (wrapped in try-catch) for recovery scenarios
- State transition to 'paused' happens only after save completes, ensuring UI consistency

### Audio Playback Provider Pattern

```javascript
// AudioPlaybackProvider wraps playback controls
<AudioPlaybackProvider audio={htmlAudioElement}>
  <AudioPlaybackControls />
  <EqVisualizer mode="playback" />
</AudioPlaybackProvider>

// Provides via Svelte context:
{
  audio: HTMLAudioElement,
  audioContext: AudioContext,
  analyser: AnalyserNode,
  isConnected: boolean
}

// Connection: audio → analyser → destination (speakers)
```

### State Machine Implementation

```typescript
type RecordingState = 'idle' | 'recording' | 'paused';
let recordingState: RecordingState = $state('idle');

// Derived state helpers
const isRecording = $derived(recordingState === 'recording');
const isPaused = $derived(recordingState === 'paused');
const isActive = $derived(recordingState !== 'idle');

// Controls enabled/disabled based on state
<AudioPlaybackControls
  disabled={recordingState === 'recording'}
/>
```

## Edge Cases & Error Handling

### MediaRecorder Already Connected

**Issue:** `createMediaElementSource()` can only be called once per element

**Solution:** AudioPlaybackProvider manages the connection lifecycle, prevents duplicate calls

### Pause While Transcription Active

**Issue:** Speech recognition times out when audio stops

**Solution:** Set `suppressTranscriptionErrors = true` during pause state

### Resume Without Pause

**Issue:** Cannot resume if not paused

**Solution:** State machine prevents invalid transitions

```typescript
async function resumeRecording() {
	if (recordingState !== 'paused') return; // Guard clause
	// ...
}
```

### Empty Recording

**Issue:** User pauses immediately after starting

**Solution:** Valid state, creates valid blob (possibly silent audio)

### Browser Tab Visibility

**Issue:** Some browsers throttle background tabs

**Solution:** Recording continues normally, timer may appear to skip when tab regains focus (cosmetic only)

## Testing Guidelines

### Critical Paths to Test

1. **Basic Flow**
   - Start → Pause → Play → Resume → Pause → Clear
   - Verify audio saved at each pause
   - Verify playback works during pause

2. **Multiple Pause/Resume Cycles**
   - Record 5 seconds → Pause → Resume → Record 5 seconds → Pause
   - Verify final audio is ~10 seconds
   - Verify playback includes both segments

3. **Data Persistence**
   - Record → Pause → Close tab → Reopen
   - Verify session appears in history
   - Verify audio plays correctly

4. **State Transitions**
   - Verify buttons disabled/enabled at correct times
   - Verify EQ visualizer colors match state
   - Verify playback controls respond only when enabled

5. **Error Recovery**
   - Deny microphone permission → Verify error handling
   - Pause with no audio chunks → Verify no crash
   - Network failure during save → Verify graceful degradation

## Future Enhancements

### Potential Improvements

1. **Progress Indicator During Save**
   - Show spinner/progress while IndexedDB write in progress
   - Useful for large audio files

2. **Explicit Save Button**
   - Optional "Save & New" button during pause
   - Allows starting fresh session without clearing transcript

3. **Playback During Recording**
   - Monitor mode: hear your own voice with slight delay
   - Requires careful audio routing to prevent feedback

4. **Waveform Visualization**
   - Show static waveform of paused audio
   - More intuitive than frequency bars for playback

5. **Segment Markers**
   - Visual markers at each pause point
   - Jump to segments during playback
   - Useful for long, multi-pause recordings

## Change Log

### Version 1.0 (Current)

- Implemented 3-state FSM (idle, recording, paused)
- Auto-save on pause
- Playback preview during pause
- Dual-mode EQ visualizer (recording/playback)
- Frozen state visualization (amber bars)
- AudioPlaybackProvider pattern
- Shadcn-ui Slider component

---

**Last Updated:** January 10, 2026
**Document Owner:** Development Team
**Review Schedule:** Before any recording flow changes
