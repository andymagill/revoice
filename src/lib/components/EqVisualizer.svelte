<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * EqVisualizer Component
	 *
	 * Real-time frequency spectrum visualizer rendered on HTML5 Canvas.
	 * Displays audio frequency data as vertical bars similar to equalizer visualizations.
	 *
	 * Purpose: Provide visual feedback of microphone input during recording.
	 *
	 * How It Works:
	 * 1. Receives AnalyserNode from Web Audio API
	 * 2. Extracts frequency bin data at 60 FPS via requestAnimationFrame
	 * 3. Maps frequency bins to 32 bars (configurable)
	 * 4. Renders bars with dynamic heights based on frequency magnitude
	 *
	 * Features:
	 * - 32-bar frequency spectrum display (configurable)
	 * - Smooth real-time updates at display refresh rate (60 FPS)
	 * - High-DPI display support
	 * - Configurable bar color
	 * - Responsive width (fits container)
	 *
	 * Technical Details:
	 *
	 * FFT Size: Must be power of 2 for AnalyserNode
	 * Frequency Mapping: Each bar samples different frequency range
	 * Performance: Frame time typically < 5ms on modern hardware
	 *
	 * Browser Support: Chrome/Edge 25+, Safari 13+, Firefox 25+, Opera 15+
	 */

	interface Props {
		/** AudioContext instance (optional, for compatibility) */
		audioContext?: AudioContext;

		/** REQUIRED: AnalyserNode with connected audio stream */
		analyser?: AnalyserNode;

		/** Number of frequency bars (default: 32) */
		barCount?: number;

		/** Canvas height in pixels (default: 200) */
		height?: number;

		/** Bar color as CSS value (default: "#3b82f6") */
		barColor?: string;

		/** Color for disabled/idle state bars (default: "#d1d5db" gray) */
		disabledBarColor?: string;

		/** Whether the visualizer is in disabled state (gray bars, no animation) */
		disabled?: boolean;
	}

	let {
		audioContext,
		analyser,
		barCount = 32,
		height = 200,
		barColor = '#3b82f6',
		disabledBarColor = '#d1d5db',
		disabled = false,
	}: Props = $props();

	/** Canvas DOM reference */
	let canvas: HTMLCanvasElement | undefined;

	/** RAF animation frame ID for cleanup */
	let animationId: number = 0;

	/** Frequency bin data array (0-255 for each bin) */
	let dataArray: Uint8Array | null = null;

	/**
	 * Initialize canvas, analyser, and start animation loop
	 *
	 * Steps:
	 * 1. Get canvas 2D context
	 * 2. Configure analyser FFT size based on barCount
	 * 3. Allocate frequency data array
	 * 4. Scale canvas for device DPI (retina displays)
	 * 5. Start requestAnimationFrame loop
	 * 6. Return cleanup function to cancel animation
	 */
	onMount(() => {
		if (!canvas) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Configure analyser FFT: must be power of 2
		// 32 bars -> Math.pow(2, ceil(log2(64))) = 64
		const fftSize = Math.pow(2, Math.ceil(Math.log2(barCount * 2)));
		const bufferLength = fftSize / 2;

		// If analyser is provided, configure it
		if (analyser) {
			analyser.fftSize = fftSize;
		}

		// Pre-allocate frequency data array (reused every frame)
		dataArray = new Uint8Array(bufferLength);

		// Scale canvas for high-DPI displays
		canvas.width = canvas.offsetWidth * window.devicePixelRatio;
		canvas.height = height * window.devicePixelRatio;
		ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

		/**
		 * Animation loop: updates at 60 FPS (or display refresh rate)
		 *
		 * Steps per frame:
		 * 1. Schedule next frame via requestAnimationFrame
		 * 2. Get frequency data from analyser (or use zeros for disabled state)
		 * 3. Clear canvas background
		 * 4. Draw frequency bars
		 */
		const draw = () => {
			if (!ctx || !dataArray) return;

			// Schedule next frame
			animationId = requestAnimationFrame(draw);

			// Extract frequency bin data from analyser, or use disabled state
			if (analyser && !disabled) {
				analyser.getByteFrequencyData(dataArray);
			} else {
				// Disabled state: fill with zeros (will render as flat gray bars)
				dataArray.fill(0);
			}

			// Clear canvas with white background
			ctx.fillStyle = 'rgb(255, 255, 255)';
			ctx.fillRect(0, 0, canvas!.width / window.devicePixelRatio, height);

			// Draw frequency bars
			const barWidth = canvas!.width / window.devicePixelRatio / barCount;
			const barGap = 2; // Pixel spacing between bars
			let x = 0;

			// Choose bar color based on disabled state
			const currentBarColor = disabled ? disabledBarColor : barColor;

			// For disabled state, render bars at a baseline height (30% of max)
			const disabledBarHeight = disabled ? height * 0.3 : 0;

			// Render each bar based on frequency magnitude
			for (let i = 0; i < barCount; i++) {
				// Sample appropriate frequency bin for this bar
				const index = Math.floor((i / barCount) * dataArray.length);

				// Convert frequency magnitude (0-255) to bar height
				// In disabled state, use fixed baseline height instead
				const magnitude = disabled ? disabledBarHeight : dataArray[index];
				const barHeight = disabled ? disabledBarHeight : (magnitude / 255) * height;

				// Render bar: vertical rectangle from bottom of canvas up
				ctx.fillStyle = currentBarColor;
				ctx.fillRect(x, height - barHeight, barWidth - barGap, barHeight);

				x += barWidth;
			}
		};

		// Start animation loop
		draw();

		// Cleanup function: cancel animation when component unmounts
		return () => {
			if (animationId) {
				cancelAnimationFrame(animationId);
			}
		};
	});
</script>

<canvas
	bind:this={canvas}
	class="w-full bg-white rounded border border-gray-200"
	style="height: {height}px"
></canvas>
