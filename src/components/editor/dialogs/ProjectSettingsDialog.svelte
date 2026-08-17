<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { EditorState } from '$lib/editor/state.svelte';

	let { editor }: { editor: EditorState } = $props();
</script>

<Dialog.Root bind:open={editor.projectSettingsOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Project Settings</Dialog.Title>
			<Dialog.Description>
				Frame rate and resolution apply to the whole project - preview, timecode and export.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-5 py-1">
			<div>
				<span class="mb-2 block text-xs font-medium text-foreground">Frame rate</span>
				<div class="grid grid-cols-5 gap-1.5">
					{#each editor.FRAME_RATE_OPTIONS as fps (fps)}
						<Button
							variant={fps === editor.frameRate ? 'default' : 'outline'}
							size="sm"
							class="tabular-nums"
							onclick={() => editor.applyProjectFrameRate(fps)}
						>
							{fps} fps
						</Button>
					{/each}
				</div>
			</div>
			<div>
				<span class="mb-2 block text-xs font-medium text-foreground">Resolution</span>
				<div class="grid grid-cols-2 gap-1.5">
					{#each editor.PROJECT_RESOLUTIONS as res (res.id)}
						<Button
							variant={editor.playerAspectRatio.width === res.width &&
							editor.playerAspectRatio.height === res.height
								? 'default'
								: 'outline'}
							size="sm"
							class="justify-between"
							onclick={() => editor.applyProjectResolution(res.width, res.height)}
						>
							<span>{res.label}</span>
							<span class="text-[10px] tabular-nums opacity-70">{res.width}x{res.height}</span>
						</Button>
					{/each}
				</div>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (editor.projectSettingsOpen = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
