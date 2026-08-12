<script lang="ts">
	import { Scissors, Sparkles, Timer, Upload } from '@lucide/svelte';

	const STEPS = [
		{
			icon: Upload,
			title: 'Import media',
			body: 'Drop video, audio and image files into the sidebar. Everything stays on your machine.'
		},
		{
			icon: Scissors,
			title: 'Cut and arrange',
			body: 'Split with the razor, trim edge handles, snap to the playhead and ripple delete with one key.'
		},
		{
			icon: Sparkles,
			title: 'Animate and grade',
			body: 'Add keyframes, transitions, effects, captions and color grade each clip from the properties panel.'
		},
		{
			icon: Timer,
			title: 'Export MP4',
			body: 'Render offline at up to 4K with full audio mixing, transitions and effect stack.'
		}
	];
</script>

<section id="workflow" class="py-16 sm:py-20">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-16 sm:pt-20 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="max-w-lg">
					<h2 class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
						From raw clips to finished cut, in four steps.
					</h2>
				</div>

				<div class="mt-10 grid gap-3 md:grid-cols-4">
					{#each STEPS as step, i (step.title)}
						<div class="relative rounded-lg border border-border/80 bg-card/40 p-4">
							<div class="flex items-center justify-between">
								<span
									class="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
								>
									<step.icon class="size-4" />
								</span>
								<span class="text-2xl font-bold text-muted-foreground/20 tabular-nums"
									>0{i + 1}</span
								>
							</div>
							<h3 class="mt-4 text-sm font-semibold text-foreground">{step.title}</h3>
							<p class="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>
