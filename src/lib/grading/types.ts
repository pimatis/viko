export type ColorWheel = {
	hue: number;
	saturation: number;
	strength: number;
};

export type ColorCurvePoint = {
	x: number;
	y: number;
};

export type ColorCurves = {
	master: ColorCurvePoint[];
	red: ColorCurvePoint[];
	green: ColorCurvePoint[];
	blue: ColorCurvePoint[];
};

export type CurveChannel = keyof ColorCurves;

export type LUTPreset = {
	id: string;
	name: string;
	previewFilter: string;
	apply: (red: number, green: number, blue: number) => [number, number, number];
};

// spatial limit for the secondary correction (a "power window")
// coordinates are normalized 0..100 percent of the frame
export type SecondaryPowerWindow = {
	type: 'full' | 'ellipse' | 'rect';
	cx: number;
	cy: number;
	width: number;
	height: number;
	/** soft-edge feather, 0..100 percent of the window size */
	feather: number;
};

// secondary correction: an HSL qualifier (optionally gated by a power window)
// that lets corrections apply only to a selected color range
export type SecondaryCorrection = {
	enabled: boolean;
	/** qualifier hue center, degrees 0..360 */
	hue: number;
	/** qualifier hue half-width, degrees 1..180 */
	hueRange: number;
	/** qualifier saturation center, 0..100 */
	satCenter: number;
	/** qualifier saturation half-range, 1..100 */
	satRange: number;
	/** qualifier luma center, 0..100 */
	lumaCenter: number;
	/** qualifier luma half-range, 1..100 */
	lumaRange: number;
	/** feather of the key mask boundary, 0..100 */
	softness: number;
	/** how strongly the luma key gates the mask, 0..100 */
	lumaWeight: number;
	/** corrections applied where the mask selects pixels */
	hueShift: number;
	saturation: number;
	brightness: number;
	contrast: number;
	/** overall strength of the secondary pass, 0..100 */
	amount: number;
	window: SecondaryPowerWindow;
};

// reference to a user-imported .cube LUT stored inline in the project
export type CubeLutRef = {
	id: string;
	name: string;
	source: string;
};

export type ColorGrade = {
	shadows: ColorWheel;
	midtones: ColorWheel;
	highlights: ColorWheel;
	master: ColorWheel;
	curves: ColorCurves;
	lutId: string | null;
	customLut: CubeLutRef | null;
	secondary: SecondaryCorrection;
	intensity: number;
};
