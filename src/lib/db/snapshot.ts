import type { ProjectDocument, ProjectVersion } from './types';
import { cloneTracks } from '$lib/editor/timeline';

export function createProjectSnapshot(document: ProjectDocument): ProjectDocument {
	return {
		...document,
		tracks: cloneTracks(document.tracks),
		mediaAssets: document.mediaAssets.map((asset) => ({ ...asset })),
		markers: (document.markers ?? []).map((marker) => ({ ...marker }))
	};
}

export function createVersionSnapshot(version: ProjectVersion): ProjectVersion {
	return {
		id: version.id,
		createdAt: version.createdAt,
		document: createProjectSnapshot(version.document)
	};
}
