import type { Action } from 'svelte/action';
import { FRAME_RATE, roundToFrame } from './timeline';

export type MediaSyncState = {
	time: number;
	playing: boolean;
	muted: boolean;
	playbackRate: number;
	// force a media re-sync on every clock tick instead of free-running the element;
	// used by reversed clips where the source time moves backward each frame
	syncEveryTick?: boolean;
	// reversed clips cannot run the element forward (HTMLMediaElement has no
	// negative playbackRate), so the element stays paused and is stepped frame by
	// frame through seek requests instead of being played
	reversed?: boolean;
};

const PAUSED_SYNC_THRESHOLD = 1 / FRAME_RATE;
const PLAYING_SYNC_THRESHOLD = 0.35;
const MEDIA_TIME_DISCONTINUITY_THRESHOLD = 1;
const REVERSED_SEEK_EPSILON = 1 / FRAME_RATE / 2;

function shouldSyncMediaTime(previousState: MediaSyncState, nextState: MediaSyncState): boolean {
	if (nextState.syncEveryTick === true) return true;
	if (!previousState.playing || !nextState.playing) return true;
	return Math.abs(nextState.time - previousState.time) > MEDIA_TIME_DISCONTINUITY_THRESHOLD;
}

function isMediaSyncStateEqual(left: MediaSyncState, right: MediaSyncState): boolean {
	return (
		left.time === right.time &&
		left.playing === right.playing &&
		left.muted === right.muted &&
		left.playbackRate === right.playbackRate &&
		(left.syncEveryTick ?? false) === (right.syncEveryTick ?? false) &&
		(left.reversed ?? false) === (right.reversed ?? false)
	);
}

function isMediaControlStateEqual(left: MediaSyncState, right: MediaSyncState): boolean {
	return (
		left.playing === right.playing &&
		left.muted === right.muted &&
		left.playbackRate === right.playbackRate &&
		(left.reversed ?? false) === (right.reversed ?? false)
	);
}

// keep a media element in lockstep with the timeline clock
// used by Player layers and chroma key surfaces so playback stays single-sourced
export const syncMedia: Action<HTMLMediaElement, MediaSyncState> = (node, state) => {
	let currentState = state;
	let playbackRequested = false;
	let hasSynchronizedTime = false;

	function applyState(forceSync = false, syncTime = true) {
		if (node.muted !== currentState.muted) node.muted = currentState.muted;
		// HTMLMediaElement rejects negative playback rates; clamp defensively so
		// reversed/frozen layers never throw when the media element is updated
		const safePlaybackRate = Math.max(0, currentState.playbackRate);
		if (node.playbackRate !== safePlaybackRate) {
			node.playbackRate = safePlaybackRate;
		}
		const reversed = currentState.reversed === true;
		// reversed layers step frame by frame: round the seek target so repeated
		// clock ticks for the same frame skip redundant seeks
		const targetTime = reversed ? roundToFrame(currentState.time) : currentState.time;
		const syncThreshold = reversed
			? REVERSED_SEEK_EPSILON
			: currentState.playing
				? PLAYING_SYNC_THRESHOLD
				: PAUSED_SYNC_THRESHOLD;
		if (
			syncTime &&
			node.readyState > 0 &&
			(forceSync || !hasSynchronizedTime || Math.abs(node.currentTime - targetTime) > syncThreshold)
		) {
			node.currentTime = targetTime;
			hasSynchronizedTime = true;
		}
		if (!currentState.playing || reversed) {
			// reversed media never free-runs forward: keep it paused and let the
			// per-frame seek above drive the preview backward
			if (!node.paused) node.pause();
			playbackRequested = false;
			return;
		}
		if (playbackRequested || !node.paused) return;
		playbackRequested = true;
		void node.play().catch(() => {
			playbackRequested = false;
		});
	}

	const handleLoadedMetadata = () => applyState(true);
	const handlePause = () => {
		if (!currentState.playing) return;
		playbackRequested = false;
	};
	node.addEventListener('loadedmetadata', handleLoadedMetadata);
	node.addEventListener('pause', handlePause);
	applyState();

	return {
		update(nextState: MediaSyncState) {
			if (isMediaSyncStateEqual(currentState, nextState)) return;
			const previousState = currentState;
			currentState = nextState;
			const syncTime = shouldSyncMediaTime(previousState, nextState);
			if (!syncTime && isMediaControlStateEqual(previousState, nextState)) return;
			applyState(false, syncTime);
		},
		destroy() {
			node.pause();
			node.removeEventListener('loadedmetadata', handleLoadedMetadata);
			node.removeEventListener('pause', handlePause);
		}
	};
};

// clamp and apply the preview volume without touching the shared clock
let boostContext: AudioContext | null = null;

function getBoostContext(): AudioContext {
	if (!boostContext) boostContext = new AudioContext();
	return boostContext;
}

// clamp and apply the preview volume without touching the shared clock.
// HTMLMediaElement volume caps at 1, so gains above 1 (audio normalization
// boost) are routed through a shared AudioContext gain node; the element's own
// volume stays neutral while it is in the graph. Volumes within [0,1] keep the
// plain element path so ordinary playback never depends on a WebAudio context.
export const syncMediaVolume: Action<HTMLMediaElement, number> = (node, volume) => {
	let boost: { source: MediaElementAudioSourceNode; gain: GainNode; context: AudioContext } | null =
		null;

	function ensureBoost(): typeof boost {
		if (boost) return boost;
		try {
			const context = getBoostContext();
			const source = context.createMediaElementSource(node);
			const gain = context.createGain();
			source.connect(gain).connect(context.destination);
			// keep the element neutral once it is routed through the graph
			node.volume = 1;
			boost = { source, gain, context };
		} catch {
			boost = null;
		}
		return boost;
	}

	function applyVolume(nextVolume: number) {
		const safeVolume = Math.min(4, Math.max(0, Number.isFinite(nextVolume) ? nextVolume : 1));
		if (safeVolume <= 1 && !boost) {
			if (node.volume === safeVolume) return;
			node.volume = safeVolume;
			return;
		}
		const graph = ensureBoost();
		if (!graph) {
			// could not create a graph: fall back to the capped element volume
			if (node.volume === safeVolume) return;
			node.volume = safeVolume;
			return;
		}
		graph.gain.gain.value = safeVolume;
		if (safeVolume > 0 && graph.context.state === 'suspended') {
			void graph.context.resume().catch(() => {});
		}
	}

	applyVolume(volume);
	return {
		update: applyVolume,
		destroy() {
			if (!boost) return;
			try {
				boost.gain.disconnect();
				boost.source.disconnect();
			} catch {
				// element already gone
			}
			boost = null;
		}
	};
};
