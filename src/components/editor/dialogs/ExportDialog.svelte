<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

{#if editor.isExporting}
	<section
		class="fixed right-5 bottom-5 z-[80] w-72 border border-border bg-card p-4 shadow-xl"
		aria-label="Export progress"
	>
		<div class="mb-3 flex items-center justify-between gap-3">
			<p class="text-sm font-semibold text-foreground">Exporting video</p>
			<span class="text-xs text-muted-foreground tabular-nums">{editor.exportPercent}%</span>
		</div>
		<p class="mb-2 truncate text-xs text-muted-foreground">
			{editor.exportProgress?.message ?? 'Preparing...'}
		</p>
		<Progress value={editor.exportPercent} max={100} />
		{#if editor.exportQueue.length > 0}
			<p class="mt-2 text-xs text-muted-foreground">{editor.exportQueue.length} queued</p>
		{/if}
	</section>
{/if}
