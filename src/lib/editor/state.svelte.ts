import { onMount, onDestroy } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { sound } from '$lib/sound';
import { audioEngine } from '$lib/audio/engine';
import { formatShortcut, type ShortcutBinding } from '$lib/shortcuts';
import { EFFECT_PRESETS, type EffectApplyRequest } from '$lib/effects';
import {
	clearProject,
	createProjectSnapshot,
	disposeRestoredMedia,
	loadMediaBlob,
	loadProject,
	loadVersions,
	restoreMediaAssets,
	saveProject as saveProjectToDb,
	saveVersions,
	type ProjectDocument,
	type ProjectVersion
} from '$lib/db';
import {
	STICKER_PRESETS,
	inspectMediaAsset,
	type EditorResource,
	type MediaAsset,
	type MediaFolder
} from '$lib/editor/sidebar';
import { normalizeClipAudio } from '$lib/audio/normalize';
import { TEXT_PRESETS, type TextAnimation, type TextStyle } from '$lib/editor/text';
import {
	buildCaptionClips,
	CAPTION_PRESETS,
	estimateCaptionDuration,
	getCaptionPreset,
	splitTranscriptIntoSegments,
	transcribeMedia,
	type CaptionGeneratePayload,
	type CaptionPreset,
	type CaptionSegment
} from '$lib/editor/captions';
import '$lib/transcription';
import type { EditorTool } from '$lib/editor/toolbar';
import { clampTimelineZoom, TIMELINE_ZOOM_STEP } from '$lib/editor/toolbar';
import {
	DEFAULT_FRAME_RATE,
	FRAME_RATE,
	FRAME_RATE_OPTIONS,
	setProjectFrameRate,
	getClipKeyframeValue,
	getLinkedClipIds,
	KEYFRAME_PROPERTIES,
	removeClipKeyframesAtTime,
	roundToFrame,
	updateClipProperty,
	upsertClipKeyframes,
	clampTrackAudioEffects,
	DEFAULT_TRACK_AUDIO_EFFECTS,
	type ClipInsertRequest,
	type ClipPropertyChangeRequest,
	type Clip,
	type ClipVisualUpdateRequest,
	type TimelineCommandRequest,
	type Track,
	type TrackType,
	type Marker,
	type KeyframeProperty,
	type TrackAudioEffects
} from '$lib/editor/timeline';
import { cloneColorGrade, DEFAULT_COLOR_GRADE, getLutPreset } from '$lib/grading';
import { computeBandStats } from '$lib/grading/scopes';
import { computeGradeMatch } from '$lib/grading/match';
import {
	exportFrame,
	createFrameRenderer,
	EXPORT_QUALITIES,
	DEFAULT_EXPORT_QUALITY,
	getExportResolution,
	type ExportQuality,
	type ExportProgress
} from '$lib/export';
import {
	PLAYER_ASPECT_RATIOS,
	PLAYER_ASPECT_RATIO_PRESETS,
	type PlayerAspectRatioMode
} from '$lib/editor/player';
import {
	DEFAULT_ASSET_DURATION,
	MAX_VERSIONS,
	MIN_TIMELINE_DURATION,
	PROJECT_FORMAT,
	PROJECT_RESOLUTIONS,
	PROJECT_VERSION,
	TIMELINE_TAIL_DURATION
} from '$lib/editor/constants';
import {
	blobToDataUrl,
	formatRelativeTime,
	getFirstVisualClipTime,
	isVersionRecord
} from '$lib/editor/versions';
import { parseProjectDocument, isValidAspectRatio } from '$lib/editor/project-document';
import {
	type PaletteCommand,
	paletteToolOptions,
	stickerIconBySymbol,
	effectIconByPresetId
} from '$lib/editor/palette';
import {
	Plus,
	Settings,
	FolderOpen,
	Save,
	Download,
	History,
	Undo2,
	Redo2,
	PanelLeft,
	ZoomIn,
	ZoomOut,
	Maximize2,
	ArrowRightToLine,
	ArrowLeftToLine,
	X,
	Magnet,
	Workflow,
	Type,
	Captions,
	AudioLines,
	MonitorPlay,
	Sparkles,
	Star
} from '@lucide/svelte';

const THUMBNAIL_WIDTH = 320;

type ExportJob = {
	document: ProjectDocument;
	quality: ExportQuality;
	resolution: { width: number; height: number };
	startTime: number;
	endTime: number;
};

export class EditorState {
	// ---- state ----
	projectName = $state('Untitled Project');
	zoom = $state(100);
	canUndo = $state(false);
	canRedo = $state(false);
	isSaved = $state(true);
	isSaving = $state(false);
	autoSaveEnabled = $state(false);
	sidebarOpen = $state(true);
	currentTime = $state(0);
	isPlaying = $state(false);
	selectedClipId = $state<string | null>(null);
	mediaAssets = $state<MediaAsset[]>([]);
	mediaFolders = $state<MediaFolder[]>([]);
	tracks = $state<Track[]>([]);
	activeTool = $state<EditorTool>('select');
	snappingEnabled = $state(true);
	effectRequest = $state<EffectApplyRequest | null>(null);
	clipInsertRequest = $state<ClipInsertRequest | null>(null);
	clipPropertyChangeRequest = $state<ClipPropertyChangeRequest | null>(null);
	visualUpdateRequest = $state<ClipVisualUpdateRequest | null>(null);
	commandRequest = $state<TimelineCommandRequest | null>(null);
	historyEpoch = $state(0);
	playbackRate = $state(1);
	loopEnabled = $state(false);
	openProjectInput = $state<HTMLInputElement | null>(null);
	newProjectDialogOpen = $state(false);
	shortcutsDialogOpen = $state(false);
	historyDialogOpen = $state(false);
	projectNotice = $state<string | null>(null);
	versions = $state<ProjectVersion[]>([]);
	versionsLoaded = false;
	entitySequence = 0;
	exportQuality = $state<ExportQuality>(DEFAULT_EXPORT_QUALITY);
	playerAspectRatio = $state<{ width: number; height: number }>({ width: 16, height: 9 });
	aspectRatioMode = $state<PlayerAspectRatioMode>('auto');
	isExporting = $state(false);
	isCapturingFrame = $state(false);
	matchingClipId = $state<string | null>(null);
	exportProgress = $state<ExportProgress | null>(null);
	exportQueue = $state<ExportJob[]>([]);
	pendingRestoreProject = $state<ProjectDocument | null>(null);
	isRestoringProject = $state(false);
	autoSaveBlocked = $state(false);
	isRestoringVersion = $state(false);
	versionSearchQuery = $state('');
	markers = $state<Marker[]>([]);
	inOutPoints = $state<{ in: number | null; out: number | null }>({ in: null, out: null });
	rippleMode = $state(false);
	propertiesPanelOpen = $state(false);
	propertyChangeFrame: number | null = null;
	pendingPropertyChange: { clipId: string; updater: (clip: Clip) => Clip } | null = null;
	isTranscribing = $state(false);
	transcribeProgress = $state(0);
	transcribeFileName = $state<string | null>(null);
	projectLoadSequence = 0;
	mediaRestorePromise: Promise<void> | null = null;
	commandPaletteOpen = $state(false);
	sourceMonitorOpen = $state(false);
	sourceAssetId = $state<string | null>(null);
	sourceTime = $state(0);
	sourceIsPlaying = $state(false);
	sourceInPoint = $state<number | null>(null);
	sourceOutPoint = $state<number | null>(null);
	sourceMonitorRootEl = $state<HTMLElement | null>(null);
	mixerOpen = $state(false);
	mixerMasterVolume = $state(1);
	sequenceEditorOpen = $state(false);
	editingSequenceClipId = $state<string | null>(null);
	frameRate = $state(DEFAULT_FRAME_RATE);
	projectSettingsOpen = $state(false);
	normalizing = $state(false);
	autoLeveling = $state(false);

	// ---- static config ----
	editorResources: EditorResource[] = [...TEXT_PRESETS, ...STICKER_PRESETS, ...EFFECT_PRESETS];

	private thumbnailPendingIds = new SvelteSet<string>();

	paletteCommands: PaletteCommand[] = [
		// file
		{
			id: 'palette-new-project',
			label: 'New Project',
			keywords: 'create clear reset',
			group: 'File',
			icon: Plus,
			run: () => {
				this.newProjectDialogOpen = true;
			}
		},
		{
			id: 'palette-project-settings',
			label: 'Project Settings',
			keywords: 'fps frame rate resolution settings project',
			group: 'File',
			icon: Settings,
			run: () => {
				this.projectSettingsOpen = true;
			}
		},
		{
			id: 'palette-open-project',
			label: 'Open Project',
			keywords: 'import load',
			group: 'File',
			icon: FolderOpen,
			run: () => this.openProjectInput?.click()
		},
		{
			id: 'palette-save',
			label: 'Save',
			keywords: 'store persist',
			group: 'File',
			hint: formatShortcut({ key: 's', ctrlOrMeta: true }),
			icon: Save,
			disabled: () => this.isSaved || this.isSaving,
			run: () => void this.saveProject()
		},
		{
			id: 'palette-save-as',
			label: 'Save As',
			keywords: 'export project file download',
			group: 'File',
			hint: formatShortcut({ key: 's', ctrlOrMeta: true, shift: true }),
			icon: Download,
			run: () => this.downloadProject()
		},
		{
			id: 'palette-export',
			label: 'Export Video',
			keywords: 'render mp4 movie',
			group: 'File',
			hint: formatShortcut({ key: 'e', ctrlOrMeta: true }),
			icon: Download,
			disabled: () => !this.isSaved,
			run: () => void this.handleExportVideo()
		},
		{
			id: 'palette-version-history',
			label: 'Version History',
			keywords: 'restore snapshot versions',
			group: 'File',
			icon: History,
			run: () => {
				this.versionSearchQuery = '';
				this.historyDialogOpen = true;
				void this.loadVersionHistory();
			}
		},
		// edit
		{
			id: 'palette-undo',
			label: 'Undo',
			keywords: 'revert back',
			group: 'Edit',
			hint: formatShortcut({ key: 'z', ctrlOrMeta: true }),
			icon: Undo2,
			disabled: () => !this.canUndo,
			run: () => this.requestTimelineCommand('undo')
		},
		{
			id: 'palette-redo',
			label: 'Redo',
			keywords: 'forward repeat',
			group: 'Edit',
			hint: formatShortcut({ key: 'z', ctrlOrMeta: true, shift: true }),
			icon: Redo2,
			disabled: () => !this.canRedo,
			run: () => this.requestTimelineCommand('redo')
		},
		// view
		{
			id: 'palette-toggle-sidebar',
			label: 'Toggle Sidebar',
			keywords: 'panel show hide media',
			group: 'View',
			hint: formatShortcut({ key: 'b', ctrlOrMeta: true }),
			icon: PanelLeft,
			run: () => this.toggleSidebar()
		},
		{
			id: 'palette-toggle-source-monitor',
			label: 'Toggle Source Monitor',
			keywords: 'source preview monitor in out insert',
			group: 'View',
			icon: MonitorPlay,
			run: () => this.toggleSourceMonitor()
		},
		{
			id: 'palette-toggle-mixer',
			label: 'Toggle Audio Mixer',
			keywords: 'audio mixer fader vu pan volume mute levels',
			group: 'View',
			icon: AudioLines,
			run: () => this.toggleMixer()
		},
		{
			id: 'palette-zoom-in',
			label: 'Zoom In',
			keywords: 'timeline magnify',
			group: 'View',
			hint: formatShortcut({ key: '+', ctrlOrMeta: true }),
			icon: ZoomIn,
			run: () => {
				this.zoom = clampTimelineZoom(this.zoom + TIMELINE_ZOOM_STEP);
			}
		},
		{
			id: 'palette-zoom-out',
			label: 'Zoom Out',
			keywords: 'timeline shrink',
			group: 'View',
			hint: formatShortcut({ key: '-', ctrlOrMeta: true }),
			icon: ZoomOut,
			run: () => {
				this.zoom = clampTimelineZoom(this.zoom - TIMELINE_ZOOM_STEP);
			}
		},
		{
			id: 'palette-zoom-reset',
			label: 'Fit to Screen',
			keywords: 'zoom reset 100 percent',
			group: 'View',
			hint: formatShortcut({ key: '0', ctrlOrMeta: true }),
			icon: Maximize2,
			run: () => {
				this.zoom = 100;
			}
		},
		// transport
		{
			id: 'palette-set-in',
			label: 'Set In Point',
			keywords: 'mark range start',
			group: 'Transport',
			hint: 'I',
			icon: ArrowRightToLine,
			run: () => {
				if (this.isSourceMonitorActive()) this.setSourceInPoint();
				else this.handleSetInPoint();
			}
		},
		{
			id: 'palette-set-out',
			label: 'Set Out Point',
			keywords: 'mark range end',
			group: 'Transport',
			hint: 'O',
			icon: ArrowLeftToLine,
			run: () => {
				if (this.isSourceMonitorActive()) this.setSourceOutPoint();
				else this.handleSetOutPoint();
			}
		},
		{
			id: 'palette-clear-in-out',
			label: 'Clear In/Out Points',
			keywords: 'remove range marks',
			group: 'Transport',
			hint: formatShortcut({ key: 'i', ctrlOrMeta: true, shift: true }),
			icon: X,
			run: () => {
				if (this.isSourceMonitorActive()) this.clearSourceInOutPoints();
				else this.handleClearInOutPoints();
			}
		},
		// tools
		...paletteToolOptions.map((tool) => ({
			id: `palette-tool-${tool.id}`,
			label: tool.label,
			keywords: 'tool',
			group: 'Tools',
			hint: tool.id === 'select' ? 'V' : tool.id === 'razor' ? 'B' : tool.id === 'hand' ? 'H' : 'T',
			icon: tool.icon,
			run: () => {
				this.activeTool = tool.id;
			}
		})),
		{
			id: 'palette-toggle-snapping',
			label: 'Toggle Snapping',
			keywords: 'magnet align snap',
			group: 'Tools',
			hint: 'S',
			icon: Magnet,
			run: () => {
				this.snappingEnabled = !this.snappingEnabled;
			}
		},
		{
			id: 'palette-toggle-ripple',
			label: 'Toggle Ripple Mode',
			keywords: 'delete ripple edit',
			group: 'Tools',
			hint: 'R',
			icon: Workflow,
			run: () => {
				this.handleRippleModeToggle(!this.rippleMode);
			}
		},
		// insert (text + stickers)
		...TEXT_PRESETS.map((preset) => ({
			id: `palette-insert-${preset.id}`,
			label: `Add ${preset.name} Text`,
			keywords: `text title insert ${preset.category}`,
			group: 'Insert',
			icon: Type,
			run: () => this.applyResource(preset)
		})),
		...STICKER_PRESETS.map((preset) => ({
			id: `palette-insert-${preset.id}`,
			label: `Add ${preset.name} Sticker`,
			keywords: `sticker symbol insert ${preset.category}`,
			group: 'Insert',
			icon: preset.sticker ? (stickerIconBySymbol[preset.sticker] ?? Star) : Star,
			run: () => this.applyResource(preset)
		})),
		// effects
		...EFFECT_PRESETS.map((preset) => ({
			id: `palette-effect-${preset.id}`,
			label: `Apply ${preset.name}`,
			keywords: `${preset.kind} effect filter transition ${preset.category}`,
			group: 'Effects',
			icon: effectIconByPresetId[preset.id] ?? Sparkles,
			run: () => this.applyResource(preset)
		})),
		// captions
		{
			id: 'palette-generate-captions',
			label: 'Generate Captions',
			keywords: 'subtitle captions transcript',
			group: 'Captions',
			icon: Captions,
			run: () => {
				this.handleGenerateCaptions({
					transcript: '',
					presetId: CAPTION_PRESETS[0]?.id ?? ''
				});
			}
		},
		{
			id: 'palette-transcribe-media',
			label: 'Transcribe Media',
			keywords: 'whisper speech to text subtitles auto captions',
			group: 'Captions',
			icon: AudioLines,
			disabled: () => this.isTranscribing,
			run: () => {
				void this.handleTranscribeMedia(CAPTION_PRESETS[0]?.id ?? '');
			}
		}
	];

	openCommandPalette() {
		this.commandPaletteOpen = true;
	}

	paletteBindings = $derived<ShortcutBinding[]>([
		{
			key: 'k',
			ctrlOrMeta: true,
			description: 'Command Palette',
			ignoreWhenTyping: true,
			onKeyDown: () => this.openCommandPalette()
		}
	]);

	// ---- derived ----
	sortedVersions = $derived([...this.versions].sort((a, b) => b.createdAt - a.createdAt));
	exportResolution = $derived(getExportResolution(this.playerAspectRatio, this.exportQuality));
	exportPercent = $derived.by(() => {
		const p = this.exportProgress;
		if (!p) return 0;
		if (p.phase === 'done') return 100;
		if (p.phase === 'preparing') return 3;
		if (p.phase === 'mixing-audio') return 8;
		if (p.phase === 'rendering') {
			return p.totalFrames > 0 ? 10 + Math.round((p.frame / p.totalFrames) * 80) : 10;
		}
		if (p.phase === 'encoding') {
			return p.frame > 0 ? Math.min(99, 90 + Math.round((p.frame / p.totalFrames) * 9)) : 90;
		}
		return 0;
	});
	filteredVersions = $derived.by(() => {
		const query = this.versionSearchQuery.trim().toLowerCase();
		if (!query) return this.sortedVersions;
		return this.sortedVersions.filter((version) =>
			version.document.name.toLowerCase().includes(query)
		);
	});
	selectedClip = $derived(
		this.tracks.flatMap((track) => track.clips).find((clip) => clip.id === this.selectedClipId) ??
			null
	);
	captionSegments = $derived.by(() =>
		this.tracks
			.filter((track) => track.type === 'subtitle')
			.flatMap((track) => track.clips.filter((clip) => clip.caption))
			.sort((a, b) => a.startTime - b.startTime)
			.map((clip) => ({ text: clip.name, startTime: clip.startTime, duration: clip.duration }))
	);
	editingSequenceClip = $derived(
		this.editingSequenceClipId
			? (this.tracks
					.flatMap((track) => track.clips)
					.find((clip) => clip.id === this.editingSequenceClipId) ?? null)
			: null
	);
	matchSources = $derived(
		this.tracks
			.flatMap((track) => track.clips)
			.filter((clip) => clip.id !== this.selectedClipId && Boolean(clip.assetId))
			.map((clip) => ({ id: clip.id, name: clip.name }))
	);
	playerClipTime = $derived(
		this.selectedClip
			? Math.min(
					this.selectedClip.duration,
					Math.max(0, this.currentTime - this.selectedClip.startTime)
				)
			: 0
	);
	selectedClipIsAudio = $derived.by(() => {
		const clip = this.selectedClip;
		return Boolean(
			clip &&
			clip.assetId &&
			this.mediaAssets.some((asset) => asset.id === clip.assetId && asset.kind === 'audio')
		);
	});
	selectedClipHasAudio = $derived(
		Boolean(
			this.selectedClip?.assetId &&
			this.mediaAssets.some(
				(asset) =>
					asset.id === this.selectedClip?.assetId &&
					(asset.kind === 'audio' || asset.kind === 'video')
			)
		)
	);
	sourceAsset = $derived(this.mediaAssets.find((asset) => asset.id === this.sourceAssetId) ?? null);
	timelineContentEnd = $derived(
		Math.max(
			0,
			...this.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration))
		)
	);
	timelineDuration = $derived(
		this.timelineContentEnd > 0
			? Math.max(MIN_TIMELINE_DURATION, this.timelineContentEnd + TIMELINE_TAIL_DURATION)
			: MIN_TIMELINE_DURATION
	);
	usedAssetIds = $derived(
		this.tracks
			.flatMap((track) => track.clips)
			.reduce<string[]>((assetIds, clip) => {
				if (!clip.assetId || assetIds.includes(clip.assetId)) return assetIds;
				return [...assetIds, clip.assetId];
			}, [])
	);
	paletteVersionCommands = $derived<PaletteCommand[]>(
		this.sortedVersions.slice(0, 5).map((version) => ({
			id: `palette-version-${version.id}`,
			label: version.document.name,
			keywords: 'restore snapshot version',
			group: 'Versions',
			hint: formatRelativeTime(version.createdAt),
			run: () => void this.restoreVersion(version)
		}))
	);
	paletteGroups = $derived.by(() => {
		const all = [...this.paletteCommands, ...this.paletteVersionCommands];
		const order: string[] = [];
		for (const cmd of all) {
			if (!order.includes(cmd.group)) order.push(cmd.group);
		}
		return order.map((group) => ({
			group,
			items: all.filter((cmd) => cmd.group === group)
		}));
	});

	selectedClipLinked = $derived(
		this.selectedClip ? getLinkedClipIds(this.tracks, this.selectedClip.id).length > 0 : false
	);

	// ---- methods ----

	toggleSidebar() {
		this.sidebarOpen = !this.sidebarOpen;
	}

	requestTimelineCommand(command: TimelineCommandRequest['command']) {
		this.commandRequest = { id: this.createEntityId('timeline-command'), command };
	}

	createEntityId(prefix: string): string {
		this.entitySequence += 1;
		return `${prefix}-${Date.now()}-${this.entitySequence}`;
	}

	addTimelineClip(
		name: string,
		clipDuration = DEFAULT_ASSET_DURATION,
		targetTrackId?: string,
		startTime = this.currentTime,
		assetId?: string,
		trackType: TrackType = 'video',
		textStyle?: TextStyle,
		sticker?: string,
		sourceDuration?: number,
		createTrack = false,
		trackName?: string,
		textAnimation?: TextAnimation
	) {
		const duration = Number.isFinite(clipDuration)
			? Math.max(clipDuration, 1 / FRAME_RATE)
			: DEFAULT_ASSET_DURATION;
		const clipId = this.createEntityId('clip');
		const clip: Clip = {
			id: clipId,
			name,
			startTime: roundToFrame(startTime),
			duration,
			assetId,
			sourceInstanceId: clipId,
			sourceDuration,
			textStyle,
			textAnimation,
			sticker,
			stickerColor: sticker ? '#ffffff' : undefined
		};
		this.clipInsertRequest = {
			id: this.createEntityId('clip-insert'),
			clips: [clip],
			targetTrackId,
			trackType,
			createTrack,
			trackName
		};
	}

	applyResource(resource: EditorResource) {
		if (resource.kind === 'text' && resource.textStyle) {
			this.addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				undefined,
				this.currentTime,
				undefined,
				'video',
				resource.textStyle,
				undefined,
				undefined,
				true,
				resource.name,
				resource.textAnimation
			);
			return;
		}
		if (resource.kind === 'stickers' && resource.sticker) {
			this.addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				undefined,
				this.currentTime,
				undefined,
				'video',
				undefined,
				resource.sticker,
				undefined,
				true,
				resource.name
			);
			return;
		}
		if (!this.selectedClipId) {
			this.projectNotice = 'Select an unlocked clip before applying an effect';
			return;
		}
		this.effectRequest = { id: this.createEntityId('effect-request'), presetId: resource.id };
	}

	createDefaultText() {
		const preset = TEXT_PRESETS[0];
		this.addTimelineClip(
			preset.name,
			DEFAULT_ASSET_DURATION,
			undefined,
			this.currentTime,
			undefined,
			'video',
			preset.textStyle,
			undefined,
			undefined,
			true,
			preset.name
		);
	}

	findCaptionSourceWindow(): {
		startTime: number;
		duration: number;
		assetId: string;
		name: string;
	} | null {
		const allClips = this.tracks.flatMap((track) => track.clips);
		const selectedMediaClip =
			allClips.find((clip) => clip.id === this.selectedClipId && Boolean(clip.assetId)) ?? null;
		if (selectedMediaClip?.assetId) {
			return {
				startTime: selectedMediaClip.startTime,
				duration: selectedMediaClip.duration,
				assetId: selectedMediaClip.assetId,
				name: selectedMediaClip.name
			};
		}
		const playheadMediaClip =
			allClips.find(
				(clip) =>
					Boolean(clip.assetId) &&
					this.currentTime >= clip.startTime &&
					this.currentTime < clip.startTime + clip.duration
			) ?? null;
		if (playheadMediaClip?.assetId) {
			return {
				startTime: playheadMediaClip.startTime,
				duration: playheadMediaClip.duration,
				assetId: playheadMediaClip.assetId,
				name: playheadMediaClip.name
			};
		}
		return null;
	}

	insertCaptionSegments(segments: CaptionSegment[], preset: CaptionPreset) {
		const clips = buildCaptionClips(segments, preset, (prefix) => this.createEntityId(prefix));
		this.clipInsertRequest = {
			id: this.createEntityId('clip-insert'),
			clips,
			trackType: 'subtitle',
			createTrack: true,
			trackName: 'Captions'
		};
		this.projectNotice = `Captions added (${clips.length} segments)`;
	}

	handleCaptionSegmentsChange(segments: CaptionSegment[]) {
		const captionTracks = this.tracks.filter((track) => track.type === 'subtitle');
		if (captionTracks.length === 0) {
			this.insertCaptionSegments(segments, CAPTION_PRESETS[0]);
			return;
		}
		const existingCaptions = captionTracks.flatMap((track) =>
			track.clips.filter((clip) => clip.caption)
		);
		const template = existingCaptions[0];
		const nextCaptions = segments.map((segment, index) => {
			const existing = existingCaptions[index];
			if (existing) {
				return {
					...existing,
					name: segment.text,
					startTime: segment.startTime,
					duration: segment.duration
				};
			}
			return {
				...buildCaptionClips([segment], CAPTION_PRESETS[0], (prefix) =>
					this.createEntityId(prefix)
				)[0],
				textStyle: template?.textStyle ?? CAPTION_PRESETS[0].textStyle,
				visualTransform: template?.visualTransform
			};
		});
		const captionIds = new SvelteSet(existingCaptions.map((clip) => clip.id));
		this.tracks = this.tracks.map((track) =>
			track.type === 'subtitle'
				? {
						...track,
						clips: [
							...track.clips.filter((clip) => !captionIds.has(clip.id)),
							...nextCaptions
						].sort((a, b) => a.startTime - b.startTime)
					}
				: track
		);
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleGenerateCaptions(payload: CaptionGeneratePayload) {
		const transcript = payload.transcript.trim().slice(0, 20_000);
		if (!transcript) {
			this.projectNotice = 'Paste a transcript before generating captions';
			return;
		}
		const preset = getCaptionPreset(payload.presetId);
		if (!preset) {
			this.projectNotice = 'Caption style is not supported';
			return;
		}
		const sourceWindow = this.findCaptionSourceWindow();
		const window = sourceWindow ?? {
			startTime: this.currentTime,
			duration: estimateCaptionDuration(transcript)
		};
		const segments = splitTranscriptIntoSegments(transcript, window.duration).map((segment) => ({
			...segment,
			startTime: roundToFrame(window.startTime + segment.startTime)
		}));
		if (segments.length === 0) {
			this.projectNotice = 'Transcript is empty';
			return;
		}
		this.insertCaptionSegments(segments, preset);
	}

	async resolveAssetBlob(assetId: string): Promise<Blob | null> {
		const asset = this.mediaAssets.find((candidate) => candidate.id === assetId);
		if (asset?.src) {
			try {
				const response = await fetch(asset.src);
				if (response.ok) return await response.blob();
			} catch {
				// fall through to the persisted blob
			}
		}
		return loadMediaBlob(assetId);
	}

	async handleTranscribeMedia(presetId: string) {
		if (this.isTranscribing) return;
		const preset = getCaptionPreset(presetId);
		if (!preset) {
			this.projectNotice = 'Caption style is not supported';
			return;
		}
		const sourceWindow = this.findCaptionSourceWindow();
		if (!sourceWindow) {
			this.projectNotice = 'Select a media clip or position the playhead over one to transcribe';
			return;
		}
		const media = await this.resolveAssetBlob(sourceWindow.assetId);
		if (!media) {
			this.projectNotice = 'Media for this clip is no longer available';
			return;
		}
		this.isTranscribing = true;
		this.transcribeProgress = 0;
		this.transcribeFileName = null;
		const processingCue = sound.processing();
		try {
			this.projectNotice = 'Transcribing media, this may take a moment';
			const segments = await transcribeMedia(
				{ assetId: sourceWindow.assetId, name: sourceWindow.name, media },
				{
					onProgress: (progress, fileName) => {
						this.transcribeProgress = Math.max(0, Math.min(100, Math.round(progress)));
						this.transcribeFileName = fileName;
					}
				}
			);
			if (segments.length === 0) {
				this.projectNotice = 'No speech detected in this clip';
				sound.error();
				return;
			}
			const offsetSegments = segments.map((segment) => ({
				...segment,
				startTime: roundToFrame(sourceWindow.startTime + segment.startTime)
			}));
			const windowEnd = sourceWindow.startTime + sourceWindow.duration;
			let previousEnd = sourceWindow.startTime;
			for (const segment of offsetSegments) {
				const start = Math.max(previousEnd, segment.startTime);
				const overflow = start + segment.duration - windowEnd;
				if (overflow > 0) {
					segment.duration = roundToFrame(Math.max(1 / FRAME_RATE, segment.duration - overflow));
				}
				segment.startTime = roundToFrame(start);
				previousEnd = start + segment.duration;
			}
			this.insertCaptionSegments(offsetSegments, preset);
			sound.complete();
		} catch (error) {
			this.projectNotice = error instanceof Error ? error.message : 'Transcription failed';
			sound.error();
		} finally {
			processingCue?.stop();
			this.isTranscribing = false;
			this.transcribeProgress = 0;
			this.transcribeFileName = null;
		}
	}

	buildAssetClipRequest(
		asset: MediaAsset,
		startTime: number,
		trackId: string,
		createTrack = false,
		sourceStart?: number,
		sourceDuration?: number
	): ClipInsertRequest | null {
		const start = roundToFrame(startTime);
		const duration =
			sourceDuration !== undefined && sourceDuration > 0
				? roundToFrame(sourceDuration)
				: (asset.duration ?? DEFAULT_ASSET_DURATION);
		const instanceId = this.createEntityId('clip-instance');
		const clip: Clip = {
			id: this.createEntityId('clip'),
			name: asset.name,
			startTime: start,
			duration,
			assetId: asset.id,
			sourceInstanceId: instanceId,
			sourceStart,
			sourceDuration:
				sourceDuration !== undefined
					? roundToFrame(sourceDuration)
					: asset.kind === 'image'
						? undefined
						: (asset.duration ?? undefined)
		};
		const request: ClipInsertRequest = {
			id: this.createEntityId('clip-insert'),
			clips: [clip],
			targetTrackId: trackId,
			trackType: asset.kind === 'audio' ? 'audio' : 'video',
			createTrack,
			trackName: createTrack ? asset.name : undefined
		};
		return request;
	}

	dropMediaAsset(assetId: string, trackId: string, startTime: number, createTrack = false) {
		const asset = this.mediaAssets.find((candidate) => candidate.id === assetId);
		if (!asset) return;
		this.clipInsertRequest = this.buildAssetClipRequest(asset, startTime, trackId, createTrack);
	}

	// ---- source monitor ----

	isSourceMonitorActive(): boolean {
		if (!this.sourceMonitorOpen || !this.sourceAsset) return false;
		if ((this.sourceAsset.duration ?? 0) <= 0) return false;
		const root = this.sourceMonitorRootEl;
		if (!root) return false;
		return root.contains(document.activeElement);
	}

	openSourceMonitor(assetId: string | null) {
		if (assetId === null) return;
		const asset = this.mediaAssets.find((candidate) => candidate.id === assetId);
		if (!asset) return;
		this.sourceIsPlaying = false;
		this.sourceAssetId = assetId;
		this.sourceTime = 0;
		this.sourceInPoint = null;
		this.sourceOutPoint = null;
		this.sourceMonitorOpen = true;
	}

	closeSourceMonitor() {
		this.sourceIsPlaying = false;
		this.sourceMonitorOpen = false;
		this.sourceAssetId = null;
		this.sourceTime = 0;
		this.sourceInPoint = null;
		this.sourceOutPoint = null;
	}

	toggleSourceMonitor() {
		if (this.sourceMonitorOpen) {
			this.closeSourceMonitor();
			return;
		}
		const asset = this.sourceAsset ?? this.mediaAssets[0] ?? null;
		if (asset) this.openSourceMonitor(asset.id);
	}

	setSourceInPoint(time?: number) {
		const asset = this.sourceAsset;
		if (!asset || !(asset.duration ?? 0)) return;
		const duration = asset.duration ?? 0;
		const t = roundToFrame(
			time !== undefined
				? Math.min(duration, Math.max(0, time))
				: Math.min(duration, Math.max(0, this.sourceTime))
		);
		this.sourceInPoint = t;
		if (this.sourceOutPoint !== null && this.sourceOutPoint <= t) this.sourceOutPoint = null;
	}

	setSourceOutPoint(time?: number) {
		const asset = this.sourceAsset;
		if (!asset || !(asset.duration ?? 0)) return;
		const duration = asset.duration ?? 0;
		const t = roundToFrame(
			time !== undefined
				? Math.min(duration, Math.max(0, time))
				: Math.min(duration, Math.max(0, this.sourceTime))
		);
		this.sourceOutPoint = t;
		if (this.sourceInPoint !== null && this.sourceInPoint >= t) this.sourceInPoint = null;
	}

	clearSourceInOutPoints() {
		this.sourceInPoint = null;
		this.sourceOutPoint = null;
	}

	insertFromSourceMonitor() {
		const asset = this.sourceAsset;
		if (!asset) return;
		let sourceStart: number | undefined;
		let sourceDuration: number | undefined;
		if (this.sourceInPoint !== null || this.sourceOutPoint !== null) {
			const start = this.sourceInPoint ?? 0;
			const end = this.sourceOutPoint ?? asset.duration ?? start;
			sourceStart = roundToFrame(start);
			sourceDuration = Math.max(1 / FRAME_RATE, roundToFrame(Math.max(0, end - start)));
		}
		const request = this.buildAssetClipRequest(
			asset,
			this.currentTime,
			'',
			true,
			sourceStart,
			sourceDuration
		);
		if (request) this.clipInsertRequest = request;
	}

	// ---- mixer ----

	toggleMixer() {
		this.mixerOpen = !this.mixerOpen;
	}

	private markMixerDirty() {
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleMixerTrackVolume(trackId: string, volume: number) {
		const track = this.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		track.volume = volume;
		audioEngine.setTrackVolume(trackId, volume);
		this.markMixerDirty();
	}

	handleMixerTrackPan(trackId: string, pan: number) {
		const track = this.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		track.pan = pan;
		audioEngine.setTrackPan(trackId, pan);
		this.markMixerDirty();
	}

	handleMixerTrackEffects(trackId: string, patch: Partial<TrackAudioEffects>) {
		const track = this.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		const effects = clampTrackAudioEffects({
			...DEFAULT_TRACK_AUDIO_EFFECTS,
			...track.effects,
			...patch
		});
		track.effects = effects;
		audioEngine.setTrackEq(trackId, effects.eqLow, effects.eqMid, effects.eqHigh);
		audioEngine.setTrackCompressor(trackId, effects.compressorThreshold, effects.compressorRatio);
		audioEngine.setTrackReverb(trackId, effects.reverbAmount);
		this.markMixerDirty();
	}

	handleMixerToggleMute(trackId: string) {
		const track = this.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		track.muted = !track.muted;
		this.markMixerDirty();
	}

	handleMixerMasterVolume(volume: number) {
		this.mixerMasterVolume = volume;
		audioEngine.setMasterVolume(volume);
	}

	handleMixerResetTrack(trackId: string) {
		const track = this.tracks.find((candidate) => candidate.id === trackId);
		if (!track) return;
		track.volume = 1;
		track.pan = 0;
		track.muted = false;
		track.effects = { ...DEFAULT_TRACK_AUDIO_EFFECTS };
		audioEngine.setTrackVolume(trackId, 1);
		audioEngine.setTrackPan(trackId, 0);
		const fx = track.effects;
		audioEngine.setTrackEq(trackId, fx.eqLow, fx.eqMid, fx.eqHigh);
		audioEngine.setTrackCompressor(trackId, fx.compressorThreshold, fx.compressorRatio);
		audioEngine.setTrackReverb(trackId, fx.reverbAmount);
		this.markMixerDirty();
	}

	handleMixerResetMaster() {
		this.mixerMasterVolume = 1;
		audioEngine.setMasterVolume(1);
	}

	// ---- resource/media/track handlers ----

	dropEditorResource(resourceId: string, trackId: string, startTime: number) {
		const resource = this.editorResources.find((candidate) => candidate.id === resourceId);
		if (!resource) return;
		if (resource.kind === 'text' && resource.textStyle) {
			this.addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				trackId,
				startTime,
				undefined,
				'video',
				resource.textStyle,
				undefined,
				undefined,
				false,
				undefined,
				resource.textAnimation
			);
			return;
		}
		if (resource.kind !== 'stickers' || !resource.sticker) return;
		this.addTimelineClip(
			resource.name,
			DEFAULT_ASSET_DURATION,
			trackId,
			startTime,
			undefined,
			'video',
			undefined,
			resource.sticker
		);
	}

	handleMediaAssetsChange(assets: MediaAsset[]) {
		this.mediaAssets = assets;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleMediaFoldersChange(folders: MediaFolder[]) {
		this.mediaFolders = folders;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleTracksChange(nextTracks: Track[]) {
		this.tracks = nextTracks;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleMarkersChange(nextMarkers: Marker[]) {
		this.markers = nextMarkers;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleExportQualityChange(id: string) {
		const q = EXPORT_QUALITIES.find((eq) => eq.id === id);
		if (q) this.exportQuality = q;
	}

	handleAspectSettingsChange() {
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	requestVisualUpdate(
		clipId: string,
		update: Pick<ClipVisualUpdateRequest, 'transform' | 'color'>
	) {
		const clip = this.tracks
			.flatMap((track) => track.clips)
			.find((candidate) => candidate.id === clipId);
		this.visualUpdateRequest = {
			id: this.createEntityId('visual-update'),
			clipId,
			clipTime: clip
				? Math.min(clip.duration, Math.max(0, this.currentTime - clip.startTime))
				: undefined,
			...update
		};
	}

	runPaletteCommand(cmd: PaletteCommand) {
		sound.select();
		cmd.run();
		this.commandPaletteOpen = false;
	}

	// ---- project document ----

	createProjectDocument(): ProjectDocument {
		return {
			format: PROJECT_FORMAT,
			version: PROJECT_VERSION,
			name: this.projectName,
			tracks: this.tracks,
			mediaAssets: this.mediaAssets,
			mediaFolders: this.mediaFolders,
			markers: this.markers,
			aspectRatio: { width: this.playerAspectRatio.width, height: this.playerAspectRatio.height },
			aspectRatioMode: this.aspectRatioMode,
			frameRate: this.frameRate,
			updatedAt: Date.now()
		};
	}

	// ---- export/capture/match ----

	async handleExportVideo() {
		if (this.timelineContentEnd <= 0) {
			this.projectNotice = 'Timeline is empty - add clips to export';
			return;
		}
		await this.mediaRestorePromise;
		const startTime = this.inOutPoints.in ?? 0;
		const endTime = this.inOutPoints.out ?? this.timelineContentEnd;
		if (endTime <= startTime) {
			this.projectNotice = 'Out point must be after in point';
			return;
		}
		this.exportQueue = [
			...this.exportQueue,
			{
				document: createProjectSnapshot(this.createProjectDocument()),
				quality: { ...this.exportQuality },
				resolution: { ...this.exportResolution },
				startTime,
				endTime
			}
		];
		if (this.isExporting) this.projectNotice = `Export queued (${this.exportQueue.length} waiting)`;
		void this.processExportQueue();
	}

	private async processExportQueue() {
		if (this.isExporting) return;
		this.isExporting = true;
		try {
			while (this.exportQueue.length > 0) {
				const [job, ...remainingJobs] = this.exportQueue;
				if (!job) break;
				this.exportQueue = remainingJobs;
				this.exportProgress = null;
				try {
					const { exportVideo } = await import('$lib/export');
					const blob = await exportVideo({
						tracks: job.document.tracks,
						mediaAssets: job.document.mediaAssets,
						quality: { ...job.quality, ...job.resolution },
						duration: Math.max(
							...job.document.tracks.flatMap((track) =>
								track.clips.map((clip) => clip.startTime + clip.duration)
							),
							0
						),
						startTime: job.startTime,
						endTime: job.endTime,
						onProgress: (progress: ExportProgress) => {
							this.exportProgress = progress;
						}
					});
					if (!blob) throw new Error('Export produced no output');
					const url = URL.createObjectURL(blob);
					const link = document.createElement('a');
					link.href = url;
					link.download = `${job.document.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-${job.quality.label}-${job.resolution.width}x${job.resolution.height}.mp4`;
					link.click();
					setTimeout(() => URL.revokeObjectURL(url), 60_000);
					this.projectNotice = `Exported as ${job.quality.label} (${job.resolution.width}x${job.resolution.height})`;
					sound.complete();
				} catch (error) {
					this.projectNotice = error instanceof Error ? error.message : 'Export failed';
					sound.error();
				}
			}
		} finally {
			this.exportProgress = null;
			this.isExporting = false;
		}
	}

	async handleLutPreview(lutId: string | null, canvas: HTMLCanvasElement) {
		if (!lutId || !this.selectedClip?.assetId) return;
		const lut = getLutPreset(lutId);
		if (!lut) return;
		try {
			await this.mediaRestorePromise;
			const renderer = createFrameRenderer(this.tracks, this.mediaAssets);
			try {
				canvas.width = 96;
				canvas.height = 54;
				const time = Math.min(
					this.selectedClip.startTime + this.selectedClip.duration - 1 / FRAME_RATE,
					Math.max(this.selectedClip.startTime, this.currentTime)
				);
				await renderer.render(canvas, time, { lutOverride: lut });
			} finally {
				renderer.dispose();
			}
		} catch {
			// Thumbnail failure must not interrupt grading.
		}
	}

	async handleAutoLevels() {
		const target = this.selectedClip;
		if (!target?.assetId || this.autoLeveling) return;
		this.autoLeveling = true;
		try {
			await this.mediaRestorePromise;
			const renderer = createFrameRenderer(this.tracks, this.mediaAssets);
			try {
				const canvas = document.createElement('canvas');
				canvas.width = 256;
				canvas.height = Math.max(
					2,
					Math.round((256 * this.playerAspectRatio.height) / this.playerAspectRatio.width)
				);
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) return;
				const time = Math.min(
					target.startTime + target.duration - 1 / FRAME_RATE,
					Math.max(target.startTime, this.currentTime)
				);
				await renderer.render(canvas, time, { skipGrade: true });
				const stats = computeBandStats(context.getImageData(0, 0, canvas.width, canvas.height));
				const reference = {
					shadows: { red: 0.12, green: 0.12, blue: 0.12, luma: 0.12 },
					midtones: { red: 0.5, green: 0.5, blue: 0.5, luma: 0.5 },
					highlights: { red: 0.88, green: 0.88, blue: 0.88, luma: 0.88 }
				};
				const match = computeGradeMatch(stats, reference);
				this.handleClipPropertyChange(target.id, (clip) => ({
					...clip,
					colorGrade: {
						...(clip.colorGrade ?? cloneColorGrade(DEFAULT_COLOR_GRADE)),
						curves: {
							...(clip.colorGrade ?? DEFAULT_COLOR_GRADE).curves,
							master: match.masterCurve
						}
					}
				}));
				this.projectNotice = 'Auto-levels applied';
				sound.complete();
			} finally {
				renderer.dispose();
			}
		} catch {
			this.projectNotice = 'Auto-levels failed';
			sound.error();
		} finally {
			this.autoLeveling = false;
		}
	}

	async handleMatchColor(referenceClipId: string) {
		const target = this.selectedClip;
		if (!target || this.matchingClipId) return;
		const reference = this.tracks
			.flatMap((track) => track.clips)
			.find((clip) => clip.id === referenceClipId);
		if (!reference?.assetId || !target.assetId) {
			this.projectNotice = 'Both clips need media to match color';
			return;
		}
		if (reference.id === target.id) return;
		this.matchingClipId = target.id;
		try {
			await this.mediaRestorePromise;
			const renderer = createFrameRenderer(this.tracks, this.mediaAssets);
			try {
				const canvas = document.createElement('canvas');
				const safeAspect =
					this.playerAspectRatio.width > 0 && this.playerAspectRatio.height > 0
						? this.playerAspectRatio
						: { width: 16, height: 9 };
				canvas.width = 256;
				canvas.height = Math.max(2, Math.round((256 * safeAspect.height) / safeAspect.width));
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) return;
				const targetTime = Math.min(
					target.startTime + target.duration - 1 / FRAME_RATE,
					Math.max(target.startTime, this.currentTime)
				);
				const referenceTime = reference.startTime + reference.duration / 2;
				await renderer.render(canvas, targetTime);
				const targetStats = computeBandStats(
					context.getImageData(0, 0, canvas.width, canvas.height)
				);
				await renderer.render(canvas, referenceTime);
				const referenceStats = computeBandStats(
					context.getImageData(0, 0, canvas.width, canvas.height)
				);
				const match = computeGradeMatch(targetStats, referenceStats);
				this.handleClipPropertyChange(target.id, (c) => {
					const grade = c.colorGrade ?? cloneColorGrade(DEFAULT_COLOR_GRADE);
					return {
						...c,
						colorGrade: {
							...grade,
							shadows: { ...match.shadows },
							midtones: { ...match.midtones },
							highlights: { ...match.highlights },
							curves: { ...grade.curves, master: match.masterCurve }
						}
					};
				});
				this.projectNotice = `Color matched to "${reference.name}"`;
				sound.complete();
			} finally {
				renderer.dispose();
			}
		} catch {
			this.projectNotice = 'Color match failed';
			sound.error();
		} finally {
			this.matchingClipId = null;
		}
	}

	async handleCaptureFrame(format: 'png' | 'jpeg') {
		if (this.isCapturingFrame || this.isExporting) return;
		if (this.timelineContentEnd <= 0) {
			this.projectNotice = 'Timeline is empty - nothing to capture';
			return;
		}
		this.isCapturingFrame = true;
		try {
			const blob = await exportFrame({
				tracks: this.tracks,
				mediaAssets: this.mediaAssets,
				time: Math.min(this.currentTime, this.timelineContentEnd),
				resolution: this.exportResolution,
				format
			});
			if (!blob) {
				this.projectNotice = 'Frame could not be captured';
				return;
			}
			const extension = format === 'jpeg' ? 'jpg' : 'png';
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `${this.projectName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-frame-${extension}`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			this.projectNotice = `Frame captured (${this.exportResolution.width}x${this.exportResolution.height})`;
			sound.complete();
		} catch {
			this.projectNotice = 'Frame could not be captured';
			sound.error();
		} finally {
			this.isCapturingFrame = false;
		}
	}

	// ---- save/load/restore ----

	async saveProject() {
		if (this.isSaving) return;
		this.isSaving = true;
		try {
			await this.loadVersionHistory();
			const document = this.createProjectDocument();
			const versionDoc = createProjectSnapshot(document);
			const newVersion: ProjectVersion = {
				id: this.createEntityId('version'),
				createdAt: document.updatedAt,
				document: versionDoc
			};
			const nextVersions = [newVersion, ...this.versions].slice(0, MAX_VERSIONS);
			await Promise.all([saveProjectToDb(document), saveVersions(nextVersions)]);
			this.versions = nextVersions;
			void this.generateVersionThumbnail(newVersion);
			const isFirstSave = !this.autoSaveEnabled;
			this.autoSaveEnabled = true;
			this.autoSaveBlocked = false;
			this.isSaved = true;
			this.projectNotice = isFirstSave ? 'Project saved - auto-save enabled' : 'Project saved';
			sound.success();
		} catch {
			this.autoSaveBlocked = true;
			this.projectNotice = 'Project could not be saved';
			sound.error();
		} finally {
			this.isSaving = false;
		}
	}

	downloadProject() {
		try {
			const doc = this.createProjectDocument();
			const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = `${this.projectName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}.viko`;
			link.click();
			URL.revokeObjectURL(url);
			this.projectNotice = 'Project file exported';
		} catch {
			this.projectNotice = 'Project file could not be exported';
		}
	}

	applyProjectDocument(document: ProjectDocument) {
		this.projectLoadSequence += 1;
		this.projectName = document.name;
		this.tracks = document.tracks;
		this.mediaAssets = document.mediaAssets;
		this.mediaFolders = document.mediaFolders ?? [];
		this.markers = document.markers ?? [];
		this.inOutPoints = { in: null, out: null };
		this.currentTime = 0;
		this.isPlaying = false;
		this.selectedClipId = null;
		this.playerAspectRatio = isValidAspectRatio(document.aspectRatio)
			? { width: document.aspectRatio.width, height: document.aspectRatio.height }
			: { width: 16, height: 9 };
		this.aspectRatioMode = document.aspectRatioMode ?? 'auto';
		this.frameRate = document.frameRate ?? DEFAULT_FRAME_RATE;
		setProjectFrameRate(this.frameRate);
		this.historyEpoch += 1;
		this.isSaved = true;
	}

	async refreshMissingAssetMetadata(assets: MediaAsset[], loadSequence: number) {
		const missing = assets.filter(
			(asset) =>
				(asset.kind === 'video' || asset.kind === 'image') &&
				(asset.width === null || asset.height === null)
		);
		if (missing.length === 0) return;
		try {
			const refreshed = await Promise.all(missing.map((asset) => inspectMediaAsset(asset)));
			if (this.projectLoadSequence !== loadSequence) return;
			const refreshedById = new SvelteMap(refreshed.map((asset) => [asset.id, asset]));
			this.mediaAssets = this.mediaAssets.map((asset) => refreshedById.get(asset.id) ?? asset);
			this.isSaved = false;
			this.autoSaveBlocked = false;
		} catch {
			// missing metadata stays null and auto-detection is skipped
		}
	}

	async handleProjectFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || file.size <= 0 || file.size > 25 * 1024 * 1024) return;
		try {
			const parsed = parseProjectDocument(JSON.parse(await file.text()));
			if (!parsed) {
				this.projectNotice = 'Project file is invalid or unsupported';
				return;
			}
			this.applyProjectDocument(parsed);
			this.projectNotice = 'Project opened';
		} catch {
			this.projectNotice = 'Project file could not be opened';
		}
	}

	createNewProject() {
		sound.open();
		this.projectLoadSequence += 1;
		this.projectName = 'Untitled Project';
		this.tracks = [];
		this.mediaAssets = [];
		this.mediaFolders = [];
		this.markers = [];
		this.inOutPoints = { in: null, out: null };
		this.currentTime = 0;
		this.isPlaying = false;
		this.selectedClipId = null;
		this.playerAspectRatio = { width: 16, height: 9 };
		this.aspectRatioMode = 'auto';
		this.frameRate = DEFAULT_FRAME_RATE;
		setProjectFrameRate(DEFAULT_FRAME_RATE);
		this.historyEpoch += 1;
		this.isSaved = true;
		this.autoSaveEnabled = false;
		this.newProjectDialogOpen = false;
		this.projectNotice = 'New project created';
		void clearProject();
	}

	applyProjectFrameRate(fps: number) {
		if (fps === this.frameRate) return;
		this.frameRate = fps;
		setProjectFrameRate(fps);
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	applyProjectResolution(width: number, height: number) {
		if (this.playerAspectRatio.width === width && this.playerAspectRatio.height === height) return;
		this.playerAspectRatio = { width, height };
		let mode: PlayerAspectRatioMode = 'auto';
		for (const presetId of PLAYER_ASPECT_RATIO_PRESETS) {
			const preset = PLAYER_ASPECT_RATIOS[presetId];
			if (Math.abs(width * preset.height - height * preset.width) <= 2) {
				mode = presetId;
				break;
			}
		}
		this.aspectRatioMode = mode;
		const shortEdge = Math.min(width, height);
		const quality = EXPORT_QUALITIES.find((q) => q.height === shortEdge);
		if (quality) this.exportQuality = quality;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	async restorePendingProject() {
		const project = this.pendingRestoreProject;
		if (!project || this.isRestoringProject) return;
		disposeRestoredMedia();
		this.isRestoringProject = true;
		try {
			const activeLoadSequence = this.projectLoadSequence + 1;
			this.projectLoadSequence = activeLoadSequence;
			const restoredMedia = await restoreMediaAssets(project.mediaAssets);
			if (this.projectLoadSequence !== activeLoadSequence) return;
			this.applyProjectDocument({ ...project, mediaAssets: restoredMedia });
			void this.refreshMissingAssetMetadata(restoredMedia, this.projectLoadSequence);
			this.autoSaveEnabled = true;
			this.pendingRestoreProject = null;
		} catch {
			this.projectNotice = 'Project could not be restored';
			sound.error();
		} finally {
			this.isRestoringProject = false;
		}
	}

	dismissPendingProject() {
		this.pendingRestoreProject = null;
	}

	async restoreVersion(version: ProjectVersion) {
		if (this.isRestoringVersion) return;
		disposeRestoredMedia();
		this.isRestoringVersion = true;
		sound.notification();
		try {
			const restoredMedia = await restoreMediaAssets(version.document.mediaAssets);
			this.applyProjectDocument({ ...version.document, mediaAssets: restoredMedia });
			void this.refreshMissingAssetMetadata(restoredMedia, this.projectLoadSequence);
			this.autoSaveBlocked = false;
			this.historyDialogOpen = false;
			this.projectNotice = 'Project version restored';
		} catch {
			this.autoSaveBlocked = false;
			this.projectNotice = 'Version could not be restored';
			sound.error();
		} finally {
			this.isRestoringVersion = false;
		}
	}

	// ---- clip property/keyframe ----

	flushClipPropertyChange() {
		this.propertyChangeFrame = null;
		const pending = this.pendingPropertyChange;
		this.pendingPropertyChange = null;
		if (!pending) return;
		const nextTracks = updateClipProperty(this.tracks, pending.clipId, pending.updater);
		if (nextTracks === this.tracks) return;
		this.tracks = nextTracks;
		this.isSaved = false;
		this.autoSaveBlocked = false;
	}

	handleToggleClipReversed(clipId: string) {
		this.clipPropertyChangeRequest = {
			id: this.createEntityId('clip-reverse'),
			clipId,
			updater: (clip) => ({ ...clip, reversed: !(clip.reversed === true) })
		};
	}

	async handleNormalizeAudio(clipId: string) {
		const clip = this.tracks
			.flatMap((track) => track.clips)
			.find((candidate) => candidate.id === clipId);
		const asset = clip?.assetId
			? this.mediaAssets.find((candidate) => candidate.id === clip?.assetId)
			: null;
		if (!clip || !asset) return;
		this.normalizing = true;
		try {
			const volume = await normalizeClipAudio(clip, asset);
			if (volume === null) {
				sound.error();
				return;
			}
			sound.success();
			this.clipPropertyChangeRequest = {
				id: this.createEntityId('clip-normalize'),
				clipId,
				updater: (currentClip) => ({ ...currentClip, volume })
			};
		} finally {
			this.normalizing = false;
		}
	}

	handleClipPropertyChange(clipId: string, updater: (clip: Clip) => Clip) {
		const pending = this.pendingPropertyChange;
		if (pending && pending.clipId !== clipId) this.flushClipPropertyChange();
		const currentPending = this.pendingPropertyChange;
		this.pendingPropertyChange =
			currentPending?.clipId === clipId
				? { clipId, updater: (clip) => updater(currentPending.updater(clip)) }
				: { clipId, updater };
		if (this.propertyChangeFrame !== null) return;
		this.propertyChangeFrame = requestAnimationFrame(() => this.flushClipPropertyChange());
	}

	handleUnlinkClip(clipId: string) {
		const linkedIds = getLinkedClipIds(this.tracks, clipId);
		if (linkedIds.length === 0) return;
		sound.select();
		const unlinkIds = new SvelteSet([clipId, ...linkedIds]);
		const nextTracks = this.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) =>
				unlinkIds.has(clip.id) ? { ...clip, sourceInstanceId: undefined } : clip
			)
		}));
		this.tracks = nextTracks;
		this.isSaved = false;
		this.autoSaveBlocked = false;
		this.projectNotice = 'Linked clips unlinked';
	}

	handleSequenceEdit(clipId: string) {
		const clip = this.tracks.flatMap((track) => track.clips).find((c) => c.id === clipId);
		if (!clip?.sequence) return;
		sound.select();
		this.editingSequenceClipId = clipId;
		this.sequenceEditorOpen = true;
	}

	handleSequenceEditClose() {
		this.sequenceEditorOpen = false;
		this.editingSequenceClipId = null;
	}

	handleSequenceEditSave(updatedClip: Clip) {
		if (!this.editingSequenceClipId) return;
		sound.success();
		const nextTracks = this.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) =>
				clip.id === this.editingSequenceClipId ? updatedClip : clip
			)
		}));
		this.tracks = nextTracks;
		this.isSaved = false;
		this.autoSaveBlocked = false;
		this.sequenceEditorOpen = false;
		this.editingSequenceClipId = null;
	}

	handleAddKeyframe(
		clipId: string,
		property: KeyframeProperty,
		value: number,
		requestedTime?: number
	) {
		this.handleClipPropertyChange(clipId, (clip) => {
			const clipTime = Math.min(clip.duration, Math.max(0, requestedTime ?? this.playerClipTime));
			return upsertClipKeyframes(
				clip,
				clipTime,
				KEYFRAME_PROPERTIES.map((candidate) => ({
					id: this.createEntityId(`keyframe-${candidate}`),
					property: candidate,
					value: candidate === property ? value : getClipKeyframeValue(clip, clipTime, candidate)
				}))
			);
		});
	}

	handleAddKeyframes(clipId: string, properties: KeyframeProperty[], requestedTime: number) {
		this.handleClipPropertyChange(clipId, (clip) => {
			const clipTime = Math.min(clip.duration, Math.max(0, requestedTime));
			return upsertClipKeyframes(
				clip,
				clipTime,
				properties.map((property) => ({
					id: this.createEntityId(`keyframe-${property}`),
					property,
					value: getClipKeyframeValue(clip, clipTime, property)
				}))
			);
		});
	}

	handleRemoveKeyframesAtTime(clipId: string, time: number) {
		this.handleClipPropertyChange(clipId, (clip) => removeClipKeyframesAtTime(clip, time));
	}

	// ---- in/out points ----

	handleRippleModeToggle(enabled: boolean) {
		this.rippleMode = enabled;
	}

	handleSetInPoint() {
		this.inOutPoints = { ...this.inOutPoints, in: roundToFrame(this.currentTime) };
	}

	handleSetOutPoint() {
		this.inOutPoints = { ...this.inOutPoints, out: roundToFrame(this.currentTime) };
	}

	handleClearInOutPoints() {
		this.inOutPoints = { in: null, out: null };
	}

	handleInOutPointsChange(points: { in: number | null; out: number | null }) {
		this.inOutPoints = points;
	}

	handleHistoryAvailabilityChange(undoAvailable: boolean, redoAvailable: boolean) {
		this.canUndo = undoAvailable;
		this.canRedo = redoAvailable;
	}

	handleCreateTextAt(trackId: string, startTime: number) {
		this.addTimelineClip(
			TEXT_PRESETS[0].name,
			DEFAULT_ASSET_DURATION,
			trackId,
			startTime,
			undefined,
			'video',
			TEXT_PRESETS[0].textStyle
		);
	}

	// ---- version history ----

	async loadVersionHistory() {
		if (this.versionsLoaded) return;
		this.versionsLoaded = true;
		try {
			const storedVersions = await loadVersions();
			this.versions = storedVersions.flatMap((version) => {
				if (!isVersionRecord(version)) return [];
				const document = parseProjectDocument(version.document);
				if (!document) return [];
				return [
					{
						id: version.id,
						createdAt: document.updatedAt,
						document,
						thumbnail:
							typeof (version as Record<string, unknown>).thumbnail === 'string'
								? ((version as Record<string, unknown>).thumbnail as string)
								: undefined
					}
				];
			});
			void this.backfillVersionThumbnails();
		} catch {
			this.versions = [];
			this.versionsLoaded = false;
		}
	}

	async generateVersionThumbnail(
		version: ProjectVersion,
		tracksList = version.document.tracks,
		assets = version.document.mediaAssets
	): Promise<void> {
		if (this.thumbnailPendingIds.has(version.id)) return;
		const firstTime = getFirstVisualClipTime(tracksList);
		if (firstTime === null) return;
		this.thumbnailPendingIds.add(version.id);
		try {
			const aspect = version.document.aspectRatio;
			const height =
				aspect.width > 0 && aspect.height > 0
					? Math.max(1, Math.round((THUMBNAIL_WIDTH * aspect.height) / aspect.width))
					: Math.round((THUMBNAIL_WIDTH * 9) / 16);
			const blob = await exportFrame({
				tracks: tracksList,
				mediaAssets: assets,
				time: firstTime,
				resolution: { width: THUMBNAIL_WIDTH, height },
				format: 'jpeg',
				quality: 0.8
			});
			if (!blob) return;
			const dataUrl = await blobToDataUrl(blob);
			this.versions = this.versions.map((candidate) =>
				candidate.id === version.id ? { ...candidate, thumbnail: dataUrl } : candidate
			);
			await saveVersions(this.versions);
		} catch {
			// thumbnails are best-effort; keep the placeholder when rendering fails
		} finally {
			this.thumbnailPendingIds.delete(version.id);
		}
	}

	async backfillVersionThumbnails() {
		for (const version of this.versions) {
			if (version.thumbnail || this.thumbnailPendingIds.has(version.id)) continue;
			if (getFirstVisualClipTime(version.document.tracks) === null) continue;
			const restored = await restoreMediaAssets(version.document.mediaAssets);
			const restoredUrls = restored
				.map((asset) => asset.src)
				.filter((src) => src.startsWith('blob:'));
			try {
				await this.generateVersionThumbnail(version, version.document.tracks, restored);
			} finally {
				for (const url of restoredUrls) URL.revokeObjectURL(url);
			}
		}
	}

	// ---- event handlers ----

	private handleBeforeUnload(e: BeforeUnloadEvent) {
		if (!this.isSaved) {
			e.preventDefault();
		}
	}

	private handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (!this.isSaved && !this.isSaving) {
				void this.saveProject();
			}
		}
	}

	private handleGlobalMouseDown(e: MouseEvent) {
		if (!this.propertiesPanelOpen) return;
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (target.closest('[data-properties-panel]')) return;
		if (target.closest('[data-timeline-root]')) return;
		this.propertiesPanelOpen = false;
	}

	// ---- lifecycle ----

	init() {
		onMount(async () => {
			const loadSequence = this.projectLoadSequence + 1;
			this.projectLoadSequence = loadSequence;
			const storedProjectPromise = loadProject();
			try {
				const storedProject = await storedProjectPromise;
				if (storedProject && this.projectLoadSequence === loadSequence) {
					this.pendingRestoreProject = storedProject;
				}
			} catch {
				if (this.projectLoadSequence === loadSequence) this.autoSaveEnabled = false;
			}
		});

		// starting timeline playback silences the source monitor
		$effect(() => {
			if (this.isPlaying) this.sourceIsPlaying = false;
		});

		// close the panel when its media is removed
		$effect(() => {
			if (this.sourceMonitorOpen && !this.sourceAsset) this.closeSourceMonitor();
		});

		$effect(() => {
			if (this.isSaved || !this.autoSaveEnabled || this.isSaving || this.autoSaveBlocked) return;
			const timer = setTimeout(() => {
				if (!this.isSaved && !this.isSaving) {
					void this.saveProject();
				}
			}, 2000);
			return () => clearTimeout(timer);
		});

		$effect(() => {
			if (!this.projectNotice) return;
			const timer = setTimeout(() => {
				this.projectNotice = null;
			}, 5000);
			return () => clearTimeout(timer);
		});

		$effect(() => {
			window.addEventListener('beforeunload', this.handleBeforeUnload);
			window.addEventListener('keydown', this.handleGlobalKeydown);
			window.addEventListener('mousedown', this.handleGlobalMouseDown);
			return () => {
				window.removeEventListener('beforeunload', this.handleBeforeUnload);
				window.removeEventListener('keydown', this.handleGlobalKeydown);
				window.removeEventListener('mousedown', this.handleGlobalMouseDown);
			};
		});

		// keep the live engine's track/master settings in sync
		$effect(() => {
			const snapshot = this.tracks;
			for (const track of snapshot) {
				audioEngine.setTrackVolume(track.id, track.volume ?? 1);
				audioEngine.setTrackPan(track.id, track.pan ?? 0);
				const fx = track.effects;
				if (fx) {
					audioEngine.setTrackEq(track.id, fx.eqLow, fx.eqMid, fx.eqHigh);
					audioEngine.setTrackCompressor(track.id, fx.compressorThreshold, fx.compressorRatio);
					audioEngine.setTrackReverb(track.id, fx.reverbAmount);
				} else {
					audioEngine.setTrackEq(
						track.id,
						DEFAULT_TRACK_AUDIO_EFFECTS.eqLow,
						DEFAULT_TRACK_AUDIO_EFFECTS.eqMid,
						DEFAULT_TRACK_AUDIO_EFFECTS.eqHigh
					);
					audioEngine.setTrackCompressor(
						track.id,
						DEFAULT_TRACK_AUDIO_EFFECTS.compressorThreshold,
						DEFAULT_TRACK_AUDIO_EFFECTS.compressorRatio
					);
					audioEngine.setTrackReverb(track.id, DEFAULT_TRACK_AUDIO_EFFECTS.reverbAmount);
				}
			}
			audioEngine.setMasterVolume(this.mixerMasterVolume);
		});

		onDestroy(() => {
			if (this.propertyChangeFrame !== null) cancelAnimationFrame(this.propertyChangeFrame);
			this.propertyChangeFrame = null;
			this.pendingPropertyChange = null;
		});
	}

	// re-export for template convenience
	readonly PROJECT_RESOLUTIONS = PROJECT_RESOLUTIONS;
	readonly FRAME_RATE_OPTIONS = FRAME_RATE_OPTIONS;
	readonly EXPORT_QUALITIES = EXPORT_QUALITIES;
	readonly CAPTION_PRESETS = CAPTION_PRESETS;
}
