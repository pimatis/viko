import type { Clip, Track } from '$lib/editor/timeline';

export const DUCKING_MIN_DB = 3;
export const DUCKING_MAX_DB = 6;
export const DUCKING_DEFAULT_DB = 4.5;
export const DUCKING_ATTACK_SECONDS = 0.1;
export const DUCKING_RELEASE_SECONDS = 0.15;

export type DuckSource = {
	startTime: number;
	duration: number;
	amountDb: number;
};

export function isDuckSource(clip: Clip): boolean {
	return clip.duckSource === true;
}

export function clampDuckAmountDb(value: number): number {
	if (!Number.isFinite(value)) return DUCKING_DEFAULT_DB;
	return Math.min(DUCKING_MAX_DB, Math.max(DUCKING_MIN_DB, value));
}

export function getDuckAmountDb(clip: Clip): number {
	return clampDuckAmountDb(clip.duckAmountDb ?? DUCKING_DEFAULT_DB);
}

function dbToGain(db: number): number {
	return Math.pow(10, -db / 20);
}

// collect active duck sources, skipping muted tracks so silent speech never ducks music
export function collectDuckSources(tracks: Track[]): DuckSource[] {
	const sources: DuckSource[] = [];
	for (const track of tracks) {
		if (track.muted) continue;
		for (const clip of track.clips) {
			if (!isDuckSource(clip)) continue;
			sources.push({
				startTime: clip.startTime,
				duration: clip.duration,
				amountDb: getDuckAmountDb(clip)
			});
		}
	}
	return sources;
}

// linear gain multiplier applied to a target clip at a timeline time
// returns 1 when no ducking applies; a duck source never ducks itself
export function getDuckingFactorAtTime(
	sources: DuckSource[],
	targetIsDuckSource: boolean,
	time: number
): number {
	if (targetIsDuckSource) return 1;
	let factor = 1;
	for (const source of sources) {
		const sourceEnd = source.startTime + source.duration;
		if (time < source.startTime || time >= sourceEnd) continue;
		const localTime = time - source.startTime;
		const timeUntilEnd = sourceEnd - time;
		const ramp = Math.min(
			1,
			DUCKING_ATTACK_SECONDS > 0 ? Math.min(1, localTime / DUCKING_ATTACK_SECONDS) : 1,
			DUCKING_RELEASE_SECONDS > 0 ? Math.min(1, timeUntilEnd / DUCKING_RELEASE_SECONDS) : 1
		);
		const sourceFactor = 1 - (1 - dbToGain(source.amountDb)) * ramp;
		if (sourceFactor < factor) factor = sourceFactor;
	}
	return factor;
}
