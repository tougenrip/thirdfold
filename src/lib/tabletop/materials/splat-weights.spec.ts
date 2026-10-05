import { describe, expect, it } from 'vitest';
import { FLOOR_IDS, VOID, type FloorId } from '../../game/floor';
import {
	FLOOR_STYLE,
	heightShare,
	KERB,
	SOFT,
	SPLAT,
	splatWeights,
	type Corner
} from './splat-weights';

const F = (id: FloorId) => FLOOR_IDS.indexOf(id);
const c = (id: FloorId, level = 0, known = true): Corner => ({ floor: F(id), level, known });
const four = (a: Corner, b: Corner, d: Corner, e: Corner) => [a, b, d, e] as const;

/** A seeded spread of points in a cell and noise values. */
function* samples(n = 400) {
	let s = 7;
	const r = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 1;
	for (let i = 0; i < n; i++)
		yield { q: { x: r(), y: r() }, noise: { x: r() * 2 - 1, y: r() * 2 - 1 } };
}

describe('the floor splat (#242)', () => {
	it('keeps soft floors soft and man-made ones kerbed, the void and water crisp', () => {
		expect(FLOOR_STYLE.grass).toBe(SOFT);
		expect(FLOOR_STYLE.stone).toBe(KERB);
		expect(FLOOR_STYLE.wood).toBe(KERB);
		expect(FLOOR_STYLE.void).not.toBe(SOFT);
		expect(FLOOR_STYLE.water).not.toBe(SOFT);
		expect(SPLAT.heightRange).toBeLessThan(1 - SPLAT.depth);
		// #248: cobble, flagstone and rock kerbed; mud, snow and gravel soft.
		for (const id of ['cobble', 'flagstone', 'rock', 'tile', 'grating'] as const)
			expect(FLOOR_STYLE[id]).toBe(KERB);
		for (const id of ['mud', 'snow', 'gravel'] as const) expect(FLOOR_STYLE[id]).toBe(SOFT);
		const edge = { x: 0.99, y: 0.5 };
		expect(
			splatWeights(four(c('mud'), c('snow'), c('mud'), c('mud')), edge).weights[1]
		).toBeGreaterThan(0);
		expect(
			splatWeights(four(c('cobble'), c('gravel'), c('cobble'), c('cobble')), edge).kerb.x
		).toBe(1);
	});

	it('weights sum to 1, the heavier first', () => {
		const corners = four(c('grass'), c('dirt'), c('sand'), c('plain'));
		for (const { q, noise } of samples()) {
			const { weights } = splatWeights(corners, q, noise);
			expect(weights[0] + weights[1]).toBeCloseTo(1, 12);
			expect(weights[0]).toBeGreaterThanOrEqual(weights[1]);
			expect(Math.min(...weights)).toBeGreaterThanOrEqual(0);
		}
	});

	it('takes the one-layer fast path where all four agree', () => {
		for (const { q, noise } of samples(50)) {
			const s = splatWeights(four(c('grass'), c('grass'), c('grass'), c('grass')), q, noise);
			expect(s.floors).toEqual([F('grass'), F('grass')]);
			expect(s.weights).toEqual([1, 0]);
		}
	});

	it('blends soft borders evenly on the grid line and lets noise move them', () => {
		const corners = four(c('grass'), c('dirt'), c('grass'), c('dirt'));
		// On the line between the cells, half and half; without noise, all grass at the centre.
		const line = splatWeights(corners, { x: 1, y: 0.5 });
		expect(line.weights[0]).toBeCloseTo(0.5, 12);
		expect(splatWeights(corners, { x: 0.5, y: 0.5 }).weights).toEqual([1, 0]);
		// Noise pushes the border into the cell or back by at most `reach`.
		const into = splatWeights(corners, { x: 0.9, y: 0.5 }, { x: 1, y: 0 });
		expect(into.floors[0]).toBe(F('dirt'));
		const back = splatWeights(corners, { x: 0.9, y: 0.5 }, { x: -1, y: 0 });
		expect(back.floors[0]).toBe(F('grass'));
		// Noise never moves anything at a cell's centre lines: the blocks either side agree.
		const centre = splatWeights(corners, { x: 0.5, y: 0.3 }, { x: 1, y: 1 });
		expect(centre.weights).toEqual([1, 0]);
	});

	it('is the same weights seen from either side of a soft border', () => {
		// Grass at x, dirt at x + 1: points a hair either side of the line, seen from each cell.
		for (const n of [-1, -0.4, 0, 0.7, 1])
			for (const e of [1e-9]) {
				const left = splatWeights(
					four(c('grass'), c('dirt'), c('grass'), c('dirt')),
					{ x: 1 - e, y: 0.5 },
					{ x: n, y: 0 }
				);
				const right = splatWeights(
					four(c('dirt'), c('grass'), c('dirt'), c('grass')),
					{ x: e, y: 0.5 },
					{ x: n, y: 0 }
				);
				const dirt = (s: typeof left) => (s.floors[0] === F('dirt') ? s.weights[0] : s.weights[1]);
				expect(dirt(left)).toBeCloseTo(dirt(right), 6);
			}
	});

	it('snaps any border with a hard floor to the grid line, with a kerb on the man-made side', () => {
		for (const { q, noise } of samples()) {
			const stone = splatWeights(four(c('stone'), c('grass'), c('grass'), c('grass')), q, noise);
			expect(stone.floors[0]).toBe(F('stone'));
			expect(stone.weights[0]).toBe(1);
			const grass = splatWeights(four(c('grass'), c('stone'), c('stone'), c('stone')), q, noise);
			expect(grass.weights[0]).toBe(1);
			expect(grass.kerb).toEqual({ x: 0, y: 0 }); // the kerb is stone's, inside its cell
			const water = splatWeights(four(c('grass'), c('water'), c('grass'), c('water')), q, noise);
			expect(water.floors).toEqual([F('grass'), F('grass')]);
		}
		// The kerb: full at the edge, gone past its width, only toward the neighbour that differs.
		const kerbed = four(c('stone'), c('grass'), c('stone'), c('grass'));
		expect(splatWeights(kerbed, { x: 0.999, y: 0.7 }).kerb).toEqual({ x: 1, y: 0 });
		expect(splatWeights(kerbed, { x: 1 - SPLAT.kerbWidth * 1.01, y: 0.7 }).kerb.x).toBe(0);
		// Between two kerbed floors, only the one that outranks the other draws it.
		const wood = splatWeights(four(c('wood'), c('stone'), c('wood'), c('wood')), {
			x: 0.99,
			y: 0.5
		});
		const stone = splatWeights(four(c('stone'), c('wood'), c('stone'), c('stone')), {
			x: 0.99,
			y: 0.5
		});
		expect([wood.kerb.x > 0, stone.kerb.x > 0].filter(Boolean)).toHaveLength(1);
		// None toward the void, whose edge is a drop.
		expect(
			splatWeights(four(c('stone'), { ...c('void') }, c('stone'), c('stone')), { x: 0.99, y: 0.5 })
				.kerb.x
		).toBe(0);
		expect(F('void')).toBe(VOID);
	});

	it('never blends or kerbs toward an unexplored neighbour, or across a level', () => {
		for (const { q, noise } of samples()) {
			const fog = splatWeights(
				four(c('grass'), c('dirt', 0, false), c('sand', 0, false), c('dirt', 0, false)),
				q,
				noise
			);
			expect(fog.weights[0]).toBe(1);
			const kerb = splatWeights(
				four(c('stone'), c('grass', 0, false), c('grass', 1), c('grass', 0, false)),
				q,
				noise
			);
			expect(kerb.weights[0]).toBe(1);
			expect(kerb.kerb).toEqual({ x: 0, y: 0 });
		}
	});

	it('blends two layers by height: the higher one wins on an even split', () => {
		expect(heightShare(0.5, 0.5, 0.5, 0.5)).toBeCloseTo(0.5, 12);
		expect(heightShare(0.2, 0.9, 0.5, 0.5)).toBe(1); // sand settles between the stones
		expect(heightShare(1, 0, 1, 0)).toBe(0); // a weight of 0 never shows, whatever its height
		expect(heightShare(0, 1, 1, 0)).toBe(0);
		// More weight brings it in, monotonically.
		let last = -1;
		for (let a = 0; a <= 1; a += 0.05) {
			const share = heightShare(0.6, 0.4, 1 - a, a);
			expect(share).toBeGreaterThanOrEqual(last);
			last = share;
		}
	});
});
