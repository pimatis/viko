import { openDB, idbRequest, STORE_MEDIA } from './connection';
import type { MediaAsset } from '$lib/editor/sidebar';

export async function loadMediaBlob(assetId: string): Promise<Blob | null> {
	const db = await openDB();
	const transaction = db.transaction([STORE_MEDIA], 'readonly');
	const result = await idbRequest(transaction.objectStore(STORE_MEDIA).get(assetId));
	return result ?? null;
}

export async function restoreMediaAssets(assets: MediaAsset[]): Promise<MediaAsset[]> {
	const persistedAssets = assets.filter((asset) => asset.src.startsWith('blob:'));
	if (persistedAssets.length === 0) return assets;

	try {
		const db = await openDB();
		const transaction = db.transaction([STORE_MEDIA], 'readonly');
		const store = transaction.objectStore(STORE_MEDIA);
		const blobs = await Promise.all(
			persistedAssets.map((asset) => idbRequest(store.get(asset.id)) as Promise<Blob | undefined>)
		);
		const restoredSources = new Map<string, string>();

		for (const [index, asset] of persistedAssets.entries()) {
			const blob = blobs[index];
			if (!blob) continue;
			restoredSources.set(asset.id, URL.createObjectURL(blob));
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
