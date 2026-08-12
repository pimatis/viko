import { registerCaptionTranscriber, buildTimedCaptionSegments } from '$lib/editor/captions';
import type { CaptionSegment, TimedWord } from '$lib/editor/captions';
import { decodeMediaToMono16k, TRANSCRIBE_SAMPLE_RATE } from './audio';
import {
	createLoadProgressTracker,
	type LoadProgressHandler,
	type LoadProgressEvent
} from './progress';

const WHISPER_MODEL_ID = 'Xenova/whisper-tiny.en';
const WHISPER_TASK = 'automatic-speech-recognition';
const WHISPER_CHUNK_SECONDS = 30;
const WHISPER_CHUNK_STRIDE_SECONDS = 5;
const WHISPER_QUANTIZED_DTYPE = 'q8' as const;
const WHISPER_CPU_DTYPE = 'fp32' as const;

type WhisperWord = { text: string; timestamp: [number, number] };
type WhisperChunk = WhisperWord;
type WhisperOutput = { text: string; chunks?: WhisperChunk[] };
type WhisperDtype = 'q8' | 'fp32';
type WhisperCall = (
	audio: Float32Array,
	options: { chunk_length_s: number; stride_length_s: number; return_timestamps: 'word' }
) => Promise<WhisperOutput>;

let whisperCallPromise: Promise<WhisperCall> | null = null;

// lazily load the in-browser whisper pipeline, reusing it for every call
function getWhisperCall(onProgress?: LoadProgressHandler): Promise<WhisperCall> {
	if (!whisperCallPromise) {
		whisperCallPromise = createWhisperCall(onProgress);
	}
	return whisperCallPromise;
}

// prefer WebGPU for fast quantized inference, fall back to WASM with fp32 weights
async function createWhisperCall(onProgress?: LoadProgressHandler): Promise<WhisperCall> {
	const { env, pipeline } = await import('@huggingface/transformers');
	env.allowLocalModels = false;
	const trackProgress = createLoadProgressTracker((overallPercent, fileName) => {
		onProgress?.(overallPercent, fileName);
	});
	const load = (device: 'webgpu' | 'wasm', dtype: WhisperDtype) =>
		pipeline(WHISPER_TASK, WHISPER_MODEL_ID, {
			device,
			dtype,
			progress_callback: trackProgress as (event: LoadProgressEvent) => void
		}) as Promise<WhisperCall>;
	if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
		try {
			return await load('webgpu', WHISPER_QUANTIZED_DTYPE);
		} catch (error) {
			console.warn('[captions] WebGPU transcription unavailable, falling back to WASM:', error);
		}
	}
	return load('wasm', WHISPER_CPU_DTYPE);
}

async function transcribeWithWhisper(
	source: { assetId: string; name: string; media: Blob },
	options?: { language?: string; onProgress?: LoadProgressHandler }
): Promise<CaptionSegment[]> {
	const language = options?.language;
	if (language && language !== 'en' && language !== 'english') {
		throw new Error('The in-browser Whisper model only supports English transcription');
	}
	const audio = await decodeMediaToMono16k(source.media);
	const audioDuration = audio.length / TRANSCRIBE_SAMPLE_RATE;
	const whisperCall = await getWhisperCall(options?.onProgress);
	const output = await whisperCall(audio, {
		chunk_length_s: WHISPER_CHUNK_SECONDS,
		stride_length_s: WHISPER_CHUNK_STRIDE_SECONDS,
		return_timestamps: 'word'
	});
	const words: TimedWord[] = [];
	for (const chunk of output.chunks ?? []) {
		const start = Math.max(0, chunk.timestamp[0]);
		const end = Math.min(audioDuration, chunk.timestamp[1]);
		if (Number.isFinite(start) && Number.isFinite(end) && chunk.text.trim()) {
			words.push({ text: chunk.text, timestamp: [start, end] });
		}
	}
	return buildTimedCaptionSegments(words);
}

registerCaptionTranscriber({
	id: 'whisper-tiny-en',
	name: 'Whisper (in-browser)',
	transcribe: transcribeWithWhisper
});
