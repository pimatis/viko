<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRight, HelpCircle } from '@lucide/svelte';

	const FAQS = [
		{
			question: 'Is Viko really free?',
			answer:
				'Yes. Viko is free and open source under the Apache License 2.0. There are no subscriptions, no watermarks, no account requirements and no upload limits.'
		},
		{
			question: 'Does Viko upload my videos to a server?',
			answer:
				'No. Viko runs entirely in your browser. Your media, projects and exports never leave your device. There is no backend and no cloud rendering.'
		},
		{
			question: 'What can I edit with Viko?',
			answer:
				'Viko is a video editor with a multi-track, frame-precise timeline. You can cut and trim clips, add text and stickers, animate with keyframes, apply effects and transitions, color grade, key out green screens, add captions from transcripts or transcription, duck audio and more.'
		},
		{
			question: 'Can I export MP4?',
			answer:
				'Yes. The export pipeline renders frames and mixes audio offline in your browser, then encodes an MP4 you download. Export quality ranges from 360p up to 4K depending on the render budget.'
		},
		{
			question: 'Where are my projects saved?',
			answer:
				'Projects, imported media and up to 20 version snapshots are saved in your browser via IndexedDB. Clearing site data for the Viko domain removes them, so keep backups of anything you care about.'
		},
		{
			question: 'Which browsers and devices are supported?',
			answer:
				'Viko is a desktop-first tool built for Chrome, Edge, Safari and Firefox on large displays with a mouse and keyboard. The editor is not designed for phones or small touch screens.'
		},
		{
			question: 'Can I contribute to Viko?',
			answer:
				'Yes. The source code is on GitHub at https://github.com/pimatis/viko. Bug reports, feature requests and pull requests are welcome under the Apache 2.0 license.'
		}
	];
</script>

<svelte:head>
	<script type="application/ld+json">
		{
			"@context": "https://schema.org",
			"@type": "FAQPage",
			"mainEntity": [
				{
					"@type": "Question",
					"name": "Is Viko really free?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Yes. Viko is free and open source under the Apache License 2.0. There are no subscriptions, no watermarks, no account requirements and no upload limits."
					}
				},
				{
					"@type": "Question",
					"name": "Does Viko upload my videos to a server?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "No. Viko runs entirely in your browser. Your media, projects and exports never leave your device. There is no backend and no cloud rendering."
					}
				},
				{
					"@type": "Question",
					"name": "What can I edit with Viko?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Viko is a video editor with a multi-track, frame-precise timeline. Cut and trim clips, add text and stickers, animate with keyframes, apply effects and transitions, color grade, key out green screens, add captions and duck audio."
					}
				},
				{
					"@type": "Question",
					"name": "Can I export MP4?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Yes. The export pipeline renders frames and mixes audio offline in your browser, then encodes an MP4 you download, from 360p up to 4K."
					}
				},
				{
					"@type": "Question",
					"name": "Where are my projects saved?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Projects, imported media and up to 20 version snapshots are saved in your browser via IndexedDB. Clearing site data removes them."
					}
				},
				{
					"@type": "Question",
					"name": "Which browsers and devices are supported?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Viko is a desktop-first tool built for Chrome, Edge, Safari and Firefox on large displays with a mouse and keyboard."
					}
				},
				{
					"@type": "Question",
					"name": "Can I contribute to Viko?",
					"acceptedAnswer": {
						"@type": "Answer",
						"text": "Yes. The source code is on GitHub at https://github.com/pimatis/viko. Bug reports, feature requests and pull requests are welcome under the Apache 2.0 license."
					}
				}
			]
		}
	</script>
</svelte:head>

<section id="faq" class="py-16 sm:py-20">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-16 sm:pt-20 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
					<div class="max-w-lg">
						<h2 class="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
							Frequently asked questions
						</h2>
					</div>
				</div>

				<div class="mt-10 grid gap-3 md:grid-cols-2">
					{#each FAQS as faq (faq.question)}
						<div
							class="group flex flex-col rounded-lg border border-border/80 bg-card/40 p-4 transition-colors hover:border-border hover:bg-card"
						>
							<div class="flex items-center gap-2.5">
								<span
									class="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground"
								>
									<HelpCircle class="size-4" />
								</span>
								<h3 class="text-xs font-semibold text-foreground">{faq.question}</h3>
							</div>
							<p class="mt-3 text-xs leading-relaxed text-muted-foreground">{faq.answer}</p>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>
