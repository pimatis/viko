import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// load ffmpeg-core from CDN to avoid bundling the 31 MB wasm
const FFMPEG_CORE_VERSION = '0.12.10';
const FFMPEG_CDN_BASE = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_CORE_VERSION}/dist/umd`;
const ffmpegCoreURL = `${FFMPEG_CDN_BASE}/ffmpeg-core.js`;
const ffmpegCoreWasmURL = `${FFMPEG_CDN_BASE}/ffmpeg-core.wasm`;
import type { Track, Clip } from '$lib/editor/timeline';
import {
	FRAME_RATE,
	getClipChromaKeyState,
	getClipSourceTime,
	getClipVisualState,
	getColorAdjustFilter
} from '$lib/editor/timeline';
import type { MediaAsset } from '$lib/editor/sidebar';
import { applyChromaKey, isChromaKeyActive } from '$lib/chroma';
import { applyColorGrade, isNeutralGrade, type ColorGrade } from '$lib/grading';
import {
	getClipPairTransitionProgress,
	getClipTransitionVisualState,
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

const PROGRESS_UPDATE_INTERVAL_FRAMES = Math.max(1, Math.round(FRAME_RATE));
const SEEK_TIMEOUT_MS = 3000;
const MICROSECONDS_PER_SECOND = 1_000_000;
const FRAME_DURATION_US = Math.round(MICROSECONDS_PER_SECOND / FRAME_RATE);
const CHUNK_FRAME_COUNT = FRAME_RATE * 5;
const AUDIO_CHUNK_SAMPLES = 16384;
const AUDIO_BITRATE = 192_000;

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoading: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
	if (ffmpegInstance) return ffmpegInstance;
	if (ffmpegLoading) return ffmpegLoading;

	ffmpegLoading = (async () => {
		const ffmpeg = new FFmpeg();

		try {
			await ffmpeg.load({
				coreURL: ffmpegCoreURL,
				wasmURL: ffmpegCoreWasmURL
			});
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

	const chunkCount = Math.ceil(totalFrames / CHUNK_FRAME_COUNT);

	for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++) {
		const startFrame = chunkIndex * CHUNK_FRAME_COUNT;
		const endFrame = Math.min(totalFrames, startFrame + CHUNK_FRAME_COUNT);

		for (let frame = startFrame; frame < endFrame; frame++) {
			const currentTime = startOffset + frame / FRAME_RATE;
			await seekClipsToTime(clips, currentTime);
			renderFrame(canvas, clips, currentTime);

			const videoFrame = new VideoFrame(canvas, {
				timestamp: frame * FRAME_DURATION_US,
				duration: FRAME_DURATION_US
			});
			encoder.encode(videoFrame, { keyFrame: frame === startFrame });
			videoFrame.close();

			if ((frame + 1) % 15 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
			if ((frame + 1) % PROGRESS_UPDATE_INTERVAL_FRAMES === 0 || frame === totalFrames - 1) {
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

function muxToMp4(video: EncodedVideoResult, audio: EncodedAudioResult | null): Blob {
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

function collectVisualClips(tracks: Track[], mediaAssets: MediaAsset[]): LoadedClip[] {
	const clips: LoadedClip[] = [];

	for (const track of tracks) {
		if (track.type === 'audio') continue;
		if (track.type === 'video' && track.muted) continue;
		for (const clip of track.clips) {
			const asset = getAssetById(mediaAssets, clip.assetId);
			const element = asset ? createMediaElement(asset) : null;

			clips.push({
				clip,
				clipId: clip.id,
				startTime: clip.startTime,
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

// draw the clip content (media, text, sticker) into the given context
// the color adjust filter is applied here so grading composes in a stable order
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
			ctx.drawImage(clip.element, 0, 0, canvasWidth, canvasHeight);
		} else if (clip.element instanceof HTMLImageElement && clip.element.complete) {
			ctx.drawImage(clip.element, 0, 0, canvasWidth, canvasHeight);
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
	applyColorGrade(imageData, grade);
	context.putImageData(imageData, 0, 0);
	clip.gradedTime = localTime;
	return canvas;
}

function drawClipOnCanvas(
	ctx: CanvasRenderingContext2D,
	clip: LoadedClip,
	currentTime: number,
	canvasWidth: number,
	canvasHeight: number,
	transition?: RenderTransition
) {
	const localTime = currentTime - clip.startTime;
	if (localTime < 0 || localTime > clip.duration) return;

	ctx.save();

	const { transform, opacity, colorAdjust } = getClipVisualState(clip.clip, localTime);
	const colorFilter = getColorAdjustFilter(colorAdjust);

	const transitionOpacity = transition?.state.opacity ?? 1;
	if (opacity * transitionOpacity < 1) ctx.globalAlpha = opacity * transitionOpacity;

	if (transform) {
		const centerX = (transform.x / 100) * canvasWidth;
		const centerY = (transform.y / 100) * canvasHeight;
		ctx.translate(centerX, centerY);
		ctx.rotate((transform.rotation * Math.PI) / 180);
		ctx.scale(transform.scale, transform.scale);
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
	if (grade && !isNeutralGrade(grade)) {
		const graded = getGradedCanvas(clip, localTime, canvasWidth, canvasHeight, colorFilter, grade);
		ctx.drawImage(graded, 0, 0, canvasWidth, canvasHeight);
	} else {
		drawClipContent(ctx, clip, canvasWidth, canvasHeight, colorFilter);
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

function renderFrame(canvas: HTMLCanvasElement, clips: LoadedClip[], currentTime: number) {
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	ctx.fillStyle = '#000000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	const transitions = getRenderTransitions(clips, currentTime);
	for (const clip of clips) {
		if (clip.startTime <= currentTime && currentTime < clip.startTime + clip.duration) {
			drawClipOnCanvas(
				ctx,
				clip,
				currentTime,
				canvas.width,
				canvas.height,
				transitions.get(clip.clip.id)
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

		if (frame % PROGRESS_UPDATE_INTERVAL_FRAMES === 0 || frame === totalFrames - 1) {
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

	let mixedBuffer: AudioBuffer | null = null;

	if (audioClips.length > 0) {
		onProgress?.({
			phase: 'mixing-audio',
			frame: 0,
			totalFrames,
			message: 'Mixing audio...'
		});

		try {
			const { buffers: decodedBuffers, sampleRate } = await decodeAudioAssets(audioClips);
			mixedBuffer = await mixAudioOffline(
				audioClips,
				decodedBuffers,
				sampleRate,
				exportStart,
				exportDuration
			);
		} catch {
			// fall back to video-only export
		}
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
					mixedBuffer,
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
	mixedBuffer: AudioBuffer | null,
	onProgress?: (progress: ExportProgress) => void
): Promise<Blob> {
	const [videoResult, audioResult] = await Promise.all([
		encodeVideoChunks(clips, quality, totalFrames, exportStart, videoEncoderConfig, onProgress),
		mixedBuffer
			? pickAudioEncoderConfig(mixedBuffer.sampleRate, mixedBuffer.numberOfChannels).then(
					(audioConfig) => (audioConfig ? encodeAudioAac(mixedBuffer, audioConfig) : null)
				)
			: Promise.resolve(null)
	]);

	if (audioResult) {
		onProgress?.({
			phase: 'encoding',
			frame: 100,
			totalFrames: 100,
			message: 'Muxing final file...'
		});
		const blob = muxToMp4(videoResult, audioResult);
		return blob;
	}

	onProgress?.({
		phase: 'encoding',
		frame: 100,
		totalFrames: 100,
		message: 'Muxing video...'
	});
	const videoOnlyBlob = muxToMp4(videoResult, null);

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
