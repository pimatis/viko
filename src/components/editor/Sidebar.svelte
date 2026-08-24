<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as ContextMenu from '$lib/components/ui/context-menu';
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
		type MediaFolder,
		type SidebarTab
	} from '$lib/editor/sidebar';
	import type { CaptionGeneratePayload, CaptionPreset } from '$lib/editor/captions';
	import { transcodeToProxy, isProxyInputTooLarge } from '$lib/media/proxy';
	import { sound } from '$lib/sound';
	import { cn } from '$lib/utils';
	import {
		Captions,
		ChevronRight,
		CirclePlus,
		Film,
		Folder,
		FolderInput,
		FolderOpen,
		FolderPlus,
		ImagePlus,
		ListFilter,
		Loader2,
		Mic,
		Music,
		Pause,
		Pencil,
		Play,
		Search,
		Shuffle,
		SlidersHorizontal,
		Sparkles,
		Sticker,
		Trash2,
		Type,
		Upload,
		Wand2,
		X,
		ArrowLeftRight
	} from '@lucide/svelte';

	type Props = {
		open?: boolean;
		mediaAssets?: MediaAsset[];
		mediaFolders?: MediaFolder[];
		usedAssetIds?: string[];
		resources?: EditorResource[];
		captionPresets?: CaptionPreset[];
		onToggle?: () => void;
		onMediaAssetsChange?: (assets: MediaAsset[]) => void;
		onMediaFoldersChange?: (folders: MediaFolder[]) => void;
		onResourceApply?: (resource: EditorResource) => void;
		onAssetApply?: (asset: MediaAsset) => void;
		onAssetSelect?: (assetId: string | null) => void;
		onCreateText?: () => void;
		onGenerateCaptions?: (payload: CaptionGeneratePayload) => void;
		onTranscribeMedia?: (presetId: string) => void;
		onRelinkAsset?: (assetId: string) => void;
		transcribing?: boolean;
		transcribeProgress?: number;
		transcribeFileName?: string | null;
	};

	let {
		open = $bindable(true),
		mediaAssets = $bindable([] as MediaAsset[]),
		mediaFolders = $bindable([] as MediaFolder[]),
		usedAssetIds = [],
		resources = [],
		captionPresets = [],
		onToggle = () => {},
		onMediaAssetsChange = () => {},
		onMediaFoldersChange = () => {},
		onResourceApply = () => {},
		onAssetApply = () => {},
		onAssetSelect = () => {},
		onCreateText = () => {},
		onGenerateCaptions = () => {},
		onTranscribeMedia = () => {},
		onRelinkAsset = () => {},
		transcribing = false,
		transcribeProgress = 0,
		transcribeFileName = null
	}: Props = $props();

	let activeTab = $state<SidebarTab>('media');
	let searchQuery = $state('');
	let selectedAssetId = $state<string | null>(null);
	let selectedFolderId = $state<string | null>(null);
	let expandedFolderIds = $state<string[]>([]);
	let hoveredAssetId = $state<string | null>(null);
	let draggingAssetId = $state<string | null>(null);
	let dragOverFolderId = $state<string | null>(null);
	let dragOverRoot = $state(false);
	let renamingAssetId = $state<string | null>(null);
	let renamingFolderId = $state<string | null>(null);
	let renameValue = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);
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
	type ProxyState = { status: 'running' | 'error'; progress: number };
	let proxyStates = $state<Record<string, ProxyState>>({});

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
	const matchingMediaAssets = $derived(
		filterByQuery(
			mediaAssets.filter((asset) => asset.kind !== 'audio'),
			searchQuery
		)
	);
	const folderIds = $derived(mediaFolders.map((folder) => folder.id));
	// assets in a folder that no longer exists (or was never assigned) count as root
	const rootMediaAssets = $derived(
		matchingMediaAssets.filter((asset) => !asset.folderId || !folderIds.includes(asset.folderId))
	);
	const isSearching = $derived(searchQuery.trim().length > 0);
	const visibleFolders = $derived(
		isSearching
			? mediaFolders.filter((folder) => {
					const query = searchQuery.trim().toLocaleLowerCase();
					if (folder.name.toLocaleLowerCase().includes(query)) return true;
					return matchingMediaAssets.some((asset) => asset.folderId === folder.id);
				})
			: mediaFolders
	);
	function getFolderAssets(folderId: string): MediaAsset[] {
		return matchingMediaAssets.filter((asset) => asset.folderId === folderId);
	}
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

	async function processFiles(files: File[], targetFolderId: string | null = selectedFolderId) {
		if (files.length === 0) return;
		sound.drop();
		try {
			const result = importMediaFiles(files, mediaAssets, targetFolderId);
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
		draggingAssetId = asset.id;
		// copyMove: the timeline accepts a copy (insert), folders accept a move (reorganize)
		event.dataTransfer.effectAllowed = 'copyMove';
		event.dataTransfer.setData(
			SIDEBAR_ASSET_MIME,
			JSON.stringify({ id: asset.id, kind: asset.kind })
		);
		event.dataTransfer.setData('text/plain', asset.name);
	}

	function handleAssetDragEnd() {
		draggingAssetId = null;
		dragOverFolderId = null;
		dragOverRoot = false;
	}

	function isSidebarAssetDrag(event: DragEvent): boolean {
		return event.dataTransfer?.types.includes(SIDEBAR_ASSET_MIME) ?? Boolean(draggingAssetId);
	}

	function handleFolderDragOver(event: DragEvent, folderId: string) {
		const isFileDrag = event.dataTransfer?.types.includes('Files') ?? false;
		if (!isFileDrag && !isSidebarAssetDrag(event)) return;
		event.preventDefault();
		event.dataTransfer!.dropEffect = isFileDrag ? 'copy' : 'move';
		dragOverFolderId = folderId;
	}

	function handleFolderDragLeave(event: DragEvent) {
		if (event.currentTarget !== event.target) return;
		dragOverFolderId = null;
	}

	function handleFolderDrop(event: DragEvent, folderId: string) {
		event.preventDefault();
		dragOverFolderId = null;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length > 0) {
			void processFiles(files, folderId);
			return;
		}
		const assetId = getDraggedAssetId(event);
		if (assetId) moveAssetToFolder(assetId, folderId);
	}

	function handleRootDragOver(event: DragEvent) {
		const isFileDrag = event.dataTransfer?.types.includes('Files') ?? false;
		if (!isFileDrag && !isSidebarAssetDrag(event)) return;
		event.preventDefault();
		event.dataTransfer!.dropEffect = isFileDrag ? 'copy' : 'move';
		dragOverRoot = true;
	}

	function handleRootDragLeave(event: DragEvent) {
		if (event.currentTarget !== event.target) return;
		dragOverRoot = false;
	}

	function handleRootDrop(event: DragEvent) {
		event.preventDefault();
		dragOverRoot = false;
		const files = Array.from(event.dataTransfer?.files ?? []);
		if (files.length > 0) {
			void processFiles(files, null);
			return;
		}
		const assetId = getDraggedAssetId(event);
		if (assetId) moveAssetToFolder(assetId, null);
	}

	function getDraggedAssetId(event: DragEvent): string | null {
		const data = event.dataTransfer?.getData(SIDEBAR_ASSET_MIME);
		if (!data) return draggingAssetId;
		try {
			const parsed = JSON.parse(data);
			return typeof parsed.id === 'string' ? parsed.id : null;
		} catch {
			return null;
		}
	}

	function moveAssetToFolder(assetId: string, folderId: string | null) {
		const asset = mediaAssets.find((candidate) => candidate.id === assetId);
		if (!asset || asset.folderId === folderId) return;
		sound.drop();
		mediaAssets = mediaAssets.map((candidate) =>
			candidate.id === assetId ? { ...candidate, folderId } : candidate
		);
		onMediaAssetsChange(mediaAssets);
	}

	function createFolder() {
		sound.select();
		const id = crypto.randomUUID();
		const folder: MediaFolder = { id, name: 'New folder', createdAt: Date.now() };
		mediaFolders = [...mediaFolders, folder];
		onMediaFoldersChange(mediaFolders);
		selectedFolderId = id;
		if (!expandedFolderIds.includes(id)) expandedFolderIds = [...expandedFolderIds, id];
		startFolderRename(id);
	}

	function toggleFolder(folderId: string) {
		sound.select();
		expandedFolderIds = expandedFolderIds.includes(folderId)
			? expandedFolderIds.filter((id) => id !== folderId)
			: [...expandedFolderIds, folderId];
	}

	function selectFolder(folderId: string) {
		sound.select();
		selectedFolderId = folderId;
		if (!expandedFolderIds.includes(folderId)) {
			expandedFolderIds = [...expandedFolderIds, folderId];
		}
	}

	function startFolderRename(folderId: string) {
		const folder = mediaFolders.find((candidate) => candidate.id === folderId);
		if (!folder) return;
		sound.select();
		renamingFolderId = folderId;
		renamingAssetId = null;
		renameValue = folder.name;
	}

	function startAssetRename(assetId: string) {
		const asset = mediaAssets.find((candidate) => candidate.id === assetId);
		if (!asset) return;
		sound.select();
		renamingAssetId = assetId;
		renamingFolderId = null;
		renameValue = asset.name;
	}

	function commitFolderRename() {
		if (!renamingFolderId) return;
		const name = renameValue.trim().slice(0, 120) || 'Untitled folder';
		mediaFolders = mediaFolders.map((folder) =>
			folder.id === renamingFolderId ? { ...folder, name } : folder
		);
		onMediaFoldersChange(mediaFolders);
		renamingFolderId = null;
	}

	function commitAssetRename() {
		if (!renamingAssetId) return;
		const name = renameValue.trim().slice(0, 255) || 'Untitled asset';
		mediaAssets = mediaAssets.map((asset) =>
			asset.id === renamingAssetId ? { ...asset, name } : asset
		);
		onMediaAssetsChange(mediaAssets);
		renamingAssetId = null;
	}

	function commitActiveRename() {
		if (renamingFolderId !== null) commitFolderRename();
		else if (renamingAssetId !== null) commitAssetRename();
	}

	function cancelActiveRename() {
		renamingFolderId = null;
		renamingAssetId = null;
	}

	function handleRenameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			commitActiveRename();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelActiveRename();
		}
	}

	function deleteFolder(folderId: string) {
		sound.delete();
		// assets inside the folder move back to the root instead of being deleted
		mediaAssets = mediaAssets.map((asset) =>
			asset.folderId === folderId ? { ...asset, folderId: null } : asset
		);
		onMediaAssetsChange(mediaAssets);
		mediaFolders = mediaFolders.filter((folder) => folder.id !== folderId);
		onMediaFoldersChange(mediaFolders);
		expandedFolderIds = expandedFolderIds.filter((id) => id !== folderId);
		if (selectedFolderId === folderId) selectedFolderId = null;
		if (renamingFolderId === folderId) renamingFolderId = null;
	}

	$effect(() => {
		if (renamingAssetId === null && renamingFolderId === null) return;
		const input = renameInputEl;
		if (!input) return;
		input.focus();
		input.select();
	});

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

	async function createProxy(asset: MediaAsset) {
		if (asset.kind === 'image') return;
		if (proxyStates[asset.id]?.status === 'running') return;
		sound.start();
		const processingCue = sound.processing();
		proxyStates = { ...proxyStates, [asset.id]: { status: 'running', progress: 0 } };
		try {
			const response = await fetch(asset.src);
			const source = await response.blob();
			const proxyBlob = await transcodeToProxy(source, asset.kind, (ratio) => {
				proxyStates = {
					...proxyStates,
					[asset.id]: { status: 'running', progress: Math.round(ratio * 100) }
				};
			});
			if (isDestroyed) return;
			const previousSrc = asset.src;
			const newSrc = URL.createObjectURL(proxyBlob);
			const inspected = await inspectMediaAsset({
				...asset,
				src: newSrc,
				mimeType: proxyBlob.type,
				size: proxyBlob.size
			});
			if (isDestroyed) {
				URL.revokeObjectURL(newSrc);
				return;
			}
			mediaAssets = mediaAssets.map((candidate) =>
				candidate.id === asset.id
					? { ...inspected, isProxy: true, playbackSupported: true }
					: candidate
			);
			onMediaAssetsChange(mediaAssets);
			setTimeout(() => URL.revokeObjectURL(previousSrc), 60_000);
			delete proxyStates[asset.id];
			proxyStates = { ...proxyStates };
		} catch {
			proxyStates = { ...proxyStates, [asset.id]: { status: 'error', progress: 0 } };
		} finally {
			processingCue?.stop();
		}
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

{#snippet assetMenuContent(asset: MediaAsset, withFolderMove: boolean)}
	<ContextMenu.Content>
		<ContextMenu.Item
			onclick={() => {
				sound.drop();
				onAssetApply(asset);
			}}
		>
			<CirclePlus class="size-4" />
			Add to timeline
		</ContextMenu.Item>
		<ContextMenu.Item onclick={() => startAssetRename(asset.id)}>
			<Pencil class="size-4" />
			Rename
		</ContextMenu.Item>
		{#if withFolderMove}
			<ContextMenu.Separator />
			<ContextMenu.Sub>
				<ContextMenu.SubTrigger class="gap-2">
					<FolderInput class="size-4" />
					Move to folder
				</ContextMenu.SubTrigger>
				<ContextMenu.SubContent>
					{#each mediaFolders as folder (folder.id)}
						<ContextMenu.Item
							onclick={() => moveAssetToFolder(asset.id, folder.id)}
							disabled={asset.folderId === folder.id}
						>
							<Folder class="size-4" />
							{folder.name}
						</ContextMenu.Item>
					{/each}
					<ContextMenu.Item
						onclick={() => moveAssetToFolder(asset.id, null)}
						disabled={!asset.folderId}
					>
						<Film class="size-4" />
						Project media
					</ContextMenu.Item>
				</ContextMenu.SubContent>
			</ContextMenu.Sub>
		{/if}
		<ContextMenu.Separator />
		<ContextMenu.Item
			variant="destructive"
			onclick={() => removeAsset(asset)}
			disabled={usedAssetIds.includes(asset.id)}
		>
			<Trash2 class="size-4" />
			Delete
		</ContextMenu.Item>
	</ContextMenu.Content>
{/snippet}

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
	data-guide-target="sidebar"
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

					{#snippet assetTile(asset: MediaAsset)}
						<ContextMenu.Root>
							<ContextMenu.Trigger oncontextmenu={() => selectAsset(asset.id)}>
								{#snippet child({ props })}
									<div
										{...props}
										role="group"
										draggable="true"
										ondragstart={(event) => handleAssetDragStart(event, asset)}
										ondragend={handleAssetDragEnd}
										onmouseenter={() => (hoveredAssetId = asset.id)}
										onmouseleave={() => (hoveredAssetId = null)}
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
													<img
														src={asset.src}
														alt={asset.name}
														class="size-full object-cover transition-transform duration-200 group-hover:scale-105"
													/>
												{:else if asset.kind === 'video' && hoveredAssetId === asset.id}
													<video
														src={asset.src}
														class="size-full object-cover"
														autoplay
														muted
														loop
														playsinline
														preload="metadata"
														disablepictureinpicture
														controlslist="nodownload noremoteplayback"
													></video>
												{:else}
													<Film class="size-5 text-muted-foreground/40" />
												{/if}
											</div>
										</button>
										{#if asset.src === ''}
											<div class="w-full px-1.5 pb-1.5">
												<span class="block text-center text-[8px] font-medium text-destructive">
													Media file missing
												</span>
												<button
													class="mt-0.5 flex w-full items-center justify-center gap-1 rounded-sm bg-secondary py-1 text-[9px] font-medium text-foreground transition-colors hover:bg-secondary/80"
													onclick={() => onRelinkAsset(asset.id)}
												>
													<FolderOpen class="size-3" />
													Relink file
												</button>
											</div>
										{/if}
										{#if asset.playbackSupported === false && asset.kind !== 'image' && asset.src !== ''}
											<div class="w-full px-1.5 pb-1.5">
												{#if proxyStates[asset.id]?.status === 'running'}
													<span
														class="block text-center text-[8px] font-medium text-muted-foreground"
													>
														Creating proxy… {proxyStates[asset.id].progress}%
													</span>
													<Progress value={proxyStates[asset.id].progress} class="mt-0.5 h-1" />
												{:else if isProxyInputTooLarge(asset.size)}
													<span class="block text-center text-[8px] text-muted-foreground">
														Too large for proxy (max 512 MB)
													</span>
												{:else}
													<button
														class="flex w-full items-center justify-center gap-1 rounded-sm bg-secondary py-1 text-[9px] font-medium text-foreground transition-colors hover:bg-secondary/80"
														onclick={() => createProxy(asset)}
													>
														<Wand2 class="size-3" />
														{#if proxyStates[asset.id]?.status === 'error'}
															Retry proxy
														{:else}
															Create proxy
														{/if}
													</button>
													{#if proxyStates[asset.id]?.status === 'error'}
														<span class="block text-center text-[8px] text-destructive">
															Proxy could not be created
														</span>
													{/if}
												{/if}
											</div>
										{/if}
										<div class="flex w-full items-center gap-1 px-1.5 py-1.5">
											{#if renamingAssetId === asset.id}
												<input
													bind:this={renameInputEl}
													bind:value={renameValue}
													onkeydown={handleRenameKeydown}
													onblur={commitAssetRename}
													maxlength={255}
													class="h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1 text-[10px] text-foreground outline-none"
												/>
											{:else}
												<span
													class="min-w-0 flex-1 truncate text-[10px] font-medium text-sidebar-foreground"
												>
													{asset.name}
												</span>
												<button
													class="hidden size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground group-hover:flex hover:text-foreground"
													onclick={() => startAssetRename(asset.id)}
													aria-label={`Rename ${asset.name}`}
												>
													<Pencil class="size-3" />
												</button>
												<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums">
													{formatAssetDuration(asset.duration) || formatAssetSize(asset.size)}
												</span>
											{/if}
										</div>
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
								{/snippet}
							</ContextMenu.Trigger>
							{@render assetMenuContent(asset, true)}
						</ContextMenu.Root>
					{/snippet}

					{#if isSearching}
						{#if matchingMediaAssets.length > 0}
							<div class="grid grid-cols-2 gap-1.5">
								{#each matchingMediaAssets as asset (asset.id)}
									{@render assetTile(asset)}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- collections -->
						<div class="flex items-center gap-2">
							<span class="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
								Collections
							</span>
							<div class="h-px flex-1 bg-sidebar-border"></div>
							<button
								onclick={createFolder}
								class="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
								aria-label="New folder"
								title="New folder"
							>
								<FolderPlus class="size-3.5" />
							</button>
						</div>
						<div class="flex flex-col gap-0.5">
							{#each visibleFolders as folder (folder.id)}
								{@const expanded = expandedFolderIds.includes(folder.id)}
								{@const folderAssetCount = getFolderAssets(folder.id).length}
								<ContextMenu.Root>
									<ContextMenu.Trigger oncontextmenu={() => selectFolder(folder.id)}>
										{#snippet child({ props })}
											<div
												{...props}
												role="group"
												class={cn(
													'group/folder rounded-md border transition-colors',
													dragOverFolderId === folder.id
														? 'border-primary bg-sidebar-accent'
														: 'border-transparent',
													selectedFolderId === folder.id && 'bg-sidebar-accent/70'
												)}
												ondragover={(event) => handleFolderDragOver(event, folder.id)}
												ondragleave={handleFolderDragLeave}
												ondrop={(event) => handleFolderDrop(event, folder.id)}
											>
												<div class="flex items-center gap-1 px-1 py-1">
													<button
														onclick={() => toggleFolder(folder.id)}
														class="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
														aria-label={expanded
															? `Collapse ${folder.name}`
															: `Expand ${folder.name}`}
													>
														<ChevronRight
															class={cn('size-3 transition-transform', expanded && 'rotate-90')}
														/>
													</button>
													{#if expanded}
														<FolderOpen class="size-3.5 shrink-0 text-muted-foreground" />
													{:else}
														<Folder class="size-3.5 shrink-0 text-muted-foreground" />
													{/if}
													{#if renamingFolderId === folder.id}
														<input
															bind:this={renameInputEl}
															bind:value={renameValue}
															onkeydown={handleRenameKeydown}
															onblur={commitFolderRename}
															maxlength={120}
															class="h-6 min-w-0 flex-1 rounded border border-ring bg-background px-1 text-[11px] text-foreground outline-none"
														/>
													{:else}
														<button
															onclick={() => selectFolder(folder.id)}
															class="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-sidebar-foreground transition-colors hover:text-foreground"
														>
															{folder.name}
														</button>
														<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums">
															{folderAssetCount}
														</span>
														<button
															onclick={() => startFolderRename(folder.id)}
															class="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors group-hover/folder:flex hover:bg-sidebar-accent hover:text-foreground"
															aria-label={`Rename ${folder.name}`}
														>
															<Pencil class="size-3" />
														</button>
														<button
															onclick={() => deleteFolder(folder.id)}
															class="hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors group-hover/folder:flex hover:bg-sidebar-accent hover:text-destructive"
															aria-label={`Delete ${folder.name}`}
														>
															<Trash2 class="size-3" />
														</button>
													{/if}
												</div>
												{#if expanded}
													<div class="grid grid-cols-2 gap-1.5 pt-1 pr-1.5 pb-1.5 pl-6">
														{#each getFolderAssets(folder.id) as asset (asset.id)}
															{@render assetTile(asset)}
														{/each}
														{#if folderAssetCount === 0}
															<div class="col-span-2 px-1 text-[10px] text-muted-foreground">
																Empty folder - drop media here
															</div>
														{/if}
													</div>
												{/if}
											</div>
										{/snippet}
									</ContextMenu.Trigger>
									<ContextMenu.Content>
										<ContextMenu.Item onclick={() => startFolderRename(folder.id)}>
											<Pencil class="size-4" />
											Rename
										</ContextMenu.Item>
										<ContextMenu.Separator />
										<ContextMenu.Item variant="destructive" onclick={() => deleteFolder(folder.id)}>
											<Trash2 class="size-4" />
											Delete
										</ContextMenu.Item>
									</ContextMenu.Content>
								</ContextMenu.Root>
							{/each}
							{#if visibleFolders.length === 0}
								<div class="px-1 text-[10px] text-muted-foreground">
									No collections yet. Import media or create a folder.
								</div>
							{/if}
						</div>

						{#if mediaFolders.length > 0 || rootMediaAssets.length > 0}
							<div
								role="group"
								class={cn(
									'flex items-center gap-2 rounded-md px-1',
									dragOverRoot && 'ring-1 ring-primary'
								)}
								ondragover={handleRootDragOver}
								ondragleave={handleRootDragLeave}
								ondrop={handleRootDrop}
							>
								<span class="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">
									Project media
								</span>
								<div class="h-px flex-1 bg-sidebar-border"></div>
								{#if rootMediaAssets.length > 0}
									<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums">
										{rootMediaAssets.length}
									</span>
								{/if}
							</div>
							{#if rootMediaAssets.length > 0}
								<div class="grid grid-cols-2 gap-1.5">
									{#each rootMediaAssets as asset (asset.id)}
										{@render assetTile(asset)}
									{/each}
								</div>
							{:else}
								<div class="px-1 text-[10px] text-muted-foreground">
									Drop media here to move it out of folders
								</div>
							{/if}
						{/if}
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
							<ContextMenu.Root>
								<ContextMenu.Trigger oncontextmenu={() => selectAsset(asset.id)}>
									{#snippet child({ props })}
										<div
											{...props}
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
											{#if renamingAssetId === asset.id}
												<input
													bind:this={renameInputEl}
													bind:value={renameValue}
													onkeydown={handleRenameKeydown}
													onblur={commitAssetRename}
													maxlength={255}
													class="h-7 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-[11px] text-foreground outline-none"
												/>
											{:else}
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
													onclick={() => startAssetRename(asset.id)}
													aria-label={`Rename ${asset.name}`}
												>
													<Pencil class="size-3" />
												</button>
											{/if}
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
											{#if asset.src === ''}
												<div class="w-full px-0 pb-1">
													<span class="block text-center text-[8px] font-medium text-destructive">
														Media file missing
													</span>
													<button
														class="mt-0.5 flex w-full items-center justify-center gap-1 rounded-sm bg-secondary py-1 text-[9px] font-medium text-foreground transition-colors hover:bg-secondary/80"
														onclick={() => onRelinkAsset(asset.id)}
													>
														<FolderOpen class="size-3" />
														Relink file
													</button>
												</div>
											{/if}
											{#if asset.playbackSupported === false && asset.kind !== 'image' && asset.src !== ''}
												<div class="w-full px-0 pb-1">
													{#if proxyStates[asset.id]?.status === 'running'}
														<span
															class="block text-center text-[8px] font-medium text-muted-foreground"
														>
															Creating proxy… {proxyStates[asset.id].progress}%
														</span>
														<Progress value={proxyStates[asset.id].progress} class="mt-0.5 h-1" />
													{:else if isProxyInputTooLarge(asset.size)}
														<span class="block text-center text-[8px] text-muted-foreground">
															Too large for proxy (max 512 MB)
														</span>
													{:else}
														<button
															class="flex w-full items-center justify-center gap-1 rounded-sm bg-secondary py-1 text-[9px] font-medium text-foreground transition-colors hover:bg-secondary/80"
															onclick={() => createProxy(asset)}
														>
															<Wand2 class="size-3" />
															{#if proxyStates[asset.id]?.status === 'error'}
																Retry proxy
															{:else}
																Create proxy
															{/if}
														</button>
														{#if proxyStates[asset.id]?.status === 'error'}
															<span class="block text-center text-[8px] text-destructive">
																Proxy could not be created
															</span>
														{/if}
													{/if}
												</div>
											{/if}
										</div>
									{/snippet}
								</ContextMenu.Trigger>
								{@render assetMenuContent(asset, false)}
							</ContextMenu.Root>
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
