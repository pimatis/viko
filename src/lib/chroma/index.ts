import type { ChromaKey, ChromaKeyState } from '$lib/editor/timeline';

// shared chroma key model used by the WebGL preview path and the export pixel pipeline

export const DEFAULT_CHROMA_KEY: ChromaKey = {
	enabled: true,
	keyColor: '#00ff00',
	similarity: 40,
	smoothness: 10,
	spillSuppression: 50
};

export const CHROMA_MAX_CHROMA_DISTANCE = 0.754;

export function clampChromaSimilarity(value: number): number {
	return Math.min(100, Math.max(0, Number.isFinite(value) ? value : DEFAULT_CHROMA_KEY.similarity));
}

export function clampChromaSmoothness(value: number): number {
	return Math.min(100, Math.max(0, Number.isFinite(value) ? value : DEFAULT_CHROMA_KEY.smoothness));
}

export function clampChromaSpill(value: number): number {
	return Math.min(
		100,
		Math.max(0, Number.isFinite(value) ? value : DEFAULT_CHROMA_KEY.spillSuppression)
	);
}

export function isChromaKeyActive(config: ChromaKey | undefined): boolean {
	return Boolean(config?.enabled);
}

export function hexToRgb01(hex: string): [number, number, number] | null {
	const match = hex.match(/^#([0-9a-f]{6})$/i);
	if (!match) return null;
	const channels = match[1];
	const red = parseInt(channels.slice(0, 2), 16) / 255;
	const green = parseInt(channels.slice(2, 4), 16) / 255;
	const blue = parseInt(channels.slice(4, 6), 16) / 255;
	return [red, green, blue];
}

// Rec.601 chroma coordinates used by both renderers so preview and export match
function rgbToYuv(red: number, green: number, blue: number): [number, number, number] {
	const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
	return [luma, 0.492 * (blue - luma), 0.877 * (red - luma)];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

// deterministic pixel keying shared with the export pipeline
export function applyChromaKey(imageData: ImageData, config: ChromaKeyState): void {
	const keyRgb = hexToRgb01(config.keyColor);
	if (!keyRgb) return;
	const keyYuv = rgbToYuv(keyRgb[0], keyRgb[1], keyRgb[2]);
	const similarity = config.similarity / 100;
	const smoothness = config.smoothness / 100;
	const spill = config.spill / 100;
	const data = imageData.data;

	for (let offset = 0; offset < data.length; offset += 4) {
		const red = data[offset] / 255;
		const green = data[offset + 1] / 255;
		const blue = data[offset + 2] / 255;
		const yuv = rgbToYuv(red, green, blue);
		const chromaDistance =
			Math.hypot(yuv[1] - keyYuv[1], yuv[2] - keyYuv[2]) / CHROMA_MAX_CHROMA_DISTANCE;
		const alpha = smoothstep(similarity, similarity + smoothness, chromaDistance);
		const despill = Math.min(1, Math.max(0, spill * (1 - alpha)));
		const suppressedGreen = Math.min(green, Math.max(red, blue));

		data[offset] = Math.round(red * 255);
		data[offset + 1] = Math.round((green + (suppressedGreen - green) * despill) * 255);
		data[offset + 2] = Math.round(blue * 255);
		data[offset + 3] = Math.round(alpha * 255);
	}
}

// WebGL preview path - same math as applyChromaKey, executed on the GPU

const CHROMA_VERTEX_SHADER = `
attribute vec2 aPosition;
uniform vec2 uContainScale;
varying vec2 vTexCoord;
void main() {
	vTexCoord = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition * uContainScale, 0.0, 1.0);
}
`;

const CHROMA_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D uImage;
uniform vec3 uKeyColor;
uniform float uSimilarity;
uniform float uSmoothness;
uniform float uSpill;

vec3 rgbToYuv(vec3 rgb) {
	float y = dot(rgb, vec3(0.299, 0.587, 0.114));
	return vec3(y, 0.492 * (rgb.b - y), 0.877 * (rgb.r - y));
}

void main() {
	vec4 color = texture2D(uImage, vTexCoord);
	vec3 yuv = rgbToYuv(color.rgb);
	vec3 keyYuv = rgbToYuv(uKeyColor);
	float chromaDistance = length((yuv - keyYuv) * vec3(0.0, 1.0, 1.0)) / 0.754;
	float alpha = smoothstep(uSimilarity, uSimilarity + uSmoothness, chromaDistance);
	float despill = clamp(uSpill * (1.0 - alpha), 0.0, 1.0);
	float green = mix(color.g, min(color.g, max(color.r, color.b)), despill);
	gl_FragColor = vec4(color.r, green, color.b, alpha);
}
`;

export type ChromaKeyGL = {
	gl: WebGLRenderingContext;
	program: WebGLProgram;
	texture: WebGLTexture;
	positionBuffer: WebGLBuffer;
	canvasWidth: number;
	canvasHeight: number;
	textureWidth: number;
	textureHeight: number;
};

export function createChromaKeyGL(canvas: HTMLCanvasElement): ChromaKeyGL | null {
	const gl = canvas.getContext('webgl', {
		alpha: true,
		premultipliedAlpha: true,
		preserveDrawingBuffer: false,
		antialias: false
	});
	if (!gl) return null;

	const program = createProgram(gl);
	if (!program) return null;

	const texture = gl.createTexture();
	const positionBuffer = gl.createBuffer();
	if (!texture || !positionBuffer) return null;

	const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

	const aPosition = gl.getAttribLocation(program, 'aPosition');
	gl.enableVertexAttribArray(aPosition);
	gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

	gl.useProgram(program);
	gl.uniform1i(gl.getUniformLocation(program, 'uImage'), 0);

	return {
		gl,
		program,
		texture,
		positionBuffer,
		canvasWidth: 0,
		canvasHeight: 0,
		textureWidth: 0,
		textureHeight: 0
	};
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
	const vertexShader = compileShader(gl, gl.VERTEX_SHADER, CHROMA_VERTEX_SHADER);
	const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, CHROMA_FRAGMENT_SHADER);
	if (!vertexShader || !fragmentShader) return null;

	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return null;
	}
	return program;
}

function compileShader(
	gl: WebGLRenderingContext,
	type: number,
	source: string
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

export function drawChromaKeyFrame(
	state: ChromaKeyGL,
	source: HTMLVideoElement | HTMLImageElement,
	config: ChromaKeyState
): void {
	const gl = state.gl;
	const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
	const sourceHeight =
		source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
	if (sourceWidth <= 0 || sourceHeight <= 0) return;

	const canvas = gl.canvas as HTMLCanvasElement;
	const canvasWidth = canvas.clientWidth > 0 ? canvas.clientWidth : canvas.width;
	const canvasHeight = canvas.clientHeight > 0 ? canvas.clientHeight : canvas.height;
	if (
		canvasWidth !== state.canvasWidth ||
		canvasHeight !== state.canvasHeight ||
		sourceWidth !== state.textureWidth ||
		sourceHeight !== state.textureHeight
	) {
		gl.viewport(0, 0, canvasWidth, canvasHeight);
		state.canvasWidth = canvasWidth;
		state.canvasHeight = canvasHeight;
		state.textureWidth = sourceWidth;
		state.textureHeight = sourceHeight;
	}

	gl.useProgram(state.program);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.positionBuffer);

	const keyRgb = hexToRgb01(config.keyColor) ?? [0, 1, 0];
	gl.uniform3f(gl.getUniformLocation(state.program, 'uKeyColor'), keyRgb[0], keyRgb[1], keyRgb[2]);
	gl.uniform1f(gl.getUniformLocation(state.program, 'uSimilarity'), config.similarity / 100);
	gl.uniform1f(gl.getUniformLocation(state.program, 'uSmoothness'), config.smoothness / 100);
	gl.uniform1f(gl.getUniformLocation(state.program, 'uSpill'), config.spill / 100);

	const canvasAspect = canvasWidth / canvasHeight;
	const sourceAspect = sourceWidth / sourceHeight;
	const containScale =
		sourceAspect > canvasAspect
			? { x: 1, y: canvasAspect / sourceAspect }
			: { x: sourceAspect / canvasAspect, y: 1 };
	gl.uniform2f(
		gl.getUniformLocation(state.program, 'uContainScale'),
		containScale.x,
		containScale.y
	);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, state.texture);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function destroyChromaKeyGL(state: ChromaKeyGL): void {
	const gl = state.gl;
	gl.deleteTexture(state.texture);
	gl.deleteBuffer(state.positionBuffer);
	gl.deleteProgram(state.program);
}
