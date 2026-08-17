export type GuideStep = {
	target: string;
	title: string;
	description: string;
};

export const GUIDE_DISMISSED_KEY = 'guide-dismissed';
export const GUIDE_COMPLETED_KEY = 'guide-completed';

export const guideSteps: GuideStep[] = [
	{
		target: '[data-guide-target="navbar"]',
		title: 'Navigation Bar',
		description:
			'Your control center. Left side: File menu (new, open, save, export), Edit menu (undo, redo, shortcuts), View menu (zoom, sidebar). Center: click the project name to rename it - the dot shows save status (green = saved, amber = saving). Right side: undo/redo, zoom percentage, save, project settings (fps + resolution), export quality, and the Export button to render your video.'
	},
	{
		target: '[data-guide-target="sidebar"]',
		title: 'Media Sidebar',
		description:
			'Your content library. The icon rail has 9 tabs: Media (import video/audio/images by dragging files here, then drag assets onto the timeline), Audio (music and sound clips), Text (title and subtitle presets), Stickers (emojis and symbols), Effects (shake, glitch, zoom pulse), Transitions (fade, dissolve, slide between clips), Clip Transitions (cross-dissolve, wipe, push on individual clips), Filters (vintage, monochrome, warm), and Captions (auto-generate subtitles from speech or paste a transcript). Use the search bar to filter any tab.'
	},
	{
		target: '[data-guide-target="toolbar"]',
		title: 'Toolbar',
		description:
			'Pick your editing tool. Selection (V) to move and trim clips, Razor (B) to cut clips at the playhead, Hand (H) to pan the timeline, Text (T) to add text. Advanced trim tools: Slip, Rolling, and Slide for precise edits. Toggle Snapping (S) to align clips to grid, Ripple mode (R) to close gaps when deleting, Source Monitor to preview and trim footage before inserting, and Audio Mixer to balance track volumes and panning.'
	},
	{
		target: '[data-guide-target="player"]',
		title: 'Preview Player',
		description:
			'Watch your edit in real-time. Top bar: social media templates (Instagram, YouTube, TikTok ratios), aspect ratio selector, scopes (waveform, vectorscope, histogram), before/after split view, composition guides, and fullscreen. Bottom bar: time display, play/pause (Space), playback speed (0.25x to 2x), loop toggle, mute, volume, and preview zoom. Click anywhere on the canvas to drag text and sticker layers, or select clips to edit their position and transform.'
	},
	{
		target: '[data-guide-target="timeline"]',
		title: 'Timeline',
		description:
			'The heart of your edit. Top toolbar: skip to start/end, undo/redo, play (Space), step frame-by-frame (arrows), split clips at playhead (Ctrl+Shift+B), freeze frame (F), reverse clip (Shift+R), add track, and clipboard. Track headers on the left: click the name to rename, mute (speaker icon), lock (padlock icon) to prevent accidental edits, right-click for more options. On clips: drag edges to trim, double-click to open Properties (keyframes, color grading, chroma key, effects). Press M for markers, K for keyframes, Ctrl+K for the command palette.'
	}
];
