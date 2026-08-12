export type EditorTool = 'select' | 'razor' | 'hand' | 'text';

export const MIN_TIMELINE_ZOOM = 10;
export const MAX_TIMELINE_ZOOM = 200;
export const TIMELINE_ZOOM_STEP = 10;

export function clampTimelineZoom(zoom: number): number {
	return Math.min(MAX_TIMELINE_ZOOM, Math.max(MIN_TIMELINE_ZOOM, zoom));
}
