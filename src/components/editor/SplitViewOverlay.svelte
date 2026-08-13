<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { createFrameRenderer, type ComposedFrameRenderer } from '$lib/export';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import type { Track } from '$lib/editor/timeline';
	import { cn } from '$lib/utils';

	type Props = {
		tracks: Track[];
		mediaAssets: MediaAsset[];
		time: number;
		isPlaying?: boolean;
	};

	let { tracks, mediaAssets, time, isPlaying = false }: Props = $props();

	let root = $state<HTMLElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let renderer: ComposedFrameRenderer | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;
	let renderInFlight = false;
	let lastRenderedTime = -1;
	let splitX = $state(50);
	let dragging = $state(false);

	const RENDER_INTERVAL_PLAYING = 66;

	function cancelRenderTimer() {
		if (renderTimer !== null) {
			clearTimeout(renderTimer);
			renderTimer = null;
		}
	}

	function startDrag(event: PointerEvent) {
		if (!(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.setPointerCapture(event.pointerId);
		dragging = true;
		updateSplit(event);
	}

	function updateSplit(event: PointerEvent) {
		if (!root) return;
		const rect = root.getBoundingClientRect();
		if (rect.width <= 0) return;
		const percent = ((event.clientX - rect.left) / rect.width) * 100;
		splitX = Math.min(95, Math.max(5, percent));
	}

	function finishDrag(_event?: PointerEvent) {
		dragging = false;
	}

	async function renderAndDraw() {
		if (renderInFlight) return;
		if (!renderer || !canvas || !root) return;
		const clientWidth = root.clientWidth;
		const clientHeight = root.clientHeight;
		if (clientWidth <= 0 || clientHeight <= 0) return;
		const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		const drawingWidth = Math.round(clientWidth * pixelRatio);
		const drawingHeight = Math.round(clientHeight * pixelRatio);
		if (canvas.width !== drawingWidth) canvas.width = drawingWidth;
		if (canvas.height !== drawingHeight) canvas.height = drawingHeight;
		renderInFlight = true;
		try {
			await renderer.render(canvas, Math.max(0, time), { skipGrade: true });
			lastRenderedTime = time;
		} catch {
			// keep the last good frame on transient failures
		} finally {
			renderInFlight = false;
		}
	}

	function scheduleRender() {
		// read the reactive values first, unconditionally: svelte derives an
		// effect's dependencies from the reads on each run, so bailing out before
		// touching time/isPlaying would permanently unsubscribe the calling effect
		// and the panel would stop updating while it stays open
		const playhead = time;
		const playing = isPlaying;
		// a pending timer already covers the latest playhead position: the timer
		// callback reads the current time when it fires, so don't cancel and
		// restart it on every playhead tick (that would starve it during playback)
		if (renderTimer !== null || renderInFlight) return;
		if (lastRenderedTime === playhead) return;
		const delay = playing ? RENDER_INTERVAL_PLAYING : 0;
		renderTimer = setTimeout(async () => {
			renderTimer = null;
			await renderAndDraw();
			// reschedule unconditionally: scheduleRender no-ops when the canvas is
			// already current, but re-renders when playback advanced or a paused
			// render completed with a stale frame (e.g. pause during a seek)
			scheduleRender();
		}, delay);
	}

	$effect(() => {
		renderer?.dispose();
		renderer = createFrameRenderer(tracks, mediaAssets);
		// avoid re-running this effect on playhead movement via the reads inside
		// scheduleRender; the second effect handles time-driven re-renders
		untrack(() => scheduleRender());
	});

	$effect(() => {
		scheduleRender();
	});

	$effect(() => {
		if (!root || !canvas) return;
		const resizeObserver = new ResizeObserver(() => {
			renderAndDraw();
		});
		resizeObserver.observe(root);
		return () => resizeObserver.disconnect();
	});

	onDestroy(() => {
		cancelRenderTimer();
		renderer?.dispose();
		renderer = null;
	});
</script>

<div bind:this={root} class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
	<canvas
		bind:this={canvas}
		class="absolute inset-0 size-full"
		style="clip-path: inset(0 {100 - splitX}% 0 0)"
		aria-hidden="true"
	></canvas>

	<!-- labels -->
	<span
		class="absolute top-1.5 left-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white/90"
		style="opacity: {dragging ? 0.5 : 1}"
	>
		Before
	</span>
	<span
		class="absolute top-1.5 right-1.5 rounded-sm bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white/90"
	>
		After
	</span>

	<!-- divider -->
	<div
		class={cn(
			'pointer-events-auto absolute inset-y-0 z-10 -translate-x-1/2 cursor-ew-resize touch-none',
			dragging && 'cursor-grabbing'
		)}
		style="left: {splitX}%"
		role="separator"
		aria-label="Split view divider"
		aria-orientation="vertical"
		onpointerdown={startDrag}
		onpointermove={(event) => {
			if (dragging) updateSplit(event);
		}}
		onpointerup={finishDrag}
		onpointercancel={finishDrag}
	>
		<div class="h-full w-px bg-white/90"></div>
		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
			<div
				class="flex h-5 w-5 items-center justify-center rounded-sm border border-white/60 bg-black/70 text-white/90"
			>
				<div class="h-2 w-0.5 bg-white/70"></div>
			</div>
		</div>
	</div>
</div>
