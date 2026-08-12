<script lang="ts">
	import { computeWaveformPeaks, decodeAudioBuffer, renderWaveform } from '$lib/audio/waveform';

	type Props = {
		src: string;
		pixelsPerSecond: number;
		volume?: number;
		color?: string;
		background?: string;
	};

	let {
		src,
		pixelsPerSecond,
		volume = 1,
		color = 'rgba(255,255,255,0.42)',
		background = 'rgba(0,0,0,0.22)'
	}: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let decoded = $state<AudioBuffer | null>(null);

	function draw() {
		if (!canvas || !decoded) return;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (width <= 0 || height <= 0) return;
		const dpr = Math.min(2, window.devicePixelRatio || 1);
		const targetWidth = Math.round(width * dpr);
		const targetHeight = Math.round(height * dpr);
		if (canvas.width !== targetWidth) canvas.width = targetWidth;
		if (canvas.height !== targetHeight) canvas.height = targetHeight;
		const context = canvas.getContext('2d');
		if (!context) return;
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		context.clearRect(0, 0, width, height);
		context.fillStyle = background;
		context.fillRect(0, 0, width, height);
		const samplesPerPixel = decoded.sampleRate / Math.max(1, pixelsPerSecond);
		const peaks = computeWaveformPeaks(decoded, samplesPerPixel);
		renderWaveform(context, peaks, width, height, color, volume);
	}

	$effect(() => {
		const currentSrc = src;
		decoded = null;
		let cancelled = false;
		decodeAudioBuffer(currentSrc)
			.then((buffer) => {
				if (cancelled) return;
				decoded = buffer;
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!decoded || !canvas) return;
		draw();
	});
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
	<canvas bind:this={canvas} class="size-full"></canvas>
</div>
