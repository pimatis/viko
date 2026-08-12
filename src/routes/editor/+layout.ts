// The editor is a heavy client-side application (media elements, IndexedDB,
// playback clocks). Rendering it client-only avoids SSR/hydration mismatches
// from nested interactive controls and keeps event delegation working.
export const ssr = false;
