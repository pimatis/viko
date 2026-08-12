<script lang="ts">
	import { Check } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { isMobileDevice } from '$lib/platform';

	const STORAGE_KEY = 'viko:mobile-notice-dismissed';

	let isMobile = $state(false);
	let dismissed = $state(false);
	let continueButton = $state<HTMLButtonElement | null>(null);

	$effect(() => {
		const update = () => {
			isMobile = isMobileDevice();
		};
		update();
		const coarseQuery = window.matchMedia('(pointer: coarse)');
		coarseQuery.addEventListener('change', update);
		window.addEventListener('resize', update);
		window.addEventListener('orientationchange', update);
		return () => {
			coarseQuery.removeEventListener('change', update);
			window.removeEventListener('resize', update);
			window.removeEventListener('orientationchange', update);
		};
	});

	$effect(() => {
		if (!isMobile) return;
		try {
			dismissed = window.localStorage.getItem(STORAGE_KEY) === '1';
		} catch {
			dismissed = false;
		}
	});

	$effect(() => {
		if (isMobile && !dismissed) continueButton?.focus();
	});

	function dismiss() {
		dismissed = true;
		try {
			window.localStorage.setItem(STORAGE_KEY, '1');
		} catch {
			// private mode: keep the dismissal for this visit only
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isMobile || dismissed) return;
		if (event.key === 'Escape') dismiss();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isMobile && !dismissed}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
		role="presentation"
		tabindex="-1"
		onclick={(event) => event.target === event.currentTarget && dismiss()}
	>
		<div
			class="w-full max-w-sm"
			role="dialog"
			aria-modal="true"
			aria-label="Desktop-only notice"
			tabindex="-1"
		>
			<Card.Root class="w-full">
				<Card.Header>
					<Card.Title>Built for desktop</Card.Title>
					<Card.Description>
						The editor is a precision desktop tool. Timeline, keyframes, grading and the export
						pipeline are tuned for a large display, a mouse and a keyboard.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="flex flex-col gap-0.5">
						<div class="flex items-center gap-2 rounded-md px-2 py-1.5">
							<Check class="size-3.5 shrink-0 text-primary" />
							<span class="text-xs text-foreground">Frame-precise timeline editing</span>
						</div>
						<div class="flex items-center gap-2 rounded-md px-2 py-1.5">
							<Check class="size-3.5 shrink-0 text-primary" />
							<span class="text-xs text-foreground">Keyboard-first shortcuts and tools</span>
						</div>
						<div class="flex items-center gap-2 rounded-md px-2 py-1.5">
							<Check class="size-3.5 shrink-0 text-primary" />
							<span class="text-xs text-foreground">GPU playback and full export pipeline</span>
						</div>
					</div>
				</Card.Content>
				<Card.Footer>
					<Button class="w-full gap-1.5" bind:ref={continueButton} onclick={dismiss}>
						Continue anyway
					</Button>
				</Card.Footer>
			</Card.Root>
			<p class="mt-3 text-center text-[11px] text-muted-foreground/60">
				Works best in a desktop browser such as Chrome, Edge or Safari.
			</p>
		</div>
	</div>
{/if}
