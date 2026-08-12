<script lang="ts">
	import {
		Captions,
		Droplets,
		KeyRound,
		Palette,
		Repeat2,
		Scissors,
		Undo2,
		Volume2
	} from '@lucide/svelte';

	const FEATURES = [
		{
			icon: Scissors,
			tint: 'bg-blue-500/15 text-blue-400',
			title: 'Frame-precise timeline',
			body: 'Track-based editing with 60 fps precision, trim handles, snapping, ripple mode and keyboard-first controls.'
		},
		{
			icon: KeyRound,
			tint: 'bg-purple-500/15 text-purple-400',
			title: 'Keyframe animation',
			body: 'Animate position, scale, rotation, opacity and blend modes with bezier easing on any visual clip.'
		},
		{
			icon: Palette,
			tint: 'bg-emerald-500/15 text-emerald-400',
			title: 'Color grading',
			body: 'Wheels for shadows, midtones and highlights, RGB curves and LUT presets, applied deterministically per frame.'
		},
		{
			icon: Droplets,
			tint: 'bg-amber-500/15 text-amber-400',
			title: 'Chroma key',
			body: 'Green screen with similarity, smoothness and spill suppression controls rendered live in the preview.'
		},
		{
			icon: Captions,
			tint: 'bg-blue-500/15 text-blue-400',
			title: 'Captions and transcription',
			body: 'Auto-align captions from a transcript or transcribe media speech straight onto subtitle tracks.'
		},
		{
			icon: Volume2,
			tint: 'bg-purple-500/15 text-purple-400',
			title: 'Audio ducking',
			body: 'Sidechain-aware ducking with per-clip fades, reverse playback and waveform-based editing.'
		},
		{
			icon: Repeat2,
			tint: 'bg-emerald-500/15 text-emerald-400',
			title: 'Speed ramps',
			body: 'Per-clip playback rate from 0.1x to 10x with freeze frames and speed-ramp aware clip timing.'
		},
		{
			icon: Undo2,
			tint: 'bg-amber-500/15 text-amber-400',
			title: 'Undo and version history',
			body: 'Every mutation lands in undo and redo stacks, with up to 20 snapshots saved to local storage.'
		}
	];
</script>

<section id="features" class="py-16 sm:py-20">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-16 sm:pt-20 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="max-w-lg">
					<h2 class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
						A complete editing room, in a browser tab.
					</h2>
				</div>

				<div class="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{#each FEATURES as feature (feature.title)}
						<div
							class="group flex flex-col rounded-lg border border-border/80 bg-card/40 p-4 transition-colors hover:border-border hover:bg-card"
						>
							<div class="flex items-center gap-2.5">
								<span class="flex size-8 items-center justify-center rounded-md {feature.tint}">
									<feature.icon class="size-4" />
								</span>
								<span class="text-xs font-semibold text-foreground">{feature.title}</span>
							</div>
							<p class="mt-3 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>
