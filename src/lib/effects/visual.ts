import type { ClipEffect, EffectVisualState } from './types';
import { getColorAdjustFilter } from '$lib/editor/timeline';
import type { ColorAdjust } from '$lib/editor/timeline';

export function getEffectVisualState(
	effects: ClipEffect[],
	clipTime: number,
	clipDuration: number,
	colorAdjust?: ColorAdjust,
	clipOpacity?: number
): EffectVisualState {
	const colorFilter = getColorAdjustFilter(colorAdjust);
	if (effects.length === 0) {
		return {
			filter: colorFilter || 'none',
			transform: 'none',
			opacity: clipOpacity ?? 1
		};
	}

	const filters: string[] = [];
	const transforms: string[] = [];
	let opacity = clipOpacity ?? 1;

	for (const effect of effects) {
		switch (effect.presetId) {
			case 'effect-shake': {
				const x = Math.sin(clipTime * 43) * 5;
				const y = Math.cos(clipTime * 37) * 3;
				const rotation = Math.sin(clipTime * 29) * 0.7;
				transforms.push(`translate(${x}px, ${y}px) rotate(${rotation}deg) scale(1.03)`);
				break;
			}
			case 'effect-glitch': {
				const offset = Math.sin(clipTime * 71) * 4;
				transforms.push(`translateX(${offset}px) skewX(${offset * 0.25}deg)`);
				filters.push(`hue-rotate(${Math.sin(clipTime * 53) * 35}deg) contrast(1.25)`);
				break;
			}
			case 'effect-zoom-pulse':
				transforms.push(`scale(${1 + (Math.sin(clipTime * 8) + 1) * 0.025})`);
				break;
			case 'effect-soft-blur':
				filters.push('blur(4px)');
				break;
			case 'effect-flicker':
				opacity *= 0.82 + (Math.sin(clipTime * 31) + 1) * 0.09;
				break;
			case 'effect-drift':
				transforms.push(
					`translate(${Math.sin(clipTime * 1.7) * 2}px, ${Math.cos(clipTime * 1.3) * 2}px) scale(1.01)`
				);
				break;
			case 'transition-fade':
				opacity *= Math.min(1, clipTime / 0.6);
				break;
			case 'transition-dissolve': {
				const edge = Math.min(clipTime, Math.max(0, clipDuration - clipTime));
				opacity *= Math.min(1, edge / 0.5);
				break;
			}
			case 'transition-slide': {
				const progress = Math.min(1, clipTime / 0.6);
				transforms.push(`translateX(${(1 - progress) * -100}%)`);
				break;
			}
			case 'transition-zoom': {
				const progress = Math.min(1, clipTime / 0.6);
				transforms.push(`scale(${0.7 + progress * 0.3})`);
				opacity *= progress;
				break;
			}
			case 'filter-vintage':
				filters.push('sepia(0.55) contrast(1.08) saturate(0.8)');
				break;
			case 'filter-monochrome':
				filters.push('grayscale(1) contrast(1.08)');
				break;
			case 'filter-warm':
				filters.push('sepia(0.2) saturate(1.2) hue-rotate(-8deg)');
				break;
			case 'filter-cool':
				filters.push('saturate(0.9) hue-rotate(12deg)');
				break;
			case 'filter-high-contrast':
				filters.push('contrast(1.35) saturate(1.08)');
				break;
		}
	}

	if (colorFilter) filters.push(colorFilter);

	return {
		filter: filters.join(' ') || 'none',
		transform: transforms.join(' ') || 'none',
		opacity
	};
}
