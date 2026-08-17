import type { Track } from '$lib/editor/timeline';
import type { ProjectDocument, ProjectVersion } from '$lib/db';

export function formatRelativeTime(timestamp: number): string {
	const diff = Date.now() - timestamp;
	const seconds = Math.floor(diff / 1000);
	if (seconds < 60) return 'just now';
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	return new Date(timestamp).toLocaleDateString();
}

export function getVersionMetadata(doc: ProjectDocument): {
	clips: number;
	tracks: number;
	markers: number;
} {
	const clips = doc.tracks.reduce((sum, track) => sum + track.clips.length, 0);
	return { clips, tracks: doc.tracks.length, markers: (doc.markers ?? []).length };
}

export function getFirstVisualClipTime(tracks: Track[]): number | null {
	let firstTime: number | null = null;
	for (const track of tracks) {
		if (track.type === 'audio') continue;
		for (const clip of track.clips) {
			if (firstTime === null || clip.startTime < firstTime) firstTime = clip.startTime;
		}
	}
	return firstTime;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export function isVersionRecord(value: unknown): value is { id: string; document: unknown } {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		typeof (value as Record<string, unknown>).id === 'string'
	);
}
