export const TRANSCRIBE_SAMPLE_RATE = 16_000;
// media longer than this is rejected before decoding (about 15 minutes of audio)
const MAX_TRANSCRIBE_DURATION_SECONDS = 15 * 60;

// decode a media blob into a mono 16kHz sample buffer for speech models
export async function decodeMediaToMono16k(blob: Blob): Promise<Float32Array> {
	const arrayBuffer = await blob.arrayBuffer();
	const audioContext = new AudioContext();
	let audioBuffer: AudioBuffer;
	try {
		audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
	} catch {
		throw new Error('This media has no decodable audio track');
	} finally {
		void audioContext.close();
	}
	if (audioBuffer.duration > MAX_TRANSCRIBE_DURATION_SECONDS) {
		throw new Error(
			`Media is longer than ${MAX_TRANSCRIBE_DURATION_SECONDS / 60} minutes, trim it before transcribing`
		);
	}
	const frameCount = Math.ceil(audioBuffer.duration * TRANSCRIBE_SAMPLE_RATE);
	const offlineContext = new OfflineAudioContext(1, frameCount, TRANSCRIBE_SAMPLE_RATE);
	const source = offlineContext.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(offlineContext.destination);
	source.start(0);
	const rendered = await offlineContext.startRendering();
	return rendered.getChannelData(0);
}
