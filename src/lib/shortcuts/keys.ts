import type { ShortcutSpec } from './types';

const KEY_LABELS: Record<string, string> = {
	' ': 'Space',
	enter: 'Enter',
	escape: 'Esc',
	tab: 'Tab',
	backspace: 'Backspace',
	delete: 'Delete',
	arrowup: 'Arrow Up',
	arrowdown: 'Arrow Down',
	arrowleft: 'Arrow Left',
	arrowright: 'Arrow Right',
	home: 'Home',
	end: 'End',
	pageup: 'Page Up',
	pagedown: 'Page Down'
};

const ARROW_SYMBOLS: Record<string, string> = {
	arrowup: '\u2191',
	arrowdown: '\u2193',
	arrowleft: '\u2190',
	arrowright: '\u2192'
};

let platform: string | null = null;

export function isMacOS(): boolean {
	if (platform === null) {
		platform =
			typeof navigator !== 'undefined' &&
			/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)
				? 'mac'
				: 'other';
	}
	return platform === 'mac';
}

export function normalizeKey(key: string): string {
	const normalized = key.toLocaleLowerCase();
	return normalized === ' ' ? ' ' : normalized.trim();
}

export function keyLabel(key: string): string {
	const normalized = normalizeKey(key);
	if (normalized === '+' || normalized === '-') {
		return isMacOS() ? normalized : normalized === '+' ? 'Plus' : 'Minus';
	}
	const arrow = ARROW_SYMBOLS[normalized];
	if (arrow && isMacOS()) return arrow;
	const label = KEY_LABELS[normalized];
	if (label) return label;
	if (normalized.length === 1) return normalized.toUpperCase();
	return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function formatShortcut(spec: ShortcutSpec): string {
	const mac = isMacOS();
	const keys: string[] = [];

	if (mac) {
		if (spec.ctrlOrMeta || spec.meta) keys.push('\u2318');
		if (spec.ctrl) keys.push('\u2303');
		if (spec.alt) keys.push('\u2325');
		if (spec.shift) keys.push('\u21e7');
		return [...keys, keyLabel(spec.key)].join('');
	}

	if (spec.ctrlOrMeta || spec.ctrl) keys.push('Ctrl');
	if (spec.meta) keys.push('Meta');
	if (spec.alt) keys.push('Alt');
	if (spec.shift) keys.push('Shift');
	return [...keys, keyLabel(spec.key)].join('+');
}

export function matchesShortcut(event: KeyboardEvent, spec: ShortcutSpec): boolean {
	const matchesKey = (spec.keys ?? [spec.key]).some(
		(key) => normalizeKey(key) === normalizeKey(event.key)
	);
	if (!matchesKey) return false;

	const ctrl = event.ctrlKey;
	const meta = event.metaKey;
	const alt = event.altKey;
	const shift = event.shiftKey;

	if (spec.ctrlOrMeta ? !(ctrl || meta) : spec.ctrl ? !ctrl : spec.meta ? !meta : ctrl || meta) {
		return false;
	}
	if (spec.alt !== undefined && alt !== spec.alt) return false;
	if (spec.shift !== undefined && shift !== spec.shift) return false;
	return true;
}
