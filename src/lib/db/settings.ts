import { openDB, idbRequest, waitForTransaction, STORE_SETTINGS } from './connection';

export async function getSetting<T>(key: string): Promise<T | null> {
	const db = await openDB();
	const transaction = db.transaction([STORE_SETTINGS], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_SETTINGS).get(key));
	return (result as T) ?? null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
	const db = await openDB();
	const transaction = db.transaction([STORE_SETTINGS], 'readwrite');
	transaction.objectStore(STORE_SETTINGS).put(value, key);
	return waitForTransaction(transaction);
}
