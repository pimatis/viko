import {
	clampBezierControlPoints,
	clampKeyframeValue,
	DEFAULT_BEZIER_POINTS,
	DEFAULT_FRAME_RATE,
	FRAME_RATE,
	FRAME_RATE_OPTIONS,
	isBlendMode,
	KEYFRAME_PROPERTIES,
	reconcileClipTransitions,
	roundToFrame,
	sanitizeClipMask,
	type Clip,
	type KeyframeProperty,
	type Track
} from '$lib/editor/timeline';
import {
	clampCurvePoints,
	clampFinishFilters,
	clampGradeIntensity,
	clampSecondaryCorrection,
	clampSecondaryPercent,
	clampWheelHue,
	clampWheelSaturation,
	clampWheelStrength,
	cloneColorGrade,
	DEFAULT_COLOR_GRADE,
	DEFAULT_SECONDARY_CORRECTION,
	IDENTITY_CURVE,
	isLutPresetId,
	registerCubeLut,
	type ColorCurvePoint,
	type ColorGrade,
	type ColorWheel,
	type CubeLutRef,
	type FinishFilters,
	type SecondaryCorrection,
	type SecondaryPowerWindow
} from '$lib/grading';
import {
	clampChromaSimilarity,
	clampChromaSmoothness,
	clampChromaSpill,
	DEFAULT_CHROMA_KEY
} from '$lib/chroma';
import { clampTransitionDuration, getEffectPreset, isClipTransitionPreset } from '$lib/effects';
import { clampDuckAmountDb } from '$lib/audio/ducking';
import type { MediaAsset, MediaFolder } from '$lib/editor/sidebar';
import { STICKER_PRESETS } from '$lib/editor/sidebar';
import { TEXT_PRESETS, type TextAnimation, type TextStyle } from '$lib/editor/text';
import {
	PLAYER_ASPECT_RATIO_PRESETS,
	PLAYER_ASPECT_RATIOS,
	type PlayerAspectRatioMode
} from '$lib/editor/player';
import type { ProjectDocument } from '$lib/db';
import {
	MAX_PROJECT_ASSETS,
	MAX_PROJECT_FOLDERS,
	MAX_PROJECT_TIME,
	MAX_PROJECT_TRACKS,
	MAX_TRACK_CLIPS,
	PROJECT_FORMAT,
	PROJECT_VERSION,
	SAFE_COLOR_PATTERN
} from '$lib/editor/constants';

const allowedFonts = new Set(TEXT_PRESETS.map((preset) => preset.textStyle.fontFamily));
const allowedTextAnimations = new Set<TextAnimation>(['lower-third-slide', 'lower-third-pop']);
const allowedStickers = new Set(STICKER_PRESETS.map((preset) => preset.sticker));

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isValidAspectRatio(value: unknown): value is { width: number; height: number } {
	return (
		isRecord(value) &&
		typeof value.width === 'number' &&
		Number.isFinite(value.width) &&
		value.width > 0 &&
		typeof value.height === 'number' &&
		Number.isFinite(value.height) &&
		value.height > 0
	);
}

function sanitizeWheel(value: unknown): ColorWheel {
	if (!isRecord(value)) return { hue: 0, saturation: 0, strength: 0 };
	return {
		hue: typeof value.hue === 'number' ? clampWheelHue(value.hue) : 0,
		saturation: typeof value.saturation === 'number' ? clampWheelSaturation(value.saturation) : 0,
		strength: typeof value.strength === 'number' ? clampWheelStrength(value.strength) : 0
	};
}

function sanitizeCurve(value: unknown): ColorCurvePoint[] | null {
	if (!Array.isArray(value)) return null;
	const points: ColorCurvePoint[] = [];
	for (const point of value) {
		if (points.length >= 17) break;
		if (!isRecord(point)) continue;
		if (typeof point.x !== 'number' || typeof point.y !== 'number') continue;
		if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
		points.push({ x: point.x, y: point.y });
	}
	if (points.length < 2) return null;
	return clampCurvePoints(points);
}

function sanitizeSecondary(value: unknown): SecondaryCorrection {
	if (!isRecord(value)) return { ...DEFAULT_SECONDARY_CORRECTION };
	const windowValue = isRecord(value.window) ? value.window : {};
	const window: SecondaryPowerWindow = {
		type: windowValue.type === 'ellipse' || windowValue.type === 'rect' ? windowValue.type : 'full',
		cx: clampSecondaryPercent(typeof windowValue.cx === 'number' ? windowValue.cx : 50, 50),
		cy: clampSecondaryPercent(typeof windowValue.cy === 'number' ? windowValue.cy : 50, 50),
		width: clampSecondaryPercent(
			typeof windowValue.width === 'number' ? windowValue.width : 100,
			100
		),
		height: clampSecondaryPercent(
			typeof windowValue.height === 'number' ? windowValue.height : 100,
			100
		),
		feather: clampSecondaryPercent(
			typeof windowValue.feather === 'number' ? windowValue.feather : 20,
			20
		)
	};
	return clampSecondaryCorrection({
		enabled: value.enabled === true,
		hue: typeof value.hue === 'number' ? value.hue : DEFAULT_SECONDARY_CORRECTION.hue,
		hueRange:
			typeof value.hueRange === 'number' ? value.hueRange : DEFAULT_SECONDARY_CORRECTION.hueRange,
		satCenter:
			typeof value.satCenter === 'number'
				? value.satCenter
				: DEFAULT_SECONDARY_CORRECTION.satCenter,
		satRange:
			typeof value.satRange === 'number' ? value.satRange : DEFAULT_SECONDARY_CORRECTION.satRange,
		lumaCenter:
			typeof value.lumaCenter === 'number'
				? value.lumaCenter
				: DEFAULT_SECONDARY_CORRECTION.lumaCenter,
		lumaRange:
			typeof value.lumaRange === 'number'
				? value.lumaRange
				: DEFAULT_SECONDARY_CORRECTION.lumaRange,
		softness:
			typeof value.softness === 'number' ? value.softness : DEFAULT_SECONDARY_CORRECTION.softness,
		lumaWeight:
			typeof value.lumaWeight === 'number'
				? value.lumaWeight
				: DEFAULT_SECONDARY_CORRECTION.lumaWeight,
		hueShift:
			typeof value.hueShift === 'number' ? value.hueShift : DEFAULT_SECONDARY_CORRECTION.hueShift,
		saturation:
			typeof value.saturation === 'number'
				? value.saturation
				: DEFAULT_SECONDARY_CORRECTION.saturation,
		brightness:
			typeof value.brightness === 'number'
				? value.brightness
				: DEFAULT_SECONDARY_CORRECTION.brightness,
		contrast:
			typeof value.contrast === 'number' ? value.contrast : DEFAULT_SECONDARY_CORRECTION.contrast,
		amount: typeof value.amount === 'number' ? value.amount : DEFAULT_SECONDARY_CORRECTION.amount,
		window
	});
}

function sanitizeCubeLut(value: unknown): CubeLutRef | null {
	if (!isRecord(value)) return null;
	if (typeof value.name !== 'string' || typeof value.source !== 'string') return null;
	const name = value.name.trim().slice(0, 120);
	const source = value.source.slice(0, 400_000);
	if (!name || !source) return null;
	try {
		const lut = registerCubeLut(name, source);
		return { id: lut.id, name: lut.name, source: lut.source };
	} catch {
		return null;
	}
}

function sanitizeFinish(value: unknown): FinishFilters {
	if (!isRecord(value)) return { vignette: 0, grain: 0, sharpen: 0, denoise: 0 };
	return clampFinishFilters({
		vignette: typeof value.vignette === 'number' ? value.vignette : 0,
		grain: typeof value.grain === 'number' ? value.grain : 0,
		sharpen: typeof value.sharpen === 'number' ? value.sharpen : 0,
		denoise: typeof value.denoise === 'number' ? value.denoise : 0
	});
}

function sanitizeColorGrade(value: unknown): ColorGrade | undefined {
	if (!isRecord(value)) return undefined;
	const identity = [...IDENTITY_CURVE];
	const curves = isRecord(value.curves)
		? {
				master: sanitizeCurve(value.curves.master) ?? identity,
				red: sanitizeCurve(value.curves.red) ?? identity,
				green: sanitizeCurve(value.curves.green) ?? identity,
				blue: sanitizeCurve(value.curves.blue) ?? identity
			}
		: { master: identity, red: identity, green: identity, blue: identity };
	return {
		shadows: sanitizeWheel(value.shadows),
		midtones: sanitizeWheel(value.midtones),
		highlights: sanitizeWheel(value.highlights),
		master: sanitizeWheel(value.master),
		curves,
		lutId: typeof value.lutId === 'string' && isLutPresetId(value.lutId) ? value.lutId : null,
		customLut: sanitizeCubeLut(value.customLut),
		secondary: sanitizeSecondary(value.secondary),
		finish: sanitizeFinish(value.finish),
		intensity: typeof value.intensity === 'number' ? clampGradeIntensity(value.intensity) : 100
	};
}

function sanitizeClip(value: unknown): Clip | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
	if (typeof value.startTime !== 'number' || typeof value.duration !== 'number') return null;
	if (!Number.isFinite(value.startTime) || !Number.isFinite(value.duration)) return null;
	if (
		value.startTime < 0 ||
		value.startTime > MAX_PROJECT_TIME ||
		value.duration <= 0 ||
		value.duration > MAX_PROJECT_TIME
	) {
		return null;
	}
	const clipDuration = value.duration;
	const textStyle = isRecord(value.textStyle)
		? {
				fontFamily: value.textStyle.fontFamily,
				fontSize: value.textStyle.fontSize,
				fontWeight: value.textStyle.fontWeight,
				color: value.textStyle.color,
				backgroundColor: value.textStyle.backgroundColor,
				textAlign: value.textStyle.textAlign,
				textTransform: value.textStyle.textTransform
			}
		: null;
	const validTextStyle =
		textStyle &&
		allowedFonts.has(textStyle.fontFamily as TextStyle['fontFamily']) &&
		typeof textStyle.fontSize === 'number' &&
		textStyle.fontSize >= 8 &&
		textStyle.fontSize <= 200 &&
		typeof textStyle.fontWeight === 'number' &&
		textStyle.fontWeight >= 100 &&
		textStyle.fontWeight <= 900 &&
		typeof textStyle.color === 'string' &&
		SAFE_COLOR_PATTERN.test(textStyle.color) &&
		typeof textStyle.backgroundColor === 'string' &&
		(textStyle.backgroundColor === 'transparent' ||
			SAFE_COLOR_PATTERN.test(textStyle.backgroundColor)) &&
		['left', 'center', 'right'].includes(String(textStyle.textAlign)) &&
		['none', 'uppercase'].includes(String(textStyle.textTransform));
	const effects = Array.isArray(value.effects)
		? value.effects.flatMap((effect) => {
				if (!isRecord(effect)) return [];
				if (typeof effect.id !== 'string' || typeof effect.presetId !== 'string') return [];
				if (!getEffectPreset(effect.presetId)) return [];
				return [{ id: effect.id.slice(0, 200), presetId: effect.presetId }];
			})
		: undefined;
	const clipTransition = isRecord(value.clipTransition)
		? {
				presetId:
					typeof value.clipTransition.presetId === 'string' ? value.clipTransition.presetId : null,
				duration:
					typeof value.clipTransition.duration === 'number' ? value.clipTransition.duration : null,
				incomingClipId:
					typeof value.clipTransition.incomingClipId === 'string'
						? value.clipTransition.incomingClipId
						: null
			}
		: null;
	const sanitizedClipTransition = (() => {
		if (!clipTransition) return undefined;
		if (clipTransition.presetId === null || !isClipTransitionPreset(clipTransition.presetId)) {
			return undefined;
		}
		if (clipTransition.duration === null || !Number.isFinite(clipTransition.duration)) {
			return undefined;
		}
		if (clipTransition.incomingClipId === null || clipTransition.incomingClipId.length === 0) {
			return undefined;
		}
		return {
			presetId: clipTransition.presetId,
			duration: clampTransitionDuration(clipTransition.duration),
			incomingClipId: clipTransition.incomingClipId.slice(0, 200)
		};
	})();
	const sequenceTracks =
		isRecord(value.sequence) && Array.isArray(value.sequence.tracks)
			? value.sequence.tracks.slice(0, MAX_PROJECT_TRACKS).flatMap((track) => {
					const sanitized = sanitizeTrack(track);
					return sanitized ? [sanitized] : [];
				})
			: [];

	return {
		id: value.id.slice(0, 200),
		name: value.name.trim().slice(0, 500) || 'Untitled clip',
		startTime: roundToFrame(value.startTime),
		duration: Math.max(1 / FRAME_RATE, roundToFrame(clipDuration)),
		assetId: typeof value.assetId === 'string' ? value.assetId.slice(0, 200) : undefined,
		sourceInstanceId:
			typeof value.sourceInstanceId === 'string'
				? value.sourceInstanceId.slice(0, 200)
				: value.id.slice(0, 200),
		sourceStart:
			typeof value.sourceStart === 'number' && value.sourceStart >= 0
				? roundToFrame(value.sourceStart)
				: undefined,
		sourceDuration:
			typeof value.sourceDuration === 'number' &&
			value.sourceDuration > 0 &&
			value.sourceDuration <= MAX_PROJECT_TIME
				? roundToFrame(value.sourceDuration)
				: undefined,
		textStyle: validTextStyle ? (textStyle as TextStyle) : undefined,
		textAnimation:
			typeof value.textAnimation === 'string' &&
			allowedTextAnimations.has(value.textAnimation as TextAnimation)
				? (value.textAnimation as TextAnimation)
				: undefined,
		caption: value.caption === true ? true : undefined,
		sticker:
			typeof value.sticker === 'string' && allowedStickers.has(value.sticker)
				? value.sticker
				: undefined,
		stickerColor:
			typeof value.stickerColor === 'string' && SAFE_COLOR_PATTERN.test(value.stickerColor)
				? value.stickerColor
				: undefined,
		visualTransform:
			isRecord(value.visualTransform) &&
			typeof value.visualTransform.x === 'number' &&
			typeof value.visualTransform.y === 'number' &&
			Number.isFinite(value.visualTransform.x) &&
			Number.isFinite(value.visualTransform.y)
				? {
						x: Math.min(150, Math.max(-50, value.visualTransform.x)),
						y: Math.min(150, Math.max(-50, value.visualTransform.y)),
						scale:
							typeof value.visualTransform.scale === 'number' &&
							Number.isFinite(value.visualTransform.scale)
								? Math.min(4, Math.max(0.1, value.visualTransform.scale))
								: 1,
						rotation:
							typeof value.visualTransform.rotation === 'number' &&
							Number.isFinite(value.visualTransform.rotation)
								? Math.min(360, Math.max(-360, value.visualTransform.rotation))
								: 0,
						blendMode: isBlendMode(value.visualTransform.blendMode)
							? value.visualTransform.blendMode
							: 'normal',
						mask: sanitizeClipMask(value.visualTransform.mask) ?? undefined
					}
				: undefined,
		effects,
		clipTransition: sanitizedClipTransition,
		speed:
			typeof value.speed === 'number' && value.speed > 0 && value.speed <= 10
				? value.speed
				: undefined,
		volume:
			typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 4
				? value.volume
				: undefined,
		audioFadeIn:
			typeof value.audioFadeIn === 'number' && value.audioFadeIn >= 0 && value.audioFadeIn <= 5
				? value.audioFadeIn
				: undefined,
		audioFadeOut:
			typeof value.audioFadeOut === 'number' && value.audioFadeOut >= 0 && value.audioFadeOut <= 5
				? value.audioFadeOut
				: undefined,
		duckSource: value.duckSource === true ? true : undefined,
		duckAmountDb:
			typeof value.duckAmountDb === 'number' && Number.isFinite(value.duckAmountDb)
				? clampDuckAmountDb(value.duckAmountDb)
				: undefined,
		reversed: value.reversed === true ? true : undefined,
		frozen: value.frozen === true ? true : undefined,
		opacity:
			typeof value.opacity === 'number' && value.opacity >= 0 && value.opacity <= 1
				? value.opacity
				: undefined,
		colorAdjust: isRecord(value.colorAdjust)
			? {
					brightness:
						typeof value.colorAdjust.brightness === 'number' &&
						value.colorAdjust.brightness >= -100 &&
						value.colorAdjust.brightness <= 100
							? value.colorAdjust.brightness
							: 0,
					contrast:
						typeof value.colorAdjust.contrast === 'number' &&
						value.colorAdjust.contrast >= -100 &&
						value.colorAdjust.contrast <= 100
							? value.colorAdjust.contrast
							: 0,
					saturation:
						typeof value.colorAdjust.saturation === 'number' &&
						value.colorAdjust.saturation >= -100 &&
						value.colorAdjust.saturation <= 100
							? value.colorAdjust.saturation
							: 0,
					hue:
						typeof value.colorAdjust.hue === 'number' &&
						value.colorAdjust.hue >= -180 &&
						value.colorAdjust.hue <= 180
							? value.colorAdjust.hue
							: 0
				}
			: undefined,
		colorGrade: sanitizeColorGrade(value.colorGrade),
		chromaKey: isRecord(value.chromaKey)
			? {
					enabled: value.chromaKey.enabled === true,
					keyColor:
						typeof value.chromaKey.keyColor === 'string' &&
						/^#[0-9a-f]{6}$/i.test(value.chromaKey.keyColor)
							? value.chromaKey.keyColor.toLowerCase()
							: DEFAULT_CHROMA_KEY.keyColor,
					similarity: clampChromaSimilarity(
						typeof value.chromaKey.similarity === 'number'
							? value.chromaKey.similarity
							: DEFAULT_CHROMA_KEY.similarity
					),
					smoothness: clampChromaSmoothness(
						typeof value.chromaKey.smoothness === 'number'
							? value.chromaKey.smoothness
							: DEFAULT_CHROMA_KEY.smoothness
					),
					spillSuppression: clampChromaSpill(
						typeof value.chromaKey.spillSuppression === 'number'
							? value.chromaKey.spillSuppression
							: DEFAULT_CHROMA_KEY.spillSuppression
					)
				}
			: undefined,
		keyframes: Array.isArray(value.keyframes)
			? value.keyframes.flatMap((kf) => {
					if (!isRecord(kf) || typeof kf.id !== 'string') return [];
					if (typeof kf.time !== 'number' || typeof kf.value !== 'number') return [];
					if (!Number.isFinite(kf.time) || !Number.isFinite(kf.value)) return [];
					if (
						typeof kf.property !== 'string' ||
						!KEYFRAME_PROPERTIES.includes(kf.property as KeyframeProperty)
					) {
						return [];
					}
					const property = kf.property as KeyframeProperty;
					return [
						{
							id: kf.id.slice(0, 200),
							time: Math.min(clipDuration, roundToFrame(Math.max(0, kf.time))),
							property,
							value: clampKeyframeValue(property, kf.value),
							easing:
								kf.easing === 'ease-in' || kf.easing === 'ease-out'
									? kf.easing
									: kf.easing === 'ease-in-out'
										? 'ease-in-out'
										: kf.easing === 'bezier'
											? 'bezier'
											: 'linear',
							bezier:
								kf.easing === 'bezier'
									? (clampBezierControlPoints(kf.bezier) ?? DEFAULT_BEZIER_POINTS)
									: undefined
						}
					];
				})
			: undefined,
		groupId: typeof value.groupId === 'string' ? value.groupId.slice(0, 200) : undefined,
		sequence: sequenceTracks.length > 0 ? { tracks: sequenceTracks } : undefined
	};
}

function sanitizeTrack(value: unknown): Track | null {
	if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
		return null;
	}
	if (
		value.type !== 'video' &&
		value.type !== 'audio' &&
		value.type !== 'subtitle' &&
		value.type !== 'adjustment'
	) {
		return null;
	}
	if (!Array.isArray(value.clips)) return null;
	const clips = value.clips.slice(0, MAX_TRACK_CLIPS).flatMap((clip) => {
		const sanitized = sanitizeClip(clip);
		return sanitized ? [sanitized] : [];
	});
	const [reconciledTrack] = reconcileClipTransitions([
		{
			id: value.id.slice(0, 200),
			name: value.name.trim().slice(0, 80) || 'Untitled track',
			type: value.type,
			color: typeof value.color === 'string' ? value.color.slice(0, 30) : 'blue',
			clips,
			muted: value.muted === true,
			locked: value.locked === true,
			volume:
				typeof value.volume === 'number' && Number.isFinite(value.volume)
					? Math.min(2, Math.max(0, value.volume))
					: 1,
			pan:
				typeof value.pan === 'number' && Number.isFinite(value.pan)
					? Math.min(1, Math.max(-1, value.pan))
					: 0
		}
	]);
	return reconciledTrack;
}

function sanitizeMediaAsset(value: unknown): MediaAsset | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
	if (value.kind !== 'video' && value.kind !== 'audio' && value.kind !== 'image') return null;
	if (
		typeof value.src !== 'string' ||
		value.src.length > 10_000 ||
		!/^(blob:|https?:)/.test(value.src)
	) {
		return null;
	}
	return {
		id: value.id.slice(0, 200),
		name: value.name.trim().slice(0, 255) || 'Untitled asset',
		kind: value.kind,
		src: value.src,
		mimeType: typeof value.mimeType === 'string' ? value.mimeType.slice(0, 200) : '',
		size: typeof value.size === 'number' && value.size >= 0 ? value.size : 0,
		duration: typeof value.duration === 'number' && value.duration > 0 ? value.duration : null,
		width:
			typeof value.width === 'number' &&
			Number.isInteger(value.width) &&
			value.width >= 1 &&
			value.width <= 16384
				? value.width
				: null,
		height:
			typeof value.height === 'number' &&
			Number.isInteger(value.height) &&
			value.height >= 1 &&
			value.height <= 16384
				? value.height
				: null,
		playbackSupported:
			typeof value.playbackSupported === 'boolean' ? value.playbackSupported : null,
		createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
		folderId: typeof value.folderId === 'string' ? value.folderId : null
	};
}

function sanitizeMediaFolder(value: unknown): MediaFolder | null {
	if (!isRecord(value)) return null;
	if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
	return {
		id: value.id.slice(0, 200),
		name: value.name.trim().slice(0, 120) || 'Untitled folder',
		createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now()
	};
}

export function parseProjectDocument(value: unknown): ProjectDocument | null {
	if (!isRecord(value) || value.format !== PROJECT_FORMAT || value.version !== PROJECT_VERSION) {
		return null;
	}
	if (typeof value.name !== 'string' || !Array.isArray(value.tracks)) return null;
	const rawAssets = Array.isArray(value.mediaAssets) ? value.mediaAssets : [];
	const rawMarkers = Array.isArray(value.markers) ? value.markers : [];
	const rawFolders = Array.isArray(value.mediaFolders) ? value.mediaFolders : [];
	const mediaFolders = rawFolders.slice(0, MAX_PROJECT_FOLDERS).flatMap((folder) => {
		const sanitized = sanitizeMediaFolder(folder);
		return sanitized ? [sanitized] : [];
	});
	const folderIds = new Set(mediaFolders.map((folder) => folder.id));
	return {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		name: value.name.trim().slice(0, 120) || 'Untitled Project',
		tracks: value.tracks.slice(0, MAX_PROJECT_TRACKS).flatMap((track) => {
			const sanitized = sanitizeTrack(track);
			return sanitized ? [sanitized] : [];
		}),
		mediaAssets: rawAssets.slice(0, MAX_PROJECT_ASSETS).flatMap((asset) => {
			const sanitized = sanitizeMediaAsset(asset);
			if (!sanitized) return [];
			if (sanitized.folderId && !folderIds.has(sanitized.folderId)) {
				return [{ ...sanitized, folderId: null }];
			}
			return [sanitized];
		}),
		mediaFolders,
		markers: rawMarkers.slice(0, 200).flatMap((marker) => {
			if (!isRecord(marker) || typeof marker.id !== 'string' || typeof marker.time !== 'number')
				return [];
			return [
				{
					id: marker.id.slice(0, 200),
					time: Math.max(0, Math.min(MAX_PROJECT_TIME, marker.time)),
					label: typeof marker.label === 'string' ? marker.label.slice(0, 100) : '',
					color: typeof marker.color === 'string' ? marker.color.slice(0, 30) : '#ef4444'
				}
			];
		}),
		aspectRatio: isValidAspectRatio(value.aspectRatio)
			? { width: value.aspectRatio.width, height: value.aspectRatio.height }
			: { width: 16, height: 9 },
		aspectRatioMode:
			typeof value.aspectRatioMode === 'string' &&
			(value.aspectRatioMode === 'auto' ||
				(PLAYER_ASPECT_RATIO_PRESETS as readonly string[]).includes(value.aspectRatioMode))
				? (value.aspectRatioMode as PlayerAspectRatioMode)
				: 'auto',
		frameRate:
			typeof value.frameRate === 'number' &&
			(FRAME_RATE_OPTIONS as readonly number[]).includes(value.frameRate)
				? value.frameRate
				: DEFAULT_FRAME_RATE,
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now()
	};
}
