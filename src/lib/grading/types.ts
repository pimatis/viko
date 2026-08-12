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

export type ColorGrade = {
	shadows: ColorWheel;
	midtones: ColorWheel;
	highlights: ColorWheel;
	master: ColorWheel;
	curves: ColorCurves;
	lutId: string | null;
	intensity: number;
};
