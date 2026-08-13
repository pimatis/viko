import type {
	ColorCurvePoint,
	ColorCurves,
	ColorGrade,
	ColorWheel,
	FinishFilters,
	SecondaryCorrection,
	SecondaryPowerWindow
} from './types';

export const DEFAULT_COLOR_WHEEL: ColorWheel = { hue: 0, saturation: 0, strength: 0 };

export const DEFAULT_FINISH_FILTERS: FinishFilters = {
	vignette: 0,
	grain: 0,
	sharpen: 0,
	denoise: 0
};

export const IDENTITY_CURVE: ColorCurvePoint[] = [
	{ x: 0, y: 0 },
	{ x: 1, y: 1 }
];

export const DEFAULT_COLOR_CURVES: ColorCurves = {
	master: [...IDENTITY_CURVE],
	red: [...IDENTITY_CURVE],
	green: [...IDENTITY_CURVE],
	blue: [...IDENTITY_CURVE]
};

export const DEFAULT_SECONDARY_WINDOW: SecondaryPowerWindow = {
	type: 'full',
	cx: 50,
	cy: 50,
	width: 100,
	height: 100,
	feather: 20
};

export const DEFAULT_SECONDARY_CORRECTION: SecondaryCorrection = {
	enabled: false,
	hue: 0,
	hueRange: 60,
	satCenter: 50,
	satRange: 100,
	lumaCenter: 50,
	lumaRange: 100,
	softness: 30,
	lumaWeight: 50,
	hueShift: 0,
	saturation: 0,
	brightness: 0,
	contrast: 0,
	amount: 100,
	window: { ...DEFAULT_SECONDARY_WINDOW }
};

export const DEFAULT_COLOR_GRADE: ColorGrade = {
	shadows: { ...DEFAULT_COLOR_WHEEL },
	midtones: { ...DEFAULT_COLOR_WHEEL },
	highlights: { ...DEFAULT_COLOR_WHEEL },
	master: { ...DEFAULT_COLOR_WHEEL },
	curves: {
		master: [...IDENTITY_CURVE],
		red: [...IDENTITY_CURVE],
		green: [...IDENTITY_CURVE],
		blue: [...IDENTITY_CURVE]
	},
	lutId: null,
	customLut: null,
	secondary: { ...DEFAULT_SECONDARY_CORRECTION },
	finish: { ...DEFAULT_FINISH_FILTERS },
	intensity: 100
};

export const MAX_CURVE_POINTS = 17;

// fixed per-range approximation weights used by the css preview path
// luma-keyed wheels cannot be expressed exactly in css filters
export const SHADOW_BAND_WEIGHT = 0.28;
export const MIDTONE_BAND_WEIGHT = 0.44;
export const HIGHLIGHT_BAND_WEIGHT = 0.28;

export function clampWheelHue(hue: number): number {
	if (!Number.isFinite(hue)) return DEFAULT_COLOR_WHEEL.hue;
	return Math.min(180, Math.max(-180, hue));
}

export function clampWheelSaturation(saturation: number): number {
	if (!Number.isFinite(saturation)) return DEFAULT_COLOR_WHEEL.saturation;
	return Math.min(100, Math.max(-100, saturation));
}

export function clampWheelStrength(strength: number): number {
	if (!Number.isFinite(strength)) return DEFAULT_COLOR_WHEEL.strength;
	return Math.min(100, Math.max(0, strength));
}

export function clampGradeIntensity(intensity: number): number {
	if (!Number.isFinite(intensity)) return DEFAULT_COLOR_GRADE.intensity;
	return Math.min(100, Math.max(0, intensity));
}

export function clampFinishValue(value: number | undefined): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

export function clampFinishFilters(value: Partial<FinishFilters> | undefined): FinishFilters {
	return {
		vignette: clampFinishValue(value?.vignette),
		grain: clampFinishValue(value?.grain),
		sharpen: clampFinishValue(value?.sharpen),
		denoise: clampFinishValue(value?.denoise)
	};
}

export function isFinishActive(finish: FinishFilters | undefined): boolean {
	if (!finish) return false;
	return finish.vignette > 0 || finish.grain > 0 || finish.sharpen > 0 || finish.denoise > 0;
}

export function clampSecondaryHue(hue: number): number {
	if (!Number.isFinite(hue)) return DEFAULT_SECONDARY_CORRECTION.hue;
	return Math.min(360, Math.max(0, hue));
}

export function clampSecondaryRange(value: number): number {
	if (!Number.isFinite(value)) return 60;
	return Math.min(180, Math.max(1, value));
}

export function clampSecondaryPercent(value: number, fallback = 50): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.min(100, Math.max(0, value));
}

export function clampSecondaryWindow(value: SecondaryPowerWindow): SecondaryPowerWindow {
	return {
		type: value.type === 'ellipse' || value.type === 'rect' ? value.type : 'full',
		cx: clampSecondaryPercent(value.cx, 50),
		cy: clampSecondaryPercent(value.cy, 50),
		width: clampSecondaryPercent(value.width, 100),
		height: clampSecondaryPercent(value.height, 100),
		feather: clampSecondaryPercent(value.feather, 20)
	};
}

export function clampSecondaryCorrection(value: SecondaryCorrection): SecondaryCorrection {
	return {
		enabled: value.enabled === true,
		hue: clampSecondaryHue(value.hue),
		hueRange: clampSecondaryRange(value.hueRange),
		satCenter: clampSecondaryPercent(value.satCenter, 50),
		satRange: Math.min(100, Math.max(1, clampSecondaryPercent(value.satRange, 100))),
		lumaCenter: clampSecondaryPercent(value.lumaCenter, 50),
		lumaRange: Math.min(100, Math.max(1, clampSecondaryPercent(value.lumaRange, 100))),
		softness: clampSecondaryPercent(value.softness, 30),
		lumaWeight: clampSecondaryPercent(value.lumaWeight, 50),
		hueShift: clampWheelHue(value.hueShift),
		saturation: clampWheelSaturation(value.saturation),
		brightness: clampWheelSaturation(value.brightness),
		contrast: clampWheelSaturation(value.contrast),
		amount: clampSecondaryPercent(value.amount, 100),
		window: clampSecondaryWindow(value.window)
	};
}

export function isSecondaryActive(secondary: SecondaryCorrection | undefined): boolean {
	if (!secondary?.enabled) return false;
	if (secondary.amount <= 0) return false;
	return (
		secondary.hueShift !== 0 ||
		secondary.saturation !== 0 ||
		secondary.brightness !== 0 ||
		secondary.contrast !== 0
	);
}

export function clampCurvePoint(point: ColorCurvePoint): ColorCurvePoint {
	return {
		x: Math.min(1, Math.max(0, Number.isFinite(point.x) ? point.x : 0)),
		y: Math.min(1, Math.max(0, Number.isFinite(point.y) ? point.y : 0))
	};
}

export function clampCurvePoints(points: ColorCurvePoint[]): ColorCurvePoint[] {
	if (!Array.isArray(points)) return [...IDENTITY_CURVE];
	const safe = points
		.slice(0, MAX_CURVE_POINTS)
		.map(clampCurvePoint)
		.filter((point) => Number.isFinite(point.x));
	if (safe.length < 2) return [...IDENTITY_CURVE];
	const sorted = safe.sort((left, right) => left.x - right.x);
	const deduped: ColorCurvePoint[] = [];
	for (const point of sorted) {
		const previous = deduped.at(-1);
		if (previous && Math.abs(previous.x - point.x) < 0.0001) {
			deduped[deduped.length - 1] = point;
			continue;
		}
		deduped.push(point);
	}
	const first = deduped[0];
	const last = deduped.at(-1);
	if (first && first.x > 0) deduped.unshift({ x: 0, y: first.y });
	if (last && last.x < 1) deduped.push({ x: 1, y: last.y });
	return deduped.slice(0, MAX_CURVE_POINTS);
}

export function isIdentityCurve(points: ColorCurvePoint[]): boolean {
	if (points.length !== 2) return false;
	return points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1;
}

export function hasActiveCurves(curves: ColorCurves): boolean {
	return (
		!isIdentityCurve(curves.master) ||
		!isIdentityCurve(curves.red) ||
		!isIdentityCurve(curves.green) ||
		!isIdentityCurve(curves.blue)
	);
}

export function isNeutralWheel(wheel: ColorWheel): boolean {
	return wheel.hue === 0 && wheel.saturation === 0 && wheel.strength === 0;
}

export function isNeutralGrade(grade: ColorGrade): boolean {
	return (
		grade.lutId === null &&
		grade.customLut === null &&
		!isSecondaryActive(grade.secondary) &&
		!isFinishActive(grade.finish) &&
		grade.intensity === 0 &&
		isNeutralWheel(grade.master) &&
		isNeutralWheel(grade.shadows) &&
		isNeutralWheel(grade.midtones) &&
		isNeutralWheel(grade.highlights) &&
		!hasActiveCurves(grade.curves)
	);
}

export function cloneColorGrade(grade: ColorGrade): ColorGrade {
	return {
		shadows: { ...grade.shadows },
		midtones: { ...grade.midtones },
		highlights: { ...grade.highlights },
		master: { ...grade.master },
		curves: {
			master: grade.curves.master.map((point) => ({ ...point })),
			red: grade.curves.red.map((point) => ({ ...point })),
			green: grade.curves.green.map((point) => ({ ...point })),
			blue: grade.curves.blue.map((point) => ({ ...point }))
		},
		lutId: grade.lutId,
		customLut: grade.customLut ? { ...grade.customLut } : null,
		secondary: {
			...grade.secondary,
			window: { ...grade.secondary.window }
		},
		finish: { ...grade.finish },
		intensity: grade.intensity
	};
}

export function cloneColorGradeOrNull(grade: ColorGrade | undefined): ColorGrade | undefined {
	return grade ? cloneColorGrade(grade) : undefined;
}

// sample a control-point curve as evenly spaced output values
// the result matches feComponentTransfer table semantics and the export table lookup
export function sampleCurve(points: ColorCurvePoint[], samples: number): Float32Array {
	const table = new Float32Array(samples);
	if (samples === 0) return table;
	if (points.length === 0 || isIdentityCurve(points)) {
		for (let index = 0; index < samples; index += 1) {
			table[index] = samples === 1 ? 0.5 : index / (samples - 1);
		}
		return table;
	}
	const sorted = clampCurvePoints(points);
	for (let index = 0; index < samples; index += 1) {
		const x = samples === 1 ? 0.5 : index / (samples - 1);
		if (x <= sorted[0].x) {
			table[index] = sorted[0].y;
			continue;
		}
		const last = sorted.at(-1);
		if (last && x >= last.x) {
			table[index] = last.y;
			continue;
		}
		for (let pointIndex = 0; pointIndex < sorted.length - 1; pointIndex += 1) {
			const from = sorted[pointIndex];
			const to = sorted[pointIndex + 1];
			if (x < from.x || x > to.x) continue;
			const progress = (x - from.x) / (to.x - from.x);
			table[index] = from.y + (to.y - from.y) * progress;
			break;
		}
	}
	return table;
}
