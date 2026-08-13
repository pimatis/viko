// real-time signal analysis for the color scopes panel. the analysis runs on a
// low-resolution composed frame so it can update live while the playhead moves.

export type BandStats = {
	red: number;
	green: number;
	blue: number;
	luma: number;
};

export type FrameStats = {
	shadows: BandStats;
	midtones: BandStats;
	highlights: BandStats;
};

export type ScopeHistogram = {
	red: number[];
	green: number[];
	blue: number[];
	luma: number[];
};

export type ScopeWaveform = {
	columns: number;
	min: Float32Array;
	max: Float32Array;
	average: Float32Array;
};

export type ScopeParade = {
	columns: number;
	red: { min: Float32Array; max: Float32Array };
	green: { min: Float32Array; max: Float32Array };
	blue: { min: Float32Array; max: Float32Array };
};

export type ScopeAnalysis = {
	width: number;
	height: number;
	histogram: ScopeHistogram;
	waveform: ScopeWaveform;
	parade: ScopeParade;
	vectorscope: { buckets: Float32Array; size: number; count: number };
	stats: FrameStats;
};

const HISTOGRAM_BINS = 256;
const VECTORSCOPE_GRID = 96;
const WAVEFORM_COLUMNS = 160;
const SHADOW_THRESHOLD = 1 / 3;
const HIGHLIGHT_THRESHOLD = 2 / 3;

function lumaOf(red: number, green: number, blue: number): number {
	return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function emptyWaveform(columns: number): ScopeWaveform {
	const min = new Float32Array(columns).fill(1);
	const max = new Float32Array(columns);
	const average = new Float32Array(columns);
	return { columns, min, max, average };
}

function emptyParade(columns: number): ScopeParade {
	return {
		columns,
		red: { min: new Float32Array(columns).fill(1), max: new Float32Array(columns) },
		green: { min: new Float32Array(columns).fill(1), max: new Float32Array(columns) },
		blue: { min: new Float32Array(columns).fill(1), max: new Float32Array(columns) }
	};
}

function accumulateBand(
	stats: FrameStats,
	band: keyof FrameStats,
	red: number,
	green: number,
	blue: number,
	luma: number,
	counts: { red: number; green: number; blue: number; luma: number }
) {
	const target = stats[band];
	target.red += red;
	target.green += green;
	target.blue += blue;
	target.luma += luma;
	counts.red += 1;
	counts.green += 1;
	counts.blue += 1;
	counts.luma += 1;
}

function finalizeBand(band: BandStats, count: number): BandStats {
	if (count <= 0) return band;
	band.red /= count;
	band.green /= count;
	band.blue /= count;
	band.luma /= count;
	return band;
}

// analyze a composed frame into per-pixel scope data + band statistics.
// band statistics are used by shot matching to derive color adjustments.
export function computeBandStats(imageData: ImageData): FrameStats {
	const data = imageData.data;
	const stats: FrameStats = {
		shadows: { red: 0, green: 0, blue: 0, luma: 0 },
		midtones: { red: 0, green: 0, blue: 0, luma: 0 },
		highlights: { red: 0, green: 0, blue: 0, luma: 0 }
	};
	const counts = {
		shadows: { red: 0, green: 0, blue: 0, luma: 0 },
		midtones: { red: 0, green: 0, blue: 0, luma: 0 },
		highlights: { red: 0, green: 0, blue: 0, luma: 0 }
	};
	for (let offset = 0; offset < data.length; offset += 4) {
		const red = data[offset] / 255;
		const green = data[offset + 1] / 255;
		const blue = data[offset + 2] / 255;
		const luma = lumaOf(red, green, blue);
		const band =
			luma < SHADOW_THRESHOLD ? 'shadows' : luma > HIGHLIGHT_THRESHOLD ? 'highlights' : 'midtones';
		accumulateBand(stats, band, red, green, blue, luma, counts[band]);
	}
	return {
		shadows: finalizeBand(stats.shadows, counts.shadows.luma),
		midtones: finalizeBand(stats.midtones, counts.midtones.luma),
		highlights: finalizeBand(stats.highlights, counts.highlights.luma)
	};
}

export function analyzeFrame(imageData: ImageData): ScopeAnalysis {
	const data = imageData.data;
	const width = imageData.width;
	const height = imageData.height;

	const histogram: ScopeHistogram = {
		red: new Array(HISTOGRAM_BINS).fill(0),
		green: new Array(HISTOGRAM_BINS).fill(0),
		blue: new Array(HISTOGRAM_BINS).fill(0),
		luma: new Array(HISTOGRAM_BINS).fill(0)
	};

	const waveform = emptyWaveform(WAVEFORM_COLUMNS);
	const parade = emptyParade(WAVEFORM_COLUMNS);

	const vectorscopeSize = VECTORSCOPE_GRID;
	const buckets = new Float32Array(vectorscopeSize * vectorscopeSize);
	let vectorCount = 0;

	for (let row = 0; row < height; row += 1) {
		for (let column = 0; column < width; column += 1) {
			const offset = (row * width + column) * 4;
			const red = data[offset] / 255;
			const green = data[offset + 1] / 255;
			const blue = data[offset + 2] / 255;
			const luma = lumaOf(red, green, blue);

			const lumaBin = Math.min(HISTOGRAM_BINS - 1, Math.round(luma * (HISTOGRAM_BINS - 1)));
			histogram.luma[lumaBin] += 1;
			histogram.red[Math.min(HISTOGRAM_BINS - 1, Math.round(red * (HISTOGRAM_BINS - 1)))] += 1;
			histogram.green[Math.min(HISTOGRAM_BINS - 1, Math.round(green * (HISTOGRAM_BINS - 1)))] += 1;
			histogram.blue[Math.min(HISTOGRAM_BINS - 1, Math.round(blue * (HISTOGRAM_BINS - 1)))] += 1;

			const waveColumn = Math.min(
				WAVEFORM_COLUMNS - 1,
				Math.floor((column / width) * WAVEFORM_COLUMNS)
			);
			if (luma < waveform.min[waveColumn]) waveform.min[waveColumn] = luma;
			if (luma > waveform.max[waveColumn]) waveform.max[waveColumn] = luma;
			waveform.average[waveColumn] += luma;

			// parade accumulates per channel so rows are sampled evenly
			const redValue = red;
			const greenValue = green;
			const blueValue = blue;
			if (redValue < parade.red.min[waveColumn]) parade.red.min[waveColumn] = redValue;
			if (redValue > parade.red.max[waveColumn]) parade.red.max[waveColumn] = redValue;
			if (greenValue < parade.green.min[waveColumn]) parade.green.min[waveColumn] = greenValue;
			if (greenValue > parade.green.max[waveColumn]) parade.green.max[waveColumn] = greenValue;
			if (blueValue < parade.blue.min[waveColumn]) parade.blue.min[waveColumn] = blueValue;
			if (blueValue > parade.blue.max[waveColumn]) parade.blue.max[waveColumn] = blueValue;

			// vectorscope: (B-Y, R-Y) scaled into a square grid
			const u = blue - luma;
			const v = red - luma;
			const bucketX = Math.min(
				vectorscopeSize - 1,
				Math.max(0, Math.floor((u * 0.5 + 0.5) * vectorscopeSize))
			);
			const bucketY = Math.min(
				vectorscopeSize - 1,
				Math.max(0, Math.floor((v * 0.5 + 0.5) * vectorscopeSize))
			);
			buckets[bucketY * vectorscopeSize + bucketX] += 1;
			vectorCount += 1;
		}
	}

	for (let column = 0; column < WAVEFORM_COLUMNS; column += 1) {
		waveform.average[column] /= height;
		if (waveform.min[column] > waveform.max[column]) waveform.min[column] = 0;
	}

	return {
		width,
		height,
		histogram,
		waveform,
		parade,
		vectorscope: { buckets, size: vectorscopeSize, count: vectorCount },
		stats: computeBandStats(imageData)
	};
}
