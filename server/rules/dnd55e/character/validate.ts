// Reading a fifth edition character from untrusted JSON and checking every
// choice against the SRD's rules and the catalog: the shape field by field
// (anything unknown is refused), then the rules of character creation and
// advancement (the standard array or point buy, a background's +2/+1, the
// class's skill list and how many, Expertise, a Fighting Style, Weapon
// Mastery, a subclass from level 3, feats only at the levels that grant
// them and only when their prerequisites are met, no score above its
// maximum, armor the class is trained in, hit point rolls on the die), then
// the state of play against the derived maximums. Returns the character,
// or every problem found.

import type { RulesetRef } from '../../ruleset';
import type { Catalog } from '../catalog';
import { ABILITIES, isAbility, skillOf, SKILLS, type Ability } from '../core';
import { deriveCharacter } from './derive';
import {
	CHARACTER_VERSION,
	type CharacterChoices,
	type DndCharacter,
	type FeatChoice,
	type Increases,
	type LevelFeat
} from './model';
import {
	armorTraining,
	classSkills,
	featIncrease,
	featSkills,
	SPECIES_FEAT,
	SPECIES_OPTIONS,
	weaponMastery
} from './options';

export type CharacterRead =
	{ ok: true; character: DndCharacter } | { ok: false; problems: string[] };

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
/** Point buy: what each score from 8 to 15 costs, out of 27 points. */
export const POINT_COST: Readonly<Record<number, number>> = {
	8: 0,
	9: 1,
	10: 2,
	11: 3,
	12: 4,
	13: 5,
	14: 7,
	15: 9
};
export const POINTS = 27;

const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const NOTES_MAX = 20;

type Json = unknown;
const isObject = (v: Json): v is Record<string, Json> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: Json, min: number, max: number): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: Json, max: number): v is string =>
	typeof v === 'string' &&
	v.trim().length > 0 &&
	v.length <= max &&
	// eslint-disable-next-line no-control-regex
	!/[\u0000-\u001f\u007f]/.test(v);

/** Reads and checks a character; `rules` is the ruleset reference it must be bound to. */
export function readCharacter(raw: Json, catalog: Catalog, rules: RulesetRef): CharacterRead {
	const problems: string[] = [];
	const bad = (msg: string) => problems.push(msg);
	const shaped = readShape(raw, bad);
	if (!shaped) return { ok: false, problems };
	const c = shaped;
	if (c.version !== CHARACTER_VERSION) bad(`version ${c.version} is not ${CHARACTER_VERSION}`);
	if (c.rules.id !== rules.id || c.rules.version !== rules.version)
		bad(`made for rules ${c.rules.id} v${c.rules.version}, not ${rules.id} v${rules.version}`);
	const pin = catalog.pin;
	if (
		c.catalog.source !== pin.source ||
		c.catalog.version !== pin.version ||
		c.catalog.sha256 !== pin.sha256
	)
		bad(
			`made from catalog ${c.catalog.source} ${c.catalog.version}, not ${pin.source} ${pin.version}`
		);
	if (problems.length) return { ok: false, problems };
	checkChoices(c, catalog, bad);
	if (problems.length) return { ok: false, problems };

	const derived = deriveCharacter(c, catalog);
	if (c.state.hp > derived.hitPoints.max)
		bad(`hit points ${c.state.hp} above the maximum ${derived.hitPoints.max}`);
	if (c.state.hitDiceSpent > c.level) bad(`more Hit Point Dice spent than the ${c.level} it has`);
	for (const [id, n] of Object.entries(c.state.spent)) {
		const r = derived.resources.find((x) => x.id === id);
		if (!r) bad(`spent uses of "${id}", which it doesn't have`);
		else if (n > r.max) bad(`${n} uses of ${r.name} spent, of ${r.max}`);
	}
	return problems.length ? { ok: false, problems } : { ok: true, character: c };
}

/** A new character from a player's choices: bound to these rules and this catalog, at full health. */
export function createCharacter(
	choices: CharacterChoices,
	catalog: Catalog,
	rules: RulesetRef
): CharacterRead {
	const draft = {
		...structuredClone(choices),
		version: CHARACTER_VERSION,
		rules: { id: rules.id, version: rules.version },
		catalog: { ...catalog.pin },
		state: { hp: 1, tempHp: 0, hitDiceSpent: 0, spent: {} }
	};
	const read = readCharacter(draft, catalog, rules);
	if (!read.ok) return read;
	read.character.state.hp = deriveCharacter(read.character, catalog).hitPoints.max;
	return read;
}

// ---- The shape ------------------------------------------------------------

function readShape(raw: Json, bad: (msg: string) => void): DndCharacter | null {
	const before = { n: 0 };
	const fail = (msg: string) => {
		before.n++;
		bad(msg);
	};
	const fields = (v: Json, at: string, keys: string[], optional: string[] = []) => {
		if (!isObject(v)) {
			// A missing field is named once, where it is missing.
			if (v !== undefined) fail(`${at} must be an object`);
			return null;
		}
		for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${at}: unknown field "${k}"`);
		for (const k of keys) if (!(k in v) && !optional.includes(k)) fail(`${at}: "${k}" missing`);
		return v;
	};
	const ids = (v: Json, at: string, max = 20): string[] => {
		if (
			!Array.isArray(v) ||
			v.length > max ||
			v.some((x) => typeof x !== 'string' || x.length > 120)
		) {
			fail(`${at} must be a list of ids`);
			return [];
		}
		if (new Set(v).size !== v.length) fail(`${at} lists something twice`);
		return v as string[];
	};
	const increases = (v: Json, at: string): Increases => {
		if (!isObject(v)) {
			fail(`${at} must map abilities to increases`);
			return {};
		}
		const out: Increases = {};
		for (const [k, n] of Object.entries(v)) {
			if (!isAbility(k)) fail(`${at}: no ability "${k}"`);
			else if (!isInt(n, 1, 3)) fail(`${at}: ${k} must rise by 1 to 3`);
			else out[k] = n;
		}
		return out;
	};
	const record = (v: Json, at: string): string => {
		if (typeof v !== 'string' || v.length > 120) {
			fail(`${at} must be a catalog id`);
			return '';
		}
		return v;
	};
	const featChoice = (
		v: Json,
		at: string,
		level: boolean
	): (FeatChoice & { level?: number }) | null => {
		const f = fields(
			v,
			at,
			level ? ['level', 'feat', 'increases', 'skills'] : ['feat', 'increases', 'skills'],
			['increases', 'skills']
		);
		if (!f) return null;
		const out: FeatChoice & { level?: number } = { feat: record(f.feat, `${at}.feat`) };
		if (level) {
			if (!isInt(f.level, 1, 20)) fail(`${at}.level must be 1 to 20`);
			else out.level = f.level;
		}
		if (f.increases !== undefined) out.increases = increases(f.increases, `${at}.increases`);
		if (f.skills !== undefined) out.skills = ids(f.skills, `${at}.skills`, 3);
		return out;
	};

	const c = fields(raw, 'character', [
		'version',
		'id',
		'name',
		'rules',
		'catalog',
		'level',
		'species',
		'background',
		'class',
		'abilities',
		'feats',
		'hitPoints',
		'armor',
		'notes',
		'state'
	]);
	if (!c) return null;
	if (!isInt(c.version, 1, 1_000_000)) fail('version must be a whole number');
	if (typeof c.id !== 'string' || !ID.test(c.id))
		fail('id must be lowercase letters, digits and hyphens');
	if (!isText(c.name, 60)) fail('name must be 1 to 60 characters');
	const rules = fields(c.rules, 'rules', ['id', 'version']);
	if (rules && (typeof rules.id !== 'string' || !isInt(rules.version, 1, 1_000_000)))
		fail('rules must name a ruleset and its version');
	const pin = fields(c.catalog, 'catalog', ['source', 'version', 'sha256']);
	if (pin && [pin.source, pin.version, pin.sha256].some((x) => typeof x !== 'string'))
		fail('catalog must name a source, its version and hash');
	if (!isInt(c.level, 1, 20)) fail('level must be 1 to 20');

	const species = fields(c.species, 'species', ['id', 'options', 'feat']);
	const options: Record<string, string> = {};
	if (species) {
		if (!isObject(species.options)) fail('species.options must map options to choices');
		else
			for (const [k, v] of Object.entries(species.options)) {
				if (typeof v !== 'string' || v.length > 60) fail(`species.options.${k} must be a choice`);
				else options[k] = v;
			}
	}
	const speciesFeat =
		species && species.feat !== null ? featChoice(species.feat, 'species.feat', false) : null;
	const background = fields(c.background, 'background', ['id', 'increases']);
	const klass = fields(c.class, 'class', [
		'id',
		'subclass',
		'skills',
		'expertise',
		'fightingStyle',
		'weaponMasteries'
	]);
	if (klass) {
		if (klass.subclass !== null && typeof klass.subclass !== 'string')
			fail('class.subclass must be a catalog id or null');
		if (klass.fightingStyle !== null && typeof klass.fightingStyle !== 'string')
			fail('class.fightingStyle must be a catalog id or null');
	}
	const abilities = fields(c.abilities, 'abilities', ['method', 'base']);
	const base = {} as Record<Ability, number>;
	if (abilities) {
		if (!['standard-array', 'point-buy', 'rolled'].includes(abilities.method as string))
			fail('abilities.method must be standard-array, point-buy or rolled');
		const b = fields(
			abilities.base,
			'abilities.base',
			ABILITIES.map((a) => a.id)
		);
		if (b)
			for (const { id } of ABILITIES) {
				if (!isInt(b[id], 1, 30)) fail(`abilities.base.${id} must be a score`);
				else base[id] = b[id];
			}
	}
	const feats: LevelFeat[] = [];
	if (!Array.isArray(c.feats) || c.feats.length > 20) fail('feats must be a list');
	else
		c.feats.forEach((f, i) => {
			const read = featChoice(f, `feats[${i}]`, true);
			if (read) feats.push(read as LevelFeat);
		});
	const hp = fields(c.hitPoints, 'hitPoints', ['method', 'rolls'], ['rolls']);
	if (hp) {
		if (hp.method === 'average' && hp.rolls !== undefined)
			fail('hitPoints: average takes no rolls');
		else if (hp.method === 'rolled') {
			if (
				!Array.isArray(hp.rolls) ||
				hp.rolls.length > 19 ||
				hp.rolls.some((r) => !isInt(r, 1, 12))
			)
				fail('hitPoints.rolls must be the die rolled at each level');
		} else if (hp.method !== 'average') fail('hitPoints.method must be average or rolled');
	}
	const armor = fields(c.armor, 'armor', ['worn', 'shield']);
	if (armor) {
		if (armor.worn !== null && typeof armor.worn !== 'string')
			fail('armor.worn must be a catalog id or null');
		if (typeof armor.shield !== 'boolean') fail('armor.shield must be true or false');
	}
	const notes: Record<string, string> = {};
	if (!isObject(c.notes) || Object.keys(c.notes).length > NOTES_MAX)
		fail(`notes must map up to ${NOTES_MAX} names to text`);
	else
		for (const [k, v] of Object.entries(c.notes)) {
			if (!isText(k, 40) || !isText(v, 200)) fail(`notes.${k.slice(0, 40)} must be short text`);
			else notes[k] = v;
		}
	const state = fields(c.state, 'state', ['hp', 'tempHp', 'hitDiceSpent', 'spent']);
	const spent: Record<string, number> = {};
	if (state) {
		if (!isInt(state.hp, 0, 10_000)) fail('state.hp must be a whole number');
		if (!isInt(state.tempHp, 0, 10_000)) fail('state.tempHp must be a whole number');
		if (!isInt(state.hitDiceSpent, 0, 20)) fail('state.hitDiceSpent must be 0 to 20');
		if (!isObject(state.spent) || Object.keys(state.spent).length > 40)
			fail('state.spent must map resources to uses spent');
		else
			for (const [k, n] of Object.entries(state.spent)) {
				if (!isInt(n, 0, 1000)) fail(`state.spent.${k.slice(0, 40)} must be a whole number`);
				else spent[k] = n;
			}
	}
	if (before.n) return null;

	return {
		version: c.version as 1,
		id: c.id as string,
		name: (c.name as string).trim(),
		rules: { id: rules!.id as string, version: rules!.version as number },
		catalog: {
			source: pin!.source as string,
			version: pin!.version as string,
			sha256: pin!.sha256 as string
		},
		level: c.level as number,
		species: { id: record(species!.id, 'species.id'), options, feat: speciesFeat },
		background: {
			id: record(background!.id, 'background.id'),
			increases: increases(background!.increases, 'background.increases')
		},
		class: {
			id: record(klass!.id, 'class.id'),
			subclass: klass!.subclass as string | null,
			skills: ids(klass!.skills, 'class.skills'),
			expertise: ids(klass!.expertise, 'class.expertise'),
			fightingStyle: klass!.fightingStyle as string | null,
			weaponMasteries: ids(klass!.weaponMasteries, 'class.weaponMasteries')
		},
		abilities: { method: abilities!.method as DndCharacter['abilities']['method'], base },
		feats,
		hitPoints:
			hp!.method === 'average'
				? { method: 'average' }
				: { method: 'rolled', rolls: [...(hp!.rolls as number[])] },
		armor: { worn: armor!.worn as string | null, shield: armor!.shield as boolean },
		notes,
		state: {
			hp: state!.hp as number,
			tempHp: state!.tempHp as number,
			hitDiceSpent: state!.hitDiceSpent as number,
			spent
		}
	};
}

// ---- The rules of making and advancing a character ----------------------

function checkChoices(c: DndCharacter, catalog: Catalog, bad: (msg: string) => void): void {
	const species = catalog.get('species', c.species.id);
	const background = catalog.get('background', c.background.id);
	const klass = catalog.get('class', c.class.id);
	if (!species) bad(`no species "${c.species.id}"`);
	if (!background) bad(`no background "${c.background.id}"`);
	if (!klass) bad(`no class "${c.class.id}"`);
	if (!species || !background || !klass) return;
	const featRecord = (id: string, at: string) => {
		const f = catalog.get('feat', id);
		if (!f) bad(`${at}: no feat "${id}"`);
		return f;
	};

	// Ability scores.
	const base = ABILITIES.map((a) => c.abilities.base[a.id]);
	if (c.abilities.method === 'standard-array') {
		if ([...base].sort((a, b) => b - a).join() !== STANDARD_ARRAY.join())
			bad(`the standard array is ${STANDARD_ARRAY.join(', ')}, each once`);
	} else if (c.abilities.method === 'point-buy') {
		if (base.some((s) => POINT_COST[s] === undefined)) bad('point buy scores are 8 to 15');
		else {
			const cost = base.reduce((sum, s) => sum + POINT_COST[s], 0);
			if (cost > POINTS) bad(`point buy spends ${cost} points, of ${POINTS}`);
		}
	} else if (base.some((s) => s < 3 || s > 18)) bad('rolled scores are 3 to 18');

	const scores = { ...c.abilities.base };
	const raise = (inc: Increases | undefined, max: number, at: string) => {
		for (const [a, n] of Object.entries(inc ?? {})) {
			scores[a as Ability] += n ?? 0;
			if (scores[a as Ability] > max) bad(`${at} raises ${a} above ${max}`);
		}
	};

	// Background: +2 and +1, or +1 to all three, among its three abilities.
	const allowed = new Set(
		background.data.abilities.map((n) => ABILITIES.find((a) => a.name === n)?.id)
	);
	const inc = Object.entries(c.background.increases);
	const pattern = inc
		.map(([, n]) => n)
		.sort()
		.join();
	if (inc.some(([a]) => !allowed.has(a as Ability)))
		bad(`${background.name} increases only ${background.data.abilities.join(', ')}`);
	if (pattern !== '1,2' && pattern !== '1,1,1')
		bad('a background increases one score by 2 and another by 1, or three scores by 1');
	raise(c.background.increases, 20, 'the background');

	// Species options.
	const specs = SPECIES_OPTIONS[species.id] ?? {};
	for (const k of Object.keys(c.species.options))
		if (!specs[k]) bad(`${species.name} has no option "${k}"`);
	for (const [k, spec] of Object.entries(specs)) {
		const v = c.species.options[k];
		if (v === undefined) bad(`${species.name}: choose ${k}`);
		else if (spec.kind === 'one-of' && !spec.values.includes(v))
			bad(`${species.name} ${k}: "${v}" is not one of ${spec.values.join(', ')}`);
		else if (spec.kind === 'skill' && (!skillOf(v) || (spec.values && !spec.values.includes(v))))
			bad(`${species.name} ${k}: "${v}" is not a skill it may choose`);
	}

	// Skills: the background's, the species', the class's choices; none twice.
	const skills: string[] = background.data.skills.map(
		(n) => SKILLS.find((s) => s.name === n)?.id ?? n
	);
	for (const k of ['keen-senses', 'skillful'])
		if (c.species.options[k]) skills.push(c.species.options[k]);
	const choice = classSkills(klass.data);
	if (c.class.skills.length !== choice.count)
		bad(`${klass.name} chooses ${choice.count} skills, not ${c.class.skills.length}`);
	for (const s of c.class.skills)
		if (!skillOf(s) || (choice.from && !choice.from.includes(s)))
			bad(`${klass.name} can't choose the skill "${s}"`);
	skills.push(...c.class.skills);

	// Feats: the background's, the species' choice, the Fighting Style, and level feats.
	const features = klass.data.features.filter((f) => f.level <= c.level);
	const has = (name: string) => features.some((f) => f.name === name);
	const taken: string[] = [];
	const origin = catalog.named('feat', background.data.feat.replace(/ \(.*\)$/, ''));
	if (origin) taken.push(origin.id);
	const takeFeat = (choice: FeatChoice, at: string, level: number) => {
		const f = featRecord(choice.feat, at);
		if (!f) return;
		const prerequisite = f.data.prerequisite;
		for (const part of prerequisite ? prerequisite.split(', ') : []) {
			let m: RegExpExecArray | null;
			if ((m = /^Level (\d+)\+$/.exec(part))) {
				if (level < Number(m[1])) bad(`${at}: ${f.name} needs level ${m[1]}`);
			} else if ((m = /^(\w+)(?: or (\w+))? (\d+)\+$/.exec(part))) {
				const names = [m[1], m[2]].filter(Boolean);
				const ok = names.some((n) => {
					const a = ABILITIES.find((x) => x.name === n)?.id;
					return a !== undefined && scores[a] >= Number(m![3]);
				});
				if (!ok) bad(`${at}: ${f.name} needs ${part}`);
			} else if (part === 'Fighting Style Feature') {
				if (!has('Fighting Style')) bad(`${at}: ${f.name} needs the Fighting Style feature`);
			} else if (part === 'Spellcasting Feature') {
				if (!has('Spellcasting') && !has('Pact Magic'))
					bad(`${at}: ${f.name} needs the Spellcasting feature`);
			} else bad(`${at}: can't check ${f.name}'s prerequisite "${part}"`);
		}
		if (taken.includes(f.id) && !f.data.repeatable) bad(`${at}: ${f.name} is taken twice`);
		taken.push(f.id);
		const spec = featIncrease(f.name, f.data);
		if (!spec) {
			if (choice.increases && Object.keys(choice.increases).length)
				bad(`${at}: ${f.name} raises no ability score`);
		} else {
			const entries = Object.entries(choice.increases ?? {});
			const total = entries.reduce((s, [, n]) => s + (n ?? 0), 0);
			if (total !== spec.total) bad(`${at}: ${f.name} raises scores by ${spec.total} in all`);
			for (const [a, n] of entries)
				if (!spec.from.includes(a as Ability) || (n ?? 0) > spec.each)
					bad(`${at}: ${f.name} can't raise ${a} by ${n}`);
			raise(choice.increases, spec.max, `${at} (${f.name})`);
		}
		const most = featSkills(f.name);
		if ((choice.skills?.length ?? 0) > most)
			bad(`${at}: ${f.name} gives ${most ? `up to ${most} skills` : 'no skills'}`);
		for (const s of choice.skills ?? []) {
			if (!skillOf(s)) bad(`${at}: no skill "${s}"`);
			skills.push(s);
		}
	};
	if (SPECIES_FEAT.has(species.id)) {
		if (!c.species.feat) bad(`${species.name}: choose an Origin feat`);
		else {
			const f = catalog.get('feat', c.species.feat.feat);
			if (f && f.data.category !== 'origin')
				bad(`${species.name}: ${f.name} is not an Origin feat`);
			takeFeat(c.species.feat, 'species feat', 1);
		}
	} else if (c.species.feat) bad(`${species.name} gives no feat to choose`);

	if (has('Fighting Style')) {
		if (!c.class.fightingStyle) bad(`${klass.name}: choose a Fighting Style feat`);
		else {
			const f = catalog.get('feat', c.class.fightingStyle);
			if (f && f.data.category !== 'fighting-style')
				bad(`${klass.name}: ${f.name} is not a Fighting Style feat`);
			takeFeat({ feat: c.class.fightingStyle }, 'fighting style', c.level);
		}
	} else if (c.class.fightingStyle) bad(`${klass.name} has no Fighting Style at level ${c.level}`);

	const featLevels = features
		.filter((f) => f.name === 'Ability Score Improvement' || f.name === 'Epic Boon')
		.map((f) => f.level);
	const levels = c.feats.map((f) => f.level);
	for (const l of featLevels) if (!levels.includes(l)) bad(`level ${l}: choose a feat`);
	for (const l of levels)
		if (!featLevels.includes(l)) bad(`level ${l}: ${klass.name} gains no feat at that level`);
	if (new Set(levels).size !== levels.length) bad('two feats at one level');
	for (const f of [...c.feats].sort((a, b) => a.level - b.level)) {
		const record = catalog.get('feat', f.feat);
		if (
			record?.data.category === 'epic-boon' &&
			!features.some((x) => x.level === f.level && x.name === 'Epic Boon')
		)
			bad(`level ${f.level}: an Epic Boon only at the Epic Boon level`);
		takeFeat(f, `level ${f.level} feat`, f.level);
	}
	if (new Set(skills).size !== skills.length)
		bad('a skill is chosen twice (choose another skill where proficiencies overlap)');

	// Subclass from level 3.
	if (c.level < 3 && c.class.subclass) bad(`a subclass is chosen at level 3, not ${c.level}`);
	if (c.level >= 3) {
		const sub = c.class.subclass ? catalog.get('subclass', c.class.subclass) : undefined;
		if (!sub) bad(`${klass.name} ${c.level}: choose a subclass`);
		else if (sub.data.class !== klass.name) bad(`${sub.name} is not a ${klass.name} subclass`);
	}

	// Expertise: two proficient skills for each Expertise feature gained.
	const expertise = 2 * features.filter((f) => f.name === 'Expertise').length;
	if (c.class.expertise.length !== expertise)
		bad(
			`${klass.name} ${c.level} has Expertise in ${expertise} skills, not ${c.class.expertise.length}`
		);
	for (const s of c.class.expertise)
		if (!skills.includes(s)) bad(`Expertise in "${s}", a skill it isn't proficient in`);

	// Weapon Mastery: as many kinds as the class table says, of weapons it is trained with.
	const mastery = weaponMastery(klass.data, c.level);
	if (c.class.weaponMasteries.length !== mastery.count)
		bad(
			`${klass.name} ${c.level} masters ${mastery.count} kinds of weapon, not ${c.class.weaponMasteries.length}`
		);
	const martial = klass.data.weapons;
	for (const id of c.class.weaponMasteries) {
		const w = catalog.get('weapon', id);
		if (!w) bad(`no weapon "${id}"`);
		else if (mastery.melee && w.data.type !== 'melee')
			bad(`${klass.name} masters melee weapons only`);
		else if (w.data.category === 'martial') {
			const only = /Martial weapons that have the (.+) propert/.exec(martial);
			const ok = only
				? only[1].split(' or ').some((p) => w.data.properties.some((x) => x.startsWith(p)))
				: /Martial weapons/.test(martial);
			if (!ok) bad(`${klass.name} isn't trained with ${w.name}`);
		}
	}

	// Hit points past level 1.
	const die = Number(klass.data.hitDie.slice(1));
	if (c.hitPoints.method === 'rolled') {
		if (c.hitPoints.rolls.length !== c.level - 1)
			bad(`hit points rolled for ${c.hitPoints.rolls.length} levels, not ${c.level - 1}`);
		if (c.hitPoints.rolls.some((r) => r > die)) bad(`a hit point roll above the d${die}`);
	}

	// Armor the class is trained in.
	const training = armorTraining(klass.data);
	if (c.armor.worn) {
		const a = catalog.get('armor', c.armor.worn);
		if (!a || a.data.category === 'shield') bad(`no armor "${c.armor.worn}"`);
		else if (!training.has(a.data.category)) bad(`${klass.name} isn't trained in ${a.name}`);
	}
	if (c.armor.shield && !training.has('shield')) bad(`${klass.name} isn't trained with Shields`);
}
