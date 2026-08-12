<script lang="ts">
	import { resolve } from '$app/paths';
	import { Heart } from '@lucide/svelte';
</script>

<footer class="pt-16">
	<div class="mx-auto max-w-6xl px-4 sm:px-6">
		<div class="border-t border-dashed border-border/70 pt-14 lg:px-14 xl:px-16">
			<div class="lg:px-6 xl:px-8">
				<div class="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
					<!-- brand -->
					<div>
						<a href={resolve('/')} class="flex items-center gap-2 text-foreground">
							<img src="/assets/logos/logo.png" alt="Viko" class="h-7 w-auto" draggable="false" />
							<span class="text-base font-bold tracking-tight">Viko</span>
						</a>
						<p class="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
							A browser-based video editor with a frame-precise timeline, multi-track playback and
							offline export. Free and open source under the Apache 2.0 license.
						</p>
						<a
							href="https://github.com/pimatis/viko"
							target="_blank"
							rel="external"
							class="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
								<path
									d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"
								></path>
								<path d="M9 18c-4.51 2-5-2-7-2"></path>
							</svg>
							Star on GitHub
						</a>
					</div>

					<!-- product -->
					<nav class="flex flex-col gap-2.5" aria-label="Product">
						<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
							Product
						</p>
						<a
							href="#features"
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Features
						</a>
						<a
							href="#workflow"
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Workflow
						</a>
						<a
							href="#export"
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Export
						</a>
						<a
							href={resolve('/editor')}
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Open editor
						</a>
					</nav>

					<!-- legal -->
					<nav class="flex flex-col gap-2.5" aria-label="Legal">
						<p class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
							Legal
						</p>
						<a
							href={resolve('/privacy')}
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Privacy policy
						</a>
						<a
							href={resolve('/terms')}
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Terms of service
						</a>
						<a
							href="https://github.com/pimatis/viko"
							target="_blank"
							rel="external"
							class="text-xs text-muted-foreground transition-colors hover:text-foreground"
						>
							Source code
						</a>
					</nav>
				</div>

				<div
					class="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-6 sm:flex-row"
				>
					<p class="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
						Made with
						<Heart class="size-3 fill-current text-red-500/70" />
						by
						<a
							href="https://github.com/pimatis"
							target="_blank"
							rel="external"
							class="font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
						>
							Pimatis
						</a>
					</p>
					<p class="text-[11px] text-muted-foreground/70">
						© {new Date().getFullYear()} Viko · Apache License 2.0
					</p>
				</div>
			</div>
			<!-- VIKO stroke text: üst yarı görünür, alttan kesilir -->
			<div class="overflow-hidden">
				<div
					class="viko-stroke -mb-[0.5em] text-center indent-[0.15em] text-[clamp(7rem,34vw,25rem)] leading-none tracking-[0.3em]"
					aria-hidden="true"
				>
					VIKO
				</div>
			</div>
		</div>
	</div>
</footer>

<style>
	.viko-stroke {
		font-family: 'Bebas Neue', sans-serif;
		color: transparent;
		-webkit-text-stroke: 1.5px var(--border);
		clip-path: inset(0 0 50% 0);
	}
</style>
