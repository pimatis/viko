<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRight } from '@lucide/svelte';
</script>

<section class="py-20 sm:py-24">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-20 sm:pt-24 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="mx-auto max-w-3xl text-center">
					<h2 class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
						Your timeline is waiting.
					</h2>
					<p class="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
						Open the editor and start cutting. Projects save locally to your browser, so nothing
						leaves your machine until you export.
					</p>
					<div class="mt-8 flex justify-center">
						<a href={resolve('/editor')}>
							<Button size="lg" class="gap-2 px-8 text-sm font-semibold">
								Open the editor
								<ArrowRight class="size-4" />
							</Button>
						</a>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
