import { describe, expect, it } from 'vitest';
import { coverOf, NO_COVER } from './cover';
import { edgeBetween, edgeKey, type Obstacles } from './objects';

const open = (width = 10): Obstacles => ({
	edges: new Set(),
	width,
	solid: null,
	opaque: null,
	windows: null,
	levels: null
});
const wall = (o: Obstacles, a: { x: number; y: number }, b: { x: number; y: number }) =>
	({ ...o, edges: new Set([...o.edges, edgeKey(edgeBetween(a, b))]) }) as Obstacles;

describe('cover', () => {
	it('is none across open ground', () => {
		expect(coverOf(open(), { x: 1, y: 1 }, { x: 6, y: 3 })).toEqual(NO_COVER);
	});

	it('counts the lines a wall beside the target blocks, from the attacker’s best corner', () => {
		// A wall on the target's near side: every line crosses it.
		const full = wall(open(), { x: 4, y: 2 }, { x: 5, y: 2 });
		expect(coverOf(full, { x: 1, y: 2 }, { x: 5, y: 2 })).toMatchObject({ blocked: 4, objects: 4 });
		// Seen past its end at a slant, the same wall hides only part of the target.
		const slant = coverOf(full, { x: 1, y: 5 }, { x: 5, y: 2 });
		expect(slant.objects).toBeGreaterThan(0);
		expect(slant.objects).toBeLessThan(4);
		// From the other side it hides nothing.
		expect(coverOf(full, { x: 8, y: 2 }, { x: 5, y: 2 })).toEqual(NO_COVER);
	});

	it('counts creatures in the way apart from things', () => {
		const body = (c: { x: number; y: number }) => c.x === 3 && c.y === 2;
		expect(coverOf(open(), { x: 1, y: 2 }, { x: 5, y: 2 }, body)).toMatchObject({
			objects: 0
		});
		expect(coverOf(open(), { x: 1, y: 2 }, { x: 5, y: 2 }, body).blocked).toBeGreaterThan(0);
		// The attacker's and target's own cells never count.
		expect(coverOf(open(), { x: 1, y: 2 }, { x: 5, y: 2 }, (c) => c.x === 1 || c.x === 5)).toEqual(
			NO_COVER
		);
	});

	it('lets an attacker high above look down over walls', () => {
		const levels = new Uint8Array(100);
		levels[2 * 10 + 1] = 6;
		const high = { ...wall(open(), { x: 4, y: 2 }, { x: 5, y: 2 }), levels };
		expect(coverOf(high, { x: 1, y: 2 }, { x: 5, y: 2 })).toEqual(NO_COVER);
	});
});
