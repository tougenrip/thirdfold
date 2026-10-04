// Drop-in (#249): what drops, the curve, and the clock.

import { describe, expect, it } from 'vitest';
import type { Prop } from '$lib/game/props';
import {
	cellsDropped,
	dropLeft,
	Drops,
	DROP_MS,
	FALL,
	HOP,
	NO_DROP,
	PropDrops,
	propsDropped,
	type GroundState
} from './drop-in';

const prop = (id: string, x: number, y: number): Prop =>
	({ id, assetId: 'crate', pos: { x, y }, rotation: 0, scale: 1 }) as Prop;

/** A 4x1 table with the first `explored` cells known (null: all of them). */
const ground = (levels: number[], floor: number[], explored: number | null): GroundState => ({
	width: 4,
	height: 1,
	known: explored === null ? null : Uint8Array.from([0, 1, 2, 3], (i) => (i < explored ? 1 : 0)),
	levels: Uint8Array.from(levels),
	floor: Uint8Array.from(floor)
});

describe('the drop curve', () => {
	it('starts a whole drop up, lands at FALL, hops by HOP and rests at exactly 0', () => {
		expect(dropLeft(0)).toBe(1);
		expect(dropLeft(-1)).toBe(1);
		expect(dropLeft(FALL)).toBe(0);
		expect(dropLeft((1 + FALL) / 2)).toBeCloseTo(HOP);
		expect(dropLeft(1)).toBe(0);
		expect(dropLeft(5)).toBe(0);
	});

	it('only falls while falling, and never goes below its place', () => {
		let last = dropLeft(0);
		for (let t = 0.01; t <= FALL; t += 0.01) {
			expect(dropLeft(t)).toBeLessThanOrEqual(last);
			last = dropLeft(t);
		}
		for (let t = 0; t <= 1.2; t += 0.01) expect(dropLeft(t)).toBeGreaterThanOrEqual(0);
	});
});

describe('what drops', () => {
	it('drops a cell the GM raised or painted where the viewer knew it', () => {
		const before = ground([0, 0, 0, 0], [0, 0, 0, 0], null);
		expect(cellsDropped(before, ground([0, 2, 0, 0], [0, 0, 3, 0], null))).toEqual([1, 2]);
		expect(cellsDropped(before, before)).toEqual([]);
	});

	it('never drops what exploring shows, nor a change where the viewer had not been', () => {
		// The player explores the third cell: its real level arrives with it.
		const before = ground([1, 1, 0, 0], [0, 0, 0, 0], 2);
		expect(cellsDropped(before, ground([1, 1, 4, 0], [0, 0, 2, 0], 3))).toEqual([]);
		// The GM raises a cell the player knows and one they don't.
		expect(cellsDropped(before, ground([2, 1, 0, 3], [0, 0, 0, 0], 2))).toEqual([0]);
	});

	it('drops nothing across a new table size', () => {
		const before = ground([0, 0, 0, 0], [0, 0, 0, 0], null);
		expect(
			cellsDropped(before, { ...before, width: 2, height: 2, levels: new Uint8Array(4) })
		).toEqual([]);
	});

	it('drops a new prop on known ground, not one exploring reveals, nor a moved one', () => {
		const known = Uint8Array.from([1, 1, 0, 0]);
		const before = { props: [prop('a', 0, 0)], known };
		const after = [prop('a', 1, 0), prop('b', 1, 0), prop('c', 3, 0)];
		expect(propsDropped(before, after, 4)).toEqual(['b']);
		expect(propsDropped({ props: [], known: null }, after, 4)).toEqual(['a', 'b', 'c']);
	});
});

describe('the drops clock', () => {
	it('plays for DROP_MS from a start, then idles', () => {
		let now = 5000;
		const out = { value: 0 };
		const drops = new Drops(() => now, out);
		now = 6000;
		expect(drops.start()).toBe(1);
		expect(drops.tick(6000)).toBe(true);
		expect(out.value).toBe(1);
		expect(drops.tick(6000 + DROP_MS - 1)).toBe(true);
		expect(drops.tick(6000 + DROP_MS)).toBe(false);
		expect(drops.active).toBe(false);
	});

	it('starts nothing under reduced motion, or while held until the next frame', () => {
		const drops = new Drops(() => 0);
		drops.reduced = true;
		expect(drops.start()).toBe(NO_DROP);
		expect(drops.tick(0)).toBe(false);
		drops.reduced = false;
		drops.hold();
		expect(drops.start()).toBe(NO_DROP);
		drops.tick(1);
		expect(drops.start()).not.toBe(NO_DROP);
	});

	it("drops a GM's prop once, against what the last frame showed, never on a new table", () => {
		let now = 0;
		const drops = new Drops(() => now);
		const props = new PropDrops(drops);
		const first = [prop('a', 0, 0)];
		props.update(first, 4, null, true); // the first snapshot
		expect(props.startOf('a')).toBe(NO_DROP);
		drops.tick(now);
		now = 1000;
		const second = [...first, prop('b', 1, 0)];
		props.update(second, 4, null, false);
		expect(props.startOf('b')).toBe(1);
		// Synced again before a frame (the light it carries): the same drop, not a new one.
		now = 1010;
		props.update(second, 4, null, false);
		expect(props.startOf('b')).toBe(1);
		// A whole new table: nothing drops.
		drops.tick(now);
		props.update([prop('c', 0, 0)], 4, null, true);
		expect(props.startOf('c')).toBe(NO_DROP);
		expect(drops.tick(now + DROP_MS)).toBe(false);
	});

	it('keeps exploring and the prop it reveals in one update apart from a placement', () => {
		const drops = new Drops(() => 0);
		const props = new PropDrops(drops);
		props.update([], 4, Uint8Array.from([1, 0, 0, 0]), true);
		drops.tick(0);
		// The fog diff first (same props, more known), then the prop on the newly explored cell.
		props.update([], 4, Uint8Array.from([1, 1, 0, 0]), false);
		props.update([prop('x', 1, 0)], 4, Uint8Array.from([1, 1, 0, 0]), false);
		expect(props.startOf('x')).toBe(NO_DROP);
		expect(drops.tick(1)).toBe(false);
	});
});
