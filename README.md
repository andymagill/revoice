# ReVoice PoC - Voice Transcription Application

A proof-of-concept browser-based voice recording & transcription application leveraging native browser APIs for speed, portability, and privacy-first audio handling.

## Demo

🚀 **[Launch the live demo](https://revoice.magill.dev)**

## Overview

ReVoice is designed to demonstrate the capabilities of modern browser APIs for real-time voice recording and transcription. It avoids heavy local AI models in favor of the **Web Speech API** for fast transcription and **MediaRecorder API** for transparent audio persistence, all within the browser's security context.

### Key Features

- **Native Browser APIs**: Uses webkitSpeechRecognition for fast, low-latency transcription
- **Local Storage**: Recorded audio and transcripts are persisted in the browser using IndexedDB. **Note:** The Web Speech API sends audio to cloud services (Google/Apple) for transcription.
- **Modular Architecture**: Pluggable transcription engines allow easy integration of 3rd-party services
- **Cross-Browser Support**: Tested on Chrome/Chromium and Safari (iOS & macOS)
- **Real-Time Visualization**: Canvas-based 32-bar frequency analyzer
- **Session Management**: Automatic storage and retrieval of recording sessions
- **Static Deployment**: Builds to a static SPA for deployment on Cloudflare Pages or similar

## Tech Stack

| Component  | Technology                           | Purpose                                       |
| ---------- | ------------------------------------ | --------------------------------------------- |
| Framework  | SvelteKit                            | Fast, reactive UI components                  |
| Build Tool | Vite                                 | Modern, zero-config bundler                   |
| Styling    | Tailwind CSS                         | Utility-first CSS framework                   |
| Database   | Dexie.js                             | IndexedDB abstraction layer                   |
| APIs       | Web Speech, MediaRecorder, Web Audio | Native browser transcription & audio handling |

## Project Structure

```
src/
├── lib/
│   ├── components/          # Svelte UI components (+ ui/ shadcn primitives)
│   ├── engines/             # Transcription engines
│   │   ├── base.ts          # Abstract base class (subscribers, state machine)
│   │   ├── native.ts        # Web Speech API implementation
│   │   └── speech-recognition.ts  # Web Speech typings + constructor lookup
│   ├── recorder.svelte.ts   # Recorder: recording state machine + on-screen session data
│   ├── sessions.svelte.ts   # SessionStore: history, selection, new/delete/clear commands
│   ├── db.ts                # Dexie.js database layer
│   ├── audio.ts             # MIME detection, shared AudioContext
│   ├── compat.ts            # Browser compatibility checks
│   ├── context.ts           # Typed Svelte context helpers
│   ├── types.ts             # TypeScript interfaces & types
│   └── utils.ts             # cn(), formatDuration()
├── routes/
│   ├── +layout.svelte       # App shell: sidebar, header
│   ├── +layout.js           # SPA configuration
│   └── +page.svelte         # Recording dashboard
└── app.css                  # Global styles

build/                       # Static build output
ARCHITECTURE.md              # How the pieces fit together
specification.md             # Original product specification
```

## Getting Started

### Prerequisites

- Node.js 18+ with pnpm package manager
- Modern browser (Chrome/Edge or Safari)
- Microphone access permissions

### Installation

```bash
cd c:\Projects\ReVoice\revoice

# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Open http://localhost:5173 in your browser
```

### Building for Production

```bash
# Create static build
pnpm run build

# Output: ./build/ (ready for Cloudflare Pages)

# Preview production build locally
pnpm run preview
```

## Architecture

### Modular Transcription Engine System

The core innovation of ReVoice is its **pluggable engine architecture**. All transcription engines implement the `ITranscriptionEngine` interface:

```typescript
interface ITranscriptionEngine {
	start(stream: MediaStream, config?: EngineConfig): Promise<void>;
	stop(): Promise<void>;
	getState(): 'idle' | 'connecting' | 'listening';
	onResult(callback: (result: TranscriptionResult) => void): () => void;
	onError(callback: (error: Error) => void): () => void;
	getMetadata(): EngineMetadata;
}
```

#### Current Implementation

**NativeEngine** (`src/lib/engines/native.ts`)

- Uses `webkitSpeechRecognition` (available in Chrome, Edge, Safari)
- Continuous mode with interim results
- Supports multiple languages
- Fast latency (< 200ms target)

#### Future Extensibility

New engines can be added by:

1. Creating a new class extending `TranscriptionEngine`
2. Implementing the required methods
3. Registering via the `TranscriptionProvider`
4. No changes needed to UI components

Example: `DeepgramEngine`, `AssemblyAIEngine`, `LocalMLEngine`

### Data Persistence Layer

**Dexie.js Database Schema**

```javascript
db.version(1).stores({
	sessions: '++id, timestamp, duration, title, mimeType, engineType',
	audioData: '++id, sessionId',
	transcripts: '++id, sessionId, text, time',
});
```

**Stores:**

- **sessions**: Recording metadata (timestamp, duration, engine type, MIME type)
- **audioData**: Binary audio blob storage (indexed by sessionId)
- **transcripts**: Individual transcript segments with timing info

Recorded audio and transcripts are stored locally in the browser's IndexedDB. However, the transcription process uses the Web Speech API, which sends audio to cloud services (Google servers for Chrome/Edge, Apple servers for Safari).

### Audio Capture & Processing

ReVoice handles audio capture through a dual-track system:

1. **MediaRecorder Track**: Captures audio for persistence
   - Auto-detects MIME type (WebM/Opus for Chrome, MP4 for Safari)
   - Stores binary blob in IndexedDB

2. **Web Audio Track**: Powers the frequency visualizer
   - Creates AnalyserNode for real-time frequency data
   - Drives the 32-bar EQ visualizer

**Single stream**: One `getUserMedia` stream feeds both the MediaRecorder and the analyser; the same stream is reused across pause/resume and released when the session ends.

### Browser Compatibility

The `CompatibilityShield` component runs on page load to detect:

- ✅ Web Speech API support
- ✅ MediaRecorder API support
- ✅ Web Audio API support
- ✅ IndexedDB support

If any API is missing, users see a warning but can continue (graceful degradation).

#### Safari-Specific Handling

1. **User Gesture Requirement**: SpeechRecognition must start within a click handler
2. **MIME Type**: Uses `audio/mp4` instead of WebM
3. **AudioContext Restrictions**: May require explicit user interaction

These are handled transparently in the `NativeEngine` and `audio.ts` utilities.

## Component Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full map. The main pieces:

- **+layout.svelte**: app shell (sidebar with session history, header, page outlet). Creates the `SessionStore` and shares it via context.
- **+page.svelte**: the dashboard. Creates the engine and the `Recorder` and composes the widgets below.
- **RecordingControls**: mic button, timer and status text. Props: `recordingState`, `recordingTime`, `disabled`, `onMicClick`.
- **AudioPlaybackControls**: play/pause and seek bar for one blob. Props: `blob`, `disabled`, `durationMs`, `onAudioChange`.
- **AudioPlaybackProvider**: routes the playback `<audio>` through an AnalyserNode and shares it via context.
- **EqVisualizer**: canvas frequency bars. Props: `recordingAnalyser`, `barCount`, `height`, `barColor`, `disabled`, `frozen`.
- **TranscriptView**: chat-style final and interim transcript bubbles.
- **TranscriptionProvider** / **TranscriptionStatusIndicator**: provide the engine via context; show idle / connecting / listening.
- **CompatibilityShield**: warns when a required browser API is missing; children always render.

## Database API

### Session Management

```typescript
// Create a recording session
const sessionId = await createSession(title, engineType, mimeType);

// Retrieve all sessions (ordered by most recent)
const sessions = await getAllSessions();

// Get specific session
const session = await getSession(id);

// Update session duration
await updateSessionDuration(id, durationMs);

// Delete session and all associated data
await deleteSession(id);
```

### Audio Storage

```typescript
// Store the complete audio for a session (replaces any previous audio: one row per session)
const audioId = await storeAudioData(sessionId, blob);

// Retrieve audio for a session
const blob = await getSessionAudio(sessionId);
```

### Transcript Management

```typescript
// Store transcript segment
await storeTranscript(sessionId, text, timeMs, isFinal);

// Get all transcripts for a session, in spoken order
const transcripts = await getSessionTranscripts(sessionId);
```

### Utilities

```typescript
// Clear all data (single transaction)
await clearAllData();
```

## Audio Utilities API

### MIME Type Detection

```typescript
// Get supported audio format for current browser
const format = getSupportedAudioFormat();
// { mimeType: 'audio/webm;codecs=opus', codecs: ['opus'] }

// Check if specific type is supported
MediaRecorder.isTypeSupported('audio/webm;codecs=opus');
```

### Shared AudioContext

```typescript
// One AudioContext for the whole app (browsers cap how many can exist); resumed on each call
const context = getSharedAudioContext();
```

## Browser Support & Testing

### Desktop

- ✅ Chrome/Chromium 90+
- ✅ Firefox 88+ (with SpeechRecognition flag enabled)
- ✅ Safari 14+
- ✅ Edge 90+

### Mobile

- ✅ iOS Safari 14+
- ✅ Android Chrome

### Known Limitations

1. **Web Speech API**: No speaker identification (continues after voice stops)
2. **MIME Formats**: Limited to WebM and MP4 across browsers
3. **Language Support**: Depends on OS/browser speech engine
4. **Cloud Transcription**: Audio is sent to cloud services via the Web Speech API (Google/Apple). Stored transcripts remain local only.

## Deployment

### Cloudflare Pages

ReVoice builds to a static site compatible with Cloudflare Pages:

```bash
# Build production version
pnpm run build

# Deploy ./build directory to Cloudflare Pages
# (via CLI or GitHub Actions)
```

**Configuration**:

- Build command: `pnpm run build`
- Build output directory: `build`
- Root directory: `/`

### Other Static Hosts

The `build/` directory can be deployed to:

- Vercel
- Netlify
- GitHub Pages
- AWS S3 + CloudFront
- Any static file server

## Performance Targets (PoC)

- **Transcription Latency**: < 200ms (Chrome & Safari)
- **Visualizer FPS**: 60 FPS continuous
- **Build Size**: < 500KB (gzipped)
- **Cold Start**: < 2s (to first interactive)

## Contributing

### Adding a New Transcription Engine

1. Create `src/lib/engines/myengine.ts`:

```typescript
import { TranscriptionEngine } from './base';

export class MyEngine extends TranscriptionEngine {
	async start(stream: MediaStream, config?: EngineConfig): Promise<void> {
		// Initialize your service
	}

	async stop(): Promise<void> {
		// Cleanup
	}

	getMetadata() {
		return {
			name: 'My Service',
			version: '1.0.0',
			type: 'api',
		};
	}
}
```

2. Update `+page.svelte` to use the new engine:

```typescript
import { MyEngine } from '$lib/engines/myengine';
let engine = new MyEngine();
```

3. Components automatically adapt—no other changes needed!

## Development Tips

### Debugging Audio Issues

1. **Check MIME type support**:

   ```javascript
   console.log(getSupportedAudioFormat());
   ```

2. **Monitor transcription events**:

   ```javascript
   engine.onResult((result) => console.log('Transcription:', result));
   engine.onError((error) => console.error('Error:', error));
   ```

3. **Inspect IndexedDB**:
   - Open DevTools > Application > IndexedDB > ReVoiceDB
   - Browse sessions, audioData, transcripts stores

### Tailwind CSS Customization

Edit `tailwind.config.js` to customize colors, fonts, spacing:

```javascript
export default {
	theme: {
		extend: {
			colors: {
				'revoice-blue': '#3b82f6',
			},
		},
	},
};
```

### Live Reload

Development server supports hot module replacement—changes to `.svelte` files automatically refresh.

## Troubleshooting

### "Web Speech API not supported"

- Ensure browser is Chrome, Edge, or Safari
- Check browser privacy settings for microphone access
- Try a different browser

### "No audio captured"

- Verify microphone is working and permissions are granted
- Check DevTools Console for errors
- Try recording in another application first

### "Transcript empty"

- Wait 1-2 seconds for engine to process speech
- Speak clearly and at normal pace
- Check browser's speech recognition language settings

### Build fails

```bash
# Clear cache and reinstall
rm -r node_modules .svelte-kit
pnpm install
pnpm run build
```

## Future Roadmap

### Phase 2

- [ ] 3rd-party transcription engine adapters (Deepgram, AssemblyAI)
- [ ] Multiple language support with language selector
- [ ] Export transcripts to PDF/DOCX
- [ ] Real-time speaker diarization (who spoke when)
- [ ] Batch upload to cloud storage

### Phase 3

- [ ] Local ML model for on-device transcription (Transformers.js)
- [ ] Custom vocabulary/terms support
- [ ] Real-time translation
- [ ] Speaker identification
- [ ] Mobile app (React Native)

## License

MIT (See LICENSE file)

## Support

For issues, questions, or feature requests:

1. Check existing GitHub issues
2. Create a detailed bug report with:
   - Browser and OS version
   - Steps to reproduce
   - Console errors
   - Expected vs actual behavior

---

**Last Updated**: January 9, 2026  
**Status**: PoC (Production-Ready for Testing)

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
