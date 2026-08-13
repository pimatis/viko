import type { CubeLutRef } from './types';

// parsed .cube LUT held in memory for the session. the raw source text is kept
// inside each clip's grade so projects stay self-contained when reopened.
export type CubeLut = {
	id: string;
	name: string;
	source: string;
	size: number;
	data: Float32Array;
};

const registry = new Map<string, CubeLut>();
const sourceCache = new Map<string, CubeLut>();

function hashSource(source: string): string {
	let hash = 5381;
	for (let index = 0; index < source.length; index += 1) {
		hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0;
	}
	return hash.toString(36);
}

// parse a .cube file (1D or 3D). returns null when the file is not usable.
export function parseCubeLut(source: string): { size: number; data: Float32Array } | null {
	let size = 0;
	let is1D = false;
	const values: number[] = [];
	const lines = String(source ?? '').split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const lower = line.toLowerCase();
		if (lower.startsWith('lut_1d_size')) {
			is1D = true;
			size = Math.round(Number(line.split(/\s+/)[1]));
			continue;
		}
		if (lower.startsWith('lut_3d_size')) {
			is1D = false;
			size = Math.round(Number(line.split(/\s+/)[1]));
			continue;
		}
		if (lower.startsWith('domain_min') || lower.startsWith('domain_max')) continue;
		if (lower.startsWith('title')) continue;
		const parts = line.split(/\s+/).filter(Boolean);
		if (parts.length < 3) continue;
		const red = Number(parts[0]);
		const green = Number(parts[1]);
		const blue = Number(parts[2]);
		if (![red, green, blue].every(Number.isFinite)) continue;
		values.push(red, green, blue);
	}
	if (size <= 0 || size > 64 || values.length < 6) return null;

	if (is1D) {
		// a 1D LUT is a per-channel curve: each channel's output depends only on
		// that channel's input. expand it into a separable 3D cube (data[r,g,b].R
		// = curveR(r), .G = curveG(g), .B = curveB(b)) so the same trilinear
		// lookup handles both cases exactly.
		const entries = Math.floor(values.length / 3);
		const data = new Float32Array(size * size * size * 3);
		const sampleAt = (t: number, channel: number): number => {
			const position = Math.min(entries - 1, Math.max(0, t * (entries - 1)));
			const i0 = Math.floor(position);
			const fraction = position - i0;
			const i1 = Math.min(entries - 1, i0 + 1);
			return values[i0 * 3 + channel] * (1 - fraction) + values[i1 * 3 + channel] * fraction;
		};
		for (let blue = 0; blue < size; blue += 1) {
			const blueNorm = size <= 1 ? 0 : blue / (size - 1);
			for (let green = 0; green < size; green += 1) {
				const greenNorm = size <= 1 ? 0 : green / (size - 1);
				for (let red = 0; red < size; red += 1) {
					const index = (blue * size + green) * size * 3 + red * 3;
					const redNorm = size <= 1 ? 0 : red / (size - 1);
					data[index] = sampleAt(redNorm, 0);
					data[index + 1] = sampleAt(greenNorm, 1);
					data[index + 2] = sampleAt(blueNorm, 2);
				}
			}
		}
		return { size, data };
	}

	const expected = size * size * size * 3;
	if (values.length < expected) return null;
	const data = new Float32Array(expected);
	data.set(values.slice(0, expected));
	return { size, data };
}

export function registerCubeLut(name: string, source: string): CubeLut {
	const cached = sourceCache.get(source);
	if (cached) return cached;
	const parsed = parseCubeLut(source);
	if (!parsed) throw new Error('Invalid .cube LUT file');
	const id = `cube-${hashSource(source)}`;
	const lut: CubeLut = { id, name, source, size: parsed.size, data: parsed.data };
	registry.set(id, lut);
	sourceCache.set(source, lut);
	return lut;
}

export function getCubeLut(id: string): CubeLut | null {
	return registry.get(id) ?? null;
}

export function listCubeLuts(): CubeLut[] {
	return [...registry.values()];
}

export function removeCubeLut(id: string): void {
	registry.delete(id);
}

// make sure a persisted LUT reference is available this session; returns null when
// the stored source is no longer parseable (e.g. a truncated save)
export function ensureCubeLutRegistered(ref: CubeLutRef | null | undefined): CubeLut | null {
	if (!ref) return null;
	try {
		return registerCubeLut(ref.name, ref.source);
	} catch {
		return null;
	}
}

// trilinear interpolation lookup; cube data is ordered with red varying fastest
export function applyCubeLut(
	lut: CubeLut,
	red: number,
	green: number,
	blue: number
): [number, number, number] {
	const size = lut.size;
	const data = lut.data;
	const max = size - 1;
	const r = Math.min(max, Math.max(0, red * max));
	const g = Math.min(max, Math.max(0, green * max));
	const b = Math.min(max, Math.max(0, blue * max));
	const r0 = Math.floor(r);
	const g0 = Math.floor(g);
	const b0 = Math.floor(b);
	const r1 = Math.min(max, r0 + 1);
	const g1 = Math.min(max, g0 + 1);
	const b1 = Math.min(max, b0 + 1);
	const fractionR = r - r0;
	const fractionG = g - g0;
	const fractionB = b - b0;

	const at = (ri: number, gi: number, bi: number): number => (bi * size + gi) * size * 3 + ri * 3;
	const c000 = at(r0, g0, b0);
	const c100 = at(r1, g0, b0);
	const c010 = at(r0, g1, b0);
	const c110 = at(r1, g1, b0);
	const c001 = at(r0, g0, b1);
	const c101 = at(r1, g0, b1);
	const c011 = at(r0, g1, b1);
	const c111 = at(r1, g1, b1);

	const out: [number, number, number] = [0, 0, 0];
	for (let channel = 0; channel < 3; channel += 1) {
		const v000 = data[c000 + channel];
		const v100 = data[c100 + channel];
		const v010 = data[c010 + channel];
		const v110 = data[c110 + channel];
		const v001 = data[c001 + channel];
		const v101 = data[c101 + channel];
		const v011 = data[c011 + channel];
		const v111 = data[c111 + channel];
		const x00 = v000 + (v100 - v000) * fractionR;
		const x10 = v010 + (v110 - v010) * fractionR;
		const x01 = v001 + (v101 - v001) * fractionR;
		const x11 = v011 + (v111 - v011) * fractionR;
		const y0 = x00 + (x10 - x00) * fractionG;
		const y1 = x01 + (x11 - x01) * fractionG;
		out[channel] = y0 + (y1 - y0) * fractionB;
	}
	return out;
}
