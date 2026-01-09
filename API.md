# ReVoice API Reference

Complete API documentation for all public interfaces, types, and functions in ReVoice.

## Table of Contents

1. [Types & Interfaces](#types--interfaces)
2. [Engine API](#engine-api)
3. [Database API](#database-api)
4. [Audio Utilities](#audio-utilities)
5. [Compatibility API](#compatibility-api)
6. [Component Props](#component-props)

---

## Types & Interfaces

### ITranscriptionEngine

**File**: `src/lib/types.ts`

Core interface that all transcription engines must implement. Define the contract between UI and transcription backend.

```typescript
interface ITranscriptionEngine {
  /**
   * Start recording and transcription
   * 
   * @param stream - MediaStream from getUserMedia()
   * @param config - Optional engine configuration (language, model, etc.)
   * @returns Promise that resolves when engine is ready
   * @throws May throw if permission denied or engine initialization fails
   */
  start(stream: MediaStream, config?: EngineConfig): Promise<void>;

  /**
   * Stop recording and transcription
   * 
   * @returns Promise that resolves when engine is fully stopped
   * Side effects: Emits final result if pending, cleans up resources
   */
  stop(): Promise<void>;

  /**
   * Get current engine state
   * 
   * @returns One of: 'idle' | 'listening' | 'processing'
   * - 'idle': Not recording, ready to start
   * - 'listening': Actively recording audio input
   * - 'processing': Completed recording, processing audio
   */
  getState(): 'idle' | 'listening' | 'processing';

  /**
   * Register callback for transcription results
   * 
   * @param callback - Called when engine has new transcription text
   * @returns Unsubscribe function to remove listener
   * 
   * @example
   * const unsubscribe = engine.onResult((result) => {
   *   console.log(`Interim: ${result.text}, Final: ${result.isFinal}`);
   * });
   * // Later: unsubscribe();
   */
  onResult(callback: (result: TranscriptionResult) => void): () => void;

  /**
   * Register callback for transcription errors
   * 
   * @param callback - Called if engine encounters an error
   * @returns Unsubscribe function
   * 
   * @example
   * engine.onError((error) => {
   *   console.error(`Engine error: ${error.code} - ${error.message}`);
   * });
   */
  onError(callback: (error: EngineError) => void): () => void;

  /**
   * Get metadata about this engine
   * 
   * @returns Object with name, version, type
   * 
   * @example
   * const meta = engine.getMetadata();
   * // { name: 'Native (Web Speech API)', version: '1.0.0', type: 'browser' }
   */
  getMetadata(): EngineMetadata;
}
```

### TranscriptionResult

Result object emitted when engine produces transcription text.

```typescript
interface TranscriptionResult {
  /** The transcribed text from this event */
  text: string;

  /** Whether this is final transcription (true) or interim/preview (false) */
  isFinal: boolean;

  /** Timestamp from session start (milliseconds) */
  time: number;

  /** Confidence score (0-1), engine-dependent */
  confidence?: number;
}
```

### EngineError

Error object passed to onError callbacks.

```typescript
interface EngineError {
  /** Error code: 'not-allowed' | 'network-error' | 'timeout' | 'unknown' */
  code: string;

  /** Human-readable error message */
  message: string;

  /** Original error if available */
  originalError?: Error;
}
```

### EngineConfig

Configuration passed to `engine.start()` for customizing transcription.

```typescript
interface EngineConfig {
  /** ISO language code (e.g., 'en-US', 'es-ES', 'fr-FR') */
  language?: string;

  /** Max result history to keep in memory */
  maxResults?: number;

  /** Engine-specific options object */
  options?: Record<string, any>;
}
```

### EngineMetadata

Metadata about transcription engine capabilities.

```typescript
interface EngineMetadata {
  /** Human-readable engine name */
  name: string;

  /** Version string (e.g., '1.0.0') */
  version: string;

  /** Type: 'browser' (local) | 'api' (cloud) | 'local-ml' (WASM model) */
  type: 'browser' | 'api' | 'local-ml';
}
```

### Session

Represents a recorded transcription session in database.

```typescript
interface Session {
  /** Auto-increment ID (primary key) */
  id?: number;

  /** Timestamp when recording started (Date.getTime()) */
  timestamp: number;

  /** Total recording duration in milliseconds */
  duration: number;

  /** User-provided title for this session */
  title: string;

  /** Audio format: "audio/webm;codecs=opus" | "audio/mp4" | etc. */
  mimeType: string;

  /** Which engine was used: "native" | "deepgram" | etc. */
  engineType: string;

  /** Total characters in final transcript */
  transcriptLength: number;
}
```

### AudioData

Binary audio blob storage in database.

```typescript
interface AudioData {
  /** Auto-increment ID (primary key) */
  id?: number;

  /** Foreign key to Session */
  sessionId: number;

  /** Audio file as Blob (binary data) */
  blob: Blob;
}
```

### Transcript

Individual transcription line in database.

```typescript
interface Transcript {
  /** Auto-increment ID (primary key) */
  id?: number;

  /** Foreign key to Session */
  sessionId: number;

  /** Transcribed text string */
  text: string;

  /** Time offset from session start (milliseconds) */
  time: number;

  /** Whether transcription is final or interim */
  isFinal: boolean;
}
```

---

## Engine API

### NativeEngine

**File**: `src/lib/engines/native.ts`

Uses browser's built-in Web Speech API for transcription (free, no API key required).

#### Constructor

```typescript
class NativeEngine extends TranscriptionEngine {
  constructor()
}
```

#### Methods

All methods defined by `ITranscriptionEngine` interface above.

#### Example Usage

```typescript
import { NativeEngine } from '$lib/engines/native';

// Create engine
const engine = new NativeEngine();

// Register callbacks
const unsubResult = engine.onResult((result) => {
  console.log(`${result.isFinal ? 'Final' : 'Interim'}: ${result.text}`);
});

const unsubError = engine.onError((error) => {
  console.error(`Error [${error.code}]: ${error.message}`);
});

// Get microphone stream
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// Start transcription
await engine.start(stream, { language: 'en-US' });

// ... recording happens ...

// Stop transcription
await engine.stop();

// Cleanup
unsubResult();
unsubError();
```

#### Browser Support

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 25+ | Full support, reliable |
| Safari | 14.1+ | Works but may require user gesture |
| Firefox | 25+ | Supported but inconsistent across platforms |
| Edge | 79+ | Full support (Chromium-based) |
| Opera | 27+ | Full support |
| IE 11 | ❌ | Not supported |

#### Limitations

- Recognition is terminated automatically after ~10 seconds of silence
- No guarantee of high accuracy (depends on OS speech recognition engine)
- Language must be specified before start() (cannot change mid-stream)
- Network-based: may send audio to cloud services (varies by browser/OS)

---

## Database API

### ReVoiceDB

**File**: `src/lib/db.ts`

Dexie.js wrapper around IndexedDB for persisting sessions, audio, and transcripts.

#### Singleton Instance

```typescript
import { db } from '$lib/db';

// Use the shared database instance
const sessions = await db.getAllSessions();
```

#### Schema

```javascript
// Three object stores with indexes for common queries
db.version(1).stores({
  // Session metadata (fast lookups)
  sessions: '++id, timestamp, duration, title, mimeType, engineType',
  
  // Audio binary data (large blobs)
  audioData: '++id, sessionId',
  
  // Transcription text (indexed by session)
  transcripts: '++id, sessionId, text, time'
});
```

#### Methods

##### createSession()

Creates new session record and returns its ID.

```typescript
function createSession(
  title: string,
  duration: number,
  mimeType: string,
  engineType: string,
  transcriptLength: number
): Promise<number>
```

**Parameters**:
- `title` - User-provided name (e.g., "Meeting Notes")
- `duration` - Total recording time in milliseconds
- `mimeType` - Audio format (e.g., "audio/webm;codecs=opus")
- `engineType` - Engine used (e.g., "native")
- `transcriptLength` - Total characters in transcript

**Returns**: Session ID (can be used for subsequent calls)

**Example**:
```typescript
const sessionId = await createSession(
  'Team Meeting',
  300000, // 5 minutes
  'audio/webm;codecs=opus',
  'native',
  1500 // 1500 characters of text
);
```

##### getAllSessions()

Retrieves all sessions, ordered by timestamp (newest first).

```typescript
function getAllSessions(): Promise<Session[]>
```

**Returns**: Array of Session records

**Example**:
```typescript
const allSessions = await getAllSessions();
allSessions.forEach(session => {
  console.log(`${session.title}: ${session.duration}ms`);
});
```

##### getSession()

Retrieves single session by ID.

```typescript
function getSession(sessionId: number): Promise<Session | undefined>
```

**Returns**: Session record or undefined if not found

**Example**:
```typescript
const session = await getSession(42);
if (session) {
  console.log(`Session: ${session.title}`);
} else {
  console.log('Session not found');
}
```

##### storeAudioData()

Saves audio blob for a session.

```typescript
function storeAudioData(sessionId: number, audioBlob: Blob): Promise<number>
```

**Parameters**:
- `sessionId` - Which session this audio belongs to
- `audioBlob` - Binary audio data (from MediaRecorder)

**Returns**: AudioData record ID

**Example**:
```typescript
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm'
});

mediaRecorder.ondataavailable = (event) => {
  await storeAudioData(sessionId, event.data);
};
```

##### getSessionAudio()

Retrieves audio blob for a session.

```typescript
function getSessionAudio(sessionId: number): Promise<Blob | undefined>
```

**Returns**: Audio blob or undefined if not found

**Example**:
```typescript
const audioBlob = await getSessionAudio(42);
if (audioBlob) {
  const url = URL.createObjectURL(audioBlob);
  // Use url in <audio> element
}
```

##### storeTranscript()

Saves transcription line to database.

```typescript
function storeTranscript(
  sessionId: number,
  text: string,
  time: number,
  isFinal: boolean
): Promise<number>
```

**Parameters**:
- `sessionId` - Which session this belongs to
- `text` - Transcribed text
- `time` - Offset from session start (milliseconds)
- `isFinal` - Whether this is final or interim result

**Returns**: Transcript record ID

**Example**:
```typescript
engine.onResult(async (result) => {
  await storeTranscript(
    sessionId,
    result.text,
    result.time,
    result.isFinal
  );
});
```

##### getSessionTranscripts()

Retrieves all transcript lines for a session.

```typescript
function getSessionTranscripts(sessionId: number): Promise<Transcript[]>
```

**Returns**: Array of Transcript records, ordered by time

**Example**:
```typescript
const transcripts = await getSessionTranscripts(42);
const fullText = transcripts
  .filter(t => t.isFinal)
  .map(t => t.text)
  .join(' ');
```

##### getSessionFullTranscript()

Gets complete concatenated transcript for a session.

```typescript
function getSessionFullTranscript(sessionId: number): Promise<string>
```

**Returns**: Full text string with all final transcripts joined

**Example**:
```typescript
const fullText = await getSessionFullTranscript(42);
console.log(fullText);
// Outputs: "Hello world this is my transcript..."
```

##### deleteSession()

Deletes a session and ALL its related data (audio, transcripts).

```typescript
function deleteSession(sessionId: number): Promise<void>
```

**Important**: This deletes entire session - audio blob and all transcripts.

**Example**:
```typescript
await deleteSession(42); // Session completely removed
```

##### getDBStats()

Returns current database usage statistics.

```typescript
function getDBStats(): Promise<{
  sessionCount: number;
  totalAudioSize: number;
  totalTranscriptChars: number;
  totalSize: number;
}>
```

**Returns**: Object with storage metrics

**Example**:
```typescript
const stats = await getDBStats();
console.log(`${stats.sessionCount} sessions`);
console.log(`${Math.round(stats.totalAudioSize / 1024)}KB of audio`);
```

##### clearAllData()

DANGEROUS: Completely wipes database.

```typescript
function clearAllData(): Promise<void>
```

**Use with caution**: This deletes ALL sessions, audio, and transcripts.

**Example**:
```typescript
// Only use for testing or explicit user action
if (confirm('Delete all recordings?')) {
  await clearAllData();
}
```

---

## Audio Utilities

### getSupportedAudioFormat()

**File**: `src/lib/audio.ts`

Detects which audio MIME type the browser supports for recording.

```typescript
function getSupportedAudioFormat(): string
```

**Returns**: MIME type string (e.g., "audio/webm;codecs=opus" or "audio/mp4")

**Browser Defaults**:
- **Chrome/Edge**: `audio/webm;codecs=opus` (WebM with Opus codec)
- **Safari**: `audio/mp4` (MP4/AAC format)
- **Firefox**: `audio/webm` (WebM with Vorbis)

**Example**:
```typescript
const mimeType = getSupportedAudioFormat();
const mediaRecorder = new MediaRecorder(stream, { mimeType });
```

### cloneMediaStream()

Creates separate audio stream copies for concurrent consumers.

```typescript
function cloneMediaStream(
  originalStream: MediaStream,
  audioContext: AudioContext
): { mediaRecorderTrack: MediaStream; analyserTrack: MediaStream }
```

**Why**: 
- One copy goes to MediaRecorder (persistence)
- One copy goes to Web Audio (visualization)
- Microphone can only have one consumer without cloning

**Parameters**:
- `originalStream` - MediaStream from getUserMedia()
- `audioContext` - AudioContext for processing

**Returns**: Object with two separate streams

**Example**:
```typescript
const originalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

const { mediaRecorderTrack, analyserTrack } = cloneMediaStream(
  originalStream,
  audioContext
);

// Use mediaRecorderTrack with MediaRecorder
const recorder = new MediaRecorder(mediaRecorderTrack);

// Use analyserTrack with analyser for visualization
const source = audioContext.createMediaStreamAudioSource(analyserTrack);
const analyser = audioContext.createAnalyser();
source.connect(analyser);
```

### createMediaRecorder()

Convenience function to create MediaRecorder with auto-detected MIME type.

```typescript
function createMediaRecorder(
  stream: MediaStream,
  onDataAvailable?: (blob: Blob) => void
): MediaRecorder
```

**Parameters**:
- `stream` - MediaStream to record
- `onDataAvailable` - Optional callback for data chunks

**Returns**: Configured MediaRecorder instance

**Example**:
```typescript
const recorder = createMediaRecorder(stream, (blob) => {
  console.log(`Recorded chunk: ${blob.size} bytes`);
});

recorder.start();
// ... recording ...
recorder.stop();
```

### blobToBase64()

Converts audio Blob to Base64 string for transmission or storage.

```typescript
function blobToBase64(blob: Blob): Promise<string>
```

**Use Cases**:
- Sending audio to API endpoints
- Storing in text-based databases
- Embedding in data URIs

**Returns**: Promise resolving to Base64 string

**Example**:
```typescript
const audioBlob = await getSessionAudio(sessionId);
const base64 = await blobToBase64(audioBlob);
// Can now send to API: fetch('/api/process', { body: base64 })
```

### getAudioFileExtension()

Maps MIME type to file extension.

```typescript
function getAudioFileExtension(mimeType: string): string
```

**Mappings**:
- `audio/webm;codecs=opus` → `webm`
- `audio/mp4` → `m4a`
- `audio/mpeg` → `mp3`
- Fallback → `wav`

**Returns**: File extension without dot

**Example**:
```typescript
const mimeType = getSupportedAudioFormat();
const ext = getAudioFileExtension(mimeType);
const filename = `recording.${ext}`; // e.g., "recording.webm"
```

---

## Compatibility API

### checkApiSupport()

**File**: `src/lib/compat.ts`

Detects which required browser APIs are available.

```typescript
function checkApiSupport(): ApiSupport
```

**Returns**:
```typescript
interface ApiSupport {
  webSpeech: boolean;      // Web Speech API available
  mediaRecorder: boolean;  // MediaRecorder API available
  webAudio: boolean;       // Web Audio API available
  indexedDB: boolean;      // IndexedDB available
  allSupported: boolean;   // All four APIs present
}
```

**Example**:
```typescript
const support = checkApiSupport();
if (!support.allSupported) {
  console.warn('Some APIs missing:');
  console.log(`  Web Speech: ${support.webSpeech}`);
  console.log(`  MediaRecorder: ${support.mediaRecorder}`);
  console.log(`  Web Audio: ${support.webAudio}`);
  console.log(`  IndexedDB: ${support.indexedDB}`);
}
```

### getBrowserName()

Returns friendly browser name.

```typescript
function getBrowserName(): string
```

**Returns**: Browser name like "Chrome", "Safari", "Firefox", "Unknown"

**Example**:
```typescript
const browser = getBrowserName();
console.log(`Running on ${browser}`);
```

### getBrowserSpecificNotes()

Returns array of browser-specific warnings/tips.

```typescript
function getBrowserSpecificNotes(): string[]
```

**Example Results**:
- Safari: `["Web Speech API requires user gesture", "May send audio to Apple servers"]`
- Firefox: `["Web Speech recognition may be slow"]`
- Chrome: `[]` (no special notes)

**Example**:
```typescript
const notes = getBrowserSpecificNotes();
notes.forEach(note => console.log(`⚠️  ${note}`));
```

### isIOS()

Checks if device is iPhone/iPad.

```typescript
function isIOS(): boolean
```

**Example**:
```typescript
if (isIOS()) {
  console.log('Running on iOS');
}
```

### isMacOS()

Checks if device is Mac.

```typescript
function isMacOS(): boolean
```

---

## Component Props

### CompatibilityShield

Modal guard that checks API compatibility before rendering app.

**Props**:
```typescript
interface Props {
  children?: any;  // App content to render (or block)
}
```

**Behavior**:
- If APIs missing: Shows warning modal
- User can click "Continue Anyway" to dismiss
- Always renders children (whether warning shown or not)

### EqVisualizer

Canvas-based frequency spectrum visualizer.

**Props**:
```typescript
interface Props {
  audioContext?: AudioContext;  // AudioContext (unused, for compatibility)
  analyser?: AnalyserNode;      // REQUIRED: AnalyserNode with frequency data
  barCount?: number;            // Number of bars (default: 32)
  height?: number;              // Canvas height in pixels (default: 200)
  barColor?: string;            // Bar color (default: "#3b82f6")
}
```

**Example**:
```svelte
<EqVisualizer
  analyser={analyser}
  barCount={32}
  height={150}
  barColor="#10b981"
/>
```

### TranscriptionProvider

Context provider injecting engine into component tree.

**Props**:
```typescript
interface Props {
  engine: ITranscriptionEngine;  // REQUIRED: Engine instance
  children?: any;                // Child components with access to engine
}
```

**Example**:
```svelte
<TranscriptionProvider engine={nativeEngine}>
  <RecordingControls />
</TranscriptionProvider>
```

**Child Access**:
```svelte
<script>
  import { getContext } from 'svelte';
  const engine = getContext('transcriptionEngine');
</script>
```

---

## Error Handling Examples

### Handle Engine Errors

```typescript
engine.onError((error) => {
  switch (error.code) {
    case 'not-allowed':
      console.error('Microphone permission denied');
      break;
    case 'network-error':
      console.error('Network connectivity issue');
      break;
    case 'timeout':
      console.error('Recognition timeout');
      break;
    default:
      console.error(`Unknown error: ${error.message}`);
  }
});
```

### Handle Missing Context

```svelte
<script>
  import { getContext } from 'svelte';
  
  const engine = getContext('transcriptionEngine');
  
  if (!engine) {
    throw new Error('TranscriptionProvider not found in parent');
  }
</script>
```

### Handle Database Errors

```typescript
try {
  await deleteSession(sessionId);
} catch (error) {
  console.error('Failed to delete session:', error);
}
```

---

## Version History

- **1.0.0** - Initial release
  - Native engine implementation
  - IndexedDB persistence
  - Frequency visualization
  - Cross-browser compatibility checks
