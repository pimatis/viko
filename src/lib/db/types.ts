import type { MediaAsset } from '$lib/editor/sidebar';
import type { Track, Marker } from '$lib/editor/timeline';
import type { PlayerAspectRatio, PlayerAspectRatioMode } from '$lib/editor/player';

export type ProjectDocument = {
	format: 'viko-project';
	version: 1;
	name: string;
	tracks: Track[];
	mediaAssets: MediaAsset[];
	markers: Marker[];
	aspectRatio: PlayerAspectRatio;
	aspectRatioMode: PlayerAspectRatioMode;
	updatedAt: number;
};

export type ProjectVersion = {
	id: string;
	createdAt: number;
	document: ProjectDocument;
	/** data URL of the first-frame preview rendered at snapshot time */
	thumbnail?: string;
};
