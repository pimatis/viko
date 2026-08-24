// durable FileSystemFileHandle storage for media relinking. Handles are saved
// when a user relinks (or imports via the File System Access picker) and let a
// later session reconnect an asset whose blob URL expired - silently when the
// read permission is still granted, otherwise through the Relink button which
// requests permission inside its own user gesture.
import { openDB, idbRequest, waitForTransaction, STORE_HANDLES } from './connection';

export async function saveMediaHandle(
	assetId: string,
	handle: FileSystemFileHandle
): Promise<void> {
	const db = await openDB();
	const transaction = db.transaction([STORE_HANDLES], 'readwrite');
	transaction.objectStore(STORE_HANDLES).put(handle, assetId);
	return waitForTransaction(transaction);
}

export async function getMediaHandle(assetId: string): Promise<FileSystemFileHandle | null> {
	const db = await openDB();
	const transaction = db.transaction([STORE_HANDLES], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_HANDLES).get(assetId));
	return (result as FileSystemFileHandle | undefined) ?? null;
}

export async function deleteMediaHandle(assetId: string): Promise<void> {
	const db = await openDB();
	const transaction = db.transaction([STORE_HANDLES], 'readwrite');
	transaction.objectStore(STORE_HANDLES).delete(assetId);
	return waitForTransaction(transaction);
}
