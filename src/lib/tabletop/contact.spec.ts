// Contact shadows' pure part (#271): halos sized by the base or the footprint, none under flat
// props, on the floor a prop or token stands on, shrinking and fading as a mini rises.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { Prop } from '$lib/game/props';
import { BASE_SIZES } from './bases';
import { groundFor, STEP_HEIGHT } from './ground';
import {
	CONTACT_LIFT,
	PROP_SPREAD,
	propContact,
	STANDING,
	TOKEN_SPREAD,
	tokenContact
} from './contact';

const grid: SquareGrid = { kind: 'square', width: 6, height: 6, cellSize: 1.5 };
const BASE_DIAMETER = BASE_SIZES[0];
const prop = (assetId: string, x: number, y: number, rotation = 0): Prop =>
	({ id: `p-${assetId}`, assetId, pos: { x, y }, rotation, scale: 1 }) as Prop;
/** Models' heights from the built manifest, in cells. */
const models = JSON.parse(readFileSync('static/assets/manifest.json', 'utf8')).models as Record<
	string,
	{ bounds: { min: number[]; max: number[] } }
>;
const heightOf = (id: string) => models[id].bounds.max[1] - models[id].bounds.min[1];

describe('contact shadows', () => {
	it('sizes a token halo by its base, on its floor', () => {
		const d = BASE_DIAMETER * grid.cellSize;
		const c = tokenContact(1, 2, 3, d, 0, grid.cellSize);
		expect(c.w).toBeCloseTo(d * TOKEN_SPREAD);
		expect(c.d).toBe(c.w);
		expect([c.x, c.z, c.strength, c.soft]).toEqual([1, 3, 1, 1]);
		expect(c.y).toBeCloseTo(2 + CONTACT_LIFT * grid.cellSize);
		// A large creature's base (#270) casts a larger halo.
		const large = tokenContact(0, 0, 0, BASE_SIZES[2] * grid.cellSize, 0, grid.cellSize);
		expect(large.w).toBeCloseTo(BASE_SIZES[2] * grid.cellSize * TOKEN_SPREAD);
	});

	it('shrinks and fades a halo as the mini hops, and keeps it on the floor', () => {
		const d = BASE_DIAMETER;
		const rest = tokenContact(0, 0, 0, d, 0, 1);
		const hop = tokenContact(0, 0, 0, d, d / 2, 1);
		const high = tokenContact(0, 0, 0, d, d * 4, 1);
		expect(hop.w).toBeLessThan(rest.w);
		expect(hop.strength).toBeLessThan(rest.strength);
		expect(high.strength).toBeGreaterThan(0);
		expect(high.strength).toBeLessThan(hop.strength);
		expect(hop.y).toBe(rest.y);
	});

	it('skips flat props and props whose model has not arrived', () => {
		for (const id of ['rug', 'water', 'water-sm', 'water-lg', 'crack', 'ashes', 'paper', 'hatch'])
			expect(propContact(prop(id, 1, 1), grid, null, heightOf(id)), id).toBeNull();
		expect(propContact(prop('crate', 1, 1), grid, null, null)).toBeNull();
		for (const id of ['crate', 'barrel', 'table', 'statue', 'hatch-open'])
			expect(heightOf(id), id).toBeGreaterThanOrEqual(STANDING);
	});

	it('sizes a standing prop by its footprint and turns it with the prop', () => {
		const s = grid.cellSize;
		const flat = propContact(prop('table', 1, 1), grid, null, heightOf('table'))!;
		expect([flat.w, flat.d].map((v) => v / (s * PROP_SPREAD))).toEqual([2, 1]);
		expect(flat.turn).toBeCloseTo(0);
		// Its centre is the footprint's: two cells along x from the anchor's corner.
		const corner = { x: (1 - grid.width / 2) * s, z: (1 - grid.height / 2) * s };
		expect(flat.x).toBeCloseTo(corner.x + s);
		expect(flat.z).toBeCloseTo(corner.z + s / 2);
		const turned = propContact(prop('table', 1, 1, 1), grid, null, heightOf('table'))!;
		expect([turned.w, turned.d]).toEqual([flat.w, flat.d]);
		expect(turned.turn).toBeCloseTo(-Math.PI / 2);
		expect(turned.x).toBeCloseTo(corner.x + s / 2);
		expect(turned.z).toBeCloseTo(corner.z + s);
		expect(propContact(prop('crate', 1, 1), grid, null, heightOf('crate'))!.soft).toBeLessThan(1);
	});

	it('stands on raised cells and on the highest floor under a prop (a balcony)', () => {
		const levels = new Uint8Array(grid.width * grid.height);
		levels[1 * grid.width + 2] = 5; // a balcony cell under the table's second cell
		const ground = groundFor(grid, levels);
		const lift = CONTACT_LIFT * grid.cellSize;
		const table = propContact(prop('table', 1, 1), grid, ground, heightOf('table'))!;
		expect(table.y).toBeCloseTo(5 * STEP_HEIGHT * grid.cellSize + lift);
		const crate = propContact(prop('crate', 2, 1), grid, ground, heightOf('crate'))!;
		expect(crate.y).toBeCloseTo(table.y);
		expect(propContact(prop('crate', 0, 0), grid, ground, heightOf('crate'))!.y).toBeCloseTo(lift);
	});
});
