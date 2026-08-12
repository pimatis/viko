<script lang="ts">
	import { clampWheelHue } from '$lib/grading';

	let {
		hue = 0,
		onHueChange = () => {},
		disabled = false,
		label = 'Hue wheel',
		size = 36
	}: {
		hue?: number;
		onHueChange?: (hue: number) => void;
		disabled?: boolean;
		label?: string;
		size?: number;
	} = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let pointerId: number | null = null;
	let target: HTMLElement | null = null;

	function hueFromPointer(event: PointerEvent): number {
		const rect = canvas?.getBoundingClientRect();
		if (!rect) return 0;
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const angle = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI;
		return clampWheelHue(angle);
	}

	function startDrag(event: PointerEvent) {
		if (disabled || !(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		pointerId = event.pointerId;
		onHueChange(hueFromPointer(event));
	}

	function moveDrag(event: PointerEvent) {
		if (pointerId === null || event.pointerId !== pointerId) return;
		onHueChange(hueFromPointer(event));
	}

	function finishDrag(event?: PointerEvent) {
		if (event && event.pointerId !== pointerId) return;
		pointerId = null;
		if (target) {
			try {
				target.releasePointerCapture(event?.pointerId ?? 0);
			} catch {
				// capture may already be released
			}
			target = null;
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const step = event.shiftKey ? 15 : 5;
		onHueChange(clampWheelHue(hue + (event.key === 'ArrowRight' ? step : -step)));
	}

	function drawWheel() {
		const element = canvas;
		if (!element) return;
		const context = element.getContext('2d');
		if (!context) return;
		const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		const drawingSize = Math.round(size * pixelRatio);
		if (element.width !== drawingSize) element.width = drawingSize;
		if (element.height !== drawingSize) element.height = drawingSize;
		context.clearRect(0, 0, drawingSize, drawingSize);
		context.save();
		context.scale(pixelRatio, pixelRatio);

		const radius = size / 2 - 1;
		const gradient = context.createConicGradient(0, size / 2, size / 2);
		gradient.addColorStop(0, 'hsl(0 100% 55%)');
		gradient.addColorStop(0.167, 'hsl(60 100% 55%)');
		gradient.addColorStop(0.333, 'hsl(120 100% 55%)');
		gradient.addColorStop(0.5, 'hsl(180 100% 55%)');
		gradient.addColorStop(0.667, 'hsl(240 100% 55%)');
		gradient.addColorStop(0.833, 'hsl(300 100% 55%)');
		gradient.addColorStop(1, 'hsl(0 100% 55%)');

		context.lineWidth = 5;
		context.strokeStyle = gradient;
		context.beginPath();
		context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
		context.stroke();

		const angle = (hue * Math.PI) / 180;
		const pointerRadius = radius - 3;
		const pointerX = size / 2 + Math.cos(angle) * pointerRadius;
		const pointerY = size / 2 + Math.sin(angle) * pointerRadius;
		context.beginPath();
		context.arc(pointerX, pointerY, 2.5, 0, Math.PI * 2);
		context.fillStyle = 'rgba(255, 255, 255, 0.95)';
		context.fill();
		context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
		context.lineWidth = 1;
		context.stroke();

		context.beginPath();
		context.arc(size / 2, size / 2, 2.5, 0, Math.PI * 2);
		context.fillStyle = 'hsl(0 0% 50%)';
		context.fill();

		context.restore();
	}

	$effect(() => {
		drawWheel();
	});
</script>

<svelte:window
	onpointermove={moveDrag}
	onpointerup={(event) => finishDrag(event)}
	onpointercancel={(event) => finishDrag(event)}
/>

<canvas
	bind:this={canvas}
	style="width: {size}px; height: {size}px"
	class={disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer touch-none'}
	onpointerdown={startDrag}
	onkeydown={handleKeydown}
	role="slider"
	aria-label={label}
	aria-valuemin={-180}
	aria-valuemax={180}
	aria-valuenow={hue}
	aria-disabled={disabled}
	tabindex={disabled ? -1 : 0}
></canvas>
