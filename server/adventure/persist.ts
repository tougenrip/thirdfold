// Saving The Hollow Bell with the table, and reading it back. A save is plain
// JSON inside the scene file's `adventure` field (scene file v4). The core
// scene parser only checks it is JSON; everything in it is validated here, as
// strictly as live actions, against the scene it was saved with, before the
// room is touched. A tampered save can at worst be rejected.

import {
	isChapterId,
	isLocationId,
	isObjectState,
	type AdventureStage,
	type EncounterState,
	type ObjectState
} from '../../src/lib/adventure/adventure';
import {
	BLEED_OUT_ROUNDS,
	CHARACTERS,
	isCharacterId,
	STATUS_IDS,
	type CharacterId,
	type StatusId
} from '../../src/lib/adventure/characters';
import { inBounds, type GridPos } from '../../src/lib/game/grid';
import { isAssetId } from '../../src/lib/game/props';
import type { SavedStory, SceneFile } from '../../src/lib/game/scene-file';
import { CLUES, CUES } from './content';
import { objectDef, type Origins } from './objects';
import type {
	AdventureState,
	CharacterState,
	Decision,
	Encounter,
	EnemyState,
	Statuses
} from './state';
import {
	CHAPTERS,
	DECISIONS,
	ENCOUNTER_IDS,
	EVENT_IDS,
	type DecisionId,
	type EncounterId,
	type EndingId,
	type EventId
} from './story';
import { NPC_IDS, NPCS, REACTIONS, type NpcId } from './npcs';

export const SAVE_ID = 'hollow-bell';
export const SAVE_VERSION = 1;

const STAGES: readonly AdventureStage[] = ['choosing', 'playing', 'complete', 'defeat'];
const ENDING_IDS: readonly EndingId[] = ['kept', 'broken', 'silent'];
const ENCOUNTER_STATES: readonly EncounterState[] = ['active', 'won', 'lost'];
const NAME_MAX = 48;
const LIST_MAX = 100;
const COUNT_MAX = 999;

const entriesOf = <K extends string, V>(map: Map<K, V>) => Object.fromEntries(map);

/** The story as saved: Maps and Sets become plain objects and arrays. */
export function saveAdventure(adventure: AdventureState): SavedStory {
	const statuses = (s: Statuses) => entriesOf(s);
	return {
		id: SAVE_ID,
		version: SAVE_VERSION,
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
			clues: [...adventure.clues],
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
				[...adventure.origins].map(([id, o]) => [id, { pos: { ...o.pos }, assetId: o.assetId }])
			),
			cuesRead: [...adventure.cuesRead],
			encounter: adventure.encounter && {
				id: adventure.encounter.id,
				round: adventure.encounter.round,
				phase: adventure.encounter.phase,
				acted: [...adventure.encounter.acted],
				moved: entriesOf(adventure.encounter.moved),
				enemies: Object.fromEntries(
					[...adventure.encounter.enemies].map(([id, e]) => [
						id,
						{ kind: e.kind, hp: e.hp, maxHp: e.maxHp, statuses: statuses(e.statuses) }
					])
				),
				turn: adventure.encounter.turn
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
	if (saved.id !== SAVE_ID) {
		return { ok: false, error: 'This table was saved with a story this server does not know.' };
	}
	if (saved.version > SAVE_VERSION) {
		return { ok: false, error: 'This story was saved by a newer version of thirdfold.' };
	}
	try {
		return { ok: true, adventure: read(saved.state, scene) };
	} catch (err) {
		if (err instanceof Invalid)
			return { ok: false, error: `The saved story is invalid: ${err.message}.` };
		throw err;
	}
}

function read(data: Record<string, unknown>, scene: SceneFile): AdventureState {
	const tokenIds = new Set(scene.tokens.map((t) => t.id));
	const stage = oneOf(data.stage, STAGES, 'stage');
	check(isChapterId(data.chapter), 'chapter');
	check(isLocationId(data.location), 'location');
	const chapter = data.chapter;
	const location = data.location;
	check(CHAPTERS[chapter].location === location, 'chapter and location disagree');

	const characters = new Map<CharacterId, CharacterState>();
	const characterTokens = new Set<string>();
	for (const [id, raw] of Object.entries(record(data.characters, 'characters'))) {
		check(isCharacterId(id), 'character');
		const c = record(raw, 'character');
		const def = CHARACTERS[id];
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

	const npcs = new Map<NpcId, string>();
	for (const [id, state] of Object.entries(record(data.npcs, 'people'))) {
		const npc = oneOf(id, NPC_IDS, 'person');
		npcs.set(npc, oneOf(state, NPCS[npc].states, `${NPCS[npc].name}'s state`));
	}
	for (const id of NPC_IDS) if (!npcs.has(id)) npcs.set(id, NPCS[id].states[0]);

	// Saves from before people had lines to remember have none.
	const sayable = [
		...NPC_IDS.flatMap((id) => NPCS[id].lines.map((l) => `${id}:${l.id}`)),
		...REACTIONS.map((r) => `reaction:${r.id}`)
	];
	const said = new Set(data.said === undefined ? [] : uniqueList(data.said, sayable, 'lines'));

	const decisions = new Map<DecisionId, Decision>();
	const decisionIds = Object.keys(DECISIONS) as DecisionId[];
	for (const [id, raw] of Object.entries(record(data.decisions, 'decisions'))) {
		const decision = oneOf(id, decisionIds, 'decision');
		const d = record(raw, 'decision');
		const options = DECISIONS[decision].options.map((o) => o.id);
		decisions.set(decision, {
			option: oneOf(d.option, options, 'choice'),
			by: name(d.by, 'choice')
		});
	}
	const pending = data.pending === null ? null : oneOf(data.pending, decisionIds, 'choice');
	check(!pending || !decisions.has(pending), 'choice');

	const encounters = new Map<EncounterId, EncounterState>();
	for (const [id, state] of Object.entries(record(data.encounters, 'fights'))) {
		encounters.set(oneOf(id, ENCOUNTER_IDS, 'fight'), oneOf(state, ENCOUNTER_STATES, 'fight'));
	}

	const objects = new Map<string, ObjectState>();
	for (const [id, state] of Object.entries(record(data.objects, 'objects'))) {
		const def = objectDef(id);
		check(def && isObjectState(state), 'object');
		check(def.states.includes(state) || state === def.initial || isDoorState(def, state), 'object');
		objects.set(id, state);
	}

	const origins: Origins = new Map();
	for (const [id, raw] of Object.entries(record(data.origins, 'objects'))) {
		const def = objectDef(id);
		const o = record(raw, 'object');
		const pos = record(o.pos, 'object');
		check(def && def.location === location && isAssetId(o.assetId), 'object');
		const at: GridPos = { x: pos.x as number, y: pos.y as number };
		check(Number.isInteger(at.x) && Number.isInteger(at.y) && inBounds(scene.grid, at), 'object');
		origins.set(id, { pos: at, assetId: o.assetId });
	}

	let encounter: Encounter | null = null;
	if (data.encounter !== null) {
		const e = record(data.encounter, 'fight');
		const id = oneOf(e.id, ENCOUNTER_IDS, 'fight');
		check(encounters.get(id) === 'active', 'fight');
		const enemies = new Map<string, EnemyState>();
		for (const [tokenId, raw] of Object.entries(record(e.enemies, 'enemies'))) {
			check(tokenIds.has(tokenId) && !characterTokens.has(tokenId), 'enemy');
			const enemy = record(raw, 'enemy');
			check(enemy.kind === 'hound', 'enemy');
			const maxHp = int(enemy.maxHp, 1, COUNT_MAX, 'enemy');
			enemies.set(tokenId, {
				kind: 'hound',
				hp: int(enemy.hp, 1, maxHp, 'enemy'),
				maxHp,
				statuses: statuses(enemy.statuses, 'enemy')
			});
		}
		const moved = new Map<CharacterId, number>();
		for (const [who, n] of Object.entries(record(e.moved, 'movement'))) {
			check(isCharacterId(who), 'movement');
			moved.set(who, int(n, 0, COUNT_MAX, 'movement'));
		}
		encounter = {
			id,
			round: int(e.round, 1, COUNT_MAX, 'round'),
			phase: oneOf(e.phase, ['players', 'enemies'] as const, 'phase'),
			acted: new Set(
				list(e.acted, 'turns').map((who) => {
					check(isCharacterId(who), 'turns');
					return who;
				})
			),
			moved,
			enemies,
			turn: int(e.turn, 1, 1_000_000, 'turn')
		};
	}
	check(!encounter || stage === 'playing', 'fight');

	const ending = data.ending === null ? null : oneOf(data.ending, ENDING_IDS, 'ending');
	check((ending !== null) === (stage === 'complete'), 'ending');

	const clueIds = Object.keys(CLUES);
	return {
		id: 'hollow-bell',
		stage,
		chapter,
		location,
		characters,
		clues: uniqueList(data.clues, clueIds, 'clues'),
		events: uniqueList<EventId>(data.events, EVENT_IDS, 'events'),
		defeated: list(data.defeated, 'defeated enemies').map((n) => name(n, 'defeated enemies')),
		npcs,
		said,
		decisions,
		pending,
		encounters,
		ending,
		objects,
		origins,
		cuesRead: new Set(
			uniqueList(
				data.cuesRead,
				CUES.map((c) => c.id),
				'passages'
			)
		),
		encounter,
		begunAt: time(data.begunAt, 'time'),
		completedAt: time(data.completedAt, 'time')
	};
}

/** Doors follow their scene door, so any door may be saved opened or closed. */
function isDoorState(def: NonNullable<ReturnType<typeof objectDef>>, state: ObjectState): boolean {
	return 'door' in def.thing && (state === 'opened' || state === 'closed');
}
