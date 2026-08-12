<script lang="ts">
	import { MAX_CURVE_POINTS, type ColorCurvePoint } from '$lib/grading';
	import { cn } from '$lib/utils';

	let {
		points = [],
		onPointsChange = () => {},
		color = '#ffffff',
		disabled = false,
		label = 'Curve editor'
	}: {
		points?: ColorCurvePoint[];
		onPointsChange?: (points: ColorCurvePoint[]) => void;
		color?: string;
		disabled?: boolean;
		label?: string;
	} = $props();

	let surface = $state<HTMLElement | null>(null);
	let activeIndex = $state<number | null>(null);
	let pointerId: number | null = null;
	let target: Element | null = null;

	const GRID_LINES = [0, 25, 50, 75, 100];

	const pathData = $derived(
		points
			.map(
				(point, index) =>
					`${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${(100 - point.y * 100).toFixed(2)}`
			)
			.join(' ')
	);

	function toCurvePoint(event: PointerEvent): ColorCurvePoint {
		const rect = surface?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 1 };
		const x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
		const y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
		return { x: x / 100, y: 1 - y / 100 };
	}

	function neighborBounds(index: number): { minX: number; maxX: number } {
		const previous = points[index - 1];
		const next = points[index + 1];
		return {
			minX: (previous ? previous.x : -Infinity) + 0.01,
			maxX: (next ? next.x : Infinity) - 0.01
		};
	}

	function updateActivePoint(event: PointerEvent) {
		if (activeIndex === null || pointerId === null || event.pointerId !== pointerId) return;
		const point = toCurvePoint(event);
		const bounds = neighborBounds(activeIndex);
		const nextPoints = points.map((candidate, index) => {
			if (index !== activeIndex) return candidate;
			return {
				x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
				y: Math.round(point.y * 1000) / 1000
			};
		});
		onPointsChange(nextPoints);
	}

	function startPointDrag(event: PointerEvent, index: number) {
		if (disabled || !(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		pointerId = event.pointerId;
		activeIndex = index;
	}

	function addPointAt(event: PointerEvent) {
		if (disabled || !(event.currentTarget instanceof Element)) return;
		if (points.length >= MAX_CURVE_POINTS) return;
		const point = toCurvePoint(event);
		const sorted = [...points, point].sort((left, right) => left.x - right.x);
		const index = sorted.findIndex(
			(candidate) => candidate.x === point.x && candidate.y === point.y
		);
		if (index < 0) return;
		if (index > 0 && sorted[index - 1].x + 0.012 > point.x) return;
		if (index < sorted.length - 1 && sorted[index + 1].x - 0.012 < point.x) return;
		onPointsChange(sorted);
		event.stopPropagation();
		target = event.currentTarget;
		target.setPointerCapture(event.pointerId);
		pointerId = event.pointerId;
		activeIndex = index;
	}

	function finishDrag(event?: PointerEvent) {
		if (event && event.pointerId !== pointerId) return;
		activeIndex = null;
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

	function removePoint(index: number) {
		if (points.length <= 2) return;
		onPointsChange(points.filter((_, candidateIndex) => candidateIndex !== index));
	}

	function handlePointKeydown(event: KeyboardEvent, index: number) {
		if (event.key !== 'Delete' && event.key !== 'Backspace') return;
		event.preventDefault();
		removePoint(index);
	}
</script>

<svelte:window
	onpointermove={updateActivePoint}
	onpointerup={(event) => finishDrag(event)}
	onpointercancel={(event) => finishDrag(event)}
/>

<div
	bind:this={surface}
	class={cn('relative h-24 w-full overflow-hidden rounded-md border', disabled && 'opacity-50')}
	role="application"
	aria-label={label}
>
	<svg
		viewBox="0 0 100 100"
		preserveAspectRatio="none"
		role="img"
		aria-label={`${label} surface`}
		class={cn('absolute inset-0 size-full touch-none', !disabled && 'cursor-crosshair')}
		onpointerdown={addPointAt}
		oncontextmenu={(event) => event.preventDefault()}
	>
		<rect class="fill-secondary/50" width="100" height="100" />
		{#each GRID_LINES as line (line)}
			<line
				x1={line}
				y1="0"
				x2={line}
				y2="100"
				class="stroke-border/60"
				stroke-width="0.5"
				vector-effect="non-scaling-stroke"
			/>
			<line
				x1="0"
				y1={line}
				x2="100"
				y2={line}
				class="stroke-border/60"
				stroke-width="0.5"
				vector-effect="non-scaling-stroke"
			/>
		{/each}
		<line
			x1="0"
			y1="100"
			x2="100"
			y2="0"
			class="stroke-border"
			stroke-width="0.75"
			stroke-dasharray="2 2"
			vector-effect="non-scaling-stroke"
		/>
		<path
			d={pathData}
			fill="none"
			stroke={color}
			stroke-width="1.5"
			vector-effect="non-scaling-stroke"
		/>
	</svg>

	{#each points as point, index (index)}
		<button
			type="button"
			class={cn(
				'absolute z-10 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border transition-transform active:cursor-grabbing',
				activeIndex === index ? 'scale-125' : 'hover:scale-110'
			)}
			style="left: {point.x * 100}%; top: {(1 - point.y) *
				100}%; width: 11px; height: 11px; border-color: {color}; background-color: var(--color-background)"
			onpointerdown={(event) => startPointDrag(event, index)}
			ondblclick={() => removePoint(index)}
			onkeydown={(event) => handlePointKeydown(event, index)}
			aria-label={`Curve point ${index + 1} at ${Math.round(point.x * 100)}%`}
			tabindex={disabled ? -1 : 0}
		>
			<span class="block size-full rounded-full" style="background-color: {color}"></span>
		</button>
	{/each}
</div>
