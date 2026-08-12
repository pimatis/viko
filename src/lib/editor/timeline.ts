import type { ClipEffect, ClipTransition } from '$lib/effects';
import { cloneColorGradeOrNull, type ColorGrade } from '$lib/grading';
import { DEFAULT_CHROMA_KEY } from '$lib/chroma';
import type { TextStyle } from './text';

export type TrackType = 'video' | 'audio' | 'subtitle';

// CSS mix-blend-mode keywords supported by the layer compositor
export type BlendMode =
	| 'normal'
	| 'multiply'
	| 'screen'
	| 'overlay'
	| 'darken'
	| 'lighten'
	| 'color-dodge'
	| 'color-burn'
	| 'hard-light'
	| 'soft-light'
	| 'difference'
	| 'exclusion';

export const BLEND_MODES: BlendMode[] = [
	'normal',
	'multiply',
	'screen',
	'overlay',
	'darken',
	'lighten',
	'color-dodge',
	'color-burn',
	'hard-light',
	'soft-light',
	'difference',
	'exclusion'
];

export function isBlendMode(value: unknown): value is BlendMode {
	return typeof value === 'string' && (BLEND_MODES as string[]).includes(value);
}

// layer masking: a shape that clips the layer's visible area. All coordinates
// are percentages (0-100) relative to the layer bounds. Polygon points must
// contain at least 3 entries and are clamped to the mask coordinate space.
export type MaskPoint = { x: number; y: number };

export type ClipMask =
	| { type: 'rect'; x: number; y: number; width: number; height: number }
	| { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
	| { type: 'polygon'; points: MaskPoint[] };

export const MAX_MASK_POINTS = 32;

export function clampMaskCoord(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

export function isClipMask(value: unknown): value is ClipMask {
	if (typeof value !== 'object' || value === null) return false;
	const record = value as Record<string, unknown>;
	if (record.type === 'rect') {
		return (
			typeof record.x === 'number' &&
			typeof record.y === 'number' &&
			typeof record.width === 'number' &&
			typeof record.height === 'number'
		);
	}
	if (record.type === 'ellipse') {
		return (
			typeof record.cx === 'number' &&
			typeof record.cy === 'number' &&
			typeof record.rx === 'number' &&
			typeof record.ry === 'number'
		);
	}
	if (record.type === 'polygon') {
		return Array.isArray(record.points) && record.points.length >= 3;
	}
	return false;
}

// rebuild a mask from untrusted project data; returns null when invalid
export function sanitizeClipMask(value: unknown): ClipMask | null {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	if (record.type === 'rect') {
		const x = clampMaskCoord(typeof record.x === 'number' ? record.x : 0);
		const y = clampMaskCoord(typeof record.y === 'number' ? record.y : 0);
		const width = clampMaskCoord(typeof record.width === 'number' ? record.width : 100);
		const height = clampMaskCoord(typeof record.height === 'number' ? record.height : 100);
		return { type: 'rect', x, y, width, height };
	}
	if (record.type === 'ellipse') {
		return {
			type: 'ellipse',
			cx: clampMaskCoord(typeof record.cx === 'number' ? record.cx : 50),
			cy: clampMaskCoord(typeof record.cy === 'number' ? record.cy : 50),
			rx: clampMaskCoord(typeof record.rx === 'number' ? record.rx : 50),
			ry: clampMaskCoord(typeof record.ry === 'number' ? record.ry : 50)
		};
	}
	if (record.type === 'polygon' && Array.isArray(record.points)) {
		const points = record.points.slice(0, MAX_MASK_POINTS).flatMap((point) => {
			if (typeof point !== 'object' || point === null) return [];
			const maskPoint = point as Record<string, unknown>;
			if (typeof maskPoint.x !== 'number' || typeof maskPoint.y !== 'number') return [];
			return [
				{
					x: clampMaskCoord(maskPoint.x),
					y: clampMaskCoord(maskPoint.y)
				}
			];
		});
		if (points.length < 3) return null;
		return { type: 'polygon', points };
	}
	return null;
}

export type VisualTransform = {
	x: number;
	y: number;
	scale: number;
	// rotation in degrees; animation is driven by the 'rotation' keyframe slot
	rotation: number;
	blendMode: BlendMode;
	// undefined means the layer is fully visible (no mask)
	mask?: ClipMask;
};

export type ClipVisualState = {
	transform: VisualTransform;
	opacity: number;
	volume: number;
	audioFadeIn: number;
	audioFadeOut: number;
	colorAdjust: ColorAdjust;
};

export const MIN_VISUAL_SCALE = 0.1;
export const MAX_VISUAL_SCALE = 4;
export const MIN_VISUAL_ROTATION = -360;
export const MAX_VISUAL_ROTATION = 360;

export type ColorAdjust = {
	brightness: number;
	contrast: number;
	saturation: number;
	hue: number;
};

export type ChromaKey = {
	enabled: boolean;
	keyColor: string;
	similarity: number;
	smoothness: number;
	spillSuppression: number;
};

export type ChromaKeyState = ChromaKey & {
	spill: number;
};

export const KEYFRAME_PROPERTIES = [
	'x',
	'y',
	'scale',
	'rotation',
	'opacity',
	'volume',
	'audioFadeIn',
	'audioFadeOut',
	'brightness',
	'contrast',
	'saturation',
	'hue',
	'spill',
	'speed'
] as const;

export type KeyframeProperty = (typeof KEYFRAME_PROPERTIES)[number];

// easing applied between two keyframes; 'bezier' uses a cubic-bezier curve
export type KeyframeEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';

export const KEYFRAME_EASINGS: KeyframeEasing[] = [
	'linear',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'bezier'
];

export function isKeyframeEasing(value: unknown): value is KeyframeEasing {
	return typeof value === 'string' && (KEYFRAME_EASINGS as string[]).includes(value);
}

// cubic-bezier control points (x1, y1, x2, y2), each clamped to 0..1
// used only when easing is 'bezier'
export type BezierControlPoints = [number, number, number, number];

export function clampBezierControlPoints(points: unknown): BezierControlPoints | undefined {
	if (!Array.isArray(points) || points.length !== 4) return undefined;
	if (!points.every((point) => typeof point === 'number' && Number.isFinite(point))) {
		return undefined;
	}
	return points.map((point) => Math.min(1, Math.max(0, point))) as BezierControlPoints;
}

export const DEFAULT_BEZIER_POINTS: BezierControlPoints = [0.42, 0, 0.58, 1];

export type Keyframe = {
	id: string;
	time: number;
	property: KeyframeProperty;
	value: number;
	easing: KeyframeEasing;
	bezier?: BezierControlPoints;
};

export type KeyframeValue = Pick<Keyframe, 'property' | 'value'> & {
	id: string;
	easing?: KeyframeEasing;
	bezier?: BezierControlPoints;
};

export type Marker = {
	id: string;
	time: number;
	label: string;
	color: string;
};

export type InOutPoints = {
	in: number | null;
	out: number | null;
};

export type Clip = {
	id: string;
	name: string;
	startTime: number;
	duration: number;
	assetId?: string;
	sourceInstanceId?: string;
	sourceStart?: number;
	sourceDuration?: number;
	textStyle?: TextStyle;
	caption?: boolean;
	sticker?: string;
	stickerColor?: string;
	visualTransform?: VisualTransform;
	effects?: ClipEffect[];
	clipTransition?: ClipTransition;
	speed?: number;
	// reversed plays the clip's source window backwards; frozen pins the source
	// to a single frame (sourceStart) so the clip holds that frame for its duration
	reversed?: boolean;
	frozen?: boolean;
	volume?: number;
	audioFadeIn?: number;
	audioFadeOut?: number;
	duckSource?: boolean;
	duckAmountDb?: number;
	opacity?: number;
	colorAdjust?: ColorAdjust;
	colorGrade?: ColorGrade;
	chromaKey?: ChromaKey;
	keyframes?: Keyframe[];
	groupId?: string;
};

export type ClipVisualUpdateRequest = {
	id: string;
	clipId: string;
	transform?: VisualTransform;
	color?: string;
	clipTime?: number;
};

export type TimelineCommand = 'undo' | 'redo';

export type TimelineCommandRequest = {
	id: string;
	command: TimelineCommand;
};

export type ClipPropertyChangeRequest = {
	id: string;
	clipId: string;
	updater: (clip: Clip) => Clip;
};

export type ClipInsertRequest = {
	id: string;
	clips: Clip[];
	targetTrackId?: string;
	trackType: TrackType;
	createTrack?: boolean;
	trackName?: string;
};

export type Track = {
	id: string;
	name: string;
	type: TrackType;
	color: string;
	clips: Clip[];
	muted: boolean;
	locked: boolean;
};

export const FRAME_RATE = 30;

export function roundToFrame(time: number): number {
	return Math.round(Math.max(0, time) * FRAME_RATE) / FRAME_RATE;
}

// generate snap points at every grid interval mark on the ruler
function generateGridSnapPoints(gridInterval: number | undefined, duration: number): number[] {
	if (!gridInterval || gridInterval <= 0) return [];
	const points: number[] = [];
	for (let t = 0; t <= duration + 0.001; t += gridInterval) {
		points.push(roundToFrame(t));
	}
	return points;
}

export function cloneClipMask(mask: ClipMask): ClipMask {
	if (mask.type === 'polygon') {
		return { ...mask, points: mask.points.map((point) => ({ ...point })) };
	}
	return { ...mask };
}

// CSS clip-path value that clips a layer to the mask shape. Coordinates are
// layer-relative percentages, so the same mask renders identically on Player
// and on the export canvas.
export function getClipMaskStyle(mask: ClipMask): string {
	if (mask.type === 'rect') {
		const right = 100 - mask.x - mask.width;
		const bottom = 100 - mask.y - mask.height;
		return `inset(${mask.y}% ${right}% ${bottom}% ${mask.x}%)`;
	}
	if (mask.type === 'ellipse') {
		return `ellipse(${mask.rx}% ${mask.ry}% at ${mask.cx}% ${mask.cy}%)`;
	}
	if (mask.points.length < 3) return 'none';
	return `polygon(${mask.points.map((point) => `${point.x}% ${point.y}%`).join(', ')})`;
}

export function cloneTracks(tracks: Track[]): Track[] {
	return tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) => ({
			...clip,
			textStyle: clip.textStyle ? { ...clip.textStyle } : undefined,
			visualTransform: clip.visualTransform
				? {
						...clip.visualTransform,
						mask: clip.visualTransform.mask ? cloneClipMask(clip.visualTransform.mask) : undefined
					}
				: undefined,
			effects: clip.effects?.map((effect) => ({ ...effect })),
			clipTransition: clip.clipTransition ? { ...clip.clipTransition } : undefined,
			colorAdjust: clip.colorAdjust ? { ...clip.colorAdjust } : undefined,
			colorGrade: cloneColorGradeOrNull(clip.colorGrade),
			chromaKey: clip.chromaKey ? { ...clip.chromaKey } : undefined,
			keyframes: clip.keyframes?.map((kf) => ({
				...kf,
				bezier: kf.bezier ? ([...kf.bezier] as BezierControlPoints) : undefined
			}))
		}))
	}));
}

export function reconcileClipTransitions(tracks: Track[]): Track[] {
	let changed = false;
	const nextTracks = tracks.map((track) => {
		const clipsById = new Map(track.clips.map((clip) => [clip.id, clip]));
		const clips = track.clips.map((clip) => {
			const transition = clip.clipTransition;
			if (!transition) return clip;
			const incoming = clipsById.get(transition.incomingClipId);
			const overlap = incoming ? clip.startTime + clip.duration - incoming.startTime : 0;
			if (incoming && overlap > 0 && Math.abs(overlap - transition.duration) <= 1 / FRAME_RATE) {
				return clip;
			}
			changed = true;
			const { clipTransition: _removed, ...rest } = clip;
			return rest;
		});
		return changed ? { ...track, clips } : track;
	});
	return changed ? nextTracks : tracks;
}

export function updateClipVisual(
	tracks: Track[],
	clipId: string,
	update: ClipVisualUpdateRequest
): Track[] {
	const safeColor = update.color?.match(/^#[0-9a-f]{6}$/i)?.[0];
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
		if (clipIndex < 0) return track;
		const clip = track.clips[clipIndex];
		let nextClip = clip;
		if (update.transform) {
			const clipTime = Math.min(clip.duration, Math.max(0, update.clipTime ?? 0));
			const currentTransform = getClipVisualTransform(clip, clipTime);
			const transform: VisualTransform = {
				x: clampKeyframeValue('x', update.transform.x),
				y: clampKeyframeValue('y', update.transform.y),
				scale: clampKeyframeValue('scale', update.transform.scale),
				rotation: clampKeyframeValue('rotation', update.transform.rotation),
				blendMode: update.transform.blendMode ?? DEFAULT_VISUAL_TRANSFORM.blendMode,
				mask: update.transform.mask
			};

			for (const property of ['x', 'y', 'scale', 'rotation'] as const) {
				if (Math.abs(transform[property] - currentTransform[property]) < 0.0001) continue;
				if (update.clipTime !== undefined && hasKeyframesForProperty(nextClip, property)) {
					nextClip = upsertClipKeyframe(
						nextClip,
						property,
						transform[property],
						clipTime,
						`${update.id}-${property}`
					);
					continue;
				}

				nextClip = {
					...nextClip,
					visualTransform: {
						...DEFAULT_VISUAL_TRANSFORM,
						...nextClip.visualTransform,
						[property]: transform[property]
					}
				};
			}
		}
		const textStyle =
			safeColor && nextClip.textStyle
				? { ...nextClip.textStyle, color: safeColor }
				: nextClip.textStyle;
		const stickerColor = safeColor && nextClip.sticker ? safeColor : nextClip.stickerColor;
		if (!update.transform && !safeColor) return track;
		if (nextClip === clip && textStyle === clip.textStyle && stickerColor === clip.stickerColor) {
			return track;
		}
		changed = true;
		const clips = [...track.clips];
		clips[clipIndex] = { ...nextClip, textStyle, stickerColor };
		return { ...track, clips };
	});
	return changed ? nextTracks : tracks;
}

export function clampClipStart(startTime: number, clipDuration: number, duration: number): number {
	const latestStart = Math.max(0, duration - clipDuration);
	const clampedTime = Math.min(Math.max(0, startTime), latestStart);
	return roundToFrame(clampedTime);
}

export function snapClipStart(
	tracks: Track[],
	clipId: string,
	targetTrackId: string,
	startTime: number,
	playheadTime: number,
	duration: number,
	snapThreshold: number,
	gridInterval?: number
): number {
	const clip = tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
	const targetTrack = tracks.find((track) => track.id === targetTrackId);
	if (!clip || !targetTrack) return clampClipStart(startTime, clip?.duration ?? 0, duration);

	const clampedStart = clampClipStart(startTime, clip.duration, duration);
	const snapPoints = [
		0,
		playheadTime,
		duration,
		...targetTrack.clips
			.filter((candidate) => candidate.id !== clipId)
			.flatMap((candidate) => [candidate.startTime, candidate.startTime + candidate.duration]),
		...generateGridSnapPoints(gridInterval, duration)
	];
	let snappedStart = clampedStart;
	let closestDistance = snapThreshold;

	for (const snapPoint of snapPoints) {
		const startDistance = Math.abs(snapPoint - clampedStart);
		if (startDistance <= closestDistance) {
			closestDistance = startDistance;
			snappedStart = snapPoint;
		}

		const endAlignedStart = snapPoint - clip.duration;
		const endDistance = Math.abs(endAlignedStart - clampedStart);
		if (endDistance > closestDistance) continue;
		closestDistance = endDistance;
		snappedStart = endAlignedStart;
	}

	return clampClipStart(snappedStart, clip.duration, duration);
}

export function snapClipEdge(
	tracks: Track[],
	clipId: string,
	edgeTime: number,
	playheadTime: number,
	duration: number,
	snapThreshold: number,
	gridInterval?: number
): number {
	const snapPoints = [
		0,
		playheadTime,
		duration,
		...tracks.flatMap((track) =>
			track.clips
				.filter((clip) => clip.id !== clipId)
				.flatMap((clip) => [clip.startTime, clip.startTime + clip.duration])
		),
		...generateGridSnapPoints(gridInterval, duration)
	];
	let snappedTime = Math.min(duration, Math.max(0, edgeTime));
	let closestDistance = snapThreshold;
	for (const snapPoint of snapPoints) {
		const distance = Math.abs(snapPoint - edgeTime);
		if (distance > closestDistance) continue;
		closestDistance = distance;
		snappedTime = snapPoint;
	}
	return roundToFrame(snappedTime);
}

export function resizeClip(
	tracks: Track[],
	clipId: string,
	edge: 'start' | 'end',
	edgeTime: number,
	timelineDuration: number
): Track[] {
	const minimumDuration = 1 / FRAME_RATE;
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (clip.id !== clipId) return clip;
				const clipEnd = clip.startTime + clip.duration;
				const frozen = clip.frozen === true;
				const reversed = clip.reversed === true;
				if (edge === 'start') {
					const sourceStart = clip.sourceStart ?? 0;
					// frozen clips hold a single frame: the source start is fixed and the
					// hold can extend freely through available timeline space. reversed
					// clips extend at their window top, so the bound mirrors the source end
					const trimLimit =
						clip.assetId && !frozen
							? reversed
								? getClipSourceLimitDuration(
										clip,
										Math.max(0, (clip.sourceDuration ?? 0) - sourceStart)
									)
								: getClipSourceLimitDuration(clip, Math.max(0, sourceStart))
							: 0;
					const earliestStart = clip.assetId ? Math.max(0, clip.startTime - trimLimit) : 0;
					const nextStart = roundToFrame(
						Math.min(clipEnd - minimumDuration, Math.max(earliestStart, edgeTime))
					);
					if (nextStart === clip.startTime) return clip;
					const trimmedDuration = nextStart - clip.startTime;
					changed = true;
					return {
						...clip,
						startTime: nextStart,
						duration: roundToFrame(clipEnd - nextStart),
						keyframes: trimClipKeyframesStart(
							clip,
							trimmedDuration,
							`${clip.id}-trim-start-${frameIndex(trimmedDuration)}`
						),
						sourceStart: clip.assetId
							? roundToFrame(
									trimmedDuration >= 0
										? frozen || reversed
											? sourceStart
											: sourceStart + getClipSourceOffset(clip, trimmedDuration)
										: frozen || reversed
											? sourceStart
											: sourceStart - getClipSourceOffset(clip, -trimmedDuration)
								)
							: clip.sourceStart
					};
				}

				// frozen holds consume no source time, so the end edge may extend through
				// timeline space; reversed clips extend at their window bottom, so the
				// available source is bounded by the source time before sourceStart
				const availableSourceDuration =
					!frozen && clip.sourceDuration
						? Math.max(
								minimumDuration,
								reversed
									? getClipSourceLimitDuration(
											clip,
											Math.max(
												0,
												(clip.sourceStart ?? 0) + getClipSourceOffset(clip, clip.duration)
											)
										)
									: getClipSourceLimitDuration(
											clip,
											Math.max(0, (clip.sourceDuration ?? 0) - (clip.sourceStart ?? 0))
										)
							)
						: timelineDuration - clip.startTime;
				const latestEnd = Math.min(timelineDuration, clip.startTime + availableSourceDuration);
				const nextEnd = roundToFrame(
					Math.max(clip.startTime + minimumDuration, Math.min(latestEnd, edgeTime))
				);
				if (nextEnd === clipEnd) return clip;
				changed = true;
				const nextDuration = roundToFrame(nextEnd - clip.startTime);
				return {
					...clip,
					duration: nextDuration,
					keyframes: trimClipKeyframesEnd(
						clip,
						nextDuration,
						`${clip.id}-trim-end-${frameIndex(nextDuration)}`
					),
					sourceStart:
						frozen || !reversed
							? clip.sourceStart
							: roundToFrame(getClipSourceTime(clip, nextDuration))
				};
			})
		};
	});
	return changed ? nextTracks : tracks;
}

export function moveClip(
	tracks: Track[],
	clipId: string,
	targetTrackId: string,
	startTime: number,
	duration: number
): Track[] {
	const sourceTrack = tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
	const targetTrack = tracks.find((track) => track.id === targetTrackId);
	const clip = sourceTrack?.clips.find((candidate) => candidate.id === clipId);

	if (!sourceTrack || !targetTrack || !clip) return tracks;
	if (sourceTrack.locked || targetTrack.locked) return tracks;

	const movedClip = {
		...clip,
		startTime: clampClipStart(startTime, clip.duration, duration)
	};

	return tracks.map((track) => {
		if (sourceTrack.id === targetTrack.id && track.id === sourceTrack.id) {
			return {
				...track,
				clips: track.clips
					.map((candidate) => (candidate.id === clipId ? movedClip : candidate))
					.sort((left, right) => left.startTime - right.startTime)
			};
		}

		if (track.id === sourceTrack.id) {
			return { ...track, clips: track.clips.filter((candidate) => candidate.id !== clipId) };
		}

		if (track.id === targetTrack.id) {
			return {
				...track,
				clips: [...track.clips, movedClip].sort((left, right) => left.startTime - right.startTime)
			};
		}

		return track;
	});
}

export function rippleDeleteClips(tracks: Track[], clipIds: string[]): Track[] {
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		const remainingClips = track.clips.filter((clip) => !selectedIds.has(clip.id));
		if (remainingClips.length === track.clips.length) return track;
		changed = true;
		const deletedGaps: { start: number; end: number }[] = [];
		for (const clip of track.clips) {
			if (!selectedIds.has(clip.id)) continue;
			deletedGaps.push({ start: clip.startTime, end: clip.startTime + clip.duration });
		}
		const sortedRemaining = remainingClips
			.map((clip) => ({ ...clip }))
			.sort((a, b) => a.startTime - b.startTime);
		for (const clip of sortedRemaining) {
			let shiftAmount = 0;
			for (const gap of deletedGaps) {
				if (gap.end <= clip.startTime) {
					shiftAmount += gap.end - gap.start;
				}
			}
			if (shiftAmount > 0) {
				clip.startTime = roundToFrame(Math.max(0, clip.startTime - shiftAmount));
			}
		}
		return { ...track, clips: sortedRemaining };
	});
	return changed ? nextTracks : tracks;
}

export function rippleInsertClips(
	tracks: Track[],
	targetTrackId: string,
	insertTime: number,
	insertDuration: number
): Track[] {
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.id !== targetTrackId || track.locked) return track;
		const shiftedClips = track.clips.map((clip) => {
			if (clip.startTime < insertTime) return clip;
			changed = true;
			return { ...clip, startTime: roundToFrame(clip.startTime + insertDuration) };
		});
		return { ...track, clips: shiftedClips };
	});
	return changed ? nextTracks : tracks;
}

export function nudgeClips(
	tracks: Track[],
	clipIds: string[],
	deltaFrames: number,
	timelineDuration: number
): Track[] {
	if (clipIds.length === 0 || deltaFrames === 0) return tracks;
	const deltaSeconds = deltaFrames / FRAME_RATE;
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (!selectedIds.has(clip.id)) return clip;
				const newStart = clampClipStart(
					clip.startTime + deltaSeconds,
					clip.duration,
					timelineDuration
				);
				if (newStart === clip.startTime) return clip;
				changed = true;
				return { ...clip, startTime: newStart };
			})
		};
	});
	return changed ? nextTracks : tracks;
}

export function updateClipProperty(
	tracks: Track[],
	clipId: string,
	updater: (clip: Clip) => Clip
): Track[] {
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		const clipIndex = track.clips.findIndex((clip) => clip.id === clipId);
		if (clipIndex < 0) return track;
		const nextClip = updater(track.clips[clipIndex]);
		if (nextClip === track.clips[clipIndex]) return track;
		changed = true;
		const clips = [...track.clips];
		clips[clipIndex] = nextClip;
		return { ...track, clips };
	});
	return changed ? nextTracks : tracks;
}

export function groupClips(tracks: Track[], clipIds: string[], groupId: string): Track[] {
	if (clipIds.length < 2) return tracks;
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (!selectedIds.has(clip.id) || clip.groupId === groupId) return clip;
				changed = true;
				return { ...clip, groupId };
			})
		};
	});
	return changed ? nextTracks : tracks;
}

export function ungroupClips(tracks: Track[], clipIds: string[]): Track[] {
	const selectedIds = new Set(clipIds);
	let changed = false;
	const nextTracks = tracks.map((track) => {
		if (track.locked) return track;
		return {
			...track,
			clips: track.clips.map((clip) => {
				if (!selectedIds.has(clip.id) || !clip.groupId) return clip;
				changed = true;
				const { groupId: _groupId, ...rest } = clip;
				return rest;
			})
		};
	});
	return changed ? nextTracks : tracks;
}

export function moveGroupedClips(
	tracks: Track[],
	clipId: string,
	deltaStartTime: number,
	timelineDuration: number
): Track[] {
	const sourceTrack = tracks.find((track) => track.clips.some((clip) => clip.id === clipId));
	const clip = sourceTrack?.clips.find((candidate) => candidate.id === clipId);
	if (!clip || !clip.groupId) return tracks;

	const groupClipIds = tracks
		.flatMap((track) => track.clips)
		.filter((candidate) => candidate.groupId === clip.groupId)
		.map((candidate) => candidate.id);

	return nudgeClips(
		tracks,
		groupClipIds,
		Math.round(deltaStartTime * FRAME_RATE),
		timelineDuration
	);
}

export function interpolateKeyframes(
	keyframes: Keyframe[],
	clipTime: number,
	property: KeyframeProperty
): number | null {
	let previous: Keyframe | null = null;
	let next: Keyframe | null = null;

	for (const keyframe of keyframes) {
		if (keyframe.property !== property) continue;
		if (keyframe.time <= clipTime && (!previous || keyframe.time > previous.time)) {
			previous = keyframe;
		}
		if (keyframe.time >= clipTime && (!next || keyframe.time < next.time)) {
			next = keyframe;
		}
	}

	if (!previous) return next?.value ?? null;
	if (!next || previous.time === next.time) return previous.value;

	const progress = (clipTime - previous.time) / (next.time - previous.time);
	const easedProgress = applyEasing(progress, previous.easing, previous.bezier);
	return previous.value + (next.value - previous.value) * easedProgress;
}

export function clampKeyframeValue(property: KeyframeProperty, value: number): number {
	if (!Number.isFinite(value)) {
		if (property === 'scale' || property === 'volume' || property === 'speed') return 1;
		if (property === 'opacity') return 100;
		if (property === 'x' || property === 'y') return 50;
		if (property === 'rotation') return 0;
		return 0;
	}
	if (property === 'scale') return Math.min(MAX_VISUAL_SCALE, Math.max(MIN_VISUAL_SCALE, value));
	if (property === 'rotation') {
		return Math.min(MAX_VISUAL_ROTATION, Math.max(MIN_VISUAL_ROTATION, value));
	}
	if (property === 'opacity') return Math.min(100, Math.max(0, value));
	if (property === 'volume') return Math.min(1, Math.max(0, value));
	if (property === 'speed') return Math.min(MAX_CLIP_SPEED, Math.max(MIN_CLIP_SPEED, value));
	if (property === 'audioFadeIn' || property === 'audioFadeOut') {
		return Math.min(5, Math.max(0, value));
	}
	if (property === 'hue') return Math.min(180, Math.max(-180, value));
	if (property === 'spill') return Math.min(100, Math.max(0, value));
	if (property === 'brightness' || property === 'contrast' || property === 'saturation') {
		return Math.min(100, Math.max(-100, value));
	}
	return Math.min(150, Math.max(-50, value));
}

export function hasKeyframesForProperty(clip: Clip, property: KeyframeProperty): boolean {
	return clip.keyframes?.some((keyframe) => keyframe.property === property) ?? false;
}

export function getClipKeyframeTimes(clip: Clip): number[] {
	const frames = new Set<number>();
	for (const keyframe of clip.keyframes ?? []) {
		frames.add(frameIndex(keyframe.time));
	}
	return [...frames].sort((left, right) => left - right).map((frame) => frame / FRAME_RATE);
}

export function removeClipKeyframesAtTime(clip: Clip, time: number): Clip {
	const targetFrame = frameIndex(time);
	const keyframes = clip.keyframes?.filter((keyframe) => frameIndex(keyframe.time) !== targetFrame);
	if (keyframes?.length === clip.keyframes?.length) return clip;
	return { ...clip, keyframes: keyframes?.length ? keyframes : undefined };
}

export function getClipKeyframeValue(
	clip: Clip,
	clipTime: number,
	property: KeyframeProperty
): number {
	if (property === 'opacity') return getClipOpacity(clip, clipTime) * 100;
	const state = getClipVisualState(clip, clipTime);
	if (property === 'x' || property === 'y' || property === 'scale' || property === 'rotation') {
		return state.transform[property];
	}
	if (property === 'volume') return state.volume;
	if (property === 'audioFadeIn') return state.audioFadeIn;
	if (property === 'audioFadeOut') return state.audioFadeOut;
	if (property === 'spill') return getClipChromaKeyState(clip, clipTime).spill;
	if (property === 'speed') return getClipSpeedAt(clip, clipTime);
	return state.colorAdjust[property];
}

export function getClipChromaKeyState(clip: Clip, clipTime: number): ChromaKeyState {
	const config = clip.chromaKey;
	if (!config) {
		return { ...DEFAULT_CHROMA_KEY, spill: DEFAULT_CHROMA_KEY.spillSuppression };
	}
	const keyframes = getClipKeyframeIndex(clip);
	const spill = resolveKeyframeSeries(keyframes.spill, clipTime) ?? config.spillSuppression;
	return { ...config, spill: clampKeyframeValue('spill', spill) };
}

export function getClipSpeedAt(clip: Clip, clipTime: number): number {
	const keyframes = getClipKeyframeIndex(clip);
	return resolveKeyframeSeries(keyframes.speed, clipTime) ?? clip.speed ?? 1;
}

export function getClipSpeedRange(clip: Clip): { min: number; max: number } | null {
	const animated = clip.keyframes?.some((keyframe) => keyframe.property === 'speed') ?? false;
	if (!animated) return null;
	let min = clip.speed ?? 1;
	let max = clip.speed ?? 1;
	for (const keyframe of clip.keyframes ?? []) {
		if (keyframe.property !== 'speed') continue;
		min = Math.min(min, keyframe.value);
		max = Math.max(max, keyframe.value);
	}
	return { min, max };
}

// ∫₀ᵘ ease(v) dv - analytic easing integrals used by the source offset integration
// bezier falls back to numeric integration since it has no closed form
function easingIntegral(easing: KeyframeEasing, u: number, bezier?: BezierControlPoints): number {
	const t = Math.min(1, Math.max(0, u));
	if (easing === 'linear') return (t * t) / 2;
	if (easing === 'ease-in') return (t * t * t) / 3;
	if (easing === 'ease-out') return t * t - (t * t * t) / 3;
	if (easing === 'ease-in-out') {
		// ease-in-out: 4v³ for v <= 0.5, 1 - ((-2v+2)³)/2 after; integrate piecewise
		if (t <= 0.5) return t * t * t * t;
		return t - 0.5 + Math.pow(-2 * t + 2, 4) / 16;
	}
	if (easing === 'bezier' && bezier) {
		return numericEasingIntegral(bezier, t);
	}
	return numericEasingIntegral([0, 0, 1, 1], t);
}

// trapezoid rule over a cubic bezier curve: ∫₀ᵘ y(x) dx
function numericEasingIntegral(bezier: BezierControlPoints, u: number): number {
	const STEPS = 32;
	let sum = 0;
	for (let step = 0; step < STEPS; step += 1) {
		const a = (u * step) / STEPS;
		const b = (u * (step + 1)) / STEPS;
		sum += ((applyEasing(a, 'bezier', bezier) + applyEasing(b, 'bezier', bezier)) / 2) * (b - a);
	}
	return sum;
}

// source time consumed up to clipTime, integrating the speed ramp curve
// speed segments interpolate between keyframes with their easing; the curve
// before the first and after the last speed keyframe holds a constant speed
export function getClipSourceOffset(clip: Clip, clipTime: number): number {
	const keyframes = getClipKeyframeIndex(clip);
	const series = keyframes.speed;
	const time = Math.min(clip.duration, Math.max(0, clipTime));
	if (series.length === 0) return time * (clip.speed ?? 1);

	let offset = 0;
	let segmentStart = 0;
	let segmentSpeed = series[0].value;
	for (let index = 0; index < series.length; index += 1) {
		const keyframe = series[index];
		const segmentEnd = keyframe.time;
		const segmentDuration = segmentEnd - segmentStart;
		if (segmentDuration > 0) {
			if (time <= segmentEnd) {
				const progress = (time - segmentStart) / segmentDuration;
				return (
					offset +
					segmentSpeed * (time - segmentStart) +
					(keyframe.value - segmentSpeed) *
						segmentDuration *
						easingIntegral(keyframe.easing, progress, keyframe.bezier)
				);
			}
			offset +=
				segmentSpeed * segmentDuration +
				(keyframe.value - segmentSpeed) *
					segmentDuration *
					easingIntegral(keyframe.easing, 1, keyframe.bezier);
		}
		segmentStart = segmentEnd;
		segmentSpeed = keyframe.value;
	}
	return offset + segmentSpeed * Math.max(0, time - segmentStart);
}

// absolute source time for a clip at clipTime, honoring freeze and reverse.
// frozen clips pin the source to their start (single held frame); reversed clips
// mirror the consumed source window so playback runs backward within the same bounds
// frozen wins over reversed so a freeze always renders a stable frame
export function getClipSourceTime(clip: Clip, clipTime: number): number {
	const sourceStart = clip.sourceStart ?? 0;
	if (clip.frozen === true) return sourceStart;
	const offset = getClipSourceOffset(clip, clipTime);
	if (clip.reversed === true) {
		return sourceStart + getClipSourceOffset(clip, clip.duration) - offset;
	}
	return sourceStart + offset;
}

// longest clip time that consumes at most maxSourceOffset source seconds
// used to bound right-edge trims against the persisted source duration
export function getClipSourceLimitDuration(clip: Clip, maxSourceOffset: number): number {
	if (maxSourceOffset <= 0) return 0;
	const keyframes = getClipKeyframeIndex(clip);
	const series = keyframes.speed;
	if (series.length === 0) {
		const speed = clip.speed ?? 1;
		return speed > 0 ? maxSourceOffset / speed : 0;
	}
	let minSpeed = clip.speed ?? 1;
	for (const keyframe of series) minSpeed = Math.min(minSpeed, keyframe.value);
	if (minSpeed <= 0) return 0;
	let low = 0;
	let high = maxSourceOffset / minSpeed + 1;
	for (let iteration = 0; iteration < 48; iteration += 1) {
		const middle = (low + high) / 2;
		if (getClipSourceOffset(clip, middle) <= maxSourceOffset) {
			low = middle;
		} else {
			high = middle;
		}
	}
	return roundToFrame(low);
}

export function upsertClipKeyframe(
	clip: Clip,
	property: KeyframeProperty,
	value: number,
	time: number,
	id: string
): Clip {
	return upsertClipKeyframes(clip, time, [{ id, property, value }]);
}

export function upsertClipKeyframes(clip: Clip, time: number, values: KeyframeValue[]): Clip {
	if (values.length === 0) return clip;
	const frameTime = clampClipTimeToFrame(time, clip.duration);
	const updates = new Map(values.map((value) => [value.property, value]));
	const updatedProperties = new Set<KeyframeProperty>();
	const keyframes: Keyframe[] = [];

	for (const keyframe of clip.keyframes ?? []) {
		const update = updates.get(keyframe.property);
		if (!update || frameIndex(keyframe.time) !== frameIndex(frameTime)) {
			keyframes.push({ ...keyframe });
			continue;
		}
		if (updatedProperties.has(keyframe.property)) continue;
		updatedProperties.add(keyframe.property);
		keyframes.push({
			...keyframe,
			time: frameTime,
			value: clampKeyframeValue(keyframe.property, update.value),
			easing: update.easing ?? keyframe.easing,
			bezier: update.bezier ?? keyframe.bezier
		});
	}

	for (const update of values) {
		if (updatedProperties.has(update.property)) continue;
		updatedProperties.add(update.property);
		keyframes.push({
			id: update.id,
			time: frameTime,
			property: update.property,
			value: clampKeyframeValue(update.property, update.value),
			easing: update.easing ?? 'linear',
			bezier: update.easing === 'bezier' ? (update.bezier ?? DEFAULT_BEZIER_POINTS) : undefined
		});
	}

	keyframes.sort(compareKeyframes);
	return { ...clip, keyframes };
}

export function splitClipKeyframes(
	clip: Clip,
	splitTime: number,
	leftIdPrefix: string,
	rightIdPrefix: string
): { left: Keyframe[] | undefined; right: Keyframe[] | undefined } {
	const frameTime = clampClipTimeToFrame(splitTime, clip.duration);
	const properties = getAnimatedProperties(clip.keyframes);
	if (properties.length === 0) return { left: undefined, right: undefined };

	const boundaryValues = properties.map((property) => ({
		property,
		value: interpolateKeyframes(clip.keyframes ?? [], frameTime, property) ?? 0
	}));
	const left = (clip.keyframes ?? [])
		.filter((keyframe) => frameIndex(keyframe.time) <= frameIndex(frameTime))
		.map((keyframe) => ({ ...keyframe }));
	const right = (clip.keyframes ?? [])
		.filter((keyframe) => frameIndex(keyframe.time) >= frameIndex(frameTime))
		.map((keyframe) => ({ ...keyframe, time: roundToFrame(keyframe.time - frameTime) }));

	for (const boundary of boundaryValues) {
		if (
			!left.some(
				(keyframe) => keyframe.property === boundary.property && keyframe.time === frameTime
			)
		) {
			left.push(
				createBoundaryKeyframe(boundary, frameTime, `${leftIdPrefix}-${boundary.property}`)
			);
		}
		if (!right.some((keyframe) => keyframe.property === boundary.property && keyframe.time === 0)) {
			right.push(createBoundaryKeyframe(boundary, 0, `${rightIdPrefix}-${boundary.property}`));
		}
	}

	left.sort(compareKeyframes);
	right.sort(compareKeyframes);
	return {
		left: left.map((keyframe, index) => ({ ...keyframe, id: `${leftIdPrefix}-${index}` })),
		right: right.map((keyframe, index) => ({ ...keyframe, id: `${rightIdPrefix}-${index}` }))
	};
}

export function trimClipKeyframesStart(
	clip: Clip,
	trimTime: number,
	idPrefix: string
): Keyframe[] | undefined {
	const frameTime = clampClipTimeToFrame(trimTime, clip.duration);
	const properties = getAnimatedProperties(clip.keyframes);
	if (properties.length === 0) return undefined;
	const keyframes = (clip.keyframes ?? [])
		.filter((keyframe) => frameIndex(keyframe.time) >= frameIndex(frameTime))
		.map((keyframe) => ({ ...keyframe, time: roundToFrame(keyframe.time - frameTime) }));

	for (const property of properties) {
		if (keyframes.some((keyframe) => keyframe.property === property && keyframe.time === 0))
			continue;
		const value = interpolateKeyframes(clip.keyframes ?? [], frameTime, property);
		if (value === null) continue;
		keyframes.push(createBoundaryKeyframe({ property, value }, 0, `${idPrefix}-${property}`));
	}

	keyframes.sort(compareKeyframes);
	return keyframes;
}

export function trimClipKeyframesEnd(
	clip: Clip,
	trimTime: number,
	idPrefix: string
): Keyframe[] | undefined {
	const frameTime = clampClipTimeToFrame(trimTime, clip.duration);
	const properties = getAnimatedProperties(clip.keyframes);
	if (properties.length === 0) return undefined;
	const keyframes = (clip.keyframes ?? [])
		.filter((keyframe) => frameIndex(keyframe.time) <= frameIndex(frameTime))
		.map((keyframe) => ({ ...keyframe }));

	for (const property of properties) {
		if (
			keyframes.some(
				(keyframe) =>
					keyframe.property === property && frameIndex(keyframe.time) === frameIndex(frameTime)
			)
		) {
			continue;
		}
		const value = interpolateKeyframes(clip.keyframes ?? [], frameTime, property);
		if (value === null) continue;
		keyframes.push(
			createBoundaryKeyframe({ property, value }, frameTime, `${idPrefix}-${property}`)
		);
	}

	keyframes.sort(compareKeyframes);
	return keyframes;
}

function clampClipTimeToFrame(time: number, duration: number): number {
	const safeTime = Number.isFinite(time) ? time : 0;
	const maxFrame = Math.max(0, Math.floor(duration * FRAME_RATE + Number.EPSILON));
	return Math.min(maxFrame, Math.max(0, Math.round(safeTime * FRAME_RATE))) / FRAME_RATE;
}

function frameIndex(time: number): number {
	return Math.round(time * FRAME_RATE);
}

function compareKeyframes(left: Keyframe, right: Keyframe): number {
	return left.time - right.time || left.property.localeCompare(right.property);
}

function getAnimatedProperties(keyframes: Keyframe[] | undefined): KeyframeProperty[] {
	return [...new Set(keyframes?.map((keyframe) => keyframe.property) ?? [])];
}

function createBoundaryKeyframe(
	value: Pick<Keyframe, 'property' | 'value'>,
	time: number,
	id: string
): Keyframe {
	return { ...value, id, time, easing: 'linear' };
}

function applyEasing(t: number, easing: KeyframeEasing, bezier?: BezierControlPoints): number {
	if (easing === 'linear') return t;
	if (easing === 'ease-in') return t * t;
	if (easing === 'ease-out') return 1 - (1 - t) * (1 - t);
	if (easing === 'ease-in-out') return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
	if (easing === 'bezier' && bezier) return cubicBezierEasing(bezier, t);
	return t;
}

// evaluate the y coordinate of a cubic bezier at x (unit interval). solves for
// the curve parameter via Newton-Raphson, then samples the y component.
function cubicBezierEasing(bezier: BezierControlPoints, x: number): number {
	const [x1, y1, x2, y2] = bezier;
	const clampedX = Math.min(1, Math.max(0, x));

	// derivative of the x component: 3(1-t)²(x1-0) + 6(1-t)t(x2-x1) + 3t²(1-x2)
	const derivative = (t: number) =>
		3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);

	let t = clampedX;
	for (let iteration = 0; iteration < 12; iteration += 1) {
		const error = bezierX(x1, x2, t) - clampedX;
		if (Math.abs(error) < 1e-6) break;
		const slope = derivative(t);
		if (Math.abs(slope) < 1e-6) break;
		t = Math.min(1, Math.max(0, t - error / slope));
	}

	return bezierY(y1, y2, t);
}

function bezierX(x1: number, x2: number, t: number): number {
	const u = 1 - t;
	return 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
}

function bezierY(y1: number, y2: number, t: number): number {
	const u = 1 - t;
	return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
}

export function getColorAdjustFilter(adjust: ColorAdjust | undefined): string {
	if (!adjust) return '';
	if (
		adjust.brightness === 0 &&
		adjust.contrast === 0 &&
		adjust.saturation === 0 &&
		adjust.hue === 0
	) {
		return '';
	}
	const parts: string[] = [];
	if (adjust.brightness !== 0) {
		parts.push(`brightness(${1 + adjust.brightness / 100})`);
	}
	if (adjust.contrast !== 0) {
		parts.push(`contrast(${1 + adjust.contrast / 100})`);
	}
	if (adjust.saturation !== 0) {
		parts.push(`saturate(${1 + adjust.saturation / 100})`);
	}
	if (adjust.hue !== 0) {
		parts.push(`hue-rotate(${adjust.hue}deg)`);
	}
	return parts.join(' ');
}

export function getClipOpacity(clip: Clip, clipTime: number): number {
	return getClipVisualState(clip, clipTime).opacity;
}

export function getClipVisualTransform(clip: Clip, clipTime: number): VisualTransform {
	return getClipVisualState(clip, clipTime).transform;
}

type ClipKeyframeIndex = Record<KeyframeProperty, Keyframe[]>;

const keyframeIndexByClip = new WeakMap<Clip, ClipKeyframeIndex>();

function createClipVisualState(
	transform: VisualTransform,
	opacity: number,
	volume: number,
	audioFadeIn: number,
	audioFadeOut: number,
	colorAdjust: ColorAdjust
): ClipVisualState {
	return {
		transform,
		opacity: Math.max(0, Math.min(1, opacity)),
		volume,
		audioFadeIn,
		audioFadeOut,
		colorAdjust
	};
}
export function getClipVisualState(clip: Clip, clipTime: number): ClipVisualState {
	const base: VisualTransform = { ...DEFAULT_VISUAL_TRANSFORM, ...clip.visualTransform };
	let opacity = clip.opacity ?? 1;
	const baseColorAdjust = clip.colorAdjust ?? DEFAULT_COLOR_ADJUST;
	if (!clip.keyframes || clip.keyframes.length === 0) {
		return createClipVisualState(
			base,
			opacity,
			clip.volume ?? 1,
			clip.audioFadeIn ?? 0,
			clip.audioFadeOut ?? 0,
			baseColorAdjust
		);
	}

	const keyframes = getClipKeyframeIndex(clip);
	const x = resolveKeyframeSeries(keyframes.x, clipTime);
	const y = resolveKeyframeSeries(keyframes.y, clipTime);
	const scale = resolveKeyframeSeries(keyframes.scale, clipTime);
	const rotation = resolveKeyframeSeries(keyframes.rotation, clipTime);
	const keyframeOpacity = resolveKeyframeSeries(keyframes.opacity, clipTime);
	if (keyframeOpacity !== null) opacity = keyframeOpacity / 100;
	return createClipVisualState(
		{
			x: x ?? base.x,
			y: y ?? base.y,
			scale: scale ?? base.scale,
			rotation: rotation ?? base.rotation,
			blendMode: base.blendMode,
			mask: base.mask
		},
		opacity,
		resolveKeyframeSeries(keyframes.volume, clipTime) ?? clip.volume ?? 1,
		resolveKeyframeSeries(keyframes.audioFadeIn, clipTime) ?? clip.audioFadeIn ?? 0,
		resolveKeyframeSeries(keyframes.audioFadeOut, clipTime) ?? clip.audioFadeOut ?? 0,
		{
			brightness:
				resolveKeyframeSeries(keyframes.brightness, clipTime) ?? baseColorAdjust.brightness,
			contrast: resolveKeyframeSeries(keyframes.contrast, clipTime) ?? baseColorAdjust.contrast,
			saturation:
				resolveKeyframeSeries(keyframes.saturation, clipTime) ?? baseColorAdjust.saturation,
			hue: resolveKeyframeSeries(keyframes.hue, clipTime) ?? baseColorAdjust.hue
		}
	);
}

function getClipKeyframeIndex(clip: Clip): ClipKeyframeIndex {
	const cached = keyframeIndexByClip.get(clip);
	if (cached) return cached;
	const index = Object.fromEntries(
		KEYFRAME_PROPERTIES.map((property) => [property, [] as Keyframe[]])
	) as ClipKeyframeIndex;
	for (const keyframe of clip.keyframes ?? []) index[keyframe.property].push(keyframe);
	for (const keyframes of Object.values(index)) {
		keyframes.sort((left, right) => left.time - right.time);
	}
	keyframeIndexByClip.set(clip, index);
	return index;
}

function resolveKeyframeSeries(keyframes: Keyframe[], clipTime: number): number | null {
	if (keyframes.length === 0) return null;
	let low = 0;
	let high = keyframes.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (keyframes[middle].time <= clipTime) {
			low = middle + 1;
			continue;
		}
		high = middle;
	}
	const previous = keyframes[Math.max(0, low - 1)];
	const next = keyframes[Math.min(keyframes.length - 1, low)];
	if (low === 0) return next.value;
	if (low === keyframes.length || previous.time === next.time) return previous.value;
	const progress = (clipTime - previous.time) / (next.time - previous.time);
	const easedProgress = applyEasing(progress, previous.easing, previous.bezier);
	return previous.value + (next.value - previous.value) * easedProgress;
}

export const DEFAULT_VISUAL_TRANSFORM: VisualTransform = {
	x: 50,
	y: 50,
	scale: 1,
	rotation: 0,
	blendMode: 'normal'
};

export const DEFAULT_COLOR_ADJUST: ColorAdjust = {
	brightness: 0,
	contrast: 0,
	saturation: 0,
	hue: 0
};

export const CLIP_SPEED_OPTIONS = [0.25, 0.5, 1, 1.5, 2, 4] as const;

export const MIN_CLIP_SPEED = 0.1;
export const MAX_CLIP_SPEED = 4;
