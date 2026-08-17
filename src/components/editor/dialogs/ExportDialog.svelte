<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Progress } from '$lib/components/ui/progress';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

<Dialog.Root open={editor.isExporting} onOpenChange={() => {}}>
	<Dialog.Content class="sm:max-w-sm" showCloseButton={false}>
		<Dialog.Header>
			<Dialog.Title>Exporting video</Dialog.Title>
			<Dialog.Description>
				{editor.exportProgress?.message ?? 'Preparing...'}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2">
			<Progress value={editor.exportPercent} max={100} />
			<p class="text-xs text-muted-foreground tabular-nums">{editor.exportPercent}%</p>
		</div>
	</Dialog.Content>
</Dialog.Root>
