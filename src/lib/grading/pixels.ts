import {
	clampFinishFilters,
	clampGradeIntensity,
	clampWheelHue,
	clampWheelSaturation,
	clampSecondaryPercent,
	isFinishActive,
	isNeutralWheel,
	sampleCurve
} from './defaults';
import { getLutPreset } from './luts';
import { applyCubeLut, ensureCubeLutRegistered } from './cube';
import type {
	ColorGrade,
	ColorWheel,
	FinishFilters,
	SecondaryCorrection,
	SecondaryPowerWindow
} from './types';

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

// ---------- finish filters (vignette / grain / sharpen / denoise) ----------
//
// these are the spatial "last touch" filters applied after the color pass.
// sharpen and denoise run an actual 3x3 convolution kernel (implemented as two
// separable 1x3 passes), vignette is a radial window and grain is deterministic
// per-pixel noise seeded by the frame so it shimmers across playback.

function smoothstep(from: number, to: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - from) / Math.max(1e-6, to - from)));
	return t * t * (3 - 2 * t);
}

// module-level scratch buffers reused across calls (calls are synchronous and
// never re-entrant, so sharing is safe). three buffers: the untouched original,
// the blurred copy and a horizontal-pass temp for the separable blur.
let spatialScratches: Float32Array[] | null = null;

function getSpatialScratches(size: number): [Float32Array, Float32Array, Float32Array] {
	if (!spatialScratches)
		spatialScratches = [new Float32Array(0), new Float32Array(0), new Float32Array(0)];
	if (spatialScratches[0].length < size) {
		for (let index = 0; index < 3; index += 1) spatialScratches[index] = new Float32Array(size);
	}
	return [spatialScratches[0], spatialScratches[1], spatialScratches[2]];
}

// separable 1x3 binomial blur with edge clamping (replicate). reads `src` into
// `temp` horizontally, then back into `src` vertically, so `src` holds the blur.
function blur3(src: Float32Array, temp: Float32Array, width: number, height: number): void {
	const channels = 3;
	for (let y = 0; y < height; y += 1) {
		const rowBase = y * width * channels;
		for (let x = 0; x < width; x += 1) {
			const center = rowBase + x * channels;
			const left = rowBase + (x > 0 ? x - 1 : 0) * channels;
			const right = rowBase + (x < width - 1 ? x + 1 : width - 1) * channels;
			temp[center] = (src[left] + src[center] * 2 + src[right]) * 0.25;
			temp[center + 1] = (src[left + 1] + src[center + 1] * 2 + src[right + 1]) * 0.25;
			temp[center + 2] = (src[left + 2] + src[center + 2] * 2 + src[right + 2]) * 0.25;
		}
	}
	for (let y = 0; y < height; y += 1) {
		const topBase = (y > 0 ? y - 1 : 0) * width * channels;
		const centerBase = y * width * channels;
		const bottomBase = (y < height - 1 ? y + 1 : height - 1) * width * channels;
		for (let x = 0; x < width; x += 1) {
			const center = centerBase + x * channels;
			src[center] =
				(temp[topBase + x * channels] + temp[center] * 2 + temp[bottomBase + x * channels]) * 0.25;
			src[center + 1] =
				(temp[topBase + x * channels + 1] +
					temp[center + 1] * 2 +
					temp[bottomBase + x * channels + 1]) *
				0.25;
			src[center + 2] =
				(temp[topBase + x * channels + 2] +
					temp[center + 2] * 2 +
					temp[bottomBase + x * channels + 2]) *
				0.25;
		}
	}
}

// denoise = blend toward the blurred image; sharpen = unsharp mask (add the
// high-pass difference back). both share the same convolution kernel.
function applySpatialKernels(
	data: Uint8ClampedArray,
	finish: FinishFilters,
	width: number,
	height: number
): void {
	const pixelCount = width * height;
	if (pixelCount <= 0) return;
	const size = pixelCount * 3;
	const [original, blurred, temp] = getSpatialScratches(size);
	// the source is an RGBA buffer but the scratch planes are RGB: copy the
	// three color channels per pixel (reading data[index] linearly would mix
	// alpha into the color planes every fourth sample)
	for (let pixel = 0; pixel < pixelCount; pixel += 1) {
		const dataBase = pixel * 4;
		const base = pixel * 3;
		original[base] = data[dataBase] / 255;
		original[base + 1] = data[dataBase + 1] / 255;
		original[base + 2] = data[dataBase + 2] / 255;
		blurred[base] = original[base];
		blurred[base + 1] = original[base + 1];
		blurred[base + 2] = original[base + 2];
	}
	blur3(blurred, temp, width, height);

	const denoiseAmount = (finish.denoise / 100) * 0.85;
	const sharpenAmount = (finish.sharpen / 100) * 1.15;
	// fully transparent pixels are never composited, so their RGB here is
	// irrelevant to the output; skipping them avoids wasted channel work. the
	// blur above still reads them (untouched), so visible pixels are identical.
	for (let pixel = 0, offset = 0; pixel < pixelCount; pixel += 1, offset += 4) {
		if (data[offset + 3] === 0) continue;
		const base = pixel * 3;
		const o0 = original[base];
		const o1 = original[base + 1];
		const o2 = original[base + 2];
		const b0 = blurred[base];
		const b1 = blurred[base + 1];
		const b2 = blurred[base + 2];
		let r = o0;
		let g = o1;
		let bl = o2;
		if (denoiseAmount > 0) {
			r = o0 + (b0 - o0) * denoiseAmount;
			g = o1 + (b1 - o1) * denoiseAmount;
			bl = o2 + (b2 - o2) * denoiseAmount;
		}
		if (sharpenAmount > 0) {
			r = r + (o0 - b0) * sharpenAmount;
			g = g + (o1 - b1) * sharpenAmount;
			bl = bl + (o2 - b2) * sharpenAmount;
		}
		data[offset] = Math.round(clamp01(r) * 255);
		data[offset + 1] = Math.round(clamp01(g) * 255);
		data[offset + 2] = Math.round(clamp01(bl) * 255);
	}
}

// the vignette multiplier only depends on pixel position + strength, and finish
// values are constant during an export, so the factor table is computed once and
// reused across every frame (single-slot cache: one export size at a time).
let vignetteFactorKey = '';
let vignetteFactors: Float32Array | null = null;

function getVignetteFactors(amount: number, width: number, height: number): Float32Array | null {
	if (amount <= 0) return null;
	const key = `${width}x${height}x${amount}`;
	if (vignetteFactorKey === key && vignetteFactors) return vignetteFactors;
	const strength = (amount / 100) * 0.9;
	const factors = new Float32Array(width * height);
	for (let y = 0; y < height; y += 1) {
		const ny = y / Math.max(1, height - 1) - 0.5;
		for (let x = 0; x < width; x += 1) {
			const nx = x / Math.max(1, width - 1) - 0.5;
			// normalize the corner distance so r=1 lands at the frame corners
			const r = Math.min(1.05, Math.sqrt(nx * nx + ny * ny) / Math.SQRT1_2);
			const window = smoothstep(0.35, 1, r);
			factors[y * width + x] = 1 - strength * window;
		}
	}
	vignetteFactorKey = key;
	vignetteFactors = factors;
	return factors;
}

function applyVignette(
	data: Uint8ClampedArray,
	amount: number,
	width: number,
	height: number
): void {
	const factors = getVignetteFactors(amount, width, height);
	if (!factors) return;
	// factor is in 0..1, so the clamped 0..1 multiply is exactly data * factor
	for (let offset = 0; offset < data.length; offset += 4) {
		const factor = factors[offset >> 2];
		data[offset] = Math.round(data[offset] * factor);
		data[offset + 1] = Math.round(data[offset + 1] * factor);
		data[offset + 2] = Math.round(data[offset + 2] * factor);
	}
}

// the grain hash's x/y terms are seed-independent and exact in float64, so they
// are precomputed once per frame size and reused across every frame. the seed
// terms stay in the original float64 expressions, keeping the hash bit-identical
// (x and y are small ints, so the split sum rounds exactly like the full one).
let grainXyKey = '';
let grainXyParts: Float64Array | null = null;

function getGrainXyParts(width: number, height: number): Float64Array {
	const key = `${width}x${height}`;
	if (grainXyKey === key && grainXyParts) return grainXyParts;
	const parts = new Float64Array(width * height);
	let index = 0;
	for (let y = 0; y < height; y += 1) {
		const yPart = y * 668265263;
		for (let x = 0; x < width; x += 1) {
			parts[index] = x * 374761393 + yPart;
			index += 1;
		}
	}
	grainXyKey = key;
	grainXyParts = parts;
	return parts;
}

// deterministic integer hash -> [0, 1), split so the seed-dependent part is
// added to a precomputed exact x/y float64 sum (see getGrainXyParts)
function hash01(xyPart: number, seed: number): number {
	let h = (xyPart + seed) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function applyGrain(
	data: Uint8ClampedArray,
	amount: number,
	width: number,
	height: number,
	seed: number
): void {
	if (amount <= 0) return;
	// peak luma displacement at 100% strength; grain stays subtle like film stock.
	// the amplitude is folded onto the byte scale so the per-pixel math never
	// round-trips through 0..1 floats (same result, fewer divisions and clamps)
	const amp = (amount / 100) * 0.055 * 255;
	const frameSeed = Math.round(seed * 1e3) % 1_000_000_000;
	const xyParts = getGrainXyParts(width, height);
	const seedTerm = frameSeed * 2246822519;
	const seedTermA = (frameSeed + 7919) * 2246822519;
	const seedTermB = (frameSeed + 104729) * 2246822519;
	let pixel = 0;
	for (let y = 0; y < height; y += 1) {
		let offset = y * width * 4;
		for (let x = 0; x < width; x += 1) {
			const xyPart = xyParts[pixel];
			pixel += 1;
			const mono = hash01(xyPart, seedTerm) * 2 - 1;
			const chromaA = hash01(xyPart, seedTermA) * 2 - 1;
			const chromaB = hash01(xyPart, seedTermB) * 2 - 1;
			const deltaR = amp * (mono * 0.8 + chromaA * 0.2);
			const deltaG = amp * (mono * 0.8 + chromaB * 0.2);
			const deltaB = amp * (mono * 0.8 - (chromaA + chromaB) * 0.1);
			const red = data[offset] + deltaR;
			const green = data[offset + 1] + deltaG;
			const blue = data[offset + 2] + deltaB;
			data[offset] = Math.round(red < 0 ? 0 : red > 255 ? 255 : red);
			data[offset + 1] = Math.round(green < 0 ? 0 : green > 255 ? 255 : green);
			data[offset + 2] = Math.round(blue < 0 ? 0 : blue > 255 ? 255 : blue);
			offset += 4;
		}
	}
}

// apply the spatial finish pass on top of the already-graded rgba buffer
function applyFinishFilters(imageData: ImageData, finish: FinishFilters, seed: number): void {
	if (!isFinishActive(finish)) return;
	const safe = clampFinishFilters(finish);
	const data = imageData.data;
	const width = imageData.width;
	const height = imageData.height;

	// order matches Resolve's finishing chain: clean the noise first, then
	// sharpen what remains, and finally dress the frame with vignette + grain
	applySpatialKernels(data, safe, width, height);
	applyVignette(data, safe.vignette, width, height);
	applyGrain(data, safe.grain, width, height, seed);
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
// approximates luma-keyed wheels but shares the same data model.
// `seed` animates the film grain so consecutive frames get fresh noise while
// remaining deterministic (same frame index => same grain).
// the color tables + wheel matrices only depend on the (immutable) grade object,
// so they are computed once per grade instead of every frame. edits create a new
// object (immutable updates), which misses the cache and rebuilds the tables.
type GradeTables = ReturnType<typeof buildGradeTables>;
const gradeTableCache = new WeakMap<ColorGrade, GradeTables>();

function buildGradeTables(grade: ColorGrade) {
	return {
		lut: getLutPreset(grade.lutId ?? ''),
		cubeLut: ensureCubeLutRegistered(grade.customLut),
		redTable: sampleCurve(grade.curves.red, PIXEL_TABLE_SAMPLES),
		greenTable: sampleCurve(grade.curves.green, PIXEL_TABLE_SAMPLES),
		blueTable: sampleCurve(grade.curves.blue, PIXEL_TABLE_SAMPLES),
		masterTable: sampleCurve(grade.curves.master, PIXEL_TABLE_SAMPLES),
		masterMatrix: getWheelMatrix(grade.master),
		shadowsMatrix: getWheelMatrix(grade.shadows),
		midtonesMatrix: getWheelMatrix(grade.midtones),
		highlightsMatrix: getWheelMatrix(grade.highlights),
		shadowsStrength: grade.shadows.strength / 100,
		midtonesStrength: grade.midtones.strength / 100,
		highlightsStrength: grade.highlights.strength / 100
	};
}

export function applyColorGrade(imageData: ImageData, grade: ColorGrade, seed = 0): void {
	const amount = clampGradeIntensity(grade.intensity) / 100;
	const finish = grade.finish ?? clampFinishFilters(undefined);
	if (amount <= 0 && !isFinishActive(finish)) return;
	const data = imageData.data;
	if (amount > 0) {
		// transparent pixels can be skipped only when no spatial kernel follows:
		// vignette/grain touch each pixel on its own, but sharpen/denoise blur
		// neighbors, and their blur input depends on what the core wrote there
		const skipTransparent = (finish.denoise ?? 0) <= 0 && (finish.sharpen ?? 0) <= 0;
		applyColorGradeCore(imageData, grade, amount, data, skipTransparent);
	}
	applyFinishFilters(imageData, finish, seed);
}

function applyColorGradeCore(
	imageData: ImageData,
	grade: ColorGrade,
	amount: number,
	data: Uint8ClampedArray,
	skipTransparent: boolean
): void {
	let tables = gradeTableCache.get(grade);
	if (!tables) {
		tables = buildGradeTables(grade);
		gradeTableCache.set(grade, tables);
	}
	const { lut, cubeLut, redTable, greenTable, blueTable, masterTable } = tables;
	const {
		masterMatrix,
		shadowsMatrix,
		midtonesMatrix,
		highlightsMatrix,
		shadowsStrength,
		midtonesStrength,
		highlightsStrength
	} = tables;

	for (let offset = 0; offset < data.length; offset += 4) {
		if (skipTransparent && data[offset + 3] === 0) continue;
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
