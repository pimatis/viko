<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

<Dialog.Root bind:open={editor.shortcutsDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Keyboard shortcuts</Dialog.Title>
			<Dialog.Description>Editor commands available outside text inputs.</Dialog.Description>
		</Dialog.Header>
		<div class="grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-xs">
			<span>Select, razor, hand, text</span><kbd>V / B / H / T</kbd>
			<span>Toggle snapping</span><kbd>S</kbd>
			<span>Play or pause</span><kbd>Space</kbd>
			<span>Previous or next frame</span><kbd>Left / Right</kbd>
			<span>New or open project</span><kbd>Ctrl+N / Ctrl+O</kbd>
			<span>Save project</span><kbd>Ctrl+S</kbd>
			<span>Save project as</span><kbd>Ctrl+Shift+S</kbd>
			<span>Export project</span><kbd>Ctrl+E</kbd>
			<span>Toggle sidebar</span><kbd>Ctrl+B</kbd>
			<span>Zoom in or out</span><kbd>Ctrl+= / Ctrl+-</kbd>
			<span>Fit to screen</span><kbd>Ctrl+0</kbd>
			<span>Split selected clips</span><kbd>Ctrl+Shift+B</kbd>
			<span>Trim start or end</span><kbd>Q / W</kbd>
			<span>Copy, cut, paste, duplicate</span><kbd>Ctrl+C / X / V / D</kbd>
			<span>Undo or redo</span><kbd>Ctrl+Z / Ctrl+Shift+Z</kbd>
			<span>Nudge clip 1 frame</span><kbd>Shift+Arrow</kbd>
			<span>Nudge clip 10 frames</span><kbd>Ctrl+Arrow</kbd>
			<span>Add marker</span><kbd>M</kbd>
			<span>Add keyframe at playhead</span><kbd>K</kbd>
			<span>Freeze frame at playhead</span><kbd>F</kbd>
			<span>Reverse selected clips</span><kbd>Shift+R</kbd>
			<span>Set in / out point</span><kbd>I / O</kbd>
			<span>Clear in/out points</span><kbd>Ctrl+Shift+I</kbd>
			<span>Toggle ripple mode</span><kbd>R</kbd>
			<span>Group selected clips</span><kbd>Ctrl+G</kbd>
			<span>Ungroup clips</span><kbd>Ctrl+Shift+G</kbd>
			<span>Ripple delete</span><kbd>Shift+Del</kbd>
			<span>Keyboard shortcuts</span><kbd>Ctrl+/</kbd>
		</div>
	</Dialog.Content>
</Dialog.Root>
