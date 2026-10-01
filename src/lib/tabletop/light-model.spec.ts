import { describe, expect, it } from 'vitest';
import { fitShadowFrustum, lightBasis, type ShadowBounds } from './light-model';

// ---------------------------------------------------------------------------------------------
// The sun and moon's shadow box (#229)
// ---------------------------------------------------------------------------------------------

type V3 = [number, number, number];
const RAD = Math.PI / 180;
const toward = (azimuth: number, elevation: number): V3 => [
	Math.cos(elevation * RAD) * Math.cos(azimuth * RAD),
	Math.sin(elevation * RAD),
	Math.cos(elevation * RAD) * Math.sin(azimuth * RAD)
];

/** A 64×64 table of 1 m cells, walls 3 m above a floor raised 2 m: the box the renderer fits. */
const bounds: ShadowBounds = { min: [-32, 0, -32], max: [32, 5, 32] };
const center: V3 = [0, 2.5, 0];
const reach = 2 * Math.hypot(32, 2.5, 32);
const eyeFor = (dir: V3): V3 => [dir[0] * reach, center[1] + dir[1] * reach, dir[2] * reach];

function corners(b: ShadowBounds): V3[] {
	return Array.from({ length: 8 }, (_, i) => [
		i & 1 ? b.max[0] : b.min[0],
		i & 2 ? b.max[1] : b.min[1],
		i & 4 ? b.max[2] : b.min[2]
	]);
}

describe('fitShadowFrustum', () => {
	it('holds every grid corner and wall top for the light from any direction', () => {
		for (let elevation = 12; elevation <= 90; elevation += 6) {
			for (let azimuth = 0; azimuth < 360; azimuth += 15) {
				const eye = eyeFor(toward(azimuth, elevation));
				const f = fitShadowFrustum(bounds, eye, center, 2048);
				const { x, y, z } = lightBasis(eye, center);
				for (const p of corners(bounds)) {
					const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
					const dot = (a: readonly number[]) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2];
					const at = `${azimuth}° ${elevation}°`;
					expect(dot(x), at).toBeGreaterThanOrEqual(f.left);
					expect(dot(x), at).toBeLessThanOrEqual(f.right);
					expect(dot(y), at).toBeGreaterThanOrEqual(f.bottom);
					expect(dot(y), at).toBeLessThanOrEqual(f.top);
					expect(-dot(z), at).toBeGreaterThan(f.near);
					expect(-dot(z), at).toBeLessThan(f.far);
				}
			}
		}
	});

	it('gives the 64×64 table at least 20 texels a cell on a 2048 map', () => {
		for (let azimuth = 0; azimuth < 360; azimuth += 5) {
			const f = fitShadowFrustum(bounds, eyeFor(toward(azimuth, 12)), center, 2048);
			expect(2048 / Math.max(f.right - f.left, f.top - f.bottom)).toBeGreaterThanOrEqual(20);
		}
	});

	it('keeps the same box, on whole texels, while the light turns a tenth of a degree', () => {
		let same = 0;
		let steps = 0;
		for (let azimuth = 30; azimuth < 60; azimuth += 0.1) {
			const a = fitShadowFrustum(bounds, eyeFor(toward(azimuth, 40)), center, 2048);
			const b = fitShadowFrustum(bounds, eyeFor(toward(azimuth + 0.1, 40)), center, 2048);
			const texel = (a.right - a.left) / 2048;
			// The box's centre sits on a texel corner.
			const mid = (a.left + a.right) / 2 / texel;
			expect(Math.abs(mid - Math.round(mid))).toBeLessThan(1e-6);
			steps++;
			if (a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom)
				same++;
		}
		// The size steps by half a cell: almost every tenth of a degree keeps it.
		expect(same / steps).toBeGreaterThan(0.9);
	});
});
