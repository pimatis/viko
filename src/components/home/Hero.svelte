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

			<div class="mt-8 flex flex-wrap items-center justify-center gap-4">
				<a
					href="https://peerlist.io/queaxtra/project/viko"
					target="_blank"
					rel="noreferrer"
				>
					<img
						src="https://peerlist.io/api/v1/projects/embed/PRJHGNQOBMD7A9NEEFMPGEDDK99QRA?showUpvote=false&theme=dark"
						alt="Viko"
						style="width: auto; height: 45px;"
					/>
				</a>
				<a
					href="https://www.producthunt.com/products/viko?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-viko"
					target="_blank"
					rel="noopener noreferrer"
				>
					<img
						alt="Viko - Free video editor that runs entirely in your browser | Product Hunt"
						width="250"
						height="54"
						src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1221368&theme=dark&t=1786964425301"
						style="width: auto; height: 45px;"
					/>
				</a>
			</div>
		</div>
	</div>
</section>
