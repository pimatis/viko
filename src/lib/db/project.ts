import {
	openDB,
	idbRequest,
	waitForTransaction,
	STORE_PROJECT,
	STORE_MEDIA,
	PROJECT_KEY
} from './connection';
import type { ProjectDocument } from './types';
import { createProjectSnapshot } from './snapshot';

export async function saveProject(document: ProjectDocument): Promise<void> {
	const snapshot = createProjectSnapshot(document);
	const blobs = new Map<string, Blob>();

	const blobAssets = snapshot.mediaAssets.filter((asset) => asset.src.startsWith('blob:'));
	const results = await Promise.allSettled(
		blobAssets.map(async (asset) => {
			const response = await fetch(asset.src);
			const blob = await response.blob();
			return { id: asset.id, blob };
		})
	);

	for (const result of results) {
		if (result.status === 'fulfilled') {
			blobs.set(result.value.id, result.value.blob);
		}
	}

	const db = await openDB();
	const transaction = db.transaction([STORE_PROJECT, STORE_MEDIA], 'readwrite');

	transaction.objectStore(STORE_PROJECT).put(snapshot, PROJECT_KEY);

	for (const [assetId, blob] of blobs) {
		transaction.objectStore(STORE_MEDIA).put(blob, assetId);
	}

	return waitForTransaction(transaction);
}

export async function loadProject(): Promise<ProjectDocument | null> {
	const db = await openDB();
	const transaction = db.transaction([STORE_PROJECT], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_PROJECT).get(PROJECT_KEY));
	return result ?? null;
}
