<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { syncMedia, syncMediaVolume } from '$lib/editor/mediaSync';
	import {
		applyChromaKey,
		createChromaKeyGL,
		destroyChromaKeyGL,
		drawChromaKeyFrame,
		type ChromaKeyGL
	} from '$lib/chroma';
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
		config: ChromaKeyState;
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
		config
	}: Props = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let image = $state<HTMLImageElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let glState: ChromaKeyGL | null = null;
	let canvasContext: CanvasRenderingContext2D | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let frameCallbackId: number | null = null;
	let rafId: number | null = null;

	function drawCanvas2DFrame(
		context: CanvasRenderingContext2D,
		source: HTMLVideoElement | HTMLImageElement,
		canvasWidth: number,
		canvasHeight: number,
		state: ChromaKeyState
	) {
		const sourceWidth =
			source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
		const sourceHeight =
			source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
		if (sourceWidth <= 0 || sourceHeight <= 0) return;
		context.clearRect(0, 0, canvasWidth, canvasHeight);
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
		context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
		const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
		applyChromaKey(imageData, state);
		context.putImageData(imageData, 0, 0);
	}

	function resizeCanvas() {
		if (!canvasElement) return;
		const width = canvasElement.clientWidth;
		const height = canvasElement.clientHeight;
		if (width <= 0 || height <= 0) return;
		if (canvasElement.width !== width) canvasElement.width = width;
		if (canvasElement.height !== height) canvasElement.height = height;
	}

	function drawFrame() {
		if (!canvasElement) return;
		const source = mediaKind === 'video' ? video : image;
		if (!source) return;
		const ready = mediaKind === 'video' ? (video?.readyState ?? 0) >= 2 : Boolean(image?.complete);
		if (!ready) return;
		const canvasWidth = canvasElement.clientWidth;
		const canvasHeight = canvasElement.clientHeight;
		if (canvasWidth <= 0 || canvasHeight <= 0) return;
		resizeCanvas();
		if (glState) {
			drawChromaKeyFrame(glState, source, config);
			return;
		}
		if (!canvasContext) return;
		drawCanvas2DFrame(canvasContext, source, canvasWidth, canvasHeight, config);
	}

	function scheduleNextVideoFrame() {
		if (!video) return;
		if (typeof video.requestVideoFrameCallback === 'function') {
			frameCallbackId = video.requestVideoFrameCallback(() => {
				frameCallbackId = null;
				drawFrame();
				if (isPlaying) scheduleNextVideoFrame();
			});
			return;
		}
		if (rafId !== null) return;
		const renderLoop = () => {
			rafId = null;
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
		glState = createChromaKeyGL(canvasElement);
		if (!glState) {
			canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
		}
		resizeObserver = new ResizeObserver(() => {
			drawFrame();
		});
		resizeObserver.observe(canvasElement);
		resizeCanvas();
		drawFrame();
	});

	onDestroy(() => {
		if (glState) destroyChromaKeyGL(glState);
		glState = null;
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
