# ReVoice API Reference

Complete API documentation for all public interfaces, types, and functions in ReVoice.

## Table of Contents

1. [Types & Interfaces](#types--interfaces)
2. [Engine API](#engine-api)
3. [Database API](#database-api)
4. [Audio Utilities](#audio-utilities)
5. [Compatibility API](#compatibility-api)
6. [State Classes](#state-classes)
7. [Component Props](#component-props)

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
	 * @returns EngineState: 'idle' | 'connecting' | 'listening'
	 * - 'idle': Not running
	 * - 'connecting': Started (or auto-reconnecting), waiting for the recognizer to confirm audio
	 * - 'listening': Recognition is live and results can arrive
	 */
	getState(): EngineState;

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
	constructor();
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

| Browser | Version | Notes                                       |
| ------- | ------- | ------------------------------------------- |
| Chrome  | 25+     | Full support, reliable                      |
| Safari  | 14.1+   | Works but may require user gesture          |
| Firefox | 25+     | Supported but inconsistent across platforms |
| Edge    | 79+     | Full support (Chromium-based)               |
| Opera   | 27+     | Full support                                |
| IE 11   | ❌      | Not supported                               |

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
	transcripts: '++id, sessionId, text, time',
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
): Promise<number>;
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
function getAllSessions(): Promise<Session[]>;
```

**Returns**: Array of Session records

**Example**:

```typescript
const allSessions = await getAllSessions();
allSessions.forEach((session) => {
	console.log(`${session.title}: ${session.duration}ms`);
});
```

##### getSession()

Retrieves single session by ID.

```typescript
function getSession(sessionId: number): Promise<Session | undefined>;
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

Stores the audio for a session, **replacing** any audio already stored for it.

```typescript
function storeAudioData(sessionId: number, blob: Blob): Promise<number>;
```

Each save is the complete recording so far (all MediaRecorder chunks concatenated), so this is an upsert (delete + add in one transaction). `audioData` therefore holds at most one row per session.

**Returns**: ID of the stored AudioData row

##### getSessionAudio()

Retrieves audio blob for a session.

```typescript
function getSessionAudio(sessionId: number): Promise<Blob | undefined>;
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
): Promise<number>;
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
	await storeTranscript(sessionId, result.text, result.time, result.isFinal);
});
```

##### getSessionTranscripts()

Returns every transcript segment for a session, sorted by `time`.

```typescript
function getSessionTranscripts(sessionId: number): Promise<Transcript[]>;
```

##### deleteSession()

Deletes a session and ALL its related data (audio, transcripts).

```typescript
function deleteSession(sessionId: number): Promise<void>;
```

**Important**: This deletes entire session - audio blob and all transcripts.

**Example**:

```typescript
await deleteSession(42); // Session completely removed
```

##### clearAllData()

DANGEROUS: Completely wipes database.

```typescript
function clearAllData(): Promise<void>;
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

Picks the best audio format the browser can record.

```typescript
function getSupportedAudioFormat(): AudioFormat; // { mimeType: string; codecs?: string[] }
```

**Preference**: `audio/webm;codecs=opus` → `audio/webm` → `audio/mp4` (Safari) → `audio/webm` fallback.

```typescript
const { mimeType } = getSupportedAudioFormat();
const recorder = new MediaRecorder(stream, { mimeType });
```

### getSharedAudioContext()

**File**: `src/lib/audio.ts`

Returns the app-wide `AudioContext`, creating it on first use and resuming it if suspended. Browsers limit how many contexts may exist, so all code shares this one. Call it first from a user gesture (Safari).

```typescript
function getSharedAudioContext(): AudioContext;
```

---

## Compatibility API

### checkApiSupport()

**File**: `src/lib/compat.ts`

Detects which required browser APIs are available.

```typescript
function checkApiSupport(): ApiSupport;
```

**Returns**:

```typescript
interface ApiSupport {
	webSpeech: boolean; // Web Speech API available
	mediaRecorder: boolean; // MediaRecorder API available
	webAudio: boolean; // Web Audio API available
	indexedDB: boolean; // IndexedDB available
	allSupported: boolean; // All four APIs present
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
function getBrowserName(): string;
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
function getBrowserSpecificNotes(): string[];
```

**Example Results**:

- Safari: `["Web Speech API requires user gesture", "May send audio to Apple servers"]`
- Firefox: `["Web Speech recognition may be slow"]`
- Chrome: `[]` (no special notes)

**Example**:

```typescript
const notes = getBrowserSpecificNotes();
notes.forEach((note) => console.log(`⚠️  ${note}`));
```

---

## State Classes

Both live in `.svelte.ts` files and expose Svelte 5 reactive state.

### Recorder

**File**: `src/lib/recorder.svelte.ts`

Recording state machine plus the data for the session on screen. See [RECORDING_FLOW.md](RECORDING_FLOW.md) for the expected behavior.

```typescript
class Recorder {
	constructor(engine: ITranscriptionEngine | null, hooks?: RecorderHooks);

	// Reactive state
	state: 'idle' | 'recording' | 'paused';
	elapsedMs: number; // excludes paused time
	sessionId: number | null;
	finals: TranscriptionResult[];
	interim: TranscriptionResult | null;
	audioBlob: Blob | null;
	analyser: AnalyserNode | null;
	error: string | null;

	start(): Promise<void>; // idle → recording (user gesture)
	pause(): Promise<void>; // recording → paused, saves audio
	resume(): Promise<void>; // paused → recording (same MediaRecorder)
	finalize(): Promise<void>; // any → idle: stop, save, release mic
	open(session: Session): Promise<void>; // view a saved session (idle only)
	reset(): void; // clear the on-screen session (idle only)
	dispose(): void; // finalize + unsubscribe from the engine
}

interface RecorderHooks {
	sessionCreated?(session: Session): void;
	audioSaved?(): void;
}
```

### SessionStore

**File**: `src/lib/sessions.svelte.ts`. Created by the layout; obtain it with `getSessionStore()` from `$lib/context`.

```typescript
class SessionStore {
	sessions: Session[]; // newest first
	selected: Session | null;

	attach(handlers: { open(s: Session): Promise<void>; reset(): Promise<void> }): () => void;
	refresh(): Promise<void>;
	adopt(session: Session): void; // mark selected without loading (recorder made it)
	select(session: Session): Promise<void>; // stop recording, then load
	startNew(): Promise<void>; // stop recording, then clear
	remove(id: number): Promise<void>; // resets first if it is the open session
	clearAll(): Promise<void>;
}
```

---

## Component Props

### CompatibilityShield

Modal guard that checks API compatibility before rendering app.

**Props**:

```typescript
interface Props {
	children?: any; // App content to render (or block)
}
```

**Behavior**:

- If APIs missing: Shows warning modal
- User can click "Continue Anyway" to dismiss
- Always renders children (whether warning shown or not)

### EqVisualizer

Canvas frequency-bar visualizer. Uses the playback analyser from an enclosing `AudioPlaybackProvider` when present (green bars), otherwise `recordingAnalyser` (red bars).

**Props**:

```typescript
interface Props {
	recordingAnalyser?: AnalyserNode; // microphone analyser
	barCount?: number; // default 32; FFT size is set to barCount * 2 (power of two)
	height?: number; // canvas height in px (default 200)
	barColor?: string; // overrides the automatic colour
	disabledBarColor?: string; // default "#d1d5db"
	pausedBarColor?: string; // default "#f59e0b"
	disabled?: boolean; // flat baseline bars, no animation
	frozen?: boolean; // draw the last live frame once, no animation
}
```

**Example**:

```svelte
<EqVisualizer recordingAnalyser={recorder.analyser ?? undefined} barCount={32} height={150} />
```

### TranscriptionProvider

Puts the engine into context for descendants.

**Props**:

```typescript
interface Props {
	engine: ITranscriptionEngine | null; // null = speech recognition unavailable
	children?: Snippet;
}
```

**Child access** (typed helper from `$lib/context`):

```svelte
<script lang="ts">
	import { getTranscriptionEngine } from '$lib/context';
	const engine = getTranscriptionEngine(); // ITranscriptionEngine | null
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

- **0.1.0** - Stabilization release
  - Fixed resume, mic-stream sharing, duplicate transcripts and stale stored audio
  - Added `Recorder` and `SessionStore`; removed the unused playback dock and helper functions
  - Database schema v3 (one audio row per session)

- **1.0.0** - Initial release
  - Native engine implementation
  - IndexedDB persistence
  - Frequency visualization
  - Cross-browser compatibility checks
