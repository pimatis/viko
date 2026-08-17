<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

{#if editor.pendingRestoreProject}
	<section
		class="fixed inset-x-0 top-0 z-[90] mx-auto flex w-full max-w-xl items-center gap-3 border border-border bg-card px-4 py-3 shadow-xl sm:top-5 sm:rounded-lg"
		aria-label="Restore project"
	>
		<div class="min-w-0 flex-1">
			<p class="text-sm font-semibold text-foreground">Continue where you left off</p>
			<p class="truncate text-xs text-muted-foreground">{editor.pendingRestoreProject.name}</p>
		</div>
		<Button variant="ghost" size="sm" onclick={() => editor.dismissPendingProject()}
			>New project</Button
		>
		<Button
			size="sm"
			disabled={editor.isRestoringProject}
			onclick={() => void editor.restorePendingProject()}
		>
			Continue
		</Button>
	</section>
{/if}
