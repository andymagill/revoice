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

		/** Bar color as CSS value (default: auto-selected based on mode) */
		barColor?: string;

		/** Color for disabled/idle state bars (default: "#d1d5db" gray) */
		disabledBarColor?: string;

		/** Color for paused state (default: "#f59e0b" amber) */
		pausedBarColor?: string;

		/** Whether the visualizer is in disabled state (gray bars, no animation) */
		disabled?: boolean;

		/** Whether to freeze the current visualization (preserves last frame when paused) */
		frozen?: boolean;

		/** Visualization mode: 'recording' (red) or 'playback' (green) */
		mode?: 'recording' | 'playback';
	}

	let {
		audioContext,
		analyser,
		barCount = 32,
		height = 200,
		barColor,
		disabledBarColor = '#d1d5db',
		pausedBarColor = '#f59e0b',
		disabled = false,
		frozen = false,
		mode = 'recording',
	}: Props = $props();

	// Auto-select bar color based on mode if not explicitly provided
	const defaultBarColor = $derived(barColor ?? (mode === 'recording' ? '#ef4444' : '#10b981'));

	/** Canvas DOM reference */
	let canvas: HTMLCanvasElement | undefined;

	/** RAF animation frame ID for cleanup */
	let animationId: number = 0;

	/** Frequency bin data array (0-255 for each bin) */
	let dataArray: Uint8Array | null = null;

	/** Frozen snapshot of frequency data (preserved when paused) */
	let frozenData: Uint8Array | null = null;

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
		dataArray = new Uint8Array(bufferLength) as Uint8Array;

		// Scale canvas for high-DPI displays
		canvas.width = canvas.offsetWidth * window.devicePixelRatio;
		canvas.height = height * window.devicePixelRatio;
		ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

		/**
		 * Animation loop: updates at 60 FPS (or display refresh rate)
		 *
		 * Steps per frame:
		 * 1. Schedule next frame via requestAnimationFrame
		 * 2. Get frequency data from analyser (or use frozen/disabled state)
		 * 3. Clear canvas background
		 * 4. Draw frequency bars with appropriate colors
		 */
		const draw = () => {
			if (!ctx || !dataArray) return;

			// Schedule next frame (skip if frozen to save CPU)
			if (!frozen) {
				animationId = requestAnimationFrame(draw);
			}

			// Extract frequency bin data based on state
			if (analyser && !disabled && !frozen) {
				// Active: get live frequency data
				analyser.getByteFrequencyData(dataArray);
			} else if (frozen && frozenData) {
				// Frozen: use preserved snapshot
				dataArray.set(frozenData);
			} else if (disabled) {
				// Disabled: fill with zeros (will render as flat gray bars)
				dataArray.fill(0);
			}

			// Clear canvas with white background
			ctx.fillStyle = 'rgb(255, 255, 255)';
			ctx.fillRect(0, 0, canvas!.width / window.devicePixelRatio, height);

			// Draw frequency bars
			const barWidth = canvas!.width / window.devicePixelRatio / barCount;
			const barGap = 2; // Pixel spacing between bars
			let x = 0;

			// Choose bar color based on state
			let currentBarColor: string;
			if (disabled) {
				currentBarColor = disabledBarColor;
			} else if (frozen) {
				currentBarColor = pausedBarColor;
			} else {
				currentBarColor = defaultBarColor;
			}

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

	// Handle frozen state transitions
	$effect(() => {
		if (frozen && dataArray && !frozenData) {
			// Transitioning to frozen: capture snapshot
			frozenData = new Uint8Array(dataArray) as Uint8Array;
		} else if (!frozen && frozenData) {
			// Transitioning from frozen: clear snapshot and restart animation
			frozenData = null;
			if (canvas && !disabled) {
				const ctx = canvas.getContext('2d');
				if (ctx && dataArray) {
					animationId = requestAnimationFrame(function draw() {
						if (!ctx || !dataArray) return;

						if (!frozen) {
							animationId = requestAnimationFrame(draw);
						}

						if (analyser && !disabled && !frozen) {
							analyser.getByteFrequencyData(dataArray);
						} else if (frozen && frozenData) {
							dataArray.set(frozenData);
						} else if (disabled) {
							dataArray.fill(0);
						}

						ctx.fillStyle = 'rgb(255, 255, 255)';
						ctx.fillRect(0, 0, canvas!.width / window.devicePixelRatio, height);

						const barWidth = canvas!.width / window.devicePixelRatio / barCount;
						const barGap = 2;
						let x = 0;

						let currentBarColor: string;
						if (disabled) {
							currentBarColor = disabledBarColor;
						} else if (frozen) {
							currentBarColor = pausedBarColor;
						} else {
							currentBarColor = defaultBarColor;
						}

						const disabledBarHeight = disabled ? height * 0.3 : 0;

						for (let i = 0; i < barCount; i++) {
							const index = Math.floor((i / barCount) * dataArray.length);
							const magnitude = disabled ? disabledBarHeight : dataArray[index];
							const barHeight = disabled ? disabledBarHeight : (magnitude / 255) * height;

							ctx.fillStyle = currentBarColor;
							ctx.fillRect(x, height - barHeight, barWidth - barGap, barHeight);

							x += barWidth;
						}
					});
				}
			}
		}
	});
</script>

<canvas
	bind:this={canvas}
	class="w-full bg-white rounded border border-gray-200"
	style="height: {height}px"
></canvas>
