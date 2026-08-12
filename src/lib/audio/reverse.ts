// Reverse (backward) audio playback for reversed timeline clips.
//
// HTMLMediaElement cannot play backward (no negative playbackRate), so a
// reversed clip's video/audio element is muted and stepped frame by frame.
// This module decodes the asset's audio track once, mirrors the samples, and
// plays the mirrored buffer forward - which sounds like the original running
// backward. The playhead is kept in lockstep with the timeline clock and is
// restarted only when it drifts past a threshold, so normal playback is
// click-free and scrubbing lands on the right audio.

export type ReverseAudioState = {
	// whether the timeline clock is playing
	playing: boolean;
	// absolute source time (seconds) at the current timeline time; the buffer
	// offset is derived as bufferDuration - sourceTime because the samples are
	// mirrored
	sourceTime: number;
	// playback rate applied to the mirrored buffer (global rate * clip speed)
	rate: number;
	// effective gain in 0..1 (preview volume, clip volume, fades, ducking)
	volume: number;
};

export type ReverseAudioPlayer = {
	update(state: ReverseAudioState): void;
	destroy(): void;
};

const RESYNC_THRESHOLD = 0.35;
const MIN_RATE = 0.01;
const MAX_SOURCE_END_SAFETY = 0.001;

let sharedContext: AudioContext | null = null;
const bufferCache = new Map<string, Promise<AudioBuffer | null>>();

function getContext(): AudioContext {
	if (!sharedContext) sharedContext = new AudioContext();
	return sharedContext;
}

function clampVolume(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

function clampBufferOffset(value: number, duration: number): number {
	const maxOffset = Math.max(0, duration - MAX_SOURCE_END_SAFETY);
	return Math.min(maxOffset, Math.max(0, value));
}

// build a sample-mirrored copy of the decoded buffer so forward playback
// produces the reversed source audio (matches the export mixer's approach)
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

async function getReversedBuffer(src: string): Promise<AudioBuffer | null> {
	const cached = bufferCache.get(src);
	if (cached) return cached;
	const promise = (async () => {
		try {
			const response = await fetch(src);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = await getContext().decodeAudioData(arrayBuffer);
			return reverseAudioBuffer(buffer);
		} catch (error) {
			console.warn('[reverse] audio decode failed:', error);
			return null;
		}
	})();
	bufferCache.set(src, promise);
	return promise;
}
export async function createReverseAudioPlayer(src: string): Promise<ReverseAudioPlayer | null> {
	const decoded = await getReversedBuffer(src);
	if (!decoded) return null;
	// explicit non-null copy so closures keep a stable AudioBuffer reference
	const buffer: AudioBuffer = decoded;

	const ctx = getContext();
	const gain = ctx.createGain();
	gain.gain.value = 0;
	gain.connect(ctx.destination);

	let source: AudioBufferSourceNode | null = null;
	let startCtxTime = 0;
	let startBufferOffset = 0;

	function stopSource() {
		const stopping = source;
		if (!stopping) return;
		source = null;
		try {
			// fade the shared gain down before the scheduled stop so pause and
			// drift restarts do not click
			const stopTime = ctx.currentTime + 0.03;
			gain.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
			stopping.stop(stopTime);
			window.setTimeout(() => stopping.disconnect(), 80);
		} catch {
			stopping.disconnect();
		}
	}

	function startSource(state: ReverseAudioState) {
		stopSource();
		const offset = clampBufferOffset(buffer.duration - state.sourceTime, buffer.duration);
		const next = ctx.createBufferSource();
		next.buffer = buffer;
		next.playbackRate.value = Math.max(MIN_RATE, state.rate);
		next.connect(gain);
		startCtxTime = ctx.currentTime;
		startBufferOffset = offset;
		next.start(0, offset);
		gain.gain.setTargetAtTime(clampVolume(state.volume), ctx.currentTime + 0.03, 0.012);
		source = next;
	}
	function apply(state: ReverseAudioState) {
		if (!state.playing) {
			stopSource();
			return;
		}
		// autoplay policy: resume lazily once the user starts playback
		if (ctx.state === 'suspended') {
			void ctx.resume().catch(() => {});
		}

		const desiredOffset = clampBufferOffset(buffer.duration - state.sourceTime, buffer.duration);
		const rate = Math.max(MIN_RATE, state.rate);

		if (!source) {
			startSource(state);
			return;
		}

		// restart only when the running source has drifted from the clock
		const elapsed = Math.max(0, ctx.currentTime - startCtxTime);
		const expectedOffset = startBufferOffset + elapsed * rate;
		if (Math.abs(expectedOffset - desiredOffset) > RESYNC_THRESHOLD) {
			startSource(state);
			return;
		}

		if (Math.abs(source.playbackRate.value - rate) > 0.001) {
			source.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.02);
		}
	}

	return {
		update(state: ReverseAudioState) {
			apply(state);
		},
		destroy() {
			stopSource();
			gain.disconnect();
		}
	};
}
