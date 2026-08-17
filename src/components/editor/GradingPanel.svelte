<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Switch from '$lib/components/ui/switch';
	import {
		IDENTITY_CURVE,
		LUT_PRESETS,
		clampFinishValue,
		clampGradeIntensity,
		clampWheelHue,
		clampWheelSaturation,
		clampWheelStrength,
		clampSecondaryHue,
		clampSecondaryRange,
		clampSecondaryPercent,
		cloneColorGrade,
		DEFAULT_COLOR_GRADE,
		getLutPreset,
		isNeutralGrade,
		listCubeLuts,
		registerCubeLut,
		removeCubeLut,
		getCubeLut,
		type ColorCurvePoint,
		type ColorGrade,
		type ColorWheel as ColorWheelGrade,
		type CubeLut,
		type CurveChannel,
		type FinishFilters,
		type SecondaryCorrection,
		type SecondaryPowerWindow
	} from '$lib/grading';
	import { sound } from '$lib/sound';
	import { cn } from '$lib/utils';
	import { Check, Loader2, RotateCcw, Trash2, Upload, Wand2 } from '@lucide/svelte';
	import ColorWheel from './ColorWheel.svelte';
	import CurveEditor from './CurveEditor.svelte';

	type Props = {
		grade?: ColorGrade;
		onGradeChange: (updater: (grade: ColorGrade) => ColorGrade) => void;
		allowLut?: boolean;
		matchSources?: { id: string; name: string }[];
		onMatchColor?: (sourceClipId: string) => void;
		onAutoLevels?: () => void;
		autoLeveling?: boolean;
		onLutPreview?: (lutId: string | null, canvas: HTMLCanvasElement) => void;
		matching?: boolean;
	};

	let {
		grade,
		onGradeChange,
		allowLut = true,
		matchSources = [],
		onMatchColor,
		onAutoLevels,
		autoLeveling = false,
		onLutPreview,
		matching = false
	}: Props = $props();

	type GradingTab = 'wheels' | 'curves' | 'lut' | 'secondary' | 'finish';
	type WheelKey = 'master' | 'shadows' | 'midtones' | 'highlights';

	let activeTab = $state<GradingTab>('wheels');
	let activeCurveChannel = $state<CurveChannel>('master');
	let matchDialogOpen = $state(false);
	let lutFileInput = $state<HTMLInputElement | null>(null);
	let hueStripCanvas = $state<HTMLCanvasElement | null>(null);
	let customLuts = $state<CubeLut[]>(listCubeLuts());

	const currentGrade = $derived(grade ?? cloneColorGrade(DEFAULT_COLOR_GRADE));
	const isReset = $derived(grade ? isNeutralGrade(grade) : true);

	const tabs = $derived.by((): { id: GradingTab; label: string }[] => {
		const allTabs: { id: GradingTab; label: string }[] = [
			{ id: 'wheels', label: 'Wheels' },
			{ id: 'curves', label: 'Curves' },
			{ id: 'lut', label: 'LUT' },
			{ id: 'secondary', label: 'Secondary' },
			{ id: 'finish', label: 'Finish' }
		];
		return allowLut ? allTabs : allTabs.filter((tab) => tab.id !== 'lut' && tab.id !== 'secondary');
	});

	$effect(() => {
		if (!tabs.some((tab) => tab.id === activeTab)) activeTab = tabs[0].id;
	});

	const wheelRows: { key: WheelKey; label: string }[] = [
		{ key: 'master', label: 'Master' },
		{ key: 'shadows', label: 'Shadows' },
		{ key: 'midtones', label: 'Midtones' },
		{ key: 'highlights', label: 'Highlights' }
	];

	const curveChannels: { key: CurveChannel; label: string; color: string }[] = [
		{ key: 'master', label: 'Master', color: '#ffffff' },
		{ key: 'red', label: 'R', color: '#f87171' },
		{ key: 'green', label: 'G', color: '#4ade80' },
		{ key: 'blue', label: 'B', color: '#60a5fa' }
	];

	const activeChannel = $derived(
		curveChannels.find((channel) => channel.key === activeCurveChannel) ?? curveChannels[0]
	);
	const activeChannelPoints = $derived(currentGrade.curves[activeCurveChannel]);

	const secondary = $derived(currentGrade.secondary);
	const windowType = $derived(secondary.window.type);

	function updateWheel(wheelKey: WheelKey, field: keyof ColorWheelGrade, value: number) {
		onGradeChange((current) => {
			const wheel = { ...current[wheelKey] };
			if (field === 'hue') wheel.hue = clampWheelHue(value);
			if (field === 'saturation') wheel.saturation = clampWheelSaturation(value);
			if (field === 'strength') wheel.strength = clampWheelStrength(value);
			return { ...current, [wheelKey]: wheel };
		});
	}

	function handleWheelHueChange(wheelKey: WheelKey, value: number) {
		updateWheel(wheelKey, 'hue', value);
	}

	function handleSaturationChange(wheelKey: WheelKey, event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		updateWheel(wheelKey, 'saturation', value);
	}

	function handleStrengthChange(wheelKey: WheelKey, event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		updateWheel(wheelKey, 'strength', value);
	}

	function handleIntensityChange(event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		onGradeChange((current) => ({ ...current, intensity: clampGradeIntensity(value) }));
	}

	// ----- finish filters (vignette / grain / sharpen / denoise) -----

	function handleFinishSlider(field: keyof FinishFilters, event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		onGradeChange((current) => ({
			...current,
			finish: { ...current.finish, [field]: clampFinishValue(value) }
		}));
	}

	function handleCurvePointsChange(points: ColorCurvePoint[]) {
		onGradeChange((current) => ({
			...current,
			curves: { ...current.curves, [activeCurveChannel]: points }
		}));
	}

	function resetCurve() {
		sound.select();
		onGradeChange((current) => ({
			...current,
			curves: { ...current.curves, [activeCurveChannel]: [...IDENTITY_CURVE] }
		}));
	}

	// ----- secondary correction -----

	function updateSecondary(updater: (current: SecondaryCorrection) => SecondaryCorrection) {
		onGradeChange((current) => ({
			...current,
			secondary: updater(current.secondary)
		}));
	}

	function handleSecondarySlider(
		field: keyof SecondaryCorrection,
		event: Event,
		clamp: (value: number) => number = (value) => value
	) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		updateSecondary((current) => ({ ...current, [field]: clamp(value) }));
	}

	function handleWindowChange(
		field: keyof SecondaryPowerWindow,
		event: Event,
		clamp: (value: number) => number = (value) => value
	) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		updateSecondary((current) => ({
			...current,
			window: { ...current.window, [field]: clamp(value) }
		}));
	}

	function toggleSecondary() {
		const nextEnabled = !secondary.enabled;
		if (nextEnabled) sound.toggleOn();
		if (!nextEnabled) sound.toggleOff();
		updateSecondary((current) => ({ ...current, enabled: nextEnabled }));
	}

	function resetSecondary() {
		sound.select();
		onGradeChange((current) => ({
			...current,
			secondary: {
				...cloneColorGrade(DEFAULT_COLOR_GRADE).secondary,
				enabled: current.secondary?.enabled === true
			}
		}));
	}

	function handleWindowTypeChange(value: string) {
		if (value !== 'full' && value !== 'ellipse' && value !== 'rect') return;
		sound.select();
		updateSecondary((current) => ({
			...current,
			window: { ...current.window, type: value }
		}));
	}

	function drawHueStrip() {
		const canvas = hueStripCanvas;
		if (!canvas) return;
		const context = canvas.getContext('2d');
		if (!context) return;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;
		if (width <= 0 || height <= 0) return;
		const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
		if (canvas.width !== Math.round(width * pixelRatio))
			canvas.width = Math.round(width * pixelRatio);
		if (canvas.height !== Math.round(height * pixelRatio))
			canvas.height = Math.round(height * pixelRatio);
		context.save();
		context.scale(pixelRatio, pixelRatio);
		const gradient = context.createLinearGradient(0, 0, width, 0);
		gradient.addColorStop(0, 'hsl(0 100% 55%)');
		gradient.addColorStop(0.167, 'hsl(60 100% 55%)');
		gradient.addColorStop(0.333, 'hsl(120 100% 55%)');
		gradient.addColorStop(0.5, 'hsl(180 100% 55%)');
		gradient.addColorStop(0.667, 'hsl(240 100% 55%)');
		gradient.addColorStop(0.833, 'hsl(300 100% 55%)');
		gradient.addColorStop(1, 'hsl(0 100% 55%)');
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);

		// dim the area outside the selected hue range
		const centerX = (secondary.hue / 360) * width;
		const halfRange = Math.min(180, secondary.hueRange) / 360;
		context.fillStyle = 'rgba(0, 0, 0, 0.65)';
		const leftEnd = centerX - halfRange * width;
		const rightStart = centerX + halfRange * width;
		if (leftEnd > 0) context.fillRect(0, 0, leftEnd, height);
		if (rightStart < width) context.fillRect(rightStart, 0, width - rightStart, height);

		context.fillStyle = 'rgba(255, 255, 255, 0.9)';
		context.fillRect(centerX - 1, 0, 2, height);
		context.restore();
	}

	$effect(() => {
		drawHueStrip();
	});

	$effect(() => {
		if (!hueStripCanvas) return;
		const resizeObserver = new ResizeObserver(() => drawHueStrip());
		resizeObserver.observe(hueStripCanvas);
		return () => resizeObserver.disconnect();
	});

	// ----- lut selection -----

	function selectLut(lutId: string | null) {
		sound.select();
		if (!lutId) {
			onGradeChange((current) => ({ ...current, lutId: null, customLut: null }));
			return;
		}
		const preset = getLutPreset(lutId);
		if (preset) {
			onGradeChange((current) => ({ ...current, lutId, customLut: null }));
			return;
		}
		const custom = getCubeLut(lutId);
		if (custom) {
			onGradeChange((current) => ({
				...current,
				lutId: null,
				customLut: { id: custom.id, name: custom.name, source: custom.source }
			}));
		}
	}

	async function handleLutFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const text = await file.text();
			if (text.length > 400_000) {
				sound.error();
				return;
			}
			const lut = registerCubeLut(file.name.replace(/\.cube$/i, ''), text);
			customLuts = listCubeLuts();
			sound.complete();
			selectLut(lut.id);
		} catch {
			sound.error();
		} finally {
			input.value = '';
		}
	}

	function handleRemoveCustomLut(lutId: string) {
		sound.delete();
		removeCubeLut(lutId);
		customLuts = listCubeLuts();
		if (currentGrade.customLut?.id === lutId) {
			onGradeChange((current) => ({ ...current, customLut: null }));
		}
	}

	// ----- match color -----

	function handleMatchOpen() {
		sound.select();
		matchDialogOpen = true;
	}

	function handleMatchSelect(sourceId: string) {
		matchDialogOpen = false;
		sound.select();
		onMatchColor?.(sourceId);
	}

	onMount(() => {
		customLuts = listCubeLuts();
	});

	function resetGrade() {
		sound.select();
		onGradeChange(() => cloneColorGrade(DEFAULT_COLOR_GRADE));
	}
</script>

<section class="space-y-2.5">
	<div class="flex items-center justify-between">
		<span class="text-[11px] font-semibold text-foreground">Color Grading</span>
		<div class="flex items-center gap-1.5">
			{#if matchSources.length > 0 && onMatchColor}
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-5 shrink-0 text-muted-foreground"
					onclick={handleMatchOpen}
					aria-label="Match color to another clip"
					title="Match color to another clip"
				>
					{#if matching}
						<Loader2 class="size-3 animate-spin" />
					{:else}
						<Wand2 class="size-3" />
					{/if}
				</Button>
			{/if}
			<button
				class="flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
				onclick={resetGrade}
				disabled={isReset}
				title="Reset color grading"
			>
				<RotateCcw class="size-2.5" />
				Reset
			</button>
		</div>
	</div>

	<div class="flex items-center justify-between gap-2">
		<span class="text-[10px] text-muted-foreground">Intensity</span>
		<span class="text-[10px] text-muted-foreground tabular-nums"
			>{Math.round(currentGrade.intensity)}%</span
		>
	</div>
	<input
		type="range"
		min="0"
		max="100"
		step="1"
		value={currentGrade.intensity}
		oninput={handleIntensityChange}
		class="h-1 w-full cursor-pointer accent-primary"
		aria-label="Color grading intensity"
	/>

	<div class="flex rounded-md bg-muted p-0.5">
		{#each tabs as tab (tab.id)}
			<button
				class={cn(
					'flex-1 rounded-sm px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors',
					activeTab === tab.id && 'bg-background text-foreground shadow-sm'
				)}
				onclick={() => {
					sound.select();
					activeTab = tab.id;
				}}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	{#if activeTab === 'wheels'}
		<div class="space-y-2.5">
			{#each wheelRows as row (row.key)}
				<div class="flex items-start gap-2">
					<div class="pt-1">
						<ColorWheel
							hue={currentGrade[row.key].hue}
							onHueChange={(value) => handleWheelHueChange(row.key, value)}
							size={30}
							label={`${row.label} hue`}
						/>
					</div>
					<div class="min-w-0 flex-1 space-y-1">
						<div class="flex items-center justify-between">
							<span class="text-[10px] font-medium text-foreground">{row.label}</span>
							<span class="text-[10px] text-muted-foreground tabular-nums">
								{currentGrade[row.key].hue > 0 ? '+' : ''}{Math.round(currentGrade[row.key].hue)}°
							</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="w-6 shrink-0 text-[9px] text-muted-foreground">Sat</span>
							<input
								type="range"
								min="-100"
								max="100"
								step="1"
								value={currentGrade[row.key].saturation}
								oninput={(event) => handleSaturationChange(row.key, event)}
								class="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
								aria-label={`${row.label} saturation`}
							/>
							<span class="w-7 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
								{Math.round(currentGrade[row.key].saturation)}
							</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="w-6 shrink-0 text-[9px] text-muted-foreground">Mix</span>
							<input
								type="range"
								min="0"
								max="100"
								step="1"
								value={currentGrade[row.key].strength}
								oninput={(event) => handleStrengthChange(row.key, event)}
								class="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
								aria-label={`${row.label} strength`}
							/>
							<span class="w-7 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
								{Math.round(currentGrade[row.key].strength)}
							</span>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{:else if activeTab === 'curves'}
		<div class="space-y-2">
			<div class="flex items-center justify-between gap-1.5">
				<div class="flex items-center gap-1">
					{#each curveChannels as channel (channel.key)}
						<button
							class={cn(
								'rounded-sm px-2 py-0.5 text-[10px] font-medium transition-colors',
								activeCurveChannel === channel.key
									? 'bg-secondary text-foreground'
									: 'text-muted-foreground hover:text-foreground'
							)}
							style:color={activeCurveChannel === channel.key ? undefined : channel.color}
							onclick={() => {
								sound.select();
								activeCurveChannel = channel.key;
							}}
						>
							{channel.label}
						</button>
					{/each}
				</div>
				<Button
					variant="ghost"
					size="icon-xs"
					class="size-5 shrink-0 text-muted-foreground"
					onclick={resetCurve}
					aria-label={`Reset ${activeChannel.label} curve`}
					title={`Reset ${activeChannel.label} curve`}
				>
					<RotateCcw class="size-3" />
				</Button>
			</div>
			<CurveEditor
				points={activeChannelPoints}
				onPointsChange={handleCurvePointsChange}
				color={activeChannel.color}
				label={`${activeChannel.label} curve`}
			/>
			<p class="text-[9px] text-muted-foreground">
				Click to add, drag to move, double-click to remove a point.
			</p>
		</div>
	{:else if activeTab === 'finish'}
		{@const finishRows = [
			{ field: 'vignette', label: 'Vignette', hint: 'Darken the frame edges' },
			{ field: 'grain', label: 'Film grain', hint: 'Add organic film noise' },
			{ field: 'sharpen', label: 'Sharpen', hint: 'Edge contrast via unsharp mask' },
			{ field: 'denoise', label: 'Denoise', hint: 'Reduce noise with a blur kernel' }
		] as { field: keyof FinishFilters; label: string; hint: string }[]}
		<div class="space-y-2">
			<p class="text-[9px] text-muted-foreground">
				Spatial last-touch filters. Sharpen and denoise run a real convolution kernel; grain
				animates per frame, matching the export.
			</p>
			{#each finishRows as row (row.field)}
				{@const rawValue = currentGrade.finish[row.field]}
				<div>
					<div class="mb-1 flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<span class="text-[10px] font-medium text-foreground">{row.label}</span>
						</div>
						<span class="text-[10px] text-muted-foreground tabular-nums"
							>{Math.round(rawValue)}%</span
						>
					</div>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={rawValue}
						oninput={(event) => handleFinishSlider(row.field, event)}
						class="h-1 w-full cursor-pointer accent-primary"
						aria-label={`${row.label} strength`}
						title={row.hint}
					/>
					<div class="mt-0.5 flex justify-between">
						<span class="text-[8px] text-muted-foreground/70">{row.hint}</span>
					</div>
				</div>
			{/each}
		</div>
	{:else if activeTab === 'lut'}
		<div class="space-y-1">
			<button
				class={cn(
					'flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors',
					currentGrade.lutId === null && currentGrade.customLut === null
						? 'bg-secondary'
						: 'hover:bg-secondary/60'
				)}
				onclick={() => selectLut(null)}
			>
				<span class="size-6 shrink-0 rounded-sm bg-muted"></span>
				<span class="flex-1 text-[10px] font-medium text-foreground">None</span>
				{#if currentGrade.lutId === null && currentGrade.customLut === null}
					<Check class="size-3 text-primary" />
				{/if}
			</button>
			{#each LUT_PRESETS as lut (lut.id)}
				<button
					class={cn(
						'group relative flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors',
						currentGrade.lutId === lut.id ? 'bg-secondary' : 'hover:bg-secondary/60'
					)}
					onmouseenter={(event) => {
						const canvas = event.currentTarget.querySelector('canvas');
						if (canvas instanceof HTMLCanvasElement) onLutPreview?.(lut.id, canvas);
					}}
					onclick={() => selectLut(lut.id)}
				>
					<canvas
						class="size-10 shrink-0 rounded-sm bg-muted"
						aria-label={`${lut.name} LUT preview`}
					></canvas>
					<span class="flex-1 text-[10px] font-medium text-foreground">{lut.name}</span>
					{#if currentGrade.lutId === lut.id}<Check class="size-3 text-primary" />{/if}
				</button>
			{/each}

			{#if onAutoLevels}
				<Button
					variant="outline"
					size="sm"
					class="mt-2 w-full"
					onclick={onAutoLevels}
					disabled={autoLeveling}
				>
					<Wand2 class="size-3.5" />
					{autoLeveling ? 'Analyzing frame…' : 'Auto-levels'}
				</Button>
			{/if}

			<div class="flex items-center gap-2 pt-2">
				<div class="h-px flex-1 bg-border"></div>
				<span class="text-[9px] text-muted-foreground">Import .cube</span>
				<div class="h-px flex-1 bg-border"></div>
			</div>

			<button
				class="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-left transition-colors hover:bg-secondary/40"
				onclick={() => lutFileInput?.click()}
			>
				<Upload class="size-3.5 text-muted-foreground" />
				<span class="flex-1 text-[10px] font-medium text-foreground">Load LUT file…</span>
			</button>
			<input
				bind:this={lutFileInput}
				type="file"
				accept=".cube,application/octet-stream"
				class="hidden"
				onchange={handleLutFile}
			/>

			{#if customLuts.length > 0}
				{#each customLuts as lut (lut.id)}
					<div
						class={cn(
							'flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5',
							currentGrade.customLut?.id === lut.id ? 'bg-secondary' : ''
						)}
					>
						<button
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
							onclick={() => selectLut(lut.id)}
						>
							<span class="size-6 shrink-0 rounded-sm bg-[linear-gradient(135deg,#ff6a00,#00b3ff)]"
							></span>
							<span class="min-w-0 flex-1 truncate text-[10px] font-medium text-foreground">
								{lut.name}
							</span>
							{#if currentGrade.customLut?.id === lut.id}
								<Check class="size-3 shrink-0 text-primary" />
							{/if}
						</button>
						<button
							class="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-destructive"
							onclick={() => handleRemoveCustomLut(lut.id)}
							aria-label={`Remove LUT ${lut.name}`}
							title={`Remove ${lut.name}`}
						>
							<Trash2 class="size-3" />
						</button>
					</div>
				{/each}
			{/if}
			{#if customLuts.length > 0}
				<p class="text-[9px] text-muted-foreground">
					Imported LUTs are stored inside the project and available to all clips.
				</p>
			{/if}
		</div>
	{:else}
		<div class="space-y-2">
			<div class="flex items-center justify-between">
				<span class="text-[10px] font-medium text-foreground">Secondary correction</span>
				<Switch.Root
					size="sm"
					checked={secondary.enabled}
					onCheckedChange={toggleSecondary}
					aria-label="Toggle secondary correction"
				/>
			</div>
			{#if secondary.enabled}
				<p class="text-[9px] text-muted-foreground">
					Select a color range with the qualifier, then correct only those pixels.
				</p>

				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<span class="text-[9px] text-muted-foreground">Hue</span>
						<span class="text-[9px] text-muted-foreground tabular-nums">
							{Math.round(secondary.hue)}° ± {Math.round(secondary.hueRange)}°
						</span>
					</div>
					<canvas
						bind:this={hueStripCanvas}
						class="h-4 w-full cursor-pointer rounded-sm"
						style="touch-action: none"
						onclick={(event) => {
							const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
							if (rect.width <= 0) return;
							updateSecondary((current) => ({
								...current,
								hue: clampSecondaryHue(((event.clientX - rect.left) / rect.width) * 360)
							}));
						}}
						aria-label="Secondary hue selection"
					></canvas>
					<input
						type="range"
						min="1"
						max="180"
						step="1"
						value={secondary.hueRange}
						oninput={(event) => handleSecondarySlider('hueRange', event, clampSecondaryRange)}
						class="h-1 w-full cursor-pointer accent-primary"
						aria-label="Secondary hue range"
					/>
				</div>

				{@const sliderRows = [
					{ field: 'satCenter', label: 'Sat center', min: 0, max: 100 },
					{ field: 'satRange', label: 'Sat range', min: 1, max: 100 },
					{ field: 'lumaCenter', label: 'Luma center', min: 0, max: 100 },
					{ field: 'lumaRange', label: 'Luma range', min: 1, max: 100 },
					{ field: 'lumaWeight', label: 'Luma weight', min: 0, max: 100 },
					{ field: 'softness', label: 'Softness', min: 0, max: 100 }
				] as { field: keyof SecondaryCorrection; label: string; min: number; max: number }[]}
				{#each sliderRows as row (row.field)}
					{@const rawValue = secondary[row.field] as number}
					<div>
						<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
							<span>{row.label}</span>
							<span class="tabular-nums">{Math.round(rawValue)}</span>
						</div>
						<input
							type="range"
							min={row.min}
							max={row.max}
							step="1"
							value={rawValue}
							oninput={(event) => handleSecondarySlider(row.field, event, clampSecondaryPercent)}
							class="h-1 w-full cursor-pointer accent-primary"
							aria-label={row.label}
						/>
					</div>
				{/each}

				<div class="my-1 flex items-center gap-2">
					<div class="h-px flex-1 bg-border"></div>
					<span class="text-[9px] text-muted-foreground">Correction</span>
					<div class="h-px flex-1 bg-border"></div>
				</div>

				{@const correctionRows = [
					{ field: 'hueShift', label: 'Hue shift', min: -180, max: 180 },
					{ field: 'saturation', label: 'Saturation', min: -100, max: 100 },
					{ field: 'brightness', label: 'Brightness', min: -100, max: 100 },
					{ field: 'contrast', label: 'Contrast', min: -100, max: 100 },
					{ field: 'amount', label: 'Amount', min: 0, max: 100 }
				] as { field: keyof SecondaryCorrection; label: string; min: number; max: number }[]}
				{#each correctionRows as row (row.field)}
					{@const rawValue = secondary[row.field] as number}
					<div>
						<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
							<span>{row.label}</span>
							<span class="tabular-nums">
								{rawValue > 0 && row.min < 0 ? '+' : ''}{Math.round(rawValue)}
							</span>
						</div>
						<input
							type="range"
							min={row.min}
							max={row.max}
							step="1"
							value={rawValue}
							oninput={(event) =>
								handleSecondarySlider(
									row.field,
									event,
									row.field === 'hueShift'
										? clampWheelHue
										: row.field === 'saturation' ||
											  row.field === 'brightness' ||
											  row.field === 'contrast'
											? clampWheelSaturation
											: clampSecondaryPercent
								)}
							class="h-1 w-full cursor-pointer accent-primary"
							aria-label={row.label}
						/>
					</div>
				{/each}

				<div class="my-1 flex items-center gap-2">
					<div class="h-px flex-1 bg-border"></div>
					<span class="text-[9px] text-muted-foreground">Power window</span>
					<div class="h-px flex-1 bg-border"></div>
				</div>

				<div class="flex items-center justify-between gap-1.5">
					<span class="text-[10px] text-muted-foreground">Type</span>
					<div class="flex gap-0.5">
						{#each ['full', 'ellipse', 'rect'] as type (type)}
							<button
								class={cn(
									'rounded-sm px-2 py-0.5 text-[9px] font-medium capitalize transition-colors',
									windowType === type
										? 'bg-secondary text-foreground'
										: 'text-muted-foreground hover:text-foreground'
								)}
								onclick={() => handleWindowTypeChange(type)}
							>
								{type}
							</button>
						{/each}
					</div>
				</div>

				{#if windowType !== 'full'}
					{@const windowRows = [
						{ field: 'cx', label: 'Center X', min: 0, max: 100 },
						{ field: 'cy', label: 'Center Y', min: 0, max: 100 },
						{ field: 'width', label: 'Width', min: 5, max: 100 },
						{ field: 'height', label: 'Height', min: 5, max: 100 },
						{ field: 'feather', label: 'Feather', min: 0, max: 100 }
					] as { field: keyof SecondaryPowerWindow; label: string; min: number; max: number }[]}
					{#each windowRows as row (row.field)}
						{@const rawValue = secondary.window[row.field] as number}
						<div>
							<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
								<span>{row.label}</span>
								<span class="tabular-nums">{Math.round(rawValue)}</span>
							</div>
							<input
								type="range"
								min={row.min}
								max={row.max}
								step="1"
								value={rawValue}
								oninput={(event) => handleWindowChange(row.field, event, clampSecondaryPercent)}
								class="h-1 w-full cursor-pointer accent-primary"
								aria-label={`Power window ${row.label}`}
							/>
						</div>
					{/each}
				{/if}

				<Button
					variant="ghost"
					size="icon-xs"
					class="size-5 shrink-0 text-muted-foreground"
					onclick={resetSecondary}
					aria-label="Reset secondary correction"
					title="Reset secondary correction"
				>
					<RotateCcw class="size-3" />
					<span class="ml-1 text-[10px]">Reset</span>
				</Button>
			{/if}
		</div>
	{/if}
</section>

{#if matchSources.length > 0 && onMatchColor}
	<Dialog.Root bind:open={matchDialogOpen}>
		<Dialog.Content class="sm:max-w-xs">
			<Dialog.Header>
				<Dialog.Title>Match color</Dialog.Title>
				<Dialog.Description>
					Pick a clip whose color you want this clip to match. The current frame of this clip is
					compared against the reference clip.
				</Dialog.Description>
			</Dialog.Header>
			<div class="max-h-64 space-y-1 overflow-y-auto">
				{#each matchSources as source (source.id)}
					<button
						class="w-full rounded-md border border-border px-2 py-1.5 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-secondary/60 disabled:opacity-50"
						disabled={matching}
						onclick={() => handleMatchSelect(source.id)}
					>
						{source.name}
					</button>
				{/each}
			</div>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (matchDialogOpen = false)}>Cancel</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
