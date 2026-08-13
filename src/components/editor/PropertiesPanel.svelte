<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Switch from '$lib/components/ui/switch';
	import {
		BLEND_MODES,
		CLIP_SPEED_OPTIONS,
		DEFAULT_COLOR_ADJUST,
		getClipChromaKeyState,
		getClipKeyframeTimes,
		getClipSpeedAt,
		getClipVisualState,
		KEYFRAME_PROPERTIES,
		roundToFrame,
		type BlendMode,
		type Clip,
		type ClipMask,
		type ChromaKey,
		type ColorAdjust,
		type KeyframeProperty
	} from '$lib/editor/timeline';
	import {
		clampChromaSimilarity,
		clampChromaSmoothness,
		clampChromaSpill,
		DEFAULT_CHROMA_KEY,
		isChromaKeyActive
	} from '$lib/chroma';
	import { cloneColorGrade, DEFAULT_COLOR_GRADE, type ColorGrade } from '$lib/grading';
	import {
		clampDuckAmountDb,
		DUCKING_DEFAULT_DB,
		DUCKING_MAX_DB,
		DUCKING_MIN_DB,
		getDuckAmountDb,
		isDuckSource
	} from '$lib/audio/ducking';
	import { sound } from '$lib/sound';
	import { cn } from '$lib/utils';
	import {
		Gauge,
		Volume2,
		Mic,
		Droplet,
		Palette,
		Wand2,
		Diamond,
		Trash2,
		GripHorizontal,
		FlipHorizontal2
	} from '@lucide/svelte';
	import GradingPanel from './GradingPanel.svelte';

	type Props = {
		clip: Clip | null;
		isAudioClip?: boolean;
		clipTime: number;
		onPropertyChange: (clipId: string, updater: (clip: Clip) => Clip) => void;
		onToggleReverse?: (clipId: string) => void;
		onAddKeyframe: (
			clipId: string,
			property: KeyframeProperty,
			value: number,
			time?: number
		) => void;
		onAddKeyframes: (clipId: string, properties: KeyframeProperty[], time: number) => void;
		onRemoveKeyframesAtTime: (clipId: string, time: number) => void;
		matchSources?: { id: string; name: string }[];
		onMatchColor?: (sourceClipId: string) => void;
		matching?: boolean;
	};

	let {
		clip,
		isAudioClip = false,
		clipTime,
		onPropertyChange,
		onToggleReverse = () => {},
		onAddKeyframe,
		onAddKeyframes,
		onRemoveKeyframesAtTime,
		matchSources = [],
		onMatchColor,
		matching = false
	}: Props = $props();

	const MAX_FADE_DURATION = 5;

	function hasUnifiedKeyframes(): boolean {
		return Boolean(clip?.keyframes?.length);
	}

	function updateNumericProperty(
		property: KeyframeProperty,
		value: number,
		updateClip: (currentClip: Clip, safeValue: number) => Clip
	) {
		if (!clip || !Number.isFinite(value)) return;
		if (hasUnifiedKeyframes()) {
			onAddKeyframe(clip.id, property, value, clipTime);
			return;
		}
		onPropertyChange(clip.id, (currentClip) => updateClip(currentClip, value));
	}

	function handleReverseToggle() {
		if (!clip) return;
		sound.select();
		onToggleReverse(clip.id);
	}

	function handleSpeedChange(value: string) {
		if (!clip) return;
		const speed = Number(value);
		if (!CLIP_SPEED_OPTIONS.some((s) => s === speed)) return;
		sound.select();
		if (hasUnifiedKeyframes()) {
			onAddKeyframe(clip.id, 'speed', speed, clipTime);
			return;
		}
		onPropertyChange(clip.id, (c) => ({ ...c, speed }));
	}

	function handleVolumeChange(event: Event) {
		const volume = Number((event.currentTarget as HTMLInputElement).value);
		updateNumericProperty('volume', volume, (currentClip, safeVolume) => ({
			...currentClip,
			volume: safeVolume
		}));
	}

	function handleFadeInChange(event: Event) {
		const audioFadeIn = Number((event.currentTarget as HTMLInputElement).value);
		updateNumericProperty('audioFadeIn', audioFadeIn, (currentClip, safeFadeIn) => ({
			...currentClip,
			audioFadeIn: safeFadeIn
		}));
	}

	function handleFadeOutChange(event: Event) {
		const audioFadeOut = Number((event.currentTarget as HTMLInputElement).value);
		updateNumericProperty('audioFadeOut', audioFadeOut, (currentClip, safeFadeOut) => ({
			...currentClip,
			audioFadeOut: safeFadeOut
		}));
	}

	function handleDuckSourceToggle() {
		if (!clip) return;
		const nextDuckSource = !isDuckSource(clip);
		if (nextDuckSource) sound.toggleOn();
		if (!nextDuckSource) sound.toggleOff();
		onPropertyChange(clip.id, (currentClip) => ({
			...currentClip,
			duckSource: nextDuckSource,
			duckAmountDb: nextDuckSource
				? clampDuckAmountDb(currentClip.duckAmountDb ?? DUCKING_DEFAULT_DB)
				: currentClip.duckAmountDb
		}));
	}

	function handleDuckAmountChange(event: Event) {
		if (!clip) return;
		const duckAmountDb = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(duckAmountDb)) return;
		sound.select();
		onPropertyChange(clip.id, (currentClip) => ({
			...currentClip,
			duckSource: true,
			duckAmountDb: clampDuckAmountDb(duckAmountDb)
		}));
	}

	function handleOpacityChange(event: Event) {
		const opacity = Number((event.currentTarget as HTMLInputElement).value);
		updateNumericProperty('opacity', opacity * 100, (currentClip, safeOpacity) => ({
			...currentClip,
			opacity: safeOpacity / 100
		}));
	}

	function handleVisualChange(property: 'x' | 'y' | 'scale' | 'rotation', event: Event) {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		updateNumericProperty(property, value, (currentClip, safeValue) => ({
			...currentClip,
			visualTransform: {
				x: currentClip.visualTransform?.x ?? 50,
				y: currentClip.visualTransform?.y ?? 50,
				scale: currentClip.visualTransform?.scale ?? 1,
				rotation: currentClip.visualTransform?.rotation ?? 0,
				blendMode: currentClip.visualTransform?.blendMode ?? 'normal',
				mask: currentClip.visualTransform?.mask,
				[property]: safeValue
			}
		}));
	}

	function handleBlendModeChange(value: string) {
		if (!clip || !(BLEND_MODES as string[]).includes(value)) return;
		sound.select();
		onPropertyChange(clip.id, (currentClip) => ({
			...currentClip,
			visualTransform: {
				x: currentClip.visualTransform?.x ?? 50,
				y: currentClip.visualTransform?.y ?? 50,
				scale: currentClip.visualTransform?.scale ?? 1,
				rotation: currentClip.visualTransform?.rotation ?? 0,
				blendMode: value as BlendMode,
				mask: currentClip.visualTransform?.mask
			}
		}));
	}

	function handleMaskTypeChange(value: string) {
		if (!clip) return;
		sound.select();
		onPropertyChange(clip.id, (currentClip) => {
			let mask: ClipMask | undefined;
			if (value === 'rect') {
				mask = { type: 'rect', x: 25, y: 25, width: 50, height: 50 };
			} else if (value === 'ellipse') {
				mask = { type: 'ellipse', cx: 50, cy: 50, rx: 50, ry: 50 };
			} else if (value === 'polygon') {
				mask = {
					type: 'polygon',
					points: [
						{ x: 50, y: 5 },
						{ x: 95, y: 50 },
						{ x: 50, y: 95 },
						{ x: 5, y: 50 }
					]
				};
			}
			return {
				...currentClip,
				visualTransform: {
					x: currentClip.visualTransform?.x ?? 50,
					y: currentClip.visualTransform?.y ?? 50,
					scale: currentClip.visualTransform?.scale ?? 1,
					rotation: currentClip.visualTransform?.rotation ?? 0,
					blendMode: currentClip.visualTransform?.blendMode ?? 'normal',
					mask
				}
			};
		});
	}

	function handleMaskRemove() {
		if (!clip) return;
		sound.delete();
		onPropertyChange(clip.id, (currentClip) => {
			if (!currentClip.visualTransform?.mask) return currentClip;
			return {
				...currentClip,
				visualTransform: {
					...currentClip.visualTransform,
					mask: undefined
				}
			};
		});
	}

	function handleColorAdjustChange(key: keyof ColorAdjust, event: Event) {
		if (!clip) return;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		if (hasUnifiedKeyframes()) {
			onAddKeyframe(clip.id, key, value, clipTime);
			return;
		}
		onPropertyChange(clip.id, (c) => ({
			...c,
			colorAdjust: { ...(c.colorAdjust ?? DEFAULT_COLOR_ADJUST), [key]: value }
		}));
	}

	function resetColorAdjust() {
		if (!clip) return;
		sound.select();
		const properties: (keyof ColorAdjust)[] = ['brightness', 'contrast', 'saturation', 'hue'];
		if (hasUnifiedKeyframes()) {
			for (const property of properties) {
				onAddKeyframe(clip.id, property, DEFAULT_COLOR_ADJUST[property], clipTime);
			}
			return;
		}
		onPropertyChange(clip.id, (c) => ({ ...c, colorAdjust: { ...DEFAULT_COLOR_ADJUST } }));
	}

	function handleGradeChange(updater: (grade: ColorGrade) => ColorGrade) {
		if (!clip) return;
		onPropertyChange(clip.id, (c) => ({
			...c,
			colorGrade: updater(c.colorGrade ?? cloneColorGrade(DEFAULT_COLOR_GRADE))
		}));
	}

	function updateChromaKey(updater: (current: ChromaKey) => ChromaKey) {
		if (!clip) return;
		onPropertyChange(clip.id, (c) => ({
			...c,
			chromaKey: updater(c.chromaKey ? { ...c.chromaKey } : { ...DEFAULT_CHROMA_KEY })
		}));
	}

	function handleChromaKeyToggle() {
		if (!clip) return;
		const nextEnabled = !isChromaKeyActive(clip.chromaKey);
		if (nextEnabled) sound.toggleOn();
		if (!nextEnabled) sound.toggleOff();
		updateChromaKey((current) => ({ ...current, enabled: nextEnabled }));
	}

	function handleChromaKeyColorChange(event: Event) {
		const value = (event.currentTarget as HTMLInputElement).value;
		if (!/^#[0-9a-f]{6}$/i.test(value)) return;
		sound.select();
		updateChromaKey((current) => ({ ...current, keyColor: value.toLowerCase(), enabled: true }));
	}

	function handleChromaSliderChange(
		key: 'similarity' | 'smoothness' | 'spillSuppression',
		event: Event
	) {
		if (!clip) return;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		if (key === 'spillSuppression' && hasUnifiedKeyframes()) {
			onAddKeyframe(clip.id, 'spill', value, clipTime);
			return;
		}
		const clamp =
			key === 'similarity'
				? clampChromaSimilarity
				: key === 'smoothness'
					? clampChromaSmoothness
					: clampChromaSpill;
		updateChromaKey((current) => ({ ...current, [key]: clamp(value), enabled: true }));
	}

	function handleResetChromaKey() {
		if (!clip) return;
		sound.select();
		onPropertyChange(clip.id, (c) => {
			if (!c.chromaKey) return c;
			const nextClip = { ...c };
			delete nextClip.chromaKey;
			return nextClip;
		});
	}

	function handleAddKeyframe() {
		if (!clip) return;
		sound.select();
		onAddKeyframes(clip.id, [...KEYFRAME_PROPERTIES], clipTime);
	}

	function hasKeyframeAtCurrentTime(): boolean {
		const frameTime = roundToFrame(clipTime);
		return keyframeTimes.some((time) => roundToFrame(time) === frameTime);
	}

	function handleRemoveKeyframe(time: number) {
		if (!clip) return;
		sound.delete();
		onRemoveKeyframesAtTime(clip.id, time);
	}

	const currentSpeed = $derived(clip ? getClipSpeedAt(clip, clipTime) : 1);
	const currentVisualState = $derived(
		clip
			? getClipVisualState(clip, clipTime)
			: {
					transform: { x: 50, y: 50, scale: 1, rotation: 0, blendMode: 'normal' as BlendMode },
					opacity: 1,
					volume: 1,
					audioFadeIn: 0,
					audioFadeOut: 0,
					colorAdjust: DEFAULT_COLOR_ADJUST
				}
	);
	const currentVolume = $derived(currentVisualState.volume);
	const currentFadeIn = $derived(currentVisualState.audioFadeIn);
	const currentFadeOut = $derived(currentVisualState.audioFadeOut);
	const currentDuckAmountDb = $derived(clip ? getDuckAmountDb(clip) : DUCKING_DEFAULT_DB);
	const currentVisualTransform = $derived(currentVisualState.transform);
	const currentOpacity = $derived(currentVisualState.opacity);
	const currentColorAdjust = $derived(currentVisualState.colorAdjust);
	const keyframeTimes = $derived(clip ? getClipKeyframeTimes(clip) : []);
	const currentBlendMode = $derived(currentVisualTransform.blendMode);
	const currentMask = $derived(currentVisualTransform.mask);
	const hasMediaAsset = $derived(Boolean(clip?.assetId));
	const allowLut = $derived(Boolean(clip && !clip.textStyle && !clip.sticker));
	const chromaEnabled = $derived(isChromaKeyActive(clip?.chromaKey));
	const chromaState = $derived(
		clip && chromaEnabled ? getClipChromaKeyState(clip, clipTime) : null
	);
	const chromaSliderRows: {
		key: 'similarity' | 'smoothness' | 'spillSuppression';
		label: string;
	}[] = [
		{ key: 'similarity', label: 'Similarity' },
		{ key: 'smoothness', label: 'Smoothness' },
		{ key: 'spillSuppression', label: 'Spill Suppression' }
	];
</script>

{#if clip}
	<div class="flex h-full flex-col overflow-y-auto">
		<!-- clip header -->
		<div class="border-b border-border px-3 py-2.5">
			<div class="truncate text-xs font-semibold text-foreground">{clip.name}</div>
			<div class="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
				{clip.duration.toFixed(1)}s
				{#if clip.groupId}
					<span class="ml-1.5 text-primary">- Grouped</span>
				{/if}
			</div>
		</div>

		<div class="space-y-4 px-3 py-3">
			<!-- speed control -->
			<section>
				<div class="mb-1.5 flex items-center gap-1.5">
					<Gauge class="size-3.5 text-muted-foreground" />
					<span class="text-[11px] font-semibold text-foreground">Speed</span>
				</div>
				<Select.Root type="single" value={String(currentSpeed)} onValueChange={handleSpeedChange}>
					<Select.Trigger size="sm" class="h-7 w-full text-xs">
						<span>{currentSpeed}x</span>
					</Select.Trigger>
					<Select.Content>
						{#each CLIP_SPEED_OPTIONS as speed (speed)}
							<Select.Item value={String(speed)} label={`${speed}x`} />
						{/each}
					</Select.Content>
				</Select.Root>
				{#if hasMediaAsset}
					<div class="mt-2 flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<FlipHorizontal2
								class={cn(
									'size-3.5',
									clip.reversed === true ? 'text-primary' : 'text-muted-foreground'
								)}
							/>
							<span class="text-[11px] font-semibold text-foreground">Reverse playback</span>
						</div>
						<Switch.Root
							size="sm"
							checked={clip.reversed === true}
							onCheckedChange={handleReverseToggle}
							aria-label="Toggle reverse playback"
						/>
					</div>
				{/if}
			</section>

			{#if hasMediaAsset}
				<!-- volume control -->
				<section>
					<div class="mb-1.5 flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<Volume2 class="size-3.5 text-muted-foreground" />
							<span class="text-[11px] font-semibold text-foreground">Volume</span>
						</div>
						<span class="text-[10px] text-muted-foreground tabular-nums">
							{Math.round(currentVolume * 100)}%
						</span>
					</div>
					<input
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={currentVolume}
						oninput={handleVolumeChange}
						class="h-1 w-full cursor-pointer accent-primary"
					/>
				</section>

				<!-- audio fade -->
				<section>
					<div class="mb-1.5 flex items-center gap-1.5">
						<span class="text-[11px] font-semibold text-foreground">Audio Fade</span>
					</div>
					<div class="space-y-2">
						<div>
							<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
								<span>Fade In</span>
								<span class="tabular-nums">{currentFadeIn.toFixed(1)}s</span>
							</div>
							<input
								type="range"
								min="0"
								max={MAX_FADE_DURATION}
								step="0.1"
								value={currentFadeIn}
								oninput={handleFadeInChange}
								class="h-1 w-full cursor-pointer accent-primary"
							/>
						</div>
						<div>
							<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
								<span>Fade Out</span>
								<span class="tabular-nums">{currentFadeOut.toFixed(1)}s</span>
							</div>
							<input
								type="range"
								min="0"
								max={MAX_FADE_DURATION}
								step="0.1"
								value={currentFadeOut}
								oninput={handleFadeOutChange}
								class="h-1 w-full cursor-pointer accent-primary"
							/>
						</div>
					</div>
				</section>

				<!-- auto-ducking -->
				<section>
					<div class="mb-1.5 flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<Mic
								class={cn(
									'size-3.5',
									isDuckSource(clip) ? 'text-primary' : 'text-muted-foreground'
								)}
							/>
							<span class="text-[11px] font-semibold text-foreground">Auto-ducking</span>
						</div>
						<Switch.Root
							size="sm"
							checked={isDuckSource(clip)}
							onCheckedChange={handleDuckSourceToggle}
							aria-label="Toggle auto-ducking"
						/>
					</div>
					{#if isDuckSource(clip)}
						<div>
							<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
								<span>Duck amount</span>
								<span class="tabular-nums">{currentDuckAmountDb.toFixed(1)} dB</span>
							</div>
							<input
								type="range"
								min={DUCKING_MIN_DB}
								max={DUCKING_MAX_DB}
								step="0.5"
								value={currentDuckAmountDb}
								oninput={handleDuckAmountChange}
								class="h-1 w-full cursor-pointer accent-primary"
							/>
						</div>
					{/if}
				</section>
			{/if}

			<section>
				<div class="mb-1.5 flex items-center gap-1.5">
					<span class="text-[11px] font-semibold text-foreground">Transform</span>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<label class="space-y-1 text-[10px] text-muted-foreground">
						<span>Position X</span>
						<input
							type="number"
							min="-50"
							max="150"
							step="0.1"
							value={currentVisualTransform.x}
							oninput={(event) => handleVisualChange('x', event)}
							class="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground tabular-nums"
						/>
					</label>
					<label class="space-y-1 text-[10px] text-muted-foreground">
						<span>Position Y</span>
						<input
							type="number"
							min="-50"
							max="150"
							step="0.1"
							value={currentVisualTransform.y}
							oninput={(event) => handleVisualChange('y', event)}
							class="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground tabular-nums"
						/>
					</label>
					<label class="col-span-2 space-y-1 text-[10px] text-muted-foreground">
						<span>Scale</span>
						<input
							type="number"
							min="0.1"
							max="4"
							step="0.01"
							value={currentVisualTransform.scale}
							oninput={(event) => handleVisualChange('scale', event)}
							class="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground tabular-nums"
						/>
					</label>
					<label class="col-span-2 space-y-1 text-[10px] text-muted-foreground">
						<span>Rotation (°)</span>
						<input
							type="number"
							min="-360"
							max="360"
							step="1"
							value={currentVisualTransform.rotation}
							oninput={(event) => handleVisualChange('rotation', event)}
							class="h-7 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground tabular-nums"
						/>
					</label>
				</div>

				<div class="mt-2.5 space-y-2">
					<label class="block space-y-1 text-[10px] text-muted-foreground">
						<span>Blend mode</span>
						<Select.Root
							type="single"
							value={currentBlendMode}
							onValueChange={handleBlendModeChange}
						>
							<Select.Trigger size="sm" class="h-7 w-full text-xs">
								<span>{currentBlendMode}</span>
							</Select.Trigger>
							<Select.Content>
								{#each BLEND_MODES as mode (mode)}
									<Select.Item value={mode} label={mode} />
								{/each}
							</Select.Content>
						</Select.Root>
					</label>

					<div>
						<div class="mb-1 flex items-center justify-between">
							<span class="text-[10px] text-muted-foreground">Mask</span>
							{#if currentMask}
								<button
									class="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
									onclick={handleMaskRemove}
								>
									Remove mask
								</button>
							{/if}
						</div>
						<Select.Root
							type="single"
							value={currentMask ? currentMask.type : 'none'}
							onValueChange={handleMaskTypeChange}
						>
							<Select.Trigger size="sm" class="h-7 w-full text-xs">
								<span>{currentMask ? currentMask.type : 'none'}</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="none" label="None" />
								<Select.Item value="rect" label="Rectangle" />
								<Select.Item value="ellipse" label="Ellipse" />
								<Select.Item value="polygon" label="Polygon" />
							</Select.Content>
						</Select.Root>
					</div>
				</div>
			</section>

			<!-- opacity control -->
			<section>
				<div class="mb-1.5 flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<Droplet class="size-3.5 text-muted-foreground" />
						<span class="text-[11px] font-semibold text-foreground">Opacity</span>
					</div>
					<span class="text-[10px] text-muted-foreground tabular-nums">
						{Math.round(currentOpacity * 100)}%
					</span>
				</div>
				<input
					type="range"
					min="0"
					max="1"
					step="0.01"
					value={currentOpacity}
					oninput={handleOpacityChange}
					class="h-1 w-full cursor-pointer accent-primary"
				/>
			</section>

			<!-- color correction -->
			<section>
				<div class="mb-1.5 flex items-center justify-between">
					<div class="flex items-center gap-1.5">
						<Palette class="size-3.5 text-muted-foreground" />
						<span class="text-[11px] font-semibold text-foreground">Color</span>
					</div>
					<button
						class="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
						onclick={resetColorAdjust}
					>
						Reset
					</button>
				</div>
				<div class="space-y-2">
					{#each [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['hue', 'Hue', -180, 180]] as [key, label, min, max] (key)}
						<div>
							<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
								<span>{label}</span>
								<span class="tabular-nums">
									{currentColorAdjust[key as keyof ColorAdjust] > 0 ? '+' : ''}{currentColorAdjust[
										key as keyof ColorAdjust
									]}
								</span>
							</div>
							<input
								type="range"
								{min}
								{max}
								step="1"
								value={currentColorAdjust[key as keyof ColorAdjust]}
								oninput={(e) => handleColorAdjustChange(key as keyof ColorAdjust, e)}
								class="h-1 w-full cursor-pointer accent-primary"
							/>
						</div>
					{/each}
				</div>
			</section>

			<!-- chroma key -->
			{#if hasMediaAsset && !isAudioClip && !clip.textStyle && !clip.sticker}
				<section>
					<div class="mb-1.5 flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<Wand2
								class={cn('size-3.5', chromaEnabled ? 'text-primary' : 'text-muted-foreground')}
							/>
							<span class="text-[11px] font-semibold text-foreground">Chroma Key</span>
						</div>
						<div class="flex items-center gap-1.5">
							{#if clip.chromaKey}
								<button
									class="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
									onclick={handleResetChromaKey}
								>
									Remove
								</button>
							{/if}
							<Switch.Root
								size="sm"
								checked={chromaEnabled}
								onCheckedChange={handleChromaKeyToggle}
								aria-label="Toggle chroma key"
							/>
						</div>
					</div>
					{#if chromaState}
						<div class="space-y-2">
							<div class="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
								<span>Key Color</span>
								<span class="flex items-center gap-1.5">
									<input
										type="color"
										value={chromaState.keyColor}
										onchange={handleChromaKeyColorChange}
										class="size-4 cursor-pointer border-0 bg-transparent p-0"
										aria-label="Chroma key color"
									/>
									<span class="tabular-nums">{chromaState.keyColor.toUpperCase()}</span>
								</span>
							</div>
							{#each chromaSliderRows as row (row.key)}
								{@const rawValue =
									row.key === 'spillSuppression' ? chromaState.spill : chromaState[row.key]}
								<div>
									<div class="mb-1 flex justify-between text-[10px] text-muted-foreground">
										<span>{row.label}</span>
										<span class="tabular-nums">{Math.round(rawValue)}%</span>
									</div>
									<input
										type="range"
										min="0"
										max="100"
										step="1"
										value={rawValue}
										oninput={(event) => handleChromaSliderChange(row.key, event)}
										class="h-1 w-full cursor-pointer accent-primary"
									/>
								</div>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			<!-- color grading -->
			{#if !isAudioClip}
				<GradingPanel
					grade={clip.colorGrade}
					{allowLut}
					onGradeChange={handleGradeChange}
					{matchSources}
					{onMatchColor}
					{matching}
				/>
			{/if}

			<!-- keyframes -->
			<section>
				<div class="mb-1.5 flex items-center justify-between gap-1.5">
					<div class="flex items-center gap-1.5">
						<Diamond class="size-3.5 text-muted-foreground" />
						<span class="text-[11px] font-semibold text-foreground">Keyframes</span>
					</div>
					<Button
						variant="ghost"
						size="icon-xs"
						class="size-5 shrink-0"
						onclick={handleAddKeyframe}
						aria-label={`Set keyframe at ${clipTime.toFixed(2)} seconds`}
						title={`Set keyframe at ${clipTime.toFixed(2)}s`}
					>
						<Diamond class={hasKeyframeAtCurrentTime() ? 'size-3 fill-current' : 'size-3'} />
					</Button>
				</div>
				<div class="space-y-1.5">
					{#each keyframeTimes as time (time)}
						<div class="flex items-center gap-1.5 rounded-sm bg-secondary px-1.5 py-1">
							<GripHorizontal class="size-3 shrink-0 text-muted-foreground" />
							<span class="flex-1 text-[10px] text-muted-foreground tabular-nums">
								{time.toFixed(2)}s
							</span>
							<button
								class="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
								onclick={() => handleRemoveKeyframe(time)}
								aria-label="Remove keyframe"
							>
								<Trash2 class="size-3" />
							</button>
						</div>
					{/each}
				</div>
			</section>
		</div>
	</div>
{:else}
	<div
		class="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"
	>
		<Diamond class="size-6 opacity-30" />
		<span class="text-[11px]">Select a clip to edit its properties</span>
	</div>
{/if}
