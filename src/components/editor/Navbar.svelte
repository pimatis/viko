<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as Popover from '$lib/components/ui/popover';
	import type { ExportQuality, ExportResolution } from '$lib/export';
	import { cn } from '$lib/utils';
	import { sound } from '$lib/sound';
	import {
		useShortcuts,
		formatShortcut,
		type ShortcutBinding,
		type ShortcutSpec
	} from '$lib/shortcuts';
	import {
		Save,
		FolderOpen,
		FileVideo,
		Undo2,
		Redo2,
		ZoomIn,
		ZoomOut,
		Maximize2,
		Share2,
		Download,
		Cloud,
		PanelLeftClose,
		PanelLeft,
		Keyboard,
		History,
		Loader2,
		Check
	} from '@lucide/svelte';

	type Props = {
		projectName?: string;
		zoom?: number;
		canUndo?: boolean;
		canRedo?: boolean;
		isSaved?: boolean;
		isSaving?: boolean;
		autoSaveEnabled?: boolean;
		exportQuality?: ExportQuality;
		exportResolution?: ExportResolution | null;
		isExporting?: boolean;
		exportQualities?: ExportQuality[];
		onExportQualityChange?: (qualityId: string) => void;
		onExport?: () => void;
		onNewProject?: () => void;
		onOpenProject?: () => void;
		onSave?: () => void;
		onSaveAs?: () => void;
		onAutoSaveToggle?: (enabled: boolean) => void;
		onShowVersionHistory?: () => void;
		onShowShortcuts?: () => void;
		onProjectNameChange?: (name: string) => void;
		onUndo?: () => void;
		onRedo?: () => void;
		onZoomIn?: (e: Event) => void;
		onZoomOut?: (e: Event) => void;
		onZoomReset?: (e: Event) => void;
		onToggleSidebar?: () => void;
	};

	let {
		projectName = $bindable('Untitled Project'),
		zoom = $bindable(100),
		canUndo = false,
		canRedo = false,
		isSaved = true,
		isSaving = false,
		autoSaveEnabled = false,
		exportQuality = $bindable({
			id: '720p',
			label: '720p',
			width: 1280,
			height: 720,
			bitrate: '3000k'
		} as ExportQuality),
		isExporting = false,
		exportQualities = [],
		exportResolution = null,
		onExportQualityChange = () => {},
		onExport = () => {},
		onNewProject = () => {},
		onOpenProject = () => {},
		onSave = () => {},
		onSaveAs = () => {},
		onAutoSaveToggle = () => {},
		onShowVersionHistory = () => {},
		onShowShortcuts = () => {},
		onProjectNameChange = () => {},
		onUndo = () => {},
		onRedo = () => {},
		onZoomIn = () => {},
		onZoomOut = () => {},
		onZoomReset = () => {},
		onToggleSidebar = () => {}
	}: Props = $props();

	let isEditingName = $state(false);
	let editValue = $state('');
	let nameInput = $state<HTMLInputElement | null>(null);
	let openMenu = $state<string | null>(null);

	let saveButtonLabel = $derived(
		isSaving
			? 'Saving project'
			: isSaved
				? autoSaveEnabled
					? 'Auto-save enabled'
					: 'Project saved'
				: 'Save project'
	);

	const ZOOM_MIN = 10;
	const ZOOM_MAX = 400;
	const ZOOM_STEP = 10;

	const sidebarShortcut: ShortcutBinding = {
		key: 'b',
		ctrlOrMeta: true,
		description: 'Toggle Sidebar',
		onKeyDown: () => {
			sound.expand();
			onToggleSidebar();
		}
	};

	const newProjectShortcut: ShortcutSpec = { key: 'n', ctrlOrMeta: true };
	const openProjectShortcut: ShortcutSpec = { key: 'o', ctrlOrMeta: true };
	const saveAsShortcut: ShortcutSpec = { key: 's', ctrlOrMeta: true, shift: true };
	const saveShortcut: ShortcutSpec = { key: 's', ctrlOrMeta: true };
	const exportShortcut: ShortcutSpec = { key: 'e', ctrlOrMeta: true };
	const undoShortcut: ShortcutSpec = { key: 'z', ctrlOrMeta: true };
	const redoShortcut: ShortcutSpec = { key: 'z', ctrlOrMeta: true, shift: true };
	const zoomInShortcut: ShortcutSpec = { key: '+', ctrlOrMeta: true };
	const zoomOutShortcut: ShortcutSpec = { key: '-', ctrlOrMeta: true };
	const fitToScreenShortcut: ShortcutSpec = { key: '0', ctrlOrMeta: true };
	const shortcutsDialogShortcut: ShortcutSpec = { key: '/', ctrlOrMeta: true };

	const shortcuts: ShortcutBinding[] = [
		sidebarShortcut,
		{
			...newProjectShortcut,
			description: 'New Project',
			onKeyDown: () => {
				sound.select();
				onNewProject();
			}
		},
		{
			...openProjectShortcut,
			description: 'Open Project',
			onKeyDown: () => {
				sound.select();
				onOpenProject();
			}
		},
		{
			...saveAsShortcut,
			description: 'Save As',
			onKeyDown: () => {
				sound.select();
				onSaveAs();
			}
		},
		{
			...saveShortcut,
			description: 'Save',
			onKeyDown: () => {
				sound.success();
				onSave();
			}
		},
		{
			...exportShortcut,
			description: 'Export',
			enabled: () => isSaved && !isExporting,
			onKeyDown: () => {
				sound.start();
				onExport();
			}
		},
		{
			...fitToScreenShortcut,
			description: 'Fit to Screen',
			onKeyDown: handleZoomReset
		},
		{
			...shortcutsDialogShortcut,
			description: 'Keyboard Shortcuts',
			onKeyDown: () => {
				sound.select();
				onShowShortcuts();
			}
		}
	];

	function handleMenuOpenChange(menu: string, open: boolean) {
		if (open) {
			openMenu = menu;
		} else if (openMenu === menu) {
			openMenu = null;
		}
	}

	function handleMenuTriggerHover(menu: string) {
		if (openMenu !== null && openMenu !== menu) {
			openMenu = menu;
		}
	}

	function isMenuTrigger(target: EventTarget | null): boolean {
		if (!target || !(target instanceof Element)) return false;
		return target.closest('[data-menu-trigger]') !== null;
	}

	function handleContentInteractOutside(e: Event) {
		if (isMenuTrigger(e.target)) {
			e.preventDefault();
		}
	}

	function handleZoomIn() {
		sound.select();
		zoom = Math.min(ZOOM_MAX, zoom + ZOOM_STEP);
		onZoomIn(new Event('zoomin'));
	}

	function handleZoomOut() {
		sound.select();
		zoom = Math.max(ZOOM_MIN, zoom - ZOOM_STEP);
		onZoomOut(new Event('zoomout'));
	}

	function handleZoomReset() {
		sound.select();
		zoom = 100;
		onZoomReset(new Event('zoomreset'));
	}

	function handleRangeZoom(e: Event) {
		zoom = Number((e.target as HTMLInputElement).value);
	}

	function startEditingName() {
		editValue = projectName;
		isEditingName = true;
		setTimeout(() => nameInput?.select(), 0);
	}

	function finishEditingName() {
		const trimmed = editValue.trim();
		if (trimmed && trimmed !== projectName) {
			projectName = trimmed;
			onProjectNameChange(trimmed);
		}
		isEditingName = false;
	}

	function handleNameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			finishEditingName();
			return;
		}
		if (e.key === 'Escape') {
			isEditingName = false;
		}
	}
</script>

<Tooltip.Provider delayDuration={300}>
	<header
		use:useShortcuts={shortcuts}
		class="flex h-11 items-center gap-2 border-b border-border bg-background px-2.5 select-none"
	>
		<!-- left: brand + sidebar toggle + menus -->
		<div class="flex min-w-0 items-center gap-1.5">
			<a href="/" class="flex items-center gap-0.5 pr-1 text-foreground">
				<img
					src="/assets/logos/logo.png"
					alt="Viko"
					class="h-7 w-auto shrink-0"
					draggable="false"
				/>
				<span class="text-sm font-bold tracking-tight">Viko</span>
			</a>

			<div class="h-4 w-px shrink-0 bg-border"></div>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="shrink-0 text-muted-foreground hover:text-foreground"
							onclick={() => {
								sound.expand();
								onToggleSidebar();
							}}
							aria-label="Toggle sidebar"
						>
							<PanelLeft class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom" sideOffset={6}>
					{sidebarShortcut.description} ({formatShortcut(sidebarShortcut)})
				</Tooltip.Content>
			</Tooltip.Root>

			<div class="h-4 w-px shrink-0 bg-border"></div>

			<div class="flex min-w-0 items-center gap-0.5">
				<DropdownMenu.Root
					open={openMenu === 'file'}
					onOpenChange={(open) => handleMenuOpenChange('file', open)}
				>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="xs"
								class={cn(
									'shrink-0 px-2.5 text-muted-foreground hover:text-foreground',
									openMenu === 'file' && 'bg-secondary text-foreground'
								)}
								data-menu-trigger
								onpointermove={() => handleMenuTriggerHover('file')}
							>
								File
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="min-w-56" onInteractOutside={handleContentInteractOutside}>
						<DropdownMenu.Group>
							<DropdownMenu.Item
								onSelect={() => {
									sound.select();
									onNewProject();
								}}
							>
								<FileVideo class="mr-2 size-4" />
								New Project
								<DropdownMenu.Shortcut>{formatShortcut(newProjectShortcut)}</DropdownMenu.Shortcut>
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onSelect={() => {
									sound.select();
									onOpenProject();
								}}
							>
								<FolderOpen class="mr-2 size-4" />
								Open Project
								<DropdownMenu.Shortcut>{formatShortcut(openProjectShortcut)}</DropdownMenu.Shortcut>
							</DropdownMenu.Item>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.Item
								disabled={isSaved || isSaving}
								onSelect={() => {
									sound.select();
									onSave();
								}}
							>
								<Save class="mr-2 size-4" />
								Save
								<DropdownMenu.Shortcut>{formatShortcut(saveShortcut)}</DropdownMenu.Shortcut>
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onSelect={() => {
									sound.select();
									onSaveAs();
								}}
							>
								<Save class="mr-2 size-4" />
								Save As
								<DropdownMenu.Shortcut>{formatShortcut(saveAsShortcut)}</DropdownMenu.Shortcut>
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							<DropdownMenu.Item
								onSelect={() => {
									if (!autoSaveEnabled) sound.toggleOn();
									else sound.toggleOff();
									onAutoSaveToggle(!autoSaveEnabled);
								}}
							>
								{#if autoSaveEnabled}
									<Check class="mr-2 size-4" />
								{:else}
									<div class="mr-2 size-4"></div>
								{/if}
								Auto-save
							</DropdownMenu.Item>
						</DropdownMenu.Group>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onSelect={() => {
								sound.select();
								onShowVersionHistory();
							}}
						>
							<History class="mr-2 size-4" />
							Version History
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							disabled={!isSaved || isExporting}
							onSelect={() => {
								sound.start();
								onExport();
							}}
						>
							<Download class="mr-2 size-4" />
							Export project
							<DropdownMenu.Shortcut>{formatShortcut(exportShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<DropdownMenu.Root
					open={openMenu === 'edit'}
					onOpenChange={(open) => handleMenuOpenChange('edit', open)}
				>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="xs"
								class={cn(
									'shrink-0 px-2.5 text-muted-foreground hover:text-foreground',
									openMenu === 'edit' && 'bg-secondary text-foreground'
								)}
								data-menu-trigger
								onpointermove={() => handleMenuTriggerHover('edit')}
							>
								Edit
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="min-w-56" onInteractOutside={handleContentInteractOutside}>
						<DropdownMenu.Item
							disabled={!canUndo}
							onSelect={() => {
								sound.undo();
								onUndo();
							}}
						>
							<Undo2 class="mr-2 size-4" />
							Undo
							<DropdownMenu.Shortcut>{formatShortcut(undoShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
						<DropdownMenu.Item
							disabled={!canRedo}
							onSelect={() => {
								sound.redo();
								onRedo();
							}}
						>
							<Redo2 class="mr-2 size-4" />
							Redo
							<DropdownMenu.Shortcut>{formatShortcut(redoShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onSelect={() => {
								sound.select();
								onShowShortcuts();
							}}
						>
							<Keyboard class="mr-2 size-4" />
							Keyboard Shortcuts
							<DropdownMenu.Shortcut
								>{formatShortcut(shortcutsDialogShortcut)}</DropdownMenu.Shortcut
							>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<DropdownMenu.Root
					open={openMenu === 'view'}
					onOpenChange={(open) => handleMenuOpenChange('view', open)}
				>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="xs"
								class={cn(
									'shrink-0 px-2.5 text-muted-foreground hover:text-foreground',
									openMenu === 'view' && 'bg-secondary text-foreground'
								)}
								data-menu-trigger
								onpointermove={() => handleMenuTriggerHover('view')}
							>
								View
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="min-w-56" onInteractOutside={handleContentInteractOutside}>
						<DropdownMenu.Item onSelect={handleZoomIn}>
							<ZoomIn class="mr-2 size-4" />
							Zoom In
							<DropdownMenu.Shortcut>{formatShortcut(zoomInShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={handleZoomOut}>
							<ZoomOut class="mr-2 size-4" />
							Zoom Out
							<DropdownMenu.Shortcut>{formatShortcut(zoomOutShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={handleZoomReset}>
							<Maximize2 class="mr-2 size-4" />
							Fit to Screen
							<DropdownMenu.Shortcut>{formatShortcut(fitToScreenShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onSelect={() => {
								sound.expand();
								onToggleSidebar();
							}}
						>
							<PanelLeftClose class="mr-2 size-4" />
							Toggle Sidebar
							<DropdownMenu.Shortcut>{formatShortcut(sidebarShortcut)}</DropdownMenu.Shortcut>
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>

		<!-- center: project name -->
		<div class="mx-2 flex min-w-0 flex-1 items-center justify-center">
			{#if isEditingName}
				<input
					bind:this={nameInput}
					bind:value={editValue}
					onblur={finishEditingName}
					onkeydown={handleNameKeydown}
					class="h-7 w-full max-w-56 rounded-md border border-ring bg-muted px-3 text-center text-xs font-semibold text-foreground outline-none"
				/>
			{:else}
				<button
					onclick={startEditingName}
					class="group flex items-center gap-2 rounded-md bg-background/60 px-3 py-1.5 transition-colors hover:bg-muted"
				>
					<span class="truncate text-xs font-semibold text-foreground">{projectName}</span>
					<span
						class={cn(
							'size-1.5 rounded-full transition-colors',
							isSaving ? 'bg-amber-400' : isSaved ? 'bg-emerald-400' : 'bg-muted-foreground'
						)}
						title={isSaving ? 'Saving...' : isSaved ? 'Saved' : 'Unsaved'}
					></span>
				</button>
			{/if}
		</div>

		<!-- right: undo/redo, zoom, save, export -->
		<div class="flex shrink-0 items-center gap-1">
			<!-- undo/redo group -->
			<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								disabled={!canUndo}
								onclick={() => {
									sound.undo();
									onUndo();
								}}
								class="text-muted-foreground hover:text-foreground"
								aria-label="Undo"
							>
								<Undo2 class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" sideOffset={6}>
						Undo ({formatShortcut(undoShortcut)})
					</Tooltip.Content>
				</Tooltip.Root>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								disabled={!canRedo}
								onclick={() => {
									sound.redo();
									onRedo();
								}}
								class="text-muted-foreground hover:text-foreground"
								aria-label="Redo"
							>
								<Redo2 class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" sideOffset={6}>
						Redo ({formatShortcut(redoShortcut)})
					</Tooltip.Content>
				</Tooltip.Root>
			</div>

			<div class="h-4 w-px shrink-0 bg-border"></div>

			<!-- zoom popover -->
			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="xs"
							class="min-w-12 justify-center text-xs text-muted-foreground tabular-nums hover:text-foreground"
						>
							{zoom}%
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-56" align="center" sideOffset={8}>
					<div class="flex items-center gap-2">
						<Button variant="outline" size="icon-xs" onclick={handleZoomOut}>
							<ZoomOut class="size-3" />
						</Button>
						<input
							type="range"
							min="10"
							max="400"
							value={zoom}
							oninput={handleRangeZoom}
							class="h-1 flex-1 cursor-pointer accent-primary"
						/>
						<Button variant="outline" size="icon-xs" onclick={handleZoomIn}>
							<ZoomIn class="size-3" />
						</Button>
					</div>
					<Button variant="ghost" size="xs" class="mt-2 w-full text-xs" onclick={handleZoomReset}>
						Fit to Screen
					</Button>
				</Popover.Content>
			</Popover.Root>

			<div class="h-4 w-px shrink-0 bg-border"></div>

			<!-- save -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							disabled={isSaving || isSaved}
							onclick={() => {
								sound.success();
								onSave();
							}}
							aria-label={saveButtonLabel}
						>
							{#if isSaving}
								<Loader2 class="size-4 animate-spin" />
							{:else}
								<Cloud class="size-4" />
							{/if}
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom" sideOffset={6}>
					{saveButtonLabel} ({formatShortcut(saveShortcut)})
				</Tooltip.Content>
			</Tooltip.Root>

			{#if autoSaveEnabled && !isSaving}
				<span class="hidden text-[10px] text-muted-foreground tabular-nums sm:inline">Auto</span>
			{/if}

			<!-- export quality selector -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="xs"
							class="shrink-0 gap-1 px-2.5 text-muted-foreground hover:text-foreground"
							disabled={isExporting}
						>
							<span class="tabular-nums">
								{exportQuality.label}
								{#if exportResolution}
									<span class="ml-1 text-muted-foreground">
										· {exportResolution.width}x{exportResolution.height}
									</span>
								{/if}
							</span>
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" sideOffset={8}>
					<DropdownMenu.Group>
						<DropdownMenu.Label>Export Quality</DropdownMenu.Label>
						{#each exportQualities as quality (quality.id)}
							<DropdownMenu.Item
								onSelect={() => {
									sound.select();
									onExportQualityChange(quality.id);
								}}
							>
								<span class="flex-1">{quality.label}</span>
								{#if exportQuality.id === quality.id}
									<Check class="ml-2 size-3.5" />
								{/if}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<!-- export button -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="default"
							size="sm"
							disabled={!isSaved || isExporting}
							onclick={() => {
								sound.start();
								onExport();
							}}
							class="gap-1.5 text-xs font-semibold"
						>
							{#if isExporting}
								<Loader2 class="size-4 animate-spin" />
							{:else}
								<Share2 class="size-4" />
							{/if}
							<span class="hidden sm:inline">Export</span>
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content side="bottom" sideOffset={6}>
					Export ({formatShortcut(exportShortcut)})
				</Tooltip.Content>
			</Tooltip.Root>
		</div>
	</header>
</Tooltip.Provider>
