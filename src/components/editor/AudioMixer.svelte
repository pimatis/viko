<script lang="ts">
	import type { Track } from '$lib/editor/timeline';
	import { DEFAULT_TRACK_AUDIO_EFFECTS, type TrackAudioEffects } from '$lib/editor/timeline';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import { audioEngine, MASTER_VOLUME_MAX, TRACK_VOLUME_MAX } from '$lib/audio/engine';
	import { RotateCcw, Volume2, VolumeX, X } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import MixerFader from './MixerFader.svelte';

	type Props = {
		tracks: Track[];
		mediaAssets: MediaAsset[];
		masterVolume?: number;
		onMasterVolume?: (volume: number) => void;
		onTrackVolume?: (trackId: string, volume: number) => void;
		onTrackPan?: (trackId: string, pan: number) => void;
		onTrackEffects?: (trackId: string, patch: Partial<TrackAudioEffects>) => void;
		onToggleMute?: (trackId: string) => void;
		onResetTrack?: (trackId: string) => void;
		onResetMaster?: () => void;
		onClose?: () => void;
	};

	let {
		tracks,
		mediaAssets,
		masterVolume = 1,
		onMasterVolume = () => {},
		onTrackVolume = () => {},
		onTrackPan = () => {},
		onTrackEffects = () => {},
		onToggleMute = () => {},
		onResetTrack = () => {},
		onResetMaster = () => {},
		onClose = () => {}
	}: Props = $props();

	const eqBands: {
		key: keyof Pick<TrackAudioEffects, 'eqLow' | 'eqMid' | 'eqHigh'>;
		label: string;
	}[] = [
		{ key: 'eqLow', label: 'L' },
		{ key: 'eqMid', label: 'M' },
		{ key: 'eqHigh', label: 'H' }
	];

	function trackFx(track: Track): TrackAudioEffects {
		return track.effects ?? DEFAULT_TRACK_AUDIO_EFFECTS;
	}

	function formatDb(value: number): string {
		return `${value > 0 ? '+' : ''}${Math.round(value)}dB`;
	}

	function handleEqInput(track: Track, band: (typeof eqBands)[number]['key'], event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		onTrackEffects(track.id, { [band]: value });
	}

	function handleCompInput(
		track: Track,
		field: 'compressorThreshold' | 'compressorRatio',
		event: Event
	): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		onTrackEffects(track.id, { [field]: value });
	}

	function handleReverbInput(track: Track, event: Event): void {
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (!Number.isFinite(value)) return;
		onTrackEffects(track.id, { reverbAmount: value });
	}

	let rootEl = $state<HTMLElement | null>(null);

	// tracks that can carry audio into the mix (mirrors the export collector:
	// linked A/V pairs route their audio through the audio-track clip, so the
	// video track of a pair is not shown as a separate channel)
	function isAudioCapableTrack(track: Track, all: Track[], assets: MediaAsset[]): boolean {
		if (track.type === 'audio') return true;
		if (track.type !== 'video') return false;
		const assetsById = new Map(assets.map((a) => [a.id, a]));
		const audioInstanceIds: string[] = [];
		for (const t of all) {
			if (t.type !== 'audio') continue;
			for (const clip of t.clips) {
				if (clip.sourceInstanceId) audioInstanceIds.push(clip.sourceInstanceId);
			}
		}
		return track.clips.some((clip) => {
			if (!clip.assetId) return false;
			const asset = assetsById.get(clip.assetId);
			if (!asset) return false;
			if (asset.kind !== 'video' && asset.kind !== 'audio') return false;
			if (asset.playbackSupported === false) return false;
			if (clip.sourceInstanceId && audioInstanceIds.includes(clip.sourceInstanceId)) return false;
			return true;
		});
	}

	const audioTracks = $derived(
		tracks.filter((track) => isAudioCapableTrack(track, tracks, mediaAssets))
	);

	function panLabel(pan: number): string {
		if (pan < -0.05) return `${Math.round(pan * 100)}% L`;
		if (pan > 0.05) return `${Math.round(pan * 100)}% R`;
		return 'C';
	}

	let rafId = 0;

	// VU meters: poll the engine analysers once per frame and write the bar
	// heights directly to the DOM so meters stay smooth without re-rendering
	// the panel at 60fps.
	$effect(() => {
		const tick = () => {
			rafId = requestAnimationFrame(tick);
			const root = rootEl;
			if (!root) return;
			const bars = root.querySelectorAll<HTMLElement>('[data-vu]');
			for (const bar of bars) {
				const trackId = bar.dataset.vu;
				const channel = bar.dataset.channel === 'r' ? 'right' : 'left';
				let level = 0;
				if (trackId === '__master__') {
					level = audioEngine.getMasterLevels()?.[channel] ?? 0;
				} else if (trackId) {
					level = audioEngine.getTrackLevels(trackId)?.[channel] ?? 0;
				}
				bar.style.height = level <= 0 ? '0%' : `${Math.max(4, Math.round(level * 100))}%`;
			}
		};
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});
</script>

<div
	data-audio-mixer
	class="flex h-80 shrink-0 flex-col border-t border-border bg-background select-none"
	bind:this={rootEl}
>
	<div class="flex h-8 shrink-0 items-center justify-between border-b border-border bg-card px-3">
		<span class="text-[11px] font-semibold text-foreground">Mixer</span>
		<button
			class="text-muted-foreground transition-colors hover:text-foreground"
			aria-label="Close audio mixer"
			onclick={onClose}
		>
			<X class="size-4" />
		</button>
	</div>

	<div class="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto px-3 py-2">
		{#each audioTracks as track (track.id)}
			<div
				class="flex w-36 shrink-0 flex-col items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1.5"
			>
				<div
					class="w-full shrink-0 truncate text-center text-[11px] leading-tight font-semibold text-foreground"
					title={track.name}
				>
					{track.name}
				</div>

				<div class="flex h-8 shrink-0 items-end gap-1">
					<div class="relative h-full w-1.5 overflow-hidden rounded-sm bg-secondary/70">
						<div
							data-vu={track.id}
							data-channel="l"
							class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500/90"
							style="height: 0%"
						></div>
					</div>
					<div class="relative h-full w-1.5 overflow-hidden rounded-sm bg-secondary/70">
						<div
							data-vu={track.id}
							data-channel="r"
							class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500/90"
							style="height: 0%"
						></div>
					</div>
				</div>

				<span class="shrink-0 text-[9px] text-muted-foreground tabular-nums"
					>{panLabel(track.pan ?? 0)}</span
				>
				<input
					type="range"
					min="-1"
					max="1"
					step="0.01"
					value={track.pan ?? 0}
					aria-label={`${track.name} pan`}
					class="h-1 w-full shrink-0 cursor-pointer accent-primary"
					oninput={(e) => onTrackPan(track.id, Number((e.currentTarget as HTMLInputElement).value))}
				/>

				<MixerFader
					value={track.volume ?? 1}
					min={0}
					max={TRACK_VOLUME_MAX}
					oninput={(v) => onTrackVolume(track.id, v)}
					ariaLabel={`${track.name} volume`}
				/>

				<div
					class="grid w-full shrink-0 grid-cols-3 gap-1"
					role="group"
					aria-label={`${track.name} equalizer`}
				>
					{#each eqBands as band (band.key)}
						<label class="flex flex-col items-center gap-0.5">
							<span
								class="text-[8px] leading-none font-medium tracking-wide text-muted-foreground uppercase tabular-nums"
							>
								{band.label}
								{formatDb(trackFx(track)[band.key])}
							</span>
							<input
								type="range"
								min="-12"
								max="12"
								step="1"
								value={trackFx(track)[band.key]}
								title={`${band.label} EQ ${formatDb(trackFx(track)[band.key])}`}
								aria-label={`${track.name} ${band.label} band EQ`}
								class="h-1 w-full cursor-pointer accent-primary"
								oninput={(e) => handleEqInput(track, band.key, e)}
							/>
						</label>
					{/each}
				</div>

				<div
					class="grid w-full shrink-0 grid-cols-2 gap-1"
					role="group"
					aria-label={`${track.name} compressor`}
				>
					<label class="flex flex-col items-center gap-0.5">
						<span
							class="text-[8px] leading-none font-medium tracking-wide text-muted-foreground uppercase tabular-nums"
						>
							Th {Math.round(trackFx(track).compressorThreshold)}dB
						</span>
						<input
							type="range"
							min="-60"
							max="0"
							step="1"
							value={trackFx(track).compressorThreshold}
							title={`Compressor threshold ${Math.round(trackFx(track).compressorThreshold)} dB`}
							aria-label={`${track.name} compressor threshold`}
							class="h-1 w-full cursor-pointer accent-primary"
							oninput={(e) => handleCompInput(track, 'compressorThreshold', e)}
						/>
					</label>
					<label class="flex flex-col items-center gap-0.5">
						<span
							class="text-[8px] leading-none font-medium tracking-wide text-muted-foreground uppercase tabular-nums"
						>
							Ra {trackFx(track).compressorRatio.toFixed(1)}:1
						</span>
						<input
							type="range"
							min="1"
							max="20"
							step="0.5"
							value={trackFx(track).compressorRatio}
							title={`Compressor ratio ${trackFx(track).compressorRatio}:1`}
							aria-label={`${track.name} compressor ratio`}
							class="h-1 w-full cursor-pointer accent-primary"
							oninput={(e) => handleCompInput(track, 'compressorRatio', e)}
						/>
					</label>
				</div>

				<label class="flex w-full shrink-0 flex-col items-center gap-0.5">
					<span
						class="text-[8px] leading-none font-medium tracking-wide text-muted-foreground uppercase tabular-nums"
					>
						Rev {Math.round(trackFx(track).reverbAmount)}%
					</span>
					<input
						type="range"
						min="0"
						max="100"
						step="1"
						value={trackFx(track).reverbAmount}
						title={`Reverb ${Math.round(trackFx(track).reverbAmount)}%`}
						aria-label={`${track.name} reverb amount`}
						class="h-1 w-full cursor-pointer accent-primary"
						oninput={(e) => handleReverbInput(track, e)}
					/>
				</label>

				<div class="flex w-full shrink-0 items-center justify-between gap-1">
					<div class="flex items-center gap-0.5">
						<button
							class={cn(
								'rounded-sm p-0.5 transition-colors',
								track.muted ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
							)}
							aria-label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
							onclick={() => onToggleMute(track.id)}
						>
							{#if track.muted}
								<VolumeX class="size-3.5" />
							{:else}
								<Volume2 class="size-3.5" />
							{/if}
						</button>
						<button
							class="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
							aria-label={`Reset ${track.name}`}
							title="Reset volume, pan, mute, and effects"
							onclick={() => onResetTrack(track.id)}
						>
							<RotateCcw class="size-3.5" />
						</button>
					</div>
					<span class="text-[9px] text-muted-foreground tabular-nums"
						>{Math.round((track.volume ?? 1) * 100)}%</span
					>
				</div>
			</div>
		{/each}

		{#if audioTracks.length === 0}
			<div class="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
				No audio — add a clip with audio to see mixer channels.
			</div>
		{/if}

		<div
			class="flex w-36 shrink-0 flex-col items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1.5"
		>
			<div
				class="w-full shrink-0 truncate text-center text-[11px] leading-tight font-semibold text-foreground"
			>
				Master
			</div>

			<div class="flex h-8 shrink-0 items-end gap-1">
				<div class="relative h-full w-1.5 overflow-hidden rounded-sm bg-secondary/70">
					<div
						data-vu="__master__"
						data-channel="l"
						class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500/90"
						style="height: 0%"
					></div>
				</div>
				<div class="relative h-full w-1.5 overflow-hidden rounded-sm bg-secondary/70">
					<div
						data-vu="__master__"
						data-channel="r"
						class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-emerald-500 via-yellow-400 to-red-500/90"
						style="height: 0%"
					></div>
				</div>
			</div>

			<span class="text-[9px] text-muted-foreground tabular-nums"
				>{Math.round(masterVolume * 100)}%</span
			>
			<MixerFader
				value={masterVolume}
				min={0}
				max={MASTER_VOLUME_MAX}
				oninput={onMasterVolume}
				ariaLabel="Master volume"
			/>

			<div class="flex w-full shrink-0 items-center justify-between gap-1">
				<button
					class="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
					aria-label="Reset master"
					title="Reset master volume"
					onclick={onResetMaster}
				>
					<RotateCcw class="size-3.5" />
				</button>
				<span class="text-[9px] text-muted-foreground tabular-nums"
					>{Math.round(masterVolume * 100)}%</span
				>
			</div>
		</div>
	</div>
</div>
