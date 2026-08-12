import { openDB, idbRequest, waitForTransaction, STORE_VERSIONS } from './connection';
import type { ProjectVersion } from './types';
import { createVersionSnapshot } from './snapshot';

export async function saveVersions(versions: ProjectVersion[]): Promise<void> {
	const db = await openDB();
	const transaction = db.transaction([STORE_VERSIONS], 'readwrite');
	const store = transaction.objectStore(STORE_VERSIONS);

	store.clear();
	for (const version of versions) {
		store.put(createVersionSnapshot(version));
	}

	return waitForTransaction(transaction);
}

export async function loadVersions(): Promise<ProjectVersion[]> {
	const db = await openDB();
	const transaction = db.transaction([STORE_VERSIONS], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_VERSIONS).getAll());
	return Array.isArray(result) ? result : [];
}
