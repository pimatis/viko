<script lang="ts">
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

{#if editor.projectNotice}
	<button
		class="fixed right-5 bottom-5 z-[80] flex max-w-sm items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-left text-xs text-foreground shadow-xl"
		onclick={() => (editor.projectNotice = null)}
	>
		<div class="size-1.5 shrink-0 rounded-full bg-primary"></div>
		<span class="font-medium">{editor.projectNotice}</span>
	</button>
{/if}
