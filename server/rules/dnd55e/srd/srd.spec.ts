import { beforeAll, describe, expect, it } from 'vitest';
import { dnd55e } from '../index';
import { SrdDocument } from './document';
import {
	CATALOG_DIR,
	importSrd,
	readSource,
	SourceMismatch,
	staleCatalog,
	type ImportedCatalog
} from './importer';
import { readPdf } from './pdf';
import { SRD_KINDS, type SrdRecord } from './records';
import { SRD_521 } from './source';
import { validateCatalog } from './validate';

let catalog: ImportedCatalog;
let pageText: Map<number, string>;

beforeAll(async () => {
	const bytes = readSource();
	catalog = await importSrd(bytes);
	const doc = new SrdDocument(await readPdf(bytes));
	pageText = new Map();
	for (const l of doc.lines) pageText.set(l.page, `${pageText.get(l.page) ?? ''}\n${l.text}`);
}, 120_000);

const find = <K extends SrdRecord['kind']>(kind: K, name: string) =>
	catalog.records[kind].find((r) => r.name === name) as Extract<SrdRecord, { kind: K }>;

describe('the SRD 5.2.1 import', () => {
	it('is committed: the catalog is exactly what the pinned source imports to', () => {
		// Run `npm run srd` after changing the importer; the diff is the change to review.
		expect(staleCatalog(CATALOG_DIR, catalog)).toEqual([]);
	});

	it('imports only the pinned file, and refuses any other', async () => {
		const bytes = readSource();
		const changed = bytes.slice();
		changed[changed.length - 10] ^= 1;
		await expect(importSrd(changed)).rejects.toBeInstanceOf(SourceMismatch);
		expect(catalog.manifest.source).toEqual(SRD_521);
	});

	it('passes validation', () => {
		expect(validateCatalog(catalog.manifest, catalog.records)).toEqual([]);
	});

	it('imports every spell, monster, weapon, armor, class, species, background and feat', () => {
		const counts = Object.fromEntries(SRD_KINDS.map((k) => [k, catalog.records[k].length]));
		expect(counts).toEqual({
			rule: 173,
			species: 9,
			background: 4,
			feat: 17,
			class: 12,
			subclass: 12,
			weapon: 38,
			armor: 13,
			spell: 339,
			monster: 330
		});
	});

	it('traces every record to its source, section and pages, where its name is printed', () => {
		const repaired = new Set(
			catalog.diagnostics.filter((d) => d.kind === 'repaired').map((d) => d.at)
		);
		for (const kind of SRD_KINDS)
			for (const r of catalog.records[kind]) {
				expect(r.provenance.source).toBe('srd-5.2.1');
				expect(r.provenance.section.length).toBeGreaterThan(0);
				if (repaired.has(`${kind} ${r.name}`)) continue;
				// Its name is printed on its pages (a heading can run from one page onto the next).
				const text = r.provenance.pages
					.map((p) => pageText.get(p)!)
					.join('\n')
					.replace(/\s+/g, ' ')
					.toLowerCase();
				expect(text, `${r.id} on pages ${r.provenance.pages.join(', ')}`).toContain(
					r.name.toLowerCase()
				);
			}
	});

	it('reads a spell whole', () => {
		const fireball = find('spell', 'Fireball');
		expect(fireball.id).toBe('srd-5.2.1:spell:fireball');
		expect(fireball.data).toEqual({
			level: 3,
			school: 'Evocation',
			classes: ['Sorcerer', 'Wizard'],
			castingTime: 'Action',
			ritual: false,
			range: '150 feet',
			components: { verbal: true, somatic: true, material: 'a ball of bat guano and sulfur' },
			duration: 'Instantaneous',
			concentration: false,
			higherLevels: 'The damage increases by 1d6 for each spell slot level above 3.',
			cantripUpgrade: null
		});
		expect(fireball.text).toContain('taking 8d6 Fire damage on a failed save');
		expect(fireball.provenance.section).toEqual(['Spells', 'Spell Descriptions']);
		expect(find('spell', 'Alarm').data).toMatchObject({ ritual: true, castingTime: '1 minute' });
		expect(find('spell', 'Bless').data).toMatchObject({
			concentration: true,
			duration: 'up to 1 minute'
		});
	});

	it('reads weapons and armor from their tables', () => {
		expect(find('weapon', 'Longsword').data).toEqual({
			category: 'martial',
			type: 'melee',
			damage: '1d8',
			damageType: 'Slashing',
			properties: ['Versatile (1d10)'],
			range: null,
			versatile: '1d10',
			ammunition: null,
			mastery: 'Sap',
			weight: '3 lb.',
			cost: '15 GP'
		});
		expect(find('weapon', 'Heavy Crossbow').data).toMatchObject({
			properties: ['Ammunition (Range 100/400; Bolt)', 'Heavy', 'Loading', 'Two-Handed'],
			range: { normal: 100, long: 400 },
			ammunition: 'Bolt'
		});
		expect(find('armor', 'Chain Mail').data).toMatchObject({
			category: 'heavy',
			base: 16,
			dexCap: 0,
			strength: 13,
			stealthDisadvantage: true
		});
		expect(find('armor', 'Half Plate Armor').data).toMatchObject({ base: 15, dexCap: 2 });
	});

	it('reads a stat block: its numbers, and its blocks by section', () => {
		const dragon = find('monster', 'Adult Red Dragon');
		expect(dragon.data).toMatchObject({
			group: 'Red Dragons',
			size: 'Huge',
			type: 'Dragon (Chromatic)',
			alignment: 'Chaotic Evil',
			armorClass: 19,
			initiative: { bonus: 12, score: 22 },
			hitPoints: { average: 256, formula: '19d12 + 133' },
			challenge: { rating: '17', xp: 18000, xpInLair: 20000, proficiencyBonus: 6 }
		});
		expect(dragon.data.abilities.str).toEqual({ score: 27, modifier: 8, save: 8 });
		expect(dragon.data.actions.map((a) => a.name)).toEqual([
			'Multiattack',
			'Rend',
			'Fire Breath (Recharge 5–6)',
			'Spellcasting'
		]);
		expect(dragon.data.legendaryActions.map((a) => a.name)).toEqual([
			'Commanding Presence',
			'Fiery Rays',
			'Pounce'
		]);
		expect(find('monster', 'Commoner').data.challenge).toEqual({
			rating: '0',
			xp: 10,
			xpInLair: null,
			proficiencyBonus: 2
		});
	});

	it('reads character options: species, backgrounds, feats, classes and subclasses', () => {
		expect(find('species', 'Dwarf').data).toMatchObject({ creatureType: 'Humanoid', speed: 30 });
		expect(find('species', 'Dwarf').data.traits.map((t) => t.name)).toEqual([
			'Darkvision',
			'Dwarven Resilience',
			'Dwarven Toughness',
			'Stonecunning'
		]);
		expect(find('background', 'Acolyte').data).toMatchObject({
			abilities: ['Intelligence', 'Wisdom', 'Charisma'],
			feat: 'Magic Initiate (Cleric)',
			skills: ['Insight', 'Religion']
		});
		expect(find('feat', 'Grappler').data).toMatchObject({
			category: 'general',
			prerequisite: 'Level 4+, Strength or Dexterity 13+'
		});
		const fighter = find('class', 'Fighter').data;
		expect(fighter).toMatchObject({ hitDie: 'D10', savingThrows: ['Strength', 'Constitution'] });
		expect(fighter.levels[0]).toEqual({
			level: 1,
			proficiencyBonus: 2,
			features: ['Fighting Style', 'Second Wind', 'Weapon Mastery'],
			columns: { 'Second Wind': '2', 'Weapon Mastery': '3' }
		});
		expect(find('class', 'Wizard').data.levels[4].columns).toMatchObject({
			Cantrips: '4',
			'Prepared Spells': '9',
			'Spell Slots 3': '2'
		});
		expect(find('subclass', 'Champion').data).toMatchObject({ class: 'Fighter' });
	});

	it('reads the rules glossary, conditions tagged', () => {
		const blinded = find('rule', 'Blinded');
		expect(blinded.data.tag).toBe('Condition');
		expect(blinded.text).toContain('automatically fail any ability check that requires sight');
		const rules = catalog.records.rule as Extract<SrdRecord, { kind: 'rule' }>[];
		const conditions = rules.filter((r) => r.data.tag === 'Condition');
		expect(conditions).toHaveLength(15);
		// A weapon property and a glossary term of the same name have ids of their own.
		expect(catalog.records.rule.filter((r) => r.name === 'Reach').map((r) => r.id)).toEqual([
			'srd-5.2.1:rule:reach',
			'srd-5.2.1:rule:weapon-property-reach'
		]);
	});

	it('names every correction it made to the source', () => {
		expect(catalog.diagnostics.map((d) => d.kind)).toEqual(
			catalog.diagnostics.map(() => 'repaired')
		);
		expect(catalog.diagnostics.map((d) => d.at)).toContain('spell Acid Splash');
		expect(catalog.manifest.notImported.length).toBeGreaterThan(0);
	});

	it('carries the attribution the licence requires, the same the rules show', () => {
		expect(catalog.manifest.source.license.id).toBe('CC-BY-4.0');
		expect(catalog.manifest.source.attribution).toBe(dnd55e.attribution);
	});
});

describe('catalog validation', () => {
	it('names what is wrong with a damaged catalog', () => {
		const records = structuredClone(catalog.records);
		records.spell[0] = {
			...records.spell[0],
			data: { ...records.spell[0].data, classes: ['Jester'] }
		} as SrdRecord;
		records.monster.push(records.monster[0]);
		records.weapon[0] = {
			...records.weapon[0],
			provenance: { ...records.weapon[0].provenance, pages: [900] }
		} as SrdRecord;
		const manifest = {
			...catalog.manifest,
			files: {
				...catalog.manifest.files,
				monster: { ...catalog.manifest.files.monster, count: records.monster.length }
			}
		};
		const problems = validateCatalog(manifest, records);
		expect(problems).toEqual(
			expect.arrayContaining([
				`${records.spell[0].id}: no class "Jester"`,
				`${records.monster[0].id}: id used twice`,
				`${records.weapon[0].id}: pages out of order or out of the source`
			])
		);
	});
});
