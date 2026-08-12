import {
	clampGradeIntensity,
	clampWheelHue,
	clampWheelSaturation,
	isNeutralWheel,
	sampleCurve
} from './defaults';
import { getLutPreset } from './luts';
import type { ColorGrade, ColorWheel } from './types';

const PIXEL_TABLE_SAMPLES = 256;

// Rec.709 luma weights used for band isolation
function lumaOf(red: number, green: number, blue: number): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
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

// apply exact color grading math to an rgba buffer
// this is the renderer used by the export pipeline; the player preview
// approximates luma-keyed wheels but shares the same data model
export function applyColorGrade(imageData: ImageData, grade: ColorGrade): void {
	const amount = clampGradeIntensity(grade.intensity) / 100;
	if (amount <= 0) return;
	const data = imageData.data;
	const lut = getLutPreset(grade.lutId ?? '');
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
		}

		const redIndex = Math.round(red * 255);
		const greenIndex = Math.round(green * 255);
		const blueIndex = Math.round(blue * 255);
		red = redTable[redIndex];
		green = greenTable[greenIndex];
		blue = blueTable[blueIndex];
		red = masterTable[Math.round(red * 255)];
		green = masterTable[Math.round(green * 255)];
		blue = masterTable[Math.round(blue * 255)];

		if (masterMatrix) {
			const graded = applyMatrix(masterMatrix, red, green, blue);
			red = graded[0];
			green = graded[1];
			blue = graded[2];
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
}
