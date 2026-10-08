// Reading a homebrew pack (milestone 52, src/lib/rules/dnd55e/homebrew.ts):
// every field checked against what the SRD catalog it extends allows, the
// rest refused, and each record made into a catalog record of its kind,
// exactly the shape the SRD's own records have, so the rules read a
// homebrew longsword the way they read the SRD's. A record never takes an
// SRD id (its id starts with the pack's, made from the pack's content) and
// never an SRD record's name of the same kind, so it extends the catalog
// and can't pass for, or replace, what the SRD says.
//
// Nothing in a pack runs: dice are read as plain NdX (+ M), numbers are
// bounded numbers, and words that look like markup or code are refused.

import { createHash } from 'node:crypto';
import {
	HOMEBREW_FORMAT,
	HOMEBREW_FORMAT_VERSION,
	HOMEBREW_KINDS,
	HOMEBREW_LIMITS,
	WEAPON_PROPERTIES,
	type AbilityKey,
	type HomebrewArmor,
	type HomebrewAttack,
	type HomebrewKind,
	type HomebrewMonster,
	type HomebrewPack,
	type HomebrewRecord,
	type HomebrewSpell,
	type HomebrewSpellMechanics,
	type HomebrewWeapon
} from '../../../../src/lib/rules/dnd55e/homebrew';
import type { Catalog } from '../catalog';
import { CONDITIONS } from '../conditions';
import { readMonster, type Monster } from '../monsters';
import { DAMAGE_TYPES } from '../sheet';
import type { SpellMechanics } from '../spells/mechanics';
import type { MonsterData, SrdRecord } from '../srd/records';

/** A pack read and checked: its id, the pack as read, its records as the catalog holds them. */
export interface LoadedPack {
	id: string;
	pack: HomebrewPack;
	records: SrdRecord[];
	/** How its spells with mechanics are cast, by record id. */
	mechanics: ReadonlyMap<string, SpellMechanics>;
	/** Its monsters as the table plays them, by enemy kind. */
	monsters: ReadonlyMap<string, Monster>;
}

export type PackRead = { ok: true; loaded: LoadedPack } | { ok: false; problems: string[] };

const ABILITIES: readonly AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;
const VERSION = /^\d{1,4}(?:\.\d{1,4}){0,2}$/;
/** Dice as a pack may write them: NdX, a die the table rolls, and a flat bonus. */
const DICE = /^([1-9]\d?)d(4|6|8|10|12|20)(?:\s*([+-])\s*(\d{1,2}))?$/;
const FLAT = /^[1-9]\d?$/;
/** Words that look like markup, a template or code: never in a pack. */
const CODE = /<\s*\/?\s*[a-z!?]|javascript:|data:|\$\{|\{\{|=>|\bfunction\s*\(|\beval\s*\(/i;
const AMMUNITION = ['Arrow', 'Bolt', 'Needle'];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const titled = (s: string) => s[0].toUpperCase() + s.slice(1);
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/**
 * The pack's id: `hb-` (a creator's homebrew) or `lc-` (a licensed source's
 * content, milestone 59) and the start of the SHA-256 of the pack as read.
 */
export function packId(pack: HomebrewPack, licensedBy?: string): string {
	// A licensed source's id goes into its hash too: two sources never share an id.
	const hashed = licensedBy ? { source: licensedBy, pack } : pack;
	const hex = createHash('sha256').update(JSON.stringify(hashed)).digest('hex').slice(0, 16);
	return `${licensedBy ? 'lc' : 'hb'}-${hex}`;
}

/**
 * A licensed source's content is read as a pack is, under its terms
 * (milestone 59): its ids start `lc-`, its publisher's marks may appear
 * nowhere in it, and with `display: 'mechanics'` its own words (records'
 * descriptions and traits' text) are left out of what the table holds.
 */
export interface LicensedRead {
	/** The source, as `<id>@<version>`. */
	source: string;
	display: 'full' | 'mechanics';
	trademarks: readonly string[];
}

/** What a record shows instead of words its licence keeps back. */
export const WITHHELD_TEXT = 'Not shown under its licence.';

/** What the SRD it extends allows: its classes, schools, masteries, challenge ratings and names. */
function srdTerms(catalog: Catalog) {
	const challenge = new Map<string, { xp: number; pb: number }>();
	for (const m of catalog.all('monster'))
		challenge.set(m.data.challenge.rating, {
			xp: m.data.challenge.xp,
			pb: m.data.challenge.proficiencyBonus
		});
	const names = (kind: HomebrewKind) => new Set(catalog.all(kind).map((r) => r.name.toLowerCase()));
	return {
		classes: new Set(catalog.all('class').map((c) => c.name)),
		schools: new Set(catalog.all('spell').map((s) => s.data.school)),
		masteries: new Set(catalog.all('weapon').map((w) => w.data.mastery)),
		challenge,
		names: Object.fromEntries(HOMEBREW_KINDS.map((k) => [k, names(k)])) as Record<
			HomebrewKind,
			Set<string>
		>
	};
}

/** Reads a pack; every problem is named by where it is. */
export function readPack(raw: unknown, catalog: Catalog, licensed?: LicensedRead): PackRead {
	const problems: string[] = [];
	let size: number;
	try {
		size = JSON.stringify(raw)?.length ?? 0;
	} catch {
		return { ok: false, problems: ['a pack must be plain JSON'] };
	}
	if (size > HOMEBREW_LIMITS.bytes)
		return { ok: false, problems: [`a pack is at most ${HOMEBREW_LIMITS.bytes / 1024} KB`] };
	if (!isObject(raw)) return { ok: false, problems: ['a pack must be an object'] };
	const terms = srdTerms(catalog);

	// A reader over one object: each field taken once, anything left over refused.
	const reader = (obj: Raw, at: string) => {
		const used = new Set<string>();
		const bad = (field: string, what: string) => problems.push(`${at}${field}: ${what}`);
		const take = (field: string) => {
			used.add(field);
			return obj[field];
		};
		const r = {
			bad,
			text(field: string, max: number, optional = false): string | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (typeof v !== 'string' || !v.trim() || v.length > max) {
					bad(field, `text of 1 to ${max} characters`);
					return undefined;
				}
				if (CODE.test(v)) bad(field, 'no markup, templates or code');
				return v.trim();
			},
			int(field: string, min: number, max: number, optional = false): number | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
					bad(field, `a whole number from ${min} to ${max}`);
					return undefined;
				}
				return v;
			},
			bool(field: string): boolean | undefined {
				const v = take(field);
				if (typeof v !== 'boolean') {
					bad(field, 'true or false');
					return undefined;
				}
				return v;
			},
			oneOf<T extends string>(
				field: string,
				values: readonly T[],
				optional = false
			): T | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (typeof v !== 'string' || !values.includes(v as T)) {
					bad(field, `one of ${values.join(', ')}`);
					return undefined;
				}
				return v as T;
			},
			dice(field: string, flat = false, optional = false): string | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (typeof v !== 'string' || !(DICE.test(v.trim()) || (flat && FLAT.test(v.trim())))) {
					bad(field, `dice such as 1d8 or 2d6 + 3${flat ? ', or a flat number' : ''}`);
					return undefined;
				}
				return v.replace(/\s+/g, '');
			},
			object(field: string, optional = false): Raw | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (!isObject(v)) {
					bad(field, 'an object');
					return undefined;
				}
				return v;
			},
			list(field: string, max: number, optional = false): unknown[] | undefined {
				const v = take(field);
				if (v === undefined && optional) return undefined;
				if (!Array.isArray(v) || v.length > max) {
					bad(field, `a list of at most ${max}`);
					return undefined;
				}
				return v;
			},
			/** A field's value as it is, for values read by hand. */
			raw(field: string): unknown {
				return take(field);
			},
			done() {
				for (const k of Object.keys(obj)) if (!used.has(k)) bad(k, 'not a field of a pack');
			}
		};
		return r;
	};
	const damageType = (r: ReturnType<typeof reader>, field: string, v: unknown) => {
		if (typeof v !== 'string' || !DAMAGE_TYPES.includes(v.toLowerCase())) {
			r.bad(field, 'a damage type (Acid, Bludgeoning, Cold, Fire, Force, …)');
			return undefined;
		}
		return titled(v.toLowerCase());
	};

	const top = reader(raw, '');
	if (top.oneOf('format', [HOMEBREW_FORMAT]) === undefined) return { ok: false, problems };
	if (top.int('formatVersion', HOMEBREW_FORMAT_VERSION, HOMEBREW_FORMAT_VERSION) === undefined)
		return { ok: false, problems: [`only format version ${HOMEBREW_FORMAT_VERSION} is read`] };
	const name = top.text('name', HOMEBREW_LIMITS.name);
	const version = top.text('version', 14);
	if (version && !VERSION.test(version)) top.bad('version', 'a version such as 1.0 or 2.1.3');
	const rules = top.object('rules');
	if (rules && (rules.id !== 'dnd-5.5e' || rules.version !== 1 || Object.keys(rules).length !== 2))
		top.bad('rules', 'the fifth edition rules: { "id": "dnd-5.5e", "version": 1 }');
	const base = top.object('base');
	if (
		base &&
		(base.source !== catalog.pin.source ||
			base.version !== catalog.pin.version ||
			base.sha256 !== catalog.pin.sha256 ||
			Object.keys(base).length !== 3)
	)
		top.bad('base', `the catalog it extends: ${catalog.pin.source} ${catalog.pin.version}`);
	const creator = top.text('creator', 40, true);
	const about = top.text('about', HOMEBREW_LIMITS.about, true);
	const license = top.text('license', 60, true);
	const list = top.list('records', HOMEBREW_LIMITS.records) ?? [];
	top.done();
	if (!list.length && !problems.length) problems.push('records: at least one');

	const records: HomebrewRecord[] = [];
	const slugs = new Set<string>();
	list.forEach((item, i) => {
		const at = `records[${i}].`;
		if (!isObject(item)) {
			problems.push(`records[${i}]: an object`);
			return;
		}
		const r = reader(item, at);
		const kind = r.oneOf('kind', HOMEBREW_KINDS);
		const slug = r.text('slug', 48);
		if (slug && !SLUG.test(slug)) r.bad('slug', 'lowercase words joined by hyphens');
		if (kind && slug) {
			if (slugs.has(`${kind}:${slug}`)) r.bad('slug', `another ${kind} has it`);
			slugs.add(`${kind}:${slug}`);
		}
		const recordName = r.text('name', HOMEBREW_LIMITS.name);
		if (kind && recordName && terms.names[kind].has(recordName.toLowerCase()))
			r.bad('name', `the SRD already has a ${kind} called ${recordName}`);
		const text = r.text('text', HOMEBREW_LIMITS.text, true);
		if (!kind || !slug || !recordName) return;
		const common = { kind, slug, name: recordName, ...(text ? { text } : {}) };
		const read =
			kind === 'weapon'
				? weapon(r, common as HomebrewWeapon, at)
				: kind === 'armor'
					? armor(r, common as HomebrewArmor)
					: kind === 'spell'
						? spell(r, common as HomebrewSpell, at)
						: monster(r, common as HomebrewMonster, at);
		r.done();
		if (read) records.push(read);
	});

	function weapon(
		r: ReturnType<typeof reader>,
		w: HomebrewWeapon,
		at: string
	): HomebrewWeapon | null {
		const category = r.oneOf('category', ['simple', 'martial'] as const);
		const type = r.oneOf('type', ['melee', 'ranged'] as const);
		const damage = r.dice('damage', true);
		const dt = damageType(r, 'damageType', r.raw('damageType'));
		const props = (r.list('properties', WEAPON_PROPERTIES.length) ?? []).filter((p, i, all) => {
			if (
				!WEAPON_PROPERTIES.includes(p as (typeof WEAPON_PROPERTIES)[number]) ||
				all.indexOf(p) !== i
			) {
				r.bad('properties', `each once, from ${WEAPON_PROPERTIES.join(', ')}`);
				return false;
			}
			return true;
		}) as HomebrewWeapon['properties'];
		const has = (p: string) => props.includes(p as (typeof WEAPON_PROPERTIES)[number]);
		const rangeRaw = r.object('range', true);
		let range: HomebrewWeapon['range'];
		if (rangeRaw) {
			const rr = reader(rangeRaw, `${at}range.`);
			const normal = rr.int('normal', 5, 600);
			const long = rr.int('long', 5, 1200);
			rr.done();
			if (normal && long) {
				if (normal % 5 || long % 5 || long < normal)
					r.bad('range', 'feet in fives, the long range at least the normal');
				range = { normal, long };
			}
		}
		const needsRange = type === 'ranged' || has('Thrown') || has('Ammunition');
		if (needsRange !== !!rangeRaw)
			r.bad(
				'range',
				needsRange
					? 'a ranged, Thrown or Ammunition weapon has one'
					: 'only for a ranged, Thrown or Ammunition weapon'
			);
		if (type === 'ranged' && !has('Thrown') && !has('Ammunition'))
			r.bad('properties', 'a ranged weapon is Thrown or fires Ammunition');
		const versatile = r.dice('versatile', false, true);
		if (has('Versatile') !== !!versatile)
			r.bad('versatile', 'the two-handed damage of a Versatile weapon, and only of one');
		if (has('Versatile') && (has('Two-Handed') || type === 'ranged'))
			r.bad('properties', 'a Versatile weapon is a melee weapon held in one or two hands');
		const ammunition = r.oneOf('ammunition', AMMUNITION, true);
		if (has('Ammunition') !== !!ammunition)
			r.bad('ammunition', 'what an Ammunition weapon fires, and only for one');
		const mastery = r.raw('mastery');
		if (typeof mastery !== 'string' || !terms.masteries.has(mastery))
			r.bad('mastery', `one of ${[...terms.masteries].sort().join(', ')}`);
		const weight = r.int('weight', 0, 100);
		const cost = r.int('cost', 0, 100_000);
		if (!category || !type || !damage || !dt || weight === undefined || cost === undefined)
			return null;
		return {
			...w,
			category,
			type,
			damage,
			damageType: dt,
			properties: props,
			...(range ? { range } : {}),
			...(versatile ? { versatile } : {}),
			...(ammunition ? { ammunition } : {}),
			mastery: mastery as string,
			weight,
			cost
		};
	}

	function armor(r: ReturnType<typeof reader>, a: HomebrewArmor): HomebrewArmor | null {
		const category = r.oneOf('category', ['light', 'medium', 'heavy', 'shield'] as const);
		const bounds = { light: [10, 14], medium: [11, 16], heavy: [13, 20], shield: [1, 3] } as const;
		const [lo, hi] = category ? bounds[category] : [1, 20];
		const base = r.int('base', lo, hi);
		const strength = r.int('strength', 10, 18, true);
		if (strength !== undefined && category !== 'heavy')
			r.bad('strength', 'only heavy armor needs Strength');
		const stealth = r.bool('stealthDisadvantage');
		const weight = r.int('weight', 0, 100);
		const cost = r.int('cost', 0, 100_000);
		if (!category || base === undefined || stealth === undefined) return null;
		if (weight === undefined || cost === undefined) return null;
		return {
			...a,
			category,
			base,
			...(strength !== undefined ? { strength } : {}),
			stealthDisadvantage: stealth,
			weight,
			cost
		};
	}

	function spell(r: ReturnType<typeof reader>, s: HomebrewSpell, at: string): HomebrewSpell | null {
		const level = r.int('level', 0, 9);
		const school = r.oneOf('school', [...terms.schools]);
		const classes = (r.list('classes', 12) ?? []).filter((c) => {
			if (typeof c !== 'string' || !terms.classes.has(c)) {
				r.bad('classes', `SRD classes by name: ${[...terms.classes].join(', ')}`);
				return false;
			}
			return true;
		}) as string[];
		if (!classes.length) r.bad('classes', 'at least one class may prepare it');
		const castingTime = r.oneOf('castingTime', ['Action', 'Bonus Action'] as const);
		const range = r.text('range', 20);
		if (range && !/^(Self|Touch|[1-9]\d{0,2}0? feet)$/.test(range))
			r.bad('range', 'Self, Touch, or a distance such as 60 feet');
		const concentration = r.bool('concentration');
		const duration = r.text('duration', 30);
		const timed = /^(up to )?(\d{1,2}) (round|minute|hour)s?$/.exec(duration ?? '');
		if (duration && duration !== 'Instantaneous' && !timed)
			r.bad(
				'duration',
				'Instantaneous, or a time such as 1 minute (up to 1 minute with concentration)'
			);
		if (duration && concentration !== undefined && !!timed?.[1] !== concentration)
			r.bad('duration', 'a concentration spell lasts "up to" its time, and only one');
		const comps = r.object('components');
		let components: HomebrewSpell['components'] | undefined;
		if (comps) {
			const c = reader(comps, `${at}components.`);
			const verbal = c.bool('verbal');
			const somatic = c.bool('somatic');
			const material =
				comps.material === null ? (c.raw('material'), null) : c.text('material', 120);
			c.done();
			components =
				verbal !== undefined && somatic !== undefined
					? { verbal, somatic, material: material ?? null }
					: undefined;
		}
		const mech = r.object('mechanics', true);
		const mechanics =
			mech && range && level !== undefined
				? spellMechanics(mech, level, range, `${at}mechanics.`)
				: undefined;
		if (level === undefined || !school || !castingTime || !range || !duration) return null;
		if (concentration === undefined || !components) return null;
		return {
			...s,
			level,
			school,
			classes,
			castingTime,
			range,
			duration,
			concentration,
			components,
			...(mechanics ? { mechanics } : {})
		};
	}

	function spellMechanics(
		raw: Raw,
		level: number,
		range: string,
		at: string
	): HomebrewSpellMechanics | undefined {
		const r = reader(raw, at);
		const resolve = r.oneOf('resolve', ['attack', 'save', 'heal', 'auto'] as const);
		const attack = r.oneOf('attack', ['melee', 'ranged'] as const, true);
		const saveRaw = r.object('save', true);
		let save: HomebrewSpellMechanics['save'];
		if (saveRaw) {
			const sr = reader(saveRaw, `${at}save.`);
			const ability = sr.oneOf('ability', ABILITIES);
			const half = sr.bool('half');
			sr.done();
			if (ability && half !== undefined) save = { ability, half };
		}
		const dmgRaw = r.object('damage', true);
		let damage: HomebrewSpellMechanics['damage'];
		if (dmgRaw) {
			const dr = reader(dmgRaw, `${at}damage.`);
			const dice = dr.dice('dice');
			const type = damageType(dr, 'type', dr.raw('type'));
			const perSlot = dr.dice('perSlot', false, true);
			dr.done();
			if (dice && type) damage = { dice, type, ...(perSlot ? { perSlot } : {}) };
		}
		const healRaw = r.object('heal', true);
		let heal: HomebrewSpellMechanics['heal'];
		if (healRaw) {
			const hr = reader(healRaw, `${at}heal.`);
			const dice = hr.dice('dice');
			const perSlot = hr.dice('perSlot');
			hr.done();
			if (dice && perSlot) heal = { dice, perSlot };
		}
		const tRaw = r.object('targets');
		let targets: HomebrewSpellMechanics['targets'] | undefined;
		if (tRaw) {
			const tr = reader(tRaw, `${at}targets.`);
			const count = tr.int('count', 1, 10);
			const perSlot = tr.int('perSlot', 0, 3);
			const side = tr.oneOf('side', ['enemy', 'ally'] as const);
			tr.done();
			if (count && perSlot !== undefined && side) targets = { count, perSlot, side };
		}
		const cantripRaw = r.raw('cantrip');
		const cantrip = cantripRaw === undefined ? undefined : cantripRaw === true;
		if (cantripRaw !== undefined && typeof cantripRaw !== 'boolean')
			r.bad('cantrip', 'true or false');
		const areaRaw = r.object('area', true);
		let area: HomebrewSpellMechanics['area'];
		if (areaRaw) {
			const ar = reader(areaRaw, `${at}area.`);
			const shape = ar.oneOf('shape', ['cone', 'cube', 'sphere'] as const);
			const feet = ar.int('feet', 5, 60);
			ar.done();
			if (shape && feet) {
				if (feet % 5) r.bad('area', 'feet in fives');
				area = { shape, feet };
			}
		}
		const push = r.int('push', 5, 30, true);
		const failRaw = r.object('onFail', true);
		let onFail: HomebrewSpellMechanics['onFail'];
		if (failRaw) {
			const fr = reader(failRaw, `${at}onFail.`);
			const conditions = (fr.list('conditions', 3) ?? []).filter((c) => {
				const known = typeof c === 'string' && CONDITIONS.some((x) => x.id === c);
				if (!known) fr.bad('conditions', 'conditions by id: blinded, charmed, frightened, …');
				return known;
			}) as string[];
			fr.done();
			if (conditions.length) onFail = { conditions };
		}
		r.done();
		// What each way of resolving needs, and only it.
		const need = (ok: boolean, what: string) => ok || r.bad('resolve', what);
		if (resolve === 'attack') {
			need(
				!!attack && !!damage && !save && !heal && !area,
				'an attack has its kind (melee or ranged) and damage, and no save, healing or area'
			);
		} else if (resolve === 'save') {
			need(
				!!save && (!!damage || !!onFail) && !attack && !heal,
				'a save names its ability, and deals damage or leaves a condition'
			);
		} else if (resolve === 'heal') {
			need(
				!!heal && !damage && !attack && !save && !area && targets?.side === 'ally',
				'healing heals allies, and does nothing else'
			);
		} else if (resolve === 'auto') {
			need(
				!!damage && !attack && !save && !heal && !area,
				'a spell that always lands deals damage, with no roll'
			);
		}
		if (push && resolve !== 'save') r.bad('push', 'a push comes with a failed save');
		if (onFail && resolve !== 'save') r.bad('onFail', 'conditions come with a failed save');
		if (cantrip && (level !== 0 || !damage))
			r.bad('cantrip', 'only a damage cantrip grows with level');
		if (level === 0 && (damage?.perSlot || heal))
			r.bad('resolve', 'a cantrip takes no slot to grow by, and heals nobody');
		if (area) {
			if (area.shape === 'sphere' ? !/feet$/.test(range) : range !== 'Self')
				r.bad(
					'area',
					'a cone or cube runs from a caster whose range is Self; a sphere is aimed at a point in range'
				);
			if (targets && targets.side !== 'enemy') r.bad('area', 'an area catches foes');
		} else if (range === 'Self' && resolve !== 'heal')
			r.bad('range', 'a spell on others has a range');
		if (!resolve || !targets) return undefined;
		return {
			resolve,
			...(attack ? { attack } : {}),
			...(save ? { save } : {}),
			...(damage ? { damage } : {}),
			...(heal ? { heal } : {}),
			targets,
			...(cantrip ? { cantrip } : {}),
			...(area ? { area } : {}),
			...(push ? { push } : {}),
			...(onFail ? { onFail } : {})
		};
	}

	function monster(
		r: ReturnType<typeof reader>,
		m: HomebrewMonster,
		at: string
	): HomebrewMonster | null {
		const size = r.oneOf('size', SIZES as HomebrewMonster['size'][]);
		const type = r.text('type', 40);
		const alignment = r.text('alignment', 40, true);
		const armorClass = r.int('armorClass', 5, 30);
		const hitPoints = r.int('hitPoints', 1, 999);
		const speed = r.int('speed', 0, 120);
		if (speed !== undefined && speed % 5) r.bad('speed', 'feet in fives');
		const abilitiesRaw = r.object('abilities');
		let abilities: HomebrewMonster['abilities'] | undefined;
		if (abilitiesRaw) {
			const ar = reader(abilitiesRaw, `${at}abilities.`);
			const scores = ABILITIES.map((a) => ar.int(a, 1, 30));
			ar.done();
			if (scores.every((s) => s !== undefined))
				abilities = Object.fromEntries(
					ABILITIES.map((a, i) => [a, scores[i]!])
				) as HomebrewMonster['abilities'];
		}
		const savesRaw = r.object('saves', true);
		let saves: HomebrewMonster['saves'];
		if (savesRaw) {
			const sr = reader(savesRaw, `${at}saves.`);
			saves = {};
			for (const a of ABILITIES) {
				const v = sr.int(a, -5, 20, true);
				if (v !== undefined) saves[a] = v;
			}
			sr.done();
		}
		const challenge = r.text('challenge', 4);
		if (challenge && !terms.challenge.has(challenge))
			r.bad(
				'challenge',
				`a challenge rating the SRD has: ${[...terms.challenge.keys()].join(', ')}`
			);
		const darkvision = r.int('darkvision', 5, 120, true);
		const damageList = (field: 'immune' | 'resist' | 'vulnerable') =>
			((r.list(field, DAMAGE_TYPES.length, true) ?? []) as unknown[]).flatMap((v) => {
				const t = damageType(r, field, v);
				return t ? [t] : [];
			});
		const immune = damageList('immune');
		const resist = damageList('resist');
		const vulnerable = damageList('vulnerable');
		const conditionImmune = (
			(r.list('conditionImmune', CONDITIONS.length, true) ?? []) as unknown[]
		).flatMap((c) => {
			if (typeof c === 'string' && CONDITIONS.some((x) => x.id === c)) return [c];
			r.bad('conditionImmune', 'conditions by id');
			return [];
		});
		const traits = ((r.list('traits', 8, true) ?? []) as unknown[]).flatMap((t, i) => {
			if (!isObject(t)) {
				r.bad(`traits[${i}]`, 'an object');
				return [];
			}
			const tr = reader(t, `${at}traits[${i}].`);
			const n = tr.text('name', 40);
			const x = tr.text('text', 600);
			tr.done();
			return n && x ? [{ name: n, text: x }] : [];
		});
		const attacks = ((r.list('attacks', 4) ?? []) as unknown[]).flatMap((a, i) => {
			const read = isObject(a) ? monsterAttack(a, `${at}attacks[${i}].`) : null;
			if (!isObject(a)) r.bad(`attacks[${i}]`, 'an object');
			return read ? [read] : [];
		});
		if (!attacks.length) r.bad('attacks', 'at least one attack the table can play');
		if (new Set(attacks.map((a) => a.name.toLowerCase())).size !== attacks.length)
			r.bad('attacks', 'each with its own name');
		const multiRaw = r.object('multiattack', true);
		let multiattack: HomebrewMonster['multiattack'];
		if (multiRaw) {
			const mr = reader(multiRaw, `${at}multiattack.`);
			const attack = mr.text('attack', 40);
			const times = mr.int('times', 2, 6);
			mr.done();
			if (attack && !attacks.some((a) => a.name === attack))
				r.bad('multiattack', 'repeats one of its attacks, by name');
			if (attack && times) multiattack = { attack, times };
		}
		if (!size || !type || !armorClass || !hitPoints || speed === undefined || !abilities)
			return null;
		if (!challenge || !terms.challenge.has(challenge) || !attacks.length) return null;
		return {
			...m,
			size,
			type,
			...(alignment ? { alignment } : {}),
			armorClass,
			hitPoints,
			speed,
			abilities,
			...(saves && Object.keys(saves).length ? { saves } : {}),
			challenge,
			...(darkvision ? { darkvision } : {}),
			...(immune.length ? { immune } : {}),
			...(resist.length ? { resist } : {}),
			...(vulnerable.length ? { vulnerable } : {}),
			...(conditionImmune.length ? { conditionImmune } : {}),
			...(traits.length ? { traits } : {}),
			attacks,
			...(multiattack ? { multiattack } : {})
		};
	}

	function monsterAttack(raw: Raw, at: string): HomebrewAttack | null {
		const r = reader(raw, at);
		const name = r.text('name', 40);
		if (name && (name === 'Multiattack' || !/^[A-Z][\w’' -]*$/.test(name)))
			r.bad('name', 'a name that starts with a capital letter, in words');
		const kind = r.oneOf('kind', ['melee', 'ranged'] as const);
		const toHit = r.int('toHit', -5, 20);
		const reach = r.int('reach', 5, 30, true);
		const rangeRaw = r.object('range', true);
		let range: HomebrewAttack['range'];
		if (rangeRaw) {
			const rr = reader(rangeRaw, `${at}range.`);
			const normal = rr.int('normal', 10, 600);
			const long = rr.int('long', 10, 1200);
			rr.done();
			if (normal && long) range = { normal, long };
		}
		if (kind === 'melee' && (!reach || range))
			r.bad('reach', 'a melee attack has a reach, and no range');
		if (kind === 'ranged' && (!range || reach))
			r.bad('range', 'a ranged attack has a range, and no reach');
		if ((reach && reach % 5) || (range && (range.normal % 5 || range.long < range.normal)))
			r.bad('range', 'feet in fives, the long range at least the normal');
		const damage = r.dice('damage');
		const dt = damageType(r, 'damageType', r.raw('damageType'));
		const plusRaw = r.object('plus', true);
		let plus: HomebrewAttack['plus'];
		if (plusRaw) {
			const pr = reader(plusRaw, `${at}plus.`);
			const d = pr.dice('damage');
			const t = damageType(pr, 'damageType', pr.raw('damageType'));
			pr.done();
			if (d && t) plus = { damage: d, damageType: t };
		}
		const proneRaw = r.raw('prone');
		if (proneRaw !== undefined && typeof proneRaw !== 'boolean') r.bad('prone', 'true or false');
		r.done();
		if (!name || !kind || toHit === undefined || !damage || !dt) return null;
		return {
			name,
			kind,
			toHit,
			...(reach ? { reach } : {}),
			...(range ? { range } : {}),
			damage,
			damageType: dt,
			...(plus ? { plus } : {}),
			...(proneRaw === true ? { prone: true } : {})
		};
	}

	if (problems.length || !name || !version || !rules || !base)
		return { ok: false, problems: problems.length ? problems : ['the pack is incomplete'] };
	const pack: HomebrewPack = {
		format: HOMEBREW_FORMAT,
		formatVersion: HOMEBREW_FORMAT_VERSION,
		name,
		version,
		rules: { id: 'dnd-5.5e', version: 1 },
		base: { ...catalog.pin },
		...(creator ? { creator } : {}),
		...(about ? { about } : {}),
		...(license ? { license } : {}),
		records
	};
	if (!licensed) return compilePack(pack, terms.challenge, packId(pack));
	// The marks stay out of the content; the words stay out where the licence says so.
	const marks = licensed.trademarks.map((m) => m.toLowerCase());
	for (const r of pack.records) {
		const words = [
			r.name,
			r.text ?? '',
			...(r.kind === 'monster' ? (r.traits ?? []).flatMap((t) => [t.name, t.text]) : [])
		]
			.join(' ')
			.toLowerCase();
		for (const [i, mark] of marks.entries())
			if (words.includes(mark))
				problems.push(
					`${r.kind} ${r.slug}: names the publisher's mark "${licensed.trademarks[i]}"`
				);
	}
	if (problems.length) return { ok: false, problems };
	const id = packId(pack, licensed.source);
	if (licensed.display === 'full') return compilePack(pack, terms.challenge, id);
	const shown: HomebrewPack = {
		...pack,
		...(pack.about ? { about: WITHHELD_TEXT } : {}),
		records: pack.records.map((r) => {
			const rest = { ...r };
			delete rest.text;
			return r.kind === 'monster' && r.traits
				? ({
						...rest,
						traits: r.traits.map((t) => ({ name: t.name, text: WITHHELD_TEXT }))
					} as typeof r)
				: (rest as typeof r);
		})
	};
	return compilePack(shown, terms.challenge, id);
}

/** A checked pack's records as the catalog holds them, its spells' mechanics and its monsters. */
function compilePack(
	pack: HomebrewPack,
	challenge: ReadonlyMap<string, { xp: number; pb: number }>,
	id: string
): PackRead {
	const records: SrdRecord[] = [];
	const mechanics = new Map<string, SpellMechanics>();
	const monsters = new Map<string, Monster>();
	const section = (kind: string) => [`${pack.name} ${pack.version}`, kind];
	const provenance = (kind: string) => ({ source: id, section: section(kind), pages: [] });
	const described = (line: string, text?: string) => (text ? `${line}\n\n${text}` : line);
	for (const r of pack.records) {
		const rid = `${id}:${r.kind}:${r.slug}`;
		if (r.kind === 'weapon') {
			const props = r.properties.map((p) =>
				p === 'Versatile'
					? `Versatile (${r.versatile})`
					: p === 'Thrown'
						? `Thrown (Range ${r.range!.normal}/${r.range!.long})`
						: p === 'Ammunition'
							? `Ammunition (Range ${r.range!.normal}/${r.range!.long}; ${r.ammunition})`
							: p
			);
			const data = {
				category: r.category,
				type: r.type,
				damage: r.damage,
				damageType: r.damageType,
				properties: props,
				range: r.range ?? null,
				versatile: r.versatile ?? null,
				ammunition: r.ammunition ?? null,
				mastery: r.mastery,
				weight: `${r.weight} lb.`,
				cost: `${r.cost} GP`
			};
			records.push({
				id: rid,
				kind: 'weapon',
				name: r.name,
				data,
				text: described(
					`${r.name}: ${titled(r.category)} ${titled(r.type)} Weapon. ${r.damage} ${r.damageType}.${props.length ? ` Properties: ${props.join(', ')}.` : ''} Mastery: ${r.mastery}.`,
					r.text
				),
				provenance: provenance('Weapons')
			});
		} else if (r.kind === 'armor') {
			const dexCap = r.category === 'light' ? null : r.category === 'medium' ? 2 : 0;
			const armorClass =
				r.category === 'shield'
					? `+${r.base}`
					: r.category === 'heavy'
						? `${r.base}`
						: `${r.base} + Dex modifier${dexCap === 2 ? ' (max 2)' : ''}`;
			records.push({
				id: rid,
				kind: 'armor',
				name: r.name,
				data: {
					category: r.category,
					armorClass,
					base: r.base,
					dexCap,
					strength: r.strength ?? null,
					stealthDisadvantage: r.stealthDisadvantage,
					weight: `${r.weight} lb.`,
					cost: `${r.cost} GP`,
					don: r.category === 'shield' ? 'Utilize Action' : ''
				},
				text: described(`${r.name}: ${titled(r.category)}. Armor Class: ${armorClass}.`, r.text),
				provenance: provenance('Armor')
			});
		} else if (r.kind === 'spell') {
			records.push({
				id: rid,
				kind: 'spell',
				name: r.name,
				data: {
					level: r.level,
					school: r.school,
					classes: [...r.classes],
					castingTime: r.castingTime,
					ritual: false,
					range: r.range,
					components: { ...r.components },
					duration: r.duration,
					concentration: r.concentration,
					higherLevels: null,
					cantripUpgrade: null
				},
				text: r.text ?? `${r.name}: a level ${r.level} ${r.school.toLowerCase()} spell.`,
				provenance: provenance('Spells')
			});
			if (r.mechanics) mechanics.set(rid, spellMechanicsOf(r.mechanics));
		} else {
			const record = monsterRecord(rid, r, challenge.get(r.challenge)!, provenance('Monsters'));
			records.push(record);
			const read = readMonster(record);
			if (!read.enemy)
				return {
					ok: false,
					problems: [`${r.name}: none of its attacks can be played at the table`]
				};
			monsters.set(read.listing.kind, read);
		}
	}
	return { ok: true, loaded: { id, pack, records, mechanics, monsters } };
}

/** A homebrew spell's mechanics in the terms the SRD's spells are played by. */
function spellMechanicsOf(m: HomebrewSpellMechanics): SpellMechanics {
	return {
		resolve: m.resolve,
		...(m.attack ? { attack: m.attack } : {}),
		...(m.save ? { save: { ...m.save } } : {}),
		...(m.damage ? { damage: { ...m.damage } } : {}),
		...(m.heal ? { heal: { ...m.heal } } : {}),
		targets: { ...m.targets },
		...(m.cantrip ? { cantrip: 'dice' as const } : {}),
		...(m.area ? { area: { ...m.area } } : {}),
		...(m.push ? { push: m.push } : {}),
		...(m.onFail ? { onFail: { conditions: [...m.onFail.conditions] } } : {}),
		phrases: []
	};
}

const modifier = (score: number) => Math.floor((score - 10) / 2);
const average = (dice: string) => {
	const m = DICE.exec(dice.replace(/([+-])/, ' $1 '));
	if (!m) return Number(dice);
	const [, n, sides, sign, bonus] = m;
	const flat = bonus ? (sign === '-' ? -1 : 1) * Number(bonus) : 0;
	return Math.max(1, Math.floor((Number(n) * (Number(sides) + 1)) / 2 + flat));
};
const spaced = (dice: string) => dice.replace(/([+-])/, ' $1 ').replace('-', '−');

/** A homebrew monster as an SRD stat block: the same lines readMonster reads. */
function monsterRecord(
	id: string,
	m: HomebrewMonster,
	cr: { xp: number; pb: number },
	provenance: { source: string; section: string[]; pages: number[] }
): Extract<SrdRecord, { kind: 'monster' }> {
	const abilities = Object.fromEntries(
		ABILITIES.map((a) => {
			const mod = modifier(m.abilities[a]);
			return [a, { score: m.abilities[a], modifier: mod, save: m.saves?.[a] ?? mod }];
		})
	) as MonsterData['abilities'];
	const words = (list?: string[]) => (list?.length ? list.join(', ') : undefined);
	const immunities = [words(m.immune), words(m.conditionImmune?.map(titled))]
		.filter(Boolean)
		.join('; ');
	const details: Record<string, string> = {
		Senses: `${m.darkvision ? `Darkvision ${m.darkvision} ft.; ` : ''}Passive Perception ${10 + abilities.wis.modifier}`,
		...(immunities ? { Immunities: immunities } : {}),
		...(m.resist?.length ? { Resistances: m.resist.join(', ') } : {}),
		...(m.vulnerable?.length ? { Vulnerabilities: m.vulnerable.join(', ') } : {})
	};
	const line = (a: HomebrewAttack) =>
		`${a.kind === 'melee' ? 'Melee' : 'Ranged'} Attack Roll: ${signed(a.toHit)}, ${
			a.kind === 'melee' ? `reach ${a.reach} ft.` : `range ${a.range!.normal}/${a.range!.long} ft.`
		} Hit: ${average(a.damage)} (${spaced(a.damage)}) ${a.damageType} damage${
			a.plus
				? `, plus ${average(a.plus.damage)} (${spaced(a.plus.damage)}) ${a.plus.damageType} damage`
				: ''
		}.${a.prone ? ` If the target is ${/^[AEIOU]/.test(m.size) ? 'an' : 'a'} ${m.size} or smaller creature, it has the Prone condition.` : ''}`;
	const numbers = ['', '', 'two', 'three', 'four', 'five', 'six'];
	const actions = [
		...(m.multiattack
			? [
					{
						name: 'Multiattack',
						text: `The ${m.name.toLowerCase()} makes ${numbers[m.multiattack.times]} ${m.multiattack.attack} attacks.`
					}
				]
			: []),
		...m.attacks.map((a) => ({ name: a.name, text: line(a) }))
	];
	const initiative = abilities.dex.modifier;
	const data: MonsterData = {
		group: null,
		size: m.size,
		type: m.type,
		alignment: m.alignment ?? 'Unaligned',
		armorClass: m.armorClass,
		initiative: { bonus: initiative, score: 10 + initiative },
		hitPoints: { average: m.hitPoints, formula: null },
		speed: `${m.speed} ft.`,
		abilities,
		details,
		challenge: { rating: m.challenge, xp: cr.xp, xpInLair: null, proficiencyBonus: cr.pb },
		traits: (m.traits ?? []).map((t) => ({ ...t })),
		actions,
		bonusActions: [],
		reactions: [],
		legendaryActions: [],
		notes: {}
	};
	const text = [
		`${m.size} ${m.type}, ${data.alignment}`,
		`AC ${m.armorClass} Initiative ${signed(initiative)} (${10 + initiative})`,
		`HP ${m.hitPoints}`,
		`Speed ${m.speed} ft.`,
		`CR ${m.challenge} (XP ${cr.xp}; PB +${cr.pb})`,
		...(m.text ? ['', m.text] : []),
		...(m.traits?.length ? ['', 'Traits', '', ...m.traits.map((t) => `${t.name}. ${t.text}`)] : []),
		'',
		'Actions',
		'',
		...actions.map((a) => `${a.name}. ${a.text}`)
	].join('\n');
	return { id, kind: 'monster', name: m.name, data, text, provenance };
}
