import type { EffectPreset } from './types';

export const EFFECT_DRAG_MIME = 'application/x-viko-effect-preset';
export const TRANSITION_DRAG_MIME = 'application/x-viko-clip-transition';

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 2;

export const EFFECT_PRESETS: EffectPreset[] = [
	{ id: 'effect-shake', name: 'Camera Shake', kind: 'effects', category: 'Motion' },
	{ id: 'effect-glitch', name: 'Digital Glitch', kind: 'effects', category: 'Stylize' },
	{ id: 'effect-zoom-pulse', name: 'Zoom Pulse', kind: 'effects', category: 'Motion' },
	{ id: 'effect-soft-blur', name: 'Soft Blur', kind: 'effects', category: 'Lens' },
	{ id: 'effect-flicker', name: 'Flicker', kind: 'effects', category: 'Stylize' },
	{ id: 'effect-drift', name: 'Film Drift', kind: 'effects', category: 'Motion' },
	{ id: 'transition-fade', name: 'Fade', kind: 'transitions', category: 'Basic' },
	{ id: 'transition-dissolve', name: 'Dissolve', kind: 'transitions', category: 'Basic' },
	{ id: 'transition-slide', name: 'Slide In', kind: 'transitions', category: 'Motion' },
	{ id: 'transition-zoom', name: 'Zoom In', kind: 'transitions', category: 'Motion' },
	{
		id: 'clip-transition-cross-dissolve',
		name: 'Cross Dissolve',
		kind: 'clip-transitions',
		category: 'Basic'
	},
	{ id: 'clip-transition-wipe', name: 'Wipe', kind: 'clip-transitions', category: 'Motion' },
	{ id: 'clip-transition-push', name: 'Push', kind: 'clip-transitions', category: 'Motion' },
	{ id: 'filter-vintage', name: 'Vintage', kind: 'filters', category: 'Film' },
	{ id: 'filter-monochrome', name: 'Monochrome', kind: 'filters', category: 'B&W' },
	{ id: 'filter-warm', name: 'Warm', kind: 'filters', category: 'Color' },
	{ id: 'filter-cool', name: 'Cool', kind: 'filters', category: 'Color' },
	{ id: 'filter-high-contrast', name: 'High Contrast', kind: 'filters', category: 'Color' }
];

const presetsById: Record<string, EffectPreset> = Object.fromEntries(
	EFFECT_PRESETS.map((preset) => [preset.id, preset])
);

export function getEffectPreset(presetId: string): EffectPreset | null {
	return presetsById[presetId] ?? null;
}

export function isClipTransitionPreset(presetId: string): boolean {
	const preset = presetsById[presetId];
	return preset?.kind === 'clip-transitions';
}

export function clampTransitionDuration(duration: number): number {
	if (!Number.isFinite(duration)) return DEFAULT_TRANSITION_DURATION;
	return Math.min(MAX_TRANSITION_DURATION, Math.max(MIN_TRANSITION_DURATION, duration));
}
