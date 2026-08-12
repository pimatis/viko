<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRight } from '@lucide/svelte';
</script>

<section class="relative overflow-hidden">
	<!-- ambient glow -->
	<div class="pointer-events-none absolute inset-0" aria-hidden="true">
		<div
			class="absolute -top-40 left-1/2 h-105 w-200 -translate-x-1/2 rounded-full bg-primary/[0.04] blur-3xl"
		></div>
	</div>

	<div
		class="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-20 pb-24 text-center sm:px-6 md:pt-28 lg:px-14 lg:pt-32 lg:pb-32 xl:px-16"
	>
		<div class="w-full max-w-2xl lg:px-6 xl:px-8">
			<h1
				class="text-4xl leading-[1.08] font-bold tracking-tight text-foreground sm:text-5xl lg:text-[3.4rem]"
			>
				Edit video like a
				<span class="text-muted-foreground">pro editor.</span>
			</h1>

			<p class="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
				Viko is a browser-based video editor with a frame-precise timeline, multi-track playback,
				keyframe animation, color grading and an offline export pipeline. No uploads, no watermarks,
				no waiting room.
			</p>

			<div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<a href={resolve('/editor')}>
					<Button size="lg" class="w-full gap-2 px-6 text-sm font-semibold sm:w-auto">
						Start editing
						<ArrowRight class="size-4" />
					</Button>
				</a>
				<a href="#features">
					<Button variant="outline" size="lg" class="w-full gap-2 px-6 text-sm sm:w-auto">
						See what it does
					</Button>
				</a>
			</div>
		</div>
	</div>
</section>
