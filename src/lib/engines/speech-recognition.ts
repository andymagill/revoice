/**
 * Minimal typings and constructor lookup for the Web Speech API.
 *
 * `lib.dom` does not ship SpeechRecognition typings, and Chromium/Safari expose the
 * constructor under a `webkit` prefix. Keeping the surface we actually use here (instead
 * of `any`) lets the compiler catch mistakes in NativeEngine while staying decoupled from
 * whichever typings a future TypeScript release adds.
 */

export interface SpeechRecognitionAlternativeLike {
	readonly transcript: string;
	readonly confidence: number;
}

export interface SpeechRecognitionResultLike {
	readonly length: number;
	readonly isFinal: boolean;
	readonly [index: number]: SpeechRecognitionAlternativeLike;
}

export interface SpeechRecognitionEventLike {
	/** First index in `results` that changed in this event. */
	readonly resultIndex: number;
	/** Cumulative results for the current recognition session. */
	readonly results: {
		readonly length: number;
		readonly [index: number]: SpeechRecognitionResultLike;
	};
}

export interface SpeechRecognitionErrorEventLike {
	readonly error: string;
	readonly message?: string;
}

export interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	onstart: (() => void) | null;
	onresult: ((event: SpeechRecognitionEventLike) => void) | null;
	onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
	onend: (() => void) | null;
	/**
	 * Audio lifecycle events. Optional because support varies; they show whether the
	 * recognizer actually receives audio, which is what mobile failures hinge on.
	 */
	onaudiostart?: (() => void) | null;
	onaudioend?: (() => void) | null;
	onsoundstart?: (() => void) | null;
	onsoundend?: (() => void) | null;
	onspeechstart?: (() => void) | null;
	onspeechend?: (() => void) | null;
	onnomatch?: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/**
 * Look up the browser's SpeechRecognition constructor.
 *
 * @returns The constructor, or `null` when the API is unavailable (Firefox, non-browser).
 */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as {
		webkitSpeechRecognition?: SpeechRecognitionConstructor;
		SpeechRecognition?: SpeechRecognitionConstructor;
	};
	return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}
