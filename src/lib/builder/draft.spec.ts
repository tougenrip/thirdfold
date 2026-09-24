import { describe, expect, it } from 'vitest';
import { exampleAdventure } from '$lib/adventure/example';
import {
	flowOf,
	formatArea,
	formatCells,
	idFrom,
	parseArea,
	parseCell,
	parseCells,
	parseList,
	renameKey
} from './draft';

describe('the builder draft', () => {
	it('reads and writes cells, lists of cells and areas as the forms show them', () => {
		expect(parseCell(' 3 , 12 ')).toEqual({ x: 3, y: 12 });
		expect(parseCell('3')).toBeNull();
		expect(parseCell('-1,2')).toBeNull();
		const cells = [
			{ x: 1, y: 2 },
			{ x: 3, y: 4 }
		];
		expect(parseCells(formatCells(cells))).toEqual(cells);
		expect(parseCells('')).toEqual([]);
		expect(parseCells('1,2; nope')).toBeNull();
		const area = { from: { x: 0, y: 1 }, to: { x: 5, y: 6 } };
		expect(parseArea(formatArea(area))).toEqual(area);
		expect(parseArea('4,4')).toEqual({ from: { x: 4, y: 4 }, to: { x: 4, y: 4 } });
		expect(parseList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
	});

	it('makes ids from names, never one already taken', () => {
		expect(idFrom('The Old Mill!')).toBe('the_old_mill');
		expect(idFrom('Mill', ['mill', 'mill_2'])).toBe('mill_3');
		expect(idFrom('???')).toBe('item');
	});

	it('renames a key in place, and refuses to overwrite another', () => {
		const r = { a: 1, b: 2, c: 3 };
		expect(Object.keys(renameKey(r, 'b', 'x'))).toEqual(['a', 'x', 'c']);
		expect(renameKey(r, 'b', 'c')).toBe(r);
	});

	it('shows how the example flows: chapter to chapter, to the end', () => {
		expect(flowOf(exampleAdventure())).toEqual([
			{ from: 'the_mill', to: 'the_key', by: 'asked', kind: 'next' },
			{ from: 'the_key', to: 'the_cellar', by: 'went_down', kind: 'next' },
			{ from: 'the_cellar', to: null, by: 'decided', kind: 'next' }
		]);
	});

	it('shows a choice that jumps to another chapter as a branch', () => {
		const file = exampleAdventure();
		file.chapters.the_cellar.opening = [{ offer: 'flour' }];
		file.decisions.flour.options[0].does = [{ enter: 'the_mill' }];
		expect(flowOf(file)).toContainEqual({
			from: 'the_cellar',
			to: 'the_mill',
			by: 'flour: Keep it for yourselves',
			kind: 'branch'
		});
	});
});
