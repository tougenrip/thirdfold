import { describe, expect, it } from 'vitest';
import { distance, lookMetrics, LOOK_HEIGHT, LOOK_WIDTH, oklab, type Image } from './look-metrics';

function image(
	width: number,
	height: number,
	pixel: (x: number, y: number) => [number, number, number]
): Image {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pixel(x, y);
			data.set([r, g, b, 255], (y * width + x) * 4);
		}
	}
	return { data, width, height };
}

describe('look metrics', () => {
	it('see no local contrast or colour in flat grey', () => {
		const m = lookMetrics(image(LOOK_WIDTH, LOOK_HEIGHT, () => [128, 128, 128]));
		expect(m.localContrast).toBeCloseTo(0, 5);
		expect(m.chroma).toBeCloseTo(0, 3);
		expect(m.L.p5).toBeCloseTo(m.L.p95, 5);
		expect(m.vignette).toBeCloseTo(1, 5);
		expect(m.bloom).toBe(0);
	});

	it('read a vignette from a radial ramp', () => {
		const m = lookMetrics(
			image(LOOK_WIDTH, LOOK_HEIGHT, (x, y) => {
				const r = Math.hypot(
					(x - LOOK_WIDTH / 2) / (LOOK_WIDTH / 2),
					(y - LOOK_HEIGHT / 2) / (LOOK_HEIGHT / 2)
				);
				const v = Math.round(230 * Math.max(0, 1 - r * 0.8));
				return [v, v, v];
			})
		);
		expect(m.vignette).toBeLessThan(0.7);
	});

	it('read orange as orange, in shadows and highlights alike', () => {
		const m = lookMetrics(
			image(LOOK_WIDTH, LOOK_HEIGHT, (x) => (x % 2 ? [255, 140, 0] : [120, 66, 0]))
		);
		// Oklab's hue of pure orange is about 60°.
		const [, a, b] = oklab(1, 140 / 255, 0);
		const orange = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
		expect(m.highlights.h).toBeCloseTo(orange, 0);
		expect(Math.abs(m.shadows.h - orange)).toBeLessThan(5);
		expect(m.chroma).toBeGreaterThan(0.1);
	});

	it('crop and scale images of any shape to the same frame', () => {
		const wide = lookMetrics(image(1920, 1080, () => [40, 60, 90]));
		const small = lookMetrics(image(800, 500, () => [40, 60, 90]));
		expect(wide.L.p50).toBeCloseTo(small.L.p50, 5);
	});

	it('put an image at distance 0 from itself, and further from something else', () => {
		const a = lookMetrics(image(800, 500, (x, y) => [(x * 7) % 256, (y * 3) % 256, 90]));
		const b = lookMetrics(image(800, 500, () => [20, 20, 30]));
		expect(distance(a, a)).toBe(0);
		expect(distance(a, b)).toBeGreaterThan(0.1);
		expect(distance(a, b)).toBeLessThanOrEqual(1);
	});
});
