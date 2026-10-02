// Homebrew packs under the fifth edition rules (milestone 52): read and
// checked in full, given ids from their content, layered over the SRD
// catalog without touching it, and offered only where a story has them.

import { describe, expect, it } from 'vitest';
import type { CreatorOptions } from '../../../../src/lib/rules/dnd55e/creator';
import type { HomebrewPack } from '../../../../src/lib/rules/dnd55e/homebrew';
import { openCatalog, srdCatalog, withHomebrew } from '../catalog';
import { dnd55e } from '../index';
import { examplePack } from './example';
import { packId, readPack, type LoadedPack } from './pack';
import { heldPack, holdPack, homebrewMechanics, homebrewRecord } from './registry';

const catalog = srdCatalog();
const srd = (kind: string, slug: string) => `srd-5.2.1:${kind}:${slug}`;
const read = (raw: unknown) => readPack(raw, catalog);
const loaded = (raw: unknown = examplePack()): LoadedPack => {
	const r = read(raw);
	if (!r.ok) throw new Error(r.problems.join('; '));
	return r.loaded;
};
const problems = (raw: unknown) => {
	const r = read(raw);
	return r.ok ? [] : r.problems;
};
/** The example pack with one record changed. */
const withRecord = (i: number, patch: Record<string, unknown>) => {
	const pack = examplePack() as { records: Record<string, unknown>[] };
	pack.records[i] = { ...pack.records[i], ...patch };
	return pack;
};

/** A level 1 Dwarf Wizard with the pack's spells, as a creation page would send it. */
const wizard = (pack: string) => ({
	name: 'Wren',
	color: '#17a589',
	species: { id: srd('species', 'dwarf'), options: {}, feat: null },
	background: { id: srd('background', 'sage'), increases: { int: 2, con: 1 } },
	class: {
		id: srd('class', 'wizard'),
		skills: ['insight', 'investigation'],
		expertise: [],
		fightingStyle: null,
		weaponMasteries: []
	},
	abilities: {
		method: 'standard-array',
		base: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }
	},
	armor: { worn: null, shield: false },
	weapons: [srd('weapon', 'dagger')],
	spells: {
		cantrips: [
			`${pack}:spell:grave-spark`,
			srd('spell', 'fire-bolt'),
			srd('spell', 'ray-of-frost')
		],
		prepared: [`${pack}:spell:barrow-chill`, srd('spell', 'magic-missile')]
	}
});

/** A level 1 Orc Fighter with the pack's blade and coat. */
const fighter = (pack: string) => ({
	name: 'Brann',
	color: '#c0392b',
	species: { id: srd('species', 'orc'), options: {}, feat: null },
	background: { id: srd('background', 'soldier'), increases: { str: 2, con: 1 } },
	class: {
		id: srd('class', 'fighter'),
		skills: ['perception', 'survival'],
		expertise: [],
		fightingStyle: srd('feat', 'defense'),
		weaponMasteries: [
			`${pack}:weapon:barrow-blade`,
			srd('weapon', 'longsword'),
			srd('weapon', 'javelin')
		]
	},
	abilities: {
		method: 'standard-array',
		base: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }
	},
	armor: { worn: `${pack}:armor:ringed-hide`, shield: false },
	weapons: [`${pack}:weapon:barrow-blade`, srd('weapon', 'javelin')]
});

describe('reading a homebrew pack', () => {
	it('reads the example pack into records of the SRD’s shapes, under ids of its own', () => {
		const pack = loaded();
		expect(pack.id).toMatch(/^hb-[0-9a-f]{16}$/);
		expect(pack.records.map((r) => r.id)).toEqual([
			`${pack.id}:weapon:barrow-blade`,
			`${pack.id}:armor:ringed-hide`,
			`${pack.id}:spell:grave-spark`,
			`${pack.id}:spell:barrow-chill`,
			`${pack.id}:monster:mound-crawler`
		]);
		const blade = pack.records[0];
		expect(blade).toMatchObject({
			kind: 'weapon',
			data: {
				category: 'martial',
				damage: '1d8',
				damageType: 'Slashing',
				properties: ['Finesse', 'Versatile (1d10)'],
				versatile: '1d10',
				mastery: 'Vex'
			},
			provenance: { source: pack.id, section: ['The Cold Hill Armory 1.0', 'Weapons'], pages: [] }
		});
		expect(pack.records[1].data).toMatchObject({
			armorClass: '13 + Dex modifier (max 2)',
			dexCap: 2
		});
		expect(pack.mechanics.get(`${pack.id}:spell:grave-spark`)).toMatchObject({
			resolve: 'attack',
			cantrip: 'dice'
		});
		const crawler = [...pack.monsters.values()][0];
		expect(crawler.listing).toMatchObject({
			kind: `${pack.id}-mound-crawler`,
			challenge: '1/2',
			xp: 100,
			notPlayed: ['Earth Glide'],
			source: 'Homebrew: The Cold Hill Armory 1.0'
		});
		expect(crawler.enemy).toMatchObject({
			armor: 12,
			speed: 6,
			vision: 12,
			immune: ['frightened'],
			damage: { resist: ['cold'] },
			attacks: [
				{
					name: 'Bite',
					toHit: 4,
					damage: '1d8+2',
					times: 2,
					plus: { damage: '1d4', damageType: 'cold' },
					inflicts: { conditions: ['prone'], ends: null }
				}
			]
		});
		expect(crawler.enemy!.hp(4)).toBe(16);
	});

	it('gives the same pack the same id, and a changed pack a new one', () => {
		expect(loaded().id).toBe(loaded().id);
		expect(loaded(withRecord(0, { cost: 26 })).id).not.toBe(loaded().id);
		expect(loaded().id).toBe(packId(loaded().pack));
	});

	it('refuses what isn’t a field, and anything that looks like code or markup', () => {
		expect(problems({ ...examplePack(), script: 'x' })).toEqual(['script: not a field of a pack']);
		expect(problems(withRecord(0, { onHit: 'steal()' }))).toEqual([
			'records[0].onHit: not a field of a pack'
		]);
		expect(problems(withRecord(0, { damage: '1d8+${level}' }))[0]).toMatch(
			/records\[0\]\.damage: dice/
		);
		expect(problems(withRecord(0, { damage: 'Math.random()*8' }))[0]).toMatch(/dice/);
		expect(problems(withRecord(0, { damage: '1d7' }))[0]).toMatch(/dice/);
		expect(problems(withRecord(0, { text: '<script>alert(1)</script>' }))).toEqual([
			'records[0].text: no markup, templates or code'
		]);
		expect(problems(withRecord(0, { name: '{{constructor}}' }))).toContain(
			'records[0].name: no markup, templates or code'
		);
		expect(problems('not a pack')).toEqual(['a pack must be an object']);
		const huge = { ...examplePack(), about: 'x'.repeat(200_000) };
		expect(problems(huge)).toEqual(['a pack is at most 128 KB']);
	});

	it('checks every reference against the SRD it extends', () => {
		expect(problems({ ...examplePack(), rules: { id: 'thirdfold-classic', version: 1 } })).toEqual([
			'rules: the fifth edition rules: { "id": "dnd-5.5e", "version": 1 }'
		]);
		const base = { source: 'srd-5.2.1', version: '5.2.1', sha256: '0'.repeat(64) };
		expect(problems({ ...examplePack(), base })).toEqual([
			'base: the catalog it extends: srd-5.2.1 5.2.1'
		]);
		expect(problems(withRecord(0, { mastery: 'Smite' }))[0]).toMatch(
			/^records\[0\]\.mastery: one of Cleave/
		);
		expect(problems(withRecord(0, { damageType: 'Glitter' }))[0]).toMatch(
			/damageType: a damage type/
		);
		expect(problems(withRecord(2, { classes: ['Necromancer'] }))[0]).toMatch(
			/classes: SRD classes by name/
		);
		expect(problems(withRecord(2, { school: 'Chronomancy' }))[0]).toMatch(/school: one of/);
		expect(problems(withRecord(4, { challenge: '1/3' }))[0]).toMatch(
			/challenge: a challenge rating the SRD has/
		);
		expect(problems(withRecord(4, { conditionImmune: ['sleepy'] }))[0]).toMatch(/conditionImmune/);
		expect(problems(withRecord(4, { multiattack: { attack: 'Claw', times: 2 } }))[0]).toMatch(
			/multiattack: repeats one of its attacks/
		);
	});

	it('never takes an SRD record’s name of the same kind, nor a slug twice', () => {
		expect(problems(withRecord(0, { name: 'Longsword' }))).toEqual([
			'records[0].name: the SRD already has a weapon called Longsword'
		]);
		const pack = examplePack() as { records: unknown[] };
		pack.records.push({ ...(pack.records[0] as object), name: 'Second Blade' });
		expect(problems(pack)).toEqual(['records[5].slug: another weapon has it']);
	});

	it('checks that each record holds together the way the rules play it', () => {
		expect(problems(withRecord(0, { properties: ['Finesse'] }))).toContain(
			'records[0].versatile: the two-handed damage of a Versatile weapon, and only of one'
		);
		expect(problems(withRecord(0, { type: 'ranged' }))).toContain(
			'records[0].range: a ranged, Thrown or Ammunition weapon has one'
		);
		const spell = (examplePack() as { records: Record<string, unknown>[] }).records[2];
		const mechanics = { ...(spell.mechanics as object), resolve: 'save' };
		expect(problems(withRecord(2, { mechanics }))).toContain(
			'records[2].mechanics.resolve: a save names its ability, and deals damage or leaves a condition'
		);
		expect(problems(withRecord(3, { duration: 'up to 1 minute' }))).toContain(
			'records[3].duration: a concentration spell lasts "up to" its time, and only one'
		);
		expect(problems(withRecord(1, { base: 19 }))).toEqual([
			'records[1].base: a whole number from 11 to 16'
		]);
	});
});

describe('homebrew over the SRD catalog', () => {
	const pack = loaded();
	holdPack(pack);
	const blade = `${pack.id}:weapon:barrow-blade`;

	it('leaves the SRD’s records, their sources and their credit as they are', () => {
		const fresh = openCatalog();
		for (const kind of ['weapon', 'armor', 'spell', 'monster'] as const) {
			expect(catalog.all(kind)).toEqual(fresh.all(kind));
			expect(catalog.all(kind).every((r) => r.provenance.source === 'srd-5.2.1')).toBe(true);
		}
		expect(catalog.get('weapon', srd('weapon', 'longsword'))).toEqual(
			fresh.get('weapon', srd('weapon', 'longsword'))
		);
		expect(catalog.source.attribution).toContain('SRD 5.2.1');
		expect(catalog.pin).toEqual(fresh.pin);
	});

	it('finds a held pack’s records by id, and offers them only where a story has the pack', () => {
		expect(catalog.get('weapon', blade)?.name).toBe('Barrow Blade');
		expect(catalog.get('armor', blade)).toBeUndefined();
		expect(homebrewRecord(blade)?.provenance.source).toBe(pack.id);
		expect(homebrewMechanics(`${pack.id}:spell:grave-spark`)).toBeDefined();
		const scoped = withHomebrew(catalog, [pack.id]);
		expect(scoped.all('weapon').map((w) => w.name)).toContain('Barrow Blade');
		expect(scoped.all('weapon').slice(0, -1)).toEqual(catalog.all('weapon'));
		const none = withHomebrew(catalog, []);
		expect(none.get('weapon', blade)).toBeUndefined();
		expect(none.all('weapon')).toEqual(catalog.all('weapon'));
		expect(heldPack(pack.id)?.pack.name).toBe('The Cold Hill Armory');
	});

	it('builds a character from a story’s homebrew, and refuses it where the story hasn’t the pack', () => {
		const builder = dnd55e.builder!;
		const options = builder.options([pack.id]) as unknown as CreatorOptions;
		expect(options.weapons.find((w) => w.id === blade)).toMatchObject({
			name: 'Barrow Blade',
			homebrew: 'The Cold Hill Armory 1.0'
		});
		expect(options.weapons.find((w) => w.name === 'Longsword')?.homebrew).toBeUndefined();
		const wizardClass = options.classes.find((c) => c.name === 'Wizard')!;
		expect(wizardClass.spells!.list.find((s) => s.name === 'Grave Spark')).toMatchObject({
			why: null,
			homebrew: 'The Cold Hill Armory 1.0'
		});
		expect(
			(builder.options() as unknown as CreatorOptions).weapons.some((w) => w.id === blade)
		).toBe(false);

		const built = builder.build(fighter(pack.id), 'pc-1', [pack.id]);
		if (!built.ok) throw new Error(built.problems.join('; '));
		// Ringed Hide 13 + Dex 2 (max 2), +1 Defense.
		expect(built.def.armor).toBe(16);
		expect(built.def.actions[0]).toMatchObject({
			id: 'barrow-blade',
			name: 'Barrow Blade',
			damageType: 'slashing'
		});
		const refused = builder.build(fighter(pack.id), 'pc-1', []);
		expect(refused.ok ? [] : refused.problems).toContain(`no weapon "${blade}"`);

		const caster = builder.build(wizard(pack.id), 'pc-2', [pack.id]);
		if (!caster.ok) throw new Error(caster.problems.join('; '));
		const spark = caster.def.actions.find((a) => a.name === 'Grave Spark')!;
		expect(spark).toMatchObject({ kind: 'attack', dice: '1d8', range: 12 });
		const chill = caster.def.actions.find((a) => a.name === 'Barrow Chill')!;
		expect(chill.cast).toMatchObject({ level: 1, area: { shape: 'sphere', size: 2 } });
		// And back from its save, under the story's packs.
		const back = builder.restore(caster.saved, 'pc-2', undefined, [pack.id]);
		expect(back.ok && back.def.actions.map((a) => a.name)).toContain('Grave Spark');
		expect(builder.restore(caster.saved, 'pc-2', undefined, []).ok).toBe(false);
	});

	it('brings a story’s homebrew monsters into the bestiary, and only its', () => {
		const bestiary = dnd55e.bestiary!;
		const kind = `${pack.id}-mound-crawler`;
		expect(bestiary.search('crawler', 5, [pack.id]).map((m) => m.kind)).toEqual([kind]);
		expect(bestiary.search('crawler', 5)).toEqual([]);
		expect(bestiary.search('', 3, [pack.id])[0].kind).toBe(kind);
		expect(bestiary.enemy(kind)?.name).toBe('Mound Crawler');
		expect(bestiary.summary([kind, 'srd-wolf'], [1, 1])).toMatchObject({ xp: 150 });
	});

	it('is plain data all the way down', () => {
		const p: HomebrewPack = pack.pack;
		expect(JSON.parse(JSON.stringify(p))).toEqual(p);
	});
});
