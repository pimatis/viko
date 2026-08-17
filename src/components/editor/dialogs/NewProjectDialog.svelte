<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

<Dialog.Root bind:open={editor.newProjectDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>New project</Dialog.Title>
			<Dialog.Description>
				The current timeline will be cleared. Save it first if you need it later.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (editor.newProjectDialogOpen = false)}>Cancel</Button>
			<Button variant="destructive" onclick={() => editor.createNewProject()}>Create project</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
