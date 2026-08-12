import type { Track } from '$lib/editor/timeline';
import { roundToFrame } from '$lib/editor/timeline';
import { clampTransitionDuration, getEffectPreset, isClipTransitionPreset } from './presets';
import type { ClipTransition } from './types';

const TRANSITION_BOUNDARY_TOLERANCE = 1 / 30;

export function applyEffectToClip(
	tracks: Track[],
	clipId: string,
	presetId: string,
	effectId: string
): Track[] {
	const preset = getEffectPreset(presetId);
	if (!preset) return tracks;
	let changed = false;
	const nextTracks = tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) => {
			if (clip.id !== clipId || track.locked) return clip;
			const effects = (clip.effects ?? []).filter((effect) => {
				const currentPreset = getEffectPreset(effect.presetId);
				if (effect.presetId === presetId) return false;
				if (preset.kind === 'effects') return true;
				return currentPreset?.kind !== preset.kind;
			});
			changed = true;
			return { ...clip, effects: [...effects, { id: effectId, presetId }] };
		})
	}));
	return changed ? nextTracks : tracks;
}

// apply a clip-pair transition to the outgoing clip boundary
// the transition is stored on the clip that transitions into the next clip
export function applyTransitionToClip(
	tracks: Track[],
	clipId: string,
	presetId: string,
	duration: number
): Track[] {
	if (!isClipTransitionPreset(presetId)) return tracks;
	const safeDuration = clampTransitionDuration(duration);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		const orderedClips = [...track.clips].sort((left, right) => left.startTime - right.startTime);
		const clipIndex = orderedClips.findIndex((clip) => clip.id === clipId);
		if (clipIndex < 0) return track;
		const clip = orderedClips[clipIndex];
		const existingTransition = clip.clipTransition;
		const nextClip = existingTransition
			? track.clips.find((candidate) => candidate.id === existingTransition.incomingClipId)
			: orderedClips[clipIndex + 1];
		if (!nextClip) return track;
		const boundary = clip.startTime + clip.duration;
		const currentOverlap = boundary - nextClip.startTime;
		if (!existingTransition && Math.abs(currentOverlap) > TRANSITION_BOUNDARY_TOLERANCE)
			return track;
		if (
			existingTransition &&
			Math.abs(currentOverlap - existingTransition.duration) > TRANSITION_BOUNDARY_TOLERANCE
		) {
			return track;
		}
		// transition duration cannot exceed the overlap of either clip
		const maxDuration = Math.min(clip.duration, nextClip.duration);
		const finalDuration = Math.min(safeDuration, maxDuration);
		if (
			existingTransition?.presetId === presetId &&
			existingTransition.duration === finalDuration
		) {
			return track;
		}
		changed = true;
		const transition: ClipTransition = {
			presetId,
			duration: finalDuration,
			incomingClipId: nextClip.id
		};
		const shiftAmount = (existingTransition?.duration ?? 0) - finalDuration;
		const clips = track.clips
			.map((candidate) => {
				if (candidate.id === clip.id) return { ...candidate, clipTransition: transition };
				if (candidate.startTime < nextClip.startTime) return candidate;
				return { ...candidate, startTime: roundToFrame(candidate.startTime + shiftAmount) };
			})
			.sort((left, right) => left.startTime - right.startTime);
		return { ...track, clips };
	});
	return changed ? nextTracks : tracks;
}

export function removeTransitionFromClips(tracks: Track[], clipIds: string[]): Track[] {
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		const removals = track.clips
			.filter((clip) => selectedIds.has(clip.id) && clip.clipTransition)
			.flatMap((clip) => {
				const transition = clip.clipTransition;
				if (!transition) return [];
				const incoming = track.clips.find(
					(candidate) => candidate.id === transition.incomingClipId
				);
				if (!incoming)
					return [{ clipId: clip.id, startTime: Number.POSITIVE_INFINITY, duration: 0 }];
				return [{ clipId: clip.id, startTime: incoming.startTime, duration: transition.duration }];
			})
			.sort((left, right) => left.startTime - right.startTime);
		if (removals.length === 0) return track;
		changed = true;
		const removedIds = new Set(removals.map((removal) => removal.clipId));
		const clips = track.clips
			.map((clip) => {
				const shiftAmount = removals.reduce(
					(total, removal) =>
						clip.startTime >= removal.startTime ? total + removal.duration : total,
					0
				);
				const shiftedClip = shiftAmount
					? { ...clip, startTime: roundToFrame(clip.startTime + shiftAmount) }
					: clip;
				if (!removedIds.has(clip.id)) return shiftedClip;
				const { clipTransition: _removed, ...rest } = shiftedClip;
				return rest;
			})
			.sort((left, right) => left.startTime - right.startTime);
		return { ...track, clips };
	});
	return changed ? nextTracks : tracks;
}

export function removeEffectsFromClips(tracks: Track[], clipIds: string[]): Track[] {
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (!selectedIds.has(clip.id) || !clip.effects?.length) return clip;
				changed = true;
				return { ...clip, effects: [] };
			})
		};
	});
	return changed ? nextTracks : tracks;
}
