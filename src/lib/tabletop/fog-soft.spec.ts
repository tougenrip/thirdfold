// Soft fog edges, reveal fades and the cloud's shape (#174), as pure mirrors of what the graphs
// draw: softening and fading never lift a cell above its hard factor, a hidden cell stays 0, a
// known cell's centre keeps its value, and fades end on the clock.

import { beforeAll, describe, expect, it } from 'vitest';
import { FOG_LEVELS, fogFactor } from './cell-maps';
import {
	CLOUD_VERTEX_CAP,
	FADE_MS,
	RevealFades,
	cloudDivisions,
	cloudMask,
	edgeShape,
	fogEdge,
	revealFog
} from './fog-soft';

/** The factor for 0-1 visible and explored, as the graph's `levelOf` blends it (player, fog on). */
const level = (v: number, e: number) => {
	const unseen = e * FOG_LEVELS.player.explored;
	return unseen + (1 - unseen) * v;
};
const NOISES = [-1, -0.5, 0, 0.3, 1];
const SAMPLES = Array.from({ length: 21 }, (_, i) => i / 20);

describe('fogEdge', () => {
	it('never exceeds the hard factor, and a hidden cell stays exactly 0', () => {
		for (const [v, e] of [
			[1, 1],
			[0, 1],
			[0, 0]
		])
			for (const sv of SAMPLES)
				for (const se of SAMPLES)
					for (const n of NOISES) {
						const hard = fogFactor(true, 'player', !!v, !!e);
						const soft = fogEdge(hard, level, { visible: sv, explored: se }, n);
						expect(soft).toBeLessThanOrEqual(hard);
						if (!e) expect(soft).toBe(0);
					}
	});

	it('keeps a known cell’s centre at its hard value, whatever the noise', () => {
		for (const n of NOISES) {
			expect(fogEdge(1, level, { visible: 1, explored: 1 }, n)).toBe(1);
			const explored = FOG_LEVELS.player.explored;
			expect(fogEdge(explored, level, { visible: 0, explored: 1 }, n)).toBe(explored);
		}
	});

	it('darkens a band inside a visible cell toward a hidden neighbour, to 0 at the line', () => {
		// Across the half cell from the centre (sample 1) to the line (0.5).
		const across = [1, 0.9, 0.8, 0.7, 0.6, 0.5].map((s) =>
			fogEdge(1, level, { visible: s, explored: s }, 0)
		);
		for (let i = 1; i < across.length; i++) expect(across[i]).toBeLessThanOrEqual(across[i - 1]);
		expect(across[0]).toBe(1);
		expect(across.at(-1)).toBe(0);
		for (const n of NOISES) expect(edgeShape(0.5, n)).toBe(0);
	});
});

describe('revealFog', () => {
	it('goes from where the cell was to where it is, never above it', () => {
		expect(revealFog(1, 0, 1)).toBe(0);
		expect(revealFog(1, 0, 0)).toBe(1);
		expect(revealFog(1, 0.3, 0.5)).toBeCloseTo(0.65);
		// A soft band darker than the old state keeps the band.
		expect(revealFog(0.2, 0.3, 0.5)).toBe(0.2);
	});
});

describe('RevealFades', () => {
	const data = () => new Uint8Array(3 * 4);
	const mask = (...bits: number[]) => new Uint8Array(bits);

	it('fades a newly visible cell from where it came, over FADE_MS, then stops', () => {
		const f = new RevealFades();
		const d = data();
		f.update(mask(1, 0, 0), mask(1, 1, 0), 0);
		expect(f.pending).toBe(false); // nothing before: nothing fades
		f.update(mask(1, 1, 1), mask(1, 1, 1), 1000);
		expect(f.pack(d, 1000)).toBe(true);
		expect([...d]).toEqual([0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 0]);
		f.pack(d, 1000 + FADE_MS / 2);
		expect(d[6]).toBe(128);
		expect(f.pack(d, 1000 + FADE_MS)).toBe(false);
		expect(d[6]).toBe(0);
		expect(d[10]).toBe(0);
		expect(f.pending).toBe(false);
	});

	it('loses sight at once, and fades nothing under reduced motion', () => {
		const f = new RevealFades();
		const d = data();
		f.update(mask(0, 0, 0), mask(0, 0, 0), 0);
		f.update(mask(1, 0, 0), mask(1, 0, 0), 10);
		f.pack(d, 10);
		expect(d[2]).toBe(255);
		f.update(mask(0, 0, 0), mask(1, 0, 0), 20);
		expect(f.pack(d, 20)).toBe(false);
		expect(d[2]).toBe(0);
		f.setReducedMotion(true);
		f.update(mask(1, 1, 1), mask(1, 1, 1), 30);
		expect(f.pending).toBe(false);
		expect([...d].every((b) => b === 0)).toBe(true);
	});

	it('forgets the masks on reset: the next update fades nothing', () => {
		const f = new RevealFades();
		f.update(mask(0, 0, 0), null, 0);
		f.reset();
		f.update(mask(1, 1, 1), null, 5);
		expect(f.pending).toBe(false);
	});
});

describe('the cloud’s shape', () => {
	it('stays within the vertex cap', () => {
		for (const [w, h] of [
			[4, 4],
			[36, 28],
			[48, 36],
			[64, 64]
		]) {
			const k = cloudDivisions(w, h);
			expect((w * k + 1) * (h * k + 1)).toBeLessThanOrEqual(CLOUD_VERTEX_CAP);
			expect(k).toBeGreaterThanOrEqual(1);
		}
		expect(cloudDivisions(4, 4)).toBe(4);
	});

	it('rises over hidden cells and meets explored ground halfway across the edge', () => {
		// Two cells: explored, then hidden; two divisions a cell, 5 x 3 vertices.
		const m = cloudMask(2, 1, 2, [1, 0]);
		expect(m.length).toBe(15);
		const row = [...m.slice(0, 5)];
		expect(row).toEqual([0, 0, 0.5, 1, 1]);
		expect([...m.slice(5, 10)]).toEqual(row);
	});
});

describe('the cloud’s drift', () => {
	// Transformed once off the test's clock: a busy full run can take seconds over the first import.
	beforeAll(async () => {
		await import('./fog-cloud');
	}, 60_000);

	const grid = { kind: 'square' as const, cellSize: 1, width: 4, height: 4 };
	const fog = { enabled: true, shared: false, visible: '', explored: '' };

	it('drifts only while shown to a player and not held still, a capped step a frame', async () => {
		const { FogCloudLayer, cloudTime } = await import('./fog-cloud');
		const cloud = new FogCloudLayer();
		const drifts = (now: number) => [cloud.tick(now), cloudTime.value] as const;
		cloud.update(grid, fog, 'player');
		expect(drifts(0)[0], 'layer off').toBe(false);
		cloud.setLayer(true, false);
		cloud.update(grid, fog, 'gm');
		expect(drifts(0)[0], 'the GM').toBe(false);
		cloud.update(grid, fog, 'player');
		const t0 = cloudTime.value;
		expect(drifts(0)).toEqual([true, t0]);
		expect(drifts(100)).toEqual([true, t0 + 0.1]);
		expect(drifts(60_000)[1], 'a long gap moves it half a second').toBeCloseTo(t0 + 0.6);
		for (const hold of [
			() => cloud.setLayer(true, true),
			() => cloud.setReducedMotion(true),
			() => cloud.setPowerSaver(true)
		]) {
			hold();
			const before = cloudTime.value;
			expect(drifts(61_000)).toEqual([false, before]);
			expect(drifts(62_000)).toEqual([false, before]);
			cloud.setLayer(true, false);
			cloud.setReducedMotion(false);
			cloud.setPowerSaver(false);
		}
		cloud.dispose();
	});
});
