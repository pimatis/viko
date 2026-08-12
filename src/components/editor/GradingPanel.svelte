<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import {
		IDENTITY_CURVE,
		LUT_PRESETS,
		clampGradeIntensity,
		clampWheelHue,
		clampWheelSaturation,
		clampWheelStrength,
		cloneColorGrade,
		DEFAULT_COLOR_GRADE,
		getLutPreset,
		isNeutralGrade,
		type ColorCurvePoint,
		type ColorGrade,
		type ColorWheel as ColorWheelGrade,
		type CurveChannel
	} from '$lib/grading';
	import { sound } from '$lib/sound';
	import { cn } from '$lib/utils';
	import { Check, RotateCcw } from '@lucide/svelte';
	import ColorWheel from './ColorWheel.svelte';
	import CurveEditor from './CurveEditor.svelte';

	type Props = {
		grade?: ColorGrade;
		onGradeChange: (updater: (grade: ColorGrade) => ColorGrade) => void;
		allowLut?: boolean;
	};

	let { grade, onGradeChange, allowLut = true }: Props = $props();

	type GradingTab = 'wheels' | 'curves' | 'lut';
	type WheelKey = 'master' | 'shadows' | 'midtones' | 'highlights';

	let activeTab = $state<GradingTab>('wheels');
	let activeCurveChannel = $state<CurveChannel>('master');

	const currentGrade = $derived(grade ?? cloneColorGrade(DEFAULT_COLOR_GRADE));
	const isReset = $derived(grade ? isNeutralGrade(grade) : true);

	const tabs = $derived.by((): { id: GradingTab; label: string }[] => {
		const allTabs: { id: GradingTab; label: string }[] = [
			{ id: 'wheels', label: 'Wheels' },
			{ id: 'curves', label: 'Curves' },
			{ id: 'lut', label: 'LUT' }
		];
		return allowLut ? allTabs : allTabs.filter((tab) => tab.id !== 'lut');
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

	function selectLut(lutId: string | null) {
		sound.select();
		const nextLutId = lutId && getLutPreset(lutId) ? lutId : null;
		onGradeChange((current) => ({ ...current, lutId: nextLutId }));
	}

	function resetGrade() {
		sound.select();
		onGradeChange(() => cloneColorGrade(DEFAULT_COLOR_GRADE));
	}
</script>

<section class="space-y-2.5">
	<div class="flex items-center justify-between">
		<span class="text-[11px] font-semibold text-foreground">Color Grading</span>
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
	{:else}
		<div class="space-y-1">
			<button
				class={cn(
					'flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors',
					currentGrade.lutId === null ? 'bg-secondary' : 'hover:bg-secondary/60'
				)}
				onclick={() => selectLut(null)}
			>
				<span class="size-6 shrink-0 rounded-sm bg-muted"></span>
				<span class="flex-1 text-[10px] font-medium text-foreground">None</span>
				{#if currentGrade.lutId === null}
					<Check class="size-3 text-primary" />
				{/if}
			</button>
			{#each LUT_PRESETS as lut (lut.id)}
				<button
					class={cn(
						'flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-left transition-colors',
						currentGrade.lutId === lut.id ? 'bg-secondary' : 'hover:bg-secondary/60'
					)}
					onclick={() => selectLut(lut.id)}
				>
					<span
						class="size-6 shrink-0 rounded-sm"
						style="background: linear-gradient(135deg, #ff6a00, #00b3ff); filter: {lut.previewFilter}"
					></span>
					<span class="flex-1 text-[10px] font-medium text-foreground">{lut.name}</span>
					{#if currentGrade.lutId === lut.id}
						<Check class="size-3 text-primary" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</section>
