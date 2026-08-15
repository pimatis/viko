<script lang="ts">
	import { onDestroy } from 'svelte';
	import { syncMedia } from '$lib/editor/mediaSync';
	import { FRAME_RATE, roundToFrame } from '$lib/editor/timeline';
	import { formatPlayerTime } from '$lib/editor/player';
	import { isTypingTarget } from '$lib/shortcuts';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { cn } from '$lib/utils';
	import { sound } from '$lib/sound';
	import {
		ArrowLeftToLine,
		ArrowRightToLine,
		ChevronLeft,
		ChevronRight,
		Film,
		Music,
		Pause,
		Play,
		Plus,
		SkipBack,
		SkipForward,
		X
	} from '@lucide/svelte';

	type Props = {
		open?: boolean;
		asset?: MediaAsset | null;
		currentTime?: number;
		isPlaying?: boolean;
		inPoint?: number | null;
		outPoint?: number | null;
		// exposed so the page can gate its keyboard shortcuts on whether the panel
		// (or anything inside it) holds focus; checked against document.activeElement
		// at keydown time rather than through focus events, which some embedded
		// webviews do not deliver reliably
		root?: HTMLElement | null;
		onClose?: () => void;
		onPlaybackChange?: (isPlaying: boolean) => void;
		onSetInPoint?: (time?: number) => void;
		onSetOutPoint?: (time?: number) => void;
		onClearInOut?: () => void;
		onInsert?: () => void;
	};

	let {
		open = $bindable(false),
		asset = $bindable(null),
		currentTime = $bindable(0),
		isPlaying = $bindable(false),
		inPoint = $bindable(null),
		outPoint = $bindable(null),
		root = $bindable(null),
		onClose = () => {},
		onPlaybackChange = () => {},
		onSetInPoint = () => {},
		onSetOutPoint = () => {},
		onClearInOut = () => {},
		onInsert = () => {}
	}: Props = $props();
	let scrubBar = $state<HTMLElement | null>(null);

	let playbackFrame: number | null = null;
	let lastPlaybackTimestamp: number | null = null;
	let handleDrag: { edge: 'in' | 'out'; pointerId: number } | null = null;

	const duration = $derived(asset?.duration ?? 0);
	const hasMedia = $derived(open && asset !== null && duration > 0);
	const playbackStart = $derived(inPoint ?? 0);
	const playbackEnd = $derived(outPoint ?? duration);
	const hasWindow = $derived(inPoint !== null || outPoint !== null);
	const windowDuration = $derived.by(() => {
		if (!hasWindow) return duration;
		const start = inPoint ?? 0;
		const end = outPoint ?? duration;
		return Math.max(0, end - start);
	});

	function clampTime(time: number): number {
		return Math.min(duration, Math.max(0, time));
	}

	function pct(time: number): string {
		if (duration <= 0) return '0%';
		return `${(clampTime(time) / duration) * 100}%`;
	}

	function rightPct(time: number): string {
		if (duration <= 0) return '0px';
		return `${100 - (clampTime(time) / duration) * 100}%`;
	}

	function focusPanel() {
		if (!root) return;
		if (document.activeElement && root.contains(document.activeElement)) return;
		root.focus();
	}

	// focus the panel when clicking any non-focusable area (preview, empty space)
	// so the panel keeps its keyboard shortcuts; implemented as an action to keep
	// the a11y linter quiet about listener-bearing static elements
	function focusPanelAction(node: HTMLElement) {
		function handleMouseDown() {
			if (document.activeElement && node.contains(document.activeElement)) return;
			node.focus();
		}
		node.addEventListener('mousedown', handleMouseDown);
		return {
			destroy() {
				node.removeEventListener('mousedown', handleMouseDown);
			}
		};
	}

	// keep the panel focused whenever it opens or loads a new asset so its
	// keyboard shortcuts (I/O/Space/arrows) take effect immediately
	$effect(() => {
		if (open && asset) {
			const frame = requestAnimationFrame(() => root?.focus());
			return () => cancelAnimationFrame(frame);
		}
	});

	// source monitor keys are captured at window level (capture phase) so they run
	// before the timeline's window-level shortcuts whenever the panel holds focus;
	// when it does not, the key falls through to the timeline unchanged
	function handleWindowKeydown(event: KeyboardEvent) {
		if (!open || !asset) return;
		if (!(asset.duration ?? 0) || !root || !root.contains(document.activeElement)) return;
		if (isTypingTarget(event.target)) return;
		const modifiers = event.ctrlKey || event.metaKey || event.altKey;
		if (modifiers) {
			if (event.key === 'i' && event.shiftKey && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				onClearInOut();
				sound.select();
			}
			return;
		}
		let handled = false;
		if (event.key === ' ') {
			togglePlay();
			handled = true;
		} else if (event.key === 'i') {
			onSetInPoint();
			sound.select();
			handled = true;
		} else if (event.key === 'o') {
			onSetOutPoint();
			sound.select();
			handled = true;
		} else if (event.key === 'ArrowLeft') {
			stepFrame(-1);
			handled = true;
		} else if (event.key === 'ArrowRight') {
			stepFrame(1);
			handled = true;
		} else if (event.key === 'Home') {
			skipToStart();
			handled = true;
		} else if (event.key === 'End') {
			skipToEnd();
			handled = true;
		} else if (event.key === 'Escape') {
			onClose();
			handled = true;
		}
		if (handled) event.preventDefault();
	}

	window.addEventListener('keydown', handleWindowKeydown, true);
	onDestroy(() => {
		window.removeEventListener('keydown', handleWindowKeydown, true);
	});

	// playback clock: drive currentTime in real time and let syncMedia keep the
	// media element in lockstep (same pattern as the timeline/player)
	$effect(() => {
		if (isPlaying && hasMedia) {
			startPlaybackLoop();
			return () => stopPlaybackLoop();
		}
		stopPlaybackLoop();
	});

	function startPlaybackLoop() {
		if (playbackFrame !== null) return;
		lastPlaybackTimestamp = null;
		playbackFrame = requestAnimationFrame(playbackTick);
	}

	function playbackTick(timestamp: number) {
		playbackFrame = null;
		if (lastPlaybackTimestamp === null) lastPlaybackTimestamp = timestamp;
		const delta = (timestamp - lastPlaybackTimestamp) / 1000;
		lastPlaybackTimestamp = timestamp;
		const next = currentTime + delta;
		if (next >= playbackEnd) {
			currentTime = playbackEnd;
			onPlaybackChange(false);
			return;
		}
		currentTime = next;
		playbackFrame = requestAnimationFrame(playbackTick);
	}

	function stopPlaybackLoop() {
		if (playbackFrame !== null) {
			cancelAnimationFrame(playbackFrame);
			playbackFrame = null;
		}
		lastPlaybackTimestamp = null;
	}

	function togglePlay() {
		if (!hasMedia) return;
		if (isPlaying) {
			onPlaybackChange(false);
			sound.pause();
			return;
		}
		if (currentTime >= playbackEnd || currentTime < playbackStart) {
			currentTime = playbackStart;
		}
		onPlaybackChange(true);
		sound.play();
	}

	function stepFrame(direction: 1 | -1) {
		if (!hasMedia) return;
		onPlaybackChange(false);
		currentTime = roundToFrame(clampTime(currentTime + direction / FRAME_RATE));
		sound.seek();
	}

	function skipToStart() {
		if (!hasMedia) return;
		onPlaybackChange(false);
		currentTime = playbackStart;
		sound.skipPrev();
	}

	function skipToEnd() {
		if (!hasMedia) return;
		onPlaybackChange(false);
		currentTime = playbackEnd;
		sound.skipNext();
	}

	function timeFromClientX(clientX: number): number | null {
		if (!scrubBar || duration <= 0) return null;
		const rect = scrubBar.getBoundingClientRect();
		if (rect.width <= 0) return null;
		const fraction = (clientX - rect.left) / rect.width;
		return roundToFrame(clampTime(fraction * duration));
	}

	function startScrub(event: PointerEvent) {
		if (!hasMedia) return;
		focusPanel();
		if (!(event.currentTarget instanceof HTMLElement)) return;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// pointer already released; keep scrubbing via move/up handlers anyway
		}
		const time = timeFromClientX(event.clientX);
		if (time !== null) {
			currentTime = time;
			sound.seek();
		}
	}

	function handleScrubMove(event: PointerEvent) {
		if (handleDrag && handleDrag.pointerId === event.pointerId) return;
		if (event.buttons === 0) return;
		const time = timeFromClientX(event.clientX);
		if (time !== null) {
			currentTime = time;
			sound.seek();
		}
	}

	function endScrub() {
		handleDrag = null;
	}

	function startHandleDrag(event: PointerEvent, edge: 'in' | 'out') {
		if (!hasMedia) return;
		event.stopPropagation();
		if (!(event.currentTarget instanceof HTMLElement)) return;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// pointer already released; drag state below keeps the handle moving
		}
		handleDrag = { edge, pointerId: event.pointerId };
	}

	function handleHandleMove(event: PointerEvent) {
		if (!handleDrag || handleDrag.pointerId !== event.pointerId) return;
		const time = timeFromClientX(event.clientX);
		if (time === null) return;
		if (handleDrag.edge === 'in') onSetInPoint(time);
		else onSetOutPoint(time);
		sound.seek();
	}
</script>

{#if open}
	<div
		bind:this={root}
		tabindex="-1"
		role="region"
		aria-label="Source monitor"
		class="shrink-0 border-b border-border bg-card outline-none"
		use:focusPanelAction
	>
		<div class="flex h-44 items-stretch gap-3 px-3 py-2.5">
			<!-- media preview -->
			<div
				class="relative aspect-video h-full shrink-0 overflow-hidden rounded-md bg-black"
				style="aspect-ratio: 16 / 9"
			>
				{#if asset?.kind === 'video'}
					<video
						src={asset.src}
						playsinline
						preload="auto"
						class="size-full object-contain"
						use:syncMedia={{
							time: currentTime,
							playing: hasMedia && isPlaying,
							muted: false,
							playbackRate: 1
						}}
					>
						<track kind="captions" />
					</video>
				{:else if asset?.kind === 'audio'}
					<audio
						src={asset.src}
						preload="auto"
						class="hidden"
						use:syncMedia={{
							time: currentTime,
							playing: hasMedia && isPlaying,
							muted: false,
							playbackRate: 1
						}}
					></audio>
					<div
						class="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
					>
						<Music class="size-10 opacity-50" />
						<span class="max-w-full truncate px-2 text-[10px] font-medium">{asset.name}</span>
					</div>
				{:else if asset?.kind === 'image'}
					<img src={asset.src} alt={asset.name} class="size-full object-contain" />
				{:else}
					<div
						class="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
					>
						<Film class="size-10 opacity-40" />
						<span class="text-[10px] font-medium">No media loaded</span>
					</div>
				{/if}
			</div>

			<!-- info + scrub + transport -->
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<!-- header -->
				<div class="flex h-6 shrink-0 items-center gap-2">
					<span class="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
						{asset?.name ?? 'Source monitor'}
					</span>
					{#if asset}
						<span
							class={cn(
								'shrink-0 rounded-sm px-1.5 py-px text-[9px] font-bold tracking-wider uppercase',
								asset.kind === 'audio'
									? 'bg-emerald-500/15 text-emerald-400'
									: asset.kind === 'image'
										? 'bg-sky-500/15 text-sky-400'
										: 'bg-blue-500/15 text-blue-400'
							)}
						>
							{asset.kind}
						</span>
					{/if}
					<Button
						variant="ghost"
						size="icon-xs"
						class="shrink-0 text-muted-foreground hover:text-foreground"
						onclick={() => {
							sound.pause();
							onPlaybackChange(false);
							onClose();
						}}
						aria-label="Close source monitor"
					>
						<X class="size-3.5" />
					</Button>
				</div>

				<!-- scrub bar with in/out handles + playhead -->
				<div
					bind:this={scrubBar}
					role="slider"
					aria-label="Source scrubber"
					aria-valuemin="0"
					aria-valuemax={Math.round(duration * 1000)}
					aria-valuenow={Math.round(currentTime * 1000)}
					tabindex="-1"
					class={cn(
						'relative h-5 flex-1 touch-none rounded-sm bg-background/70 select-none',
						hasMedia ? 'cursor-pointer' : 'cursor-default'
					)}
					onpointerdown={startScrub}
					onpointermove={handleScrubMove}
					onpointerup={endScrub}
					onpointercancel={endScrub}
				>
					{#if hasWindow && duration > 0}
						<div
							class="absolute inset-y-0 bg-primary/20"
							style:left={pct(inPoint ?? 0)}
							style:right={outPoint !== null ? rightPct(outPoint) : '0px'}
						></div>
					{/if}
					{#if inPoint !== null && duration > 0}
						<div
							class="absolute inset-y-0 z-10 w-1 -translate-x-1/2 cursor-ew-resize bg-primary"
							style:left={pct(inPoint)}
							role="slider"
							tabindex="-1"
							aria-label="Source in point"
							aria-valuemin="0"
							aria-valuemax={Math.round(duration * 1000)}
							aria-valuenow={Math.round(inPoint * 1000)}
							onpointerdown={(event) => startHandleDrag(event, 'in')}
							onpointermove={handleHandleMove}
							onpointerup={endScrub}
							onpointercancel={endScrub}
						></div>
					{/if}
					{#if outPoint !== null && duration > 0}
						<div
							class="absolute inset-y-0 z-10 w-1 -translate-x-1/2 cursor-ew-resize bg-primary"
							style:left={pct(outPoint)}
							role="slider"
							tabindex="-1"
							aria-label="Source out point"
							aria-valuemin="0"
							aria-valuemax={Math.round(duration * 1000)}
							aria-valuenow={Math.round(outPoint * 1000)}
							onpointerdown={(event) => startHandleDrag(event, 'out')}
							onpointermove={handleHandleMove}
							onpointerup={endScrub}
							onpointercancel={endScrub}
						></div>
					{/if}
					<div
						class="pointer-events-none absolute inset-y-0 z-20 w-px bg-white/90"
						style:left={pct(currentTime)}
					></div>
				</div>

				<!-- timecode row -->
				<div
					class="flex h-4 shrink-0 items-center gap-2 text-[10px] text-muted-foreground tabular-nums"
				>
					<span class="font-semibold text-foreground">{formatPlayerTime(currentTime)}</span>
					<span class="opacity-70"
						>/ {duration > 0 ? formatPlayerTime(duration) : '--:--:--:--'}</span
					>
					{#if hasWindow && duration > 0}
						<span class="ml-auto rounded-sm bg-primary/15 px-1.5 py-px font-medium text-primary">
							{formatPlayerTime(windowDuration)} window
						</span>
					{/if}
				</div>

				<!-- controls -->
				<div class="flex shrink-0 items-center gap-0.5">
					<Tooltip.Provider delayDuration={400}>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={skipToStart}
										aria-label="Go to start"
									>
										<SkipBack class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Go to start (Home)</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={() => stepFrame(-1)}
										aria-label="Step back one frame"
									>
										<ChevronLeft class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Step back one frame (←)</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class={cn(
											'text-muted-foreground hover:text-foreground',
											isPlaying && 'bg-secondary text-foreground shadow-sm'
										)}
										disabled={!hasMedia}
										onclick={togglePlay}
										aria-label={isPlaying ? 'Pause source' : 'Play source'}
									>
										{#if isPlaying}
											<Pause class="size-3.5" />
										{:else}
											<Play class="size-3.5" />
										{/if}
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Play or pause (Space)</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={() => stepFrame(1)}
										aria-label="Step forward one frame"
									>
										<ChevronRight class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Step forward one frame (→)</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={skipToEnd}
										aria-label="Go to end"
									>
										<SkipForward class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Go to end (End)</Tooltip.Content>
						</Tooltip.Root>

						<div class="mx-1 h-4 w-px bg-border"></div>

						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={() => onSetInPoint()}
										aria-label="Set source in point"
									>
										<ArrowRightToLine class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Set in point (I)</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="ghost"
										size="icon-xs"
										class="text-muted-foreground hover:text-foreground"
										disabled={!hasMedia}
										onclick={() => onSetOutPoint()}
										aria-label="Set source out point"
									>
										<ArrowLeftToLine class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>Set out point (O)</Tooltip.Content>
						</Tooltip.Root>
						{#if hasWindow}
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-xs"
											class="text-muted-foreground hover:text-foreground"
											onclick={onClearInOut}
											aria-label="Clear source in/out points"
										>
											<X class="size-3.5" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>Clear in/out (Shift+I)</Tooltip.Content>
							</Tooltip.Root>
						{/if}
					</Tooltip.Provider>

					<div class="flex-1"></div>

					<Button
						variant="default"
						size="sm"
						class="h-7 gap-1.5 px-2.5 text-[11px]"
						disabled={!asset}
						onclick={() => {
							sound.drop();
							onInsert();
						}}
					>
						<Plus class="size-3.5" />
						Insert{hasWindow && duration > 0 ? ` · ${formatPlayerTime(windowDuration)}` : ''}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}
