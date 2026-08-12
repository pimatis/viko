<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Progress } from '$lib/components/ui/progress';
	import { EFFECT_DRAG_MIME, TRANSITION_DRAG_MIME } from '$lib/effects';
	import {
		filterByQuery,
		formatAssetDuration,
		formatAssetSize,
		importMediaFiles,
		inspectMediaAsset,
		MEDIA_FILE_ACCEPT,
		SIDEBAR_ASSET_MIME,
		SIDEBAR_RESOURCE_MIME,
		type EditorResource,
		type MediaAsset,
		type SidebarTab
	} from '$lib/editor/sidebar';
	import type { CaptionGeneratePayload, CaptionPreset } from '$lib/editor/captions';
	import { sound } from '$lib/sound';
	import { cn } from '$lib/utils';
	import {
		Captions,
		CirclePlus,
		Film,
		ImagePlus,
		ListFilter,
		Loader2,
		Mic,
		Music,
		Pause,
		Play,
		Search,
		Shuffle,
		SlidersHorizontal,
		Sparkles,
		Sticker,
		Trash2,
		Type,
		Upload,
		X,
		ArrowLeftRight
	} from '@lucide/svelte';

	type Props = {
		open?: boolean;
		mediaAssets?: MediaAsset[];
		usedAssetIds?: string[];
		resources?: EditorResource[];
		captionPresets?: CaptionPreset[];
		onToggle?: () => void;
		onMediaAssetsChange?: (assets: MediaAsset[]) => void;
		onResourceApply?: (resource: EditorResource) => void;
		onAssetApply?: (asset: MediaAsset) => void;
		onAssetSelect?: (assetId: string | null) => void;
		onCreateText?: () => void;
		onGenerateCaptions?: (payload: CaptionGeneratePayload) => void;
		onTranscribeMedia?: (presetId: string) => void;
		transcribing?: boolean;
		transcribeProgress?: number;
		transcribeFileName?: string | null;
	};

	let {
		open = $bindable(true),
		mediaAssets = $bindable([] as MediaAsset[]),
		usedAssetIds = [],
		resources = [],
		captionPresets = [],
		onToggle = () => {},
		onMediaAssetsChange = () => {},
		onResourceApply = () => {},
		onAssetApply = () => {},
		onAssetSelect = () => {},
		onCreateText = () => {},
		onGenerateCaptions = () => {},
		onTranscribeMedia = () => {},
		transcribing = false,
		transcribeProgress = 0,
		transcribeFileName = null
	}: Props = $props();

	let activeTab = $state<SidebarTab>('media');
	let searchQuery = $state('');
	let selectedAssetId = $state<string | null>(null);
	let playingAssetId = $state<string | null>(null);
	let previewAudio = $state<HTMLAudioElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let isDraggingFiles = $state(false);
	let importError = $state<string | null>(null);
	let captionTranscript = $state('');
	let captionPresetId = $state('');
	let captionError = $state<string | null>(null);
	let ownedAssetIds: string[] = [];
	let isDestroyed = false;

	const tabs: { id: SidebarTab; label: string; icon: typeof Film }[] = [
		{ id: 'media', label: 'Media', icon: Film },
		{ id: 'audio', label: 'Audio', icon: Music },
		{ id: 'text', label: 'Text', icon: Type },
		{ id: 'stickers', label: 'Stickers', icon: Sticker },
		{ id: 'effects', label: 'Effects', icon: Sparkles },
		{ id: 'transitions', label: 'Transitions', icon: Shuffle },
		{ id: 'clip-transitions', label: 'Clip Transitions', icon: ArrowLeftRight },
		{ id: 'filters', label: 'Filters', icon: SlidersHorizontal },
		{ id: 'captions', label: 'Captions', icon: Captions }
	];

	const activeTabLabel = $derived(tabs.find((tab) => tab.id === activeTab)?.label ?? '');
	const visibleMediaAssets = $derived(
		filterByQuery(
			mediaAssets.filter((asset) => asset.kind !== 'audio'),
			searchQuery
		)
	);
	const visibleAudioAssets = $derived(
		filterByQuery(
			mediaAssets.filter((asset) => asset.kind === 'audio'),
			searchQuery
		)
	);
	const visibleResources = $derived(
		filterByQuery(
			resources.filter((resource) => resource.kind === activeTab),
			searchQuery
		)
	);
	function handleTabClick(tab: SidebarTab) {
		sound.select();
		activeTab = tab;
		searchQuery = '';
		if (open) return;
		open = true;
		onToggle();
	}

	const selectedCaptionPreset = $derived(
		captionPresets.find((preset) => preset.id === captionPresetId) ?? captionPresets[0] ?? null
	);

	function generateCaptions() {
		const transcript = captionTranscript.trim();
		if (!transcript) {
			captionError = 'Paste a transcript before generating captions';
			return;
		}
		if (!selectedCaptionPreset) {
			captionError = 'No caption style is available';
			return;
		}
		sound.select();
		captionError = null;
		onGenerateCaptions({ transcript, presetId: selectedCaptionPreset.id });
	}

	function transcribeMedia() {
		if (transcribing) return;
		sound.select();
		captionError = null;
		onTranscribeMedia(selectedCaptionPreset?.id ?? '');
	}

	function closeMobile() {
		open = false;
	}

	function requestFileImport() {
		fileInput?.click();
	}

	function selectAsset(assetId: string | null) {
		selectedAssetId = assetId;
		onAssetSelect(assetId);
	}

	async function processFiles(files: File[]) {
		if (files.length === 0) return;
		sound.drop();
		try {
			const result = importMediaFiles(files, mediaAssets);
			if (result.accepted.length > 0) {
				ownedAssetIds = [...ownedAssetIds, ...result.accepted.map((asset) => asset.id)];
				mediaAssets = [...mediaAssets, ...result.accepted];
				onMediaAssetsChange(mediaAssets);
				selectAsset(result.accepted.at(-1)?.id ?? null);
				const inspectedAssets = await Promise.all(result.accepted.map(inspectMediaAsset));
				if (isDestroyed) return;
				const inspectedById: Record<string, MediaAsset> = Object.create(null);
				for (const asset of inspectedAssets) inspectedById[asset.id] = asset;
				mediaAssets = mediaAssets.map((asset) => inspectedById[asset.id] ?? asset);
				onMediaAssetsChange(mediaAssets);
			}
			importError = result.rejected[0]?.reason ?? null;
		} catch {
			importError = 'Media files could not be imported';
		}
	}

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		void processFiles(Array.from(input.files ?? []));
		input.value = '';
	}

	function handleFileDragOver(event: DragEvent) {
		if (!event.dataTransfer?.types.includes('Files')) return;
		event.preventDefault();
		isDraggingFiles = true;
	}

	function handleFileDragLeave(event: DragEvent) {
		if (event.currentTarget !== event.target) return;
		isDraggingFiles = false;
	}

	function handleFileDrop(event: DragEvent) {
		event.preventDefault();
		isDraggingFiles = false;
		void processFiles(Array.from(event.dataTransfer?.files ?? []));
	}

	function handleAssetDragStart(event: DragEvent, asset: MediaAsset) {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = 'copy';
		event.dataTransfer.setData(
			SIDEBAR_ASSET_MIME,
			JSON.stringify({ id: asset.id, kind: asset.kind })
		);
		event.dataTransfer.setData('text/plain', asset.name);
	}

	function handleResourceDragStart(event: DragEvent, resource: EditorResource) {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = 'copy';
		if (resource.kind === 'text' || resource.kind === 'stickers') {
			event.dataTransfer.setData(
				SIDEBAR_RESOURCE_MIME,
				JSON.stringify({ resourceId: resource.id, kind: resource.kind })
			);
			event.dataTransfer.setData('text/plain', resource.name);
			return;
		}
		if (resource.kind === 'clip-transitions') {
			event.dataTransfer.setData(TRANSITION_DRAG_MIME, JSON.stringify({ presetId: resource.id }));
			event.dataTransfer.setData('text/plain', resource.name);
			return;
		}
		event.dataTransfer.setData(
			EFFECT_DRAG_MIME,
			JSON.stringify({ presetId: resource.id, kind: resource.kind })
		);
		event.dataTransfer.setData('text/plain', resource.name);
	}

	function removeAsset(asset: MediaAsset) {
		sound.delete();
		if (usedAssetIds.includes(asset.id)) {
			importError = 'Remove this asset from the timeline before deleting it';
			return;
		}
		if (playingAssetId === asset.id) stopAudioPreview();
		if (asset.src.startsWith('blob:')) URL.revokeObjectURL(asset.src);
		ownedAssetIds = ownedAssetIds.filter((assetId) => assetId !== asset.id);
		mediaAssets = mediaAssets.filter((candidate) => candidate.id !== asset.id);
		if (selectedAssetId === asset.id) selectAsset(null);
		onMediaAssetsChange(mediaAssets);
	}

	function stopAudioPreview() {
		previewAudio?.pause();
		previewAudio = null;
		playingAssetId = null;
	}

	async function toggleAudioPreview(asset: MediaAsset) {
		if (playingAssetId !== asset.id) sound.play();
		else sound.pause();
		try {
			if (playingAssetId === asset.id) {
				stopAudioPreview();
				return;
			}

			stopAudioPreview();
			const audio = new Audio(asset.src);
			audio.onended = stopAudioPreview;
			previewAudio = audio;
			playingAssetId = asset.id;
			await audio.play();
		} catch {
			stopAudioPreview();
			importError = 'Audio preview could not be played';
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeMobile();
	}

	onDestroy(() => {
		isDestroyed = true;
		stopAudioPreview();
		for (const asset of mediaAssets) {
			if (ownedAssetIds.includes(asset.id) && asset.src.startsWith('blob:')) {
				URL.revokeObjectURL(asset.src);
			}
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<input
	bind:this={fileInput}
	type="file"
	accept={MEDIA_FILE_ACCEPT}
	multiple
	class="hidden"
	onchange={handleFileChange}
/>

{#if open}
	<div
		class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
		onclick={closeMobile}
		onkeydown={(event) => event.key === 'Escape' && closeMobile()}
		tabindex="-1"
		role="presentation"
	></div>
{/if}

<aside
	class={cn(
		'flex h-full shrink-0 bg-sidebar select-none',
		'fixed inset-y-0 left-0 z-50 md:relative md:z-auto',
		'transition-[width,transform] duration-200 ease-in-out',
		open ? 'w-[280px] translate-x-0' : 'w-0 -translate-x-full md:w-0 md:translate-x-0',
		'overflow-hidden'
	)}
>
	<!-- icon rail -->
	<div
		class="flex w-11 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-sidebar-border bg-sidebar p-1.5"
	>
		<Tooltip.Provider delayDuration={400}>
			{#each tabs as tab (tab.id)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class={cn(
									'size-8 shrink-0 transition-all',
									activeTab === tab.id
										? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
										: 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
								)}
								onclick={() => handleTabClick(tab.id)}
								aria-label={tab.label}
							>
								<tab.icon class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right" sideOffset={8}>{tab.label}</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</Tooltip.Provider>
	</div>

	<!-- content panel -->
	<div class="flex h-full min-w-0 flex-1 flex-col">
		<!-- panel header -->
		<div
			class="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3"
		>
			<span
				class="min-w-0 shrink-0 truncate text-xs font-bold tracking-wide text-sidebar-foreground uppercase"
			>
				{activeTabLabel}
			</span>
			<div class="min-w-0 flex-1">
				<div class="relative">
					<Search class="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						type="search"
						placeholder="Search..."
						bind:value={searchQuery}
						class="h-6 w-full rounded-md border-0 bg-sidebar-accent pr-2 pl-7 text-xs text-sidebar-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
					/>
				</div>
			</div>
			<button
				onclick={closeMobile}
				class="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-sidebar-foreground md:hidden"
			>
				<X class="size-4" />
			</button>
		</div>

		<!-- panel content -->
		<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
			{#if activeTab === 'media'}
				<div class="space-y-3 p-3">
					<!-- import drop zone -->
					<button
						class={cn(
							'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 transition-all hover:border-muted-foreground/60 hover:bg-sidebar-accent/40',
							isDraggingFiles && 'border-primary bg-sidebar-accent'
						)}
						onclick={requestFileImport}
						ondragover={handleFileDragOver}
						ondragleave={handleFileDragLeave}
						ondrop={handleFileDrop}
					>
						<div class="flex size-9 items-center justify-center rounded-lg bg-sidebar-accent">
							<ImagePlus class="size-4 text-muted-foreground" />
						</div>
						<span class="text-[11px] font-medium text-muted-foreground">Import media</span>
					</button>

					{#if visibleMediaAssets.length > 0}
						<div class="flex items-center gap-2">
							<span class="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
								Project media
							</span>
							<div class="h-px flex-1 bg-sidebar-border"></div>
						</div>

						<div class="grid grid-cols-2 gap-1.5">
							{#each visibleMediaAssets as asset (asset.id)}
								<div
									role="group"
									draggable="true"
									ondragstart={(event) => handleAssetDragStart(event, asset)}
									class={cn(
										'group relative overflow-hidden rounded-md border bg-sidebar-accent transition-all',
										selectedAssetId === asset.id
											? 'border-ring shadow-sm'
											: 'border-transparent hover:border-sidebar-border'
									)}
								>
									<button
										class="flex w-full flex-col text-left"
										onclick={() => selectAsset(asset.id)}
										ondblclick={() => {
											sound.drop();
											onAssetApply(asset);
										}}
									>
										<div
											class="flex aspect-video w-full items-center justify-center overflow-hidden bg-muted/40"
										>
											{#if asset.kind === 'image'}
												<img src={asset.src} alt={asset.name} class="size-full object-cover" />
											{:else}
												<Film class="size-5 text-muted-foreground/40" />
											{/if}
										</div>
										<div class="flex w-full items-center gap-1 px-1.5 py-1.5">
											<span
												class="min-w-0 flex-1 truncate text-[10px] font-medium text-sidebar-foreground"
											>
												{asset.name}
											</span>
											<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums">
												{formatAssetDuration(asset.duration) || formatAssetSize(asset.size)}
											</span>
										</div>
									</button>
									<button
										class="absolute top-1 left-1 hidden size-5 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm group-hover:flex hover:text-foreground"
										onclick={() => {
											sound.drop();
											onAssetApply(asset);
										}}
										aria-label={`Add ${asset.name} to timeline`}
									>
										<CirclePlus class="size-3" />
									</button>
									<button
										class="absolute top-1 right-1 hidden size-5 items-center justify-center rounded-md bg-background/90 text-muted-foreground shadow-sm group-hover:flex hover:text-destructive"
										onclick={() => removeAsset(asset)}
										aria-label={`Remove ${asset.name}`}
									>
										<Trash2 class="size-3" />
									</button>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{:else if activeTab === 'audio'}
				<div class="space-y-2 p-3">
					<Button
						variant="outline"
						size="sm"
						class="w-full gap-1.5 text-xs"
						onclick={requestFileImport}
					>
						<Upload class="size-3.5" />
						Import audio
					</Button>
					<div class="flex flex-col gap-0.5">
						{#each visibleAudioAssets as asset (asset.id)}
							<div
								role="group"
								draggable="true"
								ondragstart={(event) => handleAssetDragStart(event, asset)}
								class={cn(
									'group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent',
									selectedAssetId === asset.id && 'bg-sidebar-accent'
								)}
							>
								<button
									class="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-accent transition-colors group-hover:bg-background"
									onclick={() => toggleAudioPreview(asset)}
								>
									{#if playingAssetId === asset.id}
										<Pause class="size-3.5 text-foreground" />
									{:else}
										<Play class="size-3.5 text-muted-foreground" />
									{/if}
								</button>
								<button
									class="min-w-0 flex-1 text-left"
									onclick={() => selectAsset(asset.id)}
									ondblclick={() => {
										sound.drop();
										onAssetApply(asset);
									}}
								>
									<div class="truncate text-[11px] font-medium text-sidebar-foreground">
										{asset.name}
									</div>
									<div class="truncate text-[10px] text-muted-foreground tabular-nums">
										{formatAssetSize(asset.size)}
									</div>
								</button>
								<button
									class="p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
									onclick={() => {
										sound.drop();
										onAssetApply(asset);
									}}
									aria-label={`Add ${asset.name} to timeline`}
								>
									<CirclePlus class="size-3.5" />
								</button>
								<button
									class="p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
									onclick={() => removeAsset(asset)}
									aria-label={`Remove ${asset.name}`}
								>
									<X class="size-3.5" />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{:else if activeTab === 'text'}
				<div class="space-y-3 p-3">
					<Button
						variant="outline"
						size="sm"
						class="w-full gap-1.5 text-xs"
						onclick={() => {
							sound.select();
							onCreateText();
						}}
					>
						<Type class="size-3.5" />
						Add text
					</Button>
					<div class="grid grid-cols-2 gap-1.5">
						{#each visibleResources as resource (resource.id)}
							<button
								class="flex flex-col items-center justify-center gap-2 rounded-md border border-transparent bg-sidebar-accent p-3 transition-all hover:border-muted-foreground/50 hover:bg-sidebar-accent/80 hover:shadow-sm"
								onclick={() => {
									sound.select();
									onResourceApply(resource);
								}}
							>
								<span
									class="max-w-full truncate text-base text-sidebar-foreground"
									style:font-family={resource.textStyle?.fontFamily}
									style:font-weight={resource.textStyle?.fontWeight}
									style:text-transform={resource.textStyle?.textTransform}
								>
									Aa
								</span>
								<span class="max-w-full truncate text-[10px] font-medium text-muted-foreground">
									{resource.name}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{:else if activeTab === 'captions'}
				<div class="space-y-3 p-3">
					<p class="text-[11px] leading-relaxed text-muted-foreground">
						Auto-transcribe the selected media clip, or paste a transcript to generate a subtitle
						track. Timing is distributed over the selected clip or the playhead.
					</p>
					<Button
						variant="outline"
						size="sm"
						class="w-full gap-1.5 text-xs"
						onclick={transcribeMedia}
						disabled={transcribing}
					>
						{#if transcribing}
							<Loader2 class="size-3.5 animate-spin" />
						{:else}
							<Mic class="size-3.5" />
						{/if}
						{transcribing ? 'Transcribing...' : 'Transcribe media'}
					</Button>
					{#if transcribing}
						<div class="space-y-1">
							<Progress value={transcribeProgress} class="h-1.5" />
							<div
								class="flex items-center justify-between gap-2 text-[10px] text-muted-foreground"
							>
								<span class="truncate">
									{transcribeProgress < 100
										? transcribeFileName
											? `Downloading ${transcribeFileName}`
											: 'Downloading speech model'
										: 'Transcribing audio'}
								</span>
								<span class="shrink-0 tabular-nums">{transcribeProgress}%</span>
							</div>
						</div>
					{/if}
					<div
						class="rounded-md border border-dashed border-border bg-sidebar-accent p-2 text-[10px] leading-relaxed text-muted-foreground"
					>
						Transcription runs entirely in your browser with an offline Whisper model. The first run
						downloads the model, then all future transcriptions are free and private.
					</div>
					<div class="h-px bg-border"></div>
					<label class="grid gap-1 text-xs text-muted-foreground">
						Transcript
						<Textarea
							bind:value={captionTranscript}
							placeholder="Paste the spoken transcript here..."
							maxlength={20000}
							class="min-h-40 bg-sidebar-accent text-xs"
						/>
					</label>
					{#if captionPresets.length > 0}
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Style</span>
							<Select.Root
								type="single"
								value={selectedCaptionPreset?.id ?? ''}
								onValueChange={(value) => (captionPresetId = value)}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs">
									<span>{selectedCaptionPreset?.name ?? 'Select a style'}</span>
								</Select.Trigger>
								<Select.Content>
									{#each captionPresets as preset (preset.id)}
										<Select.Item value={preset.id} label={preset.name} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
					<Button
						variant="default"
						size="sm"
						class="w-full gap-1.5 text-xs"
						onclick={generateCaptions}
						disabled={!captionTranscript.trim()}
					>
						<Captions class="size-3.5" />
						Generate captions
					</Button>
					{#if captionError}
						<div class="text-[10px] font-medium text-destructive">{captionError}</div>
					{/if}
					<div
						class="rounded-md border border-dashed border-border bg-sidebar-accent p-2 text-[10px] leading-relaxed text-muted-foreground"
					>
						Captions are placed on a new "Captions" subtitle track at the playhead. Double-click any
						caption to edit its text, or drag it to reposition.
					</div>
				</div>
			{:else}
				<div class="p-3">
					<div class="grid grid-cols-2 gap-1.5">
						{#each visibleResources as resource (resource.id)}
							<button
								draggable="true"
								class="flex flex-col items-center justify-center gap-2 overflow-hidden rounded-md border border-transparent bg-sidebar-accent p-3 transition-all hover:border-muted-foreground/50 hover:bg-sidebar-accent/80 hover:shadow-sm"
								ondragstart={(event) => handleResourceDragStart(event, resource)}
								onclick={() => {
									sound.select();
									onResourceApply(resource);
								}}
							>
								{#if resource.thumbnailUrl}
									<img
										src={resource.thumbnailUrl}
										alt={resource.name}
										class="aspect-video w-full rounded-md object-cover"
									/>
								{:else if activeTab === 'stickers'}
									<span class="text-2xl leading-none text-foreground">{resource.sticker}</span>
								{:else if activeTab === 'clip-transitions'}
									<ArrowLeftRight class="size-5 text-muted-foreground" />
								{:else if activeTab === 'filters'}
									<ListFilter class="size-5 text-muted-foreground" />
								{:else}
									<Sparkles class="size-5 text-muted-foreground" />
								{/if}
								<span class="max-w-full truncate text-[10px] font-medium text-sidebar-foreground"
									>{resource.name}</span
								>
								{#if resource.category}
									<span class="max-w-full truncate text-[9px] text-muted-foreground">
										{resource.category}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if importError}
			<div
				class="shrink-0 border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-[10px] font-medium text-destructive"
			>
				{importError}
			</div>
		{/if}
	</div>
</aside>
