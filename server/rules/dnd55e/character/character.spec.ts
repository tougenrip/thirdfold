import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CHARACTERS } from '../../../../src/lib/adventure/characters';
import { PARTY_CHOICES, partyMember } from '../../../adventures/barrow/party';
import { CATALOG_DIR, CatalogDamaged, openCatalog, srdCatalog } from '../catalog';
import { DND_55E } from '../index';
import { readSheet } from '../sheet';
import { characterDefOf } from './adventure';
import { deriveCharacter } from './derive';
import type { CharacterChoices, DndCharacter } from './model';
import { migrateCharacter, restoreCharacter, serializeCharacter } from './persist';
import { CharacterRoster } from './roster';
import { createCharacter, readCharacter } from './validate';

const catalog = srdCatalog();
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;

const make = (choices: CharacterChoices): DndCharacter => {
	const made = createCharacter(choices, catalog, DND_55E);
	if (!made.ok) throw new Error(made.problems.join('; '));
	return made.character;
};
const problemsOf = (choices: CharacterChoices): string[] => {
	const made = createCharacter(choices, catalog, DND_55E);
	return made.ok ? [] : made.problems;
};
const warden = () => structuredClone(PARTY_CHOICES.warden);

describe('fifth edition characters', () => {
	it('derives every number from the choices, by the SRD', () => {
		const { character, derived } = partyMember('warden');
		expect(character).toMatchObject({
			version: 1,
			rules: DND_55E,
			catalog: {
				source: 'srd-5.2.1',
				version: '5.2.1',
				sha256: '8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87'
			},
			state: { hp: 12, tempHp: 0, hitDiceSpent: 0, spent: {} }
		});
		expect(derived).toMatchObject({
			title: 'Orc Fighter 1 (Soldier)',
			proficiency: 2,
			// Standard array Str 15 and Con 14, raised +2/+1 by the Soldier background.
			scores: { str: 17, dex: 12, con: 15, int: 8, wis: 13, cha: 10 },
			modifiers: { str: 3, dex: 1, con: 2, int: -1, wis: 1, cha: 0 },
			// Chain mail 16, Shield +2, Defense +1.
			armorClass: 19,
			initiative: 1,
			speed: 30,
			// d10 at level 1, + Constitution 2.
			hitPoints: { max: 12, current: 12, temp: 0 },
			hitDice: { die: 10, total: 1, spent: 0 },
			// Perception proficient: 10 + 1 + 2.
			passivePerception: 13,
			spellcasting: null
		});
		expect(derived.saves.str).toEqual({ bonus: 5, proficient: true });
		expect(derived.saves.dex).toEqual({ bonus: 1, proficient: false });
		expect(
			Object.entries(derived.skills)
				.filter(([, s]) => s.proficient)
				.map(([id]) => id)
		).toEqual(['athletics', 'intimidation', 'perception', 'survival']);
		expect(derived.feats.map((f) => f.name)).toEqual(['Savage Attacker', 'Defense']);
		expect(derived.features.map((f) => f.name)).toEqual([
			'Adrenaline Rush',
			'Darkvision',
			'Relentless Endurance',
			'Fighting Style',
			'Second Wind',
			'Weapon Mastery'
		]);
		expect(derived.resources).toEqual([
			{ id: 'second-wind', name: 'Second Wind', max: 2, spent: 0 }
		]);
		expect(derived.proficiencies.armor).toEqual(['light', 'medium', 'heavy', 'shield']);
	});

	it('counts Expertise, Alert, a lineage, Dwarven Toughness and spellcasting', () => {
		const veil = partyMember('veil').derived;
		expect(veil.skills.stealth).toEqual({ bonus: 7, proficient: true, expertise: true });
		expect(veil.skills.investigation).toEqual({ bonus: 3, proficient: true, expertise: false });
		// Alert: Dexterity 3 + Proficiency Bonus 2.
		expect(veil.initiative).toBe(5);
		expect(veil.armorClass).toBe(14);

		const ember = partyMember('ember').derived;
		expect(ember.title).toBe('Elf Wizard 1 (Sage)');
		expect(ember.skills.perception.proficient).toBe(true);
		expect(ember.hitPoints.max).toBe(8);
		expect(ember.spellcasting).toEqual({
			ability: 'int',
			saveDc: 13,
			attackBonus: 5,
			cantrips: 3,
			prepared: 4,
			slots: [2],
			pact: null
		});

		const saint = partyMember('saint').derived;
		// d10 + Constitution 1 + Dwarven Toughness 1.
		expect(saint.hitPoints.max).toBe(12);
		expect(saint.resources.map((r) => [r.id, r.max])).toEqual([
			['lay-on-hands', 5],
			['spell-slots-1', 2]
		]);
	});

	it('recalculates as a character advances: feats, a subclass, hit points and the class table', () => {
		const c = make({
			...warden(),
			level: 4,
			class: {
				...warden().class,
				subclass: srd('subclass', 'champion'),
				// A fourth kind of weapon mastered at Fighter 4.
				weaponMasteries: [...warden().class.weaponMasteries, srd('weapon', 'greatsword')]
			},
			feats: [
				{ level: 4, feat: srd('feat', 'ability-score-improvement'), increases: { str: 1, con: 1 } }
			],
			hitPoints: { method: 'rolled', rolls: [10, 1, 6] }
		});
		const d = deriveCharacter(c, catalog);
		expect(d.scores).toMatchObject({ str: 18, con: 16 });
		// 10 + 3, then (10 + 3) + (1 + 3) + (6 + 3).
		expect(d.hitPoints.max).toBe(13 + 13 + 4 + 9);
		expect(d.subclass).toBe('Champion');
		expect(
			d.features.filter((f) => f.source === srd('subclass', 'champion')).map((f) => f.name)
		).toEqual(['Improved Critical', 'Remarkable Athlete']);
		expect(d.resources.find((r) => r.id === 'second-wind')!.max).toBe(3);

		// The same character at level 5 by the average: +6 + 3 a level.
		const average = make({
			...warden(),
			level: 5,
			class: {
				...warden().class,
				subclass: srd('subclass', 'champion'),
				weaponMasteries: [...warden().class.weaponMasteries, srd('weapon', 'greatsword')]
			},
			feats: [{ level: 4, feat: srd('feat', 'ability-score-improvement'), increases: { str: 2 } }],
			hitPoints: { method: 'average' }
		});
		const a = deriveCharacter(average, catalog);
		expect(a.proficiency).toBe(3);
		expect(a.hitPoints.max).toBe(12 + 4 * (6 + 2));
		expect(a.saves.str.bonus).toBe(4 + 3);
	});

	it('works out other classes and species: Unarmored Defense, lineages, Versatile, heavy armor', () => {
		const monk = deriveCharacter(
			make({
				id: 'monk',
				name: 'Brother Ash',
				level: 2,
				species: {
					id: srd('species', 'elf'),
					options: { lineage: 'wood-elf', spellcasting: 'wis', 'keen-senses': 'survival' },
					feat: null
				},
				background: { id: srd('background', 'acolyte'), increases: { wis: 2, int: 1 } },
				class: {
					id: srd('class', 'monk'),
					subclass: null,
					skills: ['acrobatics', 'stealth'],
					expertise: [],
					fightingStyle: null,
					weaponMasteries: []
				},
				abilities: {
					method: 'point-buy',
					base: { str: 10, dex: 15, con: 13, int: 8, wis: 15, cha: 8 }
				},
				feats: [],
				hitPoints: { method: 'average' },
				armor: { worn: null, shield: false },
				notes: {}
			}),
			catalog
		);
		// 10 + Dexterity 2 + Wisdom 3; Wood Elf 35 feet + Unarmored Movement 10 at level 2.
		expect(monk.armorClass).toBe(15);
		expect(monk.speed).toBe(45);
		expect(monk.resources.map((r) => [r.id, r.max])).toEqual([['focus-points', 2]]);

		const human = deriveCharacter(
			make({
				id: 'reeve',
				name: 'Reeve',
				level: 1,
				species: {
					id: srd('species', 'human'),
					options: { size: 'medium', skillful: 'medicine' },
					feat: { feat: srd('feat', 'skilled'), skills: ['history', 'nature', 'animal-handling'] }
				},
				background: { id: srd('background', 'soldier'), increases: { str: 1, dex: 1, con: 1 } },
				class: {
					id: srd('class', 'barbarian'),
					subclass: null,
					skills: ['perception', 'survival'],
					expertise: [],
					fightingStyle: null,
					weaponMasteries: [srd('weapon', 'greataxe'), srd('weapon', 'handaxe')]
				},
				abilities: {
					method: 'standard-array',
					base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }
				},
				feats: [],
				hitPoints: { method: 'average' },
				armor: { worn: null, shield: true },
				notes: {}
			}),
			catalog
		);
		// 10 + Dexterity 2 + Constitution 2 + Shield 2; d12 + 2.
		expect(human.armorClass).toBe(16);
		expect(human.hitPoints.max).toBe(14);
		expect(human.skills.medicine.proficient && human.skills.nature.proficient).toBe(true);
		expect(human.feats.map((f) => f.name)).toEqual(['Savage Attacker', 'Skilled']);

		// Plate asks for Strength 15: a Fighter with 13 moves 10 feet slower in it.
		const plate = warden();
		plate.abilities.base = { str: 13, dex: 12, con: 14, int: 8, wis: 15, cha: 10 };
		plate.background.increases = { dex: 2, con: 1 };
		plate.armor.worn = srd('armor', 'plate-armor');
		const slow = deriveCharacter(make(plate), catalog);
		expect(slow.speed).toBe(20);
		expect(slow.armorClass).toBe(18 + 2 + 1);
	});

	it('refuses choices the rules do not allow, naming each', () => {
		const expectProblem = (change: (c: CharacterChoices) => void, problem: string | RegExp) => {
			const c = warden();
			change(c);
			expect(problemsOf(c)).toEqual(
				expect.arrayContaining([
					typeof problem === 'string' ? problem : expect.stringMatching(problem)
				])
			);
		};
		expectProblem(
			(c) => (c.abilities.base.str = 16),
			'the standard array is 15, 14, 13, 12, 10, 8, each once'
		);
		expectProblem((c) => {
			c.abilities = {
				method: 'point-buy',
				base: { str: 15, dex: 15, con: 15, int: 10, wis: 8, cha: 8 }
			};
		}, 'point buy spends 29 points, of 27');
		expectProblem((c) => (c.background.increases = { int: 2, con: 1 }), /Soldier increases only/);
		expectProblem(
			(c) => (c.background.increases = { str: 2, con: 2 }),
			'a background increases one score by 2 and another by 1, or three scores by 1'
		);
		expectProblem(
			(c) => (c.class.skills = ['perception', 'arcana']),
			'Fighter can\'t choose the skill "arcana"'
		);
		expectProblem((c) => (c.class.skills = ['perception']), 'Fighter chooses 2 skills, not 1');
		expectProblem((c) => (c.class.skills = ['perception', 'athletics']), /a skill is chosen twice/);
		expectProblem((c) => (c.class.fightingStyle = null), 'Fighter: choose a Fighting Style feat');
		expectProblem(
			(c) => (c.class.fightingStyle = srd('feat', 'alert')),
			/Alert is not a Fighting Style feat/
		);
		expectProblem(
			(c) => (c.class.subclass = srd('subclass', 'champion')),
			'a subclass is chosen at level 3, not 1'
		);
		expectProblem((c) => {
			c.level = 3;
			c.class.subclass = srd('subclass', 'thief');
		}, 'Thief is not a Fighter subclass');
		expectProblem((c) => (c.level = 4), /level 4: choose a feat/);
		expectProblem((c) => {
			c.level = 4;
			c.class.subclass = srd('subclass', 'champion');
			c.abilities.base = { str: 12, dex: 10, con: 15, int: 8, wis: 13, cha: 14 };
			c.background.increases = { con: 2, dex: 1 };
			c.feats = [{ level: 4, feat: srd('feat', 'grappler'), increases: { str: 1 } }];
		}, 'level 4 feat: Grappler needs Strength or Dexterity 13+');
		expectProblem(
			(c) =>
				(c.feats = [
					{ level: 2, feat: srd('feat', 'ability-score-improvement'), increases: { str: 2 } }
				]),
			'level 2: Fighter gains no feat at that level'
		);
		expectProblem((c) => {
			c.level = 4;
			c.class.subclass = srd('subclass', 'champion');
			c.level = 6;
			c.feats = [
				{ level: 4, feat: srd('feat', 'ability-score-improvement'), increases: { str: 2 } },
				{ level: 6, feat: srd('feat', 'ability-score-improvement'), increases: { str: 2 } }
			];
		}, 'level 6 feat (Ability Score Improvement) raises str above 20');
		expectProblem(
			(c) => (c.class.weaponMasteries = [srd('weapon', 'longsword')]),
			'Fighter 1 masters 3 kinds of weapon, not 1'
		);
		expectProblem((c) => (c.species.options = { lineage: 'drow' }), 'Orc has no option "lineage"');
		expectProblem((c) => {
			c.level = 2;
			c.hitPoints = { method: 'rolled', rolls: [11] };
		}, 'a hit point roll above the d10');
		expectProblem((c) => {
			c.class = {
				id: srd('class', 'wizard'),
				subclass: null,
				skills: ['arcana', 'history'],
				expertise: [],
				fightingStyle: null,
				weaponMasteries: []
			};
		}, /a skill is chosen twice|Wizard isn't trained in Chain Mail/);
		const ember = structuredClone(PARTY_CHOICES.ember);
		ember.armor.worn = srd('armor', 'chain-mail');
		expect(problemsOf(ember)).toContain("Wizard isn't trained in Chain Mail");
		ember.armor.worn = null;
		ember.species.options = { lineage: 'high-elf', spellcasting: 'int' };
		expect(problemsOf(ember)).toContain('Elf: choose keen-senses');
	});

	it('refuses a character of another shape, other rules or another catalog', () => {
		const saved = JSON.parse(serializeCharacter(partyMember('veil').character));
		const read = (change: (raw: Record<string, unknown>) => void) => {
			const raw = structuredClone(saved);
			change(raw);
			const r = readCharacter(raw, catalog, DND_55E);
			return r.ok ? [] : r.problems;
		};
		expect(read(() => {})).toEqual([]);
		expect(read((r) => (r.owner = 'someone'))).toEqual(['character: unknown field "owner"']);
		expect(read((r) => delete r.state)).toEqual(['character: "state" missing']);
		expect(read((r) => (r.id = 'The Veil'))).toEqual([
			'id must be lowercase letters, digits and hyphens'
		]);
		expect(read((r) => (r.rules = { id: 'thirdfold-classic', version: 1 }))).toEqual([
			'made for rules thirdfold-classic v1, not dnd-5.5e v1'
		]);
		expect(read((r) => ((r.catalog as { sha256: string }).sha256 = '0'.repeat(64)))).toEqual([
			'made from catalog srd-5.2.1 5.2.1, not srd-5.2.1 5.2.1'
		]);
		expect(read((r) => ((r.state as { hp: number }).hp = 11))).toEqual([
			'hit points 11 above the maximum 10'
		]);
		expect(read((r) => ((r.state as { spent: object }).spent = { rages: 1 }))).toEqual([
			'spent uses of "rages", which it doesn\'t have'
		]);
		expect(read((r) => ((r.species as { id: string }).id = 'srd-5.2.1:species:hobbit'))).toEqual([
			'no species "srd-5.2.1:species:hobbit"'
		]);
	});

	it('saves and restores a character exactly, keeping its state of play', () => {
		const saint = partyMember('saint').character;
		saint.state = { hp: 7, tempHp: 3, hitDiceSpent: 1, spent: { 'lay-on-hands': 5 } };
		const text = serializeCharacter(saint);
		expect(text).not.toMatch(/owner/);
		const back = restoreCharacter(text, catalog, DND_55E);
		expect(back).toEqual({ ok: true, character: saint });
		expect(serializeCharacter((back as { character: DndCharacter }).character)).toBe(text);
		const d = deriveCharacter(saint, catalog);
		expect(d.hitPoints).toEqual({ max: 12, current: 7, temp: 3 });
		expect(d.resources[0]).toEqual({ id: 'lay-on-hands', name: 'Lay On Hands', max: 5, spent: 5 });

		expect(restoreCharacter('{', catalog, DND_55E)).toEqual({ ok: false, problems: ['not JSON'] });
		expect(restoreCharacter('x'.repeat(70_000), catalog, DND_55E).ok).toBe(false);
	});

	it('migrates older versions forward and refuses newer ones', () => {
		const current = JSON.parse(serializeCharacter(partyMember('veil').character));
		expect(migrateCharacter(current)).toEqual({ ok: true, raw: current });
		expect(migrateCharacter({ ...current, version: 2 })).toEqual({
			ok: false,
			problems: ["saved as version 2, newer than this server's 1"]
		});
		expect(migrateCharacter({ ...current, version: undefined })).toEqual({
			ok: false,
			problems: ['a character must say its version']
		});
		// A later shape (version 2, say, renaming `notes`) upgrades version 1 step by step.
		const v2 = migrateCharacter(
			current,
			{ 1: ({ notes, ...rest }) => ({ ...rest, extras: notes }) },
			2
		);
		expect(v2).toMatchObject({ ok: true, raw: { version: 2, extras: {} } });
		expect(migrateCharacter(current, {}, 3)).toEqual({
			ok: false,
			problems: ['no way to bring version 1 forward']
		});
	});

	it('keeps who owns a character beside it, not in it', () => {
		const roster = new CharacterRoster();
		const veil = partyMember('veil').character;
		roster.put('owner-a', veil);
		roster.put('owner-b', { ...veil, name: 'Another Veil' });
		expect(roster.get('owner-a', 'veil')!.name).toBe('The Veil');
		expect(roster.list('owner-b').map((c) => c.name)).toEqual(['Another Veil']);
		expect(roster.remove('owner-a', 'veil')).toBe(true);
		expect(roster.list('owner-a')).toEqual([]);
		expect(serializeCharacter(roster.get('owner-b', 'veil')!)).not.toContain('owner-b');
	});

	it('plays at an adventure table with the derived numbers, and leaves legacy characters alone', () => {
		const { derived } = partyMember('veil');
		const def = characterDefOf(derived, {
			...CHARACTERS.veil,
			attacks: { dagger: 'dex' },
			bonusActions: []
		});
		expect(def).toMatchObject({ hp: 10, armor: 14, speed: 6 });
		expect(def.sheet).toMatchObject({
			title: 'Halfling Rogue 1 (Criminal)',
			initiative: 5,
			expertise: ['sleight-of-hand', 'stealth']
		});
		// The pregenerated library is untouched, and has no sheet.
		expect(CHARACTERS.veil.sheet).toBeUndefined();
		expect(CHARACTERS.veil.hp).toBe(20);
		// A sheet written by hand (milestone 42's shape) still reads.
		expect(
			readSheet({
				...CHARACTERS.veil,
				actions: [],
				sheet: {
					level: 1,
					abilities: { str: 10, dex: 17, con: 14, int: 12, wis: 13, cha: 8 },
					saves: ['dex', 'int'],
					skills: ['stealth']
				}
			}).ok
		).toBe(true);
	});
});

describe('the catalog at run time', () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-catalog-'));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	it('is the committed catalog, pinned to the SRD 5.2.1', () => {
		expect(catalog.pin).toEqual({
			source: 'srd-5.2.1',
			version: '5.2.1',
			sha256: '8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87'
		});
		expect(catalog.get('class', srd('class', 'fighter'))!.name).toBe('Fighter');
		expect(catalog.get('class', srd('spell', 'fireball'))).toBeUndefined();
		expect(catalog.named('armor', 'Shield')!.data.base).toBe(2);
	});

	it('refuses a file that is not the one its manifest names', () => {
		cpSync(CATALOG_DIR, dir, { recursive: true });
		const file = path.join(dir, 'feat.json');
		writeFileSync(file, readFileSync(file, 'utf8').replace('Alert', 'Alarm'));
		const damaged = openCatalog(dir);
		expect(damaged.get('class', srd('class', 'fighter'))!.name).toBe('Fighter');
		expect(() => damaged.all('feat')).toThrow(CatalogDamaged);
	});
});
