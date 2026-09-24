// Adventure files: an adventure written as plain JSON, the way a creator
// builds one (the builder, /builder) and shares it. It is the content
// structure of define.ts with everything a file can't hold made plain:
// tables are scene files, an enemy's hit points are a base plus so many per
// character, and characters are picked from the character library.
//
// A file is untrusted input, like an uploaded scene: `parseAdventureFile`
// checks every field (and drops anything it doesn't know), `compileAdventure`
// turns it into an AdventureDef the engine runs, and `loadAdventureFile`
// does both and then checks that every reference goes somewhere
// (validate.ts). Relative imports only: the game server imports this too.

import {
	EVIDENCE_KINDS,
	INVESTIGATION_ACTIONS,
	isObjectState,
	PHYSICAL_ACTIONS,
	type ObjectState
} from './adventure';
import { CHARACTER_IDS, CHARACTERS, STATS } from './characters';
import type {
	AdventureDef,
	Area,
	Behavior,
	Effect,
	EncounterDef,
	EnemyDef,
	NpcDef,
	ObjectDef,
	PhaseDef,
	Rule,
	Voice,
	When
} from './define';
import { AMBUSH } from './define';
import { validateAdventure } from './validate';
import { CUES, type Shot } from '../game/chat';
import type { GridPos } from '../game/grid';
import { AMBIENTS } from '../game/lights';
import { MOTION_KINDS, SOUNDS } from '../game/motion';
import { isAssetId } from '../game/props';
import { parseSceneFile, type SavedToken, type SceneFile } from '../game/scene-file';
import { ASSET_ID_PATTERN } from '../assets/manifest';

export const ADVENTURE_FILE_FORMAT = 'thirdfold-adventure';
export const ADVENTURE_FILE_VERSION = 1;
/** Serialized size cap, checked before parsing. */
export const ADVENTURE_FILE_MAX_BYTES = 1024 * 1024;

/** Limits on how much an adventure holds. */
export const ADVENTURE_LIMITS = {
	locations: 12,
	chapters: 64,
	events: 256,
	npcs: 64,
	lines: 48,
	objects: 256,
	verbs: 12,
	clues: 256,
	enemies: 32,
	encounters: 64,
	effects: 32,
	rules: 24,
	list: 64,
	text: 4000,
	name: 80,
	depth: 4
} as const;

/** Where to find the pieces of an ending, by answer. */
export interface EndingFile {
	ending: string;
	subtitle: string;
	headline: string;
	text: string;
	scene: string;
	cue: 'toll' | 'flash';
	result: { label: string; value: string }[];
	lines?: Rule[];
	does?: Effect[];
}

/** Hit points: `base`, plus `perCharacter` for each character in the party (at least one). */
export interface HitPoints {
	base: number;
	perCharacter: number;
}

export interface EnemyFile extends Omit<EnemyDef, 'hp' | 'kind'> {
	hp: HitPoints;
}

export interface EncounterFile extends Omit<EncounterDef, 'foes' | 'more'> {
	foes: { kind: string; hp?: HitPoints }[];
	more?: { if: When; foes: { kind: string; hp?: HitPoints }[] }[];
}

export interface NpcFile extends Omit<NpcDef, 'id' | 'token'> {
	/** Its token's id on the table; `npc-<id>` if left out. */
	token?: string;
}

export interface AdventureFile {
	format: typeof ADVENTURE_FILE_FORMAT;
	version: typeof ADVENTURE_FILE_VERSION;
	title: string;
	/** A line or two for whoever picks it. */
	about: string;
	/** The characters players choose from (the character library's ids). */
	characters: string[];
	start: { location: string; chapter: string; arrival: Effect[] };
	locations: Record<string, { name: string; welcome: string; spawn: GridPos[]; scene: SceneFile }>;
	areas: AdventureDef['areas'][number][];
	chapters: Record<string, Omit<AdventureDef['chapters'][string], 'id'>>;
	events: Record<string, AdventureDef['events'][string]>;
	decisions: Record<string, Omit<AdventureDef['decisions'][string], 'id'>>;
	endings: {
		decision: string;
		fallback: string;
		byAnswer: Record<string, EndingFile>;
		names: Record<string, { title: string }>;
	};
	npcs: Record<string, NpcFile>;
	peoplePlaces: { place: string; if: When }[];
	reactions: AdventureDef['reactions'][number][];
	objects: ObjectDef[];
	signs: AdventureDef['signs'][number][];
	clues: Record<string, Omit<AdventureDef['clues'][string], 'id'>>;
	mechanisms: Record<string, Omit<AdventureDef['mechanisms'][string], 'id'>>;
	enemies: Record<string, EnemyFile>;
	encounters: Record<string, EncounterFile>;
	ward?: { object: string; touched: ObjectState };
	cues: { id: string; title: string; text: string }[];
	voice?: Partial<Voice>;
}

export type AdventureFileParse = { ok: true; file: AdventureFile } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Checking, piece by piece

class Bad extends Error {}

function bad(path: string, what: string): never {
	throw new Bad(`${path}: ${what}`);
}

/** Ids: lower case letters, digits, `-` and `_`, starting with a letter or digit. */
const ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** Keys in `said`, `remember` and reactions' `on`: ids joined by `:`. */
const KEY = /^[a-z0-9][a-z0-9_:-]{0,95}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

function obj(v: unknown, path: string): Record<string, unknown> {
	if (!isRecord(v)) bad(path, 'expected an object');
	return v;
}

function text(v: unknown, path: string, max: number = ADVENTURE_LIMITS.text): string {
	if (typeof v !== 'string' || v.length === 0 || v.length > max) {
		bad(path, `expected text of 1-${max} characters`);
	}
	// eslint-disable-next-line no-control-regex
	return v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

const name = (v: unknown, path: string) => text(v, path, ADVENTURE_LIMITS.name);

function id(v: unknown, path: string): string {
	if (typeof v !== 'string' || !ID.test(v)) bad(path, 'expected an id (a-z, 0-9, - and _)');
	return v;
}

function key(v: unknown, path: string): string {
	if (typeof v !== 'string' || !KEY.test(v)) bad(path, 'expected a key');
	return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
	if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
		bad(path, `expected a whole number from ${min} to ${max}`);
	}
	return v as number;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
	if (typeof v !== 'string' || !(options as readonly string[]).includes(v)) {
		bad(path, `expected one of ${options.join(', ')}`);
	}
	return v as T;
}

function list<T>(
	v: unknown,
	path: string,
	each: (item: unknown, path: string) => T,
	max: number = ADVENTURE_LIMITS.list
): T[] {
	if (!Array.isArray(v) || v.length > max) bad(path, `expected a list of at most ${max}`);
	return v.map((item, i) => each(item, `${path}[${i}]`));
}

function dict<T>(
	v: unknown,
	path: string,
	each: (item: unknown, path: string, key: string) => T,
	max: number = ADVENTURE_LIMITS.list
): Record<string, T> {
	const o = obj(v, path);
	const keys = Object.keys(o);
	if (keys.length > max) bad(path, `at most ${max} entries`);
	const out: Record<string, T> = {};
	for (const k of keys) out[id(k, `${path} key`)] = each(o[k], `${path}.${k}`, k);
	return out;
}

const opt = <T>(v: unknown, parse: (v: unknown) => T): T | undefined =>
	v === undefined ? undefined : parse(v);

function cell(v: unknown, path: string): GridPos {
	const c = obj(v, path);
	return { x: int(c.x, `${path}.x`, 0, 99), y: int(c.y, `${path}.y`, 0, 99) };
}

function area(v: unknown, path: string): Area {
	const a = obj(v, path);
	return { from: cell(a.from, `${path}.from`), to: cell(a.to, `${path}.to`) };
}

const state = (v: unknown, path: string): ObjectState => {
	if (!isObjectState(v)) bad(path, 'expected an object state');
	return v;
};

function dice(v: unknown, path: string): string {
	if (typeof v !== 'string' || !/^[0-9d+\- ]{1,24}$/.test(v))
		bad(path, 'expected dice, e.g. 1d6+2');
	return v;
}

function shot(v: unknown, path: string): Shot {
	const s = obj(v, path);
	return {
		focus: s.focus === null ? null : cell(s.focus, `${path}.focus`),
		frame: oneOf(s.frame, ['close', 'wide', 'table'] as const, `${path}.frame`)
	};
}

function hitPoints(v: unknown, path: string): HitPoints {
	const h = obj(v, path);
	return {
		base: int(h.base, `${path}.base`, 1, 500),
		perCharacter: int(h.perCharacter, `${path}.perCharacter`, 0, 100)
	};
}

// ---------------------------------------------------------------------------
// Conditions and effects

function when(v: unknown, path: string): When {
	const w = obj(v, path);
	const ids = (x: unknown, p: string) => list(x, p, id);
	const keys = (x: unknown, p: string) => list(x, p, key);
	const out: When = {};
	const set = <K extends keyof When>(k: K, value: When[K] | undefined) => {
		if (value !== undefined) out[k] = value;
	};
	set(
		'state',
		opt(w.state, (x) => keys(x, `${path}.state`))
	);
	set(
		'clues',
		opt(w.clues, (x) => ids(x, `${path}.clues`))
	);
	set(
		'found',
		opt(w.found, (x) => ids(x, `${path}.found`))
	);
	set(
		'unfound',
		opt(w.unfound, (x) => ids(x, `${path}.unfound`))
	);
	set(
		'events',
		opt(w.events, (x) => ids(x, `${path}.events`))
	);
	set(
		'not',
		opt(w.not, (x) => ids(x, `${path}.not`))
	);
	set(
		'pending',
		opt(w.pending, (x) => id(x, `${path}.pending`))
	);
	set(
		'objects',
		opt(w.objects, (x) =>
			dict(x, `${path}.objects`, (states, p) => list(states, p, state, OBJECT_STATE_COUNT))
		)
	);
	set(
		'chapter',
		opt(w.chapter, (x) => ids(x, `${path}.chapter`))
	);
	set(
		'said',
		opt(w.said, (x) => keys(x, `${path}.said`))
	);
	set(
		'unsaid',
		opt(w.unsaid, (x) => keys(x, `${path}.unsaid`))
	);
	set(
		'chose',
		opt(w.chose, (x) => dict(x, `${path}.chose`, id))
	);
	set(
		'phase',
		opt(w.phase, (x) => id(x, `${path}.phase`))
	);
	set(
		'fights',
		opt(w.fights, (x) =>
			dict(x, `${path}.fights`, (s, p) => oneOf(s, ['active', 'won', 'lost', 'none'] as const, p))
		)
	);
	return out;
}

const OBJECT_STATE_COUNT = 16;

function rules(v: unknown, path: string, depth: number): Rule[] {
	return list(
		v,
		path,
		(r, p) => {
			const o = obj(r, p);
			return {
				...(o.if === undefined ? {} : { if: when(o.if, `${p}.if`) }),
				do: effects(o.do, `${p}.do`, depth)
			};
		},
		ADVENTURE_LIMITS.rules
	);
}

/** The effect kinds, by the key that names each. */
export const EFFECT_KINDS = [
	'say',
	'clue',
	'tell',
	'event',
	'set',
	'npc',
	'offer',
	'fight',
	'enter',
	'post',
	'settle',
	'reveal',
	'explore',
	'motion',
	'heal',
	'detect',
	'remember',
	'reward',
	'count',
	'phase',
	'hazard',
	'light',
	'prop',
	'ambient',
	'hurt',
	'spawn',
	'rules'
] as const;

export type EffectKind = (typeof EFFECT_KINDS)[number];

/** Which kind an effect is. */
export function effectKind(e: Effect): EffectKind {
	return EFFECT_KINDS.find((k) => k in e)!;
}

function effects(v: unknown, path: string, depth = 0): Effect[] {
	if (depth > ADVENTURE_LIMITS.depth) bad(path, 'rules nested too deep');
	return list(v, path, (e, p) => effect(e, p, depth), ADVENTURE_LIMITS.effects);
}

function effect(v: unknown, path: string, depth: number): Effect {
	const e = obj(v, path);
	const kinds = EFFECT_KINDS.filter((k) => k in e);
	if (kinds.length !== 1) bad(path, `expected exactly one of ${EFFECT_KINDS.join(', ')}`);
	const kind = kinds[0];
	const at = `${path}.${kind}`;
	switch (kind) {
		case 'say':
			return {
				say: text(e.say, at),
				...(e.speaker === undefined ? {} : { speaker: name(e.speaker, `${path}.speaker`) }),
				...(e.private === true ? { private: true as const } : {}),
				...(e.cue === undefined ? {} : { cue: oneOf(e.cue, CUES, `${path}.cue`) }),
				...(e.shot === undefined ? {} : { shot: shot(e.shot, `${path}.shot`) })
			};
		case 'clue':
			return { clue: id(e.clue, at) };
		case 'tell':
			return { tell: id(e.tell, at) };
		case 'event':
			return { event: id(e.event, at) };
		case 'set':
			return {
				set: id(e.set, at),
				to: e.to === 'initial' ? 'initial' : state(e.to, `${path}.to`),
				...(e.if === undefined ? {} : { if: state(e.if, `${path}.if`) })
			};
		case 'npc':
			return { npc: id(e.npc, at), becomes: id(e.becomes, `${path}.becomes`) };
		case 'offer':
			return { offer: id(e.offer, at) };
		case 'fight':
			return { fight: id(e.fight, at) };
		case 'enter':
			return { enter: id(e.enter, at) };
		case 'post':
			return { post: id(e.post, at) };
		case 'settle':
			return { settle: true };
		case 'reveal':
			return { reveal: e.reveal === 'all' ? 'all' : area(e.reveal, at) };
		case 'explore':
			return { explore: e.explore === 'all' ? 'all' : area(e.explore, at) };
		case 'motion': {
			const m = obj(e.motion, at);
			return {
				motion: {
					prop: id(m.prop, `${at}.prop`),
					kind: m.kind === null ? null : oneOf(m.kind, MOTION_KINDS, `${at}.kind`),
					sound: m.sound === null ? null : oneOf(m.sound, SOUNDS, `${at}.sound`)
				}
			};
		}
		case 'heal':
			return { heal: int(e.heal, at, 1, 100) };
		case 'detect':
			return { detect: true };
		case 'remember':
			return { remember: key(e.remember, at) };
		case 'reward':
			return { reward: name(e.reward, at) };
		case 'count':
			return {
				count: text(e.count, at),
				...(e.else === undefined ? {} : { else: text(e.else, `${path}.else`) })
			};
		case 'phase':
			return { phase: id(e.phase, at) };
		case 'hazard':
			if (e.hazard !== 'open') bad(at, 'expected "open"');
			return { hazard: 'open' };
		case 'light': {
			const color = e.color;
			if (color !== undefined && (typeof color !== 'string' || !COLOR.test(color))) {
				bad(`${path}.color`, 'expected a colour, #rrggbb');
			}
			return {
				light: id(e.light, at),
				...(e.on === undefined ? {} : { on: e.on === true }),
				...(color === undefined ? {} : { color: color as string }),
				...(e.radius === undefined ? {} : { radius: int(e.radius, `${path}.radius`, 0, 20) })
			};
		}
		case 'prop':
			if (!isAssetId(e.asset)) bad(`${path}.asset`, 'expected a prop asset');
			return { prop: id(e.prop, at), asset: e.asset };
		case 'ambient':
			return { ambient: oneOf(e.ambient, AMBIENTS, at) };
		case 'hurt': {
			const h = obj(e.hurt, at);
			return {
				hurt: {
					near: id(h.near, `${at}.near`),
					within: int(h.within, `${at}.within`, 0, 20),
					dice: dice(h.dice, `${at}.dice`),
					text: text(h.text, `${at}.text`, 200)
				}
			};
		}
		case 'spawn': {
			const s = obj(e.spawn, at);
			return {
				spawn: {
					kind: id(s.kind, `${at}.kind`),
					at: list(s.at, `${at}.at`, cell),
					text: text(s.text, `${at}.text`)
				}
			};
		}
		case 'rules':
			return { rules: rules(e.rules, at, depth + 1) };
	}
}

// ---------------------------------------------------------------------------
// The adventure

const STAT_IDS = STATS.map((s) => s.id);
const OBJECT_KINDS = [
	'npc',
	'door',
	'chest',
	'book',
	'table',
	'torch',
	'ritual',
	'corpse',
	'secret',
	'container',
	'landmark',
	'mechanism',
	'item'
] as const;
const BEHAVIORS: readonly Behavior[] = ['rush', 'skirmish', 'guardian', 'grasp'];

function check(v: unknown, path: string) {
	const c = obj(v, path);
	return { stat: oneOf(c.stat, STAT_IDS, `${path}.stat`), dc: int(c.dc, `${path}.dc`, 1, 40) };
}

function parseObject(v: unknown, path: string): ObjectDef {
	const o = obj(v, path);
	const thing = obj(o.thing, `${path}.thing`);
	const kinds = (['token', 'prop', 'door'] as const).filter((k) => k in thing);
	if (kinds.length !== 1) bad(`${path}.thing`, 'expected one of token, prop, door');
	const looks = opt(o.looks, (x) =>
		dict(x, `${path}.looks`, (l, p) => {
			const look = obj(l, p);
			if (look.assetId !== undefined && !isAssetId(look.assetId))
				bad(`${p}.assetId`, 'no such prop');
			return {
				...(look.assetId === undefined ? {} : { assetId: look.assetId as never }),
				...(look.offset === undefined ? {} : { offset: offset(look.offset, `${p}.offset`) }),
				...(look.lit === undefined ? {} : { lit: look.lit === true })
			};
		})
	);
	if (looks) for (const s of Object.keys(looks)) state(s, `${path}.looks key`);
	return {
		id: id(o.id, `${path}.id`),
		name: name(o.name, `${path}.name`),
		kind: oneOf(o.kind, OBJECT_KINDS, `${path}.kind`),
		location: id(o.location, `${path}.location`),
		thing: { [kinds[0]]: id(thing[kinds[0]], `${path}.thing.${kinds[0]}`) } as ObjectDef['thing'],
		...(o.light === undefined ? {} : { light: id(o.light, `${path}.light`) }),
		initial: state(o.initial, `${path}.initial`),
		states: list(o.states, `${path}.states`, state, OBJECT_STATE_COUNT),
		verbs: list(
			o.verbs,
			`${path}.verbs`,
			(vb, p) => {
				const verb = obj(vb, p);
				return {
					id: id(verb.id, `${p}.id`),
					label: name(verb.label, `${p}.label`),
					from: list(verb.from, `${p}.from`, state, OBJECT_STATE_COUNT),
					...(verb.to === undefined ? {} : { to: state(verb.to, `${p}.to`) }),
					...(verb.action === undefined
						? {}
						: {
								action: oneOf(
									verb.action,
									Object.keys(INVESTIGATION_ACTIONS) as (keyof typeof INVESTIGATION_ACTIONS)[],
									`${p}.action`
								)
							}),
					...(verb.check === undefined ? {} : { check: check(verb.check, `${p}.check`) }),
					...(verb.physical === undefined
						? {}
						: {
								physical: oneOf(
									verb.physical,
									Object.keys(PHYSICAL_ACTIONS) as (keyof typeof PHYSICAL_ACTIONS)[],
									`${p}.physical`
								)
							}),
					...(verb.needs === undefined ? {} : { needs: id(verb.needs, `${p}.needs`) }),
					...(verb.sound === undefined ? {} : { sound: oneOf(verb.sound, SOUNDS, `${p}.sound`) }),
					...(verb.inFight === true ? { inFight: true as const } : {}),
					...(verb.triggers === undefined ? {} : { triggers: id(verb.triggers, `${p}.triggers`) }),
					...(verb.does === undefined ? {} : { does: rules(verb.does, `${p}.does`, 0) })
				};
			},
			ADVENTURE_LIMITS.verbs
		),
		...(o.disabledText === undefined
			? {}
			: { disabledText: text(o.disabledText, `${path}.disabledText`, 300) }),
		...(o.secret === undefined ? {} : { secret: edge(o.secret, `${path}.secret`) }),
		...(o.carry === true ? { carry: true as const } : {}),
		...(o.firstFind === undefined ? {} : { firstFind: id(o.firstFind, `${path}.firstFind`) }),
		...(o.noticed === undefined ? {} : { noticed: text(o.noticed, `${path}.noticed`) }),
		...(o.litBy === undefined ? {} : { litBy: id(o.litBy, `${path}.litBy`) }),
		...(looks ? { looks: looks as ObjectDef['looks'] } : {})
	};
}

function offset(v: unknown, path: string): GridPos {
	const c = obj(v, path);
	return { x: int(c.x, `${path}.x`, -99, 99), y: int(c.y, `${path}.y`, -99, 99) };
}

function edge(v: unknown, path: string) {
	const e = obj(v, path);
	return { a: cell(e.a, `${path}.a`), b: cell(e.b, `${path}.b`) };
}

function foes(v: unknown, path: string) {
	return list(v, path, (f, p) => {
		const foe = obj(f, p);
		return {
			kind: id(foe.kind, `${p}.kind`),
			...(foe.hp === undefined ? {} : { hp: hitPoints(foe.hp, `${p}.hp`) })
		};
	});
}

function phase(v: unknown, path: string): PhaseDef {
	const p = obj(v, path);
	const cleared =
		p.cleared === undefined
			? undefined
			: p.cleared === 'continue'
				? ('continue' as const)
				: { event: id(obj(p.cleared, `${path}.cleared`).event, `${path}.cleared.event`) };
	return {
		...(cleared === undefined ? {} : { cleared }),
		...(p.until === undefined
			? {}
			: {
					until: {
						round: int(obj(p.until, `${path}.until`).round, `${path}.until.round`, 1, 99),
						event: id((p.until as Record<string, unknown>).event, `${path}.until.event`)
					}
				}),
		...(p.hazard === undefined ? {} : { hazard: hazard(p.hazard, `${path}.hazard`) }),
		...(p.counter === undefined
			? {}
			: {
					counter: {
						label: name(obj(p.counter, `${path}.counter`).label, `${path}.counter.label`),
						target: int(
							(p.counter as Record<string, unknown>).target,
							`${path}.counter.target`,
							1,
							20
						),
						reached: effects(
							(p.counter as Record<string, unknown>).reached,
							`${path}.counter.reached`
						)
					}
				}),
		...(p.unanswered === undefined
			? {}
			: { unanswered: effects(p.unanswered, `${path}.unanswered`) }),
		...(p.answered === undefined ? {} : { answered: effects(p.answered, `${path}.answered`) })
	};
}

function hazard(v: unknown, path: string) {
	const h = obj(v, path);
	if (!isAssetId(h.asset)) bad(`${path}.asset`, 'expected a prop asset');
	return {
		asset: h.asset,
		prefix: `${id(h.prefix, `${path}.prefix`)}-`.replace(/-+$/, '-'),
		damage: dice(h.damage, `${path}.damage`),
		opens: text(h.opens, `${path}.opens`),
		heaves: text(h.heaves, `${path}.heaves`),
		caught: text(h.caught, `${path}.caught`, 200),
		...(h.avoid === undefined ? {} : { avoid: id(h.avoid, `${path}.avoid`) })
	};
}

function encounter(v: unknown, path: string): EncounterFile {
	const e = obj(v, path);
	const won = opt(e.won, (x) => {
		const w = obj(x, `${path}.won`);
		return {
			...(w.text === undefined ? {} : { text: text(w.text, `${path}.won.text`) }),
			...(w.event === undefined ? {} : { event: id(w.event, `${path}.won.event`) }),
			...(w.does === undefined ? {} : { does: effects(w.does, `${path}.won.does`) })
		};
	});
	const phases = opt(e.phases, (x) => {
		const ph = obj(x, `${path}.phases`);
		return {
			first: id(ph.first, `${path}.phases.first`),
			all: dict(ph.all, `${path}.phases.all`, phase, 8)
		};
	});
	const remains = opt(e.remains, (x) => {
		const r = obj(x, `${path}.remains`);
		if (!isAssetId(r.asset)) bad(`${path}.remains.asset`, 'expected a prop asset');
		return {
			object: id(r.object, `${path}.remains.object`),
			prop: id(r.prop, `${path}.remains.prop`),
			asset: r.asset
		};
	});
	return {
		name: name(e.name, `${path}.name`),
		location: e.location === null ? null : id(e.location, `${path}.location`),
		ring: list(e.ring, `${path}.ring`, cell),
		foes: foes(e.foes, `${path}.foes`),
		...(e.more === undefined
			? {}
			: {
					more: list(e.more, `${path}.more`, (m, p) => {
						const more = obj(m, p);
						return { if: when(more.if, `${p}.if`), foes: foes(more.foes, `${p}.foes`) };
					})
				}),
		...(e.sentries === undefined
			? {}
			: {
					sentries: list(e.sentries, `${path}.sentries`, (s, p) => {
						const sentry = obj(s, p);
						return {
							kind: id(sentry.kind, `${p}.kind`),
							route: list(sentry.route, `${p}.route`, cell, 16)
						};
					})
				}),
		...(e.reveal === undefined ? {} : { reveal: area(e.reveal, `${path}.reveal`) }),
		...(e.opening === undefined ? {} : { opening: text(e.opening, `${path}.opening`) }),
		...(e.shot === undefined ? {} : { shot: shot(e.shot, `${path}.shot`) }),
		...(phases ? { phases } : {}),
		...(won ? { won } : {}),
		...(e.calledOff === undefined ? {} : { calledOff: effects(e.calledOff, `${path}.calledOff`) }),
		...(remains ? { remains } : {})
	};
}

function enemy(v: unknown, path: string): EnemyFile {
	const e = obj(v, path);
	if (typeof e.model !== 'string' || !ASSET_ID_PATTERN.test(e.model)) {
		bad(`${path}.model`, 'expected a model asset id');
	}
	if (typeof e.color !== 'string' || !COLOR.test(e.color)) bad(`${path}.color`, 'expected #rrggbb');
	const toll = opt(e.toll, (x) => {
		const t = obj(x, `${path}.toll`);
		return {
			range: int(t.range, `${path}.toll.range`, 1, 10),
			damage: dice(t.damage, `${path}.toll.damage`),
			rounds: int(t.rounds, `${path}.toll.rounds`, 1, 5),
			every: int(t.every, `${path}.toll.every`, 0, 10),
			text: text(t.text, `${path}.toll.text`, 300),
			flash: text(t.flash, `${path}.toll.flash`, 300)
		};
	});
	return {
		name: name(e.name, `${path}.name`),
		model: e.model as string,
		color: e.color as string,
		armor: int(e.armor, `${path}.armor`, 0, 20),
		speed: int(e.speed, `${path}.speed`, 0, 20),
		vision: int(e.vision, `${path}.vision`, 1, 30),
		light: int(e.light, `${path}.light`, 0, 20),
		initiative: int(e.initiative, `${path}.initiative`, -10, 20),
		hp: hitPoints(e.hp, `${path}.hp`),
		attacks: list(
			e.attacks,
			`${path}.attacks`,
			(a, p) => {
				const attack = obj(a, p);
				return {
					name: name(attack.name, `${p}.name`),
					range: int(attack.range, `${p}.range`, 1, 20),
					toHit: int(attack.toHit, `${p}.toHit`, -5, 20),
					damage: dice(attack.damage, `${p}.damage`)
				};
			},
			2
		),
		behavior: oneOf(e.behavior, BEHAVIORS, `${path}.behavior`),
		...(toll ? { toll } : {})
	};
}

function npc(v: unknown, path: string): NpcFile {
	const n = obj(v, path);
	if (typeof n.model !== 'string' || !ASSET_ID_PATTERN.test(n.model)) {
		bad(`${path}.model`, 'expected a model asset id');
	}
	if (typeof n.color !== 'string' || !COLOR.test(n.color)) bad(`${path}.color`, 'expected #rrggbb');
	const places = dict(n.places, `${path}.places`, cell, 8);
	if (!places.calm) bad(`${path}.places`, 'needs a calm place');
	return {
		name: name(n.name, `${path}.name`),
		role: text(n.role, `${path}.role`, 200),
		speaker: name(n.speaker, `${path}.speaker`),
		...(n.token === undefined ? {} : { token: id(n.token, `${path}.token`) }),
		color: n.color as string,
		model: n.model as string,
		location: id(n.location, `${path}.location`),
		home: text(n.home, `${path}.home`, 200),
		places: places as NpcFile['places'],
		states: list(n.states, `${path}.states`, id, 16),
		lines: list(
			n.lines,
			`${path}.lines`,
			(l, p) => {
				const line = obj(l, p);
				return {
					id: id(line.id, `${p}.id`),
					text: text(line.text, `${p}.text`),
					...(line.if === undefined ? {} : { if: when(line.if, `${p}.if`) }),
					...(line.once === true ? { once: true } : {}),
					...(line.narrated === true ? { narrated: true } : {}),
					...(line.clue === undefined ? {} : { clue: id(line.clue, `${p}.clue`) }),
					...(line.becomes === undefined ? {} : { becomes: id(line.becomes, `${p}.becomes`) }),
					...(line.event === undefined ? {} : { event: id(line.event, `${p}.event`) }),
					...(line.heals === undefined ? {} : { heals: int(line.heals, `${p}.heals`, 1, 100) })
				};
			},
			ADVENTURE_LIMITS.lines
		)
	};
}

function ending(v: unknown, path: string): EndingFile {
	const e = obj(v, path);
	return {
		ending: id(e.ending, `${path}.ending`),
		subtitle: name(e.subtitle, `${path}.subtitle`),
		headline: name(e.headline, `${path}.headline`),
		text: text(e.text, `${path}.text`),
		scene: text(e.scene, `${path}.scene`),
		cue: oneOf(e.cue, CUES, `${path}.cue`),
		result: list(
			e.result,
			`${path}.result`,
			(r, p) => {
				const row = obj(r, p);
				return { label: name(row.label, `${p}.label`), value: text(row.value, `${p}.value`, 300) };
			},
			8
		),
		...(e.lines === undefined ? {} : { lines: rules(e.lines, `${path}.lines`, 0) }),
		...(e.does === undefined ? {} : { does: effects(e.does, `${path}.does`) })
	};
}

const VOICE_KEYS: readonly (keyof Voice)[] = [
	'started',
	'notNow',
	'nothingFound',
	'hearNothing',
	'seeNothing',
	'cantMakeOut',
	'blocked',
	'revive',
	'defeat',
	'gone'
];

/** What the rules say when an adventure doesn't say it in its own words. */
export const DEFAULT_VOICE: Voice = {
	started: 'The story is ready. Choose your characters.',
	notNow: 'Not now: there is a fight on.',
	nothingFound: 'You find nothing more.',
	hearNothing: 'You hear nothing out of the ordinary.',
	seeNothing: 'You see nothing out of the ordinary.',
	cantMakeOut: 'There is something, but you can’t make it out.',
	blocked: 'The {name} won’t go that way.',
	revive: 'The fallen get back on their feet.',
	defeat: 'The party has fallen. The story ends here.',
	gone: '{name} is gone.'
};

/** Checks an adventure file field by field; anything it doesn't know is dropped. */
export function parseAdventureFile(raw: unknown): AdventureFileParse {
	try {
		return { ok: true, file: parse(raw) };
	} catch (err) {
		if (err instanceof Bad) return { ok: false, error: err.message };
		throw err;
	}
}

function parse(raw: unknown): AdventureFile {
	const f = obj(raw, 'file');
	if (f.format !== ADVENTURE_FILE_FORMAT) bad('format', 'not a thirdfold adventure');
	if (f.version !== ADVENTURE_FILE_VERSION) bad('version', `expected ${ADVENTURE_FILE_VERSION}`);
	const L = ADVENTURE_LIMITS;
	const start = obj(f.start, 'start');
	const endings = obj(f.endings, 'endings');
	return {
		format: ADVENTURE_FILE_FORMAT,
		version: ADVENTURE_FILE_VERSION,
		title: name(f.title, 'title'),
		about: f.about === undefined ? '' : text(f.about, 'about', 600),
		characters: list(f.characters, 'characters', (c, p) =>
			oneOf(c, CHARACTER_IDS as readonly string[], p)
		),
		start: {
			location: id(start.location, 'start.location'),
			chapter: id(start.chapter, 'start.chapter'),
			arrival: effects(start.arrival ?? [], 'start.arrival')
		},
		locations: dict(
			f.locations,
			'locations',
			(l, p) => {
				const loc = obj(l, p);
				const scene = parseSceneFile(loc.scene);
				if (!scene.ok) bad(`${p}.scene`, scene.error);
				return {
					name: name(loc.name, `${p}.name`),
					welcome: text(loc.welcome, `${p}.welcome`),
					spawn: list(loc.spawn, `${p}.spawn`, cell, 8),
					scene: { ...scene.scene, adventure: null, discovery: {} }
				};
			},
			L.locations
		),
		areas: list(f.areas ?? [], 'areas', (a, p) => {
			const o = obj(a, p);
			return {
				...area(o, p),
				event: id(o.event, `${p}.event`),
				during: id(o.during, `${p}.during`),
				location: id(o.location, `${p}.location`),
				...(o.after === undefined ? {} : { after: id(o.after, `${p}.after`) })
			};
		}),
		chapters: dict(
			f.chapters,
			'chapters',
			(c, p) => {
				const ch = obj(c, p);
				const next = obj(ch.next, `${p}.next`);
				return {
					title: name(ch.title, `${p}.title`),
					location: id(ch.location, `${p}.location`),
					objectives: list(ch.objectives, `${p}.objectives`, (o, op) => {
						const ob = obj(o, op);
						return {
							id: id(ob.id, `${op}.id`),
							text: text(ob.text, `${op}.text`, 300),
							...(ob.optional === true ? { optional: true } : {}),
							...(ob.after === undefined ? {} : { after: id(ob.after, `${op}.after`) }),
							done: id(ob.done, `${op}.done`)
						};
					}),
					next: {
						on: id(next.on, `${p}.next.on`),
						to: next.to === null ? null : id(next.to, `${p}.next.to`)
					},
					...(ch.opening === undefined ? {} : { opening: effects(ch.opening, `${p}.opening`) })
				};
			},
			L.chapters
		),
		events: dict(
			f.events,
			'events',
			(e, p) => {
				const ev = obj(e, p);
				return {
					label: name(ev.label, `${p}.label`),
					...(ev.does === undefined ? {} : { does: effects(ev.does, `${p}.does`) })
				};
			},
			L.events
		),
		decisions: dict(f.decisions ?? {}, 'decisions', (d, p) => {
			const de = obj(d, p);
			return {
				prompt: text(de.prompt, `${p}.prompt`, 300),
				options: list(
					de.options,
					`${p}.options`,
					(o, op) => {
						const option = obj(o, op);
						return {
							id: id(option.id, `${op}.id`),
							label: name(option.label, `${op}.label`),
							...(option.labels === undefined
								? {}
								: {
										labels: list(option.labels, `${op}.labels`, (l, lp) => {
											const label = obj(l, lp);
											return {
												if: when(label.if, `${lp}.if`),
												label: name(label.label, `${lp}.label`)
											};
										})
									}),
							does: effects(option.does, `${op}.does`)
						};
					},
					8
				)
			};
		}),
		endings: {
			decision: id(endings.decision, 'endings.decision'),
			fallback: id(endings.fallback, 'endings.fallback'),
			byAnswer: dict(endings.byAnswer, 'endings.byAnswer', ending, 8),
			names: dict(
				endings.names,
				'endings.names',
				(n, p) => ({ title: name(obj(n, p).title, `${p}.title`) }),
				8
			)
		},
		npcs: dict(f.npcs ?? {}, 'npcs', npc, L.npcs),
		peoplePlaces: list(f.peoplePlaces ?? [], 'peoplePlaces', (pp, p) => {
			const o = obj(pp, p);
			return { place: id(o.place, `${p}.place`), if: when(o.if, `${p}.if`) };
		}),
		reactions: list(
			f.reactions ?? [],
			'reactions',
			(r, p) => {
				const o = obj(r, p);
				return {
					id: id(o.id, `${p}.id`),
					npc: id(o.npc, `${p}.npc`),
					on: key(o.on, `${p}.on`),
					text: text(o.text, `${p}.text`),
					...(o.within === undefined ? {} : { within: int(o.within, `${p}.within`, 0, 30) })
				};
			},
			L.objects
		),
		objects: list(f.objects ?? [], 'objects', parseObject, L.objects),
		signs: list(f.signs ?? [], 'signs', (s, p) => {
			const o = obj(s, p);
			return {
				id: id(o.id, `${p}.id`),
				location: id(o.location, `${p}.location`),
				sense: oneOf(o.sense, ['listen', 'observe'] as const, `${p}.sense`),
				at: cell(o.at, `${p}.at`),
				range: int(o.range, `${p}.range`, 1, 20),
				check: check(o.check, `${p}.check`),
				clue: id(o.clue, `${p}.clue`)
			};
		}),
		clues: dict(
			f.clues ?? {},
			'clues',
			(c, p) => {
				const o = obj(c, p);
				return {
					title: name(o.title, `${p}.title`),
					text: text(o.text, `${p}.text`),
					kind: oneOf(
						o.kind,
						Object.keys(EVIDENCE_KINDS) as (keyof typeof EVIDENCE_KINDS)[],
						`${p}.kind`
					),
					...(o.unlocks === undefined ? {} : { unlocks: id(o.unlocks, `${p}.unlocks`) })
				};
			},
			L.clues
		),
		mechanisms: dict(f.mechanisms ?? {}, 'mechanisms', (m, p) => {
			const o = obj(m, p);
			return {
				location: id(o.location, `${p}.location`),
				steps: list(
					o.steps,
					`${p}.steps`,
					(s, sp) => {
						const step = obj(s, sp);
						const set = opt(step.set, (x) => {
							const st = obj(x, `${sp}.set`);
							return {
								object: id(st.object, `${sp}.set.object`),
								state: state(st.state, `${sp}.set.state`)
							};
						});
						const motion = opt(step.motion, (x) => {
							const mo = obj(x, `${sp}.motion`);
							return {
								prop: id(mo.prop, `${sp}.motion.prop`),
								kind: mo.kind === null ? null : oneOf(mo.kind, MOTION_KINDS, `${sp}.motion.kind`),
								sound: mo.sound === null ? null : oneOf(mo.sound, SOUNDS, `${sp}.motion.sound`)
							};
						});
						return {
							after: int(step.after, `${sp}.after`, 0, 60_000),
							...(set ? { set } : {}),
							...(motion ? { motion } : {}),
							...(step.text === undefined ? {} : { text: text(step.text, `${sp}.text`) }),
							...(step.event === undefined ? {} : { event: id(step.event, `${sp}.event`) })
						};
					},
					16
				)
			};
		}),
		enemies: dict(f.enemies ?? {}, 'enemies', enemy, L.enemies),
		encounters: dict(f.encounters ?? {}, 'encounters', encounter, L.encounters),
		...(f.ward === undefined
			? {}
			: {
					ward: {
						object: id(obj(f.ward, 'ward').object, 'ward.object'),
						touched: state((f.ward as Record<string, unknown>).touched, 'ward.touched')
					}
				}),
		cues: list(f.cues ?? [], 'cues', (c, p) => {
			const o = obj(c, p);
			return {
				id: id(o.id, `${p}.id`),
				title: name(o.title, `${p}.title`),
				text: text(o.text, `${p}.text`)
			};
		}),
		...(f.voice === undefined
			? {}
			: {
					voice: Object.fromEntries(
						VOICE_KEYS.flatMap((k) => {
							const v = (f.voice as Record<string, unknown>)[k];
							return v === undefined ? [] : [[k, text(v, `voice.${k}`, 300)]];
						})
					) as Partial<Voice>
				})
	};
}

const hp =
	({ base, perCharacter }: HitPoints) =>
	(characters: number) =>
		base + perCharacter * Math.max(1, characters);

/** The token of each person at a location, where they stand calm. */
function peopleAt(file: AdventureFile, location: string): SavedToken[] {
	return Object.entries(file.npcs)
		.filter(([, n]) => n.location === location)
		.map(([npcId, n]) => ({
			id: n.token ?? `npc-${npcId}`,
			name: n.name,
			color: n.color,
			pos: { ...n.places.calm },
			vision: 6,
			light: 0,
			model: n.model,
			owner: null
		}));
}

/**
 * The adventure the engine runs, from a checked file. `id` is what the
 * server calls it (a custom adventure's id is derived from its content).
 */
export function compileAdventure(file: AdventureFile, id: string): AdventureDef {
	const withIds = <T>(record: Record<string, T>) =>
		Object.fromEntries(Object.entries(record).map(([k, v]) => [k, { ...v, id: k }]));
	const npcs: Record<string, NpcDef> = Object.fromEntries(
		Object.entries(file.npcs).map(([k, n]) => [k, { ...n, id: k, token: n.token ?? `npc-${k}` }])
	);
	// Everyone the party can talk to is a world object with the verb `talk`, unless the file says otherwise.
	const talkers = Object.values(npcs)
		.filter((n) => !file.objects.some((o) => o.id === n.id))
		.map((n): ObjectDef => ({
			id: n.id,
			name: n.name,
			kind: 'npc',
			location: n.location,
			thing: { token: n.token },
			initial: 'interactable',
			states: ['interactable', 'visible'],
			verbs: [{ id: 'talk', label: `Talk to ${n.name}`, from: ['interactable'] }]
		}));
	const foes = (list: EncounterFile['foes']) =>
		list.map((f) => ({ kind: f.kind, ...(f.hp ? { hp: hp(f.hp) } : {}) }));
	return {
		id,
		title: file.title,
		version: 1,
		characters: Object.fromEntries(file.characters.map((c) => [c, CHARACTERS[c]])),
		start: file.start,
		locations: Object.fromEntries(
			Object.entries(file.locations).map(([k, l]) => {
				const people = peopleAt(file, k);
				const scene = (): SceneFile => {
					const s = structuredClone(l.scene);
					const ids = new Set(s.tokens.map((t) => t.id));
					return { ...s, tokens: [...s.tokens, ...people.filter((p) => !ids.has(p.id))] };
				};
				return [k, { name: l.name, welcome: l.welcome, spawn: l.spawn, scene }];
			})
		),
		areas: file.areas,
		chapters: withIds(file.chapters) as AdventureDef['chapters'],
		events: file.events,
		decisions: withIds(file.decisions) as AdventureDef['decisions'],
		endings: file.endings,
		npcs,
		peoplePlaces: file.peoplePlaces,
		reactions: file.reactions,
		objects: [...file.objects, ...talkers],
		signs: file.signs,
		clues: withIds(file.clues) as AdventureDef['clues'],
		mechanisms: withIds(file.mechanisms) as AdventureDef['mechanisms'],
		enemies: Object.fromEntries(
			Object.entries(file.enemies).map(([k, e]): [string, EnemyDef] => [
				k,
				{ ...e, kind: k, hp: hp(e.hp) }
			])
		),
		encounters: Object.fromEntries(
			Object.entries(file.encounters).map(
				([k, { foes: list, more, ...rest }]): [string, EncounterDef] => [
					k,
					{
						...rest,
						foes: foes(list),
						...(more ? { more: more.map((m) => ({ if: m.if, foes: foes(m.foes) })) } : {})
					}
				]
			)
		),
		...(file.ward ? { ward: file.ward } : {}),
		cues: file.cues,
		voice: { ...DEFAULT_VOICE, ...file.voice }
	};
}

export type AdventureLoad =
	| { ok: true; file: AdventureFile; adventure: AdventureDef }
	| { ok: false; error: string; problems?: string[] };

/**
 * Parses, compiles and checks an adventure file: what the builder shows as
 * problems, and what the server requires before it runs one.
 */
export function loadAdventureFile(raw: unknown, adventureId: string): AdventureLoad {
	const parsed = parseAdventureFile(raw);
	if (!parsed.ok) return parsed;
	const adventure = compileAdventure(parsed.file, adventureId);
	const problems = problemsOf(parsed.file, adventure);
	if (problems.length) {
		return {
			ok: false,
			error: `The adventure has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}: ${problems[0]}`,
			problems
		};
	}
	return { ok: true, file: parsed.file, adventure };
}

/** Everything wrong with an adventure beyond its shape: references that go nowhere, and what it lacks. */
function problemsOf(file: AdventureFile, adventure: AdventureDef): string[] {
	const problems = validateAdventure(adventure);
	if (file.characters.length === 0) problems.push('characters: pick at least one');
	for (const [k, l] of Object.entries(file.locations)) {
		if (l.spawn.length === 0) problems.push(`location ${k}: no spawn cells`);
		const g = l.scene.grid;
		for (const c of l.spawn) {
			if (c.x >= g.width || c.y >= g.height)
				problems.push(`location ${k}: a spawn cell is off the table`);
		}
	}
	for (const o of adventure.objects) {
		const scene = adventure.locations[o.location]?.scene();
		if (!scene) continue;
		const there =
			'prop' in o.thing
				? scene.props.some((p) => p.id === (o.thing as { prop: string }).prop)
				: 'door' in o.thing
					? o.secret || scene.objects.some((d) => d.id === (o.thing as { door: string }).door)
					: scene.tokens.some((t) => t.id === (o.thing as { token: string }).token);
		if (!there && !o.carry) problems.push(`object ${o.id}: not on the ${o.location} table`);
	}
	if (Object.hasOwn(file.encounters, AMBUSH)) problems.push(`fight ${AMBUSH}: a reserved id`);
	return problems;
}
