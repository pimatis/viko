<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import type { Clip, SequenceClipTrack } from '$lib/editor/timeline';
	import { X } from '@lucide/svelte';

	type Props = {
		open?: boolean;
		clip?: Clip | null;
		onClose?: () => void;
		onSave?: (clip: Clip) => void;
	};

	let { open = $bindable(false), clip, onClose = () => {}, onSave = () => {} }: Props = $props();

	// local state mirrors the sequence tracks
	let tracks = $state<SequenceClipTrack[]>([]);

	$effect(() => {
		if (open && clip?.sequence) {
			// deep clone so edits are non-destructive until save
			tracks = clip.sequence.tracks.map((track) => ({
				...track,
				clips: track.clips.map((c) => ({ ...c }))
			}));
		}
	});

	function addTrack() {
		const colors = ['blue', 'green', 'red', 'yellow', 'purple', 'orange', 'cyan', 'pink'];
		const color = colors[tracks.length % colors.length];
		tracks = [
			...tracks,
			{
				id: crypto.randomUUID(),
				name: `Track ${tracks.length + 1}`,
				type: 'video',
				color,
				muted: false,
				locked: false,
				volume: 1,
				pan: 0,
				clips: []
			}
		];
	}

	function deleteTrack(trackId: string) {
		tracks = tracks.filter((t) => t.id !== trackId);
	}

	function updateTrackName(trackId: string, name: string) {
		tracks = tracks.map((t) => (t.id === trackId ? { ...t, name } : t));
	}

	function deleteClip(trackId: string, clipId: string) {
		tracks = tracks.map((track) =>
			track.id === trackId ? { ...track, clips: track.clips.filter((c) => c.id !== clipId) } : track
		);
	}

	function handleSave() {
		if (!clip) return;
		onSave({
			...clip,
			sequence: { tracks }
		});
		onClose();
	}

	// compute sequence duration from tracks
	const sequenceDuration = $derived(
		Math.max(
			0,
			...tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration))
		)
	);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
		<Dialog.Header class="flex-shrink-0">
			<Dialog.Title class="flex items-center gap-2">
				<span>Edit Sequence</span>
				{#if clip}
					<span class="text-sm font-normal text-muted-foreground">({clip.name})</span>
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				Editing nested sequence • Duration: {sequenceDuration.toFixed(1)}s • {tracks.length} track{tracks.length !==
				1
					? 's'
					: ''}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-1">
			<!-- simple track list -->
			<div class="min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-sidebar">
				{#if tracks.length === 0}
					<div class="flex h-32 items-center justify-center text-sm text-muted-foreground">
						No tracks. Click "Add Track" to create one.
					</div>
				{:else}
					<div class="divide-y divide-border">
						{#each tracks as track (track.id)}
							<div class="flex items-center gap-2 px-3 py-2 hover:bg-sidebar-accent/30">
								<div
									class="size-2 shrink-0 rounded-full"
									style="background-color: var(--track-{track.color}, #3b82f6)"
								></div>
								<input
									type="text"
									value={track.name}
									onchange={(e) => updateTrackName(track.id, (e.target as HTMLInputElement).value)}
									class="flex-1 bg-transparent text-xs font-semibold outline-none focus:underline"
								/>
								<span class="text-[10px] text-muted-foreground tabular-nums">
									{track.clips.length} clip{track.clips.length !== 1 ? 's' : ''}
								</span>
								<button
									class="rounded-sm p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
									onclick={() => deleteTrack(track.id)}
									title="Delete track"
								>
									<X class="size-3" />
								</button>
							</div>

							<!-- clips in this track -->
							{#if track.clips.length > 0}
								<div class="bg-sidebar/50 px-6 py-1.5">
									<div class="flex flex-wrap gap-1.5">
										{#each track.clips as seqClip (seqClip.id)}
											<div
												class="flex items-center gap-1.5 rounded-sm bg-secondary px-2 py-1 text-[10px]"
											>
												<span class="max-w-[100px] truncate">{seqClip.name}</span>
												<span class="text-muted-foreground tabular-nums">
													{seqClip.startTime.toFixed(1)}-{seqClip.duration.toFixed(1)}s
												</span>
												<button
													class="text-muted-foreground hover:text-destructive"
													onclick={() => deleteClip(track.id, seqClip.id)}
												>
													<X class="size-2.5" />
												</button>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>

			<!-- add track button -->
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={addTrack} class="h-7 text-xs">
					+ Add Track
				</Button>
			</div>
		</div>

		<Dialog.Footer class="flex-shrink-0">
			<Button variant="ghost" onclick={onClose}>Cancel</Button>
			<Button onclick={handleSave}>Save Changes</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
