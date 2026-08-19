<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		parseCaptionFile,
		serializeCaptionSegments,
		type CaptionFileFormat,
		type CaptionSegment
	} from '$lib/editor/captions';
	import { ChevronDown, ChevronUp, Plus, Trash2, Upload, X } from '@lucide/svelte';

	type Props = {
		open?: boolean;
		segments?: CaptionSegment[];
		onChange?: (segments: CaptionSegment[]) => void;
		onSeek?: (time: number) => void;
	};

	let {
		open = $bindable(true),
		segments = [],
		onChange = () => {},
		onSeek = () => {}
	}: Props = $props();
	let fileInput = $state<HTMLInputElement | null>(null);
	let error = $state<string | null>(null);

	function updateSegment(index: number, update: Partial<CaptionSegment>) {
		const next = segments.map((segment, segmentIndex) =>
			segmentIndex === index
				? {
						...segment,
						...update,
						startTime: Math.max(0, Number(update.startTime ?? segment.startTime) || 0),
						duration: Math.max(1 / 30, Number(update.duration ?? segment.duration) || 0.1)
					}
				: segment
		);
		onChange(next);
	}

	function addSegment() {
		const last = segments.at(-1);
		const startTime = last ? last.startTime + last.duration : 0;
		onChange([...segments, { text: 'New caption', startTime, duration: 2 }]);
	}

	function removeSegment(index: number) {
		onChange(segments.filter((_, segmentIndex) => segmentIndex !== index));
	}

	function handleImport(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		void file.text().then((content) => {
			const imported = parseCaptionFile(content);
			if (imported.length === 0) {
				error = 'No valid SRT/VTT cues found';
				return;
			}
			error = null;
			onChange(imported);
		});
	}

	function exportFile(format: CaptionFileFormat) {
		if (segments.length === 0) return;
		const blob = new Blob([serializeCaptionSegments(segments, format)], {
			type: format === 'srt' ? 'application/x-subrip' : 'text/vtt'
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `captions.${format}`;
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<section
	class="flex shrink-0 flex-col border-t border-sidebar-border bg-sidebar"
	class:h-56={open}
	class:h-9={!open}
>
	<div class="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
		<button
			class="flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-sidebar-foreground uppercase"
			onclick={() => (open = !open)}
			aria-expanded={open}
		>
			{#if open}<ChevronDown class="size-3.5" />{:else}<ChevronUp class="size-3.5" />{/if}
			Caption editor
		</button>
		<span class="text-[10px] text-muted-foreground">{segments.length} cues</span>
		<div class="ml-auto flex items-center gap-1">
			{#if open}
			<input
				bind:this={fileInput}
				type="file"
				accept=".srt,.vtt,text/vtt,application/x-subrip"
				class="hidden"
				onchange={handleImport}
			/>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => fileInput?.click()}
				aria-label="Import captions"><Upload class="size-3.5" /></Button
			>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => exportFile('srt')}
				disabled={segments.length === 0}
				aria-label="Export SRT">SRT</Button
			>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => exportFile('vtt')}
				disabled={segments.length === 0}
				aria-label="Export VTT">VTT</Button
			>
			<Button variant="ghost" size="icon-xs" onclick={addSegment} aria-label="Add caption"
				><Plus class="size-3.5" /></Button
			>
			<Button
				variant="ghost"
				size="icon-xs"
				onclick={() => (open = false)}
				aria-label="Close caption editor"><X class="size-3.5" /></Button
			>
			{/if}
		</div>
	</div>
	{#if open}
		{#if error}<div class="px-3 py-1 text-[10px] text-destructive">{error}</div>{/if}
		<div class="min-h-0 flex-1 overflow-auto">
		{#if segments.length === 0}
			<div
				class="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground"
			>
				Generate or import captions to edit them here.
			</div>
		{:else}
			<div class="min-w-[560px] divide-y divide-border/60">
				<div
					class="grid grid-cols-[2rem_minmax(12rem,1fr)_6rem_6rem_2rem] gap-2 px-3 py-1 text-[9px] font-semibold tracking-wide text-muted-foreground uppercase"
				>
					<span>#</span><span>Text</span><span>Start (s)</span><span>Duration (s)</span><span
					></span>
				</div>
				{#each segments as segment, index (index)}
					<div
						class="grid grid-cols-[2rem_minmax(12rem,1fr)_6rem_6rem_2rem] items-center gap-2 px-3 py-1"
					>
						<button
							class="text-left text-[10px] text-muted-foreground tabular-nums hover:text-foreground"
							onclick={() => onSeek(segment.startTime)}>{index + 1}</button
						>
						<Textarea
							value={segment.text}
							rows={1}
							class="min-h-7 resize-none bg-background py-1 text-[11px]"
							oninput={(event) => updateSegment(index, { text: event.currentTarget.value })}
						/>
						<Input
							type="number"
							min="0"
							step="0.033"
							value={segment.startTime}
							class="h-7 bg-background text-[11px] tabular-nums"
							onchange={(event) =>
								updateSegment(index, { startTime: Number(event.currentTarget.value) })}
						/>
						<Input
							type="number"
							min="0.033"
							step="0.033"
							value={segment.duration}
							class="h-7 bg-background text-[11px] tabular-nums"
							onchange={(event) =>
								updateSegment(index, { duration: Number(event.currentTarget.value) })}
						/>
						<Button
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-destructive"
							onclick={() => removeSegment(index)}
							aria-label={`Delete caption ${index + 1}`}><Trash2 class="size-3.5" /></Button
						>
					</div>
				{/each}
			</div>
		{/if}
		</div>
	{/if}
</section>
