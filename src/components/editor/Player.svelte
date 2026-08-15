<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { getEffectVisualState, getClipTransitionVisualState } from '$lib/effects';
	import {
		detectPlayerAspectRatio,
		formatPlayerAspectRatio,
		formatPlayerTime,
		getActivePlayerLayers,
		getTemplatePreviewSize,
		PLAYER_ASPECT_RATIOS,
		PLAYER_ASPECT_RATIO_PRESETS,
		PLAYER_PLAYBACK_RATES,
		SOCIAL_TEMPLATES,
		snapVisualPosition,
		type PlayerAspectRatio,
		type PlayerAspectRatioMode,
		type PlayerAspectRatioPresetId,
		type PlayerLayer,
		type SocialTemplate
	} from '$lib/editor/player';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import {
		getColorGradePreviewFilter,
		getCurveFilterId,
		getCurveFilterTables,
		hasActiveCurves,
		isGradeCssExpressible
	} from '$lib/grading';
	import {
		MAX_VISUAL_SCALE,
		MIN_VISUAL_SCALE,
		getClipChromaKeyState,
		getClipMaskStyle,
		getClipSpeedAt,
		getClipVisualTransform,
		getClipVisualState,
		type ClipVisualState,
		type Track,
		type VisualTransform
	} from '$lib/editor/timeline';
	import { syncMedia, syncMediaAudio } from '$lib/editor/mediaSync';
	import { audioEngine } from '$lib/audio/engine';
	import { collectDuckSources, getDuckingFactorAtTime, isDuckSource } from '$lib/audio/ducking';
	import { isChromaKeyActive } from '$lib/chroma';
	import ChromaKeyLayer from './ChromaKeyLayer.svelte';
	import GradedLayer from './GradedLayer.svelte';
	import ReverseAudioLayer from './ReverseAudioLayer.svelte';
	import ScopesPanel from './ScopesPanel.svelte';
	import SplitViewOverlay from './SplitViewOverlay.svelte';
	import { cn } from '$lib/utils';
	import { sound } from '$lib/sound';
	import {
		Activity,
		Columns2,
		Expand,
		Film,
		Grid3X3,
		LayoutTemplate,
		Maximize,
		Minimize,
		Minus,
		Pause,
		Play,
		Plus,
		Repeat2,
		Volume2,
		VolumeX
	} from '@lucide/svelte';

	type Props = {
		currentTime?: number;
		duration?: number;
		tracks?: Track[];
		mediaAssets?: MediaAsset[];
		isPlaying?: boolean;
		onPlaybackChange?: (isPlaying: boolean) => void;
		playbackRate?: number;
		loopEnabled?: boolean;
		aspectRatio?: PlayerAspectRatio;
		aspectRatioMode?: PlayerAspectRatioMode;
		selectedClipId?: string | null;
		onVisualUpdate?: (
			clipId: string,
			update: { transform?: VisualTransform; color?: string }
		) => void;
		onAspectSettingsChange?: () => void;
	};

	type VisualDrag = {
		clipId: string;
		pointerId: number;
		startClientX: number;
		startClientY: number;
		startTransform: VisualTransform;
		canvasWidth: number;
		canvasHeight: number;
		didMove: boolean;
		target: HTMLElement;
		transformTarget: HTMLElement;
	};

	type VisualResize = {
		clipId: string;
		pointerId: number;
		centerClientX: number;
		centerClientY: number;
		startDistance: number;
		startTransform: VisualTransform;
		didResize: boolean;
		target: HTMLElement;
		transformTarget: HTMLElement;
		resizeHandles: HTMLElement[];
	};

	let {
		currentTime = $bindable(0),
		duration = 0,
		tracks = [],
		mediaAssets = [],
		isPlaying = $bindable(false),
		playbackRate = $bindable(1),
		loopEnabled = $bindable(false),
		aspectRatio = $bindable({ width: 16, height: 9 } as PlayerAspectRatio),
		aspectRatioMode = $bindable<PlayerAspectRatioMode>('auto'),
		selectedClipId = $bindable(null),
		onVisualUpdate = () => {},
		onPlaybackChange = () => {},
		onAspectSettingsChange = () => {}
	}: Props = $props();

	// JKL shuttle runs the timeline clock backward (negative playbackRate).
	// HTMLMediaElement cannot free-run backward, so while shuttling backward every
	// media layer is switched into the frame-step mode used by reversed clips:
	// the element stays paused and syncMedia seeks it one frame per clock tick.
	const steppingBackward = $derived(playbackRate < 0);

	// An adjustment layer applies its effects/grading to every visual layer below
	// it (in track stacking order) that overlaps its time range. The preview builds
	// a nested tree of 'band' nodes: each band is a full-frame wrapper whose CSS
	// filter/transform/opacity is applied to the whole composited group beneath it.
	type PreviewRenderNode = {
		key: string;
		kind: 'layer' | 'band';
		layer: PlayerLayer;
		children?: PreviewRenderNode[];
	};

	let playerRoot = $state<HTMLElement | null>(null);
	let playerCanvas = $state<HTMLElement | null>(null);
	let previewZoom = $state(100);
	let previewMuted = $state(false);
	let previewVolume = $state(1);
	let showGuides = $state(false);
	let templatePopoverOpen = $state(false);
	let isFullscreen = $state(false);
	let scopesOpen = $state(false);
	let splitViewOpen = $state(false);
	let visualDrag: VisualDrag | null = null;
	let visualResize: VisualResize | null = null;
	let snapGuideX = $state<number | null>(null);
	let snapGuideY = $state<number | null>(null);

	// non-reactive drag state - no need for reactivity, updated via RAF
	let pendingTransform: VisualTransform | null = null;
	let pendingSnapGuideX: number | null = null;
	let pendingSnapGuideY: number | null = null;
	let rafId: number | null = null;

	function cancelRaf() {
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
	}

	function getTransformStyle(transform: VisualTransform) {
		return `translate3d(${transform.x - 50}%, ${transform.y - 50}%, 0) rotate(${transform.rotation}deg) scale(${transform.scale})`;
	}

	function combineTransforms(...transforms: string[]): string {
		return transforms.filter((transform) => transform && transform !== 'none').join(' ') || 'none';
	}

	function combineFilters(...filters: string[]): string {
		return filters.filter((filter) => filter && filter !== 'none').join(' ') || 'none';
	}

	function applyPendingTransform() {
		if (!pendingTransform) return;
		const transformTarget = visualResize?.transformTarget ?? visualDrag?.transformTarget;
		if (!transformTarget) return;
		transformTarget.style.transform = getTransformStyle(pendingTransform);
		if (!visualResize) return;
		for (const handle of visualResize.resizeHandles) {
			handle.style.transform = `scale(${1 / pendingTransform.scale})`;
		}
	}

	// flush the latest pointer position before committing the transform
	function flushPendingTransform() {
		cancelRaf();
		applyPendingTransform();
		if (!visualDrag) return;
		snapGuideX = pendingSnapGuideX;
		snapGuideY = pendingSnapGuideY;
	}

	// update only the composited layer during pointer movement
	function scheduleTransformUpdate() {
		if (rafId !== null) return;
		rafId = requestAnimationFrame(() => {
			rafId = null;
			applyPendingTransform();
			if (!visualDrag) return;
			snapGuideX = pendingSnapGuideX;
			snapGuideY = pendingSnapGuideY;
		});
	}

	onDestroy(() => {
		cancelRaf();
	});

	const assetsById = $derived(new Map(mediaAssets.map((asset) => [asset.id, asset])));
	const activeLayers = $derived(getActivePlayerLayers(tracks, assetsById, currentTime));
	const compositedLayers = $derived(
		activeLayers.filter((layer) => !layer.asset || layer.asset.kind !== 'audio')
	);
	const visualLayers = $derived(
		compositedLayers.filter((layer) => layer.trackType !== 'adjustment')
	);
	const adjustmentLayers = $derived(
		compositedLayers.filter((layer) => layer.trackType === 'adjustment')
	);

	// nested band tree: each adjustment layer absorbs everything rendered below it
	// (the previous band plus any plain layers in between) into its own wrapper
	const renderTree = $derived.by(() => {
		const root: PreviewRenderNode[] = [];
		let lastBand: PreviewRenderNode | null = null;
		let index = 0;
		for (const layer of compositedLayers) {
			const key = `${layer.trackId}-${layer.clip.sourceInstanceId ?? layer.clip.id}-${index}`;
			index += 1;
			// audio-track clips render no visual band; their audio is routed
			// through the audio layers below (a linked A/V pair would otherwise
			// double the audio via the band's own media element)
			if (layer.trackType === 'audio') continue;
			if (layer.trackType !== 'adjustment') {
				root.push({ key, kind: 'layer', layer });
				continue;
			}
			const children: PreviewRenderNode[] = [];
			if (lastBand) children.push(lastBand);
			children.push(...root.splice(0));
			const band: PreviewRenderNode = { key, kind: 'band', layer, children };
			root.push(band);
			lastBand = band;
		}
		return root;
	});
	// a linked A/V pair routes audio through the audio-track clip: audio layers
	// include audio-kind assets AND audio-track clips holding a video asset
	const audioLayers = $derived(
		activeLayers.filter(
			(layer) => layer.asset && (layer.asset.kind === 'audio' || layer.trackType === 'audio')
		)
	);
	// visual clips whose audio comes from a linked audio-track clip; their own
	// media element is muted so the pair does not double the audio
	const linkedAudioVisualClipIds = $derived.by(() => {
		const audioInstanceIds = new Set<string>();
		for (const track of tracks) {
			if (track.type !== 'audio') continue;
			for (const clip of track.clips) {
				if (clip.sourceInstanceId) audioInstanceIds.add(clip.sourceInstanceId);
			}
		}
		const visualIds = new Set<string>();
		for (const track of tracks) {
			if (track.type === 'audio') continue;
			for (const clip of track.clips) {
				if (clip.sourceInstanceId && audioInstanceIds.has(clip.sourceInstanceId)) {
					visualIds.add(clip.id);
				}
			}
		}
		return visualIds;
	});
	const duckSources = $derived(collectDuckSources(tracks));
	const currentTimeLabel = $derived(formatPlayerTime(currentTime));
	const durationLabel = $derived(formatPlayerTime(duration));
	const selectedLayer = $derived(
		activeLayers.find((layer) => layer.clip.id === selectedClipId) ?? null
	);
	const selectedColor = $derived(
		selectedLayer?.clip.textStyle?.color ?? selectedLayer?.clip.stickerColor ?? '#ffffff'
	);
	const topVisualLayerId = $derived(visualLayers.at(-1)?.clip.id ?? null);

	const ratioReference = $derived.by(() => {
		for (let index = visualLayers.length - 1; index >= 0; index -= 1) {
			const layer = visualLayers[index];
			const detected = detectPlayerAspectRatio(layer.asset?.width ?? 0, layer.asset?.height ?? 0);
			if (!detected) continue;
			return { key: layer.clip.assetId ?? layer.clip.id, ratio: detected };
		}
		return null;
	});

	// manual presets override auto-detection only for the media they were chosen on
	let aspectRatioOverrideKey: string | null = null;

	$effect(() => {
		if (aspectRatioMode !== 'auto') return;
		const reference = ratioReference;
		if (!reference) return;
		if (aspectRatioOverrideKey === reference.key) return;
		aspectRatioOverrideKey = reference.key;
		aspectRatio = reference.ratio;
	});

	function applyAspectRatioPreset(presetId: PlayerAspectRatioPresetId): boolean {
		const preset = PLAYER_ASPECT_RATIOS[presetId];
		if (!preset) return false;
		aspectRatioMode = presetId;
		aspectRatio = { ...preset };
		aspectRatioOverrideKey = ratioReference?.key ?? null;
		return true;
	}

	function handleAspectRatioChange(value: string) {
		sound.select();
		if (value === 'auto') {
			aspectRatioMode = 'auto';
			aspectRatioOverrideKey = null;
			if (ratioReference) aspectRatio = ratioReference.ratio;
			onAspectSettingsChange();
			return;
		}
		if (applyAspectRatioPreset(value as PlayerAspectRatioPresetId)) {
			onAspectSettingsChange();
		}
	}

	function applySocialTemplate(template: SocialTemplate) {
		sound.select();
		applyAspectRatioPreset(template.ratioLabel);
		templatePopoverOpen = false;
		onAspectSettingsChange();
	}

	function togglePlayback() {
		if (isPlaying) sound.pause();
		if (!isPlaying) sound.play();
		isPlaying = !isPlaying;
		onPlaybackChange(isPlaying);
	}

	function togglePreviewMute() {
		if (previewMuted) sound.toggleOff();
		if (!previewMuted) sound.toggleOn();
		previewMuted = !previewMuted;
	}

	function toggleLoop() {
		if (loopEnabled) sound.toggleOff();
		if (!loopEnabled) sound.toggleOn();
		loopEnabled = !loopEnabled;
	}

	function zoomIn() {
		previewZoom = Math.min(200, previewZoom + 10);
	}

	function zoomOut() {
		previewZoom = Math.max(25, previewZoom - 10);
	}

	function fitPreview() {
		previewZoom = 100;
	}

	async function toggleFullscreen() {
		sound.select();
		if (!playerRoot) return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}
			await playerRoot.requestFullscreen();
		} catch {
			return;
		}
	}

	function handleFullscreenChange() {
		isFullscreen = document.fullscreenElement === playerRoot;
	}

	function handlePlaybackRateChange(value: string) {
		const nextRate = Number(value);
		if (!PLAYER_PLAYBACK_RATES.some((rate) => rate === nextRate)) return;
		sound.select();
		playbackRate = nextRate;
	}

	function getLayerPlaybackRate(layer: PlayerLayer): number {
		if (layer.clip.frozen === true) return 0;
		// HTMLMediaElement.playbackRate does not accept negative values. Reversed
		// clips are seeked backward every tick via syncEveryTick, so the media
		// element always runs forward at the positive rate.
		return playbackRate * getClipSpeedAt(layer.clip, layer.clipTime);
	}

	function getLayerVolume(layer: PlayerLayer, state: ClipVisualState): number {
		let fadeFactor = 1;
		if (state.audioFadeIn > 0 && layer.clipTime < state.audioFadeIn) {
			fadeFactor = Math.max(0, layer.clipTime / state.audioFadeIn);
		}
		const timeUntilEnd = layer.clip.duration - layer.clipTime;
		if (state.audioFadeOut > 0 && timeUntilEnd < state.audioFadeOut) {
			fadeFactor = Math.min(fadeFactor, Math.max(0, timeUntilEnd / state.audioFadeOut));
		}
		return Math.min(4, Math.max(0, state.volume * fadeFactor));
	}

	function getLayerDuckingFactor(layer: PlayerLayer): number {
		return getDuckingFactorAtTime(duckSources, isDuckSource(layer.clip), currentTime);
	}

	function getLayerEffectiveVolume(layer: PlayerLayer, state: ClipVisualState): number {
		const muted = previewMuted || layer.trackMuted;
		if (muted) return 0;
		return previewVolume * getLayerVolume(layer, state) * getLayerDuckingFactor(layer);
	}

	function startVisualDrag(event: PointerEvent, layer: PlayerLayer) {
		if (event.button !== 0 || layer.trackLocked || !playerCanvas) return;
		if (!(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		finishVisualDrag();
		cancelRaf();
		pendingTransform = null;
		pendingSnapGuideX = null;
		pendingSnapGuideY = null;
		const target = event.currentTarget;
		const transformTarget = target.firstElementChild;
		if (!(transformTarget instanceof HTMLElement)) return;
		target.setPointerCapture(event.pointerId);
		selectedClipId = layer.clip.id;
		isPlaying = false;
		const rect = playerCanvas.getBoundingClientRect();
		const transform = getClipVisualTransform(layer.clip, layer.clipTime);
		visualDrag = {
			clipId: layer.clip.id,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startTransform: { ...transform },
			canvasWidth: Math.max(1, rect.width),
			canvasHeight: Math.max(1, rect.height),
			didMove: false,
			target,
			transformTarget
		};
	}

	function startVisualResize(event: PointerEvent, layer: PlayerLayer) {
		if (event.button !== 0 || layer.trackLocked || !playerCanvas) return;
		if (!(event.currentTarget instanceof HTMLElement)) return;
		event.preventDefault();
		event.stopPropagation();
		finishVisualDrag();
		cancelRaf();
		pendingTransform = null;
		pendingSnapGuideX = null;
		pendingSnapGuideY = null;
		const target = event.currentTarget;
		const transformTarget = target.parentElement;
		if (!(transformTarget instanceof HTMLElement)) return;
		target.setPointerCapture(event.pointerId);
		selectedClipId = layer.clip.id;
		isPlaying = false;
		const canvasRect = playerCanvas.getBoundingClientRect();
		const transform = getClipVisualTransform(layer.clip, layer.clipTime);
		const centerClientX = canvasRect.left + (transform.x / 100) * canvasRect.width;
		const centerClientY = canvasRect.top + (transform.y / 100) * canvasRect.height;
		visualResize = {
			clipId: layer.clip.id,
			pointerId: event.pointerId,
			centerClientX,
			centerClientY,
			startDistance: Math.max(
				1,
				Math.hypot(event.clientX - centerClientX, event.clientY - centerClientY)
			),
			startTransform: transform,
			didResize: false,
			target,
			transformTarget,
			resizeHandles: Array.from(
				transformTarget.querySelectorAll<HTMLElement>('[data-resize-handle]')
			)
		};
	}

	function moveVisualDrag(event: PointerEvent) {
		if (visualResize) {
			if (event.pointerId !== visualResize.pointerId) return;
			const distance = Math.hypot(
				event.clientX - visualResize.centerClientX,
				event.clientY - visualResize.centerClientY
			);
			const scale = Math.min(
				MAX_VISUAL_SCALE,
				Math.max(
					MIN_VISUAL_SCALE,
					visualResize.startTransform.scale * (distance / visualResize.startDistance)
				)
			);
			visualResize.didResize ||= Math.abs(scale - visualResize.startTransform.scale) > 0.005;
			pendingTransform = { ...visualResize.startTransform, scale };
			pendingSnapGuideX = null;
			pendingSnapGuideY = null;
			scheduleTransformUpdate();
			return;
		}
		if (!visualDrag) return;
		if (event.pointerId !== visualDrag.pointerId) return;
		const deltaX = ((event.clientX - visualDrag.startClientX) / visualDrag.canvasWidth) * 100;
		const deltaY = ((event.clientY - visualDrag.startClientY) / visualDrag.canvasHeight) * 100;
		const snapped = snapVisualPosition(
			{
				...visualDrag.startTransform,
				x: visualDrag.startTransform.x + deltaX,
				y: visualDrag.startTransform.y + deltaY
			},
			{ x: (8 / visualDrag.canvasWidth) * 100, y: (8 / visualDrag.canvasHeight) * 100 }
		);
		visualDrag.didMove ||= Math.hypot(deltaX, deltaY) > 0.2;
		pendingTransform = snapped.transform;
		pendingSnapGuideX = snapped.guideX;
		pendingSnapGuideY = snapped.guideY;
		scheduleTransformUpdate();
	}

	function releaseCapture(target: HTMLElement | null, pointerId: number) {
		if (!target) return;
		try {
			target.releasePointerCapture(pointerId);
		} catch {
			// element may not hold the capture if it was recreated
		}
	}

	function finishVisualDrag(event?: PointerEvent) {
		if (visualResize) {
			if (event && event.pointerId !== visualResize.pointerId) return;
			flushPendingTransform();
			const completedResize = visualResize;
			const completedTransform = pendingTransform;
			visualResize = null;
			pendingTransform = null;
			pendingSnapGuideX = null;
			pendingSnapGuideY = null;
			snapGuideX = null;
			snapGuideY = null;
			if (completedResize.didResize && completedTransform) {
				onVisualUpdate(completedResize.clipId, { transform: completedTransform });
			}
			releaseCapture(completedResize.target, completedResize.pointerId);
			return;
		}
		if (!visualDrag) return;
		if (event && event.pointerId !== visualDrag.pointerId) return;
		flushPendingTransform();
		const completedDrag = visualDrag;
		const completedTransform = pendingTransform;
		visualDrag = null;
		pendingTransform = null;
		pendingSnapGuideX = null;
		pendingSnapGuideY = null;
		snapGuideX = null;
		snapGuideY = null;
		if (completedDrag.didMove && completedTransform) {
			onVisualUpdate(completedDrag.clipId, { transform: completedTransform });
		}
		releaseCapture(completedDrag.target, completedDrag.pointerId);
	}

	function updateSelectedColor(event: Event) {
		if (!selectedLayer || (!selectedLayer.clip.textStyle && !selectedLayer.clip.sticker)) return;
		onVisualUpdate(selectedLayer.clip.id, {
			color: (event.currentTarget as HTMLInputElement).value
		});
	}

	function handleLayerKeydown(event: KeyboardEvent, layer: PlayerLayer) {
		if (layer.trackLocked) return;
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selectedClipId = layer.clip.id;
			return;
		}
		if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
		event.preventDefault();
		const step = event.shiftKey ? 5 : 1;
		const transform = getClipVisualTransform(layer.clip, layer.clipTime);
		const nextTransform = { ...transform };
		if (event.key === 'ArrowLeft') nextTransform.x -= step;
		if (event.key === 'ArrowRight') nextTransform.x += step;
		if (event.key === 'ArrowUp') nextTransform.y -= step;
		if (event.key === 'ArrowDown') nextTransform.y += step;
		selectedClipId = layer.clip.id;
		onVisualUpdate(layer.clip.id, { transform: nextTransform });
	}
</script>

<svelte:document onfullscreenchange={handleFullscreenChange} />
<svelte:window
	onpointermove={moveVisualDrag}
	onpointerup={(event) => finishVisualDrag(event)}
	onpointercancel={(event) => finishVisualDrag(event)}
	onblur={() => finishVisualDrag()}
/>

<section bind:this={playerRoot} class="isolate flex h-full min-h-0 min-w-0 flex-1 flex-col bg-card">
	<!-- top control bar -->
	<div
		class="relative z-20 flex h-10 shrink-0 items-center justify-end gap-1.5 border-b border-border bg-card px-2.5"
	>
		{#if selectedLayer?.clip.textStyle || selectedLayer?.clip.sticker}
			<label
				class="flex h-7 items-center gap-2 rounded-md border border-border bg-background/60 px-2"
				title="Selected layer color"
			>
				<span class="text-[10px] font-medium text-muted-foreground">Color</span>
				<input
					type="color"
					value={selectedColor}
					onchange={updateSelectedColor}
					disabled={selectedLayer.trackLocked}
					class="size-4 cursor-pointer border-0 bg-transparent p-0"
					aria-label="Selected layer color"
				/>
			</label>
		{/if}

		<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
			<Popover.Root bind:open={templatePopoverOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground transition-all hover:text-foreground"
							aria-label="Social media templates"
							title="Social media templates"
						>
							<LayoutTemplate class="size-4" />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="start" side="bottom" sideOffset={6} class="w-64 p-1.5">
					<div class="flex flex-col gap-0.5 p-1">
						<span
							class="px-1.5 pt-1 pb-1.5 text-[10px] font-bold tracking-wider text-muted-foreground uppercase"
						>
							Social templates
						</span>
						{#each SOCIAL_TEMPLATES as template (template.id)}
							{@const preview = getTemplatePreviewSize(template)}
							<button
								type="button"
								title={template.description}
								class="group flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-secondary/60"
								onclick={() => applySocialTemplate(template)}
							>
								<span
									class="flex shrink-0 items-center justify-center rounded-[3px] bg-background ring-1 ring-border"
									style:width={`${preview.width}px`}
									style:height={`${preview.height}px`}
								></span>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-1.5">
										<span class="truncate text-xs font-semibold text-foreground"
											>{template.name}</span
										>
										<span
											class="shrink-0 rounded-sm bg-secondary px-1 py-px text-[9px] font-medium text-muted-foreground tabular-nums"
										>
											{template.ratioLabel}
										</span>
									</span>
									<span class="block truncate text-[10px] text-muted-foreground">
										{template.platform}
									</span>
									<span class="block truncate text-[9px] text-muted-foreground/70 tabular-nums">
										{template.resolutionLabel} · export keeps this ratio
									</span>
								</span>
							</button>
						{/each}
					</div>
				</Popover.Content>
			</Popover.Root>

			<Select.Root type="single" value={aspectRatioMode} onValueChange={handleAspectRatioChange}>
				<Select.Trigger
					size="sm"
					class="h-6 min-w-14 border-0 bg-transparent px-1.5 text-[10px] font-medium text-muted-foreground shadow-none hover:text-foreground"
					aria-label="Preview aspect ratio"
				>
					<span>
						{aspectRatioMode === 'auto'
							? `Auto ${formatPlayerAspectRatio(aspectRatio)}`
							: aspectRatioMode}
					</span>
				</Select.Trigger>
				<Select.Content align="end">
					<Select.Item value="auto" label="Auto (fit media)" />
					{#each PLAYER_ASPECT_RATIO_PRESETS as presetId (presetId)}
						<Select.Item value={presetId} label={presetId} />
					{/each}
				</Select.Content>
			</Select.Root>

			<Button
				variant="ghost"
				size="icon-xs"
				class={cn(
					'text-muted-foreground transition-all hover:text-foreground',
					scopesOpen && 'bg-secondary text-foreground shadow-sm'
				)}
				onclick={() => {
					sound.select();
					scopesOpen = !scopesOpen;
				}}
				aria-label="Toggle scopes"
				title="Scopes (waveform, vectorscope, histogram, parade)"
			>
				<Activity class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class={cn(
					'text-muted-foreground transition-all hover:text-foreground',
					splitViewOpen && 'bg-secondary text-foreground shadow-sm'
				)}
				onclick={() => {
					sound.select();
					splitViewOpen = !splitViewOpen;
				}}
				aria-label="Toggle before/after split view"
				title="Before / after split view"
			>
				<Columns2 class="size-4" />
			</Button>

			<div class="h-3.5 w-px bg-border"></div>

			<Button
				variant="ghost"
				size="icon-xs"
				class={cn(
					'text-muted-foreground transition-all',
					showGuides && 'bg-secondary text-foreground shadow-sm'
				)}
				onclick={() => (showGuides = !showGuides)}
				aria-label="Toggle guides"
				title="Toggle guides"
			>
				<Grid3X3 class="size-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon-xs"
				class="text-muted-foreground hover:text-foreground"
				onclick={toggleFullscreen}
				aria-label="Toggle fullscreen"
				title="Toggle fullscreen"
			>
				{#if isFullscreen}
					<Minimize class="size-4" />
				{:else}
					<Maximize class="size-4" />
				{/if}
			</Button>
		</div>
	</div>

	<!-- canvas area -->
	<div
		class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-background p-4"
	>
		<div
			bind:this={playerCanvas}
			class="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-xl ring-1 ring-white/5"
			style="aspect-ratio: {aspectRatio.width} / {aspectRatio.height}; width: min(100%, calc((100vh - 330px) * {aspectRatio.width /
				aspectRatio.height}))"
			role="presentation"
		>
			<div
				class="size-full"
				style="transform: scale({previewZoom / 100}); transform-origin: center center"
			>
				{#snippet renderNode(node: PreviewRenderNode)}
					{#if node.kind === 'band'}
						{@const layer = node.layer}
						{@const bandVisualState = getClipVisualState(layer.clip, layer.clipTime)}
						{@const bandEffectStyle = getEffectVisualState(
							layer.clip.effects ?? [],
							layer.clipTime,
							layer.clip.duration,
							bandVisualState.colorAdjust,
							bandVisualState.opacity
						)}
						{@const bandCurveFilterId = layer.clip.colorGrade
							? getCurveFilterId(layer.clip.id)
							: null}
						{@const bandGradeFilter = getColorGradePreviewFilter(
							layer.clip.colorGrade,
							bandCurveFilterId
						)}
						{@const bandMaskStyle = bandVisualState.transform.mask
							? getClipMaskStyle(bandVisualState.transform.mask)
							: undefined}
						<div
							class="pointer-events-none absolute inset-0"
							style:filter={combineFilters(bandEffectStyle.filter, bandGradeFilter)}
							style:opacity={bandEffectStyle.opacity}
							style:clip-path={bandMaskStyle}
							style:transform={bandEffectStyle.transform !== 'none'
								? bandEffectStyle.transform
								: undefined}
						>
							{#if layer.clip.colorGrade && hasActiveCurves(layer.clip.colorGrade.curves) && bandCurveFilterId}
								{@const curveTables = getCurveFilterTables(layer.clip.colorGrade.curves)}
								<svg class="absolute size-0" aria-hidden="true">
									<defs>
										<filter id={bandCurveFilterId} color-interpolation-filters="sRGB">
											<feComponentTransfer>
												<feFuncR type="table" tableValues={curveTables.red} />
												<feFuncG type="table" tableValues={curveTables.green} />
												<feFuncB type="table" tableValues={curveTables.blue} />
												<feFuncA type="linear" slope="1" />
											</feComponentTransfer>
											<feComponentTransfer>
												<feFuncR type="table" tableValues={curveTables.master} />
												<feFuncG type="table" tableValues={curveTables.master} />
												<feFuncB type="table" tableValues={curveTables.master} />
												<feFuncA type="linear" slope="1" />
											</feComponentTransfer>
										</filter>
									</defs>
								</svg>
							{/if}
							{#each node.children as child (child.key)}
								{@render renderNode(child)}
							{/each}
						</div>
					{:else}
						{@const layer = node.layer}
						{@const visualState = getClipVisualState(layer.clip, layer.clipTime)}
						{@const effectStyle = getEffectVisualState(
							layer.clip.effects ?? [],
							layer.clipTime,
							layer.clip.duration,
							visualState.colorAdjust,
							visualState.opacity
						)}
						{@const curveFilterId = layer.clip.colorGrade ? getCurveFilterId(layer.clip.id) : null}
						{@const gradeFilter = getColorGradePreviewFilter(layer.clip.colorGrade, curveFilterId)}
						{@const chromaActive = isChromaKeyActive(layer.clip.chromaKey)}
						{@const needsGradedCanvas = Boolean(
							layer.clip.colorGrade &&
							(layer.asset?.kind === 'video' || layer.asset?.kind === 'image') &&
							!isGradeCssExpressible(layer.clip.colorGrade)
						)}
						{@const transitionState =
							layer.transitionRole && layer.transitionProgress !== undefined
								? getClipTransitionVisualState(
										layer.transitionPresetId ?? '',
										layer.transitionRole,
										layer.transitionProgress
									)
								: null}
						{@const layerOpacity = transitionState
							? effectStyle.opacity * transitionState.opacity
							: effectStyle.opacity}
						{@const layerTransform = transitionState
							? combineTransforms(effectStyle.transform, transitionState.transform)
							: effectStyle.transform}
						{@const visualTransform = visualState.transform}
						{@const maskStyle = visualTransform.mask
							? getClipMaskStyle(visualTransform.mask)
							: undefined}
						<div
							class={cn(
								'absolute inset-0 cursor-move touch-none overflow-hidden',
								(selectedClipId
									? selectedClipId !== layer.clip.id
									: topVisualLayerId !== layer.clip.id) && 'pointer-events-none',
								layer.trackLocked && 'cursor-not-allowed'
							)}
							style:mix-blend-mode={visualTransform.blendMode !== 'normal'
								? visualTransform.blendMode
								: undefined}
							onpointerdown={(event) => startVisualDrag(event, layer)}
							onlostpointercapture={(event) => finishVisualDrag(event)}
							onkeydown={(event) => handleLayerKeydown(event, layer)}
							role="button"
							tabindex="0"
							aria-label={`Move ${layer.clip.name}`}
						>
							{#if layer.clip.colorGrade && hasActiveCurves(layer.clip.colorGrade.curves) && curveFilterId}
								{@const curveTables = getCurveFilterTables(layer.clip.colorGrade.curves)}
								<svg class="absolute size-0" aria-hidden="true">
									<defs>
										<filter id={curveFilterId} color-interpolation-filters="sRGB">
											<feComponentTransfer>
												<feFuncR type="table" tableValues={curveTables.red} />
												<feFuncG type="table" tableValues={curveTables.green} />
												<feFuncB type="table" tableValues={curveTables.blue} />
												<feFuncA type="linear" slope="1" />
											</feComponentTransfer>
											<feComponentTransfer>
												<feFuncR type="table" tableValues={curveTables.master} />
												<feFuncG type="table" tableValues={curveTables.master} />
												<feFuncB type="table" tableValues={curveTables.master} />
												<feFuncA type="linear" slope="1" />
											</feComponentTransfer>
										</filter>
									</defs>
								</svg>
							{/if}
							<div
								class={cn(
									'absolute inset-0',
									selectedClipId === layer.clip.id &&
										'outline outline-1 -outline-offset-1 outline-primary'
								)}
								style:transform={getTransformStyle(visualTransform)}
							>
								<div class="size-full" style:clip-path={maskStyle}>
									<div
										class="size-full overflow-hidden"
										style:filter={combineFilters(effectStyle.filter, gradeFilter)}
										style:transform={layerTransform}
										style:opacity={layerOpacity}
										style:clip-path={transitionState?.clipInsetRightPercent
											? `inset(0 ${transitionState.clipInsetRightPercent}% 0 0)`
											: 'none'}
									>
										{#if layer.asset?.playbackSupported === false}
											<div
												class="flex size-full items-center justify-center px-6 text-center text-xs text-muted-foreground"
											>
												{layer.asset.name} requires a compatible proxy
											</div>
										{:else if layer.asset?.kind === 'video' || layer.asset?.kind === 'image'}
											{#if needsGradedCanvas}
												<GradedLayer
													src={layer.asset.src}
													mediaKind={layer.asset.kind}
													sourceTime={layer.sourceTime}
													{isPlaying}
													muted={previewMuted ||
														layer.trackMuted ||
														layer.clip.reversed === true ||
														linkedAudioVisualClipIds.has(layer.clip.id)}
													syncEveryTick={layer.clip.reversed === true || steppingBackward}
													reversed={layer.clip.reversed === true || steppingBackward}
													playbackRate={getLayerPlaybackRate(layer)}
													volume={getLayerEffectiveVolume(layer, visualState)}
													trackId={layer.trackId}
													grade={layer.clip.colorGrade!}
													chromaConfig={chromaActive
														? getClipChromaKeyState(layer.clip, layer.clipTime)
														: null}
												/>
											{:else if chromaActive}
												<ChromaKeyLayer
													src={layer.asset.src}
													mediaKind={layer.asset.kind}
													sourceTime={layer.sourceTime}
													{isPlaying}
													muted={previewMuted ||
														layer.trackMuted ||
														layer.clip.reversed === true ||
														linkedAudioVisualClipIds.has(layer.clip.id)}
													syncEveryTick={layer.clip.reversed === true || steppingBackward}
													reversed={layer.clip.reversed === true || steppingBackward}
													playbackRate={getLayerPlaybackRate(layer)}
													volume={getLayerEffectiveVolume(layer, visualState)}
													trackId={layer.trackId}
													config={getClipChromaKeyState(layer.clip, layer.clipTime)}
												/>
											{:else if layer.asset?.kind === 'video'}
												<video
													src={layer.asset.src}
													playsinline
													preload="auto"
													class="pointer-events-none size-full object-contain"
													use:syncMedia={{
														time: layer.sourceTime,
														playing: isPlaying,
														muted:
															previewMuted ||
															layer.trackMuted ||
															layer.clip.reversed === true ||
															linkedAudioVisualClipIds.has(layer.clip.id),
														playbackRate: getLayerPlaybackRate(layer),
														syncEveryTick: layer.clip.reversed === true || steppingBackward,
														reversed: layer.clip.reversed === true || steppingBackward
													}}
													use:syncMediaAudio={{
														trackId: layer.trackId,
														volume: getLayerEffectiveVolume(layer, visualState)
													}}
												>
													<track kind="captions" />
												</video>
												{#if layer.clip.reversed === true && !linkedAudioVisualClipIds.has(layer.clip.id)}
													<ReverseAudioLayer
														src={layer.asset.src}
														sourceTime={layer.sourceTime}
														{isPlaying}
														rate={getLayerPlaybackRate(layer)}
														volume={getLayerEffectiveVolume(layer, visualState)}
														trackId={layer.trackId}
													/>
												{/if}
											{:else}
												<img
													src={layer.asset.src}
													alt={layer.clip.name}
													class="pointer-events-none size-full object-contain"
												/>
											{/if}
										{:else if layer.clip.sticker}
											<div
												class="flex size-full items-center justify-center text-[clamp(64px,12vw,160px)]"
												style:color={layer.clip.stickerColor ?? '#ffffff'}
											>
												{layer.clip.sticker}
											</div>
										{:else}
											<div
												class="flex size-full items-center justify-center px-6 text-center text-foreground"
												style:font-family={layer.clip.textStyle?.fontFamily}
												style:font-size={`${layer.clip.textStyle?.fontSize ?? 48}px`}
												style:font-weight={layer.clip.textStyle?.fontWeight ?? 700}
												style:color={layer.clip.textStyle?.color ?? '#ffffff'}
												style:text-align={layer.clip.textStyle?.textAlign ?? 'center'}
												style:text-transform={layer.clip.textStyle?.textTransform ?? 'none'}
											>
												<span
													class="max-w-full px-2 py-1"
													style:background-color={layer.clip.textStyle?.backgroundColor ??
														'transparent'}
												>
													{layer.clip.name}
												</span>
											</div>
										{/if}
									</div>
								</div>
								{#if selectedClipId === layer.clip.id && !layer.trackLocked}
									{#each ['left-1 top-1 cursor-nwse-resize', 'right-1 top-1 cursor-nesw-resize', 'bottom-1 left-1 cursor-nesw-resize', 'bottom-1 right-1 cursor-nwse-resize'] as handle (handle)}
										<button
											type="button"
											class={cn(
												'absolute z-10 size-3 touch-none rounded-sm border-2 border-primary bg-background shadow-sm',
												handle
											)}
											style:transform={`scale(${1 / visualTransform.scale})`}
											data-resize-handle
											onpointerdown={(event) => startVisualResize(event, layer)}
											aria-label={`Resize ${layer.clip.name}`}
										></button>
									{/each}
								{/if}
							</div>
						</div>
					{/if}
				{/snippet}

				{#each renderTree as node (node.key)}
					{@render renderNode(node)}
				{/each}

				{#each audioLayers as layer, index (`audio-${layer.trackId}-${layer.clip.sourceInstanceId ?? layer.clip.id}-${index}`)}
					{@const audioState = getClipVisualState(layer.clip, layer.clipTime)}
					{#if layer.asset && layer.asset.playbackSupported !== false}
						{#if layer.clip.reversed === true}
							<ReverseAudioLayer
								src={layer.asset.src}
								sourceTime={layer.sourceTime}
								{isPlaying}
								rate={getLayerPlaybackRate(layer)}
								volume={getLayerEffectiveVolume(layer, audioState)}
								trackId={layer.trackId}
							/>
						{:else}
							<audio
								src={layer.asset.src}
								preload="auto"
								use:syncMedia={{
									time: layer.sourceTime,
									playing: isPlaying,
									muted: previewMuted || layer.trackMuted,
									playbackRate: getLayerPlaybackRate(layer),
									syncEveryTick: false
								}}
								use:syncMediaAudio={{
									trackId: layer.trackId,
									volume: getLayerEffectiveVolume(layer, audioState)
								}}
							></audio>
						{/if}
					{/if}
				{/each}

				{#if visualLayers.length === 0 && adjustmentLayers.length === 0}
					<div
						class="flex size-full flex-col items-center justify-center gap-3 text-muted-foreground"
					>
						<div class="flex size-14 items-center justify-center rounded-xl bg-muted/20">
							<Film class="size-7 opacity-40" />
						</div>
						<span class="text-xs font-medium opacity-70">No visual clip at the playhead</span>
					</div>
				{/if}

				{#if showGuides}
					<div class="pointer-events-none absolute inset-[10%] z-50 border border-white/25"></div>
					<div class="pointer-events-none absolute inset-[5%] z-50 border border-white/15"></div>
					<div
						class="pointer-events-none absolute top-0 left-1/2 z-50 h-full w-px bg-white/15"
					></div>
					<div
						class="pointer-events-none absolute top-1/2 left-0 z-50 h-px w-full bg-white/15"
					></div>
				{/if}
				{#if snapGuideX !== null}
					<div
						class="pointer-events-none absolute top-0 bottom-0 z-[60] w-px bg-primary"
						style:left={snapGuideX === 100 ? 'calc(100% - 1px)' : `${snapGuideX}%`}
					></div>
				{/if}
				{#if snapGuideY !== null}
					<div
						class="pointer-events-none absolute right-0 left-0 z-[60] h-px bg-primary"
						style:top={snapGuideY === 100 ? 'calc(100% - 1px)' : `${snapGuideY}%`}
					></div>
				{/if}

				{#if splitViewOpen}
					<SplitViewOverlay {tracks} {mediaAssets} time={currentTime} {isPlaying} />
				{/if}
			</div>
		</div>

		{#if scopesOpen}
			<ScopesPanel
				{tracks}
				{mediaAssets}
				time={currentTime}
				{isPlaying}
				{aspectRatio}
				onClose={() => (scopesOpen = false)}
			/>
		{/if}
	</div>

	<!-- bottom transport bar -->
	<div class="relative z-20 shrink-0 border-t border-border bg-card">
		<div class="flex h-10 items-center gap-1 px-2.5">
			<!-- time display -->
			<span
				class="min-w-[110px] font-mono text-[11px] font-medium text-muted-foreground tabular-nums"
			>
				{currentTimeLabel} / {durationLabel}
			</span>

			<!-- centered playback -->
			<div class="flex flex-1 items-center justify-center gap-0.5">
				<Button
					variant="ghost"
					size="icon-sm"
					class="text-muted-foreground hover:text-foreground"
					onclick={togglePlayback}
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					{#if isPlaying}
						<Pause class="size-4" />
					{:else}
						<Play class="size-4" />
					{/if}
				</Button>
			</div>

			<!-- right controls group -->
			<div class="flex min-w-[110px] items-center justify-end gap-0.5">
				<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
					<Select.Root
						type="single"
						value={String(playbackRate)}
						onValueChange={handlePlaybackRateChange}
					>
						<Select.Trigger
							size="sm"
							class="h-6 min-w-14 border-0 bg-transparent px-1.5 text-[10px] font-medium text-muted-foreground shadow-none hover:text-foreground"
							aria-label="Playback speed"
						>
							<span>{Math.abs(playbackRate)}x</span>
						</Select.Trigger>
						<Select.Content align="end" side="top">
							{#each PLAYER_PLAYBACK_RATES as rate (rate)}
								<Select.Item value={String(rate)} label={`${rate}x`} />
							{/each}
						</Select.Content>
					</Select.Root>

					<div class="h-3.5 w-px bg-border"></div>

					<Button
						variant="ghost"
						size="icon-xs"
						class={cn(
							'text-muted-foreground transition-all',
							loopEnabled && 'bg-secondary text-foreground shadow-sm'
						)}
						onclick={toggleLoop}
						aria-label="Toggle loop playback"
					>
						<Repeat2 class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground hover:text-foreground"
						onclick={togglePreviewMute}
						aria-label={previewMuted ? 'Unmute preview' : 'Mute preview'}
					>
						{#if previewMuted}
							<VolumeX class="size-4" />
						{:else}
							<Volume2 class="size-4" />
						{/if}
					</Button>
					<input
						type="range"
						min="0"
						max="1"
						step="0.05"
						bind:value={previewVolume}
						aria-label="Preview volume"
						class="hidden h-1 w-14 cursor-pointer accent-primary lg:block"
					/>
				</div>

				<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground hover:text-foreground"
						onclick={zoomOut}
						aria-label="Zoom out preview"
					>
						<Minus class="size-4" />
					</Button>
					<button
						class="min-w-8 rounded-sm px-1 text-center text-[10px] font-medium text-muted-foreground tabular-nums transition-colors hover:text-foreground"
						onclick={fitPreview}
						title="Fit preview"
					>
						{previewZoom}%
					</button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground hover:text-foreground"
						onclick={zoomIn}
						aria-label="Zoom in preview"
					>
						<Plus class="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="text-muted-foreground hover:text-foreground"
						onclick={fitPreview}
						aria-label="Fit preview"
					>
						<Expand class="size-4" />
					</Button>
				</div>
			</div>
		</div>
	</div>
</section>
