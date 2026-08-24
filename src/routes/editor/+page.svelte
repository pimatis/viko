<script lang="ts">
	import MobileNotice from '../../components/MobileNotice.svelte';
	import Navbar from '../../components/editor/Navbar.svelte';
	import Player from '../../components/editor/Player.svelte';
	import PropertiesPanel from '../../components/editor/PropertiesPanel.svelte';
	import Sidebar from '../../components/editor/Sidebar.svelte';
	import AudioMixer from '../../components/editor/AudioMixer.svelte';
	import SourceMonitor from '../../components/editor/SourceMonitor.svelte';
	import Timeline from '../../components/editor/Timeline.svelte';
	import CaptionEditor from '../../components/editor/CaptionEditor.svelte';
	import Toolbar from '../../components/editor/Toolbar.svelte';
	import GuideTour from '../../components/editor/GuideTour.svelte';
	import CommandPalette from '../../components/editor/CommandPalette.svelte';
	import ProjectNotice from '../../components/editor/ProjectNotice.svelte';
	import RestoreProjectPrompt from '../../components/editor/RestoreProjectPrompt.svelte';
	import NewProjectDialog from '../../components/editor/dialogs/NewProjectDialog.svelte';
	import NestedSequenceEditor from '../../components/editor/NestedSequenceEditor.svelte';
	import ProjectSettingsDialog from '../../components/editor/dialogs/ProjectSettingsDialog.svelte';
	import ShortcutsDialog from '../../components/editor/dialogs/ShortcutsDialog.svelte';
	import VersionHistoryDialog from '../../components/editor/dialogs/VersionHistoryDialog.svelte';
	import ExportDialog from '../../components/editor/dialogs/ExportDialog.svelte';
	import { useShortcuts } from '$lib/shortcuts';
	import { EditorState } from '$lib/editor/state.svelte';

	const editor = new EditorState();
	editor.init();
</script>

<div
	class="flex h-screen w-screen flex-col overflow-hidden bg-background"
	use:useShortcuts={editor.paletteBindings}
>
	<input
		bind:this={editor.openProjectInput}
		type="file"
		accept=".viko,.json,application/json"
		class="hidden"
		onchange={(e) => editor.handleProjectFileChange(e)}
	/>
	<GuideTour onEnsureSidebarOpen={() => (editor.sidebarOpen = true)} />
	<Navbar
		bind:projectName={editor.projectName}
		bind:zoom={editor.zoom}
		canUndo={editor.canUndo}
		canRedo={editor.canRedo}
		isSaved={editor.isSaved}
		isSaving={editor.isSaving}
		autoSaveEnabled={editor.autoSaveEnabled}
		bind:exportQuality={editor.exportQuality}
		exportResolution={editor.exportResolution}
		isExporting={editor.isExporting}
		exportQualities={editor.EXPORT_QUALITIES}
		onExportQualityChange={(id) => editor.handleExportQualityChange(id)}
		onExport={() => void editor.handleExportVideo()}
		isCapturingFrame={editor.isCapturingFrame}
		onCaptureFrame={(fmt) => editor.handleCaptureFrame(fmt)}
		onNewProject={() => (editor.newProjectDialogOpen = true)}
		onOpenProject={() => editor.openProjectInput?.click()}
		onSave={() => void editor.saveProject()}
		onSaveAs={() => editor.downloadProject()}
		onAutoSaveToggle={(enabled) => (editor.autoSaveEnabled = enabled)}
		onShowVersionHistory={() => {
			editor.versionSearchQuery = '';
			editor.historyDialogOpen = true;
			void editor.loadVersionHistory();
		}}
		onShowShortcuts={() => (editor.shortcutsDialogOpen = true)}
		onProjectNameChange={() => (editor.isSaved = false)}
		onUndo={() => editor.requestTimelineCommand('undo')}
		onRedo={() => editor.requestTimelineCommand('redo')}
		onToggleSidebar={() => editor.toggleSidebar()}
		frameRate={editor.frameRate}
		onOpenProjectSettings={() => (editor.projectSettingsOpen = true)}
	/>

	<div class="flex min-h-0 flex-1">
		<Sidebar
			bind:open={editor.sidebarOpen}
			bind:mediaAssets={editor.mediaAssets}
			bind:mediaFolders={editor.mediaFolders}
			usedAssetIds={editor.usedAssetIds}
			resources={editor.editorResources}
			captionPresets={editor.CAPTION_PRESETS}
			onToggle={() => editor.toggleSidebar()}
			onMediaAssetsChange={(assets) => editor.handleMediaAssetsChange(assets)}
			onMediaFoldersChange={(folders) => editor.handleMediaFoldersChange(folders)}
			onAssetApply={(asset) => editor.dropMediaAsset(asset.id, '', editor.currentTime, true)}
			onAssetSelect={(id) => editor.openSourceMonitor(id)}
			onResourceApply={(resource) => editor.applyResource(resource)}
			onCreateText={() => editor.createDefaultText()}
			onGenerateCaptions={(payload) => editor.handleGenerateCaptions(payload)}
			onTranscribeMedia={(presetId) => void editor.handleTranscribeMedia(presetId)}
			onRelinkAsset={(assetId) => editor.handleRelinkAsset(assetId)}
			transcribing={editor.isTranscribing}
			transcribeProgress={editor.transcribeProgress}
			transcribeFileName={editor.transcribeFileName}
		/>

		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<Toolbar
				bind:activeTool={editor.activeTool}
				bind:snappingEnabled={editor.snappingEnabled}
				bind:zoom={editor.zoom}
				rippleMode={editor.rippleMode}
				onRippleModeToggle={(enabled) => editor.handleRippleModeToggle(enabled)}
				hasInOutPoints={editor.inOutPoints.in !== null || editor.inOutPoints.out !== null}
				onSetInPoint={() => editor.handleSetInPoint()}
				onSetOutPoint={() => editor.handleSetOutPoint()}
				onClearInOutPoints={() => editor.handleClearInOutPoints()}
				sourceMonitorOpen={editor.sourceMonitorOpen}
				onSourceMonitorToggle={() => editor.toggleSourceMonitor()}
				mixerOpen={editor.mixerOpen}
				onMixerToggle={() => editor.toggleMixer()}
			/>
			<SourceMonitor
				bind:open={editor.sourceMonitorOpen}
				asset={editor.sourceAsset}
				bind:currentTime={editor.sourceTime}
				bind:isPlaying={editor.sourceIsPlaying}
				bind:inPoint={editor.sourceInPoint}
				bind:outPoint={editor.sourceOutPoint}
				bind:root={editor.sourceMonitorRootEl}
				onClose={() => editor.closeSourceMonitor()}
				onPlaybackChange={(playing) => (editor.sourceIsPlaying = playing)}
				onSetInPoint={() => editor.setSourceInPoint()}
				onSetOutPoint={() => editor.setSourceOutPoint()}
				onClearInOut={() => editor.clearSourceInOutPoints()}
				onInsert={() => editor.insertFromSourceMonitor()}
			/>
			<Player
				bind:currentTime={editor.currentTime}
				bind:isPlaying={editor.isPlaying}
				bind:selectedClipId={editor.selectedClipId}
				bind:aspectRatio={editor.playerAspectRatio}
				bind:aspectRatioMode={editor.aspectRatioMode}
				onAspectSettingsChange={() => editor.handleAspectSettingsChange()}
				duration={editor.timelineContentEnd}
				tracks={editor.tracks}
				mediaAssets={editor.mediaAssets}
				bind:playbackRate={editor.playbackRate}
				bind:loopEnabled={editor.loopEnabled}
				onVisualUpdate={(clipId, update) => editor.requestVisualUpdate(clipId, update)}
			/>
			<CaptionEditor
				segments={editor.captionSegments}
				onChange={(segments) => editor.handleCaptionSegmentsChange(segments)}
				onSeek={(time) => (editor.currentTime = time)}
			/>
		</div>

		{#if editor.propertiesPanelOpen}
			<div
				data-properties-panel
				class="flex w-60 shrink-0 flex-col border-l border-sidebar-border bg-sidebar"
			>
				<div class="flex h-8 items-center justify-between border-b border-sidebar-border px-3">
					<span class="text-[11px] font-semibold text-foreground">Properties</span>
				</div>
				<PropertiesPanel
					clip={editor.selectedClip}
					isAudioClip={editor.selectedClipIsAudio}
					clipTime={editor.playerClipTime}
					onPropertyChange={(clipId, updater) => editor.handleClipPropertyChange(clipId, updater)}
					onToggleReverse={(clipId) => editor.handleToggleClipReversed(clipId)}
					onAddKeyframe={(clipId, prop, val, time) =>
						editor.handleAddKeyframe(clipId, prop, val, time)}
					onAddKeyframes={(clipId, props, time) => editor.handleAddKeyframes(clipId, props, time)}
					onRemoveKeyframesAtTime={(clipId, time) =>
						editor.handleRemoveKeyframesAtTime(clipId, time)}
					matchSources={editor.matchSources}
					onMatchColor={(refId) => void editor.handleMatchColor(refId)}
					onAutoLevels={() => void editor.handleAutoLevels()}
					autoLeveling={editor.autoLeveling}
					onLutPreview={(lutId, canvas) => void editor.handleLutPreview(lutId, canvas)}
					matching={editor.matchingClipId === editor.selectedClipId}
					canNormalizeAudio={editor.selectedClipHasAudio}
					normalizing={editor.normalizing}
					onNormalizeAudio={(clipId) => void editor.handleNormalizeAudio(clipId)}
					linked={editor.selectedClipLinked}
					onClose={() => (editor.propertiesPanelOpen = false)}
					onUnlink={() => editor.selectedClip && editor.handleUnlinkClip(editor.selectedClip.id)}
				/>
			</div>
		{/if}
	</div>

	{#if editor.mixerOpen}
		<AudioMixer
			tracks={editor.tracks}
			mediaAssets={editor.mediaAssets}
			masterVolume={editor.mixerMasterVolume}
			onMasterVolume={(vol) => editor.handleMixerMasterVolume(vol)}
			onTrackVolume={(trackId, vol) => editor.handleMixerTrackVolume(trackId, vol)}
			onTrackPan={(trackId, pan) => editor.handleMixerTrackPan(trackId, pan)}
			onTrackEffects={(trackId, patch) => editor.handleMixerTrackEffects(trackId, patch)}
			onToggleMute={(trackId) => editor.handleMixerToggleMute(trackId)}
			onResetTrack={(trackId) => editor.handleMixerResetTrack(trackId)}
			onResetMaster={() => editor.handleMixerResetMaster()}
			onClose={() => (editor.mixerOpen = false)}
		/>
	{/if}

	<Timeline
		bind:currentTime={editor.currentTime}
		bind:zoom={editor.zoom}
		bind:selectedClipId={editor.selectedClipId}
		bind:tracks={editor.tracks}
		bind:isPlaying={editor.isPlaying}
		activeTool={editor.activeTool}
		snappingEnabled={editor.snappingEnabled}
		rippleMode={editor.rippleMode}
		markers={editor.markers}
		inOutPoints={editor.inOutPoints}
		effectRequest={editor.effectRequest}
		clipInsertRequest={editor.clipInsertRequest}
		clipPropertyChangeRequest={editor.clipPropertyChangeRequest}
		visualUpdateRequest={editor.visualUpdateRequest}
		commandRequest={editor.commandRequest}
		historyEpoch={editor.historyEpoch}
		bind:playbackRate={editor.playbackRate}
		loopEnabled={editor.loopEnabled}
		mediaAssets={editor.mediaAssets}
		onAddKeyframes={(clipId, props, time) => editor.handleAddKeyframes(clipId, props, time)}
		onRemoveKeyframesAtTime={(clipId, time) => editor.handleRemoveKeyframesAtTime(clipId, time)}
		onPropertiesOpen={() => (editor.propertiesPanelOpen = true)}
		duration={editor.timelineDuration}
		playbackEnd={editor.timelineContentEnd}
		onAssetDrop={(assetId, trackId, time) => editor.dropMediaAsset(assetId, trackId, time)}
		onResourceDrop={(resId, trackId, time) => editor.dropEditorResource(resId, trackId, time)}
		onTracksChange={(tracks) => editor.handleTracksChange(tracks)}
		onMarkersChange={(markers) => editor.handleMarkersChange(markers)}
		onInOutPointsChange={(points) => editor.handleInOutPointsChange(points)}
		onSetInPoint={() => editor.handleSetInPoint()}
		onSetOutPoint={() => editor.handleSetOutPoint()}
		onClearInOutPoints={() => editor.handleClearInOutPoints()}
		onHistoryAvailabilityChange={(undo, redo) => editor.handleHistoryAvailabilityChange(undo, redo)}
		onCreateTextAt={(trackId, time) => editor.handleCreateTextAt(trackId, time)}
		onSequenceEdit={(clipId) => editor.handleSequenceEdit(clipId)}
	/>

	<RestoreProjectPrompt {editor} />
	<ProjectNotice {editor} />
	<NewProjectDialog {editor} />
	<ProjectSettingsDialog {editor} />
	<ShortcutsDialog {editor} />
	<VersionHistoryDialog {editor} />
	<ExportDialog {editor} />
	<CommandPalette {editor} />
	<NestedSequenceEditor
		bind:open={editor.sequenceEditorOpen}
		clip={editor.editingSequenceClip}
		onClose={() => editor.handleSequenceEditClose()}
		onSave={(clip) => editor.handleSequenceEditSave(clip)}
	/>
	<MobileNotice />
</div>
