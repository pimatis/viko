<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Check, Download, MonitorPlay, ShieldCheck } from '@lucide/svelte';

	const POINTS = [
		'Offline MP4 rendering with audio mixing',
		'Exports from 360p up to 4K resolution',
		'Deterministic effects, transitions and grading',
		'Version history keeps up to 20 snapshots'
	];
</script>

<section id="export" class="py-16 sm:py-20">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-16 sm:pt-20 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="grid gap-10 lg:grid-cols-2 lg:items-center">
					<div>
						<h2 class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
							Render offline. Ship instantly.
						</h2>
						<p class="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
							The export pipeline renders frames and mixes audio right in your browser, then encodes
							an MP4 you can download. Your media never leaves the machine.
						</p>
						<ul class="mt-6 flex flex-col gap-2.5">
							{#each POINTS as point (point)}
								<li class="flex items-start gap-2.5 text-sm text-muted-foreground">
									<span
										class="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"
									>
										<Check class="size-2.5" />
									</span>
									{point}
								</li>
							{/each}
						</ul>
						<a href={resolve('/editor')} class="mt-8 inline-block">
							<Button size="lg" class="gap-2 px-6 text-sm font-semibold">
								<Download class="size-4" />
								Export your first cut
							</Button>
						</a>
					</div>

					<div class="rounded-xl border border-border/80 bg-card/40 p-5">
						<div class="flex items-center gap-2.5 border-b border-border pb-3">
							<span
								class="flex size-8 items-center justify-center rounded-md bg-blue-500/15 text-blue-400"
							>
								<MonitorPlay class="size-4" />
							</span>
							<div>
								<p class="text-sm font-semibold text-foreground">Export settings</p>
								<p class="text-[11px] text-muted-foreground">Rendering 1080p, 60 fps</p>
							</div>
						</div>
						<div class="space-y-3 py-4">
							<div>
								<div class="mb-1.5 flex items-center justify-between text-[11px]">
									<span class="text-muted-foreground">Rendering frames</span>
									<span class="font-medium text-foreground tabular-nums">642 / 642</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div class="h-full w-full rounded-full bg-primary"></div>
								</div>
							</div>
							<div>
								<div class="mb-1.5 flex items-center justify-between text-[11px]">
									<span class="text-muted-foreground">Encoding MP4</span>
									<span class="font-medium text-foreground tabular-nums">100%</span>
								</div>
								<div class="h-1.5 overflow-hidden rounded-full bg-muted">
									<div class="h-full w-full rounded-full bg-emerald-400"></div>
								</div>
							</div>
						</div>
						<div
							class="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5"
						>
							<div class="flex items-center gap-2 text-xs">
								<ShieldCheck class="size-3.5 text-emerald-400" />
								<span class="text-muted-foreground">Export complete</span>
							</div>
							<span class="text-xs font-medium text-foreground tabular-nums">24.2 MB</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
