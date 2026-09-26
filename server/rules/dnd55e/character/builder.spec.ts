import { describe, expect, it } from 'vitest';
import type {
	CreatorChoices,
	CreatorOptions,
	CreatorSummary
} from '../../../../src/lib/rules/dnd55e/creator';
import { dnd55e } from '../index';

const builder = dnd55e.builder!;
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

/** A level 1 Human Rogue, as a creation page would send it. */
const rogue = (): CreatorChoices => ({
	name: 'Wren',
	color: '#17A589',
	species: {
		id: srd('species', 'human'),
		options: { size: 'small', skillful: 'perception' },
		feat: { feat: srd('feat', 'skilled'), skills: ['history', 'medicine', 'survival'] }
	},
	background: { id: srd('background', 'criminal'), increases: { dex: 2, int: 1 } },
	class: {
		id: srd('class', 'rogue'),
		skills: ['acrobatics', 'insight', 'investigation', 'persuasion'],
		expertise: ['stealth', 'investigation'],
		fightingStyle: null,
		weaponMasteries: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
	},
	abilities: {
		method: 'point-buy',
		base: { str: 8, dex: 15, con: 14, int: 13, wis: 12, cha: 10 }
	},
	armor: { worn: srd('armor', 'leather-armor'), shield: false },
	weapons: [srd('weapon', 'rapier'), srd('weapon', 'shortbow')]
});

const problemsOf = (choices: unknown) => {
	const built = builder.build(choices, 'pc-1');
	return built.ok ? [] : built.problems;
};

describe('building a fifth edition character', () => {
	it('offers what the catalog holds, level 1 only, with the SRD credited', () => {
		const options = builder.options() as unknown as CreatorOptions;
		expect(options).toMatchObject({
			rules: 'dnd-5.5e',
			level: 1,
			methods: ['standard-array', 'point-buy'],
			standardArray: [15, 14, 13, 12, 10, 8],
			points: 27
		});
		expect(options.attribution).toContain('SRD 5.2.1');
		expect(options.species).toHaveLength(9);
		expect(options.backgrounds).toHaveLength(4);
		expect(options.classes).toHaveLength(12);
		const fighter = options.classes.find((c) => c.name === 'Fighter')!;
		expect(fighter).toMatchObject({
			hitDie: 10,
			saves: ['str', 'con'],
			skills: { count: 2 },
			fightingStyle: true,
			expertise: 0,
			weaponMastery: { count: 3, melee: false }
		});
		expect(fighter.features.map((f) => f.name)).toEqual([
			'Fighting Style',
			'Second Wind',
			'Weapon Mastery'
		]);
		const rogueClass = options.classes.find((c) => c.name === 'Rogue')!;
		expect(rogueClass.expertise).toBe(2);
		expect(rogueClass.trainedWeapons).toContain(srd('weapon', 'rapier'));
		expect(rogueClass.trainedWeapons).not.toContain(srd('weapon', 'longsword'));
		const elf = options.species.find((s) => s.name === 'Elf')!;
		expect(elf.options.map((o) => o.key)).toEqual(['lineage', 'spellcasting', 'keen-senses']);
		expect(elf.options[0].values.map((v) => v.name)).toEqual(['Drow', 'High Elf', 'Wood Elf']);
		expect(options.originFeats.map((f) => f.name)).toEqual([
			'Alert',
			'Magic Initiate',
			'Savage Attacker',
			'Skilled'
		]);
	});

	it('previews what the choices come to, every number from the server', () => {
		const preview = builder.preview(rogue());
		expect(preview.ok).toBe(true);
		const summary = (preview as { summary: unknown }).summary as CreatorSummary;
		expect(summary).toMatchObject({
			title: 'Human Rogue 1 (Criminal)',
			level: 1,
			// d8 + Constitution 2; leather 11 + Dexterity 3.
			hp: 10,
			armorClass: 14,
			speed: 30,
			// Dexterity 3, plus Proficiency Bonus 2 from the Criminal's Alert.
			initiative: 5,
			proficiency: 2
		});
		// Investigation: Intelligence 14 (+2), with Expertise (+4).
		expect(summary.skills.find((s) => s.id === 'investigation')).toMatchObject({
			bonus: 6,
			expertise: true
		});
		expect(summary.skills.find((s) => s.id === 'medicine')!.proficient).toBe(true);
		expect(summary.actions).toEqual([
			{ name: 'Rapier', summary: '+5 to hit, 1d8+3 damage' },
			{ name: 'Shortbow', summary: '+5 to hit, 1d6+3 damage, range 16' }
		]);
	});

	it('builds the table character, its attacks from its weapons', () => {
		const built = builder.build(rogue(), 'pc-1');
		if (!built.ok) throw new Error(built.problems.join('; '));
		expect(built.def).toMatchObject({
			id: 'pc-1',
			name: 'Wren',
			tagline: 'Human Rogue 1 (Criminal)',
			color: '#17a589',
			hp: 10,
			armor: 14,
			speed: 6,
			model: 'veil'
		});
		expect(built.def.actions.map((a) => [a.id, a.kind, a.range, a.dice])).toEqual([
			['rapier', 'attack', 1, '1d8+3'],
			['shortbow', 'attack', 16, '1d6+3']
		]);
		expect(built.def.sheet).toMatchObject({
			level: 1,
			attacks: { rapier: 'dex', shortbow: 'dex' },
			expertise: ['investigation', 'stealth']
		});
		// A class's level 1 healing comes as an action: a Fighter's Second Wind.
		const fighter = builder.build(
			{
				...rogue(),
				class: {
					id: srd('class', 'fighter'),
					skills: ['athletics', 'insight'],
					expertise: [],
					fightingStyle: srd('feat', 'defense'),
					weaponMasteries: [
						srd('weapon', 'longsword'),
						srd('weapon', 'rapier'),
						srd('weapon', 'shortbow')
					]
				},
				armor: { worn: srd('armor', 'chain-mail'), shield: false },
				abilities: {
					method: 'standard-array',
					base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
				},
				weapons: [srd('weapon', 'longsword')]
			},
			'pc-2'
		);
		if (!fighter.ok) throw new Error(fighter.problems.join('; '));
		expect(fighter.def.actions.map((a) => a.id)).toEqual(['longsword', 'second-wind']);
		expect(fighter.def.sheet).toMatchObject({ bonusActions: ['second-wind'] });
	});

	it('refuses what a page may not grant: levels, rolled scores, untrained weapons, bad choices', () => {
		// A level asked for is ignored: every new character starts at level 1.
		const levelled = builder.build({ ...rogue(), level: 20 }, 'pc-1');
		expect(levelled.ok && levelled.def.sheet).toMatchObject({ level: 1 });
		expect(
			problemsOf({
				...rogue(),
				abilities: {
					method: 'rolled',
					base: { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 }
				}
			})
		).toEqual(['ability scores by the standard array or point buy']);
		expect(
			problemsOf({
				...rogue(),
				abilities: {
					method: 'point-buy',
					base: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 }
				}
			})
		).toContain('point buy spends 36 points, of 27');
		expect(problemsOf({ ...rogue(), weapons: [srd('weapon', 'greatsword')] })).toContain(
			"Rogue isn't trained with Greatsword"
		);
		expect(problemsOf({ ...rogue(), weapons: [] })).toEqual(['choose a weapon']);
		expect(problemsOf({ ...rogue(), color: 'red' })).toEqual(['choose a colour']);
		expect(problemsOf({ ...rogue(), name: ' ' })).toEqual(['a name of 1 to 40 characters']);
		expect(
			problemsOf({ ...rogue(), class: { ...rogue().class, expertise: ['athletics', 'stealth'] } })
		).toContain('Expertise in "athletics", a skill it isn\'t proficient in');
		expect(
			problemsOf({ ...rogue(), species: { ...rogue().species, id: srd('species', 'hobbit') } })
		).toContain('no species "srd-5.2.1:species:hobbit"');
		expect(problemsOf('a wizard')).toEqual(['choices must be an object']);
	});

	it('restores what it built, and refuses a saved character tampered with', () => {
		const built = builder.build(rogue(), 'pc-1');
		if (!built.ok) throw new Error('not built');
		const saved = JSON.parse(JSON.stringify(built.saved));
		expect(builder.restore(saved, 'pc-1')).toEqual(built);
		expect(builder.restore(saved, 'pc-2')).toEqual({
			ok: false,
			problems: ['a built character under another id']
		});
		saved.character.abilities.base.dex = 20;
		expect(builder.restore(saved, 'pc-1').ok).toBe(false);
		expect(builder.restore({ character: saved.character }, 'pc-1').ok).toBe(false);
	});
});
