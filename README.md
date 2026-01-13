# ReVoice PoC - Voice Transcription Application

A proof-of-concept browser-based voice recording & transcription application leveraging native browser APIs for speed, portability, and privacy-first audio handling.

## Demo

🚀 **[Launch the live demo](https://revoice.magill.dev)**

## Overview

ReVoice is designed to demonstrate the capabilities of modern browser APIs for real-time voice recording and transcription. It avoids heavy local AI models in favor of the **Web Speech API** for fast transcription and **MediaRecorder API** for transparent audio persistence, all within the browser's security context.

### Key Features

- **Native Browser APIs**: Uses webkitSpeechRecognition for fast, low-latency transcription
- **Local-Only Data**: All audio and transcripts remain in the user's browser using IndexedDB
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
│   ├── components/          # Svelte UI components
│   │   ├── CompatibilityShield.svelte
│   │   ├── EqVisualizer.svelte
│   │   └── TranscriptionProvider.svelte
│   ├── engines/             # Transcription engine implementations
│   │   ├── base.ts          # Abstract base class
│   │   └── native.ts        # Web Speech API implementation
│   ├── audio.ts             # Audio utilities (MIME detection, cloning)
│   ├── compat.ts            # Browser compatibility checks
│   ├── db.ts                # Dexie.js database layer
│   └── types.ts             # TypeScript interfaces & types
├── routes/
│   ├── +layout.svelte       # Root layout with sidebar & dock
│   ├── +layout.js           # SPA configuration
│   └── +page.svelte         # Main recording dashboard
└── app.css                  # Global styles

build/                       # Static build output
specification.md            # Original product specification
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
	getState(): 'idle' | 'listening' | 'processing';
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

All data is stored locally in the browser's IndexedDB—no cloud uploads.

### Audio Capture & Processing

ReVoice handles audio capture through a dual-track system:

1. **MediaRecorder Track**: Captures audio for persistence
   - Auto-detects MIME type (WebM/Opus for Chrome, MP4 for Safari)
   - Stores binary blob in IndexedDB

2. **Web Audio Track**: Powers the frequency visualizer
   - Creates AnalyserNode for real-time frequency data
   - Drives the 32-bar EQ visualizer

**Stream Cloning**: Uses `stream.clone()` to feed both tracks from a single microphone input.

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

### CompatibilityShield

- **Purpose**: API support detection and user warning
- **Props**: `children` (slot content)
- **Behavior**: Shows modal if required APIs are missing
- **File**: `src/lib/components/CompatibilityShield.svelte`

### EqVisualizer

- **Purpose**: Canvas-based 32-bar frequency analyzer
- **Props**: `audioContext`, `analyser`, `barCount`, `height`, `barColor`
- **Behavior**: Real-time frequency visualization (updates at 60 FPS)
- **File**: `src/lib/components/EqVisualizer.svelte`

### TranscriptionProvider

- **Purpose**: Inject transcription engine via Svelte context
- **Props**: `engine` (ITranscriptionEngine), `children`
- **Usage**: Wrap page components to access engine
- **File**: `src/lib/components/TranscriptionProvider.svelte`

### +layout.svelte (Root Layout)

- **Purpose**: Main application shell
- **Sections**:
  - Sidebar with session history
  - Header with session title
  - Main content area
  - Persistent playback dock
- **Features**: Collapsible sidebar, audio playback, session deletion

### +page.svelte (Dashboard)

- **Purpose**: Recording interface and transcript display
- **Sections**:
  - Recording controls (Record/Pause/Stop)
  - Timer display
  - EQ Visualizer
  - Real-time transcript bubbles
- **Behavior**: Starts recording and engine on Record button click

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
// Store audio blob
const audioId = await storeAudioData(sessionId, blob);

// Retrieve audio for a session
const blob = await getSessionAudio(sessionId);
```

### Transcript Management

```typescript
// Store transcript segment
await storeTranscript(sessionId, text, timeMs, isFinal);

// Get all transcripts for a session
const transcripts = await getSessionTranscripts(sessionId);

// Get full transcript as string
const fullText = await getSessionFullTranscript(sessionId);
```

### Utilities

```typescript
// Get database statistics
const stats = await getDBStats();
// { sessionCount: 5, audioCount: 5, transcriptCount: 142 }

// Clear all data
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

### Stream Management

```typescript
// Clone a stream for multiple consumers
const cloned = cloneMediaStream(originalStream);

// Create MediaRecorder with auto-detected MIME
const recorder = createMediaRecorder(stream);

// Get file extension from MIME type
const ext = getAudioFileExtension('audio/webm'); // '.webm'
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
4. **Privacy**: Audio is NOT sent to cloud (only browser speech service)

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
