<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import MobileNotice from '../../components/MobileNotice.svelte';
	import Navbar from '../../components/editor/Navbar.svelte';
	import Player from '../../components/editor/Player.svelte';
	import PropertiesPanel from '../../components/editor/PropertiesPanel.svelte';
	import Sidebar from '../../components/editor/Sidebar.svelte';
	import Timeline from '../../components/editor/Timeline.svelte';
	import Toolbar from '../../components/editor/Toolbar.svelte';
	import { sound } from '$lib/sound';
	import { useShortcuts, formatShortcut, type ShortcutBinding } from '$lib/shortcuts';
	import { Button } from '$lib/components/ui/button';
	import * as Command from '$lib/components/ui/command';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Progress } from '$lib/components/ui/progress';
	import { Input } from '$lib/components/ui/input';
	import {
		clampTransitionDuration,
		EFFECT_PRESETS,
		getEffectPreset,
		isClipTransitionPreset,
		type EffectApplyRequest
	} from '$lib/effects';
	import {
		clearProject,
		createProjectSnapshot,
		loadMediaBlob,
		loadProject,
		loadVersions,
		restoreMediaAssets,
		saveProject as saveProjectToDb,
		saveVersions,
		type ProjectDocument,
		type ProjectVersion
	} from '$lib/db';
	import { STICKER_PRESETS, type EditorResource, type MediaAsset } from '$lib/editor/sidebar';
	import { inspectMediaAsset } from '$lib/editor/sidebar';
	import { clampDuckAmountDb } from '$lib/audio/ducking';
	import { normalizeClipAudio } from '$lib/audio/normalize';
	import { TEXT_PRESETS, type TextStyle } from '$lib/editor/text';
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
		History,
		RotateCcw,
		Layers,
		Film,
		MapPin,
		Search,
		Clock,
		Plus,
		FolderOpen,
		Save,
		Download,
		Undo2,
		Redo2,
		PanelLeft,
		ZoomIn,
		ZoomOut,
		Maximize2,
		MousePointer2,
		Scissors,
		Hand,
		Type,
		AlignHorizontalDistributeCenter,
		BetweenHorizontalStart,
		ArrowLeftRight,
		Magnet,
		Workflow,
		Captions,
		AudioLines,
		// effect preset icons
		Vibrate,
		Zap,
		Droplet,
		SunMedium,
		Clapperboard,
		TimerReset,
		MoveRight,
		Scan,
		Square,
		SkipForward,
		Contrast,
		ThermometerSun,
		ThermometerSnowflake,
		Focus,
		Eraser,
		Aperture,
		// transport icons
		ArrowRightToLine,
		ArrowLeftToLine,
		X,
		// sticker icons
		Star,
		Heart,
		Sparkles,
		ArrowRight,
		Check,
		TriangleAlert
	} from '@lucide/svelte';
	import {
		clampBezierControlPoints,
		clampKeyframeValue,
		DEFAULT_BEZIER_POINTS,
		FRAME_RATE,
		getClipKeyframeValue,
		isBlendMode,
		KEYFRAME_PROPERTIES,
		removeClipKeyframesAtTime,
		reconcileClipTransitions,
		roundToFrame,
		sanitizeClipMask,
		updateClipProperty,
		upsertClipKeyframes,
		type ClipInsertRequest,
		type ClipPropertyChangeRequest,
		type Clip,
		type ClipVisualUpdateRequest,
		type TimelineCommandRequest,
		type Track,
		type TrackType,
		type Marker,
		type KeyframeProperty
	} from '$lib/editor/timeline';
	import {
		clampCurvePoints,
		clampFinishFilters,
		clampGradeIntensity,
		clampSecondaryCorrection,
		clampSecondaryPercent,
		clampWheelHue,
		clampWheelSaturation,
		clampWheelStrength,
		cloneColorGrade,
		DEFAULT_COLOR_GRADE,
		DEFAULT_SECONDARY_CORRECTION,
		IDENTITY_CURVE,
		isLutPresetId,
		registerCubeLut,
		type ColorCurvePoint,
		type ColorGrade,
		type ColorWheel,
		type CubeLutRef,
		type FinishFilters,
		type SecondaryCorrection,
		type SecondaryPowerWindow
	} from '$lib/grading';
	import { computeBandStats } from '$lib/grading/scopes';
	import { computeGradeMatch } from '$lib/grading/match';
	import {
		clampChromaSimilarity,
		clampChromaSmoothness,
		clampChromaSpill,
		DEFAULT_CHROMA_KEY
	} from '$lib/chroma';
	import {
		exportVideo,
		exportFrame,
		createFrameRenderer,
		EXPORT_QUALITIES,
		DEFAULT_EXPORT_QUALITY,
		getExportResolution,
		type ExportQuality,
		type ExportProgress
	} from '$lib/export';
	import { PLAYER_ASPECT_RATIO_PRESETS, type PlayerAspectRatioMode } from '$lib/editor/player';

	let projectName = $state('Untitled Project');
	let zoom = $state(100);
	let canUndo = $state(false);
	let canRedo = $state(false);
	let isSaved = $state(true);
	let isSaving = $state(false);
	let autoSaveEnabled = $state(false);
	let sidebarOpen = $state(true);
	let currentTime = $state(0);
	let isPlaying = $state(false);
	let selectedClipId = $state<string | null>(null);
	let mediaAssets = $state<MediaAsset[]>([]);
	let tracks = $state<Track[]>([]);
	let activeTool = $state<EditorTool>('select');
	let snappingEnabled = $state(true);
	let effectRequest = $state<EffectApplyRequest | null>(null);
	let clipInsertRequest = $state<ClipInsertRequest | null>(null);
	let clipPropertyChangeRequest = $state<ClipPropertyChangeRequest | null>(null);
	let visualUpdateRequest = $state<ClipVisualUpdateRequest | null>(null);
	let commandRequest = $state<TimelineCommandRequest | null>(null);
	let historyEpoch = $state(0);
	let playbackRate = $state(1);
	let loopEnabled = $state(false);
	let openProjectInput = $state<HTMLInputElement | null>(null);
	let newProjectDialogOpen = $state(false);
	let shortcutsDialogOpen = $state(false);
	let historyDialogOpen = $state(false);
	let projectNotice = $state<string | null>(null);
	let versions = $state<ProjectVersion[]>([]);
	let versionsLoaded = false;
	let entitySequence = 0;
	let exportQuality = $state<ExportQuality>(DEFAULT_EXPORT_QUALITY);
	let playerAspectRatio = $state<{ width: number; height: number }>({ width: 16, height: 9 });
	let aspectRatioMode = $state<PlayerAspectRatioMode>('auto');
	let isExporting = $state(false);
	let isCapturingFrame = $state(false);
	let matchingClipId = $state<string | null>(null);
	let exportProgress = $state<ExportProgress | null>(null);
	let autoSaveBlocked = $state(false);
	let isRestoringVersion = $state(false);
	let versionSearchQuery = $state('');
	let markers = $state<Marker[]>([]);
	let inOutPoints = $state<{ in: number | null; out: number | null }>({ in: null, out: null });
	let rippleMode = $state(false);
	let propertiesPanelOpen = $state(false);
	let propertyChangeFrame: number | null = null;
	let pendingPropertyChange: { clipId: string; updater: (clip: Clip) => Clip } | null = null;
	let isTranscribing = $state(false);
	let transcribeProgress = $state(0);
	let transcribeFileName = $state<string | null>(null);
	let projectLoadSequence = 0;
	let mediaRestorePromise: Promise<void> | null = null;
	let commandPaletteOpen = $state(false);

	const sortedVersions = $derived([...versions].sort((a, b) => b.createdAt - a.createdAt));
	const exportResolution = $derived(getExportResolution(playerAspectRatio, exportQuality));
	const exportPercent = $derived.by(() => {
		const p = exportProgress;
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
	const filteredVersions = $derived.by(() => {
		const query = versionSearchQuery.trim().toLowerCase();
		if (!query) return sortedVersions;
		return sortedVersions.filter((version) => version.document.name.toLowerCase().includes(query));
	});

	function formatRelativeTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const seconds = Math.floor(diff / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	function getVersionMetadata(doc: ProjectDocument): {
		clips: number;
		tracks: number;
		markers: number;
	} {
		const clips = doc.tracks.reduce((sum, track) => sum + track.clips.length, 0);
		return { clips, tracks: doc.tracks.length, markers: (doc.markers ?? []).length };
	}

	async function loadVersionHistory() {
		if (versionsLoaded) return;
		versionsLoaded = true;

		try {
			const storedVersions = await loadVersions();
			versions = storedVersions.flatMap((version) => {
				if (!isRecord(version) || typeof version.id !== 'string') return [];
				const document = parseProjectDocument(version.document);
				if (!document) return [];
				return [
					{
						id: version.id,
						createdAt: document.updatedAt,
						document,
						thumbnail: typeof version.thumbnail === 'string' ? version.thumbnail : undefined
					}
				];
			});
			void backfillVersionThumbnails();
		} catch {
			versions = [];
			versionsLoaded = false;
		}
	}

	const thumbnailPendingIds = new Set<string>();
	const THUMBNAIL_WIDTH = 320;

	function getFirstVisualClipTime(tracks: Track[]): number | null {
		let firstTime: number | null = null;
		for (const track of tracks) {
			if (track.type === 'audio') continue;
			for (const clip of track.clips) {
				if (firstTime === null || clip.startTime < firstTime) firstTime = clip.startTime;
			}
		}
		return firstTime;
	}

	function blobToDataUrl(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(blob);
		});
	}

	// render the first visual frame of a snapshot through the export pipeline and
	// persist it with the version. best-effort: never blocks saving, never rejects.
	async function generateVersionThumbnail(
		version: ProjectVersion,
		tracksList = version.document.tracks,
		assets = version.document.mediaAssets
	): Promise<void> {
		if (thumbnailPendingIds.has(version.id)) return;
		const firstTime = getFirstVisualClipTime(tracksList);
		if (firstTime === null) return;
		thumbnailPendingIds.add(version.id);
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
			versions = versions.map((candidate) =>
				candidate.id === version.id ? { ...candidate, thumbnail: dataUrl } : candidate
			);
			await saveVersions(versions);
		} catch {
			// thumbnails are best-effort; keep the placeholder when rendering fails
		} finally {
			thumbnailPendingIds.delete(version.id);
		}
	}

	// generate thumbnails for versions saved before this feature existed; their blob
	// URLs are stale after a reload, so media is restored from IndexedDB first
	async function backfillVersionThumbnails() {
		for (const version of versions) {
			if (version.thumbnail || thumbnailPendingIds.has(version.id)) continue;
			if (getFirstVisualClipTime(version.document.tracks) === null) continue;
			const restored = await restoreMediaAssets(version.document.mediaAssets);
			const restoredUrls = restored
				.map((asset) => asset.src)
				.filter((src) => src.startsWith('blob:'));
			try {
				await generateVersionThumbnail(version, version.document.tracks, restored);
			} finally {
				for (const url of restoredUrls) URL.revokeObjectURL(url);
			}
		}
	}

	const selectedClip = $derived(
		tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? null
	);
	const matchSources = $derived(
		tracks
			.flatMap((track) => track.clips)
			.filter((clip) => clip.id !== selectedClipId && Boolean(clip.assetId))
			.map((clip) => ({ id: clip.id, name: clip.name }))
	);
	const playerClipTime = $derived(
		selectedClip
			? Math.min(selectedClip.duration, Math.max(0, currentTime - selectedClip.startTime))
			: 0
	);
	const selectedClipIsAudio = $derived(
		Boolean(
			selectedClip &&
			selectedClip.assetId &&
			mediaAssets.some((asset) => asset.id === selectedClip.assetId && asset.kind === 'audio')
		)
	);
	const selectedClipHasAudio = $derived(
		Boolean(
			selectedClip?.assetId &&
			mediaAssets.some(
				(asset) =>
					asset.id === selectedClip?.assetId && (asset.kind === 'audio' || asset.kind === 'video')
			)
		)
	);

	const MIN_TIMELINE_DURATION = 30;
	const TIMELINE_TAIL_DURATION = 30;
	const DEFAULT_ASSET_DURATION = 5;
	const PROJECT_FORMAT = 'viko-project';
	const PROJECT_VERSION = 1;
	const MAX_VERSIONS = 20;
	const MAX_PROJECT_TIME = 24 * 60 * 60;
	const MAX_PROJECT_TRACKS = 200;
	const MAX_TRACK_CLIPS = 10_000;
	const MAX_PROJECT_ASSETS = 5_000;
	const SAFE_COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
	const editorResources: EditorResource[] = [
		...TEXT_PRESETS,
		...STICKER_PRESETS,
		...EFFECT_PRESETS
	];

	type PaletteCommand = {
		id: string;
		label: string;
		keywords?: string;
		group: string;
		hint?: string;
		icon?: typeof History;
		disabled?: () => boolean;
		run: () => void;
	};

	const paletteToolOptions: { id: EditorTool; label: string; icon: typeof History }[] = [
		{ id: 'select', label: 'Selection tool', icon: MousePointer2 },
		{ id: 'razor', label: 'Razor tool', icon: Scissors },
		{ id: 'hand', label: 'Hand tool', icon: Hand },
		{ id: 'text', label: 'Text tool', icon: Type },
		{ id: 'slip', label: 'Slip tool', icon: AlignHorizontalDistributeCenter },
		{ id: 'rolling', label: 'Rolling edit tool', icon: BetweenHorizontalStart },
		{ id: 'slide', label: 'Slide tool', icon: ArrowLeftRight }
	];

	const stickerIconBySymbol: Record<string, typeof History> = {
		'★': Star,
		'♥': Heart,
		'✦': Sparkles,
		'➜': ArrowRight,
		'✓': Check,
		'!': TriangleAlert
	};

	const effectIconByPresetId: Record<string, typeof History> = {
		'effect-shake': Vibrate,
		'effect-glitch': Zap,
		'effect-zoom-pulse': Focus,
		'effect-soft-blur': Droplet,
		'effect-flicker': SunMedium,
		'effect-drift': Clapperboard,
		'transition-fade': TimerReset,
		'transition-dissolve': Sparkles,
		'transition-slide': MoveRight,
		'transition-zoom': Scan,
		'clip-transition-cross-dissolve': Square,
		'clip-transition-wipe': Eraser,
		'clip-transition-push': SkipForward,
		'filter-vintage': Film,
		'filter-monochrome': Contrast,
		'filter-warm': ThermometerSun,
		'filter-cool': ThermometerSnowflake,
		'filter-high-contrast': Aperture
	};

	const paletteCommands: PaletteCommand[] = [
		// file
		{
			id: 'palette-new-project',
			label: 'New Project',
			keywords: 'create clear reset',
			group: 'File',
			icon: Plus,
			run: () => {
				newProjectDialogOpen = true;
			}
		},
		{
			id: 'palette-open-project',
			label: 'Open Project',
			keywords: 'import load',
			group: 'File',
			icon: FolderOpen,
			run: () => openProjectInput?.click()
		},
		{
			id: 'palette-save',
			label: 'Save',
			keywords: 'store persist',
			group: 'File',
			hint: formatShortcut({ key: 's', ctrlOrMeta: true }),
			icon: Save,
			disabled: () => isSaved || isSaving,
			run: () => void saveProject()
		},
		{
			id: 'palette-save-as',
			label: 'Save As',
			keywords: 'export project file download',
			group: 'File',
			hint: formatShortcut({ key: 's', ctrlOrMeta: true, shift: true }),
			icon: Download,
			run: () => downloadProject()
		},
		{
			id: 'palette-export',
			label: 'Export Video',
			keywords: 'render mp4 movie',
			group: 'File',
			hint: formatShortcut({ key: 'e', ctrlOrMeta: true }),
			icon: Download,
			disabled: () => !isSaved || isExporting,
			run: () => void handleExportVideo()
		},
		{
			id: 'palette-version-history',
			label: 'Version History',
			keywords: 'restore snapshot versions',
			group: 'File',
			icon: History,
			run: () => {
				versionSearchQuery = '';
				historyDialogOpen = true;
				void loadVersionHistory();
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
			disabled: () => !canUndo,
			run: () => requestTimelineCommand('undo')
		},
		{
			id: 'palette-redo',
			label: 'Redo',
			keywords: 'forward repeat',
			group: 'Edit',
			hint: formatShortcut({ key: 'z', ctrlOrMeta: true, shift: true }),
			icon: Redo2,
			disabled: () => !canRedo,
			run: () => requestTimelineCommand('redo')
		},
		// view
		{
			id: 'palette-toggle-sidebar',
			label: 'Toggle Sidebar',
			keywords: 'panel show hide media',
			group: 'View',
			hint: formatShortcut({ key: 'b', ctrlOrMeta: true }),
			icon: PanelLeft,
			run: () => toggleSidebar()
		},
		{
			id: 'palette-zoom-in',
			label: 'Zoom In',
			keywords: 'timeline magnify',
			group: 'View',
			hint: formatShortcut({ key: '+', ctrlOrMeta: true }),
			icon: ZoomIn,
			run: () => {
				zoom = clampTimelineZoom(zoom + TIMELINE_ZOOM_STEP);
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
				zoom = clampTimelineZoom(zoom - TIMELINE_ZOOM_STEP);
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
				zoom = 100;
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
			run: () => handleSetInPoint()
		},
		{
			id: 'palette-set-out',
			label: 'Set Out Point',
			keywords: 'mark range end',
			group: 'Transport',
			hint: 'O',
			icon: ArrowLeftToLine,
			run: () => handleSetOutPoint()
		},
		{
			id: 'palette-clear-in-out',
			label: 'Clear In/Out Points',
			keywords: 'remove range marks',
			group: 'Transport',
			hint: formatShortcut({ key: 'i', ctrlOrMeta: true, shift: true }),
			icon: X,
			run: () => handleClearInOutPoints()
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
				activeTool = tool.id;
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
				snappingEnabled = !snappingEnabled;
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
				handleRippleModeToggle(!rippleMode);
			}
		},
		// insert (text + stickers)
		...TEXT_PRESETS.map((preset) => ({
			id: `palette-insert-${preset.id}`,
			label: `Add ${preset.name} Text`,
			keywords: `text title insert ${preset.category}`,
			group: 'Insert',
			icon: Type,
			run: () => applyResource(preset)
		})),
		...STICKER_PRESETS.map((preset) => ({
			id: `palette-insert-${preset.id}`,
			label: `Add ${preset.name} Sticker`,
			keywords: `sticker symbol insert ${preset.category}`,
			group: 'Insert',
			icon: preset.sticker ? (stickerIconBySymbol[preset.sticker] ?? Star) : Star,
			run: () => applyResource(preset)
		})),
		// effects
		...EFFECT_PRESETS.map((preset) => ({
			id: `palette-effect-${preset.id}`,
			label: `Apply ${preset.name}`,
			keywords: `${preset.kind} effect filter transition ${preset.category}`,
			group: 'Effects',
			icon: effectIconByPresetId[preset.id] ?? Sparkles,
			run: () => applyResource(preset)
		})),
		// captions
		{
			id: 'palette-generate-captions',
			label: 'Generate Captions',
			keywords: 'subtitle captions transcript',
			group: 'Captions',
			icon: Captions,
			run: () => {
				handleGenerateCaptions({
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
			disabled: () => isTranscribing,
			run: () => {
				void handleTranscribeMedia(CAPTION_PRESETS[0]?.id ?? '');
			}
		}
	];

	const paletteVersionCommands = $derived<PaletteCommand[]>(
		sortedVersions.slice(0, 5).map((version) => ({
			id: `palette-version-${version.id}`,
			label: version.document.name,
			keywords: 'restore snapshot version',
			group: 'Versions',
			hint: formatRelativeTime(version.createdAt),
			run: () => void restoreVersion(version)
		}))
	);

	const paletteGroups = $derived.by(() => {
		const all = [...paletteCommands, ...paletteVersionCommands];
		const order: string[] = [];
		for (const cmd of all) {
			if (!order.includes(cmd.group)) order.push(cmd.group);
		}
		return order.map((group) => ({
			group,
			items: all.filter((cmd) => cmd.group === group)
		}));
	});

	function runPaletteCommand(cmd: PaletteCommand) {
		sound.select();
		cmd.run();
		commandPaletteOpen = false;
	}

	const paletteShortcut: ShortcutBinding = {
		key: 'k',
		ctrlOrMeta: true,
		description: 'Command Palette',
		ignoreWhenTyping: true,
		onKeyDown: () => {
			commandPaletteOpen = true;
		}
	};

	const paletteBindings: ShortcutBinding[] = [paletteShortcut];
	const allowedFonts = new Set(TEXT_PRESETS.map((preset) => preset.textStyle.fontFamily));
	const allowedStickers = new Set(STICKER_PRESETS.map((preset) => preset.sticker));
	const timelineContentEnd = $derived(
		Math.max(
			0,
			...tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration))
		)
	);
	const timelineDuration = $derived(
		timelineContentEnd > 0
			? Math.max(MIN_TIMELINE_DURATION, timelineContentEnd + TIMELINE_TAIL_DURATION)
			: MIN_TIMELINE_DURATION
	);
	const usedAssetIds = $derived(
		tracks
			.flatMap((track) => track.clips)
			.reduce<string[]>((assetIds, clip) => {
				if (!clip.assetId || assetIds.includes(clip.assetId)) return assetIds;
				return [...assetIds, clip.assetId];
			}, [])
	);
	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
	}

	function requestTimelineCommand(command: TimelineCommandRequest['command']) {
		commandRequest = { id: createEntityId('timeline-command'), command };
	}

	function createEntityId(prefix: string): string {
		entitySequence += 1;
		return `${prefix}-${Date.now()}-${entitySequence}`;
	}

	function addTimelineClip(
		name: string,
		clipDuration = DEFAULT_ASSET_DURATION,
		targetTrackId?: string,
		startTime = currentTime,
		assetId?: string,
		trackType: TrackType = 'video',
		textStyle?: TextStyle,
		sticker?: string,
		sourceDuration?: number,
		createTrack = false,
		trackName?: string
	) {
		const duration = Number.isFinite(clipDuration)
			? Math.max(clipDuration, 1 / FRAME_RATE)
			: DEFAULT_ASSET_DURATION;
		const clipId = createEntityId('clip');
		const clip: Clip = {
			id: clipId,
			name,
			startTime: roundToFrame(startTime),
			duration,
			assetId,
			sourceInstanceId: clipId,
			sourceDuration,
			textStyle,
			sticker,
			stickerColor: sticker ? '#ffffff' : undefined
		};
		clipInsertRequest = {
			id: createEntityId('clip-insert'),
			clips: [clip],
			targetTrackId,
			trackType,
			createTrack,
			trackName
		};
	}

	function applyResource(resource: EditorResource) {
		if (resource.kind === 'text' && resource.textStyle) {
			addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				undefined,
				currentTime,
				undefined,
				'video',
				resource.textStyle,
				undefined,
				undefined,
				true,
				resource.name
			);
			return;
		}
		if (resource.kind === 'stickers' && resource.sticker) {
			addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				undefined,
				currentTime,
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
		if (!selectedClipId) {
			projectNotice = 'Select an unlocked clip before applying an effect';
			return;
		}
		effectRequest = { id: createEntityId('effect-request'), presetId: resource.id };
	}

	function createDefaultText() {
		const preset = TEXT_PRESETS[0];
		addTimelineClip(
			preset.name,
			DEFAULT_ASSET_DURATION,
			undefined,
			currentTime,
			undefined,
			'video',
			preset.textStyle,
			undefined,
			undefined,
			true,
			preset.name
		);
	}

	function findCaptionSourceWindow(): {
		startTime: number;
		duration: number;
		assetId: string;
		name: string;
	} | null {
		const allClips = tracks.flatMap((track) => track.clips);
		const selectedMediaClip =
			allClips.find((clip) => clip.id === selectedClipId && Boolean(clip.assetId)) ?? null;
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
					currentTime >= clip.startTime &&
					currentTime < clip.startTime + clip.duration
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

	function insertCaptionSegments(segments: CaptionSegment[], preset: CaptionPreset) {
		const clips = buildCaptionClips(segments, preset, createEntityId);
		clipInsertRequest = {
			id: createEntityId('clip-insert'),
			clips,
			trackType: 'subtitle',
			createTrack: true,
			trackName: 'Captions'
		};
		projectNotice = `Captions added (${clips.length} segments)`;
	}

	function handleGenerateCaptions(payload: CaptionGeneratePayload) {
		const transcript = payload.transcript.trim().slice(0, 20_000);
		if (!transcript) {
			projectNotice = 'Paste a transcript before generating captions';
			return;
		}
		const preset = getCaptionPreset(payload.presetId);
		if (!preset) {
			projectNotice = 'Caption style is not supported';
			return;
		}
		const sourceWindow = findCaptionSourceWindow();
		const window = sourceWindow ?? {
			startTime: currentTime,
			duration: estimateCaptionDuration(transcript)
		};
		const segments = splitTranscriptIntoSegments(transcript, window.duration).map((segment) => ({
			...segment,
			startTime: roundToFrame(window.startTime + segment.startTime)
		}));
		if (segments.length === 0) {
			projectNotice = 'Transcript is empty';
			return;
		}
		insertCaptionSegments(segments, preset);
	}

	// resolve the current in-memory blob first, then fall back to the persisted copy
	async function resolveAssetBlob(assetId: string): Promise<Blob | null> {
		const asset = mediaAssets.find((candidate) => candidate.id === assetId);
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

	async function handleTranscribeMedia(presetId: string) {
		if (isTranscribing) return;
		const preset = getCaptionPreset(presetId);
		if (!preset) {
			projectNotice = 'Caption style is not supported';
			return;
		}
		const sourceWindow = findCaptionSourceWindow();
		if (!sourceWindow) {
			projectNotice = 'Select a media clip or position the playhead over one to transcribe';
			return;
		}
		const media = await resolveAssetBlob(sourceWindow.assetId);
		if (!media) {
			projectNotice = 'Media for this clip is no longer available';
			return;
		}
		isTranscribing = true;
		transcribeProgress = 0;
		transcribeFileName = null;
		const processingCue = sound.processing();
		try {
			projectNotice = 'Transcribing media, this may take a moment';
			const segments = await transcribeMedia(
				{ assetId: sourceWindow.assetId, name: sourceWindow.name, media },
				{
					onProgress: (progress, fileName) => {
						transcribeProgress = Math.max(0, Math.min(100, Math.round(progress)));
						transcribeFileName = fileName;
					}
				}
			);
			if (segments.length === 0) {
				projectNotice = 'No speech detected in this clip';
				sound.error();
				return;
			}
			const offsetSegments = segments.map((segment) => ({
				...segment,
				startTime: roundToFrame(sourceWindow.startTime + segment.startTime)
			}));
			// keep captions inside the media clip, shrinking the last segment if needed
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
			insertCaptionSegments(offsetSegments, preset);
			sound.complete();
		} catch (error) {
			projectNotice = error instanceof Error ? error.message : 'Transcription failed';
			sound.error();
		} finally {
			processingCue?.stop();
			isTranscribing = false;
			transcribeProgress = 0;
			transcribeFileName = null;
		}
	}

	function dropMediaAsset(
		assetId: string,
		trackId: string,
		startTime: number,
		createTrack = false
	) {
		const asset = mediaAssets.find((candidate) => candidate.id === assetId);
		if (!asset) return;
		addTimelineClip(
			asset.name,
			asset.duration ?? DEFAULT_ASSET_DURATION,
			trackId,
			startTime,
			asset.id,
			asset.kind === 'audio' ? 'audio' : 'video',
			undefined,
			undefined,
			asset.kind === 'image' ? undefined : (asset.duration ?? undefined),
			createTrack,
			createTrack ? asset.name : undefined
		);
	}

	function dropEditorResource(resourceId: string, trackId: string, startTime: number) {
		const resource = editorResources.find((candidate) => candidate.id === resourceId);
		if (!resource) return;
		if (resource.kind === 'text' && resource.textStyle) {
			addTimelineClip(
				resource.name,
				DEFAULT_ASSET_DURATION,
				trackId,
				startTime,
				undefined,
				'video',
				resource.textStyle
			);
			return;
		}
		if (resource.kind !== 'stickers' || !resource.sticker) return;
		addTimelineClip(
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

	function handleMediaAssetsChange(assets: MediaAsset[]) {
		mediaAssets = assets;
		isSaved = false;
		autoSaveBlocked = false;
	}

	function handleTracksChange(nextTracks: Track[]) {
		tracks = nextTracks;
		isSaved = false;
		autoSaveBlocked = false;
	}

	function requestVisualUpdate(
		clipId: string,
		update: Pick<ClipVisualUpdateRequest, 'transform' | 'color'>
	) {
		const clip = tracks
			.flatMap((track) => track.clips)
			.find((candidate) => candidate.id === clipId);
		visualUpdateRequest = {
			id: createEntityId('visual-update'),
			clipId,
			clipTime: clip
				? Math.min(clip.duration, Math.max(0, currentTime - clip.startTime))
				: undefined,
			...update
		};
	}

	function isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	function isValidAspectRatio(value: unknown): value is { width: number; height: number } {
		return (
			isRecord(value) &&
			typeof value.width === 'number' &&
			Number.isFinite(value.width) &&
			value.width > 0 &&
			typeof value.height === 'number' &&
			Number.isFinite(value.height) &&
			value.height > 0
		);
	}

	function sanitizeWheel(value: unknown): ColorWheel {
		if (!isRecord(value)) return { hue: 0, saturation: 0, strength: 0 };
		return {
			hue: typeof value.hue === 'number' ? clampWheelHue(value.hue) : 0,
			saturation: typeof value.saturation === 'number' ? clampWheelSaturation(value.saturation) : 0,
			strength: typeof value.strength === 'number' ? clampWheelStrength(value.strength) : 0
		};
	}

	function sanitizeCurve(value: unknown): ColorCurvePoint[] | null {
		if (!Array.isArray(value)) return null;
		const points: ColorCurvePoint[] = [];
		for (const point of value) {
			if (points.length >= 17) break;
			if (!isRecord(point)) continue;
			if (typeof point.x !== 'number' || typeof point.y !== 'number') continue;
			if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
			points.push({ x: point.x, y: point.y });
		}
		if (points.length < 2) return null;
		return clampCurvePoints(points);
	}

	function sanitizeSecondary(value: unknown): SecondaryCorrection {
		if (!isRecord(value)) return { ...DEFAULT_SECONDARY_CORRECTION };
		const windowValue = isRecord(value.window) ? value.window : {};
		const window: SecondaryPowerWindow = {
			type:
				windowValue.type === 'ellipse' || windowValue.type === 'rect' ? windowValue.type : 'full',
			cx: clampSecondaryPercent(typeof windowValue.cx === 'number' ? windowValue.cx : 50, 50),
			cy: clampSecondaryPercent(typeof windowValue.cy === 'number' ? windowValue.cy : 50, 50),
			width: clampSecondaryPercent(
				typeof windowValue.width === 'number' ? windowValue.width : 100,
				100
			),
			height: clampSecondaryPercent(
				typeof windowValue.height === 'number' ? windowValue.height : 100,
				100
			),
			feather: clampSecondaryPercent(
				typeof windowValue.feather === 'number' ? windowValue.feather : 20,
				20
			)
		};
		return clampSecondaryCorrection({
			enabled: value.enabled === true,
			hue: typeof value.hue === 'number' ? value.hue : DEFAULT_SECONDARY_CORRECTION.hue,
			hueRange:
				typeof value.hueRange === 'number' ? value.hueRange : DEFAULT_SECONDARY_CORRECTION.hueRange,
			satCenter:
				typeof value.satCenter === 'number'
					? value.satCenter
					: DEFAULT_SECONDARY_CORRECTION.satCenter,
			satRange:
				typeof value.satRange === 'number' ? value.satRange : DEFAULT_SECONDARY_CORRECTION.satRange,
			lumaCenter:
				typeof value.lumaCenter === 'number'
					? value.lumaCenter
					: DEFAULT_SECONDARY_CORRECTION.lumaCenter,
			lumaRange:
				typeof value.lumaRange === 'number'
					? value.lumaRange
					: DEFAULT_SECONDARY_CORRECTION.lumaRange,
			softness:
				typeof value.softness === 'number' ? value.softness : DEFAULT_SECONDARY_CORRECTION.softness,
			lumaWeight:
				typeof value.lumaWeight === 'number'
					? value.lumaWeight
					: DEFAULT_SECONDARY_CORRECTION.lumaWeight,
			hueShift:
				typeof value.hueShift === 'number' ? value.hueShift : DEFAULT_SECONDARY_CORRECTION.hueShift,
			saturation:
				typeof value.saturation === 'number'
					? value.saturation
					: DEFAULT_SECONDARY_CORRECTION.saturation,
			brightness:
				typeof value.brightness === 'number'
					? value.brightness
					: DEFAULT_SECONDARY_CORRECTION.brightness,
			contrast:
				typeof value.contrast === 'number' ? value.contrast : DEFAULT_SECONDARY_CORRECTION.contrast,
			amount: typeof value.amount === 'number' ? value.amount : DEFAULT_SECONDARY_CORRECTION.amount,
			window
		});
	}

	function sanitizeCubeLut(value: unknown): CubeLutRef | null {
		if (!isRecord(value)) return null;
		if (typeof value.name !== 'string' || typeof value.source !== 'string') return null;
		const name = value.name.trim().slice(0, 120);
		const source = value.source.slice(0, 400_000);
		if (!name || !source) return null;
		try {
			const lut = registerCubeLut(name, source);
			return { id: lut.id, name: lut.name, source: lut.source };
		} catch {
			return null;
		}
	}

	function sanitizeFinish(value: unknown): FinishFilters {
		if (!isRecord(value)) return { vignette: 0, grain: 0, sharpen: 0, denoise: 0 };
		return clampFinishFilters({
			vignette: typeof value.vignette === 'number' ? value.vignette : 0,
			grain: typeof value.grain === 'number' ? value.grain : 0,
			sharpen: typeof value.sharpen === 'number' ? value.sharpen : 0,
			denoise: typeof value.denoise === 'number' ? value.denoise : 0
		});
	}

	function sanitizeColorGrade(value: unknown): ColorGrade | undefined {
		if (!isRecord(value)) return undefined;
		const identity = [...IDENTITY_CURVE];
		const curves = isRecord(value.curves)
			? {
					master: sanitizeCurve(value.curves.master) ?? identity,
					red: sanitizeCurve(value.curves.red) ?? identity,
					green: sanitizeCurve(value.curves.green) ?? identity,
					blue: sanitizeCurve(value.curves.blue) ?? identity
				}
			: { master: identity, red: identity, green: identity, blue: identity };
		return {
			shadows: sanitizeWheel(value.shadows),
			midtones: sanitizeWheel(value.midtones),
			highlights: sanitizeWheel(value.highlights),
			master: sanitizeWheel(value.master),
			curves,
			lutId: typeof value.lutId === 'string' && isLutPresetId(value.lutId) ? value.lutId : null,
			customLut: sanitizeCubeLut(value.customLut),
			secondary: sanitizeSecondary(value.secondary),
			finish: sanitizeFinish(value.finish),
			intensity: typeof value.intensity === 'number' ? clampGradeIntensity(value.intensity) : 100
		};
	}

	function sanitizeClip(value: unknown): Clip | null {
		if (!isRecord(value)) return null;
		if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
		if (typeof value.startTime !== 'number' || typeof value.duration !== 'number') return null;
		if (!Number.isFinite(value.startTime) || !Number.isFinite(value.duration)) return null;
		if (
			value.startTime < 0 ||
			value.startTime > MAX_PROJECT_TIME ||
			value.duration <= 0 ||
			value.duration > MAX_PROJECT_TIME
		) {
			return null;
		}
		const clipDuration = value.duration;
		const textStyle = isRecord(value.textStyle)
			? {
					fontFamily: value.textStyle.fontFamily,
					fontSize: value.textStyle.fontSize,
					fontWeight: value.textStyle.fontWeight,
					color: value.textStyle.color,
					backgroundColor: value.textStyle.backgroundColor,
					textAlign: value.textStyle.textAlign,
					textTransform: value.textStyle.textTransform
				}
			: null;
		const validTextStyle =
			textStyle &&
			allowedFonts.has(textStyle.fontFamily as TextStyle['fontFamily']) &&
			typeof textStyle.fontSize === 'number' &&
			textStyle.fontSize >= 8 &&
			textStyle.fontSize <= 200 &&
			typeof textStyle.fontWeight === 'number' &&
			textStyle.fontWeight >= 100 &&
			textStyle.fontWeight <= 900 &&
			typeof textStyle.color === 'string' &&
			SAFE_COLOR_PATTERN.test(textStyle.color) &&
			typeof textStyle.backgroundColor === 'string' &&
			(textStyle.backgroundColor === 'transparent' ||
				SAFE_COLOR_PATTERN.test(textStyle.backgroundColor)) &&
			['left', 'center', 'right'].includes(String(textStyle.textAlign)) &&
			['none', 'uppercase'].includes(String(textStyle.textTransform));
		const effects = Array.isArray(value.effects)
			? value.effects.flatMap((effect) => {
					if (!isRecord(effect)) return [];
					if (typeof effect.id !== 'string' || typeof effect.presetId !== 'string') return [];
					if (!getEffectPreset(effect.presetId)) return [];
					return [{ id: effect.id.slice(0, 200), presetId: effect.presetId }];
				})
			: undefined;
		const clipTransition = isRecord(value.clipTransition)
			? {
					presetId:
						typeof value.clipTransition.presetId === 'string'
							? value.clipTransition.presetId
							: null,
					duration:
						typeof value.clipTransition.duration === 'number'
							? value.clipTransition.duration
							: null,
					incomingClipId:
						typeof value.clipTransition.incomingClipId === 'string'
							? value.clipTransition.incomingClipId
							: null
				}
			: null;
		const sanitizedClipTransition = (() => {
			if (!clipTransition) return undefined;
			if (clipTransition.presetId === null || !isClipTransitionPreset(clipTransition.presetId)) {
				return undefined;
			}
			if (clipTransition.duration === null || !Number.isFinite(clipTransition.duration)) {
				return undefined;
			}
			if (clipTransition.incomingClipId === null || clipTransition.incomingClipId.length === 0) {
				return undefined;
			}
			return {
				presetId: clipTransition.presetId,
				duration: clampTransitionDuration(clipTransition.duration),
				incomingClipId: clipTransition.incomingClipId.slice(0, 200)
			};
		})();
		return {
			id: value.id.slice(0, 200),
			name: value.name.trim().slice(0, 500) || 'Untitled clip',
			startTime: roundToFrame(value.startTime),
			duration: Math.max(1 / FRAME_RATE, roundToFrame(clipDuration)),
			assetId: typeof value.assetId === 'string' ? value.assetId.slice(0, 200) : undefined,
			sourceInstanceId:
				typeof value.sourceInstanceId === 'string'
					? value.sourceInstanceId.slice(0, 200)
					: value.id.slice(0, 200),
			sourceStart:
				typeof value.sourceStart === 'number' && value.sourceStart >= 0
					? roundToFrame(value.sourceStart)
					: undefined,
			sourceDuration:
				typeof value.sourceDuration === 'number' &&
				value.sourceDuration > 0 &&
				value.sourceDuration <= MAX_PROJECT_TIME
					? roundToFrame(value.sourceDuration)
					: undefined,
			textStyle: validTextStyle ? (textStyle as TextStyle) : undefined,
			caption: value.caption === true ? true : undefined,
			sticker:
				typeof value.sticker === 'string' && allowedStickers.has(value.sticker)
					? value.sticker
					: undefined,
			stickerColor:
				typeof value.stickerColor === 'string' && SAFE_COLOR_PATTERN.test(value.stickerColor)
					? value.stickerColor
					: undefined,
			visualTransform:
				isRecord(value.visualTransform) &&
				typeof value.visualTransform.x === 'number' &&
				typeof value.visualTransform.y === 'number' &&
				Number.isFinite(value.visualTransform.x) &&
				Number.isFinite(value.visualTransform.y)
					? {
							x: Math.min(150, Math.max(-50, value.visualTransform.x)),
							y: Math.min(150, Math.max(-50, value.visualTransform.y)),
							scale:
								typeof value.visualTransform.scale === 'number' &&
								Number.isFinite(value.visualTransform.scale)
									? Math.min(4, Math.max(0.1, value.visualTransform.scale))
									: 1,
							rotation:
								typeof value.visualTransform.rotation === 'number' &&
								Number.isFinite(value.visualTransform.rotation)
									? Math.min(360, Math.max(-360, value.visualTransform.rotation))
									: 0,
							blendMode: isBlendMode(value.visualTransform.blendMode)
								? value.visualTransform.blendMode
								: 'normal',
							mask: sanitizeClipMask(value.visualTransform.mask) ?? undefined
						}
					: undefined,
			effects,
			clipTransition: sanitizedClipTransition,
			speed:
				typeof value.speed === 'number' && value.speed > 0 && value.speed <= 10
					? value.speed
					: undefined,
			volume:
				typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 4
					? value.volume
					: undefined,
			audioFadeIn:
				typeof value.audioFadeIn === 'number' && value.audioFadeIn >= 0 && value.audioFadeIn <= 5
					? value.audioFadeIn
					: undefined,
			audioFadeOut:
				typeof value.audioFadeOut === 'number' && value.audioFadeOut >= 0 && value.audioFadeOut <= 5
					? value.audioFadeOut
					: undefined,
			duckSource: value.duckSource === true ? true : undefined,
			duckAmountDb:
				typeof value.duckAmountDb === 'number' && Number.isFinite(value.duckAmountDb)
					? clampDuckAmountDb(value.duckAmountDb)
					: undefined,
			reversed: value.reversed === true ? true : undefined,
			frozen: value.frozen === true ? true : undefined,
			opacity:
				typeof value.opacity === 'number' && value.opacity >= 0 && value.opacity <= 1
					? value.opacity
					: undefined,
			colorAdjust: isRecord(value.colorAdjust)
				? {
						brightness:
							typeof value.colorAdjust.brightness === 'number' &&
							value.colorAdjust.brightness >= -100 &&
							value.colorAdjust.brightness <= 100
								? value.colorAdjust.brightness
								: 0,
						contrast:
							typeof value.colorAdjust.contrast === 'number' &&
							value.colorAdjust.contrast >= -100 &&
							value.colorAdjust.contrast <= 100
								? value.colorAdjust.contrast
								: 0,
						saturation:
							typeof value.colorAdjust.saturation === 'number' &&
							value.colorAdjust.saturation >= -100 &&
							value.colorAdjust.saturation <= 100
								? value.colorAdjust.saturation
								: 0,
						hue:
							typeof value.colorAdjust.hue === 'number' &&
							value.colorAdjust.hue >= -180 &&
							value.colorAdjust.hue <= 180
								? value.colorAdjust.hue
								: 0
					}
				: undefined,
			colorGrade: sanitizeColorGrade(value.colorGrade),
			chromaKey: isRecord(value.chromaKey)
				? {
						enabled: value.chromaKey.enabled === true,
						keyColor:
							typeof value.chromaKey.keyColor === 'string' &&
							/^#[0-9a-f]{6}$/i.test(value.chromaKey.keyColor)
								? value.chromaKey.keyColor.toLowerCase()
								: DEFAULT_CHROMA_KEY.keyColor,
						similarity: clampChromaSimilarity(
							typeof value.chromaKey.similarity === 'number'
								? value.chromaKey.similarity
								: DEFAULT_CHROMA_KEY.similarity
						),
						smoothness: clampChromaSmoothness(
							typeof value.chromaKey.smoothness === 'number'
								? value.chromaKey.smoothness
								: DEFAULT_CHROMA_KEY.smoothness
						),
						spillSuppression: clampChromaSpill(
							typeof value.chromaKey.spillSuppression === 'number'
								? value.chromaKey.spillSuppression
								: DEFAULT_CHROMA_KEY.spillSuppression
						)
					}
				: undefined,
			keyframes: Array.isArray(value.keyframes)
				? value.keyframes.flatMap((kf) => {
						if (!isRecord(kf) || typeof kf.id !== 'string') return [];
						if (typeof kf.time !== 'number' || typeof kf.value !== 'number') return [];
						if (!Number.isFinite(kf.time) || !Number.isFinite(kf.value)) return [];
						if (
							typeof kf.property !== 'string' ||
							!KEYFRAME_PROPERTIES.includes(kf.property as KeyframeProperty)
						) {
							return [];
						}
						const property = kf.property as KeyframeProperty;
						return [
							{
								id: kf.id.slice(0, 200),
								time: Math.min(clipDuration, roundToFrame(Math.max(0, kf.time))),
								property,
								value: clampKeyframeValue(property, kf.value),
								easing:
									kf.easing === 'ease-in' || kf.easing === 'ease-out'
										? kf.easing
										: kf.easing === 'ease-in-out'
											? 'ease-in-out'
											: kf.easing === 'bezier'
												? 'bezier'
												: 'linear',
								bezier:
									kf.easing === 'bezier'
										? (clampBezierControlPoints(kf.bezier) ?? DEFAULT_BEZIER_POINTS)
										: undefined
							}
						];
					})
				: undefined,
			groupId: typeof value.groupId === 'string' ? value.groupId.slice(0, 200) : undefined
		};
	}

	function sanitizeTrack(value: unknown): Track | null {
		if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
			return null;
		}
		if (
			value.type !== 'video' &&
			value.type !== 'audio' &&
			value.type !== 'subtitle' &&
			value.type !== 'adjustment'
		) {
			return null;
		}
		if (!Array.isArray(value.clips)) return null;
		const clips = value.clips.slice(0, MAX_TRACK_CLIPS).flatMap((clip) => {
			const sanitized = sanitizeClip(clip);
			return sanitized ? [sanitized] : [];
		});
		const [reconciledTrack] = reconcileClipTransitions([
			{
				id: value.id.slice(0, 200),
				name: value.name.trim().slice(0, 80) || 'Untitled track',
				type: value.type,
				color: typeof value.color === 'string' ? value.color.slice(0, 30) : 'blue',
				clips,
				muted: value.muted === true,
				locked: value.locked === true
			}
		]);
		return reconciledTrack;
	}

	function sanitizeMediaAsset(value: unknown): MediaAsset | null {
		if (!isRecord(value)) return null;
		if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
		if (value.kind !== 'video' && value.kind !== 'audio' && value.kind !== 'image') return null;
		if (
			typeof value.src !== 'string' ||
			value.src.length > 10_000 ||
			!/^(blob:|https?:)/.test(value.src)
		) {
			return null;
		}
		return {
			id: value.id.slice(0, 200),
			name: value.name.trim().slice(0, 255) || 'Untitled asset',
			kind: value.kind,
			src: value.src,
			mimeType: typeof value.mimeType === 'string' ? value.mimeType.slice(0, 200) : '',
			size: typeof value.size === 'number' && value.size >= 0 ? value.size : 0,
			duration: typeof value.duration === 'number' && value.duration > 0 ? value.duration : null,
			width:
				typeof value.width === 'number' &&
				Number.isInteger(value.width) &&
				value.width >= 1 &&
				value.width <= 16384
					? value.width
					: null,
			height:
				typeof value.height === 'number' &&
				Number.isInteger(value.height) &&
				value.height >= 1 &&
				value.height <= 16384
					? value.height
					: null,
			playbackSupported:
				typeof value.playbackSupported === 'boolean' ? value.playbackSupported : null,
			createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now()
		};
	}

	function parseProjectDocument(value: unknown): ProjectDocument | null {
		if (!isRecord(value) || value.format !== PROJECT_FORMAT || value.version !== PROJECT_VERSION) {
			return null;
		}
		if (typeof value.name !== 'string' || !Array.isArray(value.tracks)) return null;
		const rawAssets = Array.isArray(value.mediaAssets) ? value.mediaAssets : [];
		const rawMarkers = Array.isArray(value.markers) ? value.markers : [];
		return {
			format: PROJECT_FORMAT,
			version: PROJECT_VERSION,
			name: value.name.trim().slice(0, 120) || 'Untitled Project',
			tracks: value.tracks.slice(0, MAX_PROJECT_TRACKS).flatMap((track) => {
				const sanitized = sanitizeTrack(track);
				return sanitized ? [sanitized] : [];
			}),
			mediaAssets: rawAssets.slice(0, MAX_PROJECT_ASSETS).flatMap((asset) => {
				const sanitized = sanitizeMediaAsset(asset);
				return sanitized ? [sanitized] : [];
			}),
			markers: rawMarkers.slice(0, 200).flatMap((marker) => {
				if (!isRecord(marker) || typeof marker.id !== 'string' || typeof marker.time !== 'number')
					return [];
				return [
					{
						id: marker.id.slice(0, 200),
						time: Math.max(0, Math.min(MAX_PROJECT_TIME, marker.time)),
						label: typeof marker.label === 'string' ? marker.label.slice(0, 100) : '',
						color: typeof marker.color === 'string' ? marker.color.slice(0, 30) : '#ef4444'
					}
				];
			}),
			aspectRatio: isValidAspectRatio(value.aspectRatio)
				? { width: value.aspectRatio.width, height: value.aspectRatio.height }
				: { width: 16, height: 9 },
			aspectRatioMode:
				typeof value.aspectRatioMode === 'string' &&
				(value.aspectRatioMode === 'auto' ||
					(PLAYER_ASPECT_RATIO_PRESETS as readonly string[]).includes(value.aspectRatioMode))
					? (value.aspectRatioMode as PlayerAspectRatioMode)
					: 'auto',
			updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now()
		};
	}

	function createProjectDocument(): ProjectDocument {
		return {
			format: PROJECT_FORMAT,
			version: PROJECT_VERSION,
			name: projectName,
			tracks,
			mediaAssets,
			markers,
			aspectRatio: { width: playerAspectRatio.width, height: playerAspectRatio.height },
			aspectRatioMode,
			updatedAt: Date.now()
		};
	}

	async function handleExportVideo() {
		if (isExporting) return;
		if (timelineContentEnd <= 0) {
			projectNotice = 'Timeline is empty - add clips to export';
			return;
		}
		isExporting = true;
		try {
			await mediaRestorePromise;
			const exportStartTime = inOutPoints.in ?? 0;
			const exportEndTime = inOutPoints.out ?? timelineContentEnd;
			if (exportEndTime <= exportStartTime) {
				projectNotice = 'Out point must be after in point';
				isExporting = false;
				return;
			}
			const blob = await exportVideo({
				tracks,
				mediaAssets,
				quality: { ...exportQuality, ...exportResolution },
				duration: timelineContentEnd,
				startTime: exportStartTime,
				endTime: exportEndTime,
				onProgress: (progress: ExportProgress) => {
					exportProgress = progress;
					if (progress.phase === 'mixing-audio') {
						projectNotice = 'Mixing audio...';
					}
					if (progress.phase === 'rendering') {
						const pct =
							progress.totalFrames > 0
								? Math.round((progress.frame / progress.totalFrames) * 100)
								: 0;
						projectNotice = `Exporting... ${pct}%`;
					}
					if (progress.phase === 'encoding') {
						projectNotice = progress.message || 'Converting to MP4...';
					}
					if (progress.phase === 'done') {
						projectNotice = 'Export complete';
					}
					if (progress.phase === 'error') {
						projectNotice = 'Export failed';
					}
				}
			});
			if (!blob) {
				projectNotice = 'Export produced no output';
				return;
			}
			const url = URL.createObjectURL(blob);
			const link = documentElement('a');
			link.href = url;
			link.download = `${projectName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-${exportQuality.label}-${exportResolution.width}x${exportResolution.height}.mp4`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			projectNotice = `Exported as ${exportQuality.label} (${exportResolution.width}x${exportResolution.height})`;
			sound.complete();
		} catch (error) {
			projectNotice = error instanceof Error ? error.message : 'Export failed';
			sound.error();
		} finally {
			isExporting = false;
		}
	}

	// shot matching: compare the target clip's current frame against a reference clip
	// and derive wheel/curve adjustments that push the target toward the reference
	async function handleMatchColor(referenceClipId: string) {
		const target = selectedClip;
		if (!target || matchingClipId) return;
		const reference = tracks
			.flatMap((track) => track.clips)
			.find((clip) => clip.id === referenceClipId);
		if (!reference?.assetId || !target.assetId) {
			projectNotice = 'Both clips need media to match color';
			return;
		}
		if (reference.id === target.id) return;
		matchingClipId = target.id;
		try {
			await mediaRestorePromise;
			const renderer = createFrameRenderer(tracks, mediaAssets);
			try {
				const canvas = document.createElement('canvas');
				const safeAspect =
					playerAspectRatio.width > 0 && playerAspectRatio.height > 0
						? playerAspectRatio
						: { width: 16, height: 9 };
				canvas.width = 256;
				canvas.height = Math.max(2, Math.round((256 * safeAspect.height) / safeAspect.width));
				const context = canvas.getContext('2d', { willReadFrequently: true });
				if (!context) return;
				// sample the target at the current playhead, clamped inside the clip
				const targetTime = Math.min(
					target.startTime + target.duration - 1 / FRAME_RATE,
					Math.max(target.startTime, currentTime)
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
				handleClipPropertyChange(target.id, (c) => {
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
				projectNotice = `Color matched to "${reference.name}"`;
				sound.complete();
			} finally {
				renderer.dispose();
			}
		} catch {
			projectNotice = 'Color match failed';
			sound.error();
		} finally {
			matchingClipId = null;
		}
	}

	async function handleCaptureFrame(format: 'png' | 'jpeg') {
		if (isCapturingFrame || isExporting) return;
		if (timelineContentEnd <= 0) {
			projectNotice = 'Timeline is empty - nothing to capture';
			return;
		}
		isCapturingFrame = true;
		try {
			const blob = await exportFrame({
				tracks,
				mediaAssets,
				time: Math.min(currentTime, timelineContentEnd),
				resolution: exportResolution,
				format
			});
			if (!blob) {
				projectNotice = 'Frame could not be captured';
				return;
			}
			const extension = format === 'jpeg' ? 'jpg' : 'png';
			const url = URL.createObjectURL(blob);
			const link = documentElement('a');
			link.href = url;
			link.download = `${projectName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}-frame-${extension}`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			projectNotice = `Frame captured (${exportResolution.width}x${exportResolution.height})`;
			sound.complete();
		} catch {
			projectNotice = 'Frame could not be captured';
			sound.error();
		} finally {
			isCapturingFrame = false;
		}
	}

	async function saveProject() {
		if (isSaving) return;
		isSaving = true;
		try {
			await loadVersionHistory();
			const document = createProjectDocument();
			const versionDoc = createProjectSnapshot(document);
			const newVersion: ProjectVersion = {
				id: createEntityId('version'),
				createdAt: document.updatedAt,
				document: versionDoc
			};
			const nextVersions = [newVersion, ...versions].slice(0, MAX_VERSIONS);

			await Promise.all([saveProjectToDb(document), saveVersions(nextVersions)]);

			versions = nextVersions;
			// render and persist a first-frame preview for the new snapshot in the
			// background so saving stays fast; the history dialog picks it up reactively
			void generateVersionThumbnail(newVersion);
			const isFirstSave = !autoSaveEnabled;
			autoSaveEnabled = true;
			autoSaveBlocked = false;
			isSaved = true;
			projectNotice = isFirstSave ? 'Project saved - auto-save enabled' : 'Project saved';
			sound.success();
		} catch {
			autoSaveBlocked = true;
			projectNotice = 'Project could not be saved';
			sound.error();
		} finally {
			isSaving = false;
		}
	}

	function downloadProject() {
		try {
			const document = createProjectDocument();
			const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const link = documentElement('a');
			link.href = url;
			link.download = `${projectName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'project'}.viko`;
			link.click();
			URL.revokeObjectURL(url);
			projectNotice = 'Project file exported';
		} catch {
			projectNotice = 'Project file could not be exported';
		}
	}

	function documentElement<K extends keyof HTMLElementTagNameMap>(
		tagName: K
	): HTMLElementTagNameMap[K] {
		return document.createElement(tagName);
	}

	function applyProjectDocument(document: ProjectDocument) {
		projectLoadSequence += 1;
		projectName = document.name;
		tracks = document.tracks;
		mediaAssets = document.mediaAssets;
		markers = document.markers ?? [];
		inOutPoints = { in: null, out: null };
		currentTime = 0;
		isPlaying = false;
		selectedClipId = null;
		playerAspectRatio = isValidAspectRatio(document.aspectRatio)
			? { width: document.aspectRatio.width, height: document.aspectRatio.height }
			: { width: 16, height: 9 };
		aspectRatioMode = document.aspectRatioMode ?? 'auto';
		historyEpoch += 1;
		isSaved = true;
	}

	async function refreshMissingAssetMetadata(assets: MediaAsset[], loadSequence: number) {
		const missing = assets.filter(
			(asset) =>
				(asset.kind === 'video' || asset.kind === 'image') &&
				(asset.width === null || asset.height === null)
		);
		if (missing.length === 0) return;
		try {
			const refreshed = await Promise.all(missing.map((asset) => inspectMediaAsset(asset)));
			if (projectLoadSequence !== loadSequence) return;
			const refreshedById = new Map(refreshed.map((asset) => [asset.id, asset]));
			mediaAssets = mediaAssets.map((asset) => refreshedById.get(asset.id) ?? asset);
			isSaved = false;
			autoSaveBlocked = false;
		} catch {
			// missing metadata stays null and auto-detection is skipped
		}
	}

	async function handleProjectFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || file.size <= 0 || file.size > 25 * 1024 * 1024) return;
		try {
			const parsed = parseProjectDocument(JSON.parse(await file.text()));
			if (!parsed) {
				projectNotice = 'Project file is invalid or unsupported';
				return;
			}
			applyProjectDocument(parsed);
			projectNotice = 'Project opened';
		} catch {
			projectNotice = 'Project file could not be opened';
		}
	}

	function createNewProject() {
		sound.open();
		projectLoadSequence += 1;
		projectName = 'Untitled Project';
		tracks = [];
		mediaAssets = [];
		markers = [];
		inOutPoints = { in: null, out: null };
		currentTime = 0;
		isPlaying = false;
		selectedClipId = null;
		playerAspectRatio = { width: 16, height: 9 };
		aspectRatioMode = 'auto';
		historyEpoch += 1;
		isSaved = true;
		autoSaveEnabled = false;
		newProjectDialogOpen = false;
		projectNotice = 'New project created';
		void clearProject();
	}

	async function restoreVersion(version: ProjectVersion) {
		if (isRestoringVersion) return;
		isRestoringVersion = true;
		sound.notification();
		try {
			const restoredMedia = await restoreMediaAssets(version.document.mediaAssets);
			applyProjectDocument({ ...version.document, mediaAssets: restoredMedia });
			void refreshMissingAssetMetadata(restoredMedia, projectLoadSequence);
			autoSaveBlocked = false;
			historyDialogOpen = false;
			projectNotice = 'Project version restored';
		} catch {
			autoSaveBlocked = false;
			projectNotice = 'Version could not be restored';
			sound.error();
		} finally {
			isRestoringVersion = false;
		}
	}

	function flushClipPropertyChange() {
		propertyChangeFrame = null;
		const pending = pendingPropertyChange;
		pendingPropertyChange = null;
		if (!pending) return;
		const nextTracks = updateClipProperty(tracks, pending.clipId, pending.updater);
		if (nextTracks === tracks) return;
		tracks = nextTracks;
		isSaved = false;
		autoSaveBlocked = false;
	}

	// reverse toggles enter Timeline through the typed request pipeline so they
	// land in the same undo/redo history as direct timeline edits
	function handleToggleClipReversed(clipId: string) {
		clipPropertyChangeRequest = {
			id: createEntityId('clip-reverse'),
			clipId,
			updater: (clip) => ({ ...clip, reversed: !(clip.reversed === true) })
		};
	}

	let normalizing = $state(false);

	async function handleNormalizeAudio(clipId: string) {
		const clip = tracks
			.flatMap((track) => track.clips)
			.find((candidate) => candidate.id === clipId);
		const asset = clip?.assetId
			? mediaAssets.find((candidate) => candidate.id === clip?.assetId)
			: null;
		if (!clip || !asset) return;
		normalizing = true;
		try {
			const volume = await normalizeClipAudio(clip, asset);
			if (volume === null) {
				sound.error();
				return;
			}
			sound.success();
			// route through the Timeline request pipeline so the normalization lands
			// in the same undo/redo history as other one-shot clip edits
			clipPropertyChangeRequest = {
				id: createEntityId('clip-normalize'),
				clipId,
				updater: (currentClip) => ({ ...currentClip, volume })
			};
		} finally {
			normalizing = false;
		}
	}

	function handleClipPropertyChange(clipId: string, updater: (clip: Clip) => Clip) {
		const pending = pendingPropertyChange;
		if (pending && pending.clipId !== clipId) flushClipPropertyChange();
		const currentPending = pendingPropertyChange;
		pendingPropertyChange =
			currentPending?.clipId === clipId
				? { clipId, updater: (clip) => updater(currentPending.updater(clip)) }
				: { clipId, updater };
		if (propertyChangeFrame !== null) return;
		propertyChangeFrame = requestAnimationFrame(flushClipPropertyChange);
	}

	function handleAddKeyframe(
		clipId: string,
		property: KeyframeProperty,
		value: number,
		requestedTime?: number
	) {
		handleClipPropertyChange(clipId, (clip) => {
			const clipTime = Math.min(clip.duration, Math.max(0, requestedTime ?? playerClipTime));
			return upsertClipKeyframes(
				clip,
				clipTime,
				KEYFRAME_PROPERTIES.map((candidate) => ({
					id: createEntityId(`keyframe-${candidate}`),
					property: candidate,
					value: candidate === property ? value : getClipKeyframeValue(clip, clipTime, candidate)
				}))
			);
		});
	}

	function handleAddKeyframes(
		clipId: string,
		properties: KeyframeProperty[],
		requestedTime: number
	) {
		handleClipPropertyChange(clipId, (clip) => {
			const clipTime = Math.min(clip.duration, Math.max(0, requestedTime));
			return upsertClipKeyframes(
				clip,
				clipTime,
				properties.map((property) => ({
					id: createEntityId(`keyframe-${property}`),
					property,
					value: getClipKeyframeValue(clip, clipTime, property)
				}))
			);
		});
	}

	function handleRemoveKeyframesAtTime(clipId: string, time: number) {
		handleClipPropertyChange(clipId, (clip) => removeClipKeyframesAtTime(clip, time));
	}

	function handleRippleModeToggle(enabled: boolean) {
		rippleMode = enabled;
	}

	function handleSetInPoint() {
		inOutPoints = { ...inOutPoints, in: roundToFrame(currentTime) };
	}

	function handleSetOutPoint() {
		inOutPoints = { ...inOutPoints, out: roundToFrame(currentTime) };
	}

	function handleClearInOutPoints() {
		inOutPoints = { in: null, out: null };
	}

	function handleInOutPointsChange(points: { in: number | null; out: number | null }) {
		inOutPoints = points;
	}

	onMount(async () => {
		const loadSequence = projectLoadSequence + 1;
		projectLoadSequence = loadSequence;
		const storedProjectPromise = loadProject();

		try {
			const storedProject = await storedProjectPromise;

			if (storedProject && projectLoadSequence === loadSequence) {
				const activeLoadSequence = projectLoadSequence;

				mediaRestorePromise = restoreMediaAssets(storedProject.mediaAssets).then(
					(restoredMedia) => {
						if (projectLoadSequence !== activeLoadSequence) return;
						applyProjectDocument({ ...storedProject, mediaAssets: restoredMedia });
						void refreshMissingAssetMetadata(restoredMedia, projectLoadSequence);
						autoSaveEnabled = true;
					}
				);
				await mediaRestorePromise;
			}
		} catch {
			if (projectLoadSequence === loadSequence) autoSaveEnabled = false;
		}
	});

	$effect(() => {
		if (isSaved || !autoSaveEnabled || isSaving || autoSaveBlocked) return;

		const timer = setTimeout(() => {
			if (!isSaved && !isSaving) {
				void saveProject();
			}
		}, 2000);

		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!projectNotice) return;

		const timer = setTimeout(() => {
			projectNotice = null;
		}, 5000);

		return () => clearTimeout(timer);
	});

	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (!isSaved) {
			e.preventDefault();
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			if (!isSaved && !isSaving) {
				void saveProject();
			}
		}
	}

	function handleGlobalMouseDown(e: MouseEvent) {
		if (!propertiesPanelOpen) return;
		const target = e.target;
		if (!(target instanceof Element)) return;
		if (target.closest('[data-properties-panel]')) return;
		if (target.closest('[data-timeline-root]')) return;
		propertiesPanelOpen = false;
	}

	$effect(() => {
		window.addEventListener('beforeunload', handleBeforeUnload);
		window.addEventListener('keydown', handleGlobalKeydown);
		window.addEventListener('mousedown', handleGlobalMouseDown);
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			window.removeEventListener('keydown', handleGlobalKeydown);
			window.removeEventListener('mousedown', handleGlobalMouseDown);
		};
	});

	onDestroy(() => {
		if (propertyChangeFrame !== null) cancelAnimationFrame(propertyChangeFrame);
		propertyChangeFrame = null;
		pendingPropertyChange = null;
	});
</script>

<div
	class="flex h-screen w-screen flex-col overflow-hidden bg-background"
	use:useShortcuts={paletteBindings}
>
	<input
		bind:this={openProjectInput}
		type="file"
		accept=".viko,.json,application/json"
		class="hidden"
		onchange={handleProjectFileChange}
	/>
	<Navbar
		bind:projectName
		bind:zoom
		{canUndo}
		{canRedo}
		{isSaved}
		{isSaving}
		{autoSaveEnabled}
		bind:exportQuality
		{exportResolution}
		{isExporting}
		exportQualities={EXPORT_QUALITIES}
		onExportQualityChange={(id) => {
			const q = EXPORT_QUALITIES.find((eq) => eq.id === id);
			if (q) exportQuality = q;
		}}
		onExport={handleExportVideo}
		{isCapturingFrame}
		onCaptureFrame={handleCaptureFrame}
		onNewProject={() => (newProjectDialogOpen = true)}
		onOpenProject={() => openProjectInput?.click()}
		onSave={() => void saveProject()}
		onSaveAs={downloadProject}
		onAutoSaveToggle={(enabled) => (autoSaveEnabled = enabled)}
		onShowVersionHistory={() => {
			versionSearchQuery = '';
			historyDialogOpen = true;
			void loadVersionHistory();
		}}
		onShowShortcuts={() => (shortcutsDialogOpen = true)}
		onProjectNameChange={() => (isSaved = false)}
		onUndo={() => requestTimelineCommand('undo')}
		onRedo={() => requestTimelineCommand('redo')}
		onToggleSidebar={toggleSidebar}
	/>

	<div class="flex min-h-0 flex-1">
		<Sidebar
			bind:open={sidebarOpen}
			bind:mediaAssets
			{usedAssetIds}
			resources={editorResources}
			captionPresets={CAPTION_PRESETS}
			onToggle={toggleSidebar}
			onMediaAssetsChange={handleMediaAssetsChange}
			onAssetApply={(asset) => dropMediaAsset(asset.id, '', currentTime, true)}
			onResourceApply={applyResource}
			onCreateText={createDefaultText}
			onGenerateCaptions={handleGenerateCaptions}
			onTranscribeMedia={(presetId) => void handleTranscribeMedia(presetId)}
			transcribing={isTranscribing}
			{transcribeProgress}
			{transcribeFileName}
		/>

		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<Toolbar
				bind:activeTool
				bind:snappingEnabled
				bind:zoom
				{rippleMode}
				onRippleModeToggle={handleRippleModeToggle}
				hasInOutPoints={inOutPoints.in !== null || inOutPoints.out !== null}
				onSetInPoint={handleSetInPoint}
				onSetOutPoint={handleSetOutPoint}
				onClearInOutPoints={handleClearInOutPoints}
			/>
			<Player
				bind:currentTime
				bind:isPlaying
				bind:selectedClipId
				bind:aspectRatio={playerAspectRatio}
				bind:aspectRatioMode
				onAspectSettingsChange={() => {
					isSaved = false;
					autoSaveBlocked = false;
				}}
				duration={timelineContentEnd}
				{tracks}
				{mediaAssets}
				bind:playbackRate
				bind:loopEnabled
				onVisualUpdate={requestVisualUpdate}
			/>
		</div>

		{#if propertiesPanelOpen}
			<div
				data-properties-panel
				class="flex w-60 shrink-0 flex-col border-l border-sidebar-border bg-sidebar"
			>
				<div class="flex h-8 items-center justify-between border-b border-sidebar-border px-3">
					<span class="text-[11px] font-semibold text-foreground">Properties</span>
				</div>
				<PropertiesPanel
					clip={selectedClip}
					isAudioClip={selectedClipIsAudio}
					clipTime={playerClipTime}
					onPropertyChange={handleClipPropertyChange}
					onToggleReverse={handleToggleClipReversed}
					onAddKeyframe={handleAddKeyframe}
					onAddKeyframes={handleAddKeyframes}
					onRemoveKeyframesAtTime={handleRemoveKeyframesAtTime}
					{matchSources}
					onMatchColor={handleMatchColor}
					matching={matchingClipId === selectedClipId}
					canNormalizeAudio={selectedClipHasAudio}
					{normalizing}
					onNormalizeAudio={handleNormalizeAudio}
				/>
			</div>
		{/if}
	</div>

	<Timeline
		bind:currentTime
		bind:zoom
		bind:selectedClipId
		bind:tracks
		bind:isPlaying
		{activeTool}
		{snappingEnabled}
		{rippleMode}
		{markers}
		{inOutPoints}
		{effectRequest}
		{clipInsertRequest}
		{clipPropertyChangeRequest}
		{visualUpdateRequest}
		{commandRequest}
		{historyEpoch}
		bind:playbackRate
		{loopEnabled}
		{mediaAssets}
		onAddKeyframes={handleAddKeyframes}
		onRemoveKeyframesAtTime={handleRemoveKeyframesAtTime}
		onPropertiesOpen={() => (propertiesPanelOpen = true)}
		duration={timelineDuration}
		playbackEnd={timelineContentEnd}
		onAssetDrop={dropMediaAsset}
		onResourceDrop={dropEditorResource}
		onTracksChange={handleTracksChange}
		onMarkersChange={(nextMarkers) => {
			markers = nextMarkers;
			isSaved = false;
			autoSaveBlocked = false;
		}}
		onInOutPointsChange={handleInOutPointsChange}
		onSetInPoint={handleSetInPoint}
		onSetOutPoint={handleSetOutPoint}
		onClearInOutPoints={handleClearInOutPoints}
		onHistoryAvailabilityChange={(undoAvailable, redoAvailable) => {
			canUndo = undoAvailable;
			canRedo = redoAvailable;
		}}
		onCreateTextAt={(trackId, startTime) =>
			addTimelineClip(
				TEXT_PRESETS[0].name,
				DEFAULT_ASSET_DURATION,
				trackId,
				startTime,
				undefined,
				'video',
				TEXT_PRESETS[0].textStyle
			)}
	/>

	{#if projectNotice}
		<button
			class="fixed right-5 bottom-5 z-[80] flex max-w-sm items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-left text-xs text-foreground shadow-xl"
			onclick={() => (projectNotice = null)}
		>
			<div class="size-1.5 shrink-0 rounded-full bg-primary"></div>
			<span class="font-medium">{projectNotice}</span>
		</button>
	{/if}

	<Dialog.Root bind:open={newProjectDialogOpen}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>New project</Dialog.Title>
				<Dialog.Description>
					The current timeline will be cleared. Save it first if you need it later.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (newProjectDialogOpen = false)}>Cancel</Button>
				<Button variant="destructive" onclick={createNewProject}>Create project</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={shortcutsDialogOpen}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Keyboard shortcuts</Dialog.Title>
				<Dialog.Description>Editor commands available outside text inputs.</Dialog.Description>
			</Dialog.Header>
			<div class="grid grid-cols-[1fr_auto] gap-x-5 gap-y-2 text-xs">
				<span>Select, razor, hand, text</span><kbd>V / B / H / T</kbd>
				<span>Toggle snapping</span><kbd>S</kbd>
				<span>Play or pause</span><kbd>Space</kbd>
				<span>Previous or next frame</span><kbd>Left / Right</kbd>
				<span>New or open project</span><kbd>Ctrl+N / Ctrl+O</kbd>
				<span>Save project</span><kbd>Ctrl+S</kbd>
				<span>Save project as</span><kbd>Ctrl+Shift+S</kbd>
				<span>Export project</span><kbd>Ctrl+E</kbd>
				<span>Toggle sidebar</span><kbd>Ctrl+B</kbd>
				<span>Zoom in or out</span><kbd>Ctrl+= / Ctrl+-</kbd>
				<span>Fit to screen</span><kbd>Ctrl+0</kbd>
				<span>Split selected clips</span><kbd>Ctrl+Shift+B</kbd>
				<span>Trim start or end</span><kbd>Q / W</kbd>
				<span>Copy, cut, paste, duplicate</span><kbd>Ctrl+C / X / V / D</kbd>
				<span>Undo or redo</span><kbd>Ctrl+Z / Ctrl+Shift+Z</kbd>
				<span>Nudge clip 1 frame</span><kbd>Shift+Arrow</kbd>
				<span>Nudge clip 10 frames</span><kbd>Ctrl+Arrow</kbd>
				<span>Add marker</span><kbd>M</kbd>
				<span>Add keyframe at playhead</span><kbd>K</kbd>
				<span>Freeze frame at playhead</span><kbd>F</kbd>
				<span>Reverse selected clips</span><kbd>Shift+R</kbd>
				<span>Set in / out point</span><kbd>I / O</kbd>
				<span>Clear in/out points</span><kbd>Ctrl+Shift+I</kbd>
				<span>Toggle ripple mode</span><kbd>R</kbd>
				<span>Group selected clips</span><kbd>Ctrl+G</kbd>
				<span>Ungroup clips</span><kbd>Ctrl+Shift+G</kbd>
				<span>Ripple delete</span><kbd>Shift+Del</kbd>
				<span>Keyboard shortcuts</span><kbd>Ctrl+/</kbd>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={historyDialogOpen}>
		<Dialog.Content class="sm:max-w-lg">
			<Dialog.Header>
				<div class="flex items-center gap-2">
					<History class="size-4 text-muted-foreground" />
					<Dialog.Title>Version History</Dialog.Title>
				</div>
				<Dialog.Description>
					Snapshots saved automatically and manually. Click any version to restore it.
				</Dialog.Description>
			</Dialog.Header>

			<!-- search bar -->
			<div class="mb-3 border-b border-border pb-3">
				<div class="relative">
					<Search
						class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						bind:value={versionSearchQuery}
						type="search"
						placeholder="Search versions by name..."
						class="h-8 pl-8 text-xs"
					/>
				</div>
			</div>

			<!-- version list -->
			<div class="max-h-80 space-y-1 overflow-y-auto pr-1">
				{#each filteredVersions as version, i (version.id)}
					{@const meta = getVersionMetadata(version.document)}
					<button
						class="group relative flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition-all hover:bg-secondary/60 disabled:cursor-wait disabled:opacity-50"
						disabled={isRestoringVersion}
						onclick={() => restoreVersion(version)}
					>
						<!-- timeline dot connector -->
						<div class="flex flex-col items-center pt-0.5">
							<div
								class="size-2.5 rounded-full border-2 border-primary/40 bg-card transition-colors group-hover:bg-primary/60"
							></div>
							{#if i < filteredVersions.length - 1}
								<div class="mt-1 w-px flex-1 bg-border"></div>
							{/if}
						</div>

						<!-- first-frame preview thumbnail -->
						{#if version.thumbnail}
							<img
								src={version.thumbnail}
								alt={version.document.name}
								class="mt-0.5 size-16 shrink-0 rounded-md border border-border bg-black object-cover"
								loading="lazy"
							/>
						{:else}
							<div
								class="mt-0.5 flex size-16 shrink-0 items-center justify-center rounded-md border border-border bg-secondary/40 text-muted-foreground/60"
							>
								<Film class="size-4" />
							</div>
						{/if}

						<!-- content -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between gap-2">
								<span class="truncate text-xs font-semibold text-foreground">
									{version.document.name}
								</span>
								<span
									class="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums"
								>
									<Clock class="size-2.5" />
									{formatRelativeTime(version.createdAt)}
								</span>
							</div>
							<!-- metadata badges -->
							<div class="mt-1.5 flex items-center gap-2.5">
								<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
									<Layers class="size-2.5" />
									{meta.tracks}
								</span>
								<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
									<Film class="size-2.5" />
									{meta.clips}
								</span>
								{#if meta.markers > 0}
									<span class="flex items-center gap-1 text-[10px] text-muted-foreground">
										<MapPin class="size-2.5" />
										{meta.markers}
									</span>
								{/if}
								<span class="ml-auto text-[10px] text-muted-foreground tabular-nums">
									{new Date(version.createdAt).toLocaleTimeString([], {
										hour: '2-digit',
										minute: '2-digit'
									})}
								</span>
							</div>
						</div>

						<!-- restore icon on hover -->
						<div
							class="flex shrink-0 items-center pt-0.5 text-muted-foreground opacity-0 transition-all group-hover:text-primary group-hover:opacity-100"
						>
							<RotateCcw class="size-3.5" />
						</div>
					</button>
				{:else}
					<div class="flex flex-col items-center gap-3 py-10">
						<History class="size-8 text-muted-foreground/40" />
						<p class="text-center text-xs text-muted-foreground">
							{versions.length > 0 ? 'No versions match your search' : 'No saved versions yet'}
						</p>
						{#if versions.length === 0}
							<p class="text-center text-[10px] text-muted-foreground/60">
								Save the project to create your first snapshot
							</p>
						{/if}
					</div>
				{/each}
			</div>

			{#if versions.length > 0}
				<Dialog.Footer>
					<span class="mr-auto text-[10px] text-muted-foreground">
						{filteredVersions.length} of {versions.length} versions
					</span>
					<Button variant="ghost" onclick={() => (historyDialogOpen = false)}>Close</Button>
				</Dialog.Footer>
			{/if}
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root open={isExporting} onOpenChange={() => {}}>
		<Dialog.Content class="sm:max-w-sm" showCloseButton={false}>
			<Dialog.Header>
				<Dialog.Title>Exporting video</Dialog.Title>
				<Dialog.Description>
					{exportProgress?.message ?? 'Preparing...'}
				</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2">
				<Progress value={exportPercent} max={100} />
				<p class="text-xs text-muted-foreground tabular-nums">{exportPercent}%</p>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<Command.Dialog
		bind:open={commandPaletteOpen}
		title="Command Palette"
		description="Search for a command to run..."
		onOpenChange={(open) => {
			commandPaletteOpen = open;
			if (open) void loadVersionHistory();
		}}
	>
		<Command.Input placeholder="Type a command or search..." />
		<Command.List>
			<Command.Empty>No results found.</Command.Empty>
			{#each paletteGroups as group (group.group)}
				<Command.Group heading={group.group}>
					{#each group.items as cmd (cmd.id)}
						<Command.Item
							value={cmd.label}
							keywords={cmd.keywords ? [cmd.keywords] : undefined}
							disabled={cmd.disabled?.()}
							onSelect={() => runPaletteCommand(cmd)}
						>
							{#if cmd.icon}
								<cmd.icon class="size-4" />
							{/if}
							<span>{cmd.label}</span>
							{#if cmd.hint}
								<Command.Shortcut>{cmd.hint}</Command.Shortcut>
							{/if}
						</Command.Item>
					{/each}
				</Command.Group>
			{/each}
		</Command.List>
	</Command.Dialog>

	<MobileNotice />
</div>
