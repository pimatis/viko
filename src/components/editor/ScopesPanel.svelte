<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { createFrameRenderer, type ComposedFrameRenderer } from '$lib/export';
	import { analyzeFrame, type ScopeAnalysis } from '$lib/grading/scopes';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import type { Track } from '$lib/editor/timeline';
	import { sound } from '$lib/sound';
	import { Check, ChevronDown, GripVertical, X } from '@lucide/svelte';

	type Props = {
		tracks: Track[];
		mediaAssets: MediaAsset[];
		time: number;
		isPlaying?: boolean;
		aspectRatio?: { width: number; height: number };
		onClose?: () => void;
	};

	let {
		tracks,
		mediaAssets,
		time,
		isPlaying = false,
		aspectRatio = { width: 16, height: 9 },
		onClose = () => {}
	}: Props = $props();

	type ScopeTab = 'waveform' | 'vectorscope' | 'histogram' | 'parade';

	let activeScope = $state<ScopeTab>('waveform');
	let analysisCanvas = $state<HTMLCanvasElement | null>(null);
	let scopeCanvas = $state<HTMLCanvasElement | null>(null);
	let root = $state<HTMLElement | null>(null);
	let panelX = $state(0);
	let panelY = $state(0);
	let renderer: ComposedFrameRenderer | null = null;
	let analysis: ScopeAnalysis | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;
	let renderInFlight = false;
	let lastRenderedTime = -1;
	let scopeContext: CanvasRenderingContext2D | null = null;

	// non-reactive drag state, applied via pointermove on the window
	let dragPointerId: number | null = null;
	let dragOffsetX = 0;
	let dragOffsetY = 0;

	const ANALYSIS_WIDTH = 320;
	const RENDER_INTERVAL_PLAYING = 110;
	const POSITION_STORAGE_KEY = 'viko-scopes-panel-position';

	const scopeTabs: { id: ScopeTab; label: string }[] = [
		{ id: 'waveform', label: 'Waveform' },
		{ id: 'vectorscope', label: 'Vectorscope' },
		{ id: 'histogram', label: 'Histogram' },
		{ id: 'parade', label: 'Parade' }
	];

	const activeScopeLabel = $derived(
		scopeTabs.find((tab) => tab.id === activeScope)?.label ?? 'Waveform'
	);

	function cancelRenderTimer() {
		if (renderTimer !== null) {
			clearTimeout(renderTimer);
			renderTimer = null;
		}
	}

	// ----- dragging -----

	function startDrag(event: PointerEvent) {
		if (dragPointerId !== null || !root || !(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = root.getBoundingClientRect();
		dragOffsetX = event.clientX - rect.left;
		dragOffsetY = event.clientY - rect.top;
		event.currentTarget.setPointerCapture(event.pointerId);
		dragPointerId = event.pointerId;
	}

	function moveDrag(event: PointerEvent) {
		if (dragPointerId === null || event.pointerId !== dragPointerId || !root) return;
		const parent = root.parentElement;
		if (!parent) return;
		const parentRect = parent.getBoundingClientRect();
		const nextLeft = event.clientX - parentRect.left - dragOffsetX;
		const nextTop = event.clientY - parentRect.top - dragOffsetY;
		panelX = Math.min(Math.max(0, nextLeft), Math.max(0, parentRect.width - root.offsetWidth));
		panelY = Math.min(Math.max(0, nextTop), Math.max(0, parentRect.height - root.offsetHeight));
	}

	function finishDrag(event?: PointerEvent) {
		if (event && dragPointerId !== null && event.pointerId !== dragPointerId) return;
		dragPointerId = null;
		storePosition();
	}

	function readStoredPosition(): { x: number; y: number } | null {
		try {
			const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
			if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
			if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
			return { x: parsed.x, y: parsed.y };
		} catch {
			return null;
		}
	}

	function storePosition() {
		try {
			window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({ x: panelX, y: panelY }));
		} catch {
			// storage may be unavailable; the position simply won't persist
		}
	}

	function clampToParent(x: number, y: number): { x: number; y: number } {
		if (!root?.parentElement) return { x, y };
		const parent = root.parentElement;
		return {
			x: Math.min(Math.max(0, x), Math.max(0, parent.clientWidth - root.offsetWidth)),
			y: Math.min(Math.max(0, y), Math.max(0, parent.clientHeight - root.offsetHeight))
		};
	}

	// ----- scope drawing -----

	function drawScope() {
		const canvas = scopeCanvas;
		if (!canvas || !analysis) return;
		if (!scopeContext) return;
		const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		const clientWidth = canvas.clientWidth;
		const clientHeight = canvas.clientHeight;
		if (clientWidth <= 0 || clientHeight <= 0) return;
		const drawingWidth = Math.round(clientWidth * pixelRatio);
		const drawingHeight = Math.round(clientHeight * pixelRatio);
		if (canvas.width !== drawingWidth) canvas.width = drawingWidth;
		if (canvas.height !== drawingHeight) canvas.height = drawingHeight;
		const ctx = scopeContext;
		ctx.save();
		ctx.scale(pixelRatio, pixelRatio);
		ctx.clearRect(0, 0, clientWidth, clientHeight);

		if (activeScope === 'waveform') drawWaveform(ctx, clientWidth, clientHeight);
		if (activeScope === 'vectorscope') drawVectorscope(ctx, clientWidth, clientHeight);
		if (activeScope === 'histogram') drawHistogram(ctx, clientWidth, clientHeight);
		if (activeScope === 'parade') drawParade(ctx, clientWidth, clientHeight);

		ctx.restore();
	}

	function drawWaveform(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const { waveform } = analysis!;
		drawGrid(ctx, width, height, 5);
		const padding = 4;
		const innerWidth = width - padding * 2;
		const innerHeight = height - padding * 2;
		for (let column = 0; column < waveform.columns; column += 1) {
			const x = padding + (column / Math.max(1, waveform.columns - 1)) * innerWidth;
			const minY = padding + (1 - waveform.min[column]) * innerHeight;
			const maxY = padding + (1 - waveform.max[column]) * innerHeight;
			ctx.fillStyle = 'rgba(74, 222, 128, 0.65)';
			ctx.fillRect(x, maxY, 1, Math.max(1, minY - maxY));
			const averageY = padding + (1 - waveform.average[column]) * innerHeight;
			ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
			ctx.fillRect(x, averageY, 1, 1);
		}
		drawScaleLabels(ctx, width, height, padding, 5);
	}

	function drawParade(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const { parade } = analysis!;
		const panelWidth = (width - 8) / 3;
		const channels: {
			key: 'red' | 'green' | 'blue';
			color: string;
		}[] = [
			{ key: 'red', color: 'rgba(248, 113, 113, 0.75)' },
			{ key: 'green', color: 'rgba(74, 222, 128, 0.75)' },
			{ key: 'blue', color: 'rgba(96, 165, 250, 0.75)' }
		];
		const padding = 4;
		const innerHeight = height - padding * 2;
		for (let index = 0; index < channels.length; index += 1) {
			const channel = channels[index];
			const data = parade[channel.key];
			const left = index * (panelWidth + 4);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
			ctx.strokeRect(left + 0.5, 0.5, panelWidth - 1, height - 1);
			for (let column = 0; column < data.max.length; column += 1) {
				const x = left + 2 + (column / Math.max(1, data.max.length - 1)) * (panelWidth - 4);
				const minY = padding + (1 - data.min[column]) * innerHeight;
				const maxY = padding + (1 - data.max[column]) * innerHeight;
				ctx.fillStyle = channel.color;
				ctx.fillRect(x, maxY, 1, Math.max(1, minY - maxY));
			}
		}
	}

	function drawGrid(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		divisions: number
	) {
		ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
		ctx.fillRect(0, 0, width, height);
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.lineWidth = 1;
		for (let index = 1; index < divisions; index += 1) {
			const x = (width / divisions) * index;
			const y = (height / divisions) * index;
			ctx.beginPath();
			ctx.moveTo(x, 0);
			ctx.lineTo(x, height);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}
	}

	function drawScaleLabels(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
		padding: number,
		divisions: number
	) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
		ctx.font = '9px ui-monospace, monospace';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		for (let index = 0; index <= divisions; index += 1) {
			const percent = (index / divisions) * 100;
			const x = percent >= 99 ? 2 : padding + (percent / 100) * (width - padding * 2);
			const y = height - padding * 2 + 1;
			ctx.fillText(String(percent), x, y);
		}
	}

	function drawHistogram(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const { histogram } = analysis!;
		drawGrid(ctx, width, height, 4);
		const channels: { key: 'red' | 'green' | 'blue' | 'luma'; color: string }[] = [
			{ key: 'luma', color: 'rgba(255, 255, 255, 0.85)' },
			{ key: 'red', color: 'rgba(248, 113, 113, 0.6)' },
			{ key: 'green', color: 'rgba(74, 222, 128, 0.6)' },
			{ key: 'blue', color: 'rgba(96, 165, 250, 0.6)' }
		];
		for (const channel of channels) {
			const bins = histogram[channel.key];
			let maxCount = 1;
			for (const count of bins) if (count > maxCount) maxCount = count;
			const padding = 4;
			const innerWidth = width - padding * 2;
			const innerHeight = height - padding * 2;
			ctx.beginPath();
			for (let bin = 0; bin < bins.length; bin += 1) {
				const x = padding + (bin / Math.max(1, bins.length - 1)) * innerWidth;
				const y = padding + innerHeight - (bins[bin] / maxCount) * innerHeight;
				if (bin === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = channel.color;
			ctx.lineWidth = 1.2;
			ctx.stroke();
		}
	}

	function drawVectorscope(ctx: CanvasRenderingContext2D, width: number, height: number) {
		const { vectorscope } = analysis!;
		ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
		ctx.fillRect(0, 0, width, height);
		const size = Math.min(width, height) - 12;
		const centerX = width / 2;
		const centerY = height / 2;
		const radius = size / 2;

		ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(centerX - radius, centerY);
		ctx.lineTo(centerX + radius, centerY);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(centerX, centerY - radius);
		ctx.lineTo(centerX, centerY + radius);
		ctx.stroke();

		// 75% SMPTE color-bar targets in (B-Y, R-Y) coordinates. the analysis maps
		// (B-Y, R-Y) in -1..1 directly onto the scope radius, so placing the labels
		// at the same scale puts each target exactly where that color actually lands
		const targets: { label: string; u: number; v: number; color: string }[] = [
			{ label: 'R', u: -0.299, v: 0.701, color: 'rgba(248, 113, 113, 0.8)' },
			{ label: 'G', u: -0.786, v: -0.786, color: 'rgba(74, 222, 128, 0.8)' },
			{ label: 'B', u: 0.701, v: -0.299, color: 'rgba(96, 165, 250, 0.8)' },
			{ label: 'Y', u: -0.885, v: 0.099, color: 'rgba(250, 204, 21, 0.8)' },
			{ label: 'C', u: 0.099, v: -0.885, color: 'rgba(34, 211, 238, 0.8)' },
			{ label: 'M', u: 0.786, v: 0.786, color: 'rgba(232, 121, 249, 0.8)' }
		];
		for (const target of targets) {
			const x = centerX + target.u * radius;
			const y = centerY - target.v * radius;
			ctx.fillStyle = target.color;
			ctx.font = '8px ui-monospace, monospace';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText(target.label, x, y);
		}

		const maxCount = Math.max(1, vectorscope.count / 200);
		for (let row = 0; row < vectorscope.size; row += 1) {
			for (let column = 0; column < vectorscope.size; column += 1) {
				const count = vectorscope.buckets[row * vectorscope.size + column];
				if (count <= 0) continue;
				const u = (column + 0.5) / vectorscope.size - 0.5;
				const v = (row + 0.5) / vectorscope.size - 0.5;
				const x = centerX + u * 2 * radius;
				const y = centerY - v * 2 * radius;
				const intensity = Math.min(1, count / maxCount);
				// rotate the chroma vector angle so the red target (75% red sits at
				// (B-Y, R-Y) = (-0.299, 0.701), angle ≈ 113°) maps to hue 0; otherwise
				// red pixels would render as green dots
				const angle = (Math.atan2(v, u) * 180) / Math.PI;
				const hue = (((angle - 113 + 360) % 360) + 360) % 360;
				ctx.fillStyle = `hsla(${hue}, 95%, 60%, ${0.15 + intensity * 0.75})`;
				const dotSize = 1 + intensity * 2.2;
				ctx.beginPath();
				ctx.arc(x, y, dotSize, 0, Math.PI * 2);
				ctx.fill();
			}
		}
	}

	function selectScope(tab: ScopeTab) {
		sound.select();
		activeScope = tab;
		drawScope();
	}

	async function renderAndDraw() {
		if (renderInFlight) return;
		if (!renderer || !analysisCanvas) return;
		const safeAspect =
			aspectRatio.width > 0 && aspectRatio.height > 0 ? aspectRatio : { width: 16, height: 9 };
		const analysisHeight = Math.max(
			2,
			Math.round(ANALYSIS_WIDTH * (safeAspect.height / safeAspect.width))
		);
		if (analysisCanvas.width !== ANALYSIS_WIDTH) analysisCanvas.width = ANALYSIS_WIDTH;
		if (analysisCanvas.height !== analysisHeight) analysisCanvas.height = analysisHeight;
		renderInFlight = true;
		try {
			await renderer.render(analysisCanvas, Math.max(0, time));
			const context = analysisCanvas.getContext('2d');
			if (!context) return;
			const imageData = context.getImageData(0, 0, ANALYSIS_WIDTH, analysisHeight);
			analysis = analyzeFrame(imageData);
			lastRenderedTime = time;
			drawScope();
		} catch {
			// keep the previous scope image on transient render failures
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
		analysis = null;
		renderer = createFrameRenderer(tracks, mediaAssets);
		// schedule a fresh render without letting the time/playing reads inside
		// scheduleRender make this effect re-run on every playhead change
		untrack(() => scheduleRender());
	});

	$effect(() => {
		scheduleRender();
	});

	$effect(() => {
		if (!scopeCanvas) return;
		scopeContext = scopeCanvas.getContext('2d');
		const resizeObserver = new ResizeObserver(() => {
			drawScope();
		});
		resizeObserver.observe(scopeCanvas);
		return () => resizeObserver.disconnect();
	});

	onMount(() => {
		if (!root?.parentElement) return;
		const stored = readStoredPosition();
		if (stored) {
			const clamped = clampToParent(stored.x, stored.y);
			panelX = clamped.x;
			panelY = clamped.y;
		} else {
			// default anchor: top-right of the canvas area
			panelX = Math.max(0, root.parentElement.clientWidth - root.offsetWidth - 12);
			panelY = 12;
		}
	});

	onDestroy(() => {
		cancelRenderTimer();
		renderer?.dispose();
		renderer = null;
		scopeContext = null;
	});
</script>

<svelte:window onpointermove={moveDrag} onpointerup={finishDrag} onpointercancel={finishDrag} />

<div
	bind:this={root}
	class="pointer-events-auto absolute z-40 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-card/95 shadow-2xl backdrop-blur select-none"
	style:left="{panelX}px"
	style:top="{panelY}px"
>
	<div class="flex h-9 items-center gap-1 border-b border-border px-2">
		<span
			class="mr-1 flex shrink-0 cursor-grab touch-none items-center gap-1 text-[10px] font-semibold text-foreground active:cursor-grabbing"
			onpointerdown={startDrag}
			title="Drag to move"
			role="button"
			aria-label="Drag scopes panel"
			tabindex="0"
		>
			<GripVertical class="size-3.5 text-muted-foreground" />
			Scopes
		</span>
		<div class="min-w-0 flex-1"></div>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="xs"
						class="h-6 gap-1 px-1.5 text-[10px] font-medium text-muted-foreground"
					>
						<span class="max-w-24 truncate">{activeScopeLabel}</span>
						<ChevronDown class="size-3" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" sideOffset={6} class="min-w-36">
				<DropdownMenu.Group>
					<DropdownMenu.Label>Scope type</DropdownMenu.Label>
					{#each scopeTabs as tab (tab.id)}
						<DropdownMenu.Item onSelect={() => selectScope(tab.id)}>
							<span class="flex w-full items-center justify-between gap-2">
								<span>{tab.label}</span>
								{#if activeScope === tab.id}
									<Check class="size-3.5 text-primary" />
								{/if}
							</span>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
		<button
			class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
			onclick={() => {
				sound.select();
				onClose();
			}}
			aria-label="Close scopes"
		>
			<X class="size-3" />
		</button>
	</div>
	<div class="relative h-48">
		<canvas bind:this={scopeCanvas} class="absolute inset-0 size-full"></canvas>
		<canvas bind:this={analysisCanvas} class="hidden" aria-hidden="true"></canvas>
	</div>
	<div class="flex h-6 items-center justify-between border-t border-border px-2">
		<span class="text-[9px] text-muted-foreground tabular-nums">
			{activeScope === 'vectorscope' ? 'B-Y / R-Y' : 'IRE scale'}
		</span>
		<span class="text-[9px] text-muted-foreground/60 tabular-nums">
			{time.toFixed(2)}s
		</span>
	</div>
</div>
