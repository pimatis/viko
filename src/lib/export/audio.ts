import {
	getClipVisualState,
	type Clip,
	type Track,
	type TrackAudioEffects
} from '$lib/editor/timeline';
import type { MediaAsset } from '$lib/editor/sidebar';
import { getClipPairTransitionProgress } from '$lib/effects';
import {
	getDuckAmountDb,
	getDuckingFactorAtTime,
	isDuckSource,
	type DuckSource
} from '$lib/audio/ducking';
import { createReverbImpulse } from '$lib/audio/engine';
import { isNeutralTrackEffects } from '$lib/editor/timeline';

const EXPORT_SAMPLE_RATE = 48000;
const EXPORT_CHANNELS = 2;
const VOLUME_CURVE_RATE = 50;

export type LoadedAudioClip = {
	clip: Clip;
	trackId: string;
	startTime: number;
	duration: number;
	sourceStart: number;
	speed: number;
	reversed: boolean;
	assetId: string;
	assetSrc: string;
	// track-level mix (Audio Mixer panel) applied during the offline mixdown
	trackVolume: number;
	trackPan: number;
	trackEffects?: TrackAudioEffects;
};

export function collectAudioClips(tracks: Track[], mediaAssets: MediaAsset[]): LoadedAudioClip[] {
	const clips: LoadedAudioClip[] = [];
	const assetsById = new Map(mediaAssets.map((asset) => [asset.id, asset]));

	// linked A/V pairs route audio through the audio-track clip; skip the video
	// clip's own element so the pair does not get mixed twice
	const audioInstanceIds = new Set<string>();
	for (const track of tracks) {
		if (track.type !== 'audio') continue;
		for (const clip of track.clips) {
			if (clip.sourceInstanceId) audioInstanceIds.add(clip.sourceInstanceId);
		}
	}

	for (const track of tracks) {
		if (track.muted) continue;
		for (const clip of track.clips) {
			if (!clip.assetId) continue;
			const asset = assetsById.get(clip.assetId);
			if (!asset) continue;
			if (asset.kind !== 'video' && asset.kind !== 'audio') continue;
			if (asset.playbackSupported === false) continue;
			if (
				track.type !== 'audio' &&
				clip.sourceInstanceId &&
				audioInstanceIds.has(clip.sourceInstanceId)
			)
				continue;
			clips.push({
				clip,
				trackId: track.id,
				startTime: clip.startTime,
				duration: clip.duration,
				sourceStart: clip.sourceStart ?? 0,
				speed: clip.speed ?? 1,
				reversed: clip.reversed === true,
				assetId: clip.assetId,
				assetSrc: asset.src,
				trackVolume: track.volume ?? 1,
				trackPan: track.pan ?? 0,
				trackEffects: track.effects
			});
		}
	}

	return clips;
}

export async function decodeAudioAssets(
	clips: LoadedAudioClip[]
): Promise<{ buffers: Map<string, AudioBuffer>; sampleRate: number }> {
	const buffers = new Map<string, AudioBuffer>();
	const uniqueAssets = new Map<string, string>();
	for (const clip of clips) {
		if (!uniqueAssets.has(clip.assetId)) {
			uniqueAssets.set(clip.assetId, clip.assetSrc);
		}
	}

	let decodeContext: AudioContext;
	try {
		decodeContext = new AudioContext({ sampleRate: EXPORT_SAMPLE_RATE });
	} catch {
		decodeContext = new AudioContext();
	}
	const sampleRate = decodeContext.sampleRate;

	const decodePromises = [...uniqueAssets.entries()].map(async ([assetId, src]) => {
		try {
			const response = await fetch(src);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = await decodeContext.decodeAudioData(arrayBuffer);
			return [assetId, buffer] as const;
		} catch {
			return null;
		}
	});

	const results = await Promise.all(decodePromises);
	await decodeContext.close();

	for (const result of results) {
		if (result) buffers.set(result[0], result[1]);
	}

	return { buffers, sampleRate };
}

// mirrors Player.svelte getLayerVolume - keyframe-interpolated volume with fade envelopes
function computeEffectiveVolume(clip: Clip, clipTime: number): number {
	const state = getClipVisualState(clip, clipTime);
	let fadeFactor = 1;
	if (state.audioFadeIn > 0 && clipTime < state.audioFadeIn) {
		fadeFactor = Math.max(0, clipTime / state.audioFadeIn);
	}
	const timeUntilEnd = clip.duration - clipTime;
	if (state.audioFadeOut > 0 && timeUntilEnd < state.audioFadeOut) {
		fadeFactor = Math.min(fadeFactor, Math.max(0, timeUntilEnd / state.audioFadeOut));
	}
	return Math.min(4, Math.max(0, state.volume * fadeFactor));
}

function computeVolumeCurve(
	clip: Clip,
	clipLocalStart: number,
	clipLocalEnd: number,
	getTransitionVolume: (clip: Clip, clipTime: number) => number,
	duckSources: DuckSource[]
): Float32Array {
	const visibleDuration = clipLocalEnd - clipLocalStart;
	const sampleCount = Math.max(2, Math.ceil(visibleDuration * VOLUME_CURVE_RATE));
	const curve = new Float32Array(sampleCount);
	const isDuck = isDuckSource(clip);

	for (let i = 0; i < sampleCount; i++) {
		const t = clipLocalStart + (i / (sampleCount - 1)) * visibleDuration;
		const duckFactor = getDuckingFactorAtTime(duckSources, isDuck, clip.startTime + t);
		curve[i] = computeEffectiveVolume(clip, t) * getTransitionVolume(clip, t) * duckFactor;
	}

	return curve;
}

// reversed clips play the decoded buffer backwards: build a mirrored copy of the
// source samples so the mix can always play forward
function reverseAudioBuffer(buffer: AudioBuffer): AudioBuffer {
	const reversed = new AudioBuffer({
		length: buffer.length,
		sampleRate: buffer.sampleRate,
		numberOfChannels: buffer.numberOfChannels
	});
	for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
		const source = buffer.getChannelData(channel);
		const target = reversed.getChannelData(channel);
		for (let index = 0; index < source.length; index += 1) {
			target[index] = source[source.length - 1 - index];
		}
	}
	return reversed;
}

// mirrors the live engine's per-track chain (EQ -> compressor -> reverb send)
// inside the offline context so exported audio matches the preview
type OfflineFxChain = { input: BiquadFilterNode; output: AudioNode };

function buildTrackFxChain(
	ctx: BaseAudioContext,
	effects: TrackAudioEffects | undefined,
	impulses: Map<BaseAudioContext, AudioBuffer>
): OfflineFxChain | null {
	if (isNeutralTrackEffects(effects) || !effects) return null;
	let impulse = impulses.get(ctx);
	if (!impulse) {
		impulse = createReverbImpulse(ctx);
		impulses.set(ctx, impulse);
	}

	const low = ctx.createBiquadFilter();
	low.type = 'lowshelf';
	low.frequency.value = 200;
	low.gain.value = effects.eqLow;
	const mid = ctx.createBiquadFilter();
	mid.type = 'peaking';
	mid.frequency.value = 1200;
	mid.Q.value = 0.9;
	mid.gain.value = effects.eqMid;
	const high = ctx.createBiquadFilter();
	high.type = 'highshelf';
	high.frequency.value = 4500;
	high.gain.value = effects.eqHigh;
	const compressor = ctx.createDynamicsCompressor();
	compressor.threshold.value = effects.compressorThreshold;
	compressor.knee.value = 6;
	compressor.ratio.value = effects.compressorRatio;
	compressor.attack.value = 0.003;
	compressor.release.value = 0.25;

	low.connect(mid).connect(high).connect(compressor);

	const output = ctx.createGain();
	compressor.connect(output);
	if (effects.reverbAmount > 0) {
		const convolver = ctx.createConvolver();
		convolver.buffer = impulse;
		const wet = ctx.createGain();
		wet.gain.value = (effects.reverbAmount / 100) * 0.7;
		compressor.connect(convolver).connect(wet).connect(output);
	}
	return { input: low, output };
}

export async function mixAudioOffline(
	clips: LoadedAudioClip[],
	decodedBuffers: Map<string, AudioBuffer>,
	sampleRate: number,
	exportStart: number,
	exportDuration: number
): Promise<AudioBuffer | null> {
	if (clips.length === 0) return null;

	const totalSamples = Math.ceil(exportDuration * sampleRate);
	const ctx = new OfflineAudioContext(EXPORT_CHANNELS, totalSamples, sampleRate);
	const clipsById = new Map(clips.map((loadedClip) => [loadedClip.clip.id, loadedClip.clip]));
	const duckSources = clips
		.filter((loadedClip) => isDuckSource(loadedClip.clip))
		.map((loadedClip) => ({
			startTime: loadedClip.startTime,
			duration: loadedClip.duration,
			amountDb: getDuckAmountDb(loadedClip.clip)
		}));
	const incomingTransitions = new Map<string, Clip>();
	for (const loadedClip of clips) {
		const incomingClipId = loadedClip.clip.clipTransition?.incomingClipId;
		if (incomingClipId) incomingTransitions.set(incomingClipId, loadedClip.clip);
	}
	const fxImpulses = new Map<BaseAudioContext, AudioBuffer>();
	const getTransitionVolume = (clip: Clip, clipTime: number): number => {
		const incoming = clip.clipTransition
			? clipsById.get(clip.clipTransition.incomingClipId)
			: undefined;
		if (incoming) {
			const progress = getClipPairTransitionProgress(clip, incoming, clip.startTime + clipTime);
			if (progress !== null) return 1 - progress;
		}
		const outgoing = incomingTransitions.get(clip.id);
		if (!outgoing) return 1;
		const progress = getClipPairTransitionProgress(outgoing, clip, clip.startTime + clipTime);
		return progress ?? 1;
	};

	for (const loadedClip of clips) {
		const buffer = decodedBuffers.get(loadedClip.assetId);
		if (!buffer) continue;

		const clipStart = loadedClip.startTime;
		const exportEnd = exportStart + exportDuration;

		const clipLocalStart = Math.max(0, exportStart - clipStart);
		const clipLocalEnd = Math.min(loadedClip.duration, exportEnd - clipStart);
		const visibleDuration = clipLocalEnd - clipLocalStart;
		if (visibleDuration <= 0) continue;

		const exportOffset = Math.max(0, clipStart - exportStart);
		// reversed clips consume their source window from the end, so the playhead
		// maps to a mirrored source offset inside a mirrored buffer
		const sourceBuffer = loadedClip.reversed ? reverseAudioBuffer(buffer) : buffer;
		const sourceEnd = loadedClip.sourceStart + loadedClip.duration * loadedClip.speed;
		const sourceOffset = loadedClip.reversed
			? Math.max(0, sourceBuffer.length / sourceBuffer.sampleRate - sourceEnd) +
				clipLocalStart * loadedClip.speed
			: loadedClip.sourceStart + clipLocalStart * loadedClip.speed;

		const source = ctx.createBufferSource();
		source.buffer = sourceBuffer;
		source.playbackRate.value = loadedClip.speed;

		const gain = ctx.createGain();
		const volumeCurve = computeVolumeCurve(
			loadedClip.clip,
			clipLocalStart,
			clipLocalEnd,
			getTransitionVolume,
			duckSources
		);
		gain.gain.setValueCurveAtTime(volumeCurve, exportOffset, visibleDuration);

		// track-level mix from the Audio Mixer panel: fixed gain + stereo balance.
		// StereoPannerNode applies the same equal-power law as the live engine, so
		// preview and export stay in sync (mono clips pan fully, stereo clips
		// behave as a balance control).
		const trackGain = ctx.createGain();
		trackGain.gain.value = Math.min(2, Math.max(0, loadedClip.trackVolume));
		const panner = ctx.createStereoPanner();
		panner.pan.value = Math.min(1, Math.max(-1, loadedClip.trackPan));

		const fxChain = buildTrackFxChain(ctx, loadedClip.trackEffects, fxImpulses);
		if (fxChain) {
			trackGain.connect(fxChain.input);
			fxChain.output.connect(panner);
		} else {
			trackGain.connect(panner);
		}
		panner.connect(ctx.destination);
		source.connect(gain).connect(trackGain);
		source.start(exportOffset, sourceOffset, visibleDuration * loadedClip.speed);
	}

	return ctx.startRendering().then((buffer) => buffer);
}

export function encodeAudioBufferToWav(buffer: AudioBuffer): Blob {
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const numFrames = buffer.length;
	const bytesPerSample = 2;
	const blockAlign = numChannels * bytesPerSample;
	const dataSize = numFrames * blockAlign;
	const arrayBuffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(arrayBuffer);

	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true);
	writeString(view, 8, 'WAVE');
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 16, true);
	writeString(view, 36, 'data');
	view.setUint32(40, dataSize, true);

	const channels: Float32Array[] = [];
	for (let c = 0; c < numChannels; c++) {
		channels.push(buffer.getChannelData(c));
	}

	let offset = 44;
	for (let i = 0; i < numFrames; i++) {
		for (let c = 0; c < numChannels; c++) {
			const sample = Math.max(-1, Math.min(1, channels[c][i]));
			view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			offset += 2;
		}
	}

	return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
