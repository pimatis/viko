import {
	History,
	MousePointer2,
	Scissors,
	Hand,
	Type,
	AlignHorizontalDistributeCenter,
	BetweenHorizontalStart,
	ArrowLeftRight,
	Star,
	Heart,
	Sparkles,
	ArrowRight,
	Check,
	TriangleAlert,
	Vibrate,
	Zap,
	Focus,
	Droplet,
	SunMedium,
	Clapperboard,
	TimerReset,
	MoveRight,
	Scan,
	Square,
	Eraser,
	SkipForward,
	Film,
	Contrast,
	ThermometerSun,
	ThermometerSnowflake,
	Aperture
} from '@lucide/svelte';
import type { EditorTool } from '$lib/editor/toolbar';

export type PaletteCommand = {
	id: string;
	label: string;
	keywords?: string;
	group: string;
	hint?: string;
	icon?: typeof History;
	disabled?: () => boolean;
	run: () => void;
};

export const paletteToolOptions: { id: EditorTool; label: string; icon: typeof History }[] = [
	{ id: 'select', label: 'Selection tool', icon: MousePointer2 },
	{ id: 'razor', label: 'Razor tool', icon: Scissors },
	{ id: 'hand', label: 'Hand tool', icon: Hand },
	{ id: 'text', label: 'Text tool', icon: Type },
	{ id: 'slip', label: 'Slip tool', icon: AlignHorizontalDistributeCenter },
	{ id: 'rolling', label: 'Rolling edit tool', icon: BetweenHorizontalStart },
	{ id: 'slide', label: 'Slide tool', icon: ArrowLeftRight }
];

export const stickerIconBySymbol: Record<string, typeof History> = {
	'★': Star,
	'♥': Heart,
	'✦': Sparkles,
	'➜': ArrowRight,
	'✓': Check,
	'!': TriangleAlert
};

export const effectIconByPresetId: Record<string, typeof History> = {
	'effect-shake': Vibrate,
	'effect-glitch': Zap,
	'effect-zoom-pulse': Focus,
	'effect-soft-blur': Droplet,
	'effect-flicker': SunMedium,
	'effect-drift': Clapperboard,
	'transition-fade': TimerReset,
	'transition-dissolve': Sparkles,
	'transition-slide': MoveRight,
	'transition-zoom': Scan,
	'clip-transition-cross-dissolve': Square,
	'clip-transition-wipe': Eraser,
	'clip-transition-push': SkipForward,
	'filter-vintage': Film,
	'filter-monochrome': Contrast,
	'filter-warm': ThermometerSun,
	'filter-cool': ThermometerSnowflake,
	'filter-high-contrast': Aperture
};
