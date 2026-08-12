import type { ProjectDocument, ProjectVersion } from './types';
import { cloneTracks } from '$lib/editor/timeline';

export function createProjectSnapshot(document: ProjectDocument): ProjectDocument {
	return {
		...document,
		tracks: cloneTracks(document.tracks),
		mediaAssets: document.mediaAssets.map((asset) => ({ ...asset })),
		markers: (document.markers ?? []).map((marker) => ({ ...marker })),
		// rebuild nested objects as plain values — Svelte state proxies are not
		// structured-cloneable and would make IndexedDB puts throw DataCloneError
		aspectRatio:
			document.aspectRatio &&
			Number.isFinite(document.aspectRatio.width) &&
			document.aspectRatio.width > 0 &&
			Number.isFinite(document.aspectRatio.height) &&
			document.aspectRatio.height > 0
				? { width: document.aspectRatio.width, height: document.aspectRatio.height }
				: { width: 16, height: 9 }
	};
}

export function createVersionSnapshot(version: ProjectVersion): ProjectVersion {
	return {
		id: version.id,
		createdAt: version.createdAt,
		document: createProjectSnapshot(version.document)
	};
}
