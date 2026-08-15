// Shared WebAudio mixing engine for preview playback.
//
// Every media element that carries audio is registered against a track bus:
//   element -> clipGain -> trackGain -> trackPanner -> masterGain -> destination
//   (trackPanner also taps into L/R analysers for the mixer VU meters)
// Track volume/pan/mute are applied live while the timeline plays, so the
// Audio Mixer panel is reflected in the preview exactly like the offline
// export mix. The context is created lazily and resumed on the first audio
// interaction, which keeps autoplay policies happy.

export type AudioLevels = {
	left: number;
	right: number;
};

export const TRACK_VOLUME_MAX = 2;
export const MASTER_VOLUME_MAX = 2;

const LEVEL_FLOOR_DB = -60;
const ANALYSER_FFT_SIZE = 2048;
const SMOOTHING = 0.15;

type TrackBus = {
	gain: GainNode;
	panner: StereoPannerNode;
	analysers: [AnalyserNode, AnalyserNode];
	volume: number;
	pan: number;
};

type ElementBus = {
	source: MediaElementAudioSourceNode;
	clipGain: GainNode;
	trackId: string;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function measureLevel(analyser: AnalyserNode): number {
	const data = new Float32Array(analyser.fftSize);
	analyser.getFloatTimeDomainData(data);
	let sum = 0;
	for (let i = 0; i < data.length; i += 1) {
		sum += data[i] * data[i];
	}
	const rms = Math.sqrt(sum / data.length);
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	return clamp((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB, 0, 1);
}

class AudioEngine {
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private masterAnalysers: [AnalyserNode, AnalyserNode] | null = null;
	private masterVolume = 1;
	private tracks = new Map<string, TrackBus>();
	private elements = new WeakMap<HTMLMediaElement, ElementBus>();

	private ensureGraph(): void {
		if (this.ctx) return;
		this.ctx = new AudioContext();
		this.masterGain = this.ctx.createGain();
		this.masterGain.gain.value = this.masterVolume;
		this.masterGain.connect(this.ctx.destination);
		const splitter = this.ctx.createChannelSplitter(2);
		const left = this.ctx.createAnalyser();
		const right = this.ctx.createAnalyser();
		left.fftSize = ANALYSER_FFT_SIZE;
		right.fftSize = ANALYSER_FFT_SIZE;
		left.smoothingTimeConstant = SMOOTHING;
		right.smoothingTimeConstant = SMOOTHING;
		this.masterGain.connect(splitter);
		splitter.connect(left, 0);
		splitter.connect(right, 1);
		this.masterAnalysers = [left, right];
	}

	private resumeIfNeeded(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		if (ctx.state === 'suspended') {
			void ctx.resume().catch(() => {});
		}
	}

	private getTrackBus(trackId: string): TrackBus {
		this.ensureGraph();
		const existing = this.tracks.get(trackId);
		if (existing) return existing;
		const ctx = this.ctx as AudioContext;
		const gain = ctx.createGain();
		gain.gain.value = 1;
		const panner = ctx.createStereoPanner();
		panner.pan.value = 0;
		const splitter = ctx.createChannelSplitter(2);
		const left = ctx.createAnalyser();
		const right = ctx.createAnalyser();
		left.fftSize = ANALYSER_FFT_SIZE;
		right.fftSize = ANALYSER_FFT_SIZE;
		left.smoothingTimeConstant = SMOOTHING;
		right.smoothingTimeConstant = SMOOTHING;
		gain.connect(panner);
		panner.connect(this.masterGain as GainNode);
		panner.connect(splitter);
		splitter.connect(left, 0);
		splitter.connect(right, 1);
		const bus: TrackBus = { gain, panner, analysers: [left, right], volume: 1, pan: 0 };
		this.tracks.set(trackId, bus);
		return bus;
	}

	registerElement(element: HTMLMediaElement, trackId: string): void {
		if (this.elements.has(element)) return;
		this.ensureGraph();
		const ctx = this.ctx as AudioContext;
		const source = ctx.createMediaElementSource(element);
		const clipGain = ctx.createGain();
		clipGain.gain.value = 1;
		source.connect(clipGain);
		clipGain.connect(this.getTrackBus(trackId).gain);
		this.elements.set(element, { source, clipGain, trackId });
	}

	unregisterElement(element: HTMLMediaElement): void {
		const bus = this.elements.get(element);
		if (!bus) return;
		try {
			bus.source.disconnect();
			bus.clipGain.disconnect();
		} catch {
			// element already gone
		}
		this.elements.delete(element);
	}

	// make sure the graph is processing before any audible element update. The
	// context is created lazily (often suspended under autoplay policy), so the
	// first Play press must be able to resume it — resume() only succeeds within
	// a user-activation window, which the Play click provides.
	resume(): void {
		this.resumeIfNeeded();
	}

	setElementVolume(element: HTMLMediaElement, volume: number): void {
		const bus = this.elements.get(element);
		if (!bus) return;
		const safe = clamp(Number.isFinite(volume) ? volume : 1, 0, 4);
		this.resumeIfNeeded();
		if (Math.abs(bus.clipGain.gain.value - safe) < 0.0001) return;
		bus.clipGain.gain.setTargetAtTime(safe, bus.clipGain.context.currentTime, 0.012);
	}

	setTrackVolume(trackId: string, volume: number): void {
		const bus = this.getTrackBus(trackId);
		const safe = clamp(Number.isFinite(volume) ? volume : 1, 0, TRACK_VOLUME_MAX);
		if (Math.abs(bus.volume - safe) < 0.0001) return;
		bus.volume = safe;
		this.resumeIfNeeded();
		bus.gain.gain.setTargetAtTime(safe, bus.gain.context.currentTime, 0.012);
	}

	setTrackPan(trackId: string, pan: number): void {
		const bus = this.getTrackBus(trackId);
		const safe = clamp(Number.isFinite(pan) ? pan : 0, -1, 1);
		if (Math.abs(bus.pan - safe) < 0.0001) return;
		bus.pan = safe;
		this.resumeIfNeeded();
		bus.panner.pan.setTargetAtTime(safe, bus.panner.context.currentTime, 0.012);
	}

	setMasterVolume(volume: number): void {
		this.ensureGraph();
		const safe = clamp(Number.isFinite(volume) ? volume : 1, 0, MASTER_VOLUME_MAX);
		if (Math.abs(this.masterVolume - safe) < 0.0001) return;
		this.masterVolume = safe;
		this.resumeIfNeeded();
		const ctx = this.ctx as AudioContext;
		(this.masterGain as GainNode).gain.setTargetAtTime(safe, ctx.currentTime, 0.012);
	}

	// external audio nodes (e.g. reversed-clip buffer playback) feed a track bus
	// so track volume/pan apply to them too
	getTrackInput(trackId: string): GainNode {
		this.resumeIfNeeded();
		return this.getTrackBus(trackId).gain;
	}

	getTrackLevels(trackId: string): AudioLevels | null {
		const bus = this.tracks.get(trackId);
		if (!bus) return null;
		return { left: measureLevel(bus.analysers[0]), right: measureLevel(bus.analysers[1]) };
	}

	getMasterLevels(): AudioLevels | null {
		if (!this.masterAnalysers) return null;
		return {
			left: measureLevel(this.masterAnalysers[0]),
			right: measureLevel(this.masterAnalysers[1])
		};
	}
}

export const audioEngine = new AudioEngine();
