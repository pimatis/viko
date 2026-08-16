import type { TextStyle } from './text';

export type SidebarTab =
	| 'media'
	| 'audio'
	| 'text'
	| 'stickers'
	| 'effects'
	| 'transitions'
	| 'clip-transitions'
	| 'filters'
	| 'captions';

export type MediaKind = 'video' | 'audio' | 'image';

export type MediaFolder = {
	id: string;
	name: string;
	createdAt: number;
};

export type MediaAsset = {
	id: string;
	name: string;
	kind: MediaKind;
	src: string;
	mimeType: string;
	size: number;
	duration: number | null;
	width: number | null;
	height: number | null;
	playbackSupported: boolean | null;
	createdAt: number;
	// id of the folder/collection this asset belongs to, or null for the root
	folderId: string | null;
};

export type ResourceKind = Exclude<SidebarTab, 'media' | 'audio'>;

export type EditorResource = {
	id: string;
	name: string;
	kind: ResourceKind;
	category?: string;
	thumbnailUrl?: string;
	textStyle?: TextStyle;
	sticker?: string;
};

export type MediaImportResult = {
	accepted: MediaAsset[];
	rejected: { name: string; reason: string }[];
};

export const SIDEBAR_ASSET_MIME = 'application/x-viko-media-asset';
export const SIDEBAR_RESOURCE_MIME = 'application/x-viko-editor-resource';
export const MAX_MEDIA_FILE_SIZE = 2 * 1024 * 1024 * 1024;
export const STICKER_PRESETS: EditorResource[] = [
	{ id: 'sticker-star', name: 'Star', kind: 'stickers', category: 'Symbols', sticker: '★' },
	{ id: 'sticker-heart', name: 'Heart', kind: 'stickers', category: 'Symbols', sticker: '♥' },
	{ id: 'sticker-sparkle', name: 'Sparkle', kind: 'stickers', category: 'Symbols', sticker: '✦' },
	{ id: 'sticker-arrow', name: 'Arrow', kind: 'stickers', category: 'Callout', sticker: '➜' },
	{ id: 'sticker-check', name: 'Check', kind: 'stickers', category: 'Callout', sticker: '✓' },
	{ id: 'sticker-warning', name: 'Warning', kind: 'stickers', category: 'Callout', sticker: '!' }
];
export const MEDIA_FILE_ACCEPT = [
	'video/*',
	'audio/*',
	'image/*',
	'.mkv',
	'.avi',
	'.wmv',
	'.flv',
	'.mxf',
	'.mts',
	'.m2ts',
	'.ts',
	'.vob',
	'.rm',
	'.rmvb',
	'.divx',
	'.f4v',
	'.mka',
	'.wma',
	'.aiff',
	'.aif',
	'.alac',
	'.amr',
	'.ac3',
	'.eac3',
	'.dts'
].join(',');

const VIDEO_EXTENSIONS = new Set([
	'mp4',
	'm4v',
	'mov',
	'webm',
	'mkv',
	'avi',
	'wmv',
	'flv',
	'mpeg',
	'mpg',
	'm2v',
	'mts',
	'm2ts',
	'ts',
	'3gp',
	'3g2',
	'ogv',
	'vob',
	'mxf',
	'divx',
	'asf',
	'rm',
	'rmvb',
	'f4v'
]);
const AUDIO_EXTENSIONS = new Set([
	'mp3',
	'wav',
	'aac',
	'm4a',
	'flac',
	'ogg',
	'oga',
	'opus',
	'wma',
	'aiff',
	'aif',
	'alac',
	'amr',
	'ac3',
	'eac3',
	'dts',
	'mka',
	'mid',
	'midi'
]);
const IMAGE_EXTENSIONS = new Set([
	'jpg',
	'jpeg',
	'png',
	'gif',
	'webp',
	'avif',
	'bmp',
	'tif',
	'tiff',
	'heic',
	'heif'
]);

function getMediaKind(file: File): MediaKind | null {
	if (file.type.startsWith('video/')) return 'video';
	if (file.type.startsWith('audio/')) return 'audio';
	if (file.type.startsWith('image/')) return 'image';
	const extension = file.name.split('.').at(-1)?.toLocaleLowerCase();
	if (!extension) return null;
	if (VIDEO_EXTENSIONS.has(extension)) return 'video';
	if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
	if (IMAGE_EXTENSIONS.has(extension)) return 'image';
	return null;
}

function getNormalizedMimeType(file: File, kind: MediaKind): string {
	if (file.type) return file.type;
	const extension = file.name.split('.').at(-1)?.toLocaleLowerCase() ?? 'unknown';
	return `${kind}/x-${extension}`;
}

function normalizeFileName(name: string): string {
	const normalizedName = Array.from(name)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join('')
		.trim();
	return normalizedName.slice(0, 255) || 'Untitled asset';
}

export function importMediaFiles(
	files: File[],
	existingAssets: MediaAsset[],
	targetFolderId: string | null = null
): MediaImportResult {
	const accepted: MediaAsset[] = [];
	const rejected: MediaImportResult['rejected'] = [];
	const existingKeys = new Set(
		existingAssets.map((asset) => `${asset.name}:${asset.size}:${asset.mimeType}`)
	);

	for (const file of files) {
		const kind = getMediaKind(file);
		const name = normalizeFileName(file.name);
		if (!kind) {
			rejected.push({ name, reason: 'Unsupported media type' });
			continue;
		}
		if (file.size <= 0 || file.size > MAX_MEDIA_FILE_SIZE) {
			rejected.push({ name, reason: 'File size is outside the allowed range' });
			continue;
		}

		const mimeType = getNormalizedMimeType(file, kind);
		const fileKey = `${name}:${file.size}:${mimeType}`;
		if (existingKeys.has(fileKey)) {
			rejected.push({ name, reason: 'Asset is already imported' });
			continue;
		}

		existingKeys.add(fileKey);
		accepted.push({
			id: crypto.randomUUID(),
			name,
			kind,
			src: URL.createObjectURL(file),
			mimeType,
			size: file.size,
			duration: null,
			width: null,
			height: null,
			playbackSupported: kind === 'image' ? true : null,
			createdAt: Date.now(),
			folderId: targetFolderId
		});
	}

	return { accepted, rejected };
}

export function inspectMediaAsset(asset: MediaAsset): Promise<MediaAsset> {
	if (asset.kind === 'image') return inspectImageAsset(asset);
	return new Promise((resolve) => {
		const media = document.createElement(asset.kind === 'video' ? 'video' : 'audio');
		let settled = false;
		const timeoutId = window.setTimeout(() => finish(null, false, null, null), 8000);

		function cleanup() {
			window.clearTimeout(timeoutId);
			media.removeEventListener('loadedmetadata', handleMetadata);
			media.removeEventListener('error', handleError);
			media.removeAttribute('src');
			media.load();
		}

		function finish(
			duration: number | null,
			playbackSupported: boolean,
			width: number | null,
			height: number | null
		) {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ ...asset, duration, width, height, playbackSupported });
		}

		function handleMetadata() {
			const duration =
				Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
			const video = media as HTMLVideoElement;
			const width = video.videoWidth > 0 ? video.videoWidth : null;
			const height = video.videoHeight > 0 ? video.videoHeight : null;
			finish(duration, true, width, height);
		}

		function handleError() {
			finish(null, false, null, null);
		}

		media.preload = 'metadata';
		media.addEventListener('loadedmetadata', handleMetadata);
		media.addEventListener('error', handleError);
		media.src = asset.src;
		media.load();
	});
}

function inspectImageAsset(asset: MediaAsset): Promise<MediaAsset> {
	return new Promise((resolve) => {
		const image = new Image();
		let settled = false;
		const timeoutId = window.setTimeout(() => finish(null, null), 8000);

		function cleanup() {
			window.clearTimeout(timeoutId);
			image.onload = null;
			image.onerror = null;
			image.src = '';
		}

		function finish(width: number | null, height: number | null) {
			if (settled) return;
			settled = true;
			cleanup();
			resolve({ ...asset, width, height, playbackSupported: width !== null });
		}

		image.onload = () =>
			finish(
				image.naturalWidth > 0 ? image.naturalWidth : null,
				image.naturalHeight > 0 ? image.naturalHeight : null
			);
		image.onerror = () => finish(null, null);
		image.src = asset.src;
	});
}

export function filterByQuery<T extends { name: string; category?: string }>(
	items: T[],
	query: string
): T[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return items;
	return items.filter((item) =>
		`${item.name} ${item.category ?? ''}`.toLocaleLowerCase().includes(normalizedQuery)
	);
}

export function formatAssetDuration(duration: number | null): string {
	if (duration === null || !Number.isFinite(duration) || duration < 0) return '';
	const minutes = Math.floor(duration / 60);
	const seconds = Math.floor(duration % 60);
	return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatAssetSize(size: number): string {
	if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
