// ffmpeg.wasm proxy pipeline for assets the browser cannot decode natively
// (playbackSupported: false). The ffmpeg core (~31 MB) is fetched lazily from
// CDN on first use, so normal imports never pay the cost. Output is a browser-
// friendly MP4 (H.264/AAC) or M4A that replaces the asset source.
import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
const MAX_PROXY_INPUT_BYTES = 512 * 1024 * 1024;

export type ProxyKind = 'video' | 'audio';

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(): Promise<FFmpeg> {
	if (ffmpeg) return ffmpeg;
	if (!loadPromise) {
		loadPromise = (async () => {
			const { toBlobURL } = await import('@ffmpeg/util');
			const instance = new FFmpeg();
			// the ESM core build is required: the default Vite worker is an ES
			// module, which cannot importScripts the UMD core blob
			await instance.load({
				coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
				wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm')
			});
			ffmpeg = instance;
			return instance;
		})();
		loadPromise.catch(() => {
			loadPromise = null;
		});
	}
	return loadPromise;
}

export function isProxyInputTooLarge(size: number): boolean {
	return size > MAX_PROXY_INPUT_BYTES;
}

// transcode any decodable-by-ffmpeg input into a browser-playable proxy blob
export async function transcodeToProxy(
	source: Blob,
	kind: ProxyKind,
	onProgress?: (ratio: number) => void
): Promise<Blob> {
	if (isProxyInputTooLarge(source.size)) {
		throw new Error('File is too large for in-browser transcoding');
	}
	const instance = await getFfmpeg();
	const { fetchFile } = await import('@ffmpeg/util');
	const outputName = kind === 'audio' ? 'output.m4a' : 'output.mp4';
	const handler = ({ progress }: { progress: number }) => {
		if (Number.isFinite(progress)) onProgress?.(Math.max(0, Math.min(1, progress)));
	};
	instance.on('progress', handler);
	try {
		await instance.writeFile('input.bin', await fetchFile(source));
		const args =
			kind === 'audio'
				? ['-i', 'input.bin', '-vn', '-c:a', 'aac', '-b:a', '160k', outputName]
				: [
						'-i',
						'input.bin',
						'-c:v',
						'libx264',
						'-preset',
						'veryfast',
						'-crf',
						'26',
						'-pix_fmt',
						'yuv420p',
						'-c:a',
						'aac',
						'-b:a',
						'128k',
						'-movflags',
						'+faststart',
						outputName
					];
		await instance.exec(args);
		const data = await instance.readFile(outputName);
		const bytes =
			data instanceof Uint8Array ? data : new TextEncoder().encode(data as unknown as string);
		const copy = new Uint8Array(bytes.length);
		copy.set(bytes);
		return new Blob([copy], { type: kind === 'audio' ? 'audio/mp4' : 'video/mp4' });
	} finally {
		instance.off('progress', handler);
		void instance.deleteFile('input.bin').catch(() => {});
		void instance.deleteFile(outputName).catch(() => {});
	}
}
