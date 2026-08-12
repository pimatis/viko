let sharedDecodeContext: AudioContext | null = null;
const decodeCache = new Map<string, Promise<AudioBuffer>>();

function getDecodeContext(): AudioContext {
	if (!sharedDecodeContext) {
		sharedDecodeContext = new AudioContext();
	}
	return sharedDecodeContext;
}

// decode an audio asset once per source url and reuse the promise for every clip
export function decodeAudioBuffer(src: string): Promise<AudioBuffer> {
	let pending = decodeCache.get(src);
	if (!pending) {
		pending = (async () => {
			const response = await fetch(src);
			if (!response.ok) throw new Error('waveform fetch failed');
			const arrayBuffer = await response.arrayBuffer();
			return getDecodeContext().decodeAudioData(arrayBuffer);
		})();
		pending.catch(() => decodeCache.delete(src));
		decodeCache.set(src, pending);
	}
	return pending;
}

// per-pixel min/max peaks; channels are collapsed by scanning every channel so
// loud content on any channel is visible. the result interleaves [min, max]
export function computeWaveformPeaks(buffer: AudioBuffer, samplesPerPixel: number): Float32Array {
	const safeSamplesPerPixel = Math.max(1, samplesPerPixel);
	const sampleCount = buffer.length;
	const pixelCount = Math.max(1, Math.ceil(sampleCount / safeSamplesPerPixel));
	const peaks = new Float32Array(pixelCount * 2);
	const channelCount = buffer.numberOfChannels;

	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const start = Math.floor(pixel * safeSamplesPerPixel);
		const end = Math.min(sampleCount, start + safeSamplesPerPixel);
		let min = 0;
		let max = 0;
		for (let channel = 0; channel < channelCount; channel += 1) {
			const data = buffer.getChannelData(channel);
			for (let index = start; index < end; index += 1) {
				const sample = data[index];
				if (sample < min) min = sample;
				if (sample > max) max = sample;
			}
		}
		peaks[pixel * 2] = min;
		peaks[pixel * 2 + 1] = max;
	}

	return peaks;
}

// draw the interleaved peaks as a vertical centered bar chart
// volume scales the amplitude so quieter clips draw shorter bars
export function renderWaveform(
	context: CanvasRenderingContext2D,
	peaks: Float32Array,
	width: number,
	height: number,
	color: string,
	volume = 1
): void {
	context.clearRect(0, 0, width, height);
	context.fillStyle = color;
	const safeVolume = Math.min(1, Math.max(0, volume));
	const center = height / 2;
	if (safeVolume <= 0) return;
	const pixelCount = Math.min(width, peaks.length / 2);

	context.save();
	context.translate(0, center);
	context.scale(1, safeVolume);
	context.translate(0, -center);

	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const min = peaks[pixel * 2];
		const max = peaks[pixel * 2 + 1];
		const top = center - max * center;
		const bottom = center - min * center;
		const barHeight = Math.max(1, bottom - top);
		context.fillRect(pixel, top, 1, barHeight);
	}

	context.restore();
}
