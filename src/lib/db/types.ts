import type { MediaAsset, MediaFolder } from '$lib/editor/sidebar';
import type { Track, Marker } from '$lib/editor/timeline';
import type { PlayerAspectRatio, PlayerAspectRatioMode } from '$lib/editor/player';

export type ProjectDocument = {
	format: 'viko-project';
	version: 1;
	name: string;
	tracks: Track[];
	mediaAssets: MediaAsset[];
	mediaFolders: MediaFolder[];
	markers: Marker[];
	aspectRatio: PlayerAspectRatio;
	aspectRatioMode: PlayerAspectRatioMode;
	// timeline frame rate (24/25/30/50/60); drives frame rounding, timecode and
	// the exported video's framerate
	frameRate: number;
	updatedAt: number;
};

export type ProjectVersion = {
	id: string;
	createdAt: number;
	document: ProjectDocument;
	/** data URL of the first-frame preview rendered at snapshot time */
	thumbnail?: string;
};
