import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

// hooks.server.ts makes the page cross-origin-isolated (COOP/COEP) so the
// export pipeline can use SharedArrayBuffer. In dev, Vite serves module
// workers directly and bypasses SvelteKit's handle hook, so those responses
// miss the COEP header and Chromium refuses to load them
// (ERR_BLOCKED_BY_RESPONSE). Add the same headers to worker responses here.
function coepModuleWorkerHeaders(): Plugin {
	return {
		name: 'coep-module-worker-headers',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (typeof req.url === 'string' && req.url.includes('worker_file')) {
					res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
					res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
				}
				next();
			});
		}
	};
}

export default defineConfig({
	optimizeDeps: {
		// ffmpeg.wasm JS wrapper must not be pre-bundled by Vite
		exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
	},
	plugins: [
		coepModuleWorkerHeaders(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	]
});
