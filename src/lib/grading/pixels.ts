import {
	clampGradeIntensity,
	clampWheelHue,
	clampWheelSaturation,
	clampSecondaryPercent,
	isNeutralWheel,
	sampleCurve
} from './defaults';
import { getLutPreset } from './luts';
import { applyCubeLut, ensureCubeLutRegistered } from './cube';
import type { ColorGrade, ColorWheel, SecondaryCorrection, SecondaryPowerWindow } from './types';

const PIXEL_TABLE_SAMPLES = 256;

// Rec.709 luma weights used for band isolation
function lumaOf(red: number, green: number, blue: number): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function normalizeHue(hue: number): number {
	return ((hue % 360) + 360) % 360;
}

function angularDistance(from: number, to: number): number {
	const delta = Math.abs(normalizeHue(to) - normalizeHue(from));
	return Math.min(delta, 360 - delta);
}

function rgbToHsv(red: number, green: number, blue: number): [number, number, number] {
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const delta = max - min;
	let hue = 0;
	if (delta > 0) {
		if (max === red) hue = 60 * (((green - blue) / delta) % 6);
		else if (max === green) hue = 60 * ((blue - red) / delta + 2);
		else hue = 60 * ((red - green) / delta + 4);
	}
	const saturation = max === 0 ? 0 : delta / max;
	return [normalizeHue(hue), saturation, max];
}

function hsvToRgb(hue: number, saturation: number, value: number): [number, number, number] {
	const h = normalizeHue(hue) / 60;
	const c = value * saturation;
	const x = c * (1 - Math.abs((h % 2) - 1));
	const m = value - c;
	let red = 0;
	let green = 0;
	let blue = 0;
	if (h < 1) {
		red = c;
		green = x;
	} else if (h < 2) {
		red = x;
		green = c;
	} else if (h < 3) {
		green = c;
		blue = x;
	} else if (h < 4) {
		green = x;
		blue = c;
	} else if (h < 5) {
		red = x;
		blue = c;
	} else {
		red = c;
		blue = x;
	}
	return [red + m, green + m, blue + m];
}

// css-spec hue rotation matrix, row-major 3x3
function getHueMatrix(angleDeg: number): number[] {
	const angle = (angleDeg * Math.PI) / 180;
	const cosA = Math.cos(angle);
	const sinA = Math.sin(angle);
	return [
		0.213 + cosA * 0.787 - sinA * 0.213,
		0.715 - cosA * 0.715 - sinA * 0.715,
		0.072 - cosA * 0.072 + sinA * 0.928,
		0.213 - cosA * 0.213 + sinA * 0.143,
		0.715 + cosA * 0.285 + sinA * 0.14,
		0.072 - cosA * 0.072 - sinA * 0.283,
		0.213 - cosA * 0.213 - sinA * 0.787,
		0.715 - cosA * 0.715 + sinA * 0.715,
		0.072 + cosA * 0.928 + sinA * 0.072
	];
}

// css-spec saturation matrix, row-major 3x3
function getSaturationMatrix(saturationScale: number): number[] {
	const inverse = 1 - saturationScale;
	return [
		0.213 + 0.787 * saturationScale,
		0.715 * inverse,
		0.072 * inverse,
		0.213 * inverse,
		0.715 + 0.285 * saturationScale,
		0.072 * inverse,
		0.213 * inverse,
		0.715 * inverse,
		0.072 + 0.928 * saturationScale
	];
}

function multiplyMatrices(left: number[], right: number[]): number[] {
	const result: number[] = [];
	for (let row = 0; row < 3; row += 1) {
		for (let column = 0; column < 3; column += 1) {
			result.push(
				left[row * 3] * right[column] +
					left[row * 3 + 1] * right[3 + column] +
					left[row * 3 + 2] * right[6 + column]
			);
		}
	}
	return result;
}

function getWheelMatrix(wheel: ColorWheel): number[] | null {
	if (isNeutralWheel(wheel)) return null;
	const hue = clampWheelHue(wheel.hue);
	const saturation = clampWheelSaturation(wheel.saturation);
	return multiplyMatrices(getSaturationMatrix(1 + saturation / 100), getHueMatrix(hue));
}

function applyMatrix(
	matrix: number[],
	red: number,
	green: number,
	blue: number
): [number, number, number] {
	return [
		matrix[0] * red + matrix[1] * green + matrix[2] * blue,
		matrix[3] * red + matrix[4] * green + matrix[5] * blue,
		matrix[6] * red + matrix[7] * green + matrix[8] * blue
	];
}

// weight of a key at a normalized distance from its center.
// `softness` (0..1) feathers the boundary of the selected range.
function keyWeight(distanceNorm: number, softness: number): number {
	if (distanceNorm >= 1) return 0;
	const hard = 1 - softness;
	if (distanceNorm <= hard) return 1;
	const t = (distanceNorm - hard) / Math.max(0.001, 1 - hard);
	return 1 - t * t * (3 - 2 * t);
}

// spatial weight of the power window at normalized pixel coordinates
function windowWeight(window: SecondaryPowerWindow, nx: number, ny: number): number {
	if (window.type === 'full') return 1;
	const feather = Math.min(0.5, Math.max(0, clampSecondaryPercent(window.feather, 20) / 100));
	let distance: number;
	if (window.type === 'ellipse') {
		const halfW = Math.max(0.01, window.width / 100) / 2;
		const halfH = Math.max(0.01, window.height / 100) / 2;
		const ex = (nx - window.cx / 100) / halfW;
		const ey = (ny - window.cy / 100) / halfH;
		distance = Math.sqrt(ex * ex + ey * ey);
	} else {
		const halfW = Math.max(0.01, window.width / 100) / 2;
		const halfH = Math.max(0.01, window.height / 100) / 2;
		const dx = Math.abs(nx - window.cx / 100) / halfW;
		const dy = Math.abs(ny - window.cy / 100) / halfH;
		distance = Math.max(dx, dy);
	}
	if (distance <= 1) return 1;
	if (distance >= 1 + feather) return 0;
	const t = (distance - 1) / Math.max(0.001, feather);
	return 1 - t * t * (3 - 2 * t);
}

function applySecondary(imageData: ImageData, secondary: SecondaryCorrection): void {
	const amount = clampSecondaryPercent(secondary.amount, 100) / 100;
	if (amount <= 0) return;
	const data = imageData.data;
	const width = imageData.width;
	const height = imageData.height;
	const hueCenter = secondary.hue;
	const hueRange = Math.max(1, secondary.hueRange);
	const satCenter = clampSecondaryPercent(secondary.satCenter, 50) / 100;
	const satRange = Math.max(0.02, secondary.satRange / 100);
	const lumaCenter = clampSecondaryPercent(secondary.lumaCenter, 50) / 100;
	const lumaRange = Math.max(0.02, secondary.lumaRange / 100);
	const softness = clampSecondaryPercent(secondary.softness, 30) / 100;
	const lumaGate = clampSecondaryPercent(secondary.lumaWeight, 50) / 100;
	const hueShift = secondary.hueShift;
	const satScale = 1 + secondary.saturation / 100;
	const brightness = secondary.brightness / 100;
	const contrast = 1 + secondary.contrast / 100;
	const window = secondary.window;

	for (let offset = 0; offset < data.length; offset += 4) {
		const red = data[offset] / 255;
		const green = data[offset + 1] / 255;
		const blue = data[offset + 2] / 255;

		const [hue, sat, value] = rgbToHsv(red, green, blue);
		const hueKey = keyWeight(angularDistance(hue, hueCenter) / hueRange, softness);
		if (hueKey <= 0) continue;
		const satKey = keyWeight(Math.abs(sat - satCenter) / satRange, softness);
		if (satKey <= 0) continue;
		let lumaKey = keyWeight(Math.abs(lumaOf(red, green, blue) - lumaCenter) / lumaRange, softness);
		lumaKey = 1 + (lumaKey - 1) * lumaGate;
		if (lumaKey <= 0) continue;
		const pixelIndex = offset / 4;
		const windowMask = windowWeight(
			window,
			(pixelIndex % width) / Math.max(1, width - 1),
			Math.floor(pixelIndex / width) / Math.max(1, height - 1)
		);
		if (windowMask <= 0) continue;
		const mask = hueKey * satKey * lumaKey * windowMask;
		if (mask <= 0) continue;

		let correctedRed = red;
		let correctedGreen = green;
		let correctedBlue = blue;
		if (hueShift !== 0 || satScale !== 1) {
			const nextHsv = hsvToRgb(hue + hueShift, clamp01(sat * satScale), value);
			correctedRed = nextHsv[0];
			correctedGreen = nextHsv[1];
			correctedBlue = nextHsv[2];
		}
		if (contrast !== 1 || brightness !== 0) {
			correctedRed = clamp01((correctedRed - 0.5) * contrast + 0.5 + brightness);
			correctedGreen = clamp01((correctedGreen - 0.5) * contrast + 0.5 + brightness);
			correctedBlue = clamp01((correctedBlue - 0.5) * contrast + 0.5 + brightness);
		}

		const weight = mask * amount;
		data[offset] = Math.round(clamp01(red + (correctedRed - red) * weight) * 255);
		data[offset + 1] = Math.round(clamp01(green + (correctedGreen - green) * weight) * 255);
		data[offset + 2] = Math.round(clamp01(blue + (correctedBlue - blue) * weight) * 255);
	}
}

// apply exact color grading math to an rgba buffer
// this is the renderer used by the export pipeline; the player preview
// approximates luma-keyed wheels but shares the same data model
export function applyColorGrade(imageData: ImageData, grade: ColorGrade): void {
	const amount = clampGradeIntensity(grade.intensity) / 100;
	if (amount <= 0) return;
	const data = imageData.data;
	const lut = getLutPreset(grade.lutId ?? '');
	const cubeLut = ensureCubeLutRegistered(grade.customLut);
	const redTable = sampleCurve(grade.curves.red, PIXEL_TABLE_SAMPLES);
	const greenTable = sampleCurve(grade.curves.green, PIXEL_TABLE_SAMPLES);
	const blueTable = sampleCurve(grade.curves.blue, PIXEL_TABLE_SAMPLES);
	const masterTable = sampleCurve(grade.curves.master, PIXEL_TABLE_SAMPLES);
	const masterMatrix = getWheelMatrix(grade.master);
	const shadowsMatrix = getWheelMatrix(grade.shadows);
	const midtonesMatrix = getWheelMatrix(grade.midtones);
	const highlightsMatrix = getWheelMatrix(grade.highlights);
	const shadowsStrength = grade.shadows.strength / 100;
	const midtonesStrength = grade.midtones.strength / 100;
	const highlightsStrength = grade.highlights.strength / 100;

	for (let offset = 0; offset < data.length; offset += 4) {
		const originalRed = data[offset] / 255;
		const originalGreen = data[offset + 1] / 255;
		const originalBlue = data[offset + 2] / 255;
		let red = originalRed;
		let green = originalGreen;
		let blue = originalBlue;

		if (lut) {
			const graded = lut.apply(red, green, blue);
			red = graded[0];
			green = graded[1];
			blue = graded[2];
		} else if (cubeLut) {
			const graded = applyCubeLut(cubeLut, red, green, blue);
			red = graded[0];
			green = graded[1];
			blue = graded[2];
		}

		// LUT output is not guaranteed to stay inside 0..1 (some .cube files carry
		// out-of-range values), so clamp the table index to avoid a NaN cascade
		const redIndex = Math.min(255, Math.max(0, Math.round(red * 255)));
		const greenIndex = Math.min(255, Math.max(0, Math.round(green * 255)));
		const blueIndex = Math.min(255, Math.max(0, Math.round(blue * 255)));
		red = redTable[redIndex];
		green = greenTable[greenIndex];
		blue = blueTable[blueIndex];
		red = masterTable[Math.min(255, Math.max(0, Math.round(red * 255)))];
		green = masterTable[Math.min(255, Math.max(0, Math.round(green * 255)))];
		blue = masterTable[Math.min(255, Math.max(0, Math.round(blue * 255)))];

		if (masterMatrix) {
			// the master wheel's strength scales the whole matrix, matching the css
			// preview and the band wheels below (which blend by strength)
			const graded = applyMatrix(masterMatrix, red, green, blue);
			const masterStrength = grade.master.strength / 100;
			if (masterStrength >= 1) {
				red = graded[0];
				green = graded[1];
				blue = graded[2];
			} else {
				red = clamp01(red + (graded[0] - red) * masterStrength);
				green = clamp01(green + (graded[1] - green) * masterStrength);
				blue = clamp01(blue + (graded[2] - blue) * masterStrength);
			}
		}

		const y = lumaOf(red, green, blue);
		const shadowWeight = 1 - y;
		const midtoneWeight = 1 - Math.abs(2 * y - 1);
		const highlightWeight = y;
		const totalWeight = shadowWeight + midtoneWeight + highlightWeight;

		if (shadowsMatrix && totalWeight > 0 && shadowsStrength > 0) {
			const graded = applyMatrix(shadowsMatrix, red, green, blue);
			const weight = (shadowWeight / totalWeight) * shadowsStrength;
			red = clamp01(red + (graded[0] - red) * weight);
			green = clamp01(green + (graded[1] - green) * weight);
			blue = clamp01(blue + (graded[2] - blue) * weight);
		}
		if (midtonesMatrix && totalWeight > 0 && midtonesStrength > 0) {
			const graded = applyMatrix(midtonesMatrix, red, green, blue);
			const weight = (midtoneWeight / totalWeight) * midtonesStrength;
			red = clamp01(red + (graded[0] - red) * weight);
			green = clamp01(green + (graded[1] - green) * weight);
			blue = clamp01(blue + (graded[2] - blue) * weight);
		}
		if (highlightsMatrix && totalWeight > 0 && highlightsStrength > 0) {
			const graded = applyMatrix(highlightsMatrix, red, green, blue);
			const weight = (highlightWeight / totalWeight) * highlightsStrength;
			red = clamp01(red + (graded[0] - red) * weight);
			green = clamp01(green + (graded[1] - green) * weight);
			blue = clamp01(blue + (graded[2] - blue) * weight);
		}

		if (amount < 1) {
			red = originalRed + (red - originalRed) * amount;
			green = originalGreen + (green - originalGreen) * amount;
			blue = originalBlue + (blue - originalBlue) * amount;
		}

		data[offset] = Math.round(red * 255);
		data[offset + 1] = Math.round(green * 255);
		data[offset + 2] = Math.round(blue * 255);
	}

	if (grade.secondary?.enabled) {
		applySecondary(imageData, grade.secondary);
	}
}
