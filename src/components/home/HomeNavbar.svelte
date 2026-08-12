<script lang="ts">
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { ArrowRight, Menu, X } from '@lucide/svelte';

	let mobileOpen = $state(false);
	let scrolled = $state(false);

	$effect(() => {
		const onScroll = () => {
			scrolled = window.scrollY > 4;
		};
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// lock body scroll while the full-screen menu is open
	$effect(() => {
		if (!mobileOpen) return;
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});
</script>

{#if mobileOpen}
	<!-- full-screen mobile menu overlay: sibling of the header so fixed inset-0 targets the viewport -->
	<div
		class="fixed inset-0 z-50 flex flex-col bg-background md:hidden"
		role="dialog"
		aria-modal="true"
		aria-label="Menu"
	>
		<div class="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
			<a href={resolve('/')} class="flex items-center gap-2 text-foreground">
				<img src="/assets/logos/logo.png" alt="Viko" class="h-7 w-auto" draggable="false" />
				<span class="text-base font-bold tracking-tight">Viko</span>
			</a>
			<Button
				variant="ghost"
				size="icon"
				aria-label="Close menu"
				onclick={() => (mobileOpen = false)}
			>
				<X class="size-4" />
			</Button>
		</div>

		<nav class="flex flex-1 flex-col items-center justify-center gap-6 px-4" aria-label="Mobile">
			<a
				href="#features"
				class="text-2xl font-semibold text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => (mobileOpen = false)}
			>
				Features
			</a>
			<a
				href="#workflow"
				class="text-2xl font-semibold text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => (mobileOpen = false)}
			>
				Workflow
			</a>
			<a
				href="#export"
				class="text-2xl font-semibold text-muted-foreground transition-colors hover:text-foreground"
				onclick={() => (mobileOpen = false)}
			>
				Export
			</a>
		</nav>

		<div class="border-t border-dashed border-border/70 px-4 py-6">
			<div class="mx-auto max-w-6xl">
				<a href={resolve('/editor')}>
					<Button class="w-full gap-1.5 text-sm font-semibold">
						Start editing
						<ArrowRight class="size-4" />
					</Button>
				</a>
			</div>
		</div>
	</div>
{/if}

<header
	class="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md transition-[border-style] {scrolled
		? 'border-border/80'
		: 'border-dashed border-border/70'}"
>
	<div class="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
		<a href={resolve('/')} class="flex shrink-0 items-center gap-2 text-foreground">
			<img src="/assets/logos/logo.png" alt="Viko" class="h-7 w-auto" draggable="false" />
			<span class="text-base font-bold tracking-tight">Viko</span>
		</a>

		<nav class="hidden items-center gap-1 md:flex" aria-label="Primary">
			<a
				href="#features"
				class="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Features
			</a>
			<a
				href="#workflow"
				class="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Workflow
			</a>
			<a
				href="#export"
				class="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				Export
			</a>
		</nav>

		<div class="hidden items-center gap-2 md:flex">
			<a href={resolve('/editor')}>
				<Button size="sm" class="gap-1.5 text-xs font-semibold">
					Start editing
					<ArrowRight class="size-3.5" />
				</Button>
			</a>
		</div>

		<Button
			variant="ghost"
			size="icon"
			class="md:hidden"
			aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
			aria-expanded={mobileOpen}
			onclick={() => (mobileOpen = !mobileOpen)}
		>
			{#if mobileOpen}
				<X class="size-4" />
			{:else}
				<Menu class="size-4" />
			{/if}
		</Button>
	</div>
</header>
