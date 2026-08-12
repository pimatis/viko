import type { LUTPreset } from './types';

function lerp(from: number, to: number, amount: number): number {
	return from + (to - from) * amount;
}

function luma(red: number, green: number, blue: number): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export const LUT_PRESETS: LUTPreset[] = [
	{
		id: 'lut-teal-orange',
		name: 'Teal & Orange',
		previewFilter: 'saturate(1.08) sepia(0.12) hue-rotate(-4deg) contrast(1.04)',
		apply: (red, green, blue) => {
			const y = luma(red, green, blue);
			const tealAmount = clamp01((1 - y) * 1.3) * 0.32;
			const orangeAmount = clamp01((y - 0.55) * 2) * 0.32;
			const nextRed = clamp01(
				lerp(red, lerp(red, red * 0.82, tealAmount), orangeAmount * 0.4) + 0.03 * orangeAmount
			);
			const nextGreen = clamp01(
				lerp(green, lerp(green, green * 1.08, tealAmount), orangeAmount * 0.6) + 0.01 * orangeAmount
			);
			const nextBlue = clamp01(
				lerp(blue, lerp(blue, blue * 1.18, tealAmount), orangeAmount * 0.3) - 0.04 * orangeAmount
			);
			return [nextRed, nextGreen, nextBlue];
		}
	},
	{
		id: 'lut-bleach-bypass',
		name: 'Bleach Bypass',
		previewFilter: 'saturate(0.45) contrast(1.2)',
		apply: (red, green, blue) => {
			const y = luma(red, green, blue);
			const mixed = lerp(red, y, 0.7);
			const mixedGreen = lerp(green, y, 0.7);
			const mixedBlue = lerp(blue, y, 0.7);
			const contrast = (value: number) => clamp01((value - 0.5) * 1.25 + 0.5);
			return [contrast(mixed), contrast(mixedGreen), contrast(mixedBlue)];
		}
	},
	{
		id: 'lut-golden-hour',
		name: 'Golden Hour',
		previewFilter: 'sepia(0.35) saturate(1.25) hue-rotate(-12deg) brightness(1.02)',
		apply: (red, green, blue) => {
			const y = luma(red, green, blue);
			const lift = 0.04;
			const nextRed = clamp01(red * 1.09 + lift + 0.02 * y);
			const nextGreen = clamp01(green * 1.02 + lift * 0.6 - 0.01 * y);
			const nextBlue = clamp01(blue * 0.88 + lift * 0.3 - 0.03 * y);
			return [nextRed, nextGreen, nextBlue];
		}
	},
	{
		id: 'lut-mono-silver',
		name: 'Mono Silver',
		previewFilter: 'grayscale(1) contrast(1.08)',
		apply: (red, green, blue) => {
			const y = luma(red, green, blue);
			const silver = clamp01((y - 0.5) * 1.12 + 0.5 + 0.015);
			return [silver, silver, silver];
		}
	}
];

const lutPresetsById: Record<string, LUTPreset> = Object.fromEntries(
	LUT_PRESETS.map((preset) => [preset.id, preset])
);

export function getLutPreset(lutId: string): LUTPreset | null {
	return lutPresetsById[lutId] ?? null;
}

export function isLutPresetId(lutId: string): boolean {
	return Boolean(lutPresetsById[lutId]);
}
