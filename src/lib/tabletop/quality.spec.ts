import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GRAPHICS,
	layersFrom,
	loadGraphics,
	pixelRatioFor,
	qualityFor,
	REFINE_SAMPLES,
	refineTier,
	saveGraphics,
	settingsFor,
	startingTier,
	tierAfterLoss,
	tierFrom,
	type Caps
} from './quality';

const desktop: Caps = {
	backend: 'webgpu',
	software: false,
	vendor: 'nvidia',
	architecture: 'lovelace',
	maxTextureSize: 16384,
	timestampQuery: true,
	mobile: false,
	shell: 'browser',
	dpr: 1,
	screenPixels: 1920 * 1080,
	deviceMemory: 8
};

const storage = (value: string | null) => {
	const store = new Map<string, string>(value === null ? [] : [['thirdfold:graphics', value]]);
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v)
	};
};

describe('the starting tier', () => {
	it('is low on software rasterisers and compat WebGPU', () => {
		expect(qualityFor({ ...desktop, software: true })).toBe('low');
		expect(qualityFor({ ...desktop, backend: 'webgpu-compat' })).toBe('low');
	});

	it('is high on a discrete GPU, medium on an integrated one, never ultra', () => {
		expect(qualityFor(desktop)).toBe('high');
		expect(qualityFor({ ...desktop, vendor: 'intel', architecture: 'gen-12lp' })).toBe('medium');
		expect(qualityFor({ ...desktop, backend: 'webgl2' })).toBe('high');
	});

	it('is low or medium on phones by memory', () => {
		expect(qualityFor({ ...desktop, mobile: true, deviceMemory: 4 })).toBe('low');
		expect(qualityFor({ ...desktop, mobile: true, deviceMemory: 8 })).toBe('medium');
	});

	it('keeps to the shell and backend ceilings', () => {
		expect(qualityFor({ ...desktop, shell: 'capacitor-android' })).toBe('medium');
		expect(settingsFor('ultra', 'webgl2').tier).toBe('high');
		expect(settingsFor('ultra', 'webgpu').tier).toBe('ultra');
	});

	it('follows ?tier=, then the choice, then what was measured, then the device', () => {
		expect(startingTier('?tier=low', { ...DEFAULT_GRAPHICS, tier: 'high' }, desktop)).toBe('low');
		expect(startingTier('', { ...DEFAULT_GRAPHICS, tier: 'medium' }, desktop)).toBe('medium');
		expect(startingTier('', { ...DEFAULT_GRAPHICS, measured: 'medium' }, desktop)).toBe('medium');
		expect(startingTier('', DEFAULT_GRAPHICS, desktop)).toBe('high');
	});
});

describe('the URL switches', () => {
	it('read ?tier= and ignore anything else', () => {
		expect(tierFrom('?tier=high')).toBe('high');
		expect(tierFrom('?tier=epic')).toBeNull();
		expect(tierFrom('')).toBeNull();
	});

	it('turn ?off= layers off and ignore unknown names', () => {
		const layers = { ...settingsFor('high', 'webgpu').layers, sky: true, grass: true };
		const off = layersFrom('?off=sky,nonsense', layers);
		expect(off.sky).toBe(false);
		expect(off.grass).toBe(true);
		expect(layersFrom('', layers)).toBe(layers);
	});
});

describe('the pixel cap', () => {
	it('keeps 4K at DPR 2 on medium within 2.1 MP', () => {
		const ratio = pixelRatioFor(3840, 2160, 2, settingsFor('medium', 'webgpu').megapixels);
		expect(3840 * ratio * (2160 * ratio)).toBeLessThanOrEqual(2.1e6 + 1);
	});

	it("keeps the device's ratio where it fits", () => {
		expect(pixelRatioFor(800, 500, 2, 3.7)).toBe(2);
		expect(pixelRatioFor(0, 0, 1.5, 1)).toBe(1.5);
	});
});

describe('refining the tier', () => {
	const slow = Array.from({ length: REFINE_SAMPLES }, () => 40);
	const fast = Array.from({ length: REFINE_SAMPLES }, () => 5);

	it('steps down once when frames run over budget, never up, never below low', () => {
		expect(refineTier('high', slow, 16.7)).toBe('medium');
		expect(refineTier('medium', fast, 16.7)).toBe('medium');
		expect(refineTier('low', slow, 33.3)).toBe('low');
	});

	it('waits for enough frames', () => {
		expect(refineTier('high', slow.slice(1), 16.7)).toBe('high');
	});
});

describe('the saved graphics settings', () => {
	it('come back after a save', () => {
		const s = storage(null);
		const prefs = {
			tier: 'medium',
			compatibility: true,
			powerSaver: false,
			toneMapper: 'agx',
			measured: 'low'
		} as const;
		saveGraphics(s, prefs);
		expect(loadGraphics(s)).toEqual(prefs);
	});

	it('fall back to auto on junk, field by field, without throwing', () => {
		expect(loadGraphics(storage('not json'))).toEqual(DEFAULT_GRAPHICS);
		expect(loadGraphics(storage('{"tier":"epic","compatibility":true,"toneMapper":"x"}'))).toEqual({
			...DEFAULT_GRAPHICS,
			compatibility: true
		});
		const broken = { getItem: () => ({}) as string };
		expect(loadGraphics(broken)).toEqual(DEFAULT_GRAPHICS);
	});
});

describe('after the graphics device is lost', () => {
	it('drops a tier for the session, then to low, then stops', () => {
		expect(tierAfterLoss('high', [0], 0)).toBe('medium');
		expect(tierAfterLoss('low', [0], 0)).toBe('low');
		expect(tierAfterLoss('high', [0, 120_000], 120_000)).toBe('low');
		expect(tierAfterLoss('medium', [0, 400_000], 400_000)).toBe('low');
		expect(tierAfterLoss('high', [0, 20_000, 40_000], 40_000)).toBe('stop');
	});

	it('forgets losses older than five minutes', () => {
		expect(tierAfterLoss('high', [0, 400_000], 400_000 + 301_000)).toBe('medium');
	});
});
