<script lang="ts">
	import { getAudioPlayback } from '$lib/context';

	/**
	 * Canvas frequency-bar visualizer.
	 *
	 * Draws one bar per frequency bin from an AnalyserNode. Which analyser is used:
	 * the playback analyser from an enclosing AudioPlaybackProvider wins (green bars);
	 * otherwise the `recordingAnalyser` prop (red bars).
	 *
	 * Modes:
	 * - live (default): redraws every animation frame
	 * - `frozen`: draws the last live frame once, in the paused colour, with no loop
	 * - `disabled`: flat grey baseline bars, no loop
	 */
	interface Props {
		/** Analyser for microphone input during recording. */
		recordingAnalyser?: AnalyserNode;
		/** Number of bars; also fixes the FFT size (`barCount * 2`, rounded up to a power of 2). */
		barCount?: number;
		/** Canvas height in CSS pixels. */
		height?: number;
		/** Override the automatic bar colour. */
		barColor?: string;
		disabledBarColor?: string;
		pausedBarColor?: string;
		disabled?: boolean;
		frozen?: boolean;
	}

	let {
		recordingAnalyser,
		barCount = 32,
		height = 200,
		barColor,
		disabledBarColor = '#d1d5db',
		pausedBarColor = '#f59e0b',
		disabled = false,
		frozen = false,
	}: Props = $props();

	/** Gap between bars in CSS pixels. */
	const BAR_GAP = 2;

	// Must run during component initialisation (context rule); null outside a provider.
	const audioPlayback = getAudioPlayback();

	const activeAnalyser = $derived(audioPlayback?.analyser ?? recordingAnalyser ?? null);
	const liveColor = $derived(barColor ?? (audioPlayback?.analyser ? '#10b981' : '#ef4444'));

	/** Power-of-two FFT size giving at least `barCount` bins. */
	const fftSize = $derived(2 ** Math.ceil(Math.log2(barCount * 2)));

	let canvas = $state<HTMLCanvasElement>();
	let width = $state(0);

	/**
	 * Most recent frequency data. Doubles as the analyser's read buffer, so freezing just
	 * means "stop updating it and draw it once".
	 */
	let frame = new Uint8Array(0);

	// One effect owns the whole drawing lifecycle. It re-runs when the canvas size,
	// analyser, mode, colours or bar layout change; each run starts by cancelling the
	// previous loop, so there is never more than one loop running.
	$effect(() => {
		const element = canvas;
		if (!element || width === 0) return;
		const ctx = element.getContext('2d');
		if (!ctx) return;

		const analyserNode = activeAnalyser;
		const isDisabled = disabled;
		const isFrozen = frozen;
		const color = isDisabled ? disabledBarColor : isFrozen ? pausedBarColor : liveColor;

		// Size the backing store for the device pixel ratio (sharp on retina screens).
		const ratio = window.devicePixelRatio || 1;
		element.width = width * ratio;
		element.height = height * ratio;
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

		// Without this the analyser keeps its default 2048-point FFT and the first
		// `barCount` bins would only cover the lowest few hundred Hz.
		if (analyserNode) analyserNode.fftSize = fftSize;

		const bins = fftSize / 2;
		if (frame.length !== bins) frame = new Uint8Array(bins);
		if (!analyserNode) frame.fill(0);

		const render = () => {
			ctx.fillStyle = 'rgb(255, 255, 255)';
			ctx.fillRect(0, 0, width, height);

			ctx.fillStyle = color;
			const slot = width / barCount;
			for (let i = 0; i < barCount; i++) {
				const magnitude = frame[Math.floor((i / barCount) * bins)];
				const barHeight = isDisabled ? height * 0.3 : (magnitude / 255) * height;
				ctx.fillRect(i * slot, height - barHeight, slot - BAR_GAP, barHeight);
			}
		};

		if (!analyserNode || isDisabled || isFrozen) {
			render();
			return;
		}

		let handle = 0;
		const tick = () => {
			analyserNode.getByteFrequencyData(frame);
			render();
			handle = requestAnimationFrame(tick);
		};
		tick();

		return () => cancelAnimationFrame(handle);
	});
</script>

<canvas
	bind:this={canvas}
	bind:clientWidth={width}
	class="w-full bg-white rounded border border-gray-200"
	style="height: {height}px"
></canvas>
