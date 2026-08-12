import type { ColorCurvePoint, ColorCurves, ColorGrade, ColorWheel } from './types';

export const DEFAULT_COLOR_WHEEL: ColorWheel = { hue: 0, saturation: 0, strength: 0 };

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
