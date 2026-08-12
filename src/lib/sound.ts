import { createUISFX, type CueName, type PlayingSFX } from 'uisfx';

const ui = createUISFX({ pack: 'studio', volume: 0.18, preferences: {} });

let unlocked = false;

async function ensureUnlocked() {
	if (!unlocked) unlocked = await ui.unlock();
}

function cue(name: CueName) {
	void ensureUnlocked();
	ui.play(name);
}

// semantic cues only; every sound pairs with visible feedback
export const sound = {
	select: () => cue('select'),
	toggleOn: () => cue('toggle-on'),
	toggleOff: () => cue('toggle-off'),
	drop: () => cue('drop'),
	error: () => cue('error'),
	delete: () => cue('delete'),
	seek: () => cue('seek'),
	undo: () => cue('undo'),
	success: () => cue('success'),
	start: () => cue('start'),
	redo: () => cue('redo'),
	play: () => cue('play'),
	pause: () => cue('pause'),
	expand: () => cue('expand'),
	snap: () => cue('snap'),
	complete: () => cue('complete'),
	unlock: () => cue('unlock'),
	skipPrev: () => cue('skip-previous'),
	skipNext: () => cue('skip-next'),
	open: () => cue('open'),
	notification: () => cue('notification'),
	lock: () => cue('lock'),
	// loop cue; callers stop the handle when the visible state resolves
	processing: (): PlayingSFX | null => {
		void ensureUnlocked();
		return ui.play('processing');
	}
} as const;
