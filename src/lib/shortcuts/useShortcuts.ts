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
	function isBindingEnabled(binding: ShortcutBinding, event: KeyboardEvent): boolean {
		if (!matchesShortcut(event, binding)) return false;
		if (binding.enabled && !binding.enabled()) return false;
		if (binding.ignoreWhenTyping && isTypingTarget(event.target)) return false;
		return true;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		for (const binding of bindings) {
			if (!isBindingEnabled(binding, event)) continue;
			event.preventDefault();
			binding.onKeyDown(event);
			return;
		}
	}

	function handleKeyup(event: KeyboardEvent) {
		if (event.defaultPrevented) return;
		for (const binding of bindings) {
			if (!binding.onKeyUp) continue;
			if (!isBindingEnabled(binding, event)) continue;
			binding.onKeyUp(event);
			return;
		}
	}

	window.addEventListener('keydown', handleKeydown);
	window.addEventListener('keyup', handleKeyup);

	return {
		update(nextBindings: ShortcutBinding[]) {
			bindings = nextBindings;
		},
		destroy() {
			window.removeEventListener('keydown', handleKeydown);
			window.removeEventListener('keyup', handleKeyup);
		}
	};
};
