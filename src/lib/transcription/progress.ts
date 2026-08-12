export type LoadProgressEvent = {
	status?: string;
	file?: string;
	loaded?: number;
	total?: number;
};

export type LoadProgressHandler = (progress: number, fileName: string | null) => void;

// files under this size are setup files (config, tokenizer); only weights drive the main bar
const SMALL_FILE_THRESHOLD = 10_000_000;
const BIG_FILE_START_PERCENT = 10;
const BIG_FILE_DONE_PERCENT = 99;

// aggregate per-file download events into one smooth, monotonic 0-100 percentage.
// small setup files (config, tokenizer) move 0-9%, the model weights move 10-100%,
// and no report ever goes backwards or outside the 0-100 range.
export function createLoadProgressTracker(onProgress: LoadProgressHandler) {
	let smallFileCount = 0;
	let lastPercent = 0;
	let currentFile: string | null = null;
	let currentLoaded = 0;
	let currentTotal = 0;
	let currentIsBig = false;

	function report(percent: number, fileName: string | null) {
		const clamped = Math.max(0, Math.min(100, percent));
		if (clamped < lastPercent) return;
		lastPercent = clamped;
		onProgress(clamped, fileName ?? currentFile);
	}

	function finishCurrentFile() {
		if (currentFile && !currentIsBig) {
			smallFileCount += 1;
		}
		currentFile = null;
		currentLoaded = 0;
		currentTotal = 0;
		currentIsBig = false;
	}

	return (event: LoadProgressEvent) => {
		if (event.status === 'ready') {
			report(100, currentFile);
			return;
		}
		if (event.status === 'done') {
			const fileName = event.file ?? currentFile;
			const finishedBig = currentIsBig;
			finishCurrentFile();
			report(
				finishedBig ? BIG_FILE_DONE_PERCENT : Math.min(BIG_FILE_START_PERCENT - 1, smallFileCount),
				fileName
			);
			return;
		}
		if (event.status === 'initiate' || (event.file && event.file !== currentFile)) {
			finishCurrentFile();
			currentFile = event.file ?? null;
			currentLoaded = 0;
			currentTotal = 0;
		}
		if (typeof event.loaded === 'number') currentLoaded = event.loaded;
		if (typeof event.total === 'number') currentTotal = event.total;
		currentIsBig = currentTotal >= SMALL_FILE_THRESHOLD;
		if (currentIsBig) {
			if (currentTotal > 0) {
				report(BIG_FILE_START_PERCENT + 90 * (currentLoaded / currentTotal), currentFile);
			}
		} else {
			report(Math.min(BIG_FILE_START_PERCENT - 1, smallFileCount), currentFile);
		}
	};
}
