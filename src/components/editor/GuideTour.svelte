<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { getSetting, setSetting } from '$lib/db';
	import { guideSteps, GUIDE_DISMISSED_KEY, GUIDE_COMPLETED_KEY } from '$lib/editor/guide';
	import { sound } from '$lib/sound';
	import { Sparkles, X, ChevronRight, ChevronLeft, Check, Compass } from '@lucide/svelte';

	type Props = {
		onEnsureSidebarOpen?: () => void;
	};
	let { onEnsureSidebarOpen = () => {} }: Props = $props();

	let bannerVisible = $state(false);
	let welcomeDialogOpen = $state(false);
	let tourActive = $state(false);
	let currentStep = $state(0);
	let spotlightRect = $state<{
		top: number;
		left: number;
		width: number;
		height: number;
	} | null>(null);
	let tooltipPos = $state<{ top: number; left: number }>({ top: 0, left: 0 });
	let tooltipPlacement = $state<'bottom' | 'top' | 'right' | 'left'>('bottom');
	let completionDialogOpen = $state(false);
	let tooltipEl = $state<HTMLElement | null>(null);

	const TOOLTIP_WIDTH = 340;
	const SPOTLIGHT_PADDING = 6;
	const TOOLTIP_GAP = 16;

	function clamp(val: number, min: number, max: number): number {
		return Math.max(min, Math.min(val, max));
	}

	function updateSpotlight() {
		if (!tourActive) return;
		const step = guideSteps[currentStep];
		if (!step) {
			spotlightRect = null;
			return;
		}

		const el = document.querySelector(step.target);
		if (!el || !(el instanceof HTMLElement)) {
			spotlightRect = null;
			return;
		}

		const rect = el.getBoundingClientRect();
		if (rect.width < 10 || rect.height < 10) {
			spotlightRect = null;
			return;
		}

		spotlightRect = {
			top: rect.top - SPOTLIGHT_PADDING,
			left: rect.left - SPOTLIGHT_PADDING,
			width: rect.width + SPOTLIGHT_PADDING * 2,
			height: rect.height + SPOTLIGHT_PADDING * 2
		};
		calculateTooltipPosition(rect);

		// re-measure after DOM reflects new step content
		requestAnimationFrame(() => {
			if (!tourActive || !tooltipEl) return;
			calculateTooltipPosition(rect);
		});
	}

	function calculateTooltipPosition(rect: DOMRect) {
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const gap = TOOLTIP_GAP;
		const tooltipHeight = tooltipEl?.offsetHeight ?? 220;

		if (rect.bottom + tooltipHeight + gap < vh) {
			tooltipPlacement = 'bottom';
			const left = clamp(
				rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2,
				16,
				vw - TOOLTIP_WIDTH - 16
			);
			tooltipPos = { top: rect.bottom + gap, left };
		} else if (rect.top - tooltipHeight - gap > 0) {
			tooltipPlacement = 'top';
			const left = clamp(
				rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2,
				16,
				vw - TOOLTIP_WIDTH - 16
			);
			tooltipPos = { top: rect.top - tooltipHeight - gap, left };
		} else if (rect.right + TOOLTIP_WIDTH + gap < vw) {
			tooltipPlacement = 'right';
			const top = clamp(
				rect.top + rect.height / 2 - tooltipHeight / 2,
				16,
				vh - tooltipHeight - 16
			);
			tooltipPos = { top, left: rect.right + gap };
		} else {
			tooltipPlacement = 'left';
			const top = clamp(
				rect.top + rect.height / 2 - tooltipHeight / 2,
				16,
				vh - tooltipHeight - 16
			);
			tooltipPos = { top, left: Math.max(16, rect.left - TOOLTIP_WIDTH - gap) };
		}
	}

	async function dismissBanner() {
		sound.select();
		bannerVisible = false;
		await setSetting(GUIDE_DISMISSED_KEY, true);
	}

	function startTour() {
		sound.start();
		bannerVisible = false;
		welcomeDialogOpen = true;
	}

	async function skipWelcome() {
		sound.pause();
		welcomeDialogOpen = false;
		await setSetting(GUIDE_DISMISSED_KEY, true);
	}

	function beginSpotlightTour() {
		sound.select();
		welcomeDialogOpen = false;
		onEnsureSidebarOpen();
		currentStep = 0;
		tourActive = true;
		setTimeout(() => updateSpotlight(), 350);
	}

	function nextStep() {
		sound.select();
		if (currentStep < guideSteps.length - 1) {
			currentStep += 1;
			setTimeout(() => updateSpotlight(), 50);
		} else {
			finishTour();
		}
	}

	function prevStep() {
		sound.undo();
		if (currentStep > 0) {
			currentStep -= 1;
			setTimeout(() => updateSpotlight(), 50);
		}
	}

	async function skipTour() {
		sound.pause();
		tourActive = false;
		spotlightRect = null;
		await setSetting(GUIDE_COMPLETED_KEY, true);
	}

	async function finishTour() {
		sound.complete();
		tourActive = false;
		spotlightRect = null;
		await setSetting(GUIDE_COMPLETED_KEY, true);
		completionDialogOpen = true;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!tourActive) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			skipTour();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			nextStep();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			prevStep();
		}
	}

	function handleResize() {
		if (tourActive) updateSpotlight();
	}

	onMount(async () => {
		try {
			const [dismissed, completed] = await Promise.all([
				getSetting<boolean>(GUIDE_DISMISSED_KEY),
				getSetting<boolean>(GUIDE_COMPLETED_KEY)
			]);
			if (!dismissed && !completed) {
				bannerVisible = true;
			}
		} catch {
			bannerVisible = true;
		}
	});

	onDestroy(() => {
		tourActive = false;
	});
</script>

<svelte:window onresize={handleResize} onkeydown={handleKeydown} />

{#if bannerVisible}
	<div
		class="flex h-9 shrink-0 items-center gap-3 border-b border-primary/20 bg-primary/10 px-3 text-xs"
	>
		<Compass class="size-4 shrink-0 text-primary" />
		<span class="flex-1 truncate text-foreground">
			New to Viko? Take a quick tour to learn the editor layout.
		</span>
		<Button variant="default" size="xs" class="gap-1.5 font-semibold" onclick={startTour}>
			<Sparkles class="size-3.5" />
			Start Tour
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground hover:text-foreground"
			onclick={dismissBanner}
			aria-label="Dismiss tour"
		>
			<X class="size-4" />
		</Button>
	</div>
{/if}

<Dialog.Root bind:open={welcomeDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<div class="flex items-center gap-2">
				<div class="flex size-9 items-center justify-center rounded-lg bg-primary/10">
					<Compass class="size-5 text-primary" />
				</div>
				<Dialog.Title>Welcome to Viko Editor</Dialog.Title>
			</div>
			<Dialog.Description>
				This quick tour walks you through the 5 key areas of the editor: navigation bar, media
				sidebar, toolbar, preview player, and timeline. You'll learn where everything is and how to
				start editing.
			</Dialog.Description>
		</Dialog.Header>
		<div
			class="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground"
		>
			<Check class="size-4 shrink-0 text-emerald-500" />
			<span>Takes about 60 seconds. You can skip at any time with Escape.</span>
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={skipWelcome}>Skip</Button>
			<Button variant="default" class="gap-1.5 font-semibold" onclick={beginSpotlightTour}>
				Begin Tour
				<ChevronRight class="size-4" />
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

{#if tourActive && spotlightRect}
	<div class="fixed inset-0 z-40"></div>
	<div
		style="position: fixed; top: {spotlightRect.top}px; left: {spotlightRect.left}px; width: {spotlightRect.width}px; height: {spotlightRect.height}px; border-radius: 10px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.6); pointer-events: none; z-index: 41; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); border: 2px solid rgba(255,255,255,0.25);"
	></div>
	<div
		style="position: fixed; top: {tooltipPos.top}px; left: {tooltipPos.left}px; width: {TOOLTIP_WIDTH}px; z-index: 50; transition: top 0.3s ease, left 0.3s ease; max-height: calc(100vh - 32px);"
		class="flex flex-col rounded-xl bg-popover p-4 text-popover-foreground shadow-2xl ring-1 ring-foreground/10"
		bind:this={tooltipEl}
	>
		<div class="mb-3 flex shrink-0 items-center justify-between">
			<span class="text-[10px] font-bold tracking-wider text-primary uppercase">
				{guideSteps[currentStep].title}
			</span>
			<span class="text-[10px] font-medium text-muted-foreground tabular-nums">
				{currentStep + 1} / {guideSteps.length}
			</span>
		</div>
		<div class="mb-3 h-1 shrink-0 overflow-hidden rounded-full bg-secondary">
			<div
				class="h-full rounded-full bg-primary transition-all duration-300"
				style="width: {((currentStep + 1) / guideSteps.length) * 100}%"
			></div>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto">
			<p class="mb-4 text-xs leading-relaxed text-foreground/90">
				{guideSteps[currentStep].description}
			</p>
		</div>
		<div class="flex shrink-0 items-center justify-between gap-2 pt-1">
			<Button variant="ghost" size="xs" class="text-muted-foreground" onclick={skipTour}>
				Skip tour
			</Button>
			<div class="flex items-center gap-1.5">
				{#if currentStep > 0}
					<Button variant="outline" size="xs" class="gap-1" onclick={prevStep}>
						<ChevronLeft class="size-3.5" />
						Prev
					</Button>
				{/if}
				<Button variant="default" size="xs" class="gap-1 font-semibold" onclick={nextStep}>
					{#if currentStep < guideSteps.length - 1}
						Next
						<ChevronRight class="size-3.5" />
					{:else}
						<Check class="size-3.5" />
						Finish
					{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}

<Dialog.Root bind:open={completionDialogOpen}>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<div class="flex items-center gap-2">
				<div class="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10">
					<Check class="size-5 text-emerald-500" />
				</div>
				<Dialog.Title>You're all set!</Dialog.Title>
			</div>
			<Dialog.Description>
				You now know the key areas of the Viko editor. Press Ctrl+K for the command palette or
				Ctrl+/ for keyboard shortcuts anytime.
			</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button
				variant="default"
				class="font-semibold"
				onclick={() => (completionDialogOpen = false)}
			>
				Start editing
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
