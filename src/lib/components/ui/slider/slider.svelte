<script lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';
	import type { Snippet } from 'svelte';

	const slider = tv({
		slots: {
			root: 'relative flex w-full touch-none select-none items-center',
			track: 'relative h-2 w-full grow overflow-hidden rounded-full bg-secondary',
			range: 'absolute h-full bg-primary',
			thumb:
				'block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
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

		if (newValue !== value) {
			value = newValue;
			onValueChange?.(newValue);
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (disabled) return;
		isDragging = true;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		updateValue(e.clientX);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!isDragging || disabled) return;
		updateValue(e.clientX);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
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
	<button
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
