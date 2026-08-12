// All marketing pages (home, features, about, faq, privacy, terms) are static
// content with no server data. Prerendering them emits plain HTML at build time,
// which search engines and AI assistants can read without executing JavaScript.
// The editor route opts out via its own +layout.ts (ssr = false).
export const prerender = true;
