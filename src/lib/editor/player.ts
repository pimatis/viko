import type { MediaAsset } from './sidebar';
import type { Clip, Track, TrackType, VisualTransform } from './timeline';
import { getClipSourceTime } from './timeline';
import { getClipPairTransitionProgress, type TransitionRole } from '$lib/effects';

export type PlayerAspectRatio = { width: number; height: number };

export type PlayerAspectRatioPresetId = '16:9' | '9:16' | '1:1' | '4:3' | '4:5';
export type PlayerAspectRatioMode = PlayerAspectRatioPresetId | 'auto';

export const PLAYER_ASPECT_RATIOS: Record<PlayerAspectRatioPresetId, PlayerAspectRatio> = {
	'16:9': { width: 16, height: 9 },
	'9:16': { width: 9, height: 16 },
	'1:1': { width: 1, height: 1 },
	'4:3': { width: 4, height: 3 },
	'4:5': { width: 4, height: 5 }
};

export const PLAYER_ASPECT_RATIO_PRESETS = Object.keys(
	PLAYER_ASPECT_RATIOS
) as PlayerAspectRatioPresetId[];

export type SocialTemplateId = 'reels' | 'portrait' | 'square' | 'landscape';

export type SocialTemplate = {
	id: SocialTemplateId;
	name: string;
	platform: string;
	ratioLabel: PlayerAspectRatioPresetId;
	resolutionLabel: string;
	ratio: PlayerAspectRatio;
	description: string;
};

export const SOCIAL_TEMPLATES: SocialTemplate[] = [
	{
		id: 'reels',
		name: 'Reels / Shorts',
		platform: 'Instagram · TikTok · YouTube',
		ratioLabel: '9:16',
		resolutionLabel: '1080×1920',
		ratio: { width: 9, height: 16 },
		description: 'Vertical video for Instagram Reels, TikTok and YouTube Shorts.'
	},
	{
		id: 'portrait',
		name: 'Portrait',
		platform: 'Instagram · Facebook feed',
		ratioLabel: '4:5',
		resolutionLabel: '1080×1350',
		ratio: { width: 4, height: 5 },
		description: 'Tall feed post that fills most of a mobile screen.'
	},
	{
		id: 'square',
		name: 'Square',
		platform: 'Instagram · Facebook feed',
		ratioLabel: '1:1',
		resolutionLabel: '1080×1080',
		ratio: { width: 1, height: 1 },
		description: 'Classic square post for feeds and carousels.'
	},
	{
		id: 'landscape',
		name: 'Landscape',
		platform: 'YouTube · Desktop',
		ratioLabel: '16:9',
		resolutionLabel: '1920×1080',
		ratio: { width: 16, height: 9 },
		description: 'Widescreen format for YouTube and desktop playback.'
	}
];

/** fit the template ratio inside a square thumbnail box, in px */
export function getTemplatePreviewSize(
	template: SocialTemplate,
	maxSide = 30
): { width: number; height: number } {
	const ratio = template.ratio.width / template.ratio.height;
	if (ratio >= 1) {
		return { width: maxSide, height: Math.max(2, Math.round(maxSide / ratio)) };
	}
	return { width: Math.max(2, Math.round(maxSide * ratio)), height: maxSide };
}

export function detectPlayerAspectRatio(width: number, height: number): PlayerAspectRatio | null {
	if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
	if (width <= 0 || height <= 0) return null;
	return { width: Math.round(width), height: Math.round(height) };
}

export function formatPlayerAspectRatio(ratio: PlayerAspectRatio): string {
	if (!isValidPlayerAspectRatio(ratio)) return '16:9';
	const width = Math.round(ratio.width);
	const height = Math.round(ratio.height);
	const divisor = gcd(width, height);
	const reducedWidth = width / divisor;
	const reducedHeight = height / divisor;
	if (reducedWidth <= 99 && reducedHeight <= 99) return `${reducedWidth}:${reducedHeight}`;
	return `${width}x${height}`;
}

function gcd(left: number, right: number): number {
	let a = Math.max(1, Math.round(left));
	let b = Math.max(1, Math.round(right));
	while (b !== 0) {
		const remainder = a % b;
		a = b;
		b = remainder;
	}
	return Math.max(1, a);
}

function isValidPlayerAspectRatio(ratio: PlayerAspectRatio): boolean {
	return (
		Number.isFinite(ratio.width) &&
		Number.isFinite(ratio.height) &&
		ratio.width > 0 &&
		ratio.height > 0
	);
}

export const PLAYER_PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2] as const;
export { DEFAULT_VISUAL_TRANSFORM } from './timeline';
export const PLAYER_SNAP_TARGETS = [0, 50, 100] as const;

export type PlayerLayer = {
	clip: Clip;
	trackId: string;
	trackType: TrackType;
	trackMuted: boolean;
	trackLocked: boolean;
	asset: MediaAsset | null;
	sourceTime: number;
	clipTime: number;
	transitionRole?: TransitionRole;
	transitionProgress?: number;
	transitionPresetId?: string;
};

export function getActivePlayerLayers(
	tracks: Track[],
	assetsById: ReadonlyMap<string, MediaAsset>,
	currentTime: number
): PlayerLayer[] {
	const activeLayers: PlayerLayer[] = [];
	for (const track of tracks) {
		const sortedClips = [...track.clips].sort((left, right) => left.startTime - right.startTime);
		for (const clip of sortedClips) {
			const clipEnd = clip.startTime + clip.duration;
			if (currentTime < clip.startTime || currentTime >= clipEnd) continue;
			const clipTime = Math.max(0, currentTime - clip.startTime);
			const sourceTime = getClipSourceTime(clip, clipTime);
			activeLayers.push({
				clip,
				trackId: track.id,
				trackType: track.type,
				trackMuted: track.muted,
				trackLocked: track.locked,
				asset: clip.assetId ? (assetsById.get(clip.assetId) ?? null) : null,
				sourceTime,
				clipTime
			});
		}

		// annotate overlapping clip pairs with their shared transition state
		for (let i = 0; i < sortedClips.length - 1; i++) {
			const outgoing = sortedClips[i];
			if (!outgoing.clipTransition) continue;
			const incoming = sortedClips.find(
				(clip) => clip.id === outgoing.clipTransition?.incomingClipId
			);
			if (!incoming) continue;
			const progress = getClipPairTransitionProgress(outgoing, incoming, currentTime);
			if (progress === null) continue;
			const presetId = outgoing.clipTransition.presetId;
			const outgoingLayer = activeLayers.find((layer) => layer.clip.id === outgoing.id);
			const incomingLayer = activeLayers.find((layer) => layer.clip.id === incoming.id);
			if (outgoingLayer) {
				outgoingLayer.transitionRole = 'outgoing';
				outgoingLayer.transitionProgress = progress;
				outgoingLayer.transitionPresetId = presetId;
			}
			if (incomingLayer) {
				incomingLayer.transitionRole = 'incoming';
				incomingLayer.transitionProgress = progress;
				incomingLayer.transitionPresetId = presetId;
			}
		}
	}
	return activeLayers;
}

export function snapVisualPosition(
	position: VisualTransform,
	threshold: Pick<VisualTransform, 'x' | 'y'>
): { transform: VisualTransform; guideX: number | null; guideY: number | null } {
	let x = Math.min(150, Math.max(-50, position.x));
	let y = Math.min(150, Math.max(-50, position.y));
	let guideX: number | null = null;
	let guideY: number | null = null;

	for (const target of PLAYER_SNAP_TARGETS) {
		if (Math.abs(x - target) > threshold.x) continue;
		x = target;
		guideX = target;
		break;
	}
	for (const target of PLAYER_SNAP_TARGETS) {
		if (Math.abs(y - target) > threshold.y) continue;
		y = target;
		guideY = target;
		break;
	}

	return {
		transform: {
			x,
			y,
			scale: position.scale,
			rotation: position.rotation,
			blendMode: position.blendMode,
			mask: position.mask
		},
		guideX,
		guideY
	};
}

export function formatPlayerTime(seconds: number): string {
	const safeSeconds = Math.max(0, seconds);
	const hours = Math.floor(safeSeconds / 3600);
	const minutes = Math.floor((safeSeconds % 3600) / 60);
	const wholeSeconds = Math.floor(safeSeconds % 60);
	const frames = Math.floor((safeSeconds % 1) * 30);
	return [hours, minutes, wholeSeconds, frames]
		.map((part) => String(part).padStart(2, '0'))
		.join(':');
}
