// shot matching: derive color adjustments that push one frame's tonal distribution
// toward a reference frame's, using the same per-band statistics the scopes compute.
import { clampWheelHue, clampWheelSaturation, clampWheelStrength } from './defaults';
import type { ColorCurvePoint, ColorWheel } from './types';
import type { BandStats, FrameStats } from './scopes';

export type GradeMatchResult = {
	shadows: ColorWheel;
	midtones: ColorWheel;
	highlights: ColorWheel;
	masterCurve: ColorCurvePoint[];
};

function rgbToHueSat(red: number, green: number, blue: number): { hue: number; sat: number } {
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue = 0;
	if (delta > 0) {
		if (max === red) hue = 60 * (((green - blue) / delta) % 6);
		else if (max === green) hue = 60 * ((blue - red) / delta + 2);
		else hue = 60 * ((red - green) / delta + 4);
	}
	return { hue: ((hue % 360) + 360) % 360, sat: max === 0 ? 0 : delta / max };
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function matchBand(target: BandStats, reference: BandStats): ColorWheel {
	const targetHS = rgbToHueSat(target.red, target.green, target.blue);
	const referenceHS = rgbToHueSat(reference.red, reference.green, reference.blue);
	let hueDelta = referenceHS.hue - targetHS.hue;
	if (hueDelta > 180) hueDelta -= 360;
	if (hueDelta < -180) hueDelta += 360;
	const satDelta = (referenceHS.sat - targetHS.sat) * 100;
	// strength scales with how far the reference actually differs; luma deltas are
	// handled by the master curve, chroma deltas by the band wheels
	const magnitude = Math.min(100, Math.hypot(hueDelta, satDelta * 0.5) * 1.6);
	return {
		hue: clampWheelHue(hueDelta),
		saturation: clampWheelSaturation(satDelta),
		strength: clampWheelStrength(magnitude)
	};
}

// build the master curve that lifts shadows and gains highlights toward the
// reference while leaving midtones roughly in place
function buildMasterCurve(target: FrameStats, reference: FrameStats): ColorCurvePoint[] {
	const lift = clamp01((reference.shadows.luma - target.shadows.luma) * 0.6);
	const gain = clamp01(1 + (reference.highlights.luma - target.highlights.luma) * 0.6);
	const midShift = (reference.midtones.luma - target.midtones.luma) * 0.4;
	const midY = clamp01(0.5 + midShift);
	const curve: ColorCurvePoint[] = [
		{ x: 0, y: lift },
		{ x: 0.5, y: midY },
		{ x: 1, y: gain }
	];
	// collapse near-identity curves to keep snapshots tidy
	if (Math.abs(lift) < 0.004 && Math.abs(midY - 0.5) < 0.004 && Math.abs(gain - 1) < 0.004) {
		return [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 }
		];
	}
	return curve;
}

export function computeGradeMatch(target: FrameStats, reference: FrameStats): GradeMatchResult {
	return {
		shadows: matchBand(target.shadows, reference.shadows),
		midtones: matchBand(target.midtones, reference.midtones),
		highlights: matchBand(target.highlights, reference.highlights),
		masterCurve: buildMasterCurve(target, reference)
	};
}
