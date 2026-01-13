<script lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';

	const slider = tv({
		slots: {
			root: 'relative flex w-full touch-none select-none items-center',
			track: 'relative h-2 w-full grow overflow-hidden rounded-full bg-secondary',
			range: 'absolute h-full bg-primary',
			// CRITICAL: Thumb MUST have 'absolute' positioning to work with the 'left' style calculation.
			// Without 'absolute', the thumb would flow inline and ignore the left/transform positioning.
			// The 'top-1/2 -translate-y-1/2' centers it vertically on the track.
			// Regression risk: If 'absolute' is removed, the thumb will appear stuck at the right side
			// and won't visually move even though the value updates internally.
			thumb:
				'absolute block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 top-1/2 -translate-y-1/2',
		},
		variants: {
			size: {
				default: {},
				sm: {
					track: 'h-1',
					thumb: 'h-4 w-4',
				},
			},
			disabled: {
				true: {
					root: 'opacity-50 cursor-not-allowed',
					thumb: 'cursor-not-allowed',
				},
			},
		},
		defaultVariants: {
			size: 'default',
		},
	});

	type Props = VariantProps<typeof slider> & {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		disabled?: boolean;
		onValueChange?: (value: number) => void;
		onValueCommit?: (value: number) => void;
		class?: string;
	};

	let {
		value = $bindable(0),
		min = 0,
		max = 100,
		step = 1,
		disabled = false,
		onValueChange,
		onValueCommit,
		size,
		class: className,
	}: Props = $props();

	const { root, track, range: rangeClass, thumb } = $derived(slider({ size, disabled }));

	let trackElement: HTMLDivElement | null = $state(null);
	let isDragging = $state(false);

	const percentage = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);

	function updateValue(clientX: number) {
		if (!trackElement || disabled) return;

		const rect = trackElement.getBoundingClientRect();
		const x = clientX - rect.left;
		const percent = Math.max(0, Math.min(1, x / rect.width));
		let newValue = min + percent * (max - min);

		// Apply step
		if (step) {
			newValue = Math.round(newValue / step) * step;
		}

		// Clamp to min/max
		newValue = Math.max(min, Math.min(max, newValue));

		console.log('[Slider] updateValue:', {
			clientX,
			trackRect: rect,
			x,
			percent,
			newValue,
			oldValue: value,
			max,
			min,
		});

		if (newValue !== value) {
			value = newValue;
			console.log('[Slider] Value updated:', newValue);
			onValueChange?.(newValue);
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (disabled) return;
		console.log('[Slider] pointerdown event:', { target: e.currentTarget, clientX: e.clientX });
		isDragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateValue(e.clientX);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging || disabled) return;
		console.log('[Slider] pointermove event:', { clientX: e.clientX, isDragging });
		updateValue(e.clientX);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDragging) return;
		console.log('[Slider] pointerup event');
		isDragging = false;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		onValueCommit?.(value);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (disabled) return;

		let newValue = value;
		const largeStep = (max - min) / 10;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowDown':
				e.preventDefault();
				newValue = Math.max(min, value - step);
				break;
			case 'ArrowRight':
			case 'ArrowUp':
				e.preventDefault();
				newValue = Math.min(max, value + step);
				break;
			case 'Home':
				e.preventDefault();
				newValue = min;
				break;
			case 'End':
				e.preventDefault();
				newValue = max;
				break;
			case 'PageDown':
				e.preventDefault();
				newValue = Math.max(min, value - largeStep);
				break;
			case 'PageUp':
				e.preventDefault();
				newValue = Math.min(max, value + largeStep);
				break;
		}

		if (newValue !== value) {
			value = newValue;
			onValueChange?.(newValue);
			onValueCommit?.(newValue);
		}
	}

	// Setup proper event delegation
	let thumbButton: HTMLButtonElement | null = $state(null);

	onMount(() => {
		// No need for document-level listeners - pointer capture handles it
		return () => {};
	});
</script>

<div class={root({ class: className })}>
	<div
		bind:this={trackElement}
		class={track()}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		role="presentation"
	>
		<div class={rangeClass()} style="width: {percentage}%"></div>
	</div>
	<!-- Thumb slider button with absolute positioning for visual drag handle -->
	<!-- The 'left' inline style positions this absolutely within the root container -->
	<button
		bind:this={thumbButton}
		type="button"
		class={thumb()}
		style="left: calc({percentage}% - 0.625rem)"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onkeydown={handleKeyDown}
		role="slider"
		aria-label="Seek slider"
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
		aria-disabled={disabled}
		tabindex={disabled ? -1 : 0}
		{disabled}
	></button>
</div>
