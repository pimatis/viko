export type DeviceKind = 'mobile' | 'tablet' | 'desktop';

export type PlatformOS = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'other';

export type PointerKind = 'fine' | 'coarse' | 'none';

/**
 * Structured value describing the platform the visitor is using.
 * Detection is heuristic and runs in the browser only; during SSR the
 * returned object safely describes an unknown desktop-like environment.
 */
export type PlatformInfo = {
	device: DeviceKind;
	os: PlatformOS;
	pointer: PointerKind;
	touchPoints: number;
	viewportWidth: number;
	viewportHeight: number;
	reducedMotion: boolean;
};

export function getPlatformInfo(): PlatformInfo {
	const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
	const ua = navigatorRef?.userAgent ?? '';
	const touchPoints = navigatorRef?.maxTouchPoints ?? 0;

	let device: DeviceKind = 'desktop';
	if (/Android/.test(ua)) {
		device = /Mobile/.test(ua) ? 'mobile' : 'tablet';
	} else if (/iPhone|iPod/.test(ua)) {
		device = 'mobile';
	} else if (/iPad/.test(ua) || (/Macintosh|MacIntel/.test(ua) && touchPoints > 1)) {
		// iPadOS 13+ reports as "Macintosh" with a high touch-point count
		device = 'tablet';
	}

	let os: PlatformOS = 'other';
	if (/Macintosh|MacIntel|Mac OS X/.test(ua)) {
		os = device === 'desktop' ? 'macos' : 'ios';
	} else if (/Windows/.test(ua)) {
		os = 'windows';
	} else if (/Android/.test(ua)) {
		os = 'android';
	} else if (/Linux/.test(ua)) {
		os = 'linux';
	}

	let pointer: PointerKind = 'fine';
	if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
		if (window.matchMedia('(pointer: coarse)').matches) {
			pointer = 'coarse';
		} else if (window.matchMedia('(pointer: fine)').matches) {
			pointer = 'fine';
		} else {
			pointer = 'none';
		}
	}

	return {
		device,
		os,
		pointer,
		touchPoints,
		viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
		viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
		reducedMotion:
			typeof window !== 'undefined' && typeof window.matchMedia === 'function'
				? window.matchMedia('(prefers-reduced-motion: reduce)').matches
				: false
	};
}

/**
 * True when the visitor is experiencing the site through a phone or a
 * touch-first tablet — i.e. an environment the desktop editor is not built for.
 */
export function isMobileDevice(): boolean {
	const info = getPlatformInfo();
	return info.device === 'mobile' || info.pointer === 'coarse';
}
