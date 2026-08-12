import type { TextStyle } from './text';
import type { Clip } from './timeline';
import { FRAME_RATE, roundToFrame } from './timeline';

export type CaptionSegment = {
	text: string;
	startTime: number;
	duration: number;
};

export type CaptionPreset = {
	id: string;
	name: string;
	textStyle: TextStyle;
	positionY: number;
};

export type CaptionGeneratePayload = {
	transcript: string;
	presetId: string;
};

export const CAPTION_PRESETS: CaptionPreset[] = [
	{
		id: 'caption-default',
		name: 'Default',
		textStyle: {
			fontFamily: 'Inter Variable',
			fontSize: 44,
			fontWeight: 800,
			color: '#ffffff',
			backgroundColor: '#000000cc',
			textAlign: 'center',
			textTransform: 'none'
		},
		positionY: 88
	},
	{
		id: 'caption-pop',
		name: 'Pop',
		textStyle: {
			fontFamily: 'Montserrat Variable',
			fontSize: 46,
			fontWeight: 700,
			color: '#ffffff',
			backgroundColor: '#111111cc',
			textAlign: 'center',
			textTransform: 'uppercase'
		},
		positionY: 88
	},
	{
		id: 'caption-minimal',
		name: 'Minimal',
		textStyle: {
			fontFamily: 'Space Grotesk',
			fontSize: 40,
			fontWeight: 600,
			color: '#ffffff',
			backgroundColor: 'transparent',
			textAlign: 'center',
			textTransform: 'none'
		},
		positionY: 90
	}
];

const MAX_CAPTION_CHARS_PER_LINE = 48;
const MIN_SEGMENT_DURATION = 0.8;
const MAX_SEGMENT_DURATION = 4;
const MIN_WINDOW_DURATION = 5;
const CAPTION_CHARS_PER_SECOND = 15;

export function getCaptionPreset(presetId: string): CaptionPreset | null {
	return CAPTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

// split a transcript into caption lines, keeping sentence boundaries intact
function buildCaptionLines(transcript: string): string[] {
	const normalized = transcript.replace(/\s+/g, ' ').trim();
	if (!normalized) return [];
	const sentences = normalized.match(/[^.!?;:""]+[.!?;:""]*/g) ?? [];
	const lines: string[] = [];
	for (const sentence of sentences) {
		const trimmed = sentence.trim();
		if (!trimmed) continue;
		const words = trimmed.split(' ');
		let currentLine = '';
		for (const word of words) {
			const candidate = currentLine ? `${currentLine} ${word}` : word;
			if (currentLine && candidate.length > MAX_CAPTION_CHARS_PER_LINE) {
				lines.push(currentLine);
				currentLine = word;
				continue;
			}
			currentLine = candidate;
		}
		if (currentLine) lines.push(currentLine);
	}
	return lines;
}

// distribute a transcript across a time window, weighted by line length
export function splitTranscriptIntoSegments(
	transcript: string,
	totalDuration: number
): CaptionSegment[] {
	const lines = buildCaptionLines(transcript);
	if (lines.length === 0) return [];
	const windowDuration = Math.max(MIN_WINDOW_DURATION, totalDuration);
	const totalChars = lines.reduce((sum, line) => sum + line.length, 0);
	if (totalChars === 0) return [];
	const clampedDurations = lines.map((line) => {
		const weighted = windowDuration * (line.length / totalChars);
		return Math.min(MAX_SEGMENT_DURATION, Math.max(MIN_SEGMENT_DURATION, weighted));
	});
	const clampedTotal = clampedDurations.reduce((sum, duration) => sum + duration, 0);
	const segments: CaptionSegment[] = [];
	let cursor = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const duration = roundToFrame(clampedDurations[index] * (windowDuration / clampedTotal));
		segments.push({
			text: lines[index],
			startTime: roundToFrame(cursor),
			duration
		});
		cursor += duration;
	}
	return segments;
}

// estimate how long a spoken transcript takes at a typical narration pace
export function estimateCaptionDuration(transcript: string): number {
	const chars = transcript.replace(/\s+/g, ' ').trim().length;
	if (chars === 0) return MIN_WINDOW_DURATION;
	return Math.max(MIN_WINDOW_DURATION, Math.ceil(chars / CAPTION_CHARS_PER_SECOND));
}

export type TimedWord = {
	text: string;
	timestamp: [number, number];
};

const SENTENCE_END_PATTERN = /[.!?;:""]$/;

// group word-level timestamps into readable caption lines with real timing
export function buildTimedCaptionSegments(words: TimedWord[]): CaptionSegment[] {
	const validWords = words.filter((word) => word.text.trim().length > 0);
	const lines: TimedWord[][] = [];
	let currentLine: TimedWord[] = [];
	for (const word of validWords) {
		const wordText = word.text.trim();
		const lineLength = currentLine.reduce((sum, item) => sum + item.text.trim().length, 0);
		const candidateLength = lineLength + (currentLine.length > 0 ? 1 : 0) + wordText.length;
		if (currentLine.length > 0) {
			const endsSentence = SENTENCE_END_PATTERN.test(wordText);
			if (candidateLength > MAX_CAPTION_CHARS_PER_LINE) {
				lines.push(currentLine);
				currentLine = [];
			} else if (endsSentence) {
				currentLine.push(word);
				lines.push(currentLine);
				currentLine = [];
				continue;
			}
		}
		currentLine.push(word);
	}
	if (currentLine.length > 0) lines.push(currentLine);

	const segments: CaptionSegment[] = [];
	for (const line of lines) {
		const startTime = line[0].timestamp[0];
		const endTime = line[line.length - 1].timestamp[1];
		segments.push({
			text: line.map((item) => item.text.trim()).join(' '),
			startTime: roundToFrame(startTime),
			duration: roundToFrame(Math.max(MIN_SEGMENT_DURATION, endTime - startTime))
		});
	}
	for (let index = 0; index < segments.length - 1; index += 1) {
		const nextStart = segments[index + 1].startTime;
		segments[index].duration = Math.min(
			segments[index].duration,
			Math.max(1 / FRAME_RATE, nextStart - segments[index].startTime)
		);
	}
	return segments;
}

// build timeline-ready caption clips from transcribed segments
export function buildCaptionClips(
	segments: CaptionSegment[],
	preset: CaptionPreset,
	createClipId: (prefix: string) => string
): Clip[] {
	return segments.map((segment) => {
		const clipId = createClipId('caption');
		return {
			id: clipId,
			name: segment.text,
			startTime: segment.startTime,
			duration: segment.duration,
			sourceInstanceId: clipId,
			caption: true,
			textStyle: { ...preset.textStyle },
			visualTransform: { x: 50, y: preset.positionY, scale: 1, rotation: 0, blendMode: 'normal' }
		};
	});
}

// pluggable speech-to-text slot for transcription providers
export type CaptionTranscriber = {
	id: string;
	name: string;
	transcribe: (
		source: { assetId: string; name: string; media: Blob },
		options?: {
			language?: string;
			onProgress?: (progress: number, fileName: string | null) => void;
		}
	) => Promise<CaptionSegment[]>;
};

const registeredTranscribers: CaptionTranscriber[] = [];

export function registerCaptionTranscriber(transcriber: CaptionTranscriber) {
	registeredTranscribers.push(transcriber);
}

export async function transcribeMedia(
	source: { assetId: string; name: string; media: Blob },
	options?: {
		language?: string;
		onProgress?: (progress: number, fileName: string | null) => void;
	}
): Promise<CaptionSegment[]> {
	const transcriber = registeredTranscribers[0];
	if (!transcriber) {
		throw new Error('No speech-to-text provider is configured yet');
	}
	return transcriber.transcribe(source, options);
}
