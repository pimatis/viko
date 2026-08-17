const DB_NAME = 'viko';
const DB_VERSION = 2;

export const STORE_PROJECT = 'project';
export const STORE_VERSIONS = 'versions';
export const STORE_MEDIA = 'media';
export const STORE_SETTINGS = 'settings';

export const PROJECT_KEY = 'current';

let databasePromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
	if (databasePromise) return databasePromise;

	databasePromise = new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE_PROJECT)) {
				db.createObjectStore(STORE_PROJECT);
			}
			if (!db.objectStoreNames.contains(STORE_VERSIONS)) {
				db.createObjectStore(STORE_VERSIONS, { keyPath: 'id' });
			}
			if (!db.objectStoreNames.contains(STORE_MEDIA)) {
				db.createObjectStore(STORE_MEDIA);
			}
			if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
				db.createObjectStore(STORE_SETTINGS);
			}
		};

		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => {
				db.close();
				databasePromise = null;
			};
			resolve(db);
		};
		request.onerror = () => {
			databasePromise = null;
			reject(request.error);
		};
	});

	return databasePromise;
}

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

export function waitForTransaction(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error);
		transaction.onerror = () => reject(transaction.error);
	});
}
