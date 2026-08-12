<script lang="ts">
	import { resolve } from '$app/paths';

	type LegalSection = {
		heading: string;
		body: string;
		items?: string[];
	};

	let {
		title,
		updated,
		lead,
		sections
	}: {
		title: string;
		updated: string;
		lead: string;
		sections: LegalSection[];
	} = $props();
</script>

<main class="py-16 sm:py-20">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="mx-auto max-w-3xl">
			<a
				href={resolve('/')}
				class="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
			>
				<svg
					class="size-3.5"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="m15 18-6-6 6-6"></path>
				</svg>
				Back to home
			</a>

			<h1 class="mt-6 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
			<p class="mt-2 text-xs text-muted-foreground">Last updated: {updated}</p>

			<p class="mt-6 text-sm leading-relaxed text-muted-foreground">{lead}</p>

			<div class="mt-10 flex flex-col gap-8">
				{#each sections as section (section.heading)}
					<section>
						<h2 class="text-base font-semibold text-foreground">{section.heading}</h2>
						<p class="mt-2 text-sm leading-relaxed text-muted-foreground">{section.body}</p>
						{#if section.items}
							<ul class="mt-3 flex flex-col gap-2">
								{#each section.items as item (item)}
									<li class="flex items-start gap-2.5 text-sm text-muted-foreground">
										<span
											class="mt-1.5 size-1 shrink-0 rounded-full bg-primary/50"
											aria-hidden="true"
										></span>
										<span class="leading-relaxed">{item}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/each}
			</div>
		</div>
	</div>
</main>
