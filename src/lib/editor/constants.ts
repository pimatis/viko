export const MIN_TIMELINE_DURATION = 30;
export const TIMELINE_TAIL_DURATION = 30;
export const DEFAULT_ASSET_DURATION = 5;
export const PROJECT_FORMAT = 'viko-project';
export const PROJECT_VERSION = 1;

export const PROJECT_RESOLUTIONS = [
	{ id: '4k', label: '4K UHD', width: 3840, height: 2160 },
	{ id: '1080p', label: '1080p HD', width: 1920, height: 1080 },
	{ id: '720p', label: '720p HD', width: 1280, height: 720 },
	{ id: '480p', label: '480p SD', width: 854, height: 480 },
	{ id: 'vertical', label: 'Vertical 1080x1920', width: 1080, height: 1920 },
	{ id: 'square', label: 'Square 1080x1080', width: 1080, height: 1080 }
] as const;

export const MAX_VERSIONS = 20;
export const MAX_PROJECT_TIME = 24 * 60 * 60;
export const MAX_PROJECT_TRACKS = 200;
export const MAX_TRACK_CLIPS = 10_000;
export const MAX_PROJECT_ASSETS = 5_000;
export const MAX_PROJECT_FOLDERS = 200;
export const SAFE_COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
