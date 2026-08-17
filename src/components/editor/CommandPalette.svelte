<script lang="ts">
	import * as Command from '$lib/components/ui/command';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

<Command.Dialog
	bind:open={editor.commandPaletteOpen}
	title="Command Palette"
	description="Search for a command to run..."
	onOpenChange={(open) => {
		editor.commandPaletteOpen = open;
		if (open) void editor.loadVersionHistory();
	}}
>
	<Command.Input placeholder="Type a command or search..." />
	<Command.List>
		<Command.Empty>No results found.</Command.Empty>
		{#each editor.paletteGroups as group (group.group)}
			<Command.Group heading={group.group}>
				{#each group.items as cmd (cmd.id)}
					<Command.Item
						value={cmd.label}
						keywords={cmd.keywords ? [cmd.keywords] : undefined}
						disabled={cmd.disabled?.()}
						onSelect={() => editor.runPaletteCommand(cmd)}
					>
						{#if cmd.icon}
							<cmd.icon class="size-4" />
						{/if}
						<span>{cmd.label}</span>
						{#if cmd.hint}
							<Command.Shortcut>{cmd.hint}</Command.Shortcut>
						{/if}
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}
	</Command.List>
</Command.Dialog>
