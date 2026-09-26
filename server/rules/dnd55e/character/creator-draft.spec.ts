import { describe, expect, it } from 'vitest';
import type { CreatorOptions } from '../../../../src/lib/rules/dnd55e/creator';
import { dnd55e } from '../index';
import {
	complete,
	emptyDraft,
	pointsSpent,
	todo,
	toChoices,
	toggle,
	unplaced,
	withClass,
	type Draft
} from '../../../../src/lib/ui/dnd/creator-draft';

const options = dnd55e.builder!.options() as unknown as CreatorOptions;
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

/** A finished draft: a Human Fighter with the Skilled feat. */
function fighter(): Draft {
	return {
		...emptyDraft(),
		step: 'review',
		name: 'Ada',
		color: '#2e86c1',
		classId: srd('class', 'fighter'),
		speciesId: srd('species', 'human'),
		speciesOptions: { size: 'medium', skillful: 'insight' },
		speciesFeat: srd('feat', 'skilled'),
		speciesFeatSkills: ['history', 'medicine', 'nature'],
		backgroundId: srd('background', 'soldier'),
		plusTwo: 'str',
		plusOne: 'con',
		base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
		skills: ['acrobatics', 'perception'],
		fightingStyle: srd('feat', 'defense'),
		masteries: [srd('weapon', 'longsword'), srd('weapon', 'spear'), srd('weapon', 'longbow')],
		armor: srd('armor', 'chain-mail'),
		shield: true,
		weapons: [srd('weapon', 'longsword'), srd('weapon', 'longbow')]
	};
}

describe('the character creator draft', () => {
	it('says what is left on each step, in plain words', () => {
		const draft = emptyDraft();
		expect(todo(draft, options, 'class')).toEqual(['Choose a class.']);
		expect(todo(draft, options, 'origin')).toEqual(['Choose a species.', 'Choose a background.']);
		expect(todo(draft, options, 'abilities')).toEqual(['Place 15, 14, 13, 12, 10, 8.']);
		const human = {
			...draft,
			speciesId: srd('species', 'human'),
			backgroundId: srd('background', 'sage')
		};
		expect(todo(human, options, 'origin')).toEqual([
			'Choose your size.',
			'Choose a skill for Skillful.',
			'Choose an Origin feat.',
			'Choose which ability rises by 2 and which by 1.'
		]);
		const rogue = withClass(draft, srd('class', 'rogue'));
		expect(todo(rogue, options, 'skills')).toEqual([
			'Choose 4 class skills (0 so far).',
			'Choose 2 skills for Expertise.',
			'Choose 2 weapons to master.'
		]);
		expect(complete(fighter(), options)).toBe(true);
	});

	it('counts point buy and the standard array', () => {
		const buy: Draft = {
			...emptyDraft(),
			method: 'point-buy',
			base: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }
		};
		expect(pointsSpent(buy, options)).toBe(27);
		expect(todo(buy, options, 'abilities')).toEqual([]);
		expect(todo({ ...buy, base: { ...buy.base, int: 10 } }, options, 'abilities')).toEqual([
			'2 points too many.'
		]);
		const placed = { ...emptyDraft(), base: { ...emptyDraft().base, str: 15, dex: 14 } };
		expect(unplaced(placed, options)).toEqual([13, 12, 10, 8]);
	});

	it('turns a finished draft into choices the server accepts', () => {
		const choices = toChoices(fighter(), options);
		expect(choices.background.increases).toEqual({ str: 2, con: 1 });
		expect(choices.species.feat).toEqual({
			feat: srd('feat', 'skilled'),
			skills: ['history', 'medicine', 'nature']
		});
		const preview = dnd55e.builder!.preview(choices);
		expect(preview).toMatchObject({ ok: true, summary: { title: 'Human Fighter 1 (Soldier)' } });
		// +1/+1/+1 raises the background's three abilities.
		const three = toChoices({ ...fighter(), increaseMode: 'three' }, options);
		expect(three.background.increases).toEqual({ str: 1, dex: 1, con: 1 });
	});

	it('clears what depended on a class when the class changes, and caps lists', () => {
		const changed = withClass(fighter(), srd('class', 'wizard'));
		expect(changed).toMatchObject({ skills: [], masteries: [], weapons: [], armor: null });
		expect(toggle(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
		expect(toggle(['a', 'b'], 'a', 2)).toEqual(['b']);
	});
});
