// Saving a story with the table, and reading it back. A save is plain
// JSON inside the scene file's `adventure` field (scene file v4). The core
// scene parser only checks it is JSON; everything in it is validated here, as
// strictly as live actions, against the scene it was saved with, before the
// room is touched. A tampered save can at worst be rejected.

import {
	isObjectState,
	type AdventureStage,
	type EncounterState,
	type ObjectState
} from '../../src/lib/adventure/adventure';
import { BLEED_OUT_ROUNDS, STATUS_IDS, type StatusId } from '../../src/lib/adventure/characters';
import { inBounds, type GridPos } from '../../src/lib/game/grid';
import { isAssetId, type Rotation } from '../../src/lib/game/props';
import type { SavedStory, SceneFile } from '../../src/lib/game/scene-file';
import { AMBUSH, type AdventureDef, type ObjectDef } from './define';
import { contentOf, findAdventure } from './registry';
import type {
	AdventureState,
	CharacterState,
	Decision,
	Finding,
	Encounter,
	EnemyState,
	Sentry,
	Statuses,
	TurnEntry
} from './state';
import { objectDef, type Origins } from './world';

const STAGES: readonly AdventureStage[] = ['choosing', 'playing', 'complete', 'defeat'];
const ENCOUNTER_STATES: readonly EncounterState[] = ['active', 'won', 'lost'];
const NAME_MAX = 48;
/** A failed check, after the character: `<object>:<verb>` or `sign:<id>`. */
const TRIED = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,40}$/;
const LIST_MAX = 100;
const COUNT_MAX = 999;

const entriesOf = <K extends string, V>(map: Map<K, V>) => Object.fromEntries(map);

/** The story as saved: Maps and Sets become plain objects and arrays. */
export function saveAdventure(adventure: AdventureState): SavedStory {
	const statuses = (s: Statuses) => entriesOf(s);
	const A = contentOf(adventure.id);
	return {
		id: A.id,
		version: A.version,
		state: {
			stage: adventure.stage,
			chapter: adventure.chapter,
			location: adventure.location,
			characters: Object.fromEntries(
				[...adventure.characters].map(([id, c]) => [
					id,
					{
						tokenId: c.tokenId,
						hp: c.hp,
						statuses: statuses(c.statuses),
						uses: entriesOf(c.uses),
						downedFor: c.downedFor,
						dead: c.dead
					}
				])
			),
			evidence: Object.fromEntries(
				[...adventure.evidence].map(([id, f]) => [id, { by: [...f.by], shared: f.shared }])
			),
			tried: [...adventure.tried],
			events: [...adventure.events],
			defeated: [...adventure.defeated],
			npcs: entriesOf(adventure.npcs),
			said: [...adventure.said],
			decisions: Object.fromEntries(
				[...adventure.decisions].map(([id, d]) => [id, { option: d.option, by: d.by }])
			),
			pending: adventure.pending,
			encounters: entriesOf(adventure.encounters),
			ending: adventure.ending,
			objects: entriesOf(adventure.objects),
			origins: Object.fromEntries(
				[...adventure.origins].map(([id, o]) => [
					id,
					{ pos: { ...o.pos }, assetId: o.assetId, rotation: o.rotation }
				])
			),
			carried: entriesOf(adventure.carried),
			running: entriesOf(adventure.running),
			sentries: Object.fromEntries(
				[...adventure.sentries].map(([id, s]) => [
					id,
					{
						kind: s.kind,
						encounter: s.encounter,
						route: s.route.map((c) => ({ ...c })),
						leg: s.leg
					}
				])
			),
			cuesRead: [...adventure.cuesRead],
			encounter: adventure.encounter && {
				id: adventure.encounter.id,
				round: adventure.encounter.round,
				order: adventure.encounter.order.map((t) =>
					t.kind === 'character'
						? { character: t.id, initiative: t.initiative }
						: { enemy: t.tokenId, initiative: t.initiative }
				),
				current: adventure.encounter.current,
				speed: adventure.encounter.speed,
				acted: [...adventure.encounter.acted],
				moved: entriesOf(adventure.encounter.moved),
				enemies: Object.fromEntries(
					[...adventure.encounter.enemies].map(([id, e]) => [
						id,
						{
							kind: e.kind,
							hp: e.hp,
							maxHp: e.maxHp,
							statuses: statuses(e.statuses),
							rest: e.rest,
							...(e.post ? { post: { ...e.post } } : {}),
							...(e.target ? { target: e.target } : {}),
							...(e.lastHitBy ? { lastHitBy: e.lastHitBy } : {}),
							...(e.lastSeen ? { lastSeen: { ...e.lastSeen } } : {})
						}
					])
				),
				turn: adventure.encounter.turn,
				...(adventure.encounter.finale
					? {
							finale: adventure.encounter.finale,
							cracks: (adventure.encounter.cracks ?? []).map((c) => ({ ...c })),
							pulls: adventure.encounter.pulls ?? 0,
							pulled: adventure.encounter.pulled ?? false
						}
					: {})
			},
			begunAt: adventure.begunAt,
			completedAt: adventure.completedAt
		}
	};
}

export type AdventureRead = { ok: true; adventure: AdventureState } | { ok: false; error: string };

class Invalid extends Error {}

function check(condition: unknown, what: string): asserts condition {
	if (!condition) throw new Invalid(what);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
	check(isRecord(value), what);
	check(Object.keys(value).length <= LIST_MAX, what);
	return value;
}

function list(value: unknown, what: string): unknown[] {
	check(Array.isArray(value) && value.length <= LIST_MAX, what);
	return value;
}

function bool(value: unknown, what: string): boolean {
	check(typeof value === 'boolean', what);
	return value as boolean;
}

function int(value: unknown, min: number, max: number, what: string): number {
	check(Number.isInteger(value) && (value as number) >= min && (value as number) <= max, what);
	return value as number;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
	check(typeof value === 'string' && (options as readonly string[]).includes(value), what);
	return value as T;
}

function uniqueList<T extends string>(value: unknown, options: readonly T[], what: string): T[] {
	const items = list(value, what).map((v) => oneOf(v, options, what));
	check(new Set(items).size === items.length, what);
	return items;
}

function name(value: unknown, what: string): string {
	check(typeof value === 'string' && value.length > 0 && value.length <= NAME_MAX, what);
	return value;
}

function time(value: unknown, what: string): number | null {
	if (value === null) return null;
	check(typeof value === 'number' && Number.isFinite(value) && value >= 0, what);
	return value;
}

function statuses(value: unknown, what: string): Statuses {
	const map: Statuses = new Map();
	for (const [id, rounds] of Object.entries(record(value, what))) {
		map.set(oneOf(id, STATUS_IDS, what) as StatusId, int(rounds, 1, COUNT_MAX, what));
	}
	return map;
}

/**
 * Reads a saved story back, checking every field against the story's own
 * rules and against the scene it was saved with (the tokens it names must be
 * on that table). Does not touch any room.
 */
export function readAdventure(saved: SavedStory, scene: SceneFile): AdventureRead {
	const A = findAdventure(saved.id);
	if (!A) {
		return { ok: false, error: 'This table was saved with a story this server does not know.' };
	}
	if (saved.version > A.version) {
		return { ok: false, error: 'This story was saved by a newer version of thirdfold.' };
	}
	try {
		return { ok: true, adventure: read(A, saved.state, scene) };
	} catch (err) {
		if (err instanceof Invalid)
			return { ok: false, error: `The saved story is invalid: ${err.message}.` };
		throw err;
	}
}

function read(A: AdventureDef, data: Record<string, unknown>, scene: SceneFile): AdventureState {
	const tokenIds = new Set(scene.tokens.map((t) => t.id));
	const stage = oneOf(data.stage, STAGES, 'stage');
	const chapter = oneOf(data.chapter, Object.keys(A.chapters), 'chapter');
	const location = oneOf(data.location, Object.keys(A.locations), 'location');
	check(A.chapters[chapter].location === location, 'chapter and location disagree');
	const characterIds = Object.keys(A.characters);
	const isCharacterId = (value: unknown): value is string =>
		typeof value === 'string' && characterIds.includes(value);
	const character = (value: unknown, what: string): string => {
		check(isCharacterId(value), what);
		return value;
	};

	const characters = new Map<string, CharacterState>();
	const characterTokens = new Set<string>();
	for (const [id, raw] of Object.entries(record(data.characters, 'characters'))) {
		check(isCharacterId(id), 'character');
		const c = record(raw, 'character');
		const def = A.characters[id];
		check(typeof c.tokenId === 'string' && tokenIds.has(c.tokenId), `${def.name}'s token`);
		check(!characterTokens.has(c.tokenId), `${def.name}'s token`);
		characterTokens.add(c.tokenId);
		const uses = new Map<string, number>();
		for (const [actionId, n] of Object.entries(record(c.uses, 'uses'))) {
			const action = def.actions.find((a) => a.id === actionId);
			check(action && action.uses !== null, `${def.name}'s uses`);
			uses.set(actionId, int(n, 0, action.uses, `${def.name}'s uses`));
		}
		check(typeof c.dead === 'boolean', `${def.name}'s condition`);
		characters.set(id, {
			tokenId: c.tokenId,
			hp: int(c.hp, 0, def.hp, `${def.name}'s hit points`),
			statuses: statuses(c.statuses, `${def.name}'s statuses`),
			uses,
			downedFor: int(c.downedFor, 0, BLEED_OUT_ROUNDS, `${def.name}'s condition`),
			dead: c.dead
		});
	}

	const npcs = new Map<string, string>();
	for (const [id, state] of Object.entries(record(data.npcs, 'people'))) {
		const npc = A.npcs[oneOf(id, Object.keys(A.npcs), 'person')];
		npcs.set(npc.id, oneOf(state, npc.states, `${npc.name}'s state`));
	}
	for (const npc of Object.values(A.npcs)) if (!npcs.has(npc.id)) npcs.set(npc.id, npc.states[0]);

	// Saves from before people had lines to remember have none.
	const sayable = [
		...Object.values(A.npcs).flatMap((npc) => npc.lines.map((l) => `${npc.id}:${l.id}`)),
		...A.reactions.map((r) => `reaction:${r.id}`),
		...remembered(A)
	];
	const said = new Set(data.said === undefined ? [] : uniqueList(data.said, sayable, 'lines'));

	const decisions = new Map<string, Decision>();
	const decisionIds = Object.keys(A.decisions);
	const renamedOptions = A.renamed?.options ?? {};
	for (const [id, raw] of Object.entries(record(data.decisions, 'decisions'))) {
		const decision = oneOf(id, decisionIds, 'decision');
		const d = record(raw, 'decision');
		const options = A.decisions[decision].options.map((o) => o.id);
		// Older saves may answer the deciding choice with words since renamed.
		const answer =
			decision === A.endings.decision &&
			typeof d.option === 'string' &&
			Object.hasOwn(renamedOptions, d.option)
				? renamedOptions[d.option]
				: d.option;
		decisions.set(decision, {
			option: oneOf(answer, options, 'choice'),
			by: name(d.by, 'choice')
		});
	}
	const pending = data.pending === null ? null : oneOf(data.pending, decisionIds, 'choice');
	check(!pending || !decisions.has(pending), 'choice');

	const encounterIds = [...Object.keys(A.encounters), AMBUSH];
	const enemyKinds = Object.keys(A.enemies);
	const encounters = new Map<string, EncounterState>();
	for (const [id, state] of Object.entries(record(data.encounters, 'fights'))) {
		encounters.set(oneOf(id, encounterIds, 'fight'), oneOf(state, ENCOUNTER_STATES, 'fight'));
	}

	const objects = new Map<string, ObjectState>();
	for (const [id, state] of Object.entries(record(data.objects, 'objects'))) {
		const def = objectDef(A, id);
		check(def && isObjectState(state), 'object');
		check(
			def.states.includes(state) ||
				state === def.initial ||
				isDoorState(def, state) ||
				(def.carry && state === 'carried'),
			'object'
		);
		objects.set(id, state);
	}

	const origins: Origins = new Map();
	for (const [id, raw] of Object.entries(record(data.origins, 'objects'))) {
		const def = objectDef(A, id);
		const o = record(raw, 'object');
		const pos = record(o.pos, 'object');
		// Items go from table to table with the party; everything else stays where it was.
		check(def && (def.location === location || def.carry) && isAssetId(o.assetId), 'object');
		const at: GridPos = { x: pos.x as number, y: pos.y as number };
		check(Number.isInteger(at.x) && Number.isInteger(at.y) && inBounds(scene.grid, at), 'object');
		// Saves from before things could be turned have none.
		const rotation = (o.rotation === undefined ? 0 : int(o.rotation, 0, 3, 'object')) as Rotation;
		origins.set(id, { pos: at, assetId: o.assetId, rotation });
	}

	// Saves from before things could be carried have nothing in anyone's hands.
	const carried = new Map<string, string>();
	for (const [id, who] of Object.entries(
		data.carried === undefined ? {} : record(data.carried, 'items')
	)) {
		const def = objectDef(A, id);
		check(def?.carry && isCharacterId(who) && characters.has(who), 'items');
		check(objects.get(id) === 'carried' && origins.has(id), 'items');
		carried.set(id, who);
	}
	for (const [id, state] of objects) check(state !== 'carried' || carried.has(id), 'items');

	const running = new Map<string, number>();
	for (const [id, step] of Object.entries(
		data.running === undefined ? {} : record(data.running, 'mechanisms')
	)) {
		const mechanism = A.mechanisms[oneOf(id, Object.keys(A.mechanisms), 'mechanisms')];
		check(mechanism.location === location, 'mechanisms');
		running.set(mechanism.id, int(step, 1, mechanism.steps.length - 1, 'mechanisms'));
	}

	// Saves from before sentries have none on the table.
	const sentries = new Map<string, Sentry>();
	for (const [tokenId, raw] of Object.entries(
		data.sentries === undefined ? {} : record(data.sentries, 'sentries')
	)) {
		check(tokenIds.has(tokenId) && !characterTokens.has(tokenId), 'sentries');
		const sentry = record(raw, 'sentries');
		const route = list(sentry.route, 'sentries').map((c) => cell(c, scene, 'sentries'));
		check(route.length > 0 && route.length <= 16, 'sentries');
		sentries.set(tokenId, {
			kind: oneOf(sentry.kind, enemyKinds, 'sentries'),
			encounter: oneOf(sentry.encounter, encounterIds, 'sentries'),
			route,
			leg: int(sentry.leg, 0, route.length - 1, 'sentries')
		});
	}

	let encounter: Encounter | null = null;
	if (data.encounter !== null) {
		const e = record(data.encounter, 'fight');
		const id = oneOf(e.id, encounterIds, 'fight');
		check(encounters.get(id) === 'active', 'fight');
		const enemies = new Map<string, EnemyState>();
		for (const [tokenId, raw] of Object.entries(record(e.enemies, 'enemies'))) {
			check(tokenIds.has(tokenId) && !characterTokens.has(tokenId), 'enemy');
			const enemy = record(raw, 'enemy');
			const kind = oneOf(enemy.kind, enemyKinds, 'enemy');
			const maxHp = int(enemy.maxHp, 1, COUNT_MAX, 'enemy');
			enemies.set(tokenId, {
				kind,
				hp: int(enemy.hp, 1, maxHp, 'enemy'),
				maxHp,
				statuses: statuses(enemy.statuses, 'enemy'),
				// Saves from before enemies had specials have none resting.
				rest: enemy.rest === undefined ? 0 : int(enemy.rest, 0, COUNT_MAX, 'enemy'),
				...(enemy.post === undefined ? {} : { post: cell(enemy.post, scene, 'enemy') }),
				...(enemy.lastSeen === undefined ? {} : { lastSeen: cell(enemy.lastSeen, scene, 'enemy') }),
				...(enemy.target === undefined ? {} : { target: character(enemy.target, 'enemy') }),
				...(enemy.lastHitBy === undefined ? {} : { lastHitBy: character(enemy.lastHitBy, 'enemy') })
			});
		}
		const order = turnOrder(e, characters, enemies, isCharacterId);
		// Saves from before initiative: whoever the old phase was waiting on goes first.
		const firstEnemy = order.findIndex((t) => t.kind === 'enemy');
		const current =
			e.current === undefined
				? e.phase === 'enemies'
					? firstEnemy
					: 0
				: int(e.current, 0, order.length - 1, 'turn order');
		const up = order[current];
		check(up, 'turn order');
		const moved = new Map<string, number>();
		for (const [who, n] of Object.entries(record(e.moved, 'movement'))) {
			check(isCharacterId(who), 'movement');
			moved.set(who, int(n, 0, COUNT_MAX, 'movement'));
		}
		encounter = {
			id,
			round: int(e.round, 1, COUNT_MAX, 'round'),
			order,
			current,
			speed:
				e.speed === undefined
					? up.kind === 'character'
						? A.characters[up.id].speed
						: 0
					: int(e.speed, 0, COUNT_MAX, 'movement'),
			acted: new Set(
				list(e.acted, 'turns').map((who) => {
					check(isCharacterId(who), 'turns');
					return who;
				})
			),
			moved,
			enemies,
			turn: int(e.turn, 1, 1_000_000, 'turn'),
			...(e.finale === undefined
				? {}
				: {
						finale: oneOf(e.finale, Object.keys(A.encounters[id]?.phases?.all ?? {}), 'fight'),
						cracks: list(e.cracks, 'fight').map((c) => cell(c, scene, 'fight')),
						pulls: int(e.pulls, 0, counterMax(A, id), 'fight'),
						pulled: bool(e.pulled, 'fight')
					})
		};
	}
	check(!encounter || stage === 'playing', 'fight');

	const renamedEndings = A.renamed?.endings ?? {};
	const ending: string | null =
		data.ending === null
			? null
			: typeof data.ending === 'string' && Object.hasOwn(renamedEndings, data.ending)
				? renamedEndings[data.ending]
				: oneOf(data.ending, Object.keys(A.endings.names), 'ending');
	check((ending !== null) === (stage === 'complete'), 'ending');

	const clueIds = Object.keys(A.clues);
	// Evidence, in the order found. Saves from before evidence had finders list clues, all shared.
	const evidence = new Map<string, Finding>();
	if (data.evidence === undefined) {
		for (const id of uniqueList(data.clues, clueIds, 'clues')) {
			evidence.set(id, { by: [], shared: true });
		}
	} else {
		for (const [id, raw] of Object.entries(record(data.evidence, 'evidence'))) {
			oneOf(id, clueIds, 'evidence');
			const f = record(raw, 'evidence');
			check(typeof f.shared === 'boolean', 'evidence');
			const by = uniqueList(f.by, characterIds, 'evidence');
			check(f.shared || by.length > 0, 'evidence');
			evidence.set(id, { by, shared: f.shared });
		}
	}
	const attempts = data.tried === undefined ? [] : list(data.tried, 'checks');
	const tried = new Set(
		attempts.map((t) => {
			check(typeof t === 'string', 'checks');
			const at = t.indexOf(':');
			check(isCharacterId(t.slice(0, at)) && TRIED.test(t.slice(at + 1)), 'checks');
			return t;
		})
	);
	return {
		id: A.id,
		stage,
		chapter,
		location,
		characters,
		evidence,
		tried,
		events: uniqueList(data.events, Object.keys(A.events), 'events'),
		defeated: list(data.defeated, 'defeated enemies').map((n) => name(n, 'defeated enemies')),
		npcs,
		said,
		decisions,
		pending,
		encounters,
		ending,
		objects,
		origins,
		carried,
		running,
		sentries,
		cuesRead: new Set(
			uniqueList(
				data.cuesRead,
				A.cues.map((c) => c.id),
				'passages'
			)
		),
		encounter,
		begunAt: time(data.begunAt, 'time'),
		completedAt: time(data.completedAt, 'time')
	};
}

/** A cell on the saved table. */
function cell(value: unknown, scene: SceneFile, what: string): GridPos {
	const c = record(value, what);
	const at = { x: c.x as number, y: c.y as number };
	check(Number.isInteger(at.x) && Number.isInteger(at.y) && inBounds(scene.grid, at), what);
	return at;
}

/** Moments a story remembers (`remember` effects), which `said` may hold. */
function remembered(A: AdventureDef): string[] {
	const found: string[] = [];
	JSON.stringify(A, (key, value) => {
		if (key === 'remember' && typeof value === 'string') found.push(value);
		return value;
	});
	return found;
}

/** The most a fight's counter can reach. */
function counterMax(A: AdventureDef, id: string): number {
	const phases = Object.values(A.encounters[id]?.phases?.all ?? {});
	return Math.max(0, ...phases.map((p) => p.counter?.target ?? 0));
}

/**
 * The turn order of a saved fight: every entry a character in the story or
 * an enemy in the fight, each once, and every enemy in it. Saves from before
 * initiative have none: the characters, then the enemies.
 */
function turnOrder(
	e: Record<string, unknown>,
	characters: Map<string, CharacterState>,
	enemies: Map<string, EnemyState>,
	isCharacterId: (value: unknown) => value is string
): TurnEntry[] {
	if (e.order === undefined) {
		return [
			...[...characters.keys()].map((id): TurnEntry => ({ kind: 'character', id, initiative: 0 })),
			...[...enemies.keys()].map((tokenId): TurnEntry => ({
				kind: 'enemy',
				tokenId,
				initiative: 0
			}))
		];
	}
	const seen = new Set<string>();
	const order = list(e.order, 'turn order').map((raw): TurnEntry => {
		const t = record(raw, 'turn order');
		const initiative = int(t.initiative, -COUNT_MAX, COUNT_MAX, 'turn order');
		if (t.enemy !== undefined) {
			check(
				typeof t.enemy === 'string' && enemies.has(t.enemy) && !seen.has(t.enemy),
				'turn order'
			);
			seen.add(t.enemy);
			return { kind: 'enemy', tokenId: t.enemy, initiative };
		}
		check(isCharacterId(t.character) && characters.has(t.character), 'turn order');
		check(!seen.has(t.character), 'turn order');
		seen.add(t.character);
		return { kind: 'character', id: t.character, initiative };
	});
	for (const id of enemies.keys()) check(seen.has(id), 'turn order');
	check(order.length > 0, 'turn order');
	return order;
}

/** Doors follow their scene door, so any door may be saved opened or closed. */
function isDoorState(def: ObjectDef, state: ObjectState): boolean {
	return 'door' in def.thing && (state === 'opened' || state === 'closed');
}
