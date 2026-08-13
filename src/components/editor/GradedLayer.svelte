<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { syncMedia, syncMediaVolume } from '$lib/editor/mediaSync';
	import { applyColorGrade, type ColorGrade } from '$lib/grading';
	import { applyChromaKey } from '$lib/chroma';
	import type { ChromaKeyState } from '$lib/editor/timeline';

	type Props = {
		src: string;
		mediaKind: 'video' | 'image';
		sourceTime?: number;
		isPlaying?: boolean;
		muted?: boolean;
		syncEveryTick?: boolean;
		reversed?: boolean;
		playbackRate?: number;
		volume?: number;
		grade: ColorGrade;
		chromaConfig?: ChromaKeyState | null;
	};

	let {
		src,
		mediaKind,
		sourceTime = 0,
		isPlaying = false,
		muted = false,
		syncEveryTick = false,
		reversed = false,
		playbackRate = 1,
		volume = 1,
		grade,
		chromaConfig = null
	}: Props = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let image = $state<HTMLImageElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let canvasContext: CanvasRenderingContext2D | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let frameCallbackId: number | null = null;
	let rafId: number | null = null;
	// per-pixel grading is CPU-bound; during playback redraw at most ~15 fps so the
	// rest of the preview stays responsive. seeks still redraw immediately.
	let lastDrawTime = 0;
	const PLAYBACK_DRAW_INTERVAL_MS = 66;

	// keep per-pixel grading responsive: cap the analysis resolution
	const MAX_CANVAS_EDGE = 1280;

	function getDrawScale(clientWidth: number, clientHeight: number): number {
		const longestEdge = Math.max(clientWidth, clientHeight);
		if (longestEdge <= 0) return 1;
		return Math.min(1, MAX_CANVAS_EDGE / longestEdge);
	}

	function drawFrame() {
		if (!canvasElement) return;
		const source = mediaKind === 'video' ? video : image;
		if (!source) return;
		const ready = mediaKind === 'video' ? (video?.readyState ?? 0) >= 2 : Boolean(image?.complete);
		if (!ready) return;
		const clientWidth = canvasElement.clientWidth;
		const clientHeight = canvasElement.clientHeight;
		if (clientWidth <= 0 || clientHeight <= 0) return;
		const scale = getDrawScale(clientWidth, clientHeight);
		const canvasWidth = Math.max(2, Math.round(clientWidth * scale));
		const canvasHeight = Math.max(2, Math.round(clientHeight * scale));
		if (canvasElement.width !== canvasWidth) canvasElement.width = canvasWidth;
		if (canvasElement.height !== canvasHeight) canvasElement.height = canvasHeight;
		if (!canvasContext) return;

		const sourceWidth =
			source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
		const sourceHeight =
			source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
		if (sourceWidth <= 0 || sourceHeight <= 0) return;
		canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
		const canvasAspect = canvasWidth / canvasHeight;
		const sourceAspect = sourceWidth / sourceHeight;
		let drawWidth: number;
		let drawHeight: number;
		let drawX = 0;
		let drawY = 0;
		if (sourceAspect > canvasAspect) {
			drawWidth = canvasWidth;
			drawHeight = canvasWidth / sourceAspect;
			drawY = (canvasHeight - drawHeight) / 2;
		} else {
			drawHeight = canvasHeight;
			drawWidth = canvasHeight * sourceAspect;
			drawX = (canvasWidth - drawWidth) / 2;
		}
		canvasContext.drawImage(source, drawX, drawY, drawWidth, drawHeight);
		const imageData = canvasContext.getImageData(0, 0, canvasWidth, canvasHeight);
		if (chromaConfig) {
			applyChromaKey(imageData, chromaConfig);
		}
		applyColorGrade(imageData, grade);
		canvasContext.putImageData(imageData, 0, 0);
		lastDrawTime = Date.now();
	}

	function scheduleNextVideoFrame() {
		if (!video) return;
		if (typeof video.requestVideoFrameCallback === 'function') {
			frameCallbackId = video.requestVideoFrameCallback(() => {
				frameCallbackId = null;
				if (isPlaying && Date.now() - lastDrawTime < PLAYBACK_DRAW_INTERVAL_MS) {
					if (isPlaying) scheduleNextVideoFrame();
					return;
				}
				drawFrame();
				if (isPlaying) scheduleNextVideoFrame();
			});
			return;
		}
		if (rafId !== null) return;
		const renderLoop = () => {
			rafId = null;
			if (isPlaying && Date.now() - lastDrawTime < PLAYBACK_DRAW_INTERVAL_MS) {
				if (isPlaying) rafId = requestAnimationFrame(renderLoop);
				return;
			}
			drawFrame();
			if (isPlaying) rafId = requestAnimationFrame(renderLoop);
		};
		rafId = requestAnimationFrame(renderLoop);
	}

	$effect(() => {
		if (!isPlaying) {
			if (rafId !== null) {
				cancelAnimationFrame(rafId);
				rafId = null;
			}
			drawFrame();
			return;
		}
		scheduleNextVideoFrame();
	});

	$effect(() => {
		if (mediaKind !== 'video' || !video) return;
		const element = video;
		const handleSeeked = () => drawFrame();
		const handleLoadedData = () => drawFrame();
		element.addEventListener('seeked', handleSeeked);
		element.addEventListener('loadeddata', handleLoadedData);
		return () => {
			element.removeEventListener('seeked', handleSeeked);
			element.removeEventListener('loadeddata', handleLoadedData);
		};
	});

	$effect(() => {
		drawFrame();
	});

	onMount(() => {
		if (!canvasElement) return;
		canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
		resizeObserver = new ResizeObserver(() => {
			drawFrame();
		});
		resizeObserver.observe(canvasElement);
		drawFrame();
	});

	onDestroy(() => {
		canvasContext = null;
		resizeObserver?.disconnect();
		resizeObserver = null;
		if (rafId !== null) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		if (frameCallbackId !== null && video && typeof video.cancelVideoFrameCallback === 'function') {
			video.cancelVideoFrameCallback(frameCallbackId);
			frameCallbackId = null;
		}
	});
</script>

{#if mediaKind === 'video'}
	<video
		bind:this={video}
		{src}
		playsinline
		preload="auto"
		class="pointer-events-none absolute size-full opacity-0"
		use:syncMedia={{
			time: sourceTime,
			playing: isPlaying,
			muted,
			playbackRate,
			syncEveryTick,
			reversed
		}}
		use:syncMediaVolume={volume}
	>
		<track kind="captions" />
	</video>
{:else}
	<img
		bind:this={image}
		{src}
		alt=""
		class="pointer-events-none absolute size-full opacity-0"
		onload={drawFrame}
	/>
{/if}
<canvas bind:this={canvasElement} class="absolute inset-0 size-full"></canvas>
