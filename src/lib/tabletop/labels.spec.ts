import { describe, expect, it } from 'vitest';
import {
	ATLAS_GAP,
	contrastOnPlate,
	FLOAT_COLOURS,
	labelsShown,
	NO_LABELS,
	Shelves,
	TEXT_COLOUR
} from './labels';

const tokens = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const shown = (patch: Partial<typeof NO_LABELS>) => [
	...labelsShown(tokens, { ...NO_LABELS, ...patch })
];

describe('which names show (#268)', () => {
	it('shows none at rest', () => {
		expect(shown({})).toEqual([]);
	});

	it('shows the hovered, selected and active tokens', () => {
		expect(shown({ hovered: 'a' })).toEqual(['a']);
		expect(shown({ hovered: 'a', selected: 'b', active: 'd' })).toEqual(['a', 'b', 'd']);
	});

	it('shows every token while the key is held or always is set', () => {
		expect(shown({ held: true })).toEqual(['a', 'b', 'c', 'd']);
		expect(shown({ always: true })).toEqual(['a', 'b', 'c', 'd']);
	});

	it('shows only tokens the viewer was sent', () => {
		expect(shown({ hovered: 'hidden', selected: 'gone' })).toEqual([]);
		expect(labelsShown([], { ...NO_LABELS, always: true }).size).toBe(0);
	});
});

describe('the atlas packing', () => {
	it('fills rows left to right, then starts a row below the tallest', () => {
		const s = new Shelves(100, 100);
		expect(s.add(40, 20)).toEqual({ x: 0, y: 0 });
		expect(s.add(40, 10)).toEqual({ x: 40 + ATLAS_GAP, y: 0 });
		expect(s.add(40, 10)).toEqual({ x: 0, y: 20 + ATLAS_GAP });
	});

	it('never overlaps and says when it is full', () => {
		const s = new Shelves(64, 64);
		const placed: { x: number; y: number }[] = [];
		for (let at = s.add(20, 10); at; at = s.add(20, 10)) placed.push(at);
		expect(placed.length).toBe(Math.floor(64 / 22) * Math.floor(64 / 12));
		for (const [i, a] of placed.entries())
			for (const b of placed.slice(i + 1))
				expect(Math.abs(a.x - b.x) >= 22 || Math.abs(a.y - b.y) >= 12).toBe(true);
		expect(s.add(100, 4)).toBeNull();
		s.clear();
		expect(s.add(20, 10)).toEqual({ x: 0, y: 0 });
	});
});

describe('contrast', () => {
	it('reads 4.5:1 or better for names and every float, over white and black', () => {
		for (const colour of [TEXT_COLOUR, ...Object.values(FLOAT_COLOURS)])
			for (const behind of [0, 255])
				expect(contrastOnPlate(colour, behind), `${colour} over ${behind}`).toBeGreaterThan(4.5);
	});
});
