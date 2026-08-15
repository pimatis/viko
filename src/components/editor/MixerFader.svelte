<script lang="ts">
	// Vertical volume fader for the Audio Mixer panel. Pointer-driven with full
	// keyboard support; bottom of the track = min, top = max. Uses the
	// controlled pattern (value prop + oninput callback) so the parent owns the
	// authoritative value.
	let {
		value = 0,
		min = 0,
		max = 1,
		step = 0.01,
		oninput = () => {},
		ariaLabel = 'fader'
	}: Props = $props();

	type Props = {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		oninput?: (value: number) => void;
		ariaLabel?: string;
	};

	let trackEl = $state<HTMLDivElement | null>(null);
	let dragging = false;
	let pointerId: number | null = null;

	function valueToPercent(v: number): number {
		const span = max - min;
		if (span <= 0) return 0;
		return Math.max(0, Math.min(100, ((v - min) / span) * 100));
	}

	function clampStep(v: number): number {
		const raw = Math.round(v / step) * step;
		return Math.min(max, Math.max(min, Number(raw.toFixed(4))));
	}

	function updateFromClientY(clientY: number): void {
		const el = trackEl;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const ratio = 1 - (clientY - rect.top) / rect.height;
		oninput(clampStep(min + ratio * (max - min)));
	}

	function handlePointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		e.preventDefault();
		dragging = true;
		pointerId = e.pointerId;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// synthetic pointers may not support capture
		}
		updateFromClientY(e.clientY);
	}

	function handlePointerMove(e: PointerEvent): void {
		if (!dragging || e.pointerId !== pointerId) return;
		updateFromClientY(e.clientY);
	}

	function endDrag(e: PointerEvent): void {
		if (e.pointerId !== pointerId) return;
		dragging = false;
		pointerId = null;
	}

	function handleKeyDown(e: KeyboardEvent): void {
		let delta: number;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') delta = step;
		else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') delta = -step;
		else if (e.key === 'Home') {
			e.preventDefault();
			oninput(max);
			return;
		} else if (e.key === 'End') {
			e.preventDefault();
			oninput(min);
			return;
		} else return;
		e.preventDefault();
		oninput(clampStep(value + delta));
	}
</script>

<div
	class="relative h-20 w-5 cursor-ns-resize touch-none rounded-sm bg-secondary/70"
	role="slider"
	tabindex="0"
	aria-label={ariaLabel}
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	bind:this={trackEl}
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onkeydown={handleKeyDown}
>
	<div
		class="absolute right-0.5 bottom-0.5 left-0.5 rounded-[3px] bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500/90"
		style="height: {Math.max(2, valueToPercent(value))}%"
	></div>
	<div
		class="absolute left-1/2 h-3 w-4 -translate-x-1/2 rounded-[3px] border border-border bg-foreground shadow-sm"
		style="top: calc({100 - valueToPercent(value)}% - 6px)"
	></div>
</div>
