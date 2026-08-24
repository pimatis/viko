import { openDB, idbRequest, STORE_MEDIA } from './connection';
import type { MediaAsset } from '$lib/editor/sidebar';

export async function loadMediaBlob(assetId: string): Promise<Blob | null> {
	const db = await openDB();
	const transaction = db.transaction([STORE_MEDIA], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_MEDIA).get(assetId));
	return result ?? null;
}

const MAX_CACHED_URLS = 24;
const RESTORE_CONCURRENCY = 4;

type CacheEntry = { url: string; blob: Blob; prev: CacheEntry | null; next: CacheEntry | null };
const urlCache = new Map<string, CacheEntry>();
let cacheHead: CacheEntry | null = null;
let cacheTail: CacheEntry | null = null;

function unlinkEntry(entry: CacheEntry) {
	if (entry.prev) entry.prev.next = entry.next;
	else cacheHead = entry.next;
	if (entry.next) entry.next.prev = entry.prev;
	else cacheTail = entry.prev;
	entry.prev = null;
	entry.next = null;
}

function touchEntry(entry: CacheEntry) {
	if (entry === cacheHead) return;
	unlinkEntry(entry);
	entry.prev = null;
	entry.next = cacheHead;
	if (cacheHead) cacheHead.prev = entry;
	cacheHead = entry;
	if (!cacheTail) cacheTail = entry;
}

function evictOldest(): void {
	if (!cacheTail) return;
	const victim = cacheTail;
	unlinkEntry(victim);
	for (const [id, candidate] of urlCache) {
		if (candidate === victim) {
			urlCache.delete(id);
			break;
		}
	}
	URL.revokeObjectURL(victim.url);
}

function cacheUrl(assetId: string, blob: Blob): string {
	const existing = urlCache.get(assetId);
	if (existing) {
		touchEntry(existing);
		return existing.url;
	}
	const url = URL.createObjectURL(blob);
	const entry: CacheEntry = { url, blob, prev: null, next: cacheHead };
	if (cacheHead) cacheHead.prev = entry;
	cacheHead = entry;
	if (!cacheTail) cacheTail = entry;
	urlCache.set(assetId, entry);
	while (urlCache.size > MAX_CACHED_URLS) evictOldest();
	return url;
}

// read media in small batches so a project with hundreds of assets does not
// spike memory by hydrating every blob in one tick
async function loadBlobsBatched(assetIds: string[]): Promise<Array<Blob | null>> {
	const blobs = new Array<Blob | null>(assetIds.length).fill(null);
	const db = await openDB();
	let cursor = 0;
	while (cursor < assetIds.length) {
		const end = Math.min(cursor + RESTORE_CONCURRENCY, assetIds.length);
		const transaction = db.transaction([STORE_MEDIA], 'readonly');
		const store = transaction.objectStore(STORE_MEDIA);
		const batch = assetIds.slice(cursor, end);
		const results = await Promise.all(
			batch.map((id) => idbRequest(store.get(id)) as Promise<Blob | undefined>)
		);
		for (let i = 0; i < batch.length; i += 1) {
			if (results[i]) blobs[cursor + i] = results[i] as Blob;
		}
		cursor = end;
	}
	return blobs;
}

export async function restoreMediaAssets(assets: MediaAsset[]): Promise<MediaAsset[]> {
	const persistedAssets = assets.filter((asset) => asset.src.startsWith('blob:'));
	if (persistedAssets.length === 0) return assets;

	try {
		const blobs = await loadBlobsBatched(persistedAssets.map((asset) => asset.id));
		const restoredSources = new Map<string, string>();

		for (const [index, asset] of persistedAssets.entries()) {
			const blob = blobs[index];
			if (!blob) continue;
			restoredSources.set(asset.id, cacheUrl(asset.id, blob));
		}

		return assets.map((asset) => {
			const src = restoredSources.get(asset.id);
			if (src) return { ...asset, src };
			if (!asset.src.startsWith('blob:')) return asset;
			return { ...asset, src: '', playbackSupported: false };
		});
	} catch {
		return assets.map((asset) =>
			asset.src.startsWith('blob:') ? { ...asset, src: '', playbackSupported: false } : asset
		);
	}
}

// single-asset lazy URL: reuses the cache, falls back to direct IDB read
export async function resolveMediaUrl(assetId: string): Promise<string | null> {
	const cached = urlCache.get(assetId);
	if (cached) {
		touchEntry(cached);
		return cached.url;
	}
	const blob = await loadMediaBlob(assetId);
	if (!blob) return null;
	return cacheUrl(assetId, blob);
}

// drop every cached blob URL; called on new project / version restore so
// revoked assets do not pin blobs that the project no longer references
export function disposeRestoredMedia(): void {
	for (const entry of urlCache.values()) {
		URL.revokeObjectURL(entry.url);
	}
	urlCache.clear();
	cacheHead = null;
	cacheTail = null;
}
