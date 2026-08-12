export type EffectKind = 'effects' | 'transitions' | 'filters' | 'clip-transitions';

export type EffectPreset = {
	id: string;
	name: string;
	kind: EffectKind;
	category: string;
};

export type ClipEffect = {
	id: string;
	presetId: string;
};

export type EffectApplyRequest = {
	id: string;
	presetId: string;
};

export type EffectVisualState = {
	filter: string;
	transform: string;
	opacity: number;
};

export type ClipTransition = {
	presetId: string;
	duration: number;
	incomingClipId: string;
};

export type TransitionApplyRequest = {
	id: string;
	clipId: string;
	presetId: string;
};

export type TransitionRole = 'outgoing' | 'incoming';

export type ClipTransitionVisualState = {
	opacity: number;
	transform: string;
	translateXPercent: number;
	clipInsetRightPercent: number;
};
