import {
	openDB,
	waitForTransaction,
	STORE_PROJECT,
	STORE_VERSIONS,
	STORE_MEDIA
} from './connection';

export async function clearProject(): Promise<void> {
	const db = await openDB();
	const transaction = db.transaction([STORE_PROJECT, STORE_VERSIONS, STORE_MEDIA], 'readwrite');

	transaction.objectStore(STORE_PROJECT).clear();
	transaction.objectStore(STORE_VERSIONS).clear();
	transaction.objectStore(STORE_MEDIA).clear();

	return waitForTransaction(transaction);
}
