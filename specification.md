# **Project Specification: ReVoice PoC**

**Experimental Native Browser Transcription & Audio Persistence**

## **1\. Executive Summary**

ReVoice is a proof-of-concept application built to test the limits of native browser APIs for voice-to-text. It avoids heavy local AI models in favor of the **Web Speech API** for speed and the **MediaRecorder API** for audio persistence. It is designed as a static application for deployment on Cloudflare Pages with a focus on cross-browser compatibility (Chrome & Safari) and modular engine architecture.

## **2\. Technical Stack**

* **Framework:** SvelteKit (configured as a Single Page App)  
* **Adapter:** @sveltejs/adapter-static (with fallback: 'index.html')  
* **Bundler:** Vite  
* **Styling:** Tailwind CSS 
* **Database:** IndexedDB via **Dexie.js**  
* **APIs:** \* webkitSpeechRecognition (Transcription)  
  * MediaRecorder (Audio Capture)  
  * Web Audio API (Visualizer & Safari Keep-Alive)

## **3\. Core Feature Requirements**

### **A. Modular Transcription Architecture**

* **Engine Interface:** Define a standard TypeScript interface (ITranscriptionEngine) with methods like start(), stop(), and onResult().  
* **Native Adapter:** The initial implementation using webkitSpeechRecognition.  
* **Future-Proofing:** Structure the code so that 3rd-party APIs (Deepgram, AssemblyAI) can be added as new classes implementing the same interface.

### **B. Audio Persistence**

* **Dual-track Recording:** Use MediaRecorder. Handle variable MIME types (WebM for Chrome, MP4 for Safari).  
* **IndexedDB Storage:** Store binary blobs and transcript segments indexed by session ID.  
* **Local-Only:** Data remains strictly in the user's browser.

### **C. User Interface**

* **Compatibility Shield:** A landing check for API support.  
* **Visualizer:** 32-bar frequency analyzer (Canvas-based).  
* **Message Bubbles:** iMessage-style bubbles for transcript segments.  
* **History Sidebar:** List past sessions with metadata.  
* **Global Player:** Persistent footer dock that handles multi-format playback.

## **4\. Database Schema (Dexie.js)**

db.version(1).stores({  
  sessions: '++id, timestamp, duration, title, mimeType, engineType',   
  audioData: '++id, sessionId, blob',  
  transcripts: '++id, sessionId, text, time'   
});

## **5\. Component Architecture**

1. \+layout.svelte: Contains the HistorySidebar and the persistent PlaybackDock.  
2. \+page.svelte: The recording dashboard and live EqVisualizer.  
3. TranscriptionProvider.svelte: A Svelte context provider that injects the chosen TranscriptionEngine into the component tree.Notes for Coding Assistant  
* **Safari "User Gesture" Rule:** In Safari, the AudioContext and SpeechRecognition **must** be started inside a direct click event handler. Do not try to initialize them on page load.  
* **MIME Type Detection:** Use MediaRecorder.isTypeSupported() to choose between audio/webm;codecs=opus (Chrome) and audio/mp4 (Safari).  
* **Audio Routing:** Use stream.clone() to feed the MediaRecorder and the AnalyserNode.  
* **SPA Mode:** Set export const ssr \= false; and export const prerender \= true; in the root \+layout.js.

## **7\. Success Metrics for PoC**

* Transcription latency \< 200ms on both macOS Chrome and iOS Safari.  
* Successful storage and retrieval of session blobs across browser restarts.  
* Audio visualizer responsiveness remains consistent across different engine implementations.