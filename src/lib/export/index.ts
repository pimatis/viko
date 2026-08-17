import type { FFmpeg } from '@ffmpeg/ffmpeg';

// load ffmpeg-core from CDN to avoid bundling the 31 MB wasm
const FFMPEG_CORE_VERSION = '0.12.10';
const FFMPEG_CDN_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const FFMPEG_MT_CDN_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${FFMPEG_CORE_VERSION}/dist/umd`;

function getFfmpegLoadConfig() {
	const useMultithreadCore = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
	const baseURL = useMultithreadCore ? FFMPEG_MT_CDN_BASE : FFMPEG_CDN_BASE;
	return {
		coreURL: `${baseURL}/ffmpeg-core.js`,
		wasmURL: `${baseURL}/ffmpeg-core.wasm`,
		...(useMultithreadCore ? { workerURL: `${baseURL}/ffmpeg-core.worker.js` } : {})
	};
}
import type { Track, Clip } from '$lib/editor/timeline';
import {
	FRAME_RATE,
	getClipChromaKeyState,
	getClipSourceTime,
	getClipVisualState
} from '$lib/editor/timeline';
import type { MediaAsset } from '$lib/editor/sidebar';
import { applyChromaKey, isChromaKeyActive } from '$lib/chroma';
import { applyColorGrade, isNeutralGrade, type ColorGrade, type LUTPreset } from '$lib/grading';
import {
	getClipPairTransitionProgress,
	getClipTransitionVisualState,
	getEffectVisualState,
	type ClipTransitionVisualState,
	type TransitionRole
} from '$lib/effects';
import {
	collectAudioClips,
	decodeAudioAssets,
	encodeAudioBufferToWav,
	mixAudioOffline
} from './audio';

export type ExportQuality = {
	id: string;
	label: string;
	width: number;
	height: number;
	bitrate: string;
};

export const EXPORT_QUALITIES: ExportQuality[] = [
	{ id: '360p', label: '360p', width: 640, height: 360, bitrate: '800k' },
	{ id: '480p', label: '480p', width: 854, height: 480, bitrate: '1500k' },
	{ id: '720p', label: '720p', width: 1280, height: 720, bitrate: '3000k' },
	{ id: '1080p', label: '1080p', width: 1920, height: 1080, bitrate: '6000k' },
	{ id: '4k', label: '4K', width: 3840, height: 2160, bitrate: '15000k' }
];

export const DEFAULT_EXPORT_QUALITY = EXPORT_QUALITIES[2];

export type ExportResolution = { width: number; height: number };

function roundToEven(value: number): number {
	return Math.max(2, Math.round(value / 2) * 2);
}

// ffmpeg.readFile can return a string; BlobPart under TS6 requires an ArrayBuffer-backed view
function toBlobPart(data: Uint8Array | string): BlobPart {
	return typeof data === 'string' ? data : new Uint8Array(data);
}

export function getExportResolution(
	ratio: { width: number; height: number },
	quality: ExportQuality
): ExportResolution {
	const safeWidth = Number.isFinite(ratio.width) && ratio.width > 0 ? ratio.width : 16;
	const safeHeight = Number.isFinite(ratio.height) && ratio.height > 0 ? ratio.height : 9;
	const shortEdge = roundToEven(quality.height);
	if (safeWidth >= safeHeight) {
		return { width: roundToEven((shortEdge * safeWidth) / safeHeight), height: shortEdge };
	}
	return { width: shortEdge, height: roundToEven((shortEdge * safeHeight) / safeWidth) };
}

export type ExportProgress = {
	phase: 'preparing' | 'mixing-audio' | 'rendering' | 'encoding' | 'done' | 'error';
	frame: number;
	totalFrames: number;
	message: string;
};

type ExportOptions = {
	tracks: Track[];
	mediaAssets: MediaAsset[];
	quality: ExportQuality;
	duration: number;
	startTime?: number;
	endTime?: number;
	onProgress?: (progress: ExportProgress) => void;
};

type LoadedClip = {
	clip: Clip;
	clipId: string;
	isAdjustment: boolean;
	startTime: number;
	duration: number;
	sourceStart: number;
	textStyle?: {
		fontFamily: string;
		fontSize: number;
		fontWeight: number;
		color: string;
		backgroundColor: string;
		textAlign: string;
		textTransform: string;
	};
	name: string;
	sticker?: string;
	stickerColor?: string;
	speed?: number;
	element: HTMLVideoElement | HTMLImageElement | null;
	ready: boolean;
	gradedCanvas?: HTMLCanvasElement | null;
	gradedTime?: number;
};

type RenderTransition = {
	role: TransitionRole;
	state: ClipTransitionVisualState;
};

// FRAME_RATE is a live project setting (24/25/30/50/60), so every derived
// value must be read at call time instead of frozen at module load
const SEEK_TIMEOUT_MS = 3000;
const MICROSECONDS_PER_SECOND = 1_000_000;
const progressUpdateIntervalFrames = () => Math.max(1, Math.round(FRAME_RATE));
const frameDurationUs = () => Math.round(MICROSECONDS_PER_SECOND / FRAME_RATE);
const chunkFrameCount = () => FRAME_RATE * 5;
const AUDIO_CHUNK_SAMPLES = 16384;
const AUDIO_BITRATE = 192_000;

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
	if (ffmpegInstance) return ffmpegInstance;
	if (ffmpegLoading) return ffmpegLoading;

	ffmpegLoading = (async () => {
		const { FFmpeg } = await import('@ffmpeg/ffmpeg');
		const ffmpeg = new FFmpeg();

		try {
			await ffmpeg.load(getFfmpegLoadConfig());
		} catch (error) {
			ffmpegLoading = null;
			throw error;
		}

		ffmpegInstance = ffmpeg;
		return ffmpeg;
	})();

	return ffmpegLoading;
}

type FfmpegProgressListener = {
	lastReport: number;
	handler: ({ message }: { message: string }) => void;
};

function createFfmpegProgressListener(
	onProgress: ((progress: ExportProgress) => void) | undefined,
	durationSec: number
): FfmpegProgressListener {
	const listener: FfmpegProgressListener = { lastReport: 0, handler: () => {} };
	listener.handler = ({ message }) => {
		if (!onProgress || !durationSec || durationSec <= 0) return;
		const timeMatch = message.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
		if (!timeMatch) return;
		const seconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3]);
		const pct = Math.min(100, Math.round((seconds / durationSec) * 100));
		if (pct <= listener.lastReport) return;
		listener.lastReport = pct;
		const frameMatch = message.match(/frame=\s*(\d+)/);
		const frame = frameMatch ? Number(frameMatch[1]) : 0;
		onProgress({
			phase: 'encoding',
			frame: pct,
			totalFrames: 100,
			message: `Converting to MP4... ${pct}% (frame ${frame})`
		});
	};
	return listener;
}

async function transcodeToMp4(
	webmBlob: Blob,
	quality: ExportQuality,
	audioWavBlob: Blob | null,
	onProgress?: (progress: ExportProgress) => void,
	durationSec?: number
): Promise<Blob> {
	const ffmpeg = await getFFmpeg();

	const progressListener = createFfmpegProgressListener(onProgress, durationSec ?? 0);
	ffmpeg.on('log', progressListener.handler);

	const { fetchFile } = await import('@ffmpeg/util');
	await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob));

	const args: string[] = ['-i', 'input.webm'];

	if (audioWavBlob) {
		await ffmpeg.writeFile('audio.wav', await fetchFile(audioWavBlob));
		args.push('-i', 'audio.wav', '-map', '0:v:0', '-map', '1:a:0', '-shortest');
	}

	args.push(
		'-y',
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		'-crf',
		'23',
		'-c:a',
		'aac',
		'-b:a',
		'192k',
		'-vf',
		`scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2`,
		'-pix_fmt',
		'yuv420p',
		'-movflags',
		'+faststart',
		'output.mp4'
	);

	try {
		await ffmpeg.exec(args);
	} finally {
		ffmpeg.off('log', progressListener.handler);
	}

	const data = await ffmpeg.readFile('output.mp4');

	await ffmpeg.deleteFile('input.webm');
	if (audioWavBlob) await ffmpeg.deleteFile('audio.wav');
	await ffmpeg.deleteFile('output.mp4');

	return new Blob([toBlobPart(data)], { type: 'video/mp4' });
}

async function addAudioWithFfmpeg(
	videoMp4Blob: Blob,
	audioWavBlob: Blob,
	onProgress?: (progress: ExportProgress) => void,
	durationSec?: number
): Promise<Blob> {
	const ffmpeg = await getFFmpeg();
	const { fetchFile } = await import('@ffmpeg/util');
	const progressListener = createFfmpegProgressListener(onProgress, durationSec ?? 0);
	ffmpeg.on('log', progressListener.handler);

	try {
		await ffmpeg.writeFile('video.mp4', await fetchFile(videoMp4Blob));
		await ffmpeg.writeFile('audio.wav', await fetchFile(audioWavBlob));
		await ffmpeg.exec([
			'-i',
			'video.mp4',
			'-i',
			'audio.wav',
			'-map',
			'0:v:0',
			'-map',
			'1:a:0',
			'-c:v',
			'copy',
			'-c:a',
			'aac',
			'-b:a',
			String(AUDIO_BITRATE),
			'-shortest',
			'-movflags',
			'+faststart',
			'output.mp4'
		]);
		const data = await ffmpeg.readFile('output.mp4');
		await ffmpeg.deleteFile('video.mp4');
		await ffmpeg.deleteFile('audio.wav');
		await ffmpeg.deleteFile('output.mp4');
		return new Blob([toBlobPart(data)], { type: 'video/mp4' });
	} finally {
		ffmpeg.off('log', progressListener.handler);
	}
}

type EncodedVideoResult = {
	chunks: EncodedVideoChunk[];
	width: number;
	height: number;
	codec: string;
	decoderConfig?: VideoDecoderConfig;
};

type EncodedAudioResult = {
	chunks: EncodedAudioChunk[];
	sampleRate: number;
	numberOfChannels: number;
	decoderConfig?: AudioDecoderConfig;
};

async function pickVideoEncoderConfig(
	width: number,
	height: number,
	bitrate: number
): Promise<VideoEncoderConfig | null> {
	if (typeof VideoEncoder === 'undefined') return null;

	const codecs: string[] = [];
	if (height >= 2160) codecs.push('avc1.640033', 'avc1.640032');
	if (height >= 1080) codecs.push('avc1.640028', 'avc1.64001F');
	codecs.push('avc1.4D401F', 'avc1.42E01F', 'avc1.42E01E');

	for (const codec of codecs) {
		const config: VideoEncoderConfig = {
			codec,
			width,
			height,
			bitrate,
			framerate: FRAME_RATE,
			avc: { format: 'avc' }
		};
		try {
			const support = await VideoEncoder.isConfigSupported(config);
			if (support.supported) return support.config ?? config;
		} catch {
			// try the next profile
		}
	}
	return null;
}

async function pickAudioEncoderConfig(
	sampleRate: number,
	numberOfChannels: number
): Promise<AudioEncoderConfig | null> {
	if (typeof AudioEncoder === 'undefined') return null;

	const config: AudioEncoderConfig = {
		codec: 'mp4a.40.2',
		sampleRate,
		numberOfChannels,
		bitrate: AUDIO_BITRATE
	};
	try {
		const support = await AudioEncoder.isConfigSupported(config);
		return support.supported ? (support.config ?? config) : null;
	} catch {
		return null;
	}
}

function createAudioDataChunks(buffer: AudioBuffer): AudioData[] {
	const totalFrames = buffer.length;
	const numberOfChannels = buffer.numberOfChannels;
	const datas: AudioData[] = [];

	for (let start = 0; start < totalFrames; start += AUDIO_CHUNK_SAMPLES) {
		const frameCount = Math.min(AUDIO_CHUNK_SAMPLES, totalFrames - start);
		const planar = new Float32Array(frameCount * numberOfChannels);
		for (let channel = 0; channel < numberOfChannels; channel++) {
			planar.set(
				buffer.getChannelData(channel).subarray(start, start + frameCount),
				channel * frameCount
			);
		}
		datas.push(
			new AudioData({
				format: 'f32-planar',
				sampleRate: buffer.sampleRate,
				numberOfFrames: frameCount,
				numberOfChannels,
				timestamp: Math.round((start / buffer.sampleRate) * MICROSECONDS_PER_SECOND),
				data: planar
			})
		);
	}

	return datas;
}

async function encodeAudioAac(
	buffer: AudioBuffer,
	config: AudioEncoderConfig
): Promise<EncodedAudioResult | null> {
	const chunks: EncodedAudioChunk[] = [];
	let encoderError: Error | null = null;
	let decoderConfig: AudioDecoderConfig | undefined;

	const encoder = new AudioEncoder({
		output: (chunk, meta) => {
			chunks.push(chunk);
			if (!decoderConfig && meta?.decoderConfig) decoderConfig = meta.decoderConfig;
		},
		error: (error) => {
			encoderError = error;
		}
	});
	encoder.configure(config);

	for (const data of createAudioDataChunks(buffer)) {
		encoder.encode(data);
		data.close();
	}

	await encoder.flush();
	encoder.close();
	if (encoderError) throw encoderError;

	return {
		chunks,
		sampleRate: buffer.sampleRate,
		numberOfChannels: buffer.numberOfChannels,
		decoderConfig
	};
}

async function encodeVideoChunks(
	clips: LoadedClip[],
	quality: ExportQuality,
	totalFrames: number,
	startOffset: number,
	config: VideoEncoderConfig,
	onProgress?: (progress: ExportProgress) => void
): Promise<EncodedVideoResult> {
	const canvas = document.createElement('canvas');
	canvas.width = quality.width;
	canvas.height = quality.height;

	const chunks: EncodedVideoChunk[] = [];
	let encoderError: Error | null = null;
	let decoderConfig: VideoDecoderConfig | undefined;

	const encoder = new VideoEncoder({
		output: (chunk, meta) => {
			chunks.push(chunk);
			if (!decoderConfig && meta?.decoderConfig) decoderConfig = meta.decoderConfig;
		},
		error: (error) => {
			encoderError = error;
		}
	});
	encoder.configure(config);

	const chunkFrames = chunkFrameCount();
	const chunkCount = Math.ceil(totalFrames / chunkFrames);

	for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
		const startFrame = chunkIndex * chunkFrames;
		const endFrame = Math.min(totalFrames, startFrame + chunkFrames);

		for (let frame = startFrame; frame < endFrame; frame++) {
			const currentTime = startOffset + frame / FRAME_RATE;
			await seekClipsToTime(clips, currentTime);
			renderFrame(canvas, clips, currentTime);

			const videoFrame = new VideoFrame(canvas, {
				timestamp: frame * frameDurationUs(),
				duration: frameDurationUs()
			});
			encoder.encode(videoFrame, { keyFrame: frame === startFrame });
			videoFrame.close();

			// backpressure: only pause when the encoder's internal queue is full, instead
			// of a fixed yield every N frames. encoding runs on a separate thread, so the
			// render loop stays at full speed when the encoder keeps up, while the queue
			// is still prevented from growing unbounded. falls back to a periodic yield
			// on engines without encodeQueueSize (older WebCodecs).
			const queueSize =
				typeof (encoder as { encodeQueueSize?: number }).encodeQueueSize === 'number'
					? (encoder as { encodeQueueSize: number }).encodeQueueSize
					: 0;
			if (queueSize >= 8) {
				while (
					typeof (encoder as { encodeQueueSize?: number }).encodeQueueSize === 'number' &&
					(encoder as { encodeQueueSize: number }).encodeQueueSize > 4
				) {
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
			} else if ((frame + 1) % 30 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			if ((frame + 1) % progressUpdateIntervalFrames() === 0 || frame === totalFrames - 1) {
				onProgress?.({
					phase: 'rendering',
					frame: frame + 1,
					totalFrames,
					message: `Rendering chunk ${chunkIndex + 1} of ${chunkCount}...`
				});
			}
		}

		await encoder.flush();
		if (encoderError) throw encoderError;
	}

	encoder.close();
	if (encoderError) throw encoderError;

	return {
		chunks,
		width: quality.width,
		height: quality.height,
		codec: config.codec,
		decoderConfig
	};
}

async function muxToMp4(
	video: EncodedVideoResult,
	audio: EncodedAudioResult | null
): Promise<Blob> {
	const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
	const muxer = new Muxer({
		target: new ArrayBufferTarget(),
		video: { codec: 'avc', width: video.width, height: video.height },
		...(audio
			? {
					audio: {
						codec: 'aac',
						sampleRate: audio.sampleRate,
						numberOfChannels: audio.numberOfChannels
					}
				}
			: {}),
		fastStart: 'in-memory',
		firstTimestampBehavior: 'offset'
	});

	const videoMeta = video.decoderConfig ? { decoderConfig: video.decoderConfig } : undefined;
	for (const chunk of video.chunks) {
		muxer.addVideoChunk(chunk, videoMeta);
	}

	if (audio) {
		const audioMeta = audio.decoderConfig ? { decoderConfig: audio.decoderConfig } : undefined;
		for (const chunk of audio.chunks) {
			muxer.addAudioChunk(chunk, audioMeta);
		}
	}

	muxer.finalize();
	return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

function getAssetById(assets: MediaAsset[], id?: string): MediaAsset | undefined {
	if (!id) return undefined;
	return assets.find((a) => a.id === id);
}

function createMediaElement(asset: MediaAsset): HTMLVideoElement | HTMLImageElement | null {
	if (asset.kind === 'image') {
		const img = new Image();
		img.src = asset.src;
		return img;
	}
	if (asset.kind === 'video') {
		const video = document.createElement('video');
		video.src = asset.src;
		video.muted = true;
		video.preload = 'auto';
		return video;
	}
	return null;
}

function collectVisualClips(tracks: Track[], mediaAssets: MediaAsset[], offset = 0): LoadedClip[] {
	const clips: LoadedClip[] = [];

	for (const track of tracks) {
		if (track.type === 'audio') continue;
		if (track.type === 'video' && track.muted) continue;
		if (track.type === 'adjustment' && track.muted) continue;
		for (const clip of track.clips) {
			if (clip.sequence) {
				clips.push(
					...collectVisualClips(clip.sequence.tracks, mediaAssets, offset + clip.startTime)
				);
				continue;
			}
			const asset = getAssetById(mediaAssets, clip.assetId);
			const element = asset ? createMediaElement(asset) : null;

			clips.push({
				clip,
				clipId: clip.id,
				isAdjustment: track.type === 'adjustment',
				startTime: offset + clip.startTime,
				duration: clip.duration,
				sourceStart: clip.sourceStart ?? 0,
				textStyle: clip.textStyle ? { ...clip.textStyle } : undefined,
				name: clip.name,
				sticker: clip.sticker,
				stickerColor: clip.stickerColor,
				speed: clip.speed,
				element,
				ready: !element
			});
		}
	}

	return clips;
}

async function waitForMediaReady(clips: LoadedClip[]): Promise<void> {
	const promises = clips
		.filter((c) => c.element && !c.ready)
		.map(
			(c) =>
				new Promise<void>((resolve, reject) => {
					const el = c.element!;
					const onReady = () => {
						c.ready = true;
						resolve();
					};
					const onError = () => {
						reject(new Error(`Media asset "${c.name}" could not be loaded for export`));
					};
					if (el instanceof HTMLVideoElement) {
						if (el.readyState >= 2) {
							onReady();
							return;
						}
						el.addEventListener('loadeddata', onReady, { once: true });
						el.addEventListener('error', onError, { once: true });
						el.load();
					} else {
						if (el.complete) {
							onReady();
							return;
						}
						el.addEventListener('load', onReady, { once: true });
						el.addEventListener('error', onError, { once: true });
					}
				})
		);
	await Promise.all(promises);
}

// fit the media inside the frame preserving its aspect ratio (object-fit: contain),
// matching how the Player preview letterboxes media whose ratio differs from the canvas
function getContainFitRect(
	mediaWidth: number,
	mediaHeight: number,
	canvasWidth: number,
	canvasHeight: number
): { x: number; y: number; width: number; height: number } {
	const safeWidth = Number.isFinite(mediaWidth) && mediaWidth > 0 ? mediaWidth : canvasWidth;
	const safeHeight = Number.isFinite(mediaHeight) && mediaHeight > 0 ? mediaHeight : canvasHeight;
	const scale = Math.min(canvasWidth / safeWidth, canvasHeight / safeHeight);
	const width = safeWidth * scale;
	const height = safeHeight * scale;
	return {
		x: (canvasWidth - width) / 2,
		y: (canvasHeight - height) / 2,
		width,
		height
	};
}

// draw the clip content (media, text, sticker) into the given context
// the color adjust filter is applied here so grading composes in a stable order
// parse a CSS length (px or %) against the canvas size, matching the full-canvas
// layer used by the preview when resolving percentage transform values
function parseCssLength(value: string, reference: number): number {
	const trimmed = (value ?? '').trim();
	if (trimmed.endsWith('%')) return (parseFloat(trimmed) / 100) * reference;
	return parseFloat(trimmed);
}

// apply a CSS transform string (as produced by getEffectVisualState) to a canvas
// context. functions are applied left-to-right, each in the local coordinate system
// of the previous one, mirroring CSS transform composition semantics.
function applyCssTransform(
	ctx: CanvasRenderingContext2D,
	transform: string,
	canvasWidth: number,
	canvasHeight: number
) {
	const functionPattern = /([a-zA-Z]+)\(([^)]*)\)/g;
	let match: RegExpExecArray | null;
	while ((match = functionPattern.exec(transform)) !== null) {
		const name = match[1];
		const args = match[2].split(',').map((arg) => arg.trim());
		switch (name) {
			case 'translate': {
				ctx.translate(
					parseCssLength(args[0], canvasWidth),
					parseCssLength(args[1] ?? '0', canvasHeight)
				);
				break;
			}
			case 'translateX': {
				ctx.translate(parseCssLength(args[0], canvasWidth), 0);
				break;
			}
			case 'translateY': {
				ctx.translate(0, parseCssLength(args[0], canvasHeight));
				break;
			}
			case 'rotate': {
				ctx.rotate((parseFloat(args[0]) * Math.PI) / 180);
				break;
			}
			case 'scale': {
				const scaleX = parseFloat(args[0]);
				const scaleY = parseFloat(args[1] ?? args[0]);
				ctx.scale(scaleX, scaleY);
				break;
			}
			case 'skewX': {
				ctx.transform(1, 0, Math.tan((parseFloat(args[0]) * Math.PI) / 180), 1, 0, 0);
				break;
			}
			case 'skewY': {
				ctx.transform(1, Math.tan((parseFloat(args[0]) * Math.PI) / 180), 0, 1, 0, 0);
				break;
			}
		}
	}
}

function drawClipContent(
	ctx: CanvasRenderingContext2D,
	clip: LoadedClip,
	canvasWidth: number,
	canvasHeight: number,
	colorFilter: string
) {
	if (colorFilter) ctx.filter = colorFilter;

	// video seeking is handled separately in seekClipsToTime before rendering
	if (clip.element) {
		if (clip.element instanceof HTMLVideoElement && clip.element.readyState >= 2) {
			const rect = getContainFitRect(
				clip.element.videoWidth,
				clip.element.videoHeight,
				canvasWidth,
				canvasHeight
			);
			ctx.drawImage(clip.element, rect.x, rect.y, rect.width, rect.height);
		} else if (clip.element instanceof HTMLImageElement && clip.element.complete) {
			const rect = getContainFitRect(
				clip.element.naturalWidth,
				clip.element.naturalHeight,
				canvasWidth,
				canvasHeight
			);
			ctx.drawImage(clip.element, rect.x, rect.y, rect.width, rect.height);
		}
	}

	if (clip.textStyle) {
		const style = clip.textStyle;
		const fontSize = Math.round((style.fontSize / 100) * canvasHeight * 0.08);
		const fontWeight = style.fontWeight;
		const fontFamily = style.fontFamily;
		ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}", sans-serif`;
		ctx.fillStyle = style.color;
		ctx.textAlign = style.textAlign as CanvasTextAlign;
		ctx.textBaseline = 'middle';

		const displayText = style.textTransform === 'uppercase' ? clip.name.toUpperCase() : clip.name;

		if (style.backgroundColor && style.backgroundColor !== 'transparent') {
			const metrics = ctx.measureText(displayText);
			const textX =
				style.textAlign === 'center'
					? canvasWidth / 2
					: style.textAlign === 'right'
						? canvasWidth - 20
						: 20;
			ctx.fillStyle = style.backgroundColor;
			ctx.fillRect(
				textX - (style.textAlign === 'center' ? metrics.width / 2 : 0) - 4,
				canvasHeight / 2 - fontSize / 2 - 4,
				metrics.width + 8,
				fontSize + 8
			);
		}

		ctx.fillStyle = style.color;
		const textX =
			style.textAlign === 'center'
				? canvasWidth / 2
				: style.textAlign === 'right'
					? canvasWidth - 20
					: 20;
		ctx.fillText(displayText, textX, canvasHeight / 2);
	}

	if (clip.sticker) {
		ctx.font = `${Math.round(canvasHeight * 0.15)}px sans-serif`;
		ctx.fillStyle = clip.stickerColor ?? '#ffffff';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(clip.sticker, canvasWidth / 2, canvasHeight / 2);
	}
}

// render the clip content into an offscreen canvas with exact pixel color grading
// the graded canvas is cached per clip and redrawn only when the frame time changes
function getGradedCanvas(
	clip: LoadedClip,
	localTime: number,
	canvasWidth: number,
	canvasHeight: number,
	colorFilter: string,
	grade: ColorGrade
): HTMLCanvasElement {
	if (
		!clip.gradedCanvas ||
		clip.gradedCanvas.width !== canvasWidth ||
		clip.gradedCanvas.height !== canvasHeight
	) {
		clip.gradedCanvas = document.createElement('canvas');
		clip.gradedCanvas.width = canvasWidth;
		clip.gradedCanvas.height = canvasHeight;
		clip.gradedTime = -1;
	}
	const canvas = clip.gradedCanvas;
	if (clip.gradedTime === localTime) return canvas;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return canvas;

	context.clearRect(0, 0, canvasWidth, canvasHeight);
	drawClipContent(context, clip, canvasWidth, canvasHeight, colorFilter);
	const imageData = context.getImageData(0, 0, canvasWidth, canvasHeight);
	if (isChromaKeyActive(clip.clip.chromaKey)) {
		applyChromaKey(imageData, getClipChromaKeyState(clip.clip, localTime));
	}
	// seed by the clip-local frame so film grain is deterministic per frame
	applyColorGrade(imageData, grade, Math.round(localTime * FRAME_RATE));
	context.putImageData(imageData, 0, 0);
	clip.gradedTime = localTime;
	return canvas;
}

function getTextAnimationTransform(
	clip: Clip,
	localTime: number
): { x: number; y: number; scale: number; opacity: number } {
	const edge = Math.min(0.35, clip.duration / 4);
	const intro = edge > 0 ? Math.min(1, localTime / edge) : 1;
	const outro = edge > 0 ? Math.min(1, (clip.duration - localTime) / edge) : 1;
	const progress = Math.max(0, Math.min(intro, outro));
	if (clip.textAnimation === 'lower-third-slide') {
		return { x: (progress - 1) * 18, y: 18, scale: 1, opacity: progress };
	}
	if (clip.textAnimation === 'lower-third-pop') {
		return { x: 0, y: 18, scale: 0.92 + progress * 0.08, opacity: progress };
	}
	return { x: 0, y: 0, scale: 1, opacity: 1 };
}

function drawClipOnCanvas(
	ctx: CanvasRenderingContext2D,
	clip: LoadedClip,
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number,
	transition?: RenderTransition,
	skipGrade = false
) {
	const localTime = currentTime - clip.startTime;
	if (localTime < 0 || localTime > clip.duration) return;

	ctx.save();

	const { transform, opacity, colorAdjust } = getClipVisualState(clip.clip, localTime);
	const textAnimation = getTextAnimationTransform(clip.clip, localTime);
	// merge preset effects (shake, glitch, filters, transitions) with the clip's color
	// adjustment and opacity, matching the preview's getEffectVisualState composition
	const effectState = getEffectVisualState(
		clip.clip.effects ?? [],
		localTime,
		clip.duration,
		colorAdjust,
		opacity
	);
	const renderFilter = effectState.filter !== 'none' ? effectState.filter : '';

	const transitionOpacity = transition?.state.opacity ?? 1;
	if (effectState.opacity * transitionOpacity * textAnimation.opacity < 1) {
		ctx.globalAlpha = effectState.opacity * transitionOpacity * textAnimation.opacity;
	}

	if (transform) {
		const centerX = (transform.x / 100) * canvasWidth;
		const centerY = (transform.y / 100) * canvasHeight;
		ctx.translate(
			centerX + (textAnimation.x / 100) * canvasWidth,
			centerY + (textAnimation.y / 100) * canvasHeight
		);
		ctx.rotate((transform.rotation * Math.PI) / 180);
		ctx.scale(transform.scale * textAnimation.scale, transform.scale * textAnimation.scale);
		ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
	}

	// blend the layer against the backdrop below it, matching the Player preview
	if (transform.blendMode && transform.blendMode !== 'normal') {
		ctx.globalCompositeOperation = transform.blendMode as GlobalCompositeOperation;
	}

	// clip to the mask shape before drawing the layer content
	const mask = transform.mask;
	if (mask) {
		ctx.beginPath();
		if (mask.type === 'rect') {
			ctx.rect(
				(mask.x / 100) * canvasWidth,
				(mask.y / 100) * canvasHeight,
				(mask.width / 100) * canvasWidth,
				(mask.height / 100) * canvasHeight
			);
		} else if (mask.type === 'ellipse') {
			ctx.ellipse(
				(mask.cx / 100) * canvasWidth,
				(mask.cy / 100) * canvasHeight,
				(mask.rx / 100) * canvasWidth,
				(mask.ry / 100) * canvasHeight,
				0,
				0,
				Math.PI * 2
			);
		} else if (mask.points.length >= 3) {
			ctx.moveTo((mask.points[0].x / 100) * canvasWidth, (mask.points[0].y / 100) * canvasHeight);
			for (let pointIndex = 1; pointIndex < mask.points.length; pointIndex += 1) {
				ctx.lineTo(
					(mask.points[pointIndex].x / 100) * canvasWidth,
					(mask.points[pointIndex].y / 100) * canvasHeight
				);
			}
			ctx.closePath();
		}
		ctx.clip();
	}

	// apply preset effect transforms (shake, glitch, drift, slide, zoom) pivoting around
	// the layer center, matching the preview's inner-layer transform which composes
	// effect transforms before clip-pair transition transforms
	if (effectState.transform && effectState.transform !== 'none') {
		ctx.translate(canvasWidth / 2, canvasHeight / 2);
		applyCssTransform(ctx, effectState.transform, canvasWidth, canvasHeight);
		ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
	}

	const transitionTranslateX = transition?.state.translateXPercent ?? 0;
	if (transitionTranslateX !== 0) {
		ctx.translate((transitionTranslateX / 100) * canvasWidth, 0);
	}
	const clipInsetRightPercent = transition?.state.clipInsetRightPercent ?? 0;
	if (clipInsetRightPercent > 0) {
		ctx.beginPath();
		ctx.rect(0, 0, canvasWidth * (1 - clipInsetRightPercent / 100), canvasHeight);
		ctx.clip();
	}

	const grade = clip.clip.colorGrade;
	if (!skipGrade && grade && !isNeutralGrade(grade)) {
		const graded = getGradedCanvas(clip, localTime, canvasWidth, canvasHeight, renderFilter, grade);
		ctx.drawImage(graded, 0, 0, canvasWidth, canvasHeight);
	} else {
		// chroma key is part of the base composition, not the grade: apply it here
		// too (skipped grading, neutral grade, or plain key without a grade) so the
		// before/after view and exports match what the player previews
		const chromaKeyState = isChromaKeyActive(clip.clip.chromaKey)
			? getClipChromaKeyState(clip.clip, localTime)
			: null;
		if (!chromaKeyState) {
			drawClipContent(ctx, clip, canvasWidth, canvasHeight, renderFilter);
		} else {
			// the key needs per-pixel access, so draw to an offscreen canvas first and
			// composite the keyed result, preserving the layer transform on ctx
			const offscreen = document.createElement('canvas');
			offscreen.width = canvasWidth;
			offscreen.height = canvasHeight;
			const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });
			if (!offscreenContext) {
				drawClipContent(ctx, clip, canvasWidth, canvasHeight, renderFilter);
			} else {
				drawClipContent(offscreenContext, clip, canvasWidth, canvasHeight, renderFilter);
				const imageData = offscreenContext.getImageData(0, 0, canvasWidth, canvasHeight);
				applyChromaKey(imageData, chromaKeyState);
				offscreenContext.putImageData(imageData, 0, 0);
				ctx.drawImage(offscreen, 0, 0);
			}
		}
	}

	ctx.restore();
}

function getRenderTransitions(
	clips: LoadedClip[],
	currentTime: number
): Map<string, RenderTransition> {
	const transitions = new Map<string, RenderTransition>();
	const clipsById = new Map(clips.map((clip) => [clip.clip.id, clip]));
	for (const outgoing of clips) {
		const transition = outgoing.clip.clipTransition;
		if (!transition) continue;
		const incoming = clipsById.get(transition.incomingClipId);
		if (!incoming) continue;
		const progress = getClipPairTransitionProgress(outgoing.clip, incoming.clip, currentTime);
		if (progress === null) continue;
		transitions.set(outgoing.clip.id, {
			role: 'outgoing',
			state: getClipTransitionVisualState(transition.presetId, 'outgoing', progress)
		});
		transitions.set(incoming.clip.id, {
			role: 'incoming',
			state: getClipTransitionVisualState(transition.presetId, 'incoming', progress)
		});
	}
	return transitions;
}

export type ComposedFrameOptions = {
	/** render the raw composition without any color grading (for before/after views) */
	skipGrade?: boolean;
	/** apply a preview LUT to the composed frame without changing project state */
	lutOverride?: LUTPreset;
};

function applyLutOverride(canvas: HTMLCanvasElement, lut: LUTPreset) {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) return;
	const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
	for (let offset = 0; offset < imageData.data.length; offset += 4) {
		const [red, green, blue] = lut.apply(
			imageData.data[offset] / 255,
			imageData.data[offset + 1] / 255,
			imageData.data[offset + 2] / 255
		);
		imageData.data[offset] = Math.round(red * 255);
		imageData.data[offset + 1] = Math.round(green * 255);
		imageData.data[offset + 2] = Math.round(blue * 255);
	}
	context.putImageData(imageData, 0, 0);
}

// an adjustment layer re-filters the already-composited frame below it: the
// current canvas state is snapshotted, graded (exact per-pixel), then redrawn
// with the preset effect filter, effect transform and opacity applied on top.
// because renderFrame iterates clips bottom-to-top, everything painted before
// the adjustment is exactly what it applies to; layers above it draw later and
// stay untouched.
function applyAdjustmentLayer(
	ctx: CanvasRenderingContext2D,
	clip: LoadedClip,
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number
) {
	const localTime = currentTime - clip.startTime;
	if (localTime < 0 || localTime > clip.duration) return;

	const { opacity, colorAdjust } = getClipVisualState(clip.clip, localTime);
	const effectState = getEffectVisualState(
		clip.clip.effects ?? [],
		localTime,
		clip.duration,
		colorAdjust,
		opacity
	);
	const renderFilter = effectState.filter !== 'none' ? effectState.filter : '';
	const grade = clip.clip.colorGrade;

	// nothing to apply: skip the snapshot round-trip
	if (
		!renderFilter &&
		(!grade || isNeutralGrade(grade)) &&
		(!effectState.transform || effectState.transform === 'none') &&
		effectState.opacity >= 1
	) {
		return;
	}

	const offscreen = document.createElement('canvas');
	offscreen.width = canvasWidth;
	offscreen.height = canvasHeight;
	const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });
	if (!offscreenContext) return;
	offscreenContext.drawImage(ctx.canvas, 0, 0);

	// exact per-pixel grading first (curves, wheels, luts, secondary qualifiers)
	if (grade && !isNeutralGrade(grade)) {
		const imageData = offscreenContext.getImageData(0, 0, canvasWidth, canvasHeight);
		applyColorGrade(imageData, grade, Math.round(currentTime * FRAME_RATE));
		offscreenContext.putImageData(imageData, 0, 0);
	}

	ctx.save();
	// effect transforms (shake, glitch, drift, zoom) pivot around the frame center
	if (effectState.transform && effectState.transform !== 'none') {
		ctx.translate(canvasWidth / 2, canvasHeight / 2);
		applyCssTransform(ctx, effectState.transform, canvasWidth, canvasHeight);
		ctx.translate(-canvasWidth / 2, -canvasHeight / 2);
	}
	if (renderFilter) ctx.filter = renderFilter;
	ctx.globalAlpha = effectState.opacity;
	ctx.drawImage(offscreen, 0, 0);
	ctx.restore();
}

function renderFrame(
	canvas: HTMLCanvasElement,
	clips: LoadedClip[],
	currentTime: number,
	options?: ComposedFrameOptions
) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.fillStyle = '#000000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const transitions = getRenderTransitions(clips, currentTime);
	for (const clip of clips) {
		if (clip.startTime <= currentTime && currentTime < clip.startTime + clip.duration) {
			if (clip.isAdjustment) {
				// the before/after split view shows the ungraded composition, so
				// adjustment layers are skipped along with per-clip grading
				if (options?.skipGrade !== true) {
					applyAdjustmentLayer(ctx, clip, currentTime, canvas.width, canvas.height);
				}
				continue;
			}
			drawClipOnCanvas(
				ctx,
				clip,
				currentTime,
				canvas.width,
				canvas.height,
				transitions.get(clip.clip.id),
				options?.skipGrade === true
			);
		}
	}
}

function cleanupClips(clips: LoadedClip[]) {
	for (const clip of clips) {
		clip.gradedCanvas = null;
		clip.gradedTime = -1;
		if (clip.element instanceof HTMLVideoElement) {
			clip.element.pause();
			clip.element.src = '';
			clip.element.load();
		}
	}
}

// seek a video element and wait for the seeked event with a timeout fallback
function seekVideoToTime(video: HTMLVideoElement, time: number): Promise<void> {
	const frameEpsilon = 1 / FRAME_RATE / 2;
	if (Math.abs(video.currentTime - time) < frameEpsilon) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve) => {
		let settled = false;

		const finish = () => {
			if (settled) return;
			settled = true;
			video.removeEventListener('seeked', finish);
			clearTimeout(timeoutId);
			resolve();
		};

		video.addEventListener('seeked', finish, { once: true });
		const timeoutId = setTimeout(finish, SEEK_TIMEOUT_MS);
		video.currentTime = time;
	});
}

// seek all active video clips to the correct source time before rendering a frame
async function seekClipsToTime(clips: LoadedClip[], currentTime: number): Promise<void> {
	const seekPromises: Promise<void>[] = [];

	for (const clip of clips) {
		if (currentTime < clip.startTime || currentTime >= clip.startTime + clip.duration) continue;
		if (!(clip.element instanceof HTMLVideoElement)) continue;

		const localTime = currentTime - clip.startTime;
		const sourceTime = getClipSourceTime(clip.clip, localTime);
		seekPromises.push(seekVideoToTime(clip.element, sourceTime));
	}

	await Promise.all(seekPromises);
}

function parseBitrate(bitrate: string): number {
	const match = bitrate.match(/^(\d+)([km]?)$/i);
	if (!match) return 3_000_000;
	const value = Number(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === 'k') return value * 1_000;
	if (unit === 'm') return value * 1_000_000;
	return value;
}

async function recordCanvasToWebM(
	canvas: HTMLCanvasElement,
	clips: LoadedClip[],
	quality: ExportQuality,
	totalFrames: number,
	startOffset: number,
	onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
	const stream = canvas.captureStream(0);
	const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
		? 'video/webm;codecs=vp9'
		: MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
			? 'video/webm;codecs=vp8'
			: 'video/webm';

	const chunks: Blob[] = [];
	let resolveRecording: (blob: Blob) => void;
	let rejectRecording: (err: Error) => void;

	const recorded = new Promise<Blob>((resolve, reject) => {
		resolveRecording = resolve;
		rejectRecording = reject;
	});

	const recorder = new MediaRecorder(stream, {
		mimeType,
		videoBitsPerSecond: parseBitrate(quality.bitrate)
	});

	recorder.ondataavailable = (e) => {
		if (e.data.size > 0) chunks.push(e.data);
	};

	recorder.onstop = () => {
		if (chunks.length === 0) {
			rejectRecording(new Error('No video data captured'));
			return;
		}
		resolveRecording(new Blob(chunks, { type: mimeType }));
	};

	recorder.onerror = () => {
		rejectRecording(new Error('MediaRecorder error'));
	};

	recorder.start();

	const trackStream = stream.getVideoTracks()[0];

	const frameIntervalMs = 1000 / FRAME_RATE;
	let nextFrameTime = performance.now();

	for (let frame = 0; frame < totalFrames; frame++) {
		const currentTime = startOffset + frame / FRAME_RATE;

		await seekClipsToTime(clips, currentTime);
		renderFrame(canvas, clips, currentTime);

		if (trackStream && 'requestFrame' in trackStream) {
			(trackStream as CanvasCaptureMediaStreamTrack).requestFrame();
		}

		// pace captures to wall clock so PTS matches the timeline
		nextFrameTime += frameIntervalMs;
		const delay = nextFrameTime - performance.now();
		if (delay > 0) {
			await new Promise((r) => setTimeout(r, delay));
		} else {
			nextFrameTime = performance.now();
		}

		if (frame % progressUpdateIntervalFrames() === 0 || frame === totalFrames - 1) {
			onProgress?.({
				phase: 'rendering',
				frame: frame + 1,
				totalFrames,
				message: `Rendering frame ${frame + 1} of ${totalFrames}`
			});
		}
	}

	recorder.requestData();
	await new Promise((r) => setTimeout(r, 100));
	recorder.stop();

	return recorded;
}

export async function exportVideo(options: ExportOptions): Promise<Blob | null> {
	const { tracks, mediaAssets, quality, duration, startTime = 0, endTime, onProgress } = options;
	const exportStart = Math.max(0, startTime);
	const exportEnd = endTime !== undefined ? Math.min(endTime, duration) : duration;
	const exportDuration = Math.max(0, exportEnd - exportStart);
	const totalFrames = Math.ceil(exportDuration * FRAME_RATE);

	onProgress?.({
		phase: 'preparing',
		frame: 0,
		totalFrames,
		message: 'Preparing media...'
	});

	const clips = collectVisualClips(tracks, mediaAssets);
	const audioClips = collectAudioClips(tracks, mediaAssets);

	await waitForMediaReady(clips);

	// kick off audio decode + offline mix in parallel with video rendering: the two
	// pipelines share no mutable state, and decodeAudioData / startRendering run off
	// the main thread, so wall-clock time becomes max(video, audio) instead of the sum
	let mixedBufferPromise: Promise<AudioBuffer | null> = Promise.resolve(null);

	if (audioClips.length > 0) {
		onProgress?.({
			phase: 'mixing-audio',
			frame: 0,
			totalFrames,
			message: 'Mixing audio...'
		});

		mixedBufferPromise = (async () => {
			try {
				const { buffers: decodedBuffers, sampleRate } = await decodeAudioAssets(audioClips);
				return await mixAudioOffline(
					audioClips,
					decodedBuffers,
					sampleRate,
					exportStart,
					exportDuration
				);
			} catch {
				// fall back to video-only export
				return null;
			}
		})();
	}

	let finalBlob: Blob | null = null;

	try {
		const videoEncoderConfig = await pickVideoEncoderConfig(
			quality.width,
			quality.height,
			parseBitrate(quality.bitrate)
		);

		if (videoEncoderConfig) {
			try {
				finalBlob = await exportWithWebCodecs(
					clips,
					quality,
					totalFrames,
					exportStart,
					exportDuration,
					videoEncoderConfig,
					mixedBufferPromise,
					onProgress
				);
			} catch {
				// fall back to MediaRecorder
			}
		}

		if (!finalBlob) {
			const canvas = document.createElement('canvas');
			canvas.width = quality.width;
			canvas.height = quality.height;

			const webmBlob = await recordCanvasToWebM(
				canvas,
				clips,
				quality,
				totalFrames,
				exportStart,
				onProgress
			);

			onProgress?.({
				phase: 'encoding',
				frame: totalFrames,
				totalFrames,
				message: 'Converting to MP4...'
			});

			const mixedBuffer = await mixedBufferPromise;
			const audioWavBlob = mixedBuffer ? encodeAudioBufferToWav(mixedBuffer) : null;
			finalBlob = await transcodeToMp4(webmBlob, quality, audioWavBlob, onProgress, exportDuration);
		}

		onProgress?.({
			phase: 'done',
			frame: totalFrames,
			totalFrames,
			message: 'Export complete'
		});

		return finalBlob;
	} finally {
		cleanupClips(clips);
	}
}

async function exportWithWebCodecs(
	clips: LoadedClip[],
	quality: ExportQuality,
	totalFrames: number,
	exportStart: number,
	exportDuration: number,
	videoEncoderConfig: VideoEncoderConfig,
	mixedBufferPromise: Promise<AudioBuffer | null>,
	onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
	const [videoResult, audioResult] = await Promise.all([
		encodeVideoChunks(clips, quality, totalFrames, exportStart, videoEncoderConfig, onProgress),
		mixedBufferPromise.then((mixedBuffer) =>
			mixedBuffer
				? pickAudioEncoderConfig(mixedBuffer.sampleRate, mixedBuffer.numberOfChannels).then(
						(audioConfig) => (audioConfig ? encodeAudioAac(mixedBuffer, audioConfig) : null)
					)
				: null
		)
	]);

	if (audioResult) {
		onProgress?.({
			phase: 'encoding',
			frame: 100,
			totalFrames: 100,
			message: 'Muxing final file...'
		});
		const blob = await muxToMp4(videoResult, audioResult);
		return blob;
	}

	onProgress?.({
		phase: 'encoding',
		frame: 100,
		totalFrames: 100,
		message: 'Muxing video...'
	});
	const videoOnlyBlob = await muxToMp4(videoResult, null);

	// the mix is already resolved by the Promise.all above; await again for the value
	const mixedBuffer = await mixedBufferPromise;
	if (!mixedBuffer) return videoOnlyBlob;

	onProgress?.({
		phase: 'encoding',
		frame: 90,
		totalFrames: 100,
		message: 'Adding audio track...'
	});
	return addAudioWithFfmpeg(
		videoOnlyBlob,
		encodeAudioBufferToWav(mixedBuffer),
		onProgress,
		exportDuration
	);
}

export type FrameExportFormat = 'png' | 'jpeg';

export type FrameExportOptions = {
	tracks: Track[];
	mediaAssets: MediaAsset[];
	/** timeline time (seconds) of the frame to capture */
	time: number;
	/** output pixel dimensions */
	resolution: ExportResolution;
	format?: FrameExportFormat;
	/** JPEG quality 0-1, ignored for PNG */
	quality?: number;
};

// a reusable composed-frame renderer for live analysis: scopes, before/after
// split view and shot matching all render through the same pipeline the export
// uses, so what you see is what ends up in the final video.
// keep the renderer alive across calls and dispose() it when done.
export type ComposedFrameRenderer = {
	render: (
		canvas: HTMLCanvasElement,
		time: number,
		options?: ComposedFrameOptions
	) => Promise<void>;
	dispose: () => void;
};

export function createFrameRenderer(
	tracks: Track[],
	mediaAssets: MediaAsset[]
): ComposedFrameRenderer {
	let clips = collectVisualClips(tracks, mediaAssets);
	let readyPromise: Promise<void> | null = null;
	let disposed = false;

	return {
		async render(canvas, time, options) {
			if (disposed) return;
			if (!readyPromise) {
				// tolerate failed assets: anything that fails to load simply stays
				// invisible in the composed frame
				readyPromise = waitForMediaReady(clips).catch(() => {});
			}
			await readyPromise;
			if (disposed) return;
			await seekClipsToTime(clips, time);
			if (disposed) return;
			renderFrame(canvas, clips, time, options);
			if (options?.lutOverride) applyLutOverride(canvas, options.lutOverride);
		},
		dispose() {
			disposed = true;
			cleanupClips(clips);
			clips = [];
		}
	};
}

// capture a single composed frame at the given timeline time as an image blob.
// Reuses the same render pipeline that exports video frames, so grading, effects,
// transitions and captions all appear exactly as they would in the exported video.
export async function exportFrame(options: FrameExportOptions): Promise<Blob | null> {
	const { tracks, mediaAssets, time, resolution, format = 'png' } = options;
	// video frames are rendered at exact multiples of 1/FRAME_RATE — snap to the
	// frame boundary so the captured image matches the video frame at this instant
	const frameTime = Math.round(time * FRAME_RATE) / FRAME_RATE;
	const clips = collectVisualClips(tracks, mediaAssets);
	try {
		await waitForMediaReady(clips);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(2, Math.round(resolution.width));
		canvas.height = Math.max(2, Math.round(resolution.height));
		await seekClipsToTime(clips, frameTime);
		renderFrame(canvas, clips, frameTime);
		const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
		return await new Promise<Blob | null>((resolve) => {
			canvas.toBlob(resolve, mimeType, format === 'jpeg' ? (options.quality ?? 0.92) : undefined);
		});
	} finally {
		cleanupClips(clips);
	}
}
