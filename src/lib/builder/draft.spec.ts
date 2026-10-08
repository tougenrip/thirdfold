import { FATE_PREGENS } from '../rules/fate/core';
import { describe, expect, it } from 'vitest';
import { exampleAdventure } from '$lib/adventure/example';
import { pregenChoices } from '$lib/rules/dnd55e/pregens';
import { parseSceneFile, SCENE_FILE_VERSION } from '$lib/game/scene-file';
import { DEFAULT_WORLD } from '$lib/game/world';
import {
	addPregen,
	DND_RULES,
	FATE_RULES,
	rulesChoiceOf,
	withRules,
	flowOf,
	formatArea,
	formatCells,
	idFrom,
	idsOf,
	newTable,
	parseArea,
	parseCell,
	parseCells,
	parseList,
	renameKey,
	toDraft
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

	it("offers the places' light and prop ids once each, from tables of any version", () => {
		const file = exampleAdventure();
		const ids = idsOf(file);
		expect(ids.props).toEqual(['sack', 'stair', 'hoard', 'hoard-2']);
		expect(ids.lights).toEqual([]);
		// A draft kept from before may hold a table without lights.
		delete (file.locations.yard.scene as { lights?: unknown }).lights;
		expect(idsOf(file).props).toContain('sack');
	});

	it('starts a new table as a current (v10) scene file, at noon under a sun', () => {
		const scene = newTable('Yard', 8, 6);
		expect(scene).toMatchObject({ version: SCENE_FILE_VERSION, ambient: 'day', interior: null });
		expect(scene.world).toEqual(DEFAULT_WORLD);
		expect(parseSceneFile(JSON.parse(JSON.stringify(scene)))).toMatchObject({ ok: true });
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

describe('the rules a draft plays by (milestone 57)', () => {
	it('switches to the fifth edition and back, keeping only what each rules can play', () => {
		const dnd = withRules(toDraft(exampleAdventure()), 'dnd');
		expect(dnd).toMatchObject({ rules: DND_RULES, characters: [], openParty: true });
		expect(addPregen(dnd, pregenChoices('fighter'))).toBe('brakka');
		expect(addPregen(dnd, pregenChoices('fighter'))).toBe('brakka-2');
		expect(addPregen(dnd, pregenChoices('nobody'))).toBeNull();
		expect(Object.keys(dnd.party!)).toEqual(['brakka', 'brakka-2']);
		dnd.monsters = ['srd-skeleton'];
		expect(idsOf(dnd).enemies).toContain('srd-skeleton');
		const classic = withRules(dnd, 'classic');
		expect(classic.characters.length).toBeGreaterThan(0);
		expect('rules' in classic || 'party' in classic || 'monsters' in classic).toBe(false);
	});

	it('switches to Fate Condensed: a party its rules build, no open party or bestiary (milestone 60)', () => {
		const dnd = withRules(toDraft(exampleAdventure()), 'dnd');
		addPregen(dnd, pregenChoices('fighter'));
		dnd.monsters = ['srd-skeleton'];
		const fate = withRules(dnd, 'fate');
		expect(fate).toMatchObject({ rules: FATE_RULES, characters: [] });
		expect('party' in fate || 'openParty' in fate || 'monsters' in fate).toBe(false);
		expect(rulesChoiceOf(fate)).toBe('fate');
		expect(addPregen(fate, FATE_PREGENS[0].choices)).toBe('ida-brann');
	});
});
