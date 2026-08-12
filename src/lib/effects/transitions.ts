import type { ClipTransitionVisualState, TransitionRole } from './types';

const IDENTITY_TRANSFORM = 'none';
const IDENTITY_STATE: ClipTransitionVisualState = {
	opacity: 1,
	transform: IDENTITY_TRANSFORM,
	translateXPercent: 0,
	clipInsetRightPercent: 0
};

type TransitionOutgoingClip = {
	startTime: number;
	duration: number;
	clipTransition?: { incomingClipId: string; duration: number };
};

type TransitionIncomingClip = {
	id: string;
	startTime: number;
};

export function getClipPairTransitionProgress(
	outgoing: TransitionOutgoingClip,
	incoming: TransitionIncomingClip,
	currentTime: number
): number | null {
	const transition = outgoing.clipTransition;
	if (!transition || transition.incomingClipId !== incoming.id) return null;

	const transitionStart = incoming.startTime;
	const transitionEnd = outgoing.startTime + outgoing.duration;
	const overlapDuration = transitionEnd - transitionStart;
	if (overlapDuration <= 0) return null;
	if (Math.abs(overlapDuration - transition.duration) > 1 / 30) return null;
	if (currentTime < transitionStart || currentTime >= transitionEnd) return null;

	return Math.min(1, Math.max(0, (currentTime - transitionStart) / overlapDuration));
}

// compute the visual state for a clip participating in a pair transition
// progress is 0 at the start of the transition and 1 at the end
// the outgoing clip fades/moves out while the incoming clip fades/moves in
export function getClipTransitionVisualState(
	presetId: string,
	role: TransitionRole,
	progress: number
): ClipTransitionVisualState {
	const p = Math.min(1, Math.max(0, progress));

	switch (presetId) {
		case 'clip-transition-cross-dissolve':
			return getCrossDissolveState(role, p);
		case 'clip-transition-wipe':
			return getWipeState(role, p);
		case 'clip-transition-push':
			return getPushState(role, p);
		default:
			return IDENTITY_STATE;
	}
}

function getCrossDissolveState(role: TransitionRole, progress: number): ClipTransitionVisualState {
	if (role === 'outgoing') {
		return { ...IDENTITY_STATE, opacity: 1 - progress };
	}
	return { ...IDENTITY_STATE, opacity: progress };
}

function getWipeState(role: TransitionRole, progress: number): ClipTransitionVisualState {
	if (role === 'outgoing') {
		return IDENTITY_STATE;
	}
	return {
		opacity: 1,
		transform: IDENTITY_TRANSFORM,
		translateXPercent: 0,
		clipInsetRightPercent: (1 - progress) * 100
	};
}

function getPushState(role: TransitionRole, progress: number): ClipTransitionVisualState {
	if (role === 'outgoing') {
		return {
			opacity: 1,
			transform: `translateX(${-progress * 100}%)`,
			translateXPercent: -progress * 100,
			clipInsetRightPercent: 0
		};
	}
	return {
		opacity: 1,
		transform: `translateX(${(1 - progress) * 100}%)`,
		translateXPercent: (1 - progress) * 100,
		clipInsetRightPercent: 0
	};
}
