<script lang="ts">
	import HomeNavbar from '../components/home/HomeNavbar.svelte';
	import Hero from '../components/home/Hero.svelte';
	import Features from '../components/home/Features.svelte';
	import Workflow from '../components/home/Workflow.svelte';
	import FaqSection from '../components/home/FaqSection.svelte';
	import ExportCTA from '../components/home/ExportCTA.svelte';
	import CtaBanner from '../components/home/CtaBanner.svelte';
	import HomeFooter from '../components/home/HomeFooter.svelte';
</script>

<svelte:head>
	<meta
		name="description"
		content="Viko is a free, browser-based video editor. Edit video with a frame-precise timeline, multi-track playback, keyframe animation, color grading and offline MP4 export. No uploads, no watermarks, open source."
	/>
	<meta property="og:type" content="website" />
	<meta property="og:title" content="Viko - Free Online Video Editor" />
	<meta
		property="og:description"
		content="Free, browser-based video editor with a frame-precise timeline, multi-track playback, keyframe animation, color grading and offline MP4 export."
	/>
	<meta property="og:url" content="https://github.com/pimatis/viko" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Viko - Free Online Video Editor" />
	<meta
		name="twitter:description"
		content="Edit video in your browser with a frame-precise timeline, keyframes, color grading and offline export."
	/>
</svelte:head>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<HomeNavbar />
	<main class="relative flex-1">
		<!-- dikey dashed çerçeve: navbar altından footer'a kadar tüm sayfayı kapsar -->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute top-0 bottom-0 left-1/2 z-10 hidden w-full max-w-6xl -translate-x-1/2 px-4 sm:px-6 lg:block lg:px-14 xl:px-16"
		>
			<div class="flex h-full justify-between">
				<div class="w-px border-l border-dashed border-border/70"></div>
				<div class="w-px border-l border-dashed border-border/70"></div>
			</div>
		</div>
		<Hero />
		<Features />
		<Workflow />
		<ExportCTA />
		<FaqSection />
		<CtaBanner />
		<HomeFooter />
	</main>
</div>
