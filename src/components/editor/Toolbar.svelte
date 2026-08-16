<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { clampTimelineZoom, TIMELINE_ZOOM_STEP, type EditorTool } from '$lib/editor/toolbar';
	import { cn } from '$lib/utils';
	import {
		AudioLines,
		Hand,
		Magnet,
		Minus,
		MonitorPlay,
		MousePointer2,
		Plus,
		Scissors,
		Type,
		Workflow,
		ArrowRightToLine,
		ArrowLeftToLine,
		X,
		AlignHorizontalDistributeCenter,
		BetweenHorizontalStart,
		ArrowLeftRight
	} from '@lucide/svelte';
	import { sound } from '$lib/sound';

	type Props = {
		activeTool?: EditorTool;
		snappingEnabled?: boolean;
		zoom?: number;
		rippleMode?: boolean;
		onRippleModeToggle?: (enabled: boolean) => void;
		hasInOutPoints?: boolean;
		onSetInPoint?: () => void;
		onSetOutPoint?: () => void;
		onClearInOutPoints?: () => void;
		sourceMonitorOpen?: boolean;
		onSourceMonitorToggle?: () => void;
		mixerOpen?: boolean;
		onMixerToggle?: () => void;
	};

	type ToolOption = {
		id: EditorTool;
		label: string;
		shortcut: string;
		icon: typeof MousePointer2;
	};

	let {
		activeTool = $bindable('select'),
		snappingEnabled = $bindable(true),
		zoom = $bindable(100),
		rippleMode = $bindable(false),
		onRippleModeToggle = () => {},
		hasInOutPoints = false,
		onSetInPoint = () => {},
		onSetOutPoint = () => {},
		onClearInOutPoints = () => {},
		sourceMonitorOpen = false,
		onSourceMonitorToggle = () => {},
		mixerOpen = false,
		onMixerToggle = () => {}
	}: Props = $props();

	const tools: ToolOption[] = [
		{ id: 'select', label: 'Selection tool', shortcut: 'V', icon: MousePointer2 },
		{ id: 'razor', label: 'Razor tool', shortcut: 'B', icon: Scissors },
		{ id: 'hand', label: 'Hand tool', shortcut: 'H', icon: Hand },
		{ id: 'text', label: 'Text tool', shortcut: 'T', icon: Type },
		{ id: 'slip', label: 'Slip tool', shortcut: 'Y', icon: AlignHorizontalDistributeCenter },
		{ id: 'rolling', label: 'Rolling edit tool', shortcut: 'N', icon: BetweenHorizontalStart },
		{ id: 'slide', label: 'Slide tool', shortcut: 'U', icon: ArrowLeftRight }
	];

	function setTool(tool: EditorTool) {
		sound.select();
		activeTool = tool;
	}

	function zoomIn() {
		sound.select();
		zoom = clampTimelineZoom(zoom + TIMELINE_ZOOM_STEP);
	}

	function zoomOut() {
		sound.select();
		zoom = clampTimelineZoom(zoom - TIMELINE_ZOOM_STEP);
	}

	function resetZoom() {
		sound.select();
		zoom = 100;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
		if (
			event.target instanceof HTMLInputElement ||
			event.target instanceof HTMLTextAreaElement ||
			(event.target instanceof HTMLElement && event.target.isContentEditable)
		) {
			return;
		}

		const key = event.key.toLocaleLowerCase();
		const tool = tools.find((option) => option.shortcut.toLocaleLowerCase() === key);
		if (tool) {
			setTool(tool.id);
			return;
		}
		if (key === 's') {
			snappingEnabled = !snappingEnabled;
			if (snappingEnabled) sound.toggleOn();
			else sound.toggleOff();
			return;
		}
		if (key === 'r') {
			rippleMode = !rippleMode;
			if (rippleMode) sound.toggleOn();
			else sound.toggleOff();
			onRippleModeToggle(rippleMode);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5">
	<!-- tool group -->
	<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
		<Tooltip.Provider delayDuration={400}>
			{#each tools as tool (tool.id)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class={cn(
									'text-muted-foreground transition-all',
									activeTool === tool.id
										? 'bg-secondary text-foreground shadow-sm'
										: 'hover:text-foreground'
								)}
								onclick={() => setTool(tool.id)}
								aria-label={tool.label}
							>
								<tool.icon class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>{tool.label} ({tool.shortcut})</Tooltip.Content>
				</Tooltip.Root>
			{/each}

			<div class="mx-1 h-4 w-px bg-border"></div>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class={cn(
								'text-muted-foreground transition-all',
								snappingEnabled ? 'bg-secondary text-foreground shadow-sm' : 'hover:text-foreground'
							)}
							onclick={() => {
								snappingEnabled = !snappingEnabled;
								if (snappingEnabled) sound.toggleOn();
								else sound.toggleOff();
							}}
							aria-label="Toggle snapping"
						>
							<Magnet class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Snapping (S)</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class={cn(
								'text-muted-foreground transition-all',
								rippleMode ? 'bg-secondary text-foreground shadow-sm' : 'hover:text-foreground'
							)}
							onclick={() => {
								rippleMode = !rippleMode;
								if (rippleMode) sound.toggleOn();
								else sound.toggleOff();
								onRippleModeToggle(rippleMode);
							}}
							aria-label="Toggle ripple mode"
						>
							<Workflow class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Ripple mode (R)</Tooltip.Content>
			</Tooltip.Root>

			<div class="mx-1 h-4 w-px bg-border"></div>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class={cn(
								'text-muted-foreground transition-all',
								sourceMonitorOpen
									? 'bg-secondary text-foreground shadow-sm'
									: 'hover:text-foreground'
							)}
							onclick={() => {
								if (sourceMonitorOpen) sound.pause();
								onSourceMonitorToggle();
							}}
							aria-label="Toggle source monitor"
						>
							<MonitorPlay class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Source monitor</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class={cn(
								'text-muted-foreground transition-all',
								mixerOpen ? 'bg-secondary text-foreground shadow-sm' : 'hover:text-foreground'
							)}
							onclick={onMixerToggle}
							aria-label="Toggle audio mixer"
						>
							<AudioLines class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Audio mixer</Tooltip.Content>
			</Tooltip.Root>

			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground transition-all hover:text-foreground"
							onclick={onSetInPoint}
							aria-label="Set in point"
						>
							<ArrowRightToLine class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Set in point (I)</Tooltip.Content>
			</Tooltip.Root>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground transition-all hover:text-foreground"
							onclick={onSetOutPoint}
							aria-label="Set out point"
						>
							<ArrowLeftToLine class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Set out point (O)</Tooltip.Content>
			</Tooltip.Root>
			{#if hasInOutPoints}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground transition-all hover:text-foreground"
								onclick={onClearInOutPoints}
								aria-label="Clear in/out points"
							>
								<X class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Clear in/out (Ctrl+Shift+I)</Tooltip.Content>
				</Tooltip.Root>
			{/if}
		</Tooltip.Provider>
	</div>

	<div class="flex-1"></div>

	<!-- zoom group -->
	<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground hover:text-foreground"
			onclick={zoomOut}
			aria-label="Zoom out timeline"
		>
			<Minus class="size-4" />
		</Button>
		<button
			class="min-w-10 rounded-sm px-1 text-center text-[11px] font-medium text-muted-foreground tabular-nums transition-colors hover:text-foreground"
			onclick={resetZoom}
			title="Reset timeline zoom"
		>
			{Math.round(zoom)}%
		</button>
		<Button
			variant="ghost"
			size="icon-xs"
			class="text-muted-foreground hover:text-foreground"
			onclick={zoomIn}
			aria-label="Zoom in timeline"
		>
			<Plus class="size-4" />
		</Button>
	</div>
</div>
