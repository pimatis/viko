<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { History, Search, Clock, Layers, Film, MapPin, RotateCcw } from '@lucide/svelte';
	import type { EditorState } from '$lib/editor/state.svelte';
	import { formatRelativeTime, getVersionMetadata } from '$lib/editor/versions';

	let { editor }: { editor: EditorState } = $props();
</script>

<Dialog.Root bind:open={editor.historyDialogOpen}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<div class="flex items-center gap-2">
				<History class="size-4 text-muted-foreground" />
				<Dialog.Title>Version History</Dialog.Title>
			</div>
			<Dialog.Description>
				Snapshots saved automatically and manually. Click any version to restore it.
			</Dialog.Description>
		</Dialog.Header>

		<!-- search bar -->
		<div class="mb-3 border-b border-border pb-3">
			<div class="relative">
				<Search
					class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={editor.versionSearchQuery}
					type="search"
					placeholder="Search versions by name..."
					class="h-8 pl-8 text-xs"
				/>
			</div>
		</div>

		<!-- version list -->
		<div class="max-h-80 space-y-1 overflow-y-auto pr-1">
			{#each editor.filteredVersions as version, i (version.id)}
				{@const meta = getVersionMetadata(version.document)}
				<button
					class="group relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-all hover:bg-secondary/60 disabled:cursor-wait disabled:opacity-50"
					disabled={editor.isRestoringVersion}
					onclick={() => editor.restoreVersion(version)}
				>
					<!-- timeline dot connector -->
					<div class="flex flex-col items-center pt-0.5">
						<div
							class="size-2.5 rounded-full border-2 border-primary/40 bg-card transition-colors group-hover:bg-primary/60"
						></div>
						{#if i < editor.filteredVersions.length - 1}
							<div class="mt-1 w-px flex-1 bg-border"></div>
						{/if}
					</div>

					<!-- first-frame preview thumbnail -->
					{#if version.thumbnail}
						<img
							src={version.thumbnail}
							alt={version.document.name}
							class="mt-0.5 size-16 shrink-0 rounded-md border border-border bg-black object-cover"
							loading="lazy"
						/>
					{:else}
						<div
							class="mt-0.5 flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground/60"
						>
							<Film class="size-4" />
						</div>
					{/if}

					<!-- content -->
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-2">
							<span class="truncate text-xs font-semibold text-foreground">
								{version.document.name}
							</span>
							<span
								class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums"
							>
								<Clock class="size-2.5" />
								{formatRelativeTime(version.createdAt)}
							</span>
						</div>
						<!-- metadata badges -->
						<div class="mt-1.5 flex items-center gap-2.5">
							<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
								<Layers class="size-2.5" />
								{meta.tracks}
							</span>
							<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
								<Film class="size-2.5" />
								{meta.clips}
							</span>
							{#if meta.markers > 0}
								<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
									<MapPin class="size-2.5" />
									{meta.markers}
								</span>
							{/if}
							<span class="ml-auto text-[10px] text-muted-foreground tabular-nums">
								{new Date(version.createdAt).toLocaleTimeString([], {
									hour: '2-digit',
									minute: '2-digit'
								})}
							</span>
						</div>
					</div>

					<!-- restore icon on hover -->
					<div
						class="flex shrink-0 items-center pt-0.5 text-muted-foreground opacity-0 transition-all group-hover:text-primary group-hover:opacity-100"
					>
						<RotateCcw class="size-3.5" />
					</div>
				</button>
			{:else}
				<div class="flex flex-col items-center gap-3 py-10">
					<History class="size-8 text-muted-foreground/40" />
					<p class="text-center text-xs text-muted-foreground">
						{editor.versions.length > 0 ? 'No versions match your search' : 'No saved versions yet'}
					</p>
					{#if editor.versions.length === 0}
						<p class="text-center text-[10px] text-muted-foreground/60">
							Save the project to create your first snapshot
						</p>
					{/if}
				</div>
			{/each}
		</div>

		{#if editor.versions.length > 0}
			<Dialog.Footer>
				<span class="mr-auto text-[10px] text-muted-foreground">
					{editor.filteredVersions.length} of {editor.versions.length} versions
				</span>
				<Button variant="ghost" onclick={() => (editor.historyDialogOpen = false)}>Close</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
