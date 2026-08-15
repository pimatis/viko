import { getClipSourceOffset, type Clip } from '$lib/editor/timeline';
import type { MediaAsset } from '$lib/editor/sidebar';
import { decodeAudioAssets, type LoadedAudioClip } from '$lib/export/audio';

// normalization target: clip RMS is scaled to -18 dBFS. a common "safe loud"
// level for social media masters; boost is capped so quiet sources cannot be
// over-amplified into distortion
export const NORMALIZE_TARGET_DB = -18;
export const MAX_CLIP_VOLUME = 4;
const MIN_CLIP_VOLUME = 0.1;

export type ClipLoudness = {
	rms: number;
	rmsDb: number;
};

// RMS of the source window the clip actually plays: [sourceStart,
// sourceStart + consumed source duration]. Reversed clips play the same
// window backward, so the loudness measurement is direction-independent.
export async function analyzeClipLoudness(
	clip: Clip,
	asset: MediaAsset
): Promise<ClipLoudness | null> {
	if (!clip.assetId || (asset.kind !== 'audio' && asset.kind !== 'video')) return null;
	const loaded: LoadedAudioClip = {
		clip,
		trackId: 'normalize',
		startTime: clip.startTime,
		duration: clip.duration,
		sourceStart: clip.sourceStart ?? 0,
		speed: clip.speed ?? 1,
		reversed: clip.reversed === true,
		assetId: clip.assetId,
		assetSrc: asset.src,
		trackVolume: 1,
		trackPan: 0
	};
	const { buffers } = await decodeAudioAssets([loaded]);
	const buffer = buffers.get(clip.assetId);
	if (!buffer || buffer.length === 0) return null;

	const sampleRate = buffer.sampleRate;
	const sourceStart = clip.sourceStart ?? 0;
	const windowDuration = getClipSourceOffset(clip, clip.duration);
	const startSample = Math.max(0, Math.floor(sourceStart * sampleRate));
	const endSample = Math.min(buffer.length, Math.ceil((sourceStart + windowDuration) * sampleRate));
	if (endSample <= startSample) return null;

	let sumSquares = 0;
	const channelCount = buffer.numberOfChannels;
	for (let channel = 0; channel < channelCount; channel += 1) {
		const data = buffer.getChannelData(channel);
		for (let index = startSample; index < endSample; index += 1) {
			const sample = data[index];
			sumSquares += sample * sample;
		}
	}
	const rms = Math.sqrt(sumSquares / ((endSample - startSample) * channelCount));
	if (!Number.isFinite(rms) || rms <= 0) return null;
	return { rms, rmsDb: 20 * Math.log10(rms) };
}

// scale the clip volume so its measured RMS lands on the target loudness
export function normalizedVolumeForRms(rms: number, targetDb = NORMALIZE_TARGET_DB): number {
	if (!Number.isFinite(rms) || rms <= 0) return 1;
	const targetLinear = Math.pow(10, targetDb / 20);
	const gain = targetLinear / rms;
	return Math.min(MAX_CLIP_VOLUME, Math.max(MIN_CLIP_VOLUME, gain));
}

// one-shot helper: decode, measure, and return the volume to write on the clip
export async function normalizeClipAudio(clip: Clip, asset: MediaAsset): Promise<number | null> {
	const loudness = await analyzeClipLoudness(clip, asset);
	if (!loudness) return null;
	return normalizedVolumeForRms(loudness.rms);
}
