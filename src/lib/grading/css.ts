import {
	clampCurvePoints,
	HIGHLIGHT_BAND_WEIGHT,
	MIDTONE_BAND_WEIGHT,
	SHADOW_BAND_WEIGHT,
	hasActiveCurves,
	isFinishActive,
	isNeutralGrade,
	isNeutralWheel,
	sampleCurve
} from './defaults';
import { getLutPreset } from './luts';
import type { ColorCurves, ColorGrade, ColorWheel } from './types';

const CURVE_TABLE_SAMPLES = 16;
const INTENSITY_EPSILON = 0.001;

// scale the numeric arguments of a hand-authored css filter string toward identity
// saturate uses a multiplicative scale, every other function scales its argument
export function scalePreviewFilter(filter: string, amount: number): string {
	if (amount >= 1 - INTENSITY_EPSILON) return filter;
	const k = Math.min(1, Math.max(0, amount));
	return filter.replace(/([a-z-]+)\((-?[\d.]+)(deg)?\)/g, (match, name: string, value: string) => {
		const number = Number(value);
		if (!Number.isFinite(number)) return match;
		if (name === 'saturate') return `saturate(${1 + (number - 1) * k})`;
		return `${name}(${number * k}${match.includes('deg') ? 'deg' : ''})`;
	});
}

function getWheelPreviewParts(wheel: ColorWheel, weight: number, amount: number): string[] {
	const parts: string[] = [];
	const hue = wheel.hue * (wheel.strength / 100) * weight * amount;
	const saturation = 1 + (wheel.saturation / 100) * (wheel.strength / 100) * weight * amount;
	if (Math.abs(hue) >= 0.05) parts.push(`hue-rotate(${hue.toFixed(2)}deg)`);
	if (Math.abs(saturation - 1) >= 0.002) parts.push(`saturate(${saturation.toFixed(3)})`);
	return parts;
}

function getLumaBandParts(grade: ColorGrade, amount: number): string[] {
	const parts: string[] = [];
	parts.push(...getWheelPreviewParts(grade.shadows, SHADOW_BAND_WEIGHT, amount));
	parts.push(...getWheelPreviewParts(grade.midtones, MIDTONE_BAND_WEIGHT, amount));
	parts.push(...getWheelPreviewParts(grade.highlights, HIGHLIGHT_BAND_WEIGHT, amount));
	return parts;
}

// some grade features (secondary qualifiers and imported .cube luts) cannot be
// expressed as css filters; those clips are rendered through an exact canvas
// pass instead, so the css preview must stay neutral for them
import { isSecondaryActive } from './defaults';

export function isGradeCssExpressible(grade: ColorGrade | undefined): boolean {
	if (!grade) return true;
	return (
		grade.customLut === null &&
		!isSecondaryActive(grade.secondary) &&
		// spatial finish filters (vignette/grain/sharpen/denoise) need a
		// convolution kernel, so they force the exact canvas rendering pass
		!isFinishActive(grade.finish)
	);
}

// build the deterministic css filter used by the player preview
// curves are exact (svg feComponentTransfer), the master wheel is exact,
// luma-keyed wheels and luts are deterministic approximations of the export pipeline
export function getColorGradePreviewFilter(
	grade: ColorGrade | undefined,
	curveFilterId: string | null
): string {
	if (!grade || isNeutralGrade(grade)) return '';
	if (!isGradeCssExpressible(grade)) return '';
	const amount = grade.intensity / 100;
	const parts: string[] = [];

	const lut = getLutPreviewFilter(grade.lutId);
	if (lut) parts.push(scalePreviewFilter(lut, amount));

	if (hasActiveCurves(grade.curves) && curveFilterId) {
		parts.push(`url(#${curveFilterId})`);
	}

	const master = isNeutralWheel(grade.master) ? '' : getWheelPreviewParts(grade.master, 1, amount);
	if (master) parts.push(...master);
	parts.push(...getLumaBandParts(grade, amount));

	return parts.join(' ') || 'none';
}

// the svg filter id per graded clip so multiple clips can hold different curves
export function getCurveFilterId(clipId: string): string {
	return `viko-color-curves-${clipId}`;
}

export type CurveFilterTables = {
	red: string;
	green: string;
	blue: string;
	master: string;
};

export function getCurveFilterTables(curves: ColorCurves): CurveFilterTables {
	const sample = (points: typeof curves.master) =>
		Array.from(sampleCurve(clampCurvePoints(points), CURVE_TABLE_SAMPLES))
			.map((value) => value.toFixed(3))
			.join(' ');
	return {
		red: sample(curves.red),
		green: sample(curves.green),
		blue: sample(curves.blue),
		master: sample(curves.master)
	};
}

function getLutPreviewFilter(lutId: string | null): string {
	if (!lutId) return '';
	return getLutPreset(lutId)?.previewFilter ?? '';
}
