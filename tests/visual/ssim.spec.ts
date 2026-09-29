import { describe, expect, it } from 'vitest';
import { ssim, ssimComparator } from './ssim';

const W = 64;
const H = 48;

/** A test picture: a mid-grey floor with a lighter block and a soft gradient. */
function picture(edge = 20, crease = 1): Uint8Array {
	const px = new Uint8Array(W * H * 4);
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			let v = 80 + x;
			if (x >= edge && x < edge + 16 && y >= 12 && y < 36) v = 200;
			// A crease along one row, darkened by `crease` (1: as drawn).
			if (y === 40 || y === 41) v *= crease;
			px.set([v, v, v, 255], (y * W + x) * 4);
		}
	return px;
}

const image = (data: Uint8Array) => ({ metadata: { width: W, height: H }, data });

describe('the SSIM comparator (#168)', () => {
	it('scores identical images 1', () => {
		expect(ssim(picture(), picture(), W, H).score).toBe(1);
	});

	it('stays above 0.99 for a one-pixel change', () => {
		const changed = picture();
		changed.set([255, 0, 0], (10 * W + 10) * 4);
		expect(ssim(picture(), changed, W, H).score).toBeGreaterThan(0.99);
	});

	it('falls below the threshold for a shifted edge and for a darkened crease', () => {
		const passes = (b: Uint8Array) =>
			ssimComparator(image(picture()), image(b), { createDiff: true }).pass;
		expect(passes(picture(28))).toBe(false);
		expect(passes(picture(20, 0.4))).toBe(false);
		expect(passes(picture())).toBe(true);
	});

	it('draws a diff where the structure changed, and fails on a size mismatch', () => {
		const result = ssimComparator(image(picture()), image(picture(28)), { createDiff: true });
		expect(result.message).toMatch(/Mean SSIM/);
		// The block's old and new places are red in the diff; the far corner is not.
		const red = (x: number, y: number) => result.diff![(y * W + x) * 4];
		const grey = (x: number, y: number) => result.diff![(y * W + x) * 4 + 1];
		expect(red(22, 20) - grey(22, 20)).toBeGreaterThan(50);
		expect(red(60, 2)).toBe(grey(60, 2));
		const small = { metadata: { width: W - 1, height: H }, data: picture() };
		expect(ssimComparator(image(picture()), small, { createDiff: false }).pass).toBe(false);
	});
});
