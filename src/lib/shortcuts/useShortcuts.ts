import type { Action } from 'svelte/action';
import { matchesShortcut } from './keys';
import type { ShortcutBinding } from './types';

export function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target.isContentEditable ||
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

export const useShortcuts: Action<HTMLElement, ShortcutBinding[]> = (node, bindings = []) => {
	function handleKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		for (const binding of bindings) {
			if (!matchesShortcut(event, binding)) continue;
			if (binding.enabled && !binding.enabled()) continue;
			if (binding.ignoreWhenTyping && isTypingTarget(event.target)) continue;
			event.preventDefault();
			binding.onKeyDown(event);
			return;
		}
	}

	window.addEventListener('keydown', handleKeydown);

	return {
		update(nextBindings: ShortcutBinding[]) {
			bindings = nextBindings;
		},
		destroy() {
			window.removeEventListener('keydown', handleKeydown);
		}
	};
};
