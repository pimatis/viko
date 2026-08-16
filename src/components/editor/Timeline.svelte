<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as ContextMenu from '$lib/components/ui/context-menu';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		applyEffectToClip,
		applyTransitionToClip,
		DEFAULT_TRANSITION_DURATION,
		EFFECT_DRAG_MIME,
		getEffectPreset,
		isClipTransitionPreset,
		removeTransitionFromClips,
		TRANSITION_DRAG_MIME,
		removeEffectsFromClips,
		type EffectApplyRequest
	} from '$lib/effects';
	import { SIDEBAR_ASSET_MIME, SIDEBAR_RESOURCE_MIME } from '$lib/editor/sidebar';
	import { TEXT_PRESETS, type TextStyle } from '$lib/editor/text';
	import { clampTimelineZoom, type EditorTool } from '$lib/editor/toolbar';
	import { cloneColorGradeOrNull } from '$lib/grading';
	import { Pencil } from '@lucide/svelte';
	import {
		clampClipStart,
		cloneTracks,
		FRAME_RATE,
		getClipKeyframeTimes,
		getClipSourceTime,
		getClipSpeedRange,
		groupClips,
		expandLinkedSelection,
		getLinkedClipIds,
		KEYFRAME_PROPERTIES,
		moveClip,
		moveGroupedClips,
		moveLinkedClips,
		nudgeClips,
		resizeClip,
		rippleDeleteClips,
		rippleInsertClips,
		rollingTrim,
		roundToFrame,
		slideClip,
		slipClip,
		reconcileClipTransitions,
		splitClipKeyframes,
		snapClipEdge,
		snapClipStart,
		ungroupClips,
		trimClipKeyframesEnd,
		trimClipKeyframesStart,
		updateClipProperty,
		updateClipVisual,
		type ClipInsertRequest,
		type Clip,
		type ClipPropertyChangeRequest,
		type ClipVisualUpdateRequest,
		type KeyframeProperty,
		type TimelineCommandRequest,
		type Track,
		type Marker
	} from '$lib/editor/timeline';
	import { sound } from '$lib/sound';
	import { isChromaKeyActive } from '$lib/chroma';
	import type { MediaAsset } from '$lib/editor/sidebar';
	import Waveform from './Waveform.svelte';
	import {
		formatShortcut,
		useShortcuts,
		type ShortcutBinding,
		type ShortcutSpec
	} from '$lib/shortcuts';
	import { cn } from '$lib/utils';
	import {
		Play,
		Pause,
		SkipBack,
		SkipForward,
		Volume2,
		VolumeX,
		Lock,
		Unlock,
		Plus,
		Minus,
		Scissors,
		Trash2,
		Copy,
		ClipboardPaste,
		Undo,
		Redo2,
		ListPlus,
		CopyPlus,
		Sparkles,
		ChevronLeft,
		ChevronRight,
		PanelLeftClose,
		PanelRightClose,
		Group,
		Ungroup,
		MapPin,
		Trash,
		ArrowLeftRight,
		Crosshair,
		Diamond,
		Captions,
		Slice,
		Mic,
		Snowflake,
		FlipHorizontal2,
		X,
		Layers
	} from '@lucide/svelte';

	type Props = {
		currentTime?: number;
		duration?: number;
		playbackEnd?: number;
		tracks?: Track[];
		zoom?: number;
		isPlaying?: boolean;
		onSeek?: (time: number) => void;
		onClipSelect?: (clipId: string | null) => void;
		onClipSelectionChange?: (clipIds: string[]) => void;
		onTracksChange?: (tracks: Track[]) => void;
		onAssetDrop?: (assetId: string, trackId: string, startTime: number) => void;
		onResourceDrop?: (resourceId: string, trackId: string, startTime: number) => void;
		onCreateTextAt?: (trackId: string, startTime: number) => void;
		activeTool?: EditorTool;
		snappingEnabled?: boolean;
		effectRequest?: EffectApplyRequest | null;
		clipInsertRequest?: ClipInsertRequest | null;
		clipPropertyChangeRequest?: ClipPropertyChangeRequest | null;
		visualUpdateRequest?: ClipVisualUpdateRequest | null;
		commandRequest?: TimelineCommandRequest | null;
		historyEpoch?: number;
		onHistoryAvailabilityChange?: (canUndo: boolean, canRedo: boolean) => void;
		playbackRate?: number;
		loopEnabled?: boolean;
		selectedClipId?: string | null;
		rippleMode?: boolean;
		markers?: Marker[];
		onMarkersChange?: (markers: Marker[]) => void;
		inOutPoints?: { in: number | null; out: number | null };
		onInOutPointsChange?: (points: { in: number | null; out: number | null }) => void;
		onSetInPoint?: () => void;
		onSetOutPoint?: () => void;
		onClearInOutPoints?: () => void;
		onPropertiesOpen?: () => void;
		onAddKeyframes?: (clipId: string, properties: KeyframeProperty[], time: number) => void;
		onRemoveKeyframesAtTime?: (clipId: string, time: number) => void;
		mediaAssets?: MediaAsset[];
	};

	type ClipboardEntry = {
		clip: Clip;
		sourceTrackId: string;
		offset: number;
	};

	type TimelineClipboard = {
		entries: ClipboardEntry[];
	};

	type ClipDrag = {
		clipId: string;
		sourceTrackId: string;
		targetTrackId: string;
		pointerOffsetX: number;
		originClientX: number;
		originClientY: number;
		originalTracks: Track[];
		didMove: boolean;
	};

	type ClipTrim = {
		clipId: string;
		trackId: string;
		mode: 'trim' | 'rolling' | 'slip' | 'slide';
		edge: 'start' | 'end';
		originClientX: number;
		originScrollLeft: number;
		originalEdgeTime: number;
		originalTracks: Track[];
		didMove: boolean;
	};

	type TimelinePan = {
		clientX: number;
		clientY: number;
		scrollLeft: number;
		scrollTop: number;
	};

	const escapeShortcut: ShortcutSpec = { key: 'escape' };
	const undoShortcut: ShortcutSpec = { key: 'z', ctrlOrMeta: true };
	const redoShortcut: ShortcutSpec = { key: 'z', ctrlOrMeta: true, shift: true };
	const redoAltShortcut: ShortcutSpec = { key: 'y', ctrlOrMeta: true };
	const selectAllShortcut: ShortcutSpec = { key: 'a', ctrlOrMeta: true };
	const splitShortcut: ShortcutSpec = { key: 'b', ctrlOrMeta: true, shift: true };
	const ungroupShortcut: ShortcutSpec = { key: 'g', ctrlOrMeta: true, shift: true };
	const groupShortcut: ShortcutSpec = { key: 'g', ctrlOrMeta: true };
	const cutShortcut: ShortcutSpec = { key: 'x', ctrlOrMeta: true };
	const copyShortcut: ShortcutSpec = { key: 'c', ctrlOrMeta: true };
	const pasteShortcut: ShortcutSpec = { key: 'v', ctrlOrMeta: true };
	const duplicateShortcut: ShortcutSpec = { key: 'd', ctrlOrMeta: true };
	const clearInOutShortcut: ShortcutSpec = { key: 'i', ctrlOrMeta: true, shift: true };
	const zoomInShortcut: ShortcutSpec = { key: '=', keys: ['=', '+'], ctrlOrMeta: true };
	const zoomOutShortcut: ShortcutSpec = { key: '-', ctrlOrMeta: true };
	const nudgeFrameShortcut: ShortcutSpec = { key: 'ArrowLeft', shift: true };
	const nudgeTenFramesShortcut: ShortcutSpec = { key: 'ArrowLeft', ctrlOrMeta: true };
	const stepBackShortcut: ShortcutSpec = { key: 'ArrowLeft' };
	const stepForwardShortcut: ShortcutSpec = { key: 'ArrowRight' };
	const rippleDeleteShortcut: ShortcutSpec = { key: 'Delete', shift: true };
	const deleteShortcut: ShortcutSpec = { key: 'Delete' };
	const trimStartShortcut: ShortcutSpec = { key: 'q' };
	const trimEndShortcut: ShortcutSpec = { key: 'w' };
	const markerShortcut: ShortcutSpec = { key: 'm' };
	const keyframeShortcut: ShortcutSpec = { key: 'k' };
	const freezeShortcut: ShortcutSpec = { key: 'f' };
	const reverseShortcut: ShortcutSpec = { key: 'r', shift: true };
	const inPointShortcut: ShortcutSpec = { key: 'i' };
	const outPointShortcut: ShortcutSpec = { key: 'o' };
	const playShortcut: ShortcutSpec = { key: ' ' };
	const skipBackShortcut: ShortcutSpec = { key: 'Home' };
	const skipForwardShortcut: ShortcutSpec = { key: 'End' };

	const timelineShortcuts: ShortcutBinding[] = [
		{
			...escapeShortcut,
			ignoreWhenTyping: true,
			enabled: () => clipTrim !== null,
			onKeyDown: cancelClipTrim
		},
		{
			...escapeShortcut,
			ignoreWhenTyping: true,
			enabled: () => clipDrag !== null,
			onKeyDown: cancelClipDrag
		},
		{ ...escapeShortcut, ignoreWhenTyping: true, onKeyDown: clearClipSelection },
		{ ...redoShortcut, ignoreWhenTyping: true, onKeyDown: redoTimeline },
		{ ...redoAltShortcut, ignoreWhenTyping: true, onKeyDown: redoTimeline },
		{ ...undoShortcut, ignoreWhenTyping: true, onKeyDown: undoTimeline },
		{ ...selectAllShortcut, ignoreWhenTyping: true, onKeyDown: selectAllClips },
		{ ...splitShortcut, ignoreWhenTyping: true, onKeyDown: splitClipAtPlayhead },
		{ ...ungroupShortcut, ignoreWhenTyping: true, onKeyDown: ungroupSelectedClips },
		{ ...groupShortcut, ignoreWhenTyping: true, onKeyDown: groupSelectedClips },
		{ ...cutShortcut, ignoreWhenTyping: true, onKeyDown: cutSelectedClips },
		{ ...copyShortcut, ignoreWhenTyping: true, onKeyDown: copySelectedClips },
		{ ...pasteShortcut, ignoreWhenTyping: true, onKeyDown: pasteClips },
		{ ...duplicateShortcut, ignoreWhenTyping: true, onKeyDown: duplicateSelectedClips },
		{ key: ',', ignoreWhenTyping: true, onKeyDown: insertClipsAtPlayhead },
		{ key: '.', ignoreWhenTyping: true, onKeyDown: overwriteClipsAtPlayhead },
		{
			...clearInOutShortcut,
			ignoreWhenTyping: true,
			onKeyDown: () => {
				onClearInOutPoints();
				sound.select();
			}
		},
		{ ...zoomInShortcut, ignoreWhenTyping: true, onKeyDown: zoomIn },
		{ ...zoomOutShortcut, ignoreWhenTyping: true, onKeyDown: zoomOut },
		{
			...nudgeFrameShortcut,
			ignoreWhenTyping: true,
			enabled: () => getSelectedClipIds().length > 0,
			onKeyDown: handleNudgeArrow
		},
		{
			...nudgeTenFramesShortcut,
			ignoreWhenTyping: true,
			enabled: () => getSelectedClipIds().length > 0,
			onKeyDown: handleNudgeArrow
		},
		{ ...stepBackShortcut, ignoreWhenTyping: true, onKeyDown: stepBackward },
		{ ...stepForwardShortcut, ignoreWhenTyping: true, onKeyDown: stepForward },
		{ ...rippleDeleteShortcut, ignoreWhenTyping: true, onKeyDown: rippleDeleteSelectedClips },
		{ ...skipBackShortcut, ignoreWhenTyping: true, onKeyDown: skipBack },
		{ ...skipForwardShortcut, ignoreWhenTyping: true, onKeyDown: skipForward },
		{ ...trimStartShortcut, ignoreWhenTyping: true, onKeyDown: trimSelectedClipStarts },
		{ ...trimEndShortcut, ignoreWhenTyping: true, onKeyDown: trimSelectedClipEnds },
		{ ...markerShortcut, ignoreWhenTyping: true, onKeyDown: addMarkerAtPlayhead },
		{
			...keyframeShortcut,
			ignoreWhenTyping: true,
			// K is the JKL shuttle pause key: while playing (or shuttling) it pauses;
			// while paused it keeps the original add-keyframes-at-playhead behavior
			onKeyDown: () => {
				if (isPlaying || shuttleKey !== null) {
					stopPlayback();
					clearShuttle();
					sound.pause();
					return;
				}
				addKeyframesAtPlayhead();
			}
		},
		{ ...freezeShortcut, ignoreWhenTyping: true, onKeyDown: freezeSelectedClipsAtPlayhead },
		{ ...reverseShortcut, ignoreWhenTyping: true, onKeyDown: toggleSelectedClipsReversed },
		{
			...inPointShortcut,
			ignoreWhenTyping: true,
			onKeyDown: () => {
				onSetInPoint();
				sound.select();
			}
		},
		{
			...outPointShortcut,
			ignoreWhenTyping: true,
			onKeyDown: () => {
				onSetOutPoint();
				sound.select();
			}
		},
		{ ...playShortcut, ignoreWhenTyping: true, onKeyDown: togglePlay },
		{
			key: 'j',
			ignoreWhenTyping: true,
			onKeyDown: () => handleShuttleKey('back'),
			onKeyUp: () => handleShuttleKeyUp('back')
		},
		{
			key: 'l',
			ignoreWhenTyping: true,
			onKeyDown: () => handleShuttleKey('forward'),
			onKeyUp: () => handleShuttleKeyUp('forward')
		},
		{ key: 'Backspace', shift: true, ignoreWhenTyping: true, onKeyDown: rippleDeleteSelectedClips },
		{ key: 'Backspace', ignoreWhenTyping: true, onKeyDown: deleteSelectedClips },
		{ ...deleteShortcut, ignoreWhenTyping: true, onKeyDown: deleteSelectedClips }
	];

	const TRACK_COLORS: Record<string, { bg: string; border: string; accent: string; dot: string }> =
		{
			blue: {
				bg: 'bg-blue-500/15',
				border: 'border-blue-500/40',
				accent: 'text-blue-400',
				dot: 'bg-blue-500'
			},
			purple: {
				bg: 'bg-purple-500/15',
				border: 'border-purple-500/40',
				accent: 'text-purple-400',
				dot: 'bg-purple-500'
			},
			emerald: {
				bg: 'bg-emerald-500/15',
				border: 'border-emerald-500/40',
				accent: 'text-emerald-400',
				dot: 'bg-emerald-500'
			},
			amber: {
				bg: 'bg-amber-500/15',
				border: 'border-amber-500/40',
				accent: 'text-amber-400',
				dot: 'bg-amber-500'
			}
		};

	let {
		currentTime = $bindable(0),
		duration = 30,
		playbackEnd = duration,
		tracks = $bindable([] as Track[]),
		zoom = $bindable(100),
		isPlaying = $bindable(false),
		onSeek = () => {},
		onClipSelect = () => {},
		onClipSelectionChange = () => {},
		onTracksChange = () => {},
		onAssetDrop = () => {},
		onResourceDrop = () => {},
		onCreateTextAt = () => {},
		activeTool = 'select',
		snappingEnabled = true,
		effectRequest = null,
		clipInsertRequest = null,
		clipPropertyChangeRequest = null,
		visualUpdateRequest = null,
		commandRequest = null,
		historyEpoch = 0,
		onHistoryAvailabilityChange = () => {},
		playbackRate = $bindable(1),
		loopEnabled = false,
		selectedClipId = $bindable(null),
		rippleMode = false,
		markers = [],
		onMarkersChange = () => {},
		inOutPoints = { in: null, out: null },
		onInOutPointsChange = () => {},
		onSetInPoint = () => {},
		onSetOutPoint = () => {},
		onClearInOutPoints = () => {},
		onPropertiesOpen = () => {},
		onAddKeyframes = () => {},
		onRemoveKeyframesAtTime = () => {},
		mediaAssets = []
	}: Props = $props();

	let scrollContainer = $state<HTMLElement | null>(null);
	let headerScrollContainer = $state<HTMLElement | null>(null);
	let isDraggingPlayhead = $state(false);
	let playbackFrame: number | null = null;
	let lastPlaybackTimestamp: number | null = null;
	// JKL shuttle state: held direction key accelerates through 1x -> 2x -> 4x
	let shuttleKey = $state<'back' | 'forward' | null>(null);
	let shuttleLevel = 0;
	let shuttleRampTimer: ReturnType<typeof setInterval> | null = null;
	let clipboard = $state<TimelineClipboard | null>(null);
	let clipboardPanelOpen = $state(false);
	let clipDrag = $state<ClipDrag | null>(null);
	let clipTrim = $state<ClipTrim | null>(null);
	let timelinePan = $state<TimelinePan | null>(null);
	let inOutDrag = $state<{ edge: 'in' | 'out' } | null>(null);
	let activeTrackId = $state<string | null>(tracks[0]?.id ?? null);
	let selectedClipIds = $state<string[]>(selectedClipId ? [selectedClipId] : []);
	let undoHistory = $state<Track[][]>([]);
	let redoHistory = $state<Track[][]>([]);
	let timelineScrollbarHeight = $state(0);
	let clipIdSequence = 0;

	const assetsById = $derived(new Map(mediaAssets.map((asset) => [asset.id, asset])));
	let trackIdSequence = 0;
	let effectIdSequence = 0;
	let handledEffectRequestId: string | null = null;
	let handledClipInsertRequestId: string | null = null;
	let handledClipPropertyChangeRequestId: string | null = null;
	let handledVisualUpdateRequestId: string | null = null;
	let handledCommandRequestId: string | null = null;
	let handledHistoryEpoch = 0;
	let textEditorOpen = $state(false);
	let editingTextClipId = $state<string | null>(null);
	let textDraft = $state('');
	let textStyleDraft = $state<TextStyle | null>(null);
	let editingTrackId = $state<string | null>(null);
	let trackNameDraft = $state('');

	const TRACK_HEIGHT = 48;
	const RULER_HEIGHT = 28;
	const HEADER_WIDTH = 128;
	// read at call time: FRAME_RATE is a live project setting
	const playbackFrameIntervalMs = () => 1000 / FRAME_RATE;
	const DRAG_THRESHOLD_PX = 3;
	const AUTO_SCROLL_EDGE_PX = 28;
	const AUTO_SCROLL_STEP_PX = 12;
	const HISTORY_LIMIT = 100;
	const SNAP_THRESHOLD_PX = 10;
	const TRACK_COLOR_NAMES = Object.keys(TRACK_COLORS);
	const TEXT_FONT_FAMILIES = [
		...new Set(TEXT_PRESETS.map((preset) => preset.textStyle.fontFamily))
	];
	const TEXT_FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

	const pixelsPerSecond = $derived(zoom * 0.5);
	const timelineWidth = $derived(Math.max(duration * pixelsPerSecond + 200, 800));
	const playheadX = $derived(currentTime * pixelsPerSecond);
	const markerPositions = $derived(
		markers.map((marker) => ({ ...marker, x: marker.time * pixelsPerSecond }))
	);
	const effectivePlaybackEnd = $derived(Math.max(0, Math.min(playbackEnd, duration)));
	const playbackStartPoint = $derived(
		inOutPoints.in !== null ? Math.min(inOutPoints.in, effectivePlaybackEnd) : 0
	);
	const playbackEndPoint = $derived(
		inOutPoints.out !== null
			? Math.min(inOutPoints.out, effectivePlaybackEnd)
			: effectivePlaybackEnd
	);
	const rulerIntervals = $derived(getRulerIntervals(pixelsPerSecond));

	const rulerMarks = $derived(
		(() => {
			const marks: { time: number; major: boolean; label: string | null }[] = [];
			const { majorInterval, minorInterval } = rulerIntervals;

			for (let t = 0; t <= duration; t += minorInterval) {
				const rounded = Math.round(t * 100) / 100;
				const major = Math.abs(rounded % majorInterval) < 0.001;
				marks.push({
					time: rounded,
					major,
					label: major ? formatTime(rounded) : null
				});
			}
			return marks;
		})()
	);

	const currentTimeDisplay = $derived(formatTimeDisplay(currentTime));
	const selectedClipsHaveEffects = $derived(
		tracks.some((track) =>
			track.clips.some(
				(clip) =>
					(selectedClipIds.includes(clip.id) || selectedClipId === clip.id) &&
					Boolean(clip.effects?.length)
			)
		)
	);
	const selectedClipsHaveTransitions = $derived(
		tracks.some((track) =>
			track.clips.some(
				(clip) =>
					(selectedClipIds.includes(clip.id) || selectedClipId === clip.id) &&
					Boolean(clip.clipTransition)
			)
		)
	);
	const selectedClipsHaveGroup = $derived(
		tracks.some((track) =>
			track.clips.some((clip) => selectedClipIds.includes(clip.id) && Boolean(clip.groupId))
		)
	);
	const selectedTextClip = $derived(
		tracks
			.flatMap((track) => track.clips)
			.find((clip) => clip.id === selectedClipId && Boolean(clip.textStyle)) ?? null
	);
	const selectedUnlockedClips = $derived(
		(() => {
			const selectedIds = new Set(getSelectedClipIds());
			return tracks.flatMap((track) =>
				track.locked ? [] : track.clips.filter((clip) => selectedIds.has(clip.id))
			);
		})()
	);
	const selectedClipsCanSplit = $derived(
		selectedUnlockedClips.some(
			(clip) => currentTime > clip.startTime && currentTime < clip.startTime + clip.duration
		)
	);
	const selectedMediaClips = $derived(selectedUnlockedClips.filter(isMediaClip));
	const selectedClipsCanFreeze = $derived(
		selectedMediaClips.some(
			(clip) => currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration
		)
	);
	const selectedClipsCanReverse = $derived(selectedMediaClips.length > 0);
	const activeTrackLocked = $derived(
		tracks.find((track) => track.id === activeTrackId)?.locked ?? false
	);

	$effect(() => {
		const container = scrollContainer;
		if (!container) return;

		const updateScrollbarHeight = () => {
			timelineScrollbarHeight = container.offsetHeight - container.clientHeight;
		};
		const frameId = requestAnimationFrame(updateScrollbarHeight);
		const observer = new ResizeObserver(updateScrollbarHeight);
		observer.observe(container);

		return () => {
			cancelAnimationFrame(frameId);
			observer.disconnect();
		};
	});

	$effect(() => {
		onHistoryAvailabilityChange(undoHistory.length > 0, redoHistory.length > 0);
	});

	$effect(() => {
		if (!selectedClipId && selectedClipIds.length > 0) {
			selectedClipIds = [];
			return;
		}
		if (!selectedClipId || selectedClipIds.includes(selectedClipId)) return;
		selectedClipIds = [selectedClipId];
	});

	$effect(() => {
		if (historyEpoch === handledHistoryEpoch) return;
		handledHistoryEpoch = historyEpoch;
		undoHistory = [];
		redoHistory = [];
		clearClipSelection();
		activeTrackId = tracks[0]?.id ?? null;
	});

	$effect(() => {
		if (!commandRequest || commandRequest.id === handledCommandRequestId) return;
		handledCommandRequestId = commandRequest.id;
		if (commandRequest.command === 'undo') {
			undoTimeline();
			return;
		}
		redoTimeline();
	});

	$effect(() => {
		if (!clipInsertRequest || clipInsertRequest.id === handledClipInsertRequestId) return;
		handledClipInsertRequestId = clipInsertRequest.id;
		insertRequestedClip(clipInsertRequest);
	});

	$effect(() => {
		if (
			!clipPropertyChangeRequest ||
			clipPropertyChangeRequest.id === handledClipPropertyChangeRequestId
		)
			return;
		handledClipPropertyChangeRequestId = clipPropertyChangeRequest.id;
		const nextTracks = updateClipProperty(
			tracks,
			clipPropertyChangeRequest.clipId,
			clipPropertyChangeRequest.updater
		);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	});

	$effect(() => {
		if (!visualUpdateRequest || visualUpdateRequest.id === handledVisualUpdateRequestId) return;
		handledVisualUpdateRequestId = visualUpdateRequest.id;
		const nextTracks = updateClipVisual(tracks, visualUpdateRequest.clipId, visualUpdateRequest);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
		setClipSelection([visualUpdateRequest.clipId]);
	});

	$effect(() => {
		if (!effectRequest || effectRequest.id === handledEffectRequestId) return;
		handledEffectRequestId = effectRequest.id;
		if (!selectedClipId) return;
		if (isClipTransitionPreset(effectRequest.presetId)) {
			const nextTracks = applyTransitionToClip(
				tracks,
				selectedClipId,
				effectRequest.presetId,
				DEFAULT_TRANSITION_DURATION
			);
			if (nextTracks === tracks) return;
			commitTracks(nextTracks);
			return;
		}
		const nextTracks = applyEffectToClip(
			tracks,
			selectedClipId,
			effectRequest.presetId,
			createEffectId()
		);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	});

	$effect(() => {
		if (isPlaying) {
			startPlayback();
			return;
		}
		clearPlaybackFrame();
	});

	$effect(() => {
		if (currentTime <= effectivePlaybackEnd) return;
		currentTime = effectivePlaybackEnd;
		onSeek(effectivePlaybackEnd);
		stopPlayback();
	});

	function getRulerIntervals(value: number) {
		if (value >= 80) return { majorInterval: 1, minorInterval: 0.25 };
		if (value >= 40) return { majorInterval: 2, minorInterval: 0.5 };
		if (value >= 15) return { majorInterval: 5, minorInterval: 1 };
		return { majorInterval: 10, minorInterval: 2 };
	}

	function formatTime(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	}

	function formatTimeDisplay(seconds: number): string {
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		const frames = Math.floor((seconds % 1) * FRAME_RATE);
		return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
	}

	function seekToPosition(clientX: number) {
		const time = getTimeAtClientX(clientX);
		if (time === null) return;
		currentTime = time;
		onSeek(time);
	}

	function getTimeAtClientX(clientX: number): number | null {
		if (!scrollContainer) return null;
		const rect = scrollContainer.getBoundingClientRect();
		const x = clientX - rect.left + scrollContainer.scrollLeft;
		return Math.max(0, Math.min(duration, x / pixelsPerSecond));
	}

	function startTimelinePan(event: MouseEvent) {
		if (!scrollContainer || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		timelinePan = {
			clientX: event.clientX,
			clientY: event.clientY,
			scrollLeft: scrollContainer.scrollLeft,
			scrollTop: scrollContainer.scrollTop
		};
	}

	function createClipId(): string {
		clipIdSequence += 1;
		return `clip-${Date.now()}-${clipIdSequence}`;
	}

	function createTrackId(): string {
		trackIdSequence += 1;
		return `track-${Date.now()}-${trackIdSequence}`;
	}

	function createEffectId(): string {
		effectIdSequence += 1;
		return `effect-${Date.now()}-${effectIdSequence}`;
	}

	function setClipSelection(clipIds: string[]) {
		// linked A/V pairs select together: selecting a video clip also selects its
		// matching audio clip (and vice versa)
		const uniqueClipIds = [...new Set(expandLinkedSelection(tracks, clipIds))];
		selectedClipIds = uniqueClipIds;
		selectedClipId = uniqueClipIds.at(-1) ?? null;
		onClipSelect(selectedClipId);
		onClipSelectionChange(uniqueClipIds);
	}

	function clearClipSelection() {
		setClipSelection([]);
	}

	function getSelectedClipIds(): string[] {
		if (selectedClipIds.length > 0) return selectedClipIds;
		if (selectedClipId) return [selectedClipId];
		return [];
	}

	function pushUndoSnapshot(snapshot: Track[]) {
		undoHistory = [...undoHistory.slice(-(HISTORY_LIMIT - 1)), cloneTracks(snapshot)];
		redoHistory = [];
	}

	function commitTracks(nextTracks: Track[], previousTracks = tracks) {
		const reconciledTracks = reconcileClipTransitions(nextTracks);
		if (reconciledTracks === tracks) return;
		pushUndoSnapshot(previousTracks);
		tracks = reconciledTracks;
		onTracksChange(reconciledTracks);
	}

	function updateTrack(trackId: string, update: (track: Track) => Track) {
		commitTracks(tracks.map((track) => (track.id === trackId ? update(track) : track)));
	}

	function createTrack(): Track {
		let trackNumber = tracks.length + 1;
		while (tracks.some((track) => track.name === `Track ${trackNumber}`)) trackNumber += 1;

		return {
			id: createTrackId(),
			name: `Track ${trackNumber}`,
			type: 'video',
			color: TRACK_COLOR_NAMES[tracks.length % TRACK_COLOR_NAMES.length] ?? 'blue',
			clips: [],
			muted: false,
			locked: false,
			volume: 1,
			pan: 0
		};
	}

	function addTrack() {
		sound.select();
		const newTrack = createTrack();
		commitTracks([...tracks, newTrack]);
		activeTrackId = newTrack.id;
		clearClipSelection();
	}

	// an adjustment layer is a full-frame clip whose effects and grading are
	// applied to every visual clip below it that overlaps its time range
	function addAdjustmentLayer() {
		sound.select();
		const clipId = createClipId();
		const adjustmentClip: Clip = {
			id: clipId,
			name: 'Adjustment Layer',
			startTime: 0,
			duration: Math.max(1 / FRAME_RATE, duration)
		};
		const newTrack: Track = {
			id: createTrackId(),
			name: 'Adjustment Layer',
			type: 'adjustment',
			color: 'purple',
			clips: [adjustmentClip],
			muted: false,
			locked: false,
			volume: 1,
			pan: 0
		};
		commitTracks([...tracks, newTrack]);
		activeTrackId = newTrack.id;
		setClipSelection([clipId]);
	}

	function insertRequestedClip(request: ClipInsertRequest) {
		const requestedTrack = tracks.find(
			(track) => track.id === request.targetTrackId && !track.locked
		);
		const targetTrack = request.createTrack
			? undefined
			: (requestedTrack ?? tracks.find((track) => !track.locked));
		let baseTracks = tracks;
		const insertTime = request.clips[0]?.startTime ?? currentTime;
		const totalInsertDuration = request.clips.reduce((sum, c) => sum + c.duration, 0);
		if (rippleMode && totalInsertDuration > 0 && targetTrack) {
			const shifted = rippleInsertClips(tracks, targetTrack.id, insertTime, totalInsertDuration);
			if (shifted !== tracks) baseTracks = shifted;
		}

		// primary placement (video clip on its target track, or a fresh track)
		let nextTracks = targetTrack
			? baseTracks.map((track) =>
					track.id === targetTrack.id
						? {
								...track,
								clips: [...track.clips, ...request.clips.map((clip) => ({ ...clip }))].sort(
									(left, right) => left.startTime - right.startTime
								)
							}
						: track
				)
			: [
					...baseTracks,
					{
						id: createTrackId(),
						name: request.trackName?.trim().slice(0, 80) || `Track ${tracks.length + 1}`,
						type: request.trackType,
						color: TRACK_COLOR_NAMES[0] ?? 'blue',
						clips: request.clips.map((clip) => ({ ...clip })),
						muted: false,
						locked: false,
						volume: 1,
						pan: 0
					}
				];

		// linked partner (audio clip for a video insert) lands in the same commit
		if (request.linkedClips && request.linkedClips.clips.length > 0) {
			const linked = request.linkedClips;
			const linkedRequestedTrack = tracks.find(
				(track) => track.id === linked.targetTrackId && !track.locked
			);
			const linkedTargetTrack = linked.createTrack
				? undefined
				: (linkedRequestedTrack ??
					tracks.find((track) => track.type === linked.trackType && !track.locked));
			if (linkedTargetTrack) {
				nextTracks = nextTracks.map((track) =>
					track.id === linkedTargetTrack.id
						? {
								...track,
								clips: [...track.clips, ...linked.clips.map((clip) => ({ ...clip }))].sort(
									(left, right) => left.startTime - right.startTime
								)
							}
						: track
				);
			} else {
				nextTracks = [
					...nextTracks,
					{
						id: createTrackId(),
						name: linked.trackName?.trim().slice(0, 80) || `Track ${tracks.length + 1}`,
						type: linked.trackType,
						color: TRACK_COLOR_NAMES[0] ?? 'blue',
						clips: linked.clips.map((clip) => ({ ...clip })),
						muted: false,
						locked: false,
						volume: 1,
						pan: 0
					}
				];
			}
		}

		commitTracks(nextTracks);
		activeTrackId =
			targetTrack?.id ??
			(request.linkedClips?.clips.length ? (nextTracks[nextTracks.length - 1]?.id ?? null) : null);
		setClipSelection([
			...request.clips.map((clip) => clip.id),
			...(request.linkedClips?.clips.map((clip) => clip.id) ?? [])
		]);
	}

	function startEditingTrack(track: Track) {
		if (track.locked) return;
		editingTrackId = track.id;
		trackNameDraft = track.name;
	}

	function finishEditingTrack() {
		if (!editingTrackId) return;
		const trackId = editingTrackId;
		const nextName = trackNameDraft.trim().slice(0, 80);
		editingTrackId = null;
		if (!nextName) return;
		const track = tracks.find((candidate) => candidate.id === trackId);
		if (!track || track.locked || track.name === nextName) return;
		updateTrack(trackId, (candidate) => ({ ...candidate, name: nextName }));
	}

	function handleTrackNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			finishEditingTrack();
			return;
		}
		if (event.key !== 'Escape') return;
		editingTrackId = null;
	}

	function deleteActiveTrack() {
		const trackIndex = tracks.findIndex((track) => track.id === activeTrackId);
		if (trackIndex === -1 || tracks[trackIndex].locked) return;
		const nextTracks = tracks.filter((_, index) => index !== trackIndex);
		commitTracks(nextTracks);
		activeTrackId = nextTracks[Math.min(trackIndex, nextTracks.length - 1)]?.id ?? null;
		clearClipSelection();
	}

	function undoTimeline() {
		sound.undo();
		const previousTracks = undoHistory.at(-1);
		if (!previousTracks) return;
		redoHistory = [...redoHistory, cloneTracks(tracks)];
		undoHistory = undoHistory.slice(0, -1);
		tracks = previousTracks;
		onTracksChange(previousTracks);
		clearClipSelection();
	}

	function redoTimeline() {
		sound.redo();
		const nextTracks = redoHistory.at(-1);
		if (!nextTracks) return;
		undoHistory = [...undoHistory, cloneTracks(tracks)];
		redoHistory = redoHistory.slice(0, -1);
		tracks = nextTracks;
		onTracksChange(nextTracks);
		clearClipSelection();
	}

	function handleRulerClick(e: MouseEvent) {
		if (activeTool === 'hand') {
			startTimelinePan(e);
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			const time = getTimeAtClientX(e.clientX);
			if (time !== null) {
				sound.select();
				const newMarker: Marker = {
					id: `marker-${Date.now()}-${trackIdSequence++}`,
					time: roundTimelineTime(time),
					label: '',
					color: '#ef4444'
				};
				onMarkersChange([...markers, newMarker].sort((a, b) => a.time - b.time));
			}
			return;
		}
		seekToPosition(e.clientX);
	}

	function handlePlayheadMouseDown(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDraggingPlayhead = true;
	}

	function handleMouseMove(e: MouseEvent) {
		if (inOutDrag) {
			handleInOutDragMove(e);
			return;
		}

		if (timelinePan && scrollContainer) {
			scrollContainer.scrollLeft = timelinePan.scrollLeft - (e.clientX - timelinePan.clientX);
			scrollContainer.scrollTop = timelinePan.scrollTop - (e.clientY - timelinePan.clientY);
			syncHeaderScroll();
			return;
		}

		if (isDraggingPlayhead) {
			seekToPosition(e.clientX);
			return;
		}

		if (clipTrim) {
			autoScrollTimeline(e.clientX, e.clientY);
			const deltaSeconds =
				(e.clientX -
					clipTrim.originClientX +
					((scrollContainer?.scrollLeft ?? clipTrim.originScrollLeft) -
						clipTrim.originScrollLeft)) /
				pixelsPerSecond;
			let nextTracks: Track[];
			if (clipTrim.mode === 'slip') {
				nextTracks = slipClip(clipTrim.originalTracks, clipTrim.clipId, deltaSeconds);
			} else if (clipTrim.mode === 'slide') {
				nextTracks = slideClip(clipTrim.originalTracks, clipTrim.clipId, deltaSeconds, duration);
			} else {
				const rawEdgeTime = clipTrim.originalEdgeTime + deltaSeconds;
				const edgeTime = snappingEnabled
					? snapClipEdge(
							clipTrim.originalTracks,
							clipTrim.clipId,
							rawEdgeTime,
							currentTime,
							duration,
							SNAP_THRESHOLD_PX / pixelsPerSecond,
							rulerIntervals.minorInterval
						)
					: rawEdgeTime;
				if (clipTrim.mode === 'rolling') {
					nextTracks = rollingTrim(
						clipTrim.originalTracks,
						clipTrim.clipId,
						clipTrim.edge,
						edgeTime - clipTrim.originalEdgeTime,
						duration
					);
				} else {
					nextTracks = resizeClip(
						clipTrim.originalTracks,
						clipTrim.clipId,
						clipTrim.edge,
						edgeTime,
						duration
					);
				}
			}
			clipTrim.didMove = nextTracks !== clipTrim.originalTracks;
			tracks = nextTracks;
			return;
		}

		if (!clipDrag || !scrollContainer) return;
		const drag = clipDrag;
		const movedDistance = Math.hypot(
			e.clientX - drag.originClientX,
			e.clientY - drag.originClientY
		);
		if (!drag.didMove && movedDistance < DRAG_THRESHOLD_PX) return;

		drag.didMove = true;
		autoScrollTimeline(e.clientX, e.clientY);

		const lane = document
			.elementFromPoint(e.clientX, e.clientY)
			?.closest<HTMLElement>('[data-track-id]');
		const candidateTrackId = lane?.dataset.trackId;
		const candidateTrack = tracks.find((track) => track.id === candidateTrackId);

		if (candidateTrack && !candidateTrack.locked) {
			drag.targetTrackId = candidateTrack.id;
		}

		const rect = scrollContainer.getBoundingClientRect();
		const contentX = e.clientX - rect.left + scrollContainer.scrollLeft - drag.pointerOffsetX;
		const draggedClip = drag.originalTracks
			.flatMap((track) => track.clips)
			.find((clip) => clip.id === drag.clipId);
		const rawStartTime = contentX / pixelsPerSecond;
		const nextStartTime = snappingEnabled
			? snapClipStart(
					drag.originalTracks,
					drag.clipId,
					drag.targetTrackId,
					rawStartTime,
					currentTime,
					duration,
					SNAP_THRESHOLD_PX / pixelsPerSecond,
					rulerIntervals.minorInterval
				)
			: clampClipStart(rawStartTime, draggedClip?.duration ?? 0, duration);
		tracks = moveLinkedClips(
			drag.originalTracks,
			drag.clipId,
			drag.targetTrackId,
			nextStartTime,
			duration
		);
	}

	function handleMouseUp() {
		if (inOutDrag) {
			handleInOutDragEnd();
			return;
		}
		isDraggingPlayhead = false;
		timelinePan = null;
		if (clipTrim) {
			if (clipTrim.didMove) {
				sound.drop();
				pushUndoSnapshot(clipTrim.originalTracks);
				onTracksChange(tracks);
			}
			activeTrackId = clipTrim.trackId;
			clipTrim = null;
			return;
		}
		if (!clipDrag) return;
		if (clipDrag.didMove) {
			sound.drop();
			pushUndoSnapshot(clipDrag.originalTracks);
			onTracksChange(tracks);
		}
		activeTrackId = clipDrag.targetTrackId;
		clipDrag = null;
	}

	function handleWindowBlur() {
		handleMouseUp();
	}

	function cancelClipDrag() {
		if (!clipDrag) return;
		tracks = clipDrag.originalTracks;
		activeTrackId = clipDrag.sourceTrackId;
		clipDrag = null;
	}

	function cancelClipTrim() {
		if (!clipTrim) return;
		tracks = clipTrim.originalTracks;
		activeTrackId = clipTrim.trackId;
		clipTrim = null;
	}

	function autoScrollTimeline(clientX: number, clientY: number) {
		if (!scrollContainer) return;
		const rect = scrollContainer.getBoundingClientRect();

		if (clientX < rect.left + AUTO_SCROLL_EDGE_PX) {
			scrollContainer.scrollLeft -= AUTO_SCROLL_STEP_PX;
		}
		if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
			scrollContainer.scrollLeft += AUTO_SCROLL_STEP_PX;
		}
		if (clientY < rect.top + RULER_HEIGHT + AUTO_SCROLL_EDGE_PX) {
			scrollContainer.scrollTop -= AUTO_SCROLL_STEP_PX;
		}
		if (clientY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
			scrollContainer.scrollTop += AUTO_SCROLL_STEP_PX;
		}

		syncHeaderScroll();
	}

	function togglePlay() {
		if (isPlaying) sound.pause();
		if (!isPlaying) sound.play();
		if (shuttleKey !== null || shuttleLevel > 0) clearShuttle();
		if (isPlaying) {
			stopPlayback();
			return;
		}

		startPlayback();
	}

	function startPlayback(direction: 1 | -1 = 1) {
		if (playbackFrame !== null) return;
		if (playbackEndPoint <= 0) {
			isPlaying = false;
			return;
		}
		if (direction > 0) {
			if (currentTime >= playbackEndPoint || currentTime < playbackStartPoint) {
				currentTime = playbackStartPoint;
				onSeek(playbackStartPoint);
			}
		} else if (currentTime <= playbackStartPoint || currentTime > playbackEndPoint) {
			currentTime = playbackEndPoint;
			onSeek(playbackEndPoint);
		}
		isPlaying = true;
		lastPlaybackTimestamp = null;
		playbackFrame = requestAnimationFrame(updatePlayback);
	}

	function updatePlayback(timestamp: number) {
		if (!isPlaying) {
			clearPlaybackFrame();
			return;
		}
		if (lastPlaybackTimestamp === null) {
			lastPlaybackTimestamp = timestamp;
			playbackFrame = requestAnimationFrame(updatePlayback);
			return;
		}
		const elapsedMs = timestamp - lastPlaybackTimestamp;
		if (elapsedMs < playbackFrameIntervalMs()) {
			playbackFrame = requestAnimationFrame(updatePlayback);
			return;
		}
		lastPlaybackTimestamp = timestamp;
		// playbackRate may be negative (JKL shuttle): clamp inside the play range
		// so backward playback stops at the start instead of running off the clock
		const nextTime = Math.max(
			playbackStartPoint,
			Math.min(playbackEndPoint, currentTime + (elapsedMs / 1000) * playbackRate)
		);
		currentTime = nextTime;
		onSeek(nextTime);
		const reachedBoundary =
			playbackRate >= 0 ? nextTime >= playbackEndPoint : nextTime <= playbackStartPoint;
		if (!reachedBoundary) {
			playbackFrame = requestAnimationFrame(updatePlayback);
			return;
		}
		if (loopEnabled) {
			currentTime = playbackRate >= 0 ? playbackStartPoint : playbackEndPoint;
			onSeek(currentTime);
			playbackFrame = requestAnimationFrame(updatePlayback);
			return;
		}
		stopPlayback();
	}

	function stopPlayback() {
		isPlaying = false;
		clearPlaybackFrame();
	}

	function clearPlaybackFrame() {
		if (playbackFrame !== null) cancelAnimationFrame(playbackFrame);
		playbackFrame = null;
		lastPlaybackTimestamp = null;
	}

	// JKL shuttle (Premiere-style): tap to play a direction, tap again or hold to
	// accelerate. Releasing the key keeps playback at the current speed; K pauses.
	const SHUTTLE_RATES = [1, 2, 4] as const;

	function applyShuttle() {
		// the clock derives direction from the sign of playbackRate
		const rate = SHUTTLE_RATES[shuttleLevel] ?? 4;
		playbackRate = shuttleKey === 'back' ? -rate : rate;
		startPlayback(shuttleKey === 'back' ? -1 : 1);
	}

	function startShuttleRamp() {
		if (shuttleRampTimer !== null) return;
		shuttleRampTimer = setInterval(() => {
			shuttleLevel = Math.min(SHUTTLE_RATES.length - 1, shuttleLevel + 1);
			applyShuttle();
			sound.select();
		}, 600);
	}

	function stopShuttleRamp() {
		if (shuttleRampTimer !== null) clearInterval(shuttleRampTimer);
		shuttleRampTimer = null;
	}

	function clearShuttle() {
		shuttleKey = null;
		shuttleLevel = 0;
		stopShuttleRamp();
		playbackRate = 1;
	}

	function handleShuttleKey(direction: 'back' | 'forward') {
		if (shuttleKey === direction) {
			shuttleLevel = Math.min(SHUTTLE_RATES.length - 1, shuttleLevel + 1);
		} else {
			shuttleKey = direction;
			shuttleLevel = 0;
		}
		applyShuttle();
		startShuttleRamp();
		sound.select();
	}

	function handleShuttleKeyUp(direction: 'back' | 'forward') {
		if (shuttleKey !== direction) return;
		// release keeps playing at the current speed, just stops the ramp
		stopShuttleRamp();
	}

	function skipBack() {
		sound.skipPrev();
		stopPlayback();
		currentTime = 0;
		onSeek(0);
	}

	function skipForward() {
		sound.skipNext();
		stopPlayback();
		currentTime = effectivePlaybackEnd;
		onSeek(effectivePlaybackEnd);
	}

	function stepBackward() {
		sound.seek();
		stopPlayback();
		const step = 1 / FRAME_RATE;
		const newTime = Math.max(0, currentTime - step);
		currentTime = newTime;
		onSeek(newTime);
	}

	function stepForward() {
		sound.seek();
		stopPlayback();
		const step = 1 / FRAME_RATE;
		const newTime = Math.min(effectivePlaybackEnd, currentTime + step);
		currentTime = newTime;
		onSeek(newTime);
	}

	function zoomIn() {
		sound.select();
		zoom = Math.min(200, zoom + 10);
	}

	function zoomOut() {
		sound.select();
		zoom = Math.max(10, zoom - 10);
	}

	function handleTimelineWheel(event: WheelEvent) {
		// Touchpad pinch (macOS) and ctrl+wheel (mouse) both arrive as ctrlKey wheel events
		if (!event.ctrlKey) return;
		if (!scrollContainer) return;

		event.preventDefault();

		const rect = scrollContainer.getBoundingClientRect();
		const clientX = event.clientX;
		const timeAtCursor = Math.max(
			0,
			Math.min(duration, (clientX - rect.left + scrollContainer.scrollLeft) / pixelsPerSecond)
		);

		// Exponential scaling keeps the gesture smooth and direction-agnostic.
		// Round to a whole percent so the stored zoom (and every UI readout that
		// renders `zoom%`) never shows long float tails like 70.65843620492187%.
		const nextZoom = clampTimelineZoom(Math.round(zoom * Math.exp(-event.deltaY * 0.01)));
		if (nextZoom === zoom) return;
		zoom = nextZoom;

		// Keep the time under the cursor at the same screen position after zooming
		const nextPixelsPerSecond = nextZoom * 0.5;
		const maxScrollLeft = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
		const newScrollLeft = timeAtCursor * nextPixelsPerSecond - (clientX - rect.left);
		scrollContainer.scrollLeft = Math.min(Math.max(0, newScrollLeft), maxScrollLeft);
		syncHeaderScroll();
	}

	function toggleMute(trackId: string) {
		const track = tracks.find((t) => t.id === trackId);
		if (track?.muted) sound.toggleOff();
		if (track && !track.muted) sound.toggleOn();
		updateTrack(trackId, (track) => ({ ...track, muted: !track.muted }));
	}

	function toggleLock(trackId: string) {
		const track = tracks.find((t) => t.id === trackId);
		if (track?.locked) sound.unlock();
		if (track && !track.locked) sound.lock();
		updateTrack(trackId, (track) => ({ ...track, locked: !track.locked }));
	}

	function handleTrackMouseDown(e: MouseEvent, trackId: string) {
		if ((e.target as HTMLElement).closest('[data-clip]')) return;
		if (activeTool === 'hand') {
			startTimelinePan(e);
			return;
		}

		activeTrackId = trackId;
		clearClipSelection();
		if (e.button !== 0) return;
		const time = getTimeAtClientX(e.clientX);
		if (time === null) return;
		currentTime = time;
		onSeek(time);
		if (activeTool === 'text') onCreateTextAt(trackId, time);
	}

	function handleTimelineBackgroundMouseDown(e: MouseEvent) {
		if (activeTool === 'hand') return;
		if ((e.target as HTMLElement).closest('[data-clip]')) return;
		clearClipSelection();
		if (e.button !== 0) return;
		const time = getTimeAtClientX(e.clientX);
		if (time === null) return;
		currentTime = time;
		onSeek(time);
	}

	function handleInsertDragOver(event: DragEvent, track: Track | null) {
		const dataTransfer = event.dataTransfer;
		if (!dataTransfer) return;
		const types = dataTransfer.types;
		if (
			track?.locked ||
			(!types?.includes(SIDEBAR_ASSET_MIME) && !types?.includes(SIDEBAR_RESOURCE_MIME))
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		dataTransfer.dropEffect = 'copy';
	}

	function handleInsertDrop(event: DragEvent, track: Track | null) {
		if (track?.locked || !scrollContainer) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			const assetData = event.dataTransfer?.getData(SIDEBAR_ASSET_MIME) ?? '';
			const resourceData = event.dataTransfer?.getData(SIDEBAR_RESOURCE_MIME) ?? '';
			const payload: unknown = JSON.parse(assetData || resourceData);
			if (!payload || typeof payload !== 'object') return;
			const rect = scrollContainer.getBoundingClientRect();
			const contentX = event.clientX - rect.left + scrollContainer.scrollLeft;
			const startTime = Math.max(0, Math.min(duration, contentX / pixelsPerSecond));

			let targetTrack = track;
			if (!targetTrack) {
				sound.select();
				const newTrack = createTrack();
				commitTracks([...tracks, newTrack]);
				targetTrack = newTrack;
			}
			activeTrackId = targetTrack.id;
			if (assetData && 'id' in payload && typeof payload.id === 'string') {
				if (payload.id.length === 0 || payload.id.length > 200) return;
				onAssetDrop(payload.id, targetTrack.id, startTime);
				return;
			}
			if (!('resourceId' in payload) || typeof payload.resourceId !== 'string') return;
			if (payload.resourceId.length === 0 || payload.resourceId.length > 200) return;
			onResourceDrop(payload.resourceId, targetTrack.id, startTime);
		} catch {
			return;
		}
	}

	function handleEffectDragOver(event: DragEvent, track: Track) {
		if (track.locked || !event.dataTransfer) return;
		if (
			!event.dataTransfer.types.includes(EFFECT_DRAG_MIME) &&
			!event.dataTransfer.types.includes(TRANSITION_DRAG_MIME)
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = 'copy';
	}

	function handleEffectDrop(event: DragEvent, track: Track, clip: Clip) {
		if (track.locked || !event.dataTransfer) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			const transitionData = event.dataTransfer.getData(TRANSITION_DRAG_MIME);
			if (transitionData) {
				const payload: unknown = JSON.parse(transitionData);
				if (!payload || typeof payload !== 'object' || !('presetId' in payload)) return;
				if (typeof payload.presetId !== 'string' || !isClipTransitionPreset(payload.presetId))
					return;
				const nextTracks = applyTransitionToClip(
					tracks,
					clip.id,
					payload.presetId,
					DEFAULT_TRANSITION_DURATION
				);
				if (nextTracks === tracks) return;
				sound.drop();
				commitTracks(nextTracks);
				setClipSelection([clip.id]);
				activeTrackId = track.id;
				return;
			}
			const effectData = event.dataTransfer.getData(EFFECT_DRAG_MIME);
			if (!effectData) return;
			const payload: unknown = JSON.parse(effectData);
			if (!payload || typeof payload !== 'object' || !('presetId' in payload)) return;
			if (
				typeof payload.presetId !== 'string' ||
				payload.presetId.length === 0 ||
				payload.presetId.length > 100
			) {
				return;
			}
			const preset = getEffectPreset(payload.presetId);
			if (!preset || preset.kind === 'clip-transitions') return;
			const nextTracks = applyEffectToClip(tracks, clip.id, payload.presetId, createEffectId());
			if (nextTracks === tracks) return;
			commitTracks(nextTracks);
			setClipSelection([clip.id]);
			activeTrackId = track.id;
		} catch {
			return;
		}
	}

	function handleClipClick(e: MouseEvent, clipId: string) {
		e.stopPropagation();
		if (activeTool !== 'select') return;
		onPropertiesOpen();
		if (e.ctrlKey || e.metaKey) {
			if (selectedClipIds.includes(clipId)) {
				// toggling a linked clip off also removes its partner(s)
				const removeIds = new Set([clipId, ...getLinkedClipIds(tracks, clipId)]);
				const nextSelection = selectedClipIds.filter((selectedId) => !removeIds.has(selectedId));
				setClipSelection(nextSelection);
			} else {
				setClipSelection([...selectedClipIds, clipId]);
			}
			return;
		}

		setClipSelection([clipId]);
	}

	function openTextEditor(clip: Clip) {
		if (!clip.textStyle) return;
		editingTextClipId = clip.id;
		textDraft = clip.name;
		textStyleDraft = { ...clip.textStyle };
		textEditorOpen = true;
	}

	function handleClipDoubleClick(event: MouseEvent, clip: Clip) {
		event.preventDefault();
		event.stopPropagation();
		openTextEditor(clip);
	}

	function saveTextContent() {
		if (!editingTextClipId || !textStyleDraft) return;
		const content = textDraft.trim();
		if (!content) return;
		const nextTextStyle: TextStyle = { ...textStyleDraft };
		const track = tracks.find((candidate) =>
			candidate.clips.some((clip) => clip.id === editingTextClipId)
		);
		if (!track || track.locked) return;
		updateTrack(track.id, (candidate) => ({
			...candidate,
			clips: candidate.clips.map((clip) =>
				clip.id === editingTextClipId ? { ...clip, name: content, textStyle: nextTextStyle } : clip
			)
		}));
		textEditorOpen = false;
	}

	function handleTextInputKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			saveTextContent();
			return;
		}
		if (event.key !== 'Escape') return;
		textEditorOpen = false;
	}

	function updateTextFontFamily(value: string) {
		if (!textStyleDraft) return;
		const fontFamily = TEXT_FONT_FAMILIES.find((candidate) => candidate === value);
		if (!fontFamily) return;
		textStyleDraft = { ...textStyleDraft, fontFamily };
	}

	function updateTextFontWeight(value: string) {
		if (!textStyleDraft) return;
		const fontWeight = Number(value);
		if (!TEXT_FONT_WEIGHTS.some((candidate) => candidate === fontWeight)) return;
		textStyleDraft = { ...textStyleDraft, fontWeight };
	}

	function updateTextBackground(value: string) {
		if (!textStyleDraft || !['transparent', '#000000b3', '#ffffff'].includes(value)) return;
		textStyleDraft = { ...textStyleDraft, backgroundColor: value };
	}

	function updateTextAlignment(value: string) {
		if (!textStyleDraft || !['left', 'center', 'right'].includes(value)) return;
		textStyleDraft = { ...textStyleDraft, textAlign: value as TextStyle['textAlign'] };
	}

	function updateTextTransform(value: string) {
		if (!textStyleDraft || !['none', 'uppercase'].includes(value)) return;
		textStyleDraft = { ...textStyleDraft, textTransform: value as TextStyle['textTransform'] };
	}

	function handleClipMouseDown(e: MouseEvent, track: Track, clip: Clip) {
		if (e.button !== 0 || track.locked || !scrollContainer) return;
		if ((e.target as HTMLElement).closest('[data-trim-handle]')) return;
		if (activeTool === 'hand') {
			startTimelinePan(e);
			return;
		}

		e.preventDefault();
		e.stopPropagation();
		const pointerTime = getTimeAtClientX(e.clientX);
		if (activeTool === 'text') {
			if (pointerTime !== null) onCreateTextAt(track.id, pointerTime);
			return;
		}
		if (activeTool === 'razor') {
			if (pointerTime === null) return;
			currentTime = pointerTime;
			onSeek(pointerTime);
			activeTrackId = track.id;
			setClipSelection([clip.id]);
			splitClipAtPlayhead();
			return;
		}
		if (activeTool === 'slip' || activeTool === 'slide') {
			startClipTrim(e, track, clip, 'end', activeTool);
			return;
		}

		if (!e.ctrlKey && !e.metaKey && !selectedClipIds.includes(clip.id)) {
			setClipSelection([clip.id]);
			// bring the playhead onto a newly selected clip so its grading and effects
			// are visible in the preview while the user edits its properties
			if (currentTime < clip.startTime || currentTime >= clip.startTime + clip.duration) {
				currentTime = clip.startTime;
				onSeek(clip.startTime);
			}
		}
		activeTrackId = track.id;

		const rect = scrollContainer.getBoundingClientRect();
		const clipViewportX = rect.left - scrollContainer.scrollLeft + clip.startTime * pixelsPerSecond;
		clipDrag = {
			clipId: clip.id,
			sourceTrackId: track.id,
			targetTrackId: track.id,
			pointerOffsetX: e.clientX - clipViewportX,
			originClientX: e.clientX,
			originClientY: e.clientY,
			originalTracks: tracks,
			didMove: false
		};
	}

	function startClipTrim(
		event: MouseEvent,
		track: Track,
		clip: Clip,
		edge: ClipTrim['edge'],
		mode: ClipTrim['mode'] = 'trim'
	) {
		if (event.button !== 0 || track.locked || !scrollContainer) return;
		event.preventDefault();
		event.stopPropagation();
		stopPlayback();
		activeTrackId = track.id;
		setClipSelection([clip.id]);
		clipTrim = {
			clipId: clip.id,
			trackId: track.id,
			mode,
			edge,
			originClientX: event.clientX,
			originScrollLeft: scrollContainer.scrollLeft,
			originalEdgeTime: edge === 'start' ? clip.startTime : clip.startTime + clip.duration,
			originalTracks: tracks,
			didMove: false
		};
	}

	function findClipTrackId(clipId: string): string | null {
		for (const track of tracks) {
			if (track.clips.some((c) => c.id === clipId)) return track.id;
		}
		return null;
	}

	function handleClipContextMenu(clipId: string) {
		if (!selectedClipIds.includes(clipId)) setClipSelection([clipId]);
		activeTrackId = findClipTrackId(clipId);
	}

	function handleTrackHeaderContextMenu(track: Track) {
		activeTrackId = track.id;
	}

	function splitClipAtPlayhead() {
		sound.snap();
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return;
		// the playhead also cuts every linked partner, so a razor on the video clip
		// produces the matching audio pieces in the same commit
		const clipsToSplit = new Map<string, Clip>();
		for (const clip of tracks.flatMap((track) => track.clips)) {
			if (!selectedIds.has(clip.id)) continue;
			if (currentTime <= clip.startTime || currentTime >= clip.startTime + clip.duration) continue;
			clipsToSplit.set(clip.id, clip);
			for (const linkedId of getLinkedClipIds(tracks, clip.id)) {
				const linked = tracks
					.flatMap((track) => track.clips)
					.find((candidate) => candidate.id === linkedId);
				if (
					linked &&
					currentTime > linked.startTime &&
					currentTime < linked.startTime + linked.duration
				) {
					clipsToSplit.set(linkedId, linked);
				}
			}
		}
		if (clipsToSplit.size === 0) return;
		const splitClipIds: string[] = [];
		let didSplit = false;
		const nextTracks = tracks.map((track) => {
			if (track.locked) return track;
			const nextClips = track.clips.flatMap((clip) => {
				if (!clipsToSplit.has(clip.id)) return [clip];

				didSplit = true;
				const splitTime = roundToFrame(currentTime - clip.startTime);
				const leftClipId = createClipId();
				const rightClipId = createClipId();
				const splitKeyframes = splitClipKeyframes(
					clip,
					splitTime,
					`${leftClipId}-keyframe`,
					`${rightClipId}-keyframe`
				);
				// the split frame in source time; reversed clips show this frame at the
				// start of their piece, frozen clips pin it for the whole remainder
				const splitSourceTime = roundToFrame(getClipSourceTime(clip, splitTime));
				const leftClip = {
					...clip,
					id: leftClipId,
					duration: splitTime,
					keyframes: splitKeyframes.left,
					sourceStart: clip.reversed === true ? splitSourceTime : (clip.sourceStart ?? 0)
				};
				const rightClip = {
					...clip,
					id: rightClipId,
					startTime: currentTime,
					duration: clip.startTime + clip.duration - currentTime,
					sourceStart:
						clip.frozen === true || clip.reversed === true
							? (clip.sourceStart ?? 0)
							: splitSourceTime,
					keyframes: splitKeyframes.right
				};
				splitClipIds.push(leftClip.id, rightClip.id);
				return [leftClip, rightClip];
			});
			return { ...track, clips: nextClips };
		});
		if (!didSplit) return;
		commitTracks(nextTracks);
		setClipSelection(splitClipIds);
	}

	function trimSelectedClipStarts() {
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return;
		let changed = false;
		const nextTracks = tracks.map((track) => {
			if (track.locked) return track;
			return {
				...track,
				clips: track.clips.map((clip) => {
					if (!selectedIds.has(clip.id)) return clip;
					const clipEnd = clip.startTime + clip.duration;
					if (currentTime <= clip.startTime || currentTime >= clipEnd) return clip;
					const trimmedDuration = currentTime - clip.startTime;
					const nextDuration = roundTimelineTime(clipEnd - currentTime);
					changed = true;
					return {
						...clip,
						startTime: roundTimelineTime(currentTime),
						duration: nextDuration,
						keyframes: trimClipKeyframesStart(
							clip,
							trimmedDuration,
							`${clip.id}-trim-start-${Date.now()}`
						),
						// frozen clips hold one frame and reversed clips consume from the
						// window top, so start trims never advance the source start
						sourceStart:
							clip.frozen === true || clip.reversed === true
								? clip.sourceStart
								: roundToFrame(getClipSourceTime(clip, trimmedDuration))
					};
				})
			};
		});
		if (!changed) return;
		commitTracks(nextTracks);
	}

	function trimSelectedClipEnds() {
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return;
		let changed = false;
		const nextTracks = tracks.map((track) => {
			if (track.locked) return track;
			return {
				...track,
				clips: track.clips.map((clip) => {
					if (!selectedIds.has(clip.id)) return clip;
					if (currentTime <= clip.startTime || currentTime >= clip.startTime + clip.duration) {
						return clip;
					}
					changed = true;
					const nextDuration = roundTimelineTime(currentTime - clip.startTime);
					return {
						...clip,
						duration: nextDuration,
						keyframes: trimClipKeyframesEnd(
							clip,
							nextDuration,
							`${clip.id}-trim-end-${Date.now()}`
						),
						// reversed clips remove from the window bottom, so the source start
						// moves to the source time at the new end; frozen clips never move it
						sourceStart:
							clip.frozen === true
								? clip.sourceStart
								: clip.reversed === true
									? roundToFrame(getClipSourceTime(clip, nextDuration))
									: clip.sourceStart
					};
				})
			};
		});
		if (!changed) return;
		commitTracks(nextTracks);
	}

	// media clips with a source asset are eligible for freeze and reverse
	function isMediaClip(clip: Clip): boolean {
		if (!clip.assetId) return false;
		if (clip.textStyle || clip.sticker || clip.caption) return false;
		const asset = assetsById.get(clip.assetId);
		return asset ? asset.kind !== 'image' : true;
	}

	// freeze the frame at the playhead: split the clip at the playhead and pin the
	// right piece to that source frame for its remaining duration. when the playhead
	// sits at the clip start, the whole clip becomes the hold
	function freezeSelectedClipsAtPlayhead() {
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return;
		const frozenClipIds: string[] = [];
		let didFreeze = false;
		const nextTracks = tracks.map((track) => {
			if (track.locked) return track;
			const nextClips = track.clips.flatMap((clip) => {
				if (!selectedIds.has(clip.id)) return [clip];
				if (!isMediaClip(clip)) return [clip];
				const clipEnd = clip.startTime + clip.duration;
				if (currentTime < clip.startTime || currentTime >= clipEnd) return [clip];
				if (clip.frozen === true && currentTime === clip.startTime) return [clip];

				didFreeze = true;
				if (currentTime === clip.startTime) {
					// freeze from the very first frame: the whole clip becomes the hold
					const frozenClip = { ...clip, frozen: true };
					frozenClipIds.push(frozenClip.id);
					return [frozenClip];
				}

				const splitTime = roundToFrame(currentTime - clip.startTime);
				const leftClipId = createClipId();
				const rightClipId = createClipId();
				const splitKeyframes = splitClipKeyframes(
					clip,
					splitTime,
					`${leftClipId}-keyframe`,
					`${rightClipId}-keyframe`
				);
				const leftClip = {
					...clip,
					id: leftClipId,
					duration: splitTime,
					keyframes: splitKeyframes.left
				};
				const rightClip = {
					...clip,
					id: rightClipId,
					startTime: currentTime,
					duration: clipEnd - currentTime,
					sourceStart: roundToFrame(getClipSourceTime(clip, splitTime)),
					frozen: true,
					keyframes: splitKeyframes.right
				};
				frozenClipIds.push(leftClip.id, rightClip.id);
				return [leftClip, rightClip];
			});
			return { ...track, clips: nextClips };
		});
		if (!didFreeze) return;
		sound.snap();
		commitTracks(nextTracks);
		setClipSelection(frozenClipIds);
	}

	// flip playback direction for the selected media clips; each toggle is one
	// immutable history entry
	function toggleSelectedClipsReversed() {
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return;
		let changed = false;
		const nextTracks = tracks.map((track) => {
			if (track.locked) return track;
			return {
				...track,
				clips: track.clips.map((clip) => {
					if (!selectedIds.has(clip.id) || !isMediaClip(clip)) return clip;
					changed = true;
					return { ...clip, reversed: !(clip.reversed === true) };
				})
			};
		});
		if (!changed) return;
		sound.select();
		commitTracks(nextTracks);
	}

	function roundTimelineTime(time: number): number {
		return Math.max(1 / FRAME_RATE, Math.round(time * FRAME_RATE) / FRAME_RATE);
	}

	function formatSpeedValue(speed: number): string {
		return Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
	}

	function deleteSelectedClips() {
		sound.delete();
		// deleting a linked clip also deletes its partner(s)
		const selectedIds = new Set(expandLinkedSelection(tracks, getSelectedClipIds()));
		if (selectedIds.size === 0) return;
		const nextTracks = rippleMode
			? rippleDeleteClips(tracks, [...selectedIds])
			: tracks.map((track) => {
					if (track.locked) return track;
					return { ...track, clips: track.clips.filter((clip) => !selectedIds.has(clip.id)) };
				});
		if (nextTracks.every((track, index) => track.clips.length === tracks[index].clips.length))
			return;
		commitTracks(nextTracks);
		clearClipSelection();
	}

	function rippleDeleteSelectedClips() {
		const selectedIds = expandLinkedSelection(tracks, getSelectedClipIds());
		if (selectedIds.length === 0) return;
		sound.delete();
		const nextTracks = rippleDeleteClips(tracks, selectedIds);
		if (nextTracks.every((track, index) => track.clips.length === tracks[index].clips.length))
			return;
		commitTracks(nextTracks);
		clearClipSelection();
	}

	function groupSelectedClips() {
		const selectedIds = getSelectedClipIds();
		if (selectedIds.length < 2) return;
		sound.select();
		const groupId = `group-${Date.now()}-${trackIdSequence++}`;
		const nextTracks = groupClips(tracks, selectedIds, groupId);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	}

	function ungroupSelectedClips() {
		const selectedIds = getSelectedClipIds();
		if (selectedIds.length === 0) return;
		sound.select();
		const nextTracks = ungroupClips(tracks, selectedIds);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	}

	function addMarkerAtPlayhead() {
		sound.select();
		const newMarker: Marker = {
			id: `marker-${Date.now()}-${trackIdSequence++}`,
			time: roundTimelineTime(currentTime),
			label: '',
			color: '#ef4444'
		};
		onMarkersChange([...markers, newMarker].sort((a, b) => a.time - b.time));
	}

	function removeMarker(markerId: string) {
		sound.delete();
		onMarkersChange(markers.filter((marker) => marker.id !== markerId));
	}

	function handleMarkerLabelChange(markerId: string, label: string) {
		onMarkersChange(
			markers.map((marker) => (marker.id === markerId ? { ...marker, label } : marker))
		);
	}

	function startInOutDrag(edge: 'in' | 'out') {
		inOutDrag = { edge };
	}

	function handleInOutDragMove(e: MouseEvent) {
		if (!inOutDrag) return;
		const time = getTimeAtClientX(e.clientX);
		if (time === null) return;
		const rounded = roundTimelineTime(time);
		if (inOutDrag.edge === 'in') {
			onInOutPointsChange({
				in: rounded,
				out: inOutPoints.out !== null && rounded >= inOutPoints.out ? null : inOutPoints.out
			});
			return;
		}
		onInOutPointsChange({
			in: inOutPoints.in !== null && rounded <= inOutPoints.in ? null : inOutPoints.in,
			out: rounded
		});
	}

	function handleInOutDragEnd() {
		inOutDrag = null;
	}

	function handleKeyframeLaneClick(e: MouseEvent, clip: Clip) {
		if (trackLockedForClip(clip)) return;
		e.stopPropagation();
		e.preventDefault();
		const time = getTimeAtClientX(e.clientX);
		if (time === null) return;
		const clipTime = Math.max(0, Math.min(clip.duration, time - clip.startTime));
		currentTime = clip.startTime + clipTime;
		onSeek(currentTime);
	}

	function handleKeyframeDotClick(e: MouseEvent, clip: Clip) {
		if (trackLockedForClip(clip)) return;
		e.stopPropagation();
		e.preventDefault();
		addKeyframeForClip(clip);
	}

	function addKeyframeForClip(clip: Clip) {
		if (trackLockedForClip(clip)) return;
		const clipTime = Math.max(0, Math.min(clip.duration, currentTime - clip.startTime));
		sound.select();
		onAddKeyframes(clip.id, [...KEYFRAME_PROPERTIES], clipTime);
	}

	function handleKeyframeControlKeydown(event: KeyboardEvent, action: () => void) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		action();
	}

	function getSelectedClipAtPlayhead(): Clip | null {
		const selectedId = selectedClipId ?? selectedClipIds.at(-1);
		if (!selectedId) return null;
		for (const track of tracks) {
			if (track.locked) continue;
			const clip = track.clips.find((candidate) => candidate.id === selectedId);
			if (!clip) continue;
			if (currentTime < clip.startTime || currentTime > clip.startTime + clip.duration) return null;
			return clip;
		}
		return null;
	}

	function addKeyframesAtPlayhead() {
		const clip = getSelectedClipAtPlayhead();
		if (!clip) return;
		const clipTime = currentTime - clip.startTime;
		sound.select();
		onAddKeyframes(clip.id, [...KEYFRAME_PROPERTIES], clipTime);
	}

	function handleKeyframeDiamondClick(e: MouseEvent, clip: Clip, keyframeTime: number) {
		e.stopPropagation();
		e.preventDefault();
		currentTime = clip.startTime + keyframeTime;
		onSeek(currentTime);
	}

	function seekToKeyframe(clip: Clip, keyframeTime: number) {
		currentTime = clip.startTime + keyframeTime;
		onSeek(currentTime);
	}

	function handleKeyframeDiamondDelete(e: MouseEvent, clipId: string, keyframeTime: number) {
		e.stopPropagation();
		e.preventDefault();
		onRemoveKeyframesAtTime(clipId, keyframeTime);
	}

	function trackLockedForClip(clip: Clip): boolean {
		const track = tracks.find((t) => t.clips.some((c) => c.id === clip.id));
		return track?.locked ?? false;
	}

	function matchFrameToSelectedClip() {
		const selectedIds = new Set(getSelectedClipIds());
		const selectedClips = tracks
			.flatMap((track) => track.clips)
			.filter((clip) => selectedIds.has(clip.id))
			.sort((a, b) => Math.abs(currentTime - a.startTime) - Math.abs(currentTime - b.startTime));
		if (selectedClips.length === 0) return;
		sound.seek();
		stopPlayback();
		currentTime = selectedClips[0].startTime;
		onSeek(selectedClips[0].startTime);
	}

	function removeSelectedEffects() {
		const selectedIds = getSelectedClipIds();
		if (selectedIds.length === 0) return;
		const nextTracks = removeEffectsFromClips(tracks, selectedIds);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	}

	function removeSelectedTransitions() {
		const selectedIds = getSelectedClipIds();
		if (selectedIds.length === 0) return;
		const nextTracks = removeTransitionFromClips(tracks, selectedIds);
		if (nextTracks === tracks) return;
		commitTracks(nextTracks);
	}

	function cutSelectedClips() {
		if (!copySelectedClips()) return;
		deleteSelectedClips();
	}

	function copySelectedClips(): boolean {
		const selectedIds = new Set(getSelectedClipIds());
		if (selectedIds.size === 0) return false;
		const selectedEntries = tracks.flatMap((track) =>
			track.clips
				.filter((clip) => selectedIds.has(clip.id))
				.map((clip) => ({ clip, sourceTrackId: track.id }))
		);
		if (selectedEntries.length === 0) return false;
		const earliestStart = Math.min(...selectedEntries.map((entry) => entry.clip.startTime));
		clipboard = {
			entries: selectedEntries.map((entry) => ({
				clip: { ...entry.clip },
				sourceTrackId: entry.sourceTrackId,
				offset: entry.clip.startTime - earliestStart
			}))
		};
		return true;
	}

	function pasteClips() {
		if (!clipboard) return;
		const preferredTrackId = findClipTrackId(selectedClipId ?? '') ?? activeTrackId;
		const preferredTrack = tracks.find((track) => track.id === preferredTrackId);
		const additions: Record<string, Clip[]> = Object.create(null);
		const pastedClipIds: string[] = [];

		for (const entry of clipboard.entries) {
			const sourceTrack = tracks.find((track) => track.id === entry.sourceTrackId && !track.locked);
			const targetTrack =
				clipboard.entries.length === 1 && preferredTrack && !preferredTrack.locked
					? preferredTrack
					: (sourceTrack ??
						(preferredTrack && !preferredTrack.locked ? preferredTrack : undefined) ??
						tracks.find((track) => !track.locked));
			if (!targetTrack) continue;

			const newClipId = createClipId();
			const newClip = {
				...entry.clip,
				id: newClipId,
				sourceInstanceId: newClipId,
				keyframes: entry.clip.keyframes?.map((keyframe, index) => ({
					...keyframe,
					id: `${newClipId}-keyframe-${index}`
				})),
				startTime: clampClipStart(currentTime + entry.offset, entry.clip.duration, duration)
			};
			additions[targetTrack.id] = [...(additions[targetTrack.id] ?? []), newClip];
			pastedClipIds.push(newClip.id);
			activeTrackId = targetTrack.id;
		}
		if (pastedClipIds.length === 0) return;

		let baseTracks = tracks;
		if (rippleMode) {
			const totalDuration = getInsertionSpan(additions, currentTime);
			for (const targetId of Object.keys(additions)) {
				const shifted = rippleInsertClips(baseTracks, targetId, currentTime, totalDuration);
				if (shifted !== baseTracks) baseTracks = shifted;
			}
		}

		commitTracks(
			baseTracks.map((track) => ({
				...track,
				clips: [...track.clips, ...(additions[track.id] ?? [])].sort(
					(left, right) => left.startTime - right.startTime
				)
			}))
		);
		setClipSelection(pastedClipIds);
	}

	function duplicateSelectedClips() {
		if (!copySelectedClips()) return;
		pasteClips();
	}

	function clearClipboard() {
		clipboard = null;
	}

	function pasteClipboardEntry(entryIndex: number) {
		if (!clipboard) return;
		const entry = clipboard.entries[entryIndex];
		if (!entry) return;
		const preferredTrackId = activeTrackId;
		const targetTrack =
			tracks.find((t) => t.id === preferredTrackId && !t.locked) ?? tracks.find((t) => !t.locked);
		if (!targetTrack) return;
		const newClipId = createClipId();
		const newClip = {
			...entry.clip,
			id: newClipId,
			sourceInstanceId: newClipId,
			colorGrade: cloneColorGradeOrNull(entry.clip.colorGrade),
			keyframes: entry.clip.keyframes?.map((keyframe, index) => ({
				...keyframe,
				id: `${newClipId}-keyframe-${index}`
			})),
			startTime: clampClipStart(currentTime, entry.clip.duration, duration)
		};
		let baseTracks = tracks;
		if (rippleMode) {
			const shifted = rippleInsertClips(tracks, targetTrack.id, currentTime, entry.clip.duration);
			if (shifted !== tracks) baseTracks = shifted;
		}
		commitTracks(
			baseTracks.map((track) =>
				track.id === targetTrack.id
					? { ...track, clips: [...track.clips, newClip].sort((a, b) => a.startTime - b.startTime) }
					: track
			)
		);
		activeTrackId = targetTrack.id;
		setClipSelection([newClipId]);
		sound.drop();
	}

	// shared source for insert/overwrite editing: rebuild the clipboard entries as
	// fresh clips at the playhead, each targeting the active track (single entry)
	// or its original source track (multi-entry), preserving relative offsets
	function buildClipsFromClipboard(insertTime: number): {
		additions: Record<string, Clip[]>;
		pastedClipIds: string[];
	} {
		const additions: Record<string, Clip[]> = Object.create(null);
		const pastedClipIds: string[] = [];
		if (!clipboard || clipboard.entries.length === 0) return { additions, pastedClipIds };
		const preferredTrack =
			tracks.find((track) => track.id === activeTrackId && !track.locked) ??
			tracks.find((track) => !track.locked);
		if (!preferredTrack) return { additions, pastedClipIds };

		for (const entry of clipboard.entries) {
			const sourceTrack = tracks.find((track) => track.id === entry.sourceTrackId && !track.locked);
			const targetTrack =
				clipboard.entries.length === 1 ? preferredTrack : (sourceTrack ?? preferredTrack);
			if (!targetTrack) continue;
			const newClipId = createClipId();
			const newClip = {
				...entry.clip,
				id: newClipId,
				sourceInstanceId: newClipId,
				colorGrade: cloneColorGradeOrNull(entry.clip.colorGrade),
				keyframes: entry.clip.keyframes?.map((keyframe, index) => ({
					...keyframe,
					id: `${newClipId}-keyframe-${index}`
				})),
				startTime: clampClipStart(insertTime + entry.offset, entry.clip.duration, duration)
			};
			additions[targetTrack.id] = [...(additions[targetTrack.id] ?? []), newClip];
			pastedClipIds.push(newClip.id);
			activeTrackId = targetTrack.id;
		}
		return { additions, pastedClipIds };
	}

	// the actual timeline span the inserted clips occupy (end of the last clip
	// minus the playhead). this is the ripple/overwrite amount - the SUM of the
	// durations would double-count linked pairs that span multiple tracks.
	function getInsertionSpan(additions: Record<string, Clip[]>, insertTime: number): number {
		let spanEnd = insertTime;
		for (const clip of Object.values(additions).flat()) {
			spanEnd = Math.max(spanEnd, clip.startTime + clip.duration);
		}
		return Math.max(0, spanEnd - insertTime);
	}

	// split every clip on a track at the given time (razor semantics: sourceStart
	// and keyframes follow the same rules as the razor tool). used by the insert
	// edit so a splice through the middle of a clip produces a clean edge.
	function splitTrackAtTime(baseTracks: Track[], trackId: string, splitTime: number): Track[] {
		let changed = false;
		const nextTracks = baseTracks.map((track) => {
			if (track.id !== trackId || track.locked) return track;
			const nextClips = track.clips.flatMap((clip) => {
				if (splitTime <= clip.startTime || splitTime >= clip.startTime + clip.duration) {
					return [clip];
				}
				changed = true;
				const leftId = createClipId();
				const rightId = createClipId();
				const clipSplitTime = roundToFrame(splitTime - clip.startTime);
				const splitKeyframes = splitClipKeyframes(
					clip,
					clipSplitTime,
					`${leftId}-keyframe`,
					`${rightId}-keyframe`
				);
				const splitSourceTime = roundToFrame(getClipSourceTime(clip, clipSplitTime));
				const leftClip = {
					...clip,
					id: leftId,
					duration: clipSplitTime,
					keyframes: splitKeyframes.left,
					sourceStart: clip.reversed === true ? splitSourceTime : (clip.sourceStart ?? 0)
				};
				const rightClip = {
					...clip,
					id: rightId,
					startTime: splitTime,
					duration: roundToFrame(clip.startTime + clip.duration - splitTime),
					sourceStart:
						clip.frozen === true || clip.reversed === true
							? (clip.sourceStart ?? 0)
							: splitSourceTime,
					keyframes: splitKeyframes.right
				};
				return [leftClip, rightClip];
			});
			return { ...track, clips: nextClips };
		});
		return changed ? nextTracks : baseTracks;
	}

	// Insert edit (,): splice the clipboard into the timeline at the playhead.
	// clips spanning the playhead are split first, then every unlocked track's
	// clips at/after the playhead ripple right by the total inserted duration, so
	// nothing gets covered - a true insert edit.
	function insertClipsAtPlayhead() {
		const { additions, pastedClipIds } = buildClipsFromClipboard(currentTime);
		if (pastedClipIds.length === 0) return;
		const totalDuration = getInsertionSpan(additions, currentTime);
		let baseTracks = tracks;
		// 1) split clips that span the playhead on every unlocked track
		for (const track of tracks) {
			if (track.locked) continue;
			baseTracks = splitTrackAtTime(baseTracks, track.id, currentTime);
		}
		// 2) ripple: shift every clip at/after the playhead right by the insert
		for (const track of tracks) {
			if (track.locked) continue;
			const shifted = rippleInsertClips(baseTracks, track.id, currentTime, totalDuration);
			if (shifted !== baseTracks) baseTracks = shifted;
		}
		commitTracks(
			baseTracks.map((track) => ({
				...track,
				clips: [...track.clips, ...(additions[track.id] ?? [])].sort(
					(left, right) => left.startTime - right.startTime
				)
			}))
		);
		setClipSelection(pastedClipIds);
		sound.drop();
	}

	// Overwrite edit (.): replace the [playhead, playhead + inserted duration)
	// range on every track that receives a clip - overlapping clips are trimmed,
	// removed or split, and nothing shifts (standard overwrite semantics).
	function overwriteClipsAtPlayhead() {
		const { additions, pastedClipIds } = buildClipsFromClipboard(currentTime);
		if (pastedClipIds.length === 0) return;
		const totalDuration = getInsertionSpan(additions, currentTime);
		let baseTracks = tracks;
		for (const targetId of Object.keys(additions)) {
			baseTracks = overwriteRangeOnTrack(baseTracks, targetId, currentTime, totalDuration);
		}
		commitTracks(
			baseTracks.map((track) => ({
				...track,
				clips: [...track.clips, ...(additions[track.id] ?? [])].sort(
					(left, right) => left.startTime - right.startTime
				)
			}))
		);
		setClipSelection(pastedClipIds);
		sound.drop();
	}

	// clear the [insertTime, insertTime + insertDuration) range on one track: clips
	// fully inside are removed, clips hanging over an edge are trimmed, and a clip
	// spanning the whole range is split into head + tail pieces. sourceStart and
	// keyframes follow the same rules as the razor tool so the remaining content
	// stays glued to its source position.
	function overwriteRangeOnTrack(
		baseTracks: Track[],
		targetTrackId: string,
		insertTime: number,
		insertDuration: number
	): Track[] {
		if (insertDuration <= 0) return baseTracks;
		const rangeEnd = insertTime + insertDuration;
		let changed = false;
		const nextTracks = baseTracks.map((track) => {
			if (track.id !== targetTrackId || track.locked) return track;
			const nextClips: Clip[] = [];
			for (const clip of track.clips) {
				const clipEnd = clip.startTime + clip.duration;
				if (clipEnd <= insertTime || clip.startTime >= rangeEnd) {
					nextClips.push(clip);
					continue;
				}
				changed = true;
				// fully covered by the range: remove
				if (clip.startTime >= insertTime && clipEnd <= rangeEnd) continue;
				// overlaps only the range start: keep the head
				if (clip.startTime < insertTime && clipEnd <= rangeEnd) {
					const headDuration = roundToFrame(insertTime - clip.startTime);
					nextClips.push({
						...clip,
						duration: headDuration,
						keyframes: trimClipKeyframesEnd(clip, headDuration, `${clip.id}-overwrite-end`)
					});
					continue;
				}
				// overlaps only the range end: keep the tail
				if (clip.startTime >= insertTime && clipEnd > rangeEnd) {
					const newStart = roundToFrame(rangeEnd);
					const splitTime = rangeEnd - clip.startTime;
					nextClips.push({
						...clip,
						startTime: newStart,
						duration: roundToFrame(clipEnd - newStart),
						sourceStart:
							clip.frozen === true || clip.reversed === true
								? (clip.sourceStart ?? 0)
								: getClipSourceTime(clip, splitTime),
						keyframes: trimClipKeyframesStart(clip, splitTime, `${clip.id}-overwrite-start`)
					});
					continue;
				}
				// spans the whole range: split into head + tail
				const leftId = createClipId();
				const rightId = createClipId();
				const splitKeyframes = splitClipKeyframes(
					clip,
					insertTime - clip.startTime,
					`${leftId}-keyframe`,
					`${rightId}-keyframe`
				);
				const headDuration = roundToFrame(insertTime - clip.startTime);
				const tailStart = roundToFrame(rangeEnd);
				nextClips.push({
					...clip,
					id: leftId,
					duration: headDuration,
					keyframes: splitKeyframes.left
				});
				nextClips.push({
					...clip,
					id: rightId,
					startTime: tailStart,
					duration: roundToFrame(clip.startTime + clip.duration - tailStart),
					sourceStart:
						clip.frozen === true || clip.reversed === true
							? (clip.sourceStart ?? 0)
							: getClipSourceTime(clip, rangeEnd - clip.startTime),
					keyframes: splitKeyframes.right
				});
			}
			return { ...track, clips: nextClips };
		});
		return changed ? nextTracks : baseTracks;
	}

	function getClipboardClipType(entry: ClipboardEntry): string {
		if (entry.clip.assetId) return 'media';
		if (entry.clip.textStyle) return 'text';
		if (entry.clip.sticker) return 'sticker';
		return 'clip';
	}

	function selectAllClips() {
		setClipSelection(
			tracks.flatMap((track) => (track.locked ? [] : track.clips.map((clip) => clip.id)))
		);
	}

	function syncHeaderScroll() {
		if (!scrollContainer || !headerScrollContainer) return;
		if (headerScrollContainer.scrollTop === scrollContainer.scrollTop) return;
		headerScrollContainer.scrollTop = scrollContainer.scrollTop;
	}

	function syncTimelineScroll() {
		if (!scrollContainer || !headerScrollContainer) return;
		if (scrollContainer.scrollTop === headerScrollContainer.scrollTop) return;
		scrollContainer.scrollTop = headerScrollContainer.scrollTop;
	}

	function splitAtPlayheadToolbar() {
		if (getSelectedClipIds().length === 0) return;
		splitClipAtPlayhead();
	}

	function handleNudgeArrow(e: KeyboardEvent) {
		const direction = e.key === 'ArrowLeft' ? -1 : 1;
		const magnitude = e.shiftKey ? 1 : 10;
		const originalTracks = cloneTracks(tracks);
		const nextTracks = nudgeClips(tracks, getSelectedClipIds(), direction * magnitude, duration);
		if (nextTracks !== tracks) {
			pushUndoSnapshot(originalTracks);
			tracks = nextTracks;
			onTracksChange(nextTracks);
			sound.seek();
		}
	}

	onDestroy(stopPlayback);
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={handleMouseUp} onblur={handleWindowBlur} />

<div
	data-timeline-root
	use:useShortcuts={timelineShortcuts}
	class="flex h-56 shrink-0 flex-col border-t border-border bg-background select-none"
>
	<!-- Timeline toolbar -->
	<div class="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-card px-2.5">
		<!-- playback group -->
		<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={skipBack}
							>
								<SkipBack class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Skip to start ({formatShortcut(skipBackShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={undoTimeline}
								disabled={undoHistory.length === 0}
							>
								<Undo class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Undo ({formatShortcut(undoShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={redoTimeline}
								disabled={redoHistory.length === 0}
							>
								<Redo2 class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Redo ({formatShortcut(redoShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={togglePlay}
								aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
							>
								{#if isPlaying}
									<Pause class="size-4" />
								{:else}
									<Play class="size-4" />
								{/if}
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content
						>{isPlaying ? 'Pause' : 'Play'} ({formatShortcut(playShortcut)})</Tooltip.Content
					>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={stepBackward}
								aria-label="Previous frame"
							>
								<ChevronLeft class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Previous frame ({formatShortcut(stepBackShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={stepForward}
								aria-label="Next frame"
							>
								<ChevronRight class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Next frame ({formatShortcut(stepForwardShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={skipForward}
								aria-label="Go to timeline end"
							>
								<SkipForward class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Skip to end ({formatShortcut(skipForwardShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>

		<div class="h-4 w-px shrink-0 bg-border"></div>

		<!-- time display -->
		<span
			class="min-w-[76px] px-1 font-mono text-[11px] font-medium text-muted-foreground tabular-nums"
		>
			{currentTimeDisplay}
		</span>

		<div class="h-4 w-px shrink-0 bg-border"></div>

		<!-- edit tools -->
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							onclick={splitAtPlayheadToolbar}
							disabled={!selectedClipsCanSplit}
						>
							<Scissors class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Split at playhead ({formatShortcut(splitShortcut)})</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							onclick={freezeSelectedClipsAtPlayhead}
							disabled={!selectedClipsCanFreeze}
						>
							<Snowflake class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Freeze frame ({formatShortcut(freezeShortcut)})</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							onclick={toggleSelectedClipsReversed}
							disabled={!selectedClipsCanReverse}
						>
							<FlipHorizontal2 class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Reverse clip ({formatShortcut(reverseShortcut)})</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class="text-muted-foreground hover:text-foreground"
							onclick={addTrack}
							aria-label="Add track"
						>
							<ListPlus class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Add track</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>
		<Tooltip.Provider delayDuration={400}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon-xs"
							class={cn(
								'text-muted-foreground hover:text-foreground',
								clipboardPanelOpen && clipboard && 'text-primary'
							)}
							onclick={() => (clipboardPanelOpen = !clipboardPanelOpen)}
							disabled={!clipboard}
						>
							<ClipboardPaste class="size-4" />
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content>Clipboard ({clipboard?.entries.length ?? 0})</Tooltip.Content>
			</Tooltip.Root>
		</Tooltip.Provider>

		<div class="flex-1"></div>

		<!-- zoom group -->
		<div class="flex items-center gap-0.5 rounded-md bg-background/60 p-0.5">
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={zoomOut}
							>
								<Minus class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Zoom out ({formatShortcut(zoomOutShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
			<span
				class="min-w-[32px] cursor-default text-center text-[10px] font-medium text-muted-foreground tabular-nums hover:text-foreground"
			>
				{Math.round(zoom)}%
			</span>
			<Tooltip.Provider delayDuration={400}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon-xs"
								class="text-muted-foreground hover:text-foreground"
								onclick={zoomIn}
							>
								<Plus class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>Zoom in ({formatShortcut(zoomInShortcut)})</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>
	</div>

	<!-- Clipboard panel -->
	{#if clipboardPanelOpen && clipboard}
		<div
			class="flex max-h-24 shrink-0 flex-col gap-1.5 overflow-y-auto border-b border-border bg-card/50 px-2.5 py-2"
		>
			<div class="flex items-center justify-between">
				<span class="text-[10px] font-semibold text-foreground"
					>Clipboard - {clipboard.entries.length} item{clipboard.entries.length > 1
						? 's'
						: ''}</span
				>
				<div class="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-xs"
						class="size-5"
						onclick={pasteClips}
						aria-label="Paste all"
						title="Paste all at playhead"
					>
						<ClipboardPaste class="size-3" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
						onclick={insertClipsAtPlayhead}
						title="Insert at playhead (,) - ripples all unlocked tracks"
					>
						Insert
					</Button>
					<Button
						variant="ghost"
						size="sm"
						class="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
						onclick={overwriteClipsAtPlayhead}
						title="Overwrite at playhead (.) - replaces the range, no shift"
					>
						Overwrite
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						class="size-5"
						onclick={clearClipboard}
						aria-label="Clear clipboard"
					>
						<Trash2 class="size-3" />
					</Button>
				</div>
			</div>
			<div class="flex flex-wrap gap-1.5">
				{#each clipboard.entries as entry, i (i)}
					<button
						class="flex items-center gap-1.5 rounded-sm bg-secondary px-2 py-1 text-left text-[10px] transition-colors hover:bg-secondary/70"
						onclick={() => pasteClipboardEntry(i)}
						title="Click to insert at playhead"
					>
						<span class="size-1.5 rounded-full bg-blue-500 text-primary"></span>
						<span class="max-w-[120px] truncate font-medium text-foreground">{entry.clip.name}</span
						>
						<span class="text-muted-foreground tabular-nums">{getClipboardClipType(entry)}</span>
						<span class="text-muted-foreground tabular-nums">{entry.clip.duration.toFixed(1)}s</span
						>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Timeline body -->
	<ContextMenu.Root>
		<ContextMenu.Trigger>
			{#snippet child({ props })}
				<div {...props} class="flex min-h-0 flex-1">
					<!-- Track headers (fixed, scrolls vertically only) -->
					<div
						class="min-h-0 shrink-0 overflow-x-hidden overflow-y-auto border-r border-sidebar-border bg-sidebar"
						style="width: {HEADER_WIDTH}px"
						bind:this={headerScrollContainer}
						onscroll={syncTimelineScroll}
					>
						<!-- Ruler spacer -->
						<div
							class="sticky top-0 z-10 border-b border-sidebar-border bg-card"
							style="height: {RULER_HEIGHT}px"
						></div>
						{#each tracks as track (track.id)}
							<ContextMenu.Root>
								<ContextMenu.Trigger
									oncontextmenu={() => handleTrackHeaderContextMenu(track)}
									class="contents"
								>
									<div
										class="group flex items-center gap-1.5 border-b border-sidebar-border px-2 transition-colors hover:bg-sidebar-accent/30"
										style="height: {TRACK_HEIGHT}px"
									>
										{#if editingTrackId === track.id}
											<input
												type="text"
												bind:value={trackNameDraft}
												onblur={finishEditingTrack}
												onkeydown={handleTrackNameKeydown}
												maxlength="80"
												class="h-6 min-w-0 flex-1 rounded-md border border-ring bg-background px-1.5 text-[11px] outline-none"
											/>
										{:else}
											<div
												class={cn(
													'size-2 shrink-0 rounded-full',
													(TRACK_COLORS[track.color] ?? TRACK_COLORS.blue).dot
												)}
											></div>
											<button
												class={cn(
													'min-w-0 truncate text-left text-[11px] font-semibold hover:underline',
													TRACK_COLORS[track.color]?.accent ?? 'text-muted-foreground'
												)}
												ondblclick={() => startEditingTrack(track)}
												title="Right-click or double-click to rename"
											>
												{track.name}
											</button>
										{/if}
										{#if track.type === 'adjustment'}
											<span
												class="shrink-0 rounded-sm bg-purple-500/20 px-1 py-px text-[8px] font-bold tracking-wide text-purple-400 uppercase"
												title="Adjustment layer - applies effects and grading to all clips below"
											>
												ADJ
											</span>
										{/if}
										<div class="flex-1"></div>
										<Tooltip.Provider delayDuration={400}>
											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															class={cn(
																'rounded-sm p-0.5 transition-colors',
																track.muted
																	? 'text-destructive'
																	: 'text-muted-foreground hover:text-sidebar-foreground'
															)}
															onclick={() => toggleMute(track.id)}
														>
															{#if track.muted}
																<VolumeX class="size-3" />
															{:else}
																<Volume2 class="size-3" />
															{/if}
														</button>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content side="right" sideOffset={4}>
													{track.muted ? 'Unmute' : 'Mute'}
												</Tooltip.Content>
											</Tooltip.Root>
										</Tooltip.Provider>
										<Tooltip.Provider delayDuration={400}>
											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															class={cn(
																'rounded-sm p-0.5 transition-colors',
																track.locked
																	? 'text-amber-400'
																	: 'text-muted-foreground hover:text-sidebar-foreground'
															)}
															onclick={() => toggleLock(track.id)}
														>
															{#if track.locked}
																<Lock class="size-3" />
															{:else}
																<Unlock class="size-3" />
															{/if}
														</button>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content side="right" sideOffset={4}>
													{track.locked ? 'Unlock' : 'Lock'}
												</Tooltip.Content>
											</Tooltip.Root>
										</Tooltip.Provider>
									</div>
								</ContextMenu.Trigger>
								<ContextMenu.Content>
									<ContextMenu.Item
										onclick={() => startEditingTrack(track)}
										disabled={track.locked}
									>
										<Pencil class="size-4" />
										Rename track
									</ContextMenu.Item>
									<ContextMenu.Separator />
									<ContextMenu.Item
										variant="destructive"
										onclick={deleteActiveTrack}
										disabled={track.locked}
									>
										<Trash2 class="size-4" />
										Delete track
									</ContextMenu.Item>
								</ContextMenu.Content>
							</ContextMenu.Root>
						{/each}
						<div aria-hidden="true" style="height: {timelineScrollbarHeight}px"></div>
					</div>

					<!-- Scrollable timeline area (both directions) -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="min-h-0 min-w-0 flex-1 overflow-auto"
						bind:this={scrollContainer}
						onscroll={syncHeaderScroll}
						onwheel={handleTimelineWheel}
						onmousedown={handleTimelineBackgroundMouseDown}
						ondragover={(event) => handleInsertDragOver(event, null)}
						ondrop={(event) => handleInsertDrop(event, null)}
					>
						<div class="relative" style="width: {timelineWidth}px">
							<!-- Time ruler -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="relative sticky top-0 z-10 cursor-pointer border-b border-border bg-card"
								style="height: {RULER_HEIGHT}px"
								onmousedown={handleRulerClick}
							>
								{#each rulerMarks as mark (mark.time)}
									<div
										class="absolute top-0 flex flex-col items-center"
										style="left: {mark.time * pixelsPerSecond}px"
									>
										<div
											class={cn('w-px', mark.major ? 'h-3 bg-border' : 'h-1.5 bg-border/50')}
										></div>
										{#if mark.label}
											<span
												class="absolute top-3.5 font-mono text-[9px] font-medium whitespace-nowrap text-muted-foreground tabular-nums"
											>
												{mark.label}
											</span>
										{/if}
									</div>
								{/each}
								<!-- Markers -->
								{#each markerPositions as marker (marker.id)}
									<div
										class="absolute top-0 z-20 cursor-pointer"
										style="left: {marker.x}px"
										title={marker.label || `Marker at ${formatTime(marker.time)}`}
										ondblclick={(event) => {
											event.stopPropagation();
											if (event.shiftKey) {
												removeMarker(marker.id);
												return;
											}
											const label = window.prompt('Marker label', marker.label);
											if (label === null) return;
											handleMarkerLabelChange(marker.id, label.trim());
										}}
									>
										<div class="h-4 w-0.5 bg-red-500"></div>
										<div
											class="absolute top-0 left-0 flex -translate-x-1/2 items-center rounded-sm bg-red-500 px-1"
										>
											<MapPin class="size-2 text-white" />
										</div>
										{#if marker.label}
											<span
												class="absolute top-4 left-0 text-[8px] font-medium whitespace-nowrap text-red-400 tabular-nums"
											>
												{marker.label}
											</span>
										{/if}
									</div>
								{/each}

								<!-- In/out points overlay -->
								{#if inOutPoints.in !== null || inOutPoints.out !== null}
									{@const inX = inOutPoints.in !== null ? inOutPoints.in * pixelsPerSecond : 0}
									{@const outX =
										inOutPoints.out !== null ? inOutPoints.out * pixelsPerSecond : timelineWidth}
									<div
										class="pointer-events-none absolute top-0 bottom-0 z-15 border-x border-emerald-500/40 bg-emerald-500/10"
										style="left: {inX}px; width: {Math.max(0, outX - inX)}px"
									></div>
									{#if inOutPoints.in !== null}
										<div
											class="pointer-events-auto absolute top-0 bottom-0 z-20 cursor-ew-resize"
											style="left: {inX}px; width: 3px"
											title="In point - {formatTime(inOutPoints.in)}"
											onmousedown={(e) => {
												e.stopPropagation();
												e.preventDefault();
												startInOutDrag('in');
											}}
										>
											<div class="absolute top-0 left-0 h-full w-full bg-emerald-500"></div>
											<div
												class="absolute top-0 left-0 -translate-x-1/2 rounded-sm bg-emerald-500 px-1 text-[8px] font-bold whitespace-nowrap text-white"
											>
												IN
											</div>
										</div>
									{/if}
									{#if inOutPoints.out !== null}
										<div
											class="pointer-events-auto absolute top-0 bottom-0 z-20 cursor-ew-resize"
											style="left: {outX}px; width: 3px"
											title="Out point - {formatTime(inOutPoints.out)}"
											onmousedown={(e) => {
												e.stopPropagation();
												e.preventDefault();
												startInOutDrag('out');
											}}
										>
											<div class="absolute top-0 left-0 h-full w-full bg-emerald-500"></div>
											<div
												class="absolute top-0 left-0 -translate-x-1/2 rounded-sm bg-emerald-500 px-1 text-[8px] font-bold whitespace-nowrap text-white"
											>
												OUT
											</div>
										</div>
									{/if}
								{/if}
							</div>

							<!-- Track lanes -->
							{#each tracks as track, trackIndex (track.id)}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									data-track-id={track.id}
									class={cn(
										'relative border-b border-border',
										activeTool === 'hand' && 'cursor-grab',
										activeTool === 'razor' && 'cursor-crosshair',
										activeTool === 'text' && 'cursor-text',
										trackIndex % 2 === 0 ? 'bg-background' : 'bg-background/50'
									)}
									style="height: {TRACK_HEIGHT}px"
									onmousedown={(e) => handleTrackMouseDown(e, track.id)}
									oncontextmenu={() => (activeTrackId = track.id)}
									ondragover={(event) => handleInsertDragOver(event, track)}
									ondrop={(event) => handleInsertDrop(event, track)}
								>
									{#each track.clips as clip (clip.id)}
										{@const colors = TRACK_COLORS[track.color] ?? TRACK_COLORS.blue}
										{@const clipWidth = clip.duration * pixelsPerSecond}
										{@const clipLeft = clip.startTime * pixelsPerSecond}
										{@const asset = clip.assetId ? assetsById.get(clip.assetId) : null}
										{@const isClipSelected =
											selectedClipIds.includes(clip.id) || selectedClipId === clip.id}
										<button
											data-clip
											class={cn(
												'group absolute top-1 bottom-1 flex items-center rounded-md border px-2 text-left transition-all',
												activeTool === 'hand' && 'cursor-grab',
												activeTool === 'razor' && 'cursor-crosshair',
												activeTool === 'text' && 'cursor-text',
												(activeTool === 'slip' ||
													activeTool === 'rolling' ||
													activeTool === 'slide') &&
													'cursor-ew-resize',
												colors.bg,
												colors.border,
												clip.effects?.length && 'ring-1 ring-primary/50',
												isChromaKeyActive(clip.chromaKey) && 'ring-1 ring-primary/40',
												clip.frozen && 'ring-1 ring-sky-400/50',
												clip.reversed && 'ring-1 ring-amber-400/40',
												clip.clipTransition && 'border-primary/70',
												isClipSelected
													? 'shadow-md ring-2 ring-primary brightness-110'
													: 'hover:brightness-110'
											)}
											style="left: {clipLeft}px; width: {Math.max(clipWidth, 2)}px"
											onclick={(e) => handleClipClick(e, clip.id)}
											ondblclick={(event) => handleClipDoubleClick(event, clip)}
											onmousedown={(e) => handleClipMouseDown(e, track, clip)}
											oncontextmenu={() => handleClipContextMenu(clip.id)}
											ondragover={(event) => handleEffectDragOver(event, track)}
											ondrop={(event) => handleEffectDrop(event, track, clip)}
										>
											{#if asset?.kind === 'audio' && clip.assetId}
												<Waveform src={asset.src} {pixelsPerSecond} volume={clip.volume ?? 1} />
											{/if}
											{#if track.type === 'adjustment' && clipWidth > 16}
												<Layers class="size-3 shrink-0 text-purple-400" title="Adjustment layer" />
											{/if}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												data-trim-handle="start"
												class={cn(
													'absolute top-0 bottom-0 left-0 z-10 w-1.5 cursor-ew-resize rounded-l-md bg-foreground/60 opacity-0 transition-opacity group-hover:opacity-100',
													isClipSelected && 'opacity-100',
													track.locked && 'cursor-not-allowed'
												)}
												onmousedown={(event) =>
													startClipTrim(
														event,
														track,
														clip,
														'start',
														activeTool === 'rolling' ? 'rolling' : 'trim'
													)}
												title="Trim start"
											></span>
											{#if clipWidth > 16 || clip.textStyle}
												<span
													class="relative z-[1] truncate text-[10px] font-medium text-foreground/90"
												>
													{clip.name}
												</span>
											{/if}
											{#if clip.caption && clipWidth > 20}
												<Captions class="ml-1 size-3 shrink-0 text-foreground/60" />
											{/if}
											{#if clip.duckSource && clipWidth > 20}
												<Mic class="ml-1 size-3 shrink-0 text-primary" title="Auto-ducking" />
											{/if}
											{#if clip.frozen && clipWidth > 20}
												<Snowflake class="ml-1 size-3 shrink-0 text-sky-400" title="Frozen frame" />
											{/if}
											{#if clip.reversed && clipWidth > 20}
												<FlipHorizontal2
													class="ml-1 size-3 shrink-0 text-amber-400"
													title="Reversed"
												/>
											{/if}
											{#if isChromaKeyActive(clip.chromaKey) && clipWidth > 20}
												<Slice class="ml-auto size-3 shrink-0 text-primary" />
											{/if}
											{#if clip.effects?.length && clipWidth > 20}
												<Sparkles
													class={cn(
														'size-3 shrink-0 text-primary',
														!isChromaKeyActive(clip.chromaKey) && 'ml-auto'
													)}
												/>
											{/if}
											{#if clip.clipTransition && clipWidth > 28}
												<ArrowLeftRight class="ml-1 size-3 shrink-0 text-primary" />
											{/if}
											{#if clipWidth > 30}
												{@const clipSpeedRange = getClipSpeedRange(clip)}
												{#if clipSpeedRange}
													<span
														class="ml-1 shrink-0 text-[9px] font-medium text-primary tabular-nums"
														title="Speed ramp"
													>
														{formatSpeedValue(clipSpeedRange.min)}x-{formatSpeedValue(
															clipSpeedRange.max
														)}x
													</span>
												{:else if clip.speed && clip.speed !== 1}
													<span
														class="ml-1 shrink-0 text-[9px] font-medium text-primary tabular-nums"
													>
														{clip.speed}x
													</span>
												{/if}
											{/if}
											{#if clip.groupId && clipWidth > 25}
												<span class="ml-1 shrink-0 text-primary">
													<Group class="size-2.5" />
												</span>
											{/if}
											{#if clip.opacity !== undefined && clip.opacity < 1 && clipWidth > 30}
												<span class="ml-1 shrink-0 text-[9px] text-muted-foreground tabular-nums">
													{Math.round(clip.opacity * 100)}%
												</span>
											{/if}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												data-trim-handle="end"
												class={cn(
													'absolute top-0 right-0 bottom-0 z-10 w-1.5 cursor-ew-resize rounded-r-md bg-foreground/60 opacity-0 transition-opacity group-hover:opacity-100',
													isClipSelected && 'opacity-100',
													track.locked && 'cursor-not-allowed'
												)}
												onmousedown={(event) =>
													startClipTrim(
														event,
														track,
														clip,
														'end',
														activeTool === 'rolling' ? 'rolling' : 'trim'
													)}
												title="Trim end"
											></span>
											{#if isClipSelected && !track.locked && clipWidth > 50}
												<!-- keyframe lane -->
												<!-- svelte-ignore a11y_click_events_have_key_events -->
												<div
													class="keyframe-lane"
													onclick={(e) => handleKeyframeLaneClick(e, clip)}
													role="button"
													tabindex="-1"
													aria-label="Keyframe lane - click to seek"
												>
													{#each getClipKeyframeTimes(clip) as keyframeTime (keyframeTime)}
														{@const kfX = keyframeTime * pixelsPerSecond}
														{#if kfX >= 0 && kfX <= clipWidth}
															<div
																class="keyframe-diamond"
																style="left: {kfX}px; --kf-color: #f59e0b"
																onclick={(e) => handleKeyframeDiamondClick(e, clip, keyframeTime)}
																onkeydown={(event) =>
																	handleKeyframeControlKeydown(event, () =>
																		seekToKeyframe(clip, keyframeTime)
																	)}
																role="button"
																tabindex="0"
																aria-label={`Keyframe at ${keyframeTime.toFixed(2)}s - click to seek`}
																title={`Keyframe @ ${keyframeTime.toFixed(2)}s`}
															>
																<span
																	class="keyframe-delete"
																	onclick={(e) =>
																		handleKeyframeDiamondDelete(e, clip.id, keyframeTime)}
																	onkeydown={(event) =>
																		handleKeyframeControlKeydown(event, () =>
																			onRemoveKeyframesAtTime(clip.id, keyframeTime)
																		)}
																	role="button"
																	tabindex="0"
																	aria-label="Delete keyframe"
																	title="Delete keyframe"
																>
																	<X class="size-2" />
																</span>
															</div>
														{/if}
													{/each}
												</div>
												<!-- unified keyframe control -->
												<div
													class="keyframe-dots opacity-0 transition-opacity duration-150 group-hover:opacity-100"
												>
													<span
														class="keyframe-dot"
														style="background: #f59e0b"
														onclick={(e) => handleKeyframeDotClick(e, clip)}
														onkeydown={(event) =>
															handleKeyframeControlKeydown(event, () => addKeyframeForClip(clip))}
														role="button"
														tabindex="0"
														aria-label="Add keyframe at playhead"
														title="Add keyframe at playhead">K</span
													>
												</div>
											{/if}
										</button>
									{/each}
								</div>
							{/each}
							{#if tracks.length === 0}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="h-14 border-b border-border bg-background/50"
									ondragover={(event) => handleInsertDragOver(event, null)}
									ondrop={(event) => handleInsertDrop(event, null)}
								></div>
							{/if}

							<!-- Playhead -->
							<div
								class={cn(
									'absolute bottom-0 z-20',
									isDraggingPlayhead ? 'cursor-col-resize' : 'pointer-events-none'
								)}
								style="left: {playheadX}px; top: 0"
							>
								<!-- Handle (triangle) -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class={cn(
										'pointer-events-auto absolute top-0 left-1/2 -translate-x-1/2 cursor-col-resize transition-transform hover:scale-110',
										'border-t-[7px] border-r-[6px] border-l-[6px] border-t-red-500 border-r-transparent border-l-transparent drop-shadow'
									)}
									onmousedown={handlePlayheadMouseDown}
								></div>
								<!-- Line -->
								<div class="absolute top-2 bottom-0 w-0.5 bg-red-500 shadow-sm"></div>
							</div>
						</div>
					</div>
				</div>
			{/snippet}
		</ContextMenu.Trigger>
		<ContextMenu.Content>
			{#if getSelectedClipIds().length > 0}
				<ContextMenu.Item onclick={cutSelectedClips}>
					<Scissors class="size-4" />
					Cut
					<ContextMenu.Shortcut>{formatShortcut(cutShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={copySelectedClips}>
					<Copy class="size-4" />
					Copy
					<ContextMenu.Shortcut>{formatShortcut(copyShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={pasteClips} disabled={!clipboard}>
					<ClipboardPaste class="size-4" />
					Paste
					<ContextMenu.Shortcut>{formatShortcut(pasteShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={duplicateSelectedClips}>
					<CopyPlus class="size-4" />
					Duplicate
					<ContextMenu.Shortcut>{formatShortcut(duplicateShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={splitClipAtPlayhead} disabled={!selectedClipsCanSplit}>
					<Scissors class="size-4" />
					Split at playhead
					<ContextMenu.Shortcut>{formatShortcut(splitShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item
					onclick={freezeSelectedClipsAtPlayhead}
					disabled={!selectedClipsCanFreeze}
				>
					<Snowflake class="size-4" />
					Freeze frame
					<ContextMenu.Shortcut>{formatShortcut(freezeShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={toggleSelectedClipsReversed} disabled={!selectedClipsCanReverse}>
					<FlipHorizontal2 class="size-4" />
					Reverse clip
					<ContextMenu.Shortcut>{formatShortcut(reverseShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item
					onclick={() => addKeyframesAtPlayhead()}
					disabled={!getSelectedClipAtPlayhead()}
				>
					<Diamond class="size-4" />
					Add keyframe
					<ContextMenu.Shortcut>{formatShortcut(keyframeShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={trimSelectedClipStarts} disabled={!selectedClipsCanSplit}>
					<PanelLeftClose class="size-4" />
					Trim start to playhead
					<ContextMenu.Shortcut>{formatShortcut(trimStartShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={trimSelectedClipEnds} disabled={!selectedClipsCanSplit}>
					<PanelRightClose class="size-4" />
					Trim end to playhead
					<ContextMenu.Shortcut>{formatShortcut(trimEndShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				{#if selectedTextClip}
					<ContextMenu.Item onclick={() => openTextEditor(selectedTextClip)}>
						Edit text
					</ContextMenu.Item>
				{/if}
				{#if selectedClipsHaveEffects}
					<ContextMenu.Item onclick={removeSelectedEffects}>
						<Sparkles class="size-4" />
						Remove effects
					</ContextMenu.Item>
				{/if}
				{#if selectedClipsHaveTransitions}
					<ContextMenu.Item onclick={removeSelectedTransitions}>
						<ArrowLeftRight class="size-4" />
						Remove clip transition
					</ContextMenu.Item>
				{/if}
				{#if selectedClipIds.length >= 2}
					<ContextMenu.Separator />
					<ContextMenu.Item onclick={groupSelectedClips}>
						<Group class="size-4" />
						Group clips
						<ContextMenu.Shortcut>{formatShortcut(groupShortcut)}</ContextMenu.Shortcut>
					</ContextMenu.Item>
				{/if}
				{#if selectedClipsHaveGroup}
					<ContextMenu.Item onclick={ungroupSelectedClips}>
						<Ungroup class="size-4" />
						Ungroup clips
						<ContextMenu.Shortcut>{formatShortcut(ungroupShortcut)}</ContextMenu.Shortcut>
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={matchFrameToSelectedClip}>
					<Crosshair class="size-4" />
					Match frame
				</ContextMenu.Item>
				{#if rippleMode}
					<ContextMenu.Item onclick={rippleDeleteSelectedClips}>
						<ArrowLeftRight class="size-4" />
						Ripple delete
						<ContextMenu.Shortcut>{formatShortcut(rippleDeleteShortcut)}</ContextMenu.Shortcut>
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item variant="destructive" onclick={deleteSelectedClips}>
					<Trash class="size-4" />
					Delete
					<ContextMenu.Shortcut>{formatShortcut(deleteShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
			{:else}
				<ContextMenu.Item onclick={addTrack}>
					<ListPlus class="size-4" />
					Add track
				</ContextMenu.Item>
				<ContextMenu.Item onclick={addAdjustmentLayer}>
					<Layers class="size-4" />
					Add adjustment layer
				</ContextMenu.Item>
				<ContextMenu.Item
					variant="destructive"
					onclick={deleteActiveTrack}
					disabled={!activeTrackId || activeTrackLocked}
				>
					<Trash2 class="size-4" />
					Delete track
				</ContextMenu.Item>
				<ContextMenu.Item onclick={pasteClips} disabled={!clipboard}>
					<ClipboardPaste class="size-4" />
					Paste
					<ContextMenu.Shortcut>{formatShortcut(pasteShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={onSetInPoint}>
					Set in point
					<ContextMenu.Shortcut>{formatShortcut(inPointShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				<ContextMenu.Item onclick={onSetOutPoint}>
					Set out point
					<ContextMenu.Shortcut>{formatShortcut(outPointShortcut)}</ContextMenu.Shortcut>
				</ContextMenu.Item>
				{#if inOutPoints.in !== null || inOutPoints.out !== null}
					<ContextMenu.Item onclick={onClearInOutPoints}>
						Clear in/out
						<ContextMenu.Shortcut>Ctrl+Shift+I</ContextMenu.Shortcut>
					</ContextMenu.Item>
				{/if}
				<ContextMenu.Separator />
				<ContextMenu.Item onclick={selectAllClips}>
					Select all
					<ContextMenu.Shortcut>Ctrl+A</ContextMenu.Shortcut>
				</ContextMenu.Item>
			{/if}
		</ContextMenu.Content>
	</ContextMenu.Root>

	<Dialog.Root bind:open={textEditorOpen}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title>Edit text</Dialog.Title>
				<Dialog.Description>Update the text shown in the preview.</Dialog.Description>
			</Dialog.Header>
			<div class="grid gap-3">
				<input
					type="text"
					bind:value={textDraft}
					onkeydown={handleTextInputKeydown}
					maxlength="500"
					class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
				/>
				{#if textStyleDraft}
					<div class="grid grid-cols-2 gap-2">
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Font</span>
							<Select.Root
								type="single"
								value={textStyleDraft.fontFamily}
								onValueChange={updateTextFontFamily}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs">
									<span class="truncate">{textStyleDraft.fontFamily}</span>
								</Select.Trigger>
								<Select.Content>
									{#each TEXT_FONT_FAMILIES as fontFamily (fontFamily)}
										<Select.Item value={fontFamily} label={fontFamily} />
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Weight</span>
							<Select.Root
								type="single"
								value={String(textStyleDraft.fontWeight)}
								onValueChange={updateTextFontWeight}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs">
									<span>{textStyleDraft.fontWeight}</span>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="400" label="Regular" />
									<Select.Item value="500" label="Medium" />
									<Select.Item value="600" label="Semibold" />
									<Select.Item value="700" label="Bold" />
									<Select.Item value="800" label="Extra bold" />
								</Select.Content>
							</Select.Root>
						</div>
						<label class="grid gap-1 text-xs text-muted-foreground">
							Size
							<input
								type="number"
								min="8"
								max="200"
								bind:value={textStyleDraft.fontSize}
								class="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
							/>
						</label>
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Background</span>
							<Select.Root
								type="single"
								value={textStyleDraft.backgroundColor}
								onValueChange={updateTextBackground}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs">
									<span
										>{textStyleDraft.backgroundColor === 'transparent'
											? 'Transparent'
											: textStyleDraft.backgroundColor === '#000000b3'
												? 'Black'
												: 'White'}</span
									>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="transparent" label="Transparent" />
									<Select.Item value="#000000b3" label="Black" />
									<Select.Item value="#ffffff" label="White" />
								</Select.Content>
							</Select.Root>
						</div>
						<label class="grid gap-1 text-xs text-muted-foreground">
							Text color
							<input
								type="color"
								bind:value={textStyleDraft.color}
								class="h-8 w-full rounded-md border border-input bg-background p-1"
							/>
						</label>
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Alignment</span>
							<Select.Root
								type="single"
								value={textStyleDraft.textAlign}
								onValueChange={updateTextAlignment}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs capitalize">
									<span>{textStyleDraft.textAlign}</span>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="left" label="Left" />
									<Select.Item value="center" label="Center" />
									<Select.Item value="right" label="Right" />
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-1 text-xs text-muted-foreground">
							<span>Case</span>
							<Select.Root
								type="single"
								value={textStyleDraft.textTransform}
								onValueChange={updateTextTransform}
							>
								<Select.Trigger size="sm" class="h-8 w-full text-xs">
									<span
										>{textStyleDraft.textTransform === 'uppercase' ? 'Uppercase' : 'Original'}</span
									>
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="none" label="Original" />
									<Select.Item value="uppercase" label="Uppercase" />
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				{/if}
			</div>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (textEditorOpen = false)}>Cancel</Button>
				<Button onclick={saveTextContent} disabled={!textDraft.trim()}>Save</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<style>
	.keyframe-lane {
		position: absolute;
		bottom: 2px;
		left: 4px;
		right: 4px;
		height: 14px;
		cursor: crosshair;
		pointer-events: auto;
		z-index: 5;
	}

	.keyframe-diamond {
		position: absolute;
		bottom: 1px;
		width: 8px;
		height: 8px;
		transform: translateX(-50%) rotate(45deg);
		background: var(--kf-color, #888);
		border: 1px solid rgba(255, 255, 255, 0.3);
		cursor: pointer;
		transition: scale 0.1s;
	}

	.keyframe-diamond:hover {
		scale: 1.4;
		z-index: 6;
	}

	.keyframe-delete {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%) rotate(-45deg);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: hsl(0 72% 51%);
		color: white;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.1s;
	}

	.keyframe-diamond:hover .keyframe-delete {
		opacity: 1;
		pointer-events: auto;
	}

	.keyframe-delete:hover {
		background: hsl(0 84% 60%);
	}

	.keyframe-dots {
		position: absolute;
		bottom: 18px;
		left: 4px;
		display: flex;
		gap: 2px;
		z-index: 7;
		pointer-events: auto;
	}

	.keyframe-dot {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 12px;
		height: 12px;
		border-radius: 3px;
		font-size: 7px;
		font-weight: 700;
		color: white;
		cursor: pointer;
		opacity: 0.7;
		transition:
			opacity 0.1s,
			scale 0.1s;
		line-height: 1;
	}

	.keyframe-dot:hover {
		opacity: 1;
		scale: 1.2;
	}
</style>
