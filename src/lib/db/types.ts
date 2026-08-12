import type { MediaAsset } from '$lib/editor/sidebar';
import type { Track, Marker } from '$lib/editor/timeline';

export type ProjectDocument = {
	format: 'viko-project';
	version: 1;
	name: string;
	tracks: Track[];
	mediaAssets: MediaAsset[];
	markers: Marker[];
	updatedAt: number;
};

export type ProjectVersion = {
	id: string;
	createdAt: number;
	document: ProjectDocument;
};
