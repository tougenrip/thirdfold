// Saving a story with the table, and reading it back. A save is plain
// JSON inside the scene file's `adventure` field (scene file v4). The core
// scene parser only checks it is JSON; everything in it is validated here, as
// strictly as live actions, against the scene it was saved with, before the
// room is touched. A tampered save can at worst be rejected.

import {
	isObjectState,
	SHEET_NOTES_MAX,
	type AdventureStage,
	type CardResource,
	type EncounterState,
	type ObjectState
} from '../../src/lib/adventure/adventure';
import { STATUS_IDS, type StatusId } from '../../src/lib/adventure/characters';
import {
	COLLECTION_FORMAT,
	COLLECTION_FORMAT_VERSION,
	COLLECTION_LIMITS,
	parseCollectionFile,
	type CollectionDraft
} from '../../src/lib/game/collection';
import { inBounds, type GridPos } from '../../src/lib/game/grid';
import {
	CREATOR_ID_PATTERN,
	LIBRARY_ID_PATTERN,
	LIBRARY_LIMITS,
	normalizeCreatorName
} from '../../src/lib/game/library';
import { parseEntitlements } from '../../src/lib/game/access';
import { compareContent, lockOf, readSteps, savedPins } from './lock';
import { resolveAssetId, type Rotation } from '../../src/lib/game/props';
import type { SavedStory, SceneFile } from '../../src/lib/game/scene-file';
import { CLASSIC } from '../rules/classic';
import { findRuleset, type EffectSpec, type JsonData, type RulesetRef } from '../rules/ruleset';
import { AMBUSH, type AdventureDef, type ObjectDef } from './define';
import { CUSTOM_ID, fileOf, loadCustomAdventure } from './custom';
import { BUILT_ID, BUILT_MAX, withBuilt, type BuiltCharacter } from './built';
import { BESTIARY_MAX, withBestiary } from './bestiary';
import { PACKS_MAX } from './packs';
/** A creator's public id (library-store.ts `creatorIdOf`). */
const CREATOR_ID = /^[0-9a-f]{16}$/;
import { PILE_ID, PILE_ITEMS_MAX, PILES_MAX, withKept } from './gear';
import { contentOf, findAdventure } from './registry';
import type {
	AdventureState,
	CollectionSource,
	CharacterState,
	Decision,
	Finding,
	Encounter,
	LibrarySource,
	EnemyState,
	LastingEffect,
	Pile,
	Sentry,
	StoryPack,
	Statuses,
	TurnEntry
} from './state';
import { objectDef, type Origins } from './world';
import { EFFECTS_MAX } from './effects';
import { parseDice } from '../../src/lib/game/dice';

const STAGES: readonly AdventureStage[] = ['choosing', 'playing', 'complete', 'defeat'];
const ENCOUNTER_STATES: readonly EncounterState[] = ['active', 'won', 'lost'];
const NAME_MAX = 48;
/** The most a character's notes may hold. */
const NOTES_MAX = SHEET_NOTES_MAX;
/** A failed check, after the character: `<object>:<verb>` or `sign:<id>`. */
const TRIED = /^[a-z0-9-]{1,40}:[a-z0-9-]{1,40}$/;
const LIST_MAX = 100;
const COUNT_MAX = 999;

const entriesOf = <K extends string, V>(map: Map<K, V>) => Object.fromEntries(map);

/** The story as saved: Maps and Sets become plain objects and arrays. */
export function saveAdventure(adventure: AdventureState): SavedStory {
	const statuses = (s: Statuses) => entriesOf(s);
	const A = contentOf(adventure.id);
	const content = fileOf(A.id);
	// Rules from a licensed source travel with the credit it requires (read back from the rules, not the file).
	const attribution = findRuleset(adventure.rules)?.attribution;
	return {
		id: A.id,
		version: A.version,
		...(content ? { content: JSON.parse(JSON.stringify(content)) } : {}),
		state: {
			rules: { ...adventure.rules },
			...(attribution ? { credits: [attribution] } : {}),
			stage: adventure.stage,
			chapter: adventure.chapter,
			location: adventure.location,
			...(adventure.built?.size
				? {
						built: Object.fromEntries(
							[...adventure.built].map(([id, b]) => [id, JSON.parse(JSON.stringify(b.saved))])
						)
					}
				: {}),
			...(adventure.bestiary?.length ? { bestiary: [...adventure.bestiary] } : {}),
			// Homebrew travels as written, so the save brings it back wherever it is loaded.
			...(adventure.packs?.length
				? {
						packs: adventure.packs.map((p) => ({
							owner: p.owner,
							pack: JSON.parse(JSON.stringify(findRuleset(adventure.rules)!.packs!.content(p.id)))
						}))
					}
				: {}),
			...(adventure.kept?.size
				? {
						kept: Object.fromEntries(
							[...adventure.kept].map(([id, b]) => [id, JSON.parse(JSON.stringify(b.saved))])
						)
					}
				: {}),
			...(adventure.effects?.length
				? { effects: adventure.effects.map((f) => JSON.parse(JSON.stringify(f))) }
				: {}),
			...(adventure.piles?.size
				? {
						piles: Object.fromEntries(
							[...adventure.piles].map(([id, p]) => [
								id,
								{
									location: p.location,
									pos: { ...p.pos },
									items: p.items.map((i) => JSON.parse(JSON.stringify(i.item)))
								}
							])
						)
					}
				: {}),
			characters: Object.fromEntries(
				[...adventure.characters].map(([id, c]) => [
					id,
					{
						tokenId: c.tokenId,
						hp: c.hp,
						statuses: statuses(c.statuses),
						uses: entriesOf(c.uses),
						downedFor: c.downedFor,
						...(c.deathSaves ? { deathSaves: { ...c.deathSaves } } : {}),
						dead: c.dead,
						...(c.holdReaction ? { holdReaction: true } : {}),
						...(c.resources?.size ? { resources: entriesOf(c.resources) } : {})
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
			rewards: [...adventure.rewards],
			...(adventure.notes?.size ? { notes: entriesOf(adventure.notes) } : {}),
			...(adventure.library
				? {
						library: {
							id: adventure.library.id,
							version: adventure.library.version,
							creator: { ...adventure.library.creator }
						}
					}
				: {}),
			...(adventure.collection
				? { collection: JSON.parse(JSON.stringify(adventure.collection)) }
				: {}),
			...(adventure.entitlements?.length
				? { entitlements: adventure.entitlements.map((e) => ({ ...e })) }
				: {}),
			...(adventure.steps?.length ? { steps: adventure.steps.map((s) => ({ ...s })) } : {}),
			// Everything it plays by, at the versions it found (milestone 55): checked again on a load.
			lock: lockOf(adventure),
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
						leg: s.leg,
						...(s.waiting ? { waiting: true } : {})
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
				...(adventure.encounter.turnSpeed !== undefined
					? { turnSpeed: adventure.encounter.turnSpeed }
					: {}),
				...(adventure.encounter.reacted?.size ? { reacted: [...adventure.encounter.reacted] } : {}),
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

export type AdventureRead =
	| {
			ok: true;
			adventure: AdventureState;
			/** What the load migrated and checked (content rebuilt since the save), for the GM. */
			notes: string[];
	  }
	| { ok: false; error: string };

class Invalid extends Error {}

/** What lasting effects may name, to read them back: characters, tokens on the table, the rules. */
interface EffectContext {
	character: (id: string) => { name: string; tokenId: string } | undefined;
	isToken: (id: string) => boolean;
	isEnemy: (id: string) => boolean;
	isCondition: (id: string) => boolean;
	isSave: (stat: string) => boolean;
}

/**
 * The story's lasting effects, each checked: whose, on whom, what it changes
 * and when it ends. Milestone 48 saved them on the fight with a character's
 * id as the source; those read the same.
 */
function lastingEffects(value: unknown, ctx: EffectContext): LastingEffect[] {
	const raw = list(value, 'effects');
	check(raw.length <= EFFECTS_MAX, 'effects');
	const ids = new Set<string>();
	return raw.map((v) => {
		const f = record(v, 'effect');
		check(typeof f.id === 'string' && /^fx-\d{1,6}$/.test(f.id) && !ids.has(f.id), 'effect');
		ids.add(f.id);
		check(typeof f.target === 'string' && ctx.isToken(f.target), 'effect');
		const source = effectSource(f.source, ctx);
		const sourceToken =
			f.sourceToken === undefined
				? source.kind === 'character'
					? ctx.character(source.id)!.tokenId
					: source.kind === 'enemy'
						? source.id
						: undefined
				: (f.sourceToken as string);
		check(
			sourceToken === undefined || (typeof sourceToken === 'string' && ctx.isToken(sourceToken)),
			'effect'
		);
		const spec = effectSpec(f, ctx, true);
		check(
			f.clock === undefined ||
				(typeof f.clock === 'string' && (!!ctx.character(f.clock) || ctx.isEnemy(f.clock))),
			'effect'
		);
		return {
			...(f.clock === undefined ? {} : { clock: f.clock as string }),
			id: f.id,
			...spec,
			source,
			...(sourceToken ? { sourceToken } : {}),
			target: f.target,
			...(f.level === undefined ? {} : { level: int(f.level, 1, 6, 'effect') })
		};
	});
}

function effectSource(raw: unknown, ctx: EffectContext): LastingEffect['source'] {
	if (typeof raw === 'string') {
		const c = ctx.character(raw);
		check(c, 'effect');
		return { kind: 'character', id: raw, name: c.name };
	}
	const s = record(raw, 'effect');
	const who = name(s.name, 'effect');
	switch (s.kind) {
		case 'character':
			check(typeof s.id === 'string' && ctx.character(s.id), 'effect');
			return { kind: 'character', id: s.id as string, name: who };
		case 'enemy':
			check(typeof s.id === 'string' && ctx.isEnemy(s.id), 'effect');
			return { kind: 'enemy', id: s.id as string, name: who };
		case 'gm':
			return { kind: 'gm', name: who };
		case 'story':
			return { kind: 'story', name: who };
	}
	throw new Invalid('effect');
}

/** An effect's own part (its name, what it changes, how it ends), as an `EffectSpec`. */
function effectSpec(f: Record<string, unknown>, ctx: EffectContext, top: boolean): EffectSpec {
	check(typeof f.name === 'string' && f.name.length > 0 && f.name.length <= 80, 'effect');
	const m = record(f.mods, 'effect');
	check(
		Object.keys(m).every((k) =>
			['boon', 'defense', 'slow', 'exposed', 'noHealing', 'conditions'].includes(k)
		),
		'effect'
	);
	const boon = m.boon;
	check(
		boon === undefined || (typeof boon === 'string' && boon.length <= 20 && parseDice(boon).ok),
		'effect'
	);
	const conditions =
		m.conditions === undefined
			? undefined
			: list(m.conditions, 'effect').map((c) => {
					check(typeof c === 'string' && ctx.isCondition(c), 'effect');
					return c as string;
				});
	const mods: LastingEffect['mods'] = {
		...(boon === undefined ? {} : { boon: boon as string }),
		...(m.defense === undefined ? {} : { defense: int(m.defense, -10, 10, 'effect') }),
		...(m.slow === undefined ? {} : { slow: int(m.slow, 0, 20, 'effect') }),
		...(m.exposed === undefined ? {} : { exposed: bool(m.exposed, 'effect') }),
		...(m.noHealing === undefined ? {} : { noHealing: bool(m.noHealing, 'effect') }),
		...(conditions ? { conditions } : {})
	};
	let ends: LastingEffect['ends'] = null;
	if (f.ends !== null) {
		const e = record(f.ends, 'effect');
		check(e.at === 'start' || e.at === 'end', 'effect');
		ends = { at: e.at, turns: int(e.turns, 0, 1000, 'effect') };
	}
	let repeat: LastingEffect['repeat'];
	if (f.repeat !== undefined) {
		const r = record(f.repeat, 'effect');
		check(typeof r.stat === 'string' && ctx.isSave(r.stat), 'effect');
		repeat = {
			stat: r.stat as string,
			dc: int(r.dc, 1, 40, 'effect'),
			...(r.onDamage === undefined ? {} : { onDamage: bool(r.onDamage, 'effect') })
		};
	}
	// What a failed save turns it into is one step, never a chain.
	const worsens: EffectSpec | undefined =
		f.worsens === undefined || !top
			? undefined
			: effectSpec(record(f.worsens, 'effect'), ctx, false);
	check(top || f.worsens === undefined, 'effect');
	return {
		name: f.name as string,
		mods,
		ends,
		concentration: bool(f.concentration, 'effect'),
		...(repeat ? { repeat } : {}),
		...(worsens ? { worsens } : {}),
		...(f.endsOnDamage === undefined ? {} : { endsOnDamage: bool(f.endsOnDamage, 'effect') })
	};
}

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
	// A creator's adventure comes back with its save, checked again.
	if (!findAdventure(saved.id) && saved.content !== undefined && CUSTOM_ID.test(saved.id)) {
		const loaded = loadCustomAdventure(saved.content, saved.id);
		if (!loaded.ok) return { ok: false, error: loaded.error };
	}
	const A = findAdventure(saved.id);
	if (!A) {
		return { ok: false, error: 'This table was saved with a story this server does not know.' };
	}
	if (saved.version > A.version) {
		return { ok: false, error: 'This story was saved by a newer version of thirdfold.' };
	}
	// The content its rules read, as it was when saved (saves from before locks carry none).
	let notes: string[] = [];
	if (saved.state.lock !== undefined) {
		const pins = savedPins(saved.state.lock);
		if (!pins) return { ok: false, error: 'The saved story is invalid: its lock.' };
		const rules = saved.state.rules;
		const ruleset =
			rules === undefined
				? findRuleset(CLASSIC)
				: typeof rules === 'object' && rules !== null
					? findRuleset(rules as { id: string; version: number })
					: undefined;
		if (ruleset) {
			const compared = compareContent(pins, ruleset.contentPins?.() ?? []);
			if (compared.error) return { ok: false, error: compared.error };
			notes = compared.notes;
		}
	}
	try {
		return { ok: true, adventure: read(A, saved.state, scene), notes };
	} catch (err) {
		if (err instanceof Invalid)
			return { ok: false, error: `The saved story is invalid: ${err.message}.` };
		throw err;
	}
}

function read(base: AdventureDef, data: Record<string, unknown>, scene: SceneFile): AdventureState {
	const tokenIds = new Set(scene.tokens.map((t) => t.id));
	// Stories saved before rulesets played by the classic rules; a story keeps the rules it was pinned to.
	const rules = data.rules === undefined ? { ...CLASSIC } : rulesRef(data.rules);
	const ruleset = findRuleset(rules)!;
	// Homebrew first, checked again in full: what follows may use it, and only it.
	const packs: StoryPack[] = [];
	if (data.packs !== undefined) {
		const saved = list(data.packs, 'homebrew');
		check(!!ruleset.packs && saved.length <= PACKS_MAX, 'homebrew');
		for (const raw of saved) {
			const entry = record(raw, 'homebrew');
			check(
				Object.keys(entry).every((k) => k === 'owner' || k === 'pack') &&
					(entry.owner === null ||
						(typeof entry.owner === 'string' && CREATOR_ID.test(entry.owner))),
				'homebrew'
			);
			const held = ruleset.packs!.hold(entry.pack);
			check(held.ok, 'homebrew');
			const id = (held as { id: string }).id;
			check(!packs.some((p) => p.id === id), 'homebrew');
			packs.push({ id, owner: entry.owner as string | null });
		}
	}
	const scope = packs.map((p) => p.id);
	// Characters players built come back through their rules' builder, checked in full.
	const built = new Map<string, BuiltCharacter>();
	if (data.built !== undefined) {
		const saved = Object.entries(record(data.built, 'built characters'));
		check(!!ruleset.builder && saved.length <= BUILT_MAX, 'built characters');
		for (const [id, raw] of saved) {
			check(BUILT_ID.test(id) && !Object.hasOwn(base.characters, id), 'built characters');
			const restored = ruleset.builder!.restore(raw, id, undefined, scope);
			check(restored.ok, `built character ${id}`);
			built.set(id, { def: restored.def, saved: restored.saved });
		}
	}
	// The adventure's own characters whose gear changed come back through the builder too, keeping their look.
	const kept = new Map<string, BuiltCharacter>();
	if (data.kept !== undefined) {
		const saved = Object.entries(record(data.kept, 'kept characters'));
		check(!!ruleset.builder && !!ruleset.equipment, 'kept characters');
		for (const [id, raw] of saved) {
			check(Object.hasOwn(base.characters, id), 'kept characters');
			const restored = ruleset.builder!.restore(raw, id, base.characters[id], scope);
			check(restored.ok, `kept character ${id}`);
			kept.set(id, { def: restored.def, saved: restored.saved });
		}
	}
	// Monsters brought in from the rules' bestiary: kinds the rules still play, each once.
	const bestiary =
		data.bestiary === undefined
			? []
			: list(data.bestiary, 'monsters').map((k) => {
					check(
						typeof k === 'string' &&
							!Object.hasOwn(base.enemies, k) &&
							!!ruleset.bestiary?.enemy(k) &&
							(!ruleset.packs?.packOf(k) || scope.includes(ruleset.packs.packOf(k)!)),
						'monsters'
					);
					return k as string;
				});
	check(bestiary.length <= BESTIARY_MAX && new Set(bestiary).size === bestiary.length, 'monsters');
	const A = withBestiary(withBuilt(withKept(base, kept), built), bestiary, ruleset);
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
			downedFor: int(c.downedFor, 0, ruleset.downedLimit, `${def.name}'s condition`),
			...(c.deathSaves === undefined ? {} : { deathSaves: deathSaves(c.deathSaves, def.name) }),
			dead: c.dead,
			...(c.holdReaction === undefined
				? {}
				: { holdReaction: bool(c.holdReaction, `${def.name}'s reaction`) || undefined }),
			...(c.resources === undefined
				? {}
				: {
						resources: markedResources(
							c.resources,
							ruleset.card(def, new Map()).resources,
							def.name
						)
					})
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
	const notes = new Map<string, string>();
	for (const [id, text] of Object.entries(
		data.notes === undefined ? {} : record(data.notes, 'notes')
	)) {
		check(isCharacterId(id), 'notes');
		check(typeof text === 'string' && text.length <= NOTES_MAX, 'notes');
		if (text) notes.set(id, text);
	}

	// Saves from before rewards have none; each is one the adventure can give.
	const rewards =
		data.rewards === undefined ? [] : uniqueList(data.rewards, rewardsOf(A), 'rewards');
	// Where a creator's adventure came from, when it came from the library.
	const library = data.library === undefined ? undefined : librarySource(data.library);
	// The collection it was started from: the same set again, this story one of its adventures.
	const collection =
		data.collection === undefined
			? undefined
			: collectionSource(data.collection, base.id, library, scope);
	// The grants its library content was played by (whether they still hold is the game server's to ask).
	const entitlements =
		data.entitlements === undefined ? undefined : parseEntitlements(data.entitlements);
	// The moves its library content made between versions.
	const steps = data.steps === undefined ? undefined : readSteps(data.steps);
	check(steps !== null, 'versions');
	check(!steps?.length || !!library || !!collection, 'versions');
	check(entitlements !== null, 'entitlements');
	check(!entitlements?.length || !!library || !!collection, 'entitlements');

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
		const assetId = resolveAssetId(o.assetId);
		check(def && (def.location === location || def.carry) && assetId, 'object');
		const at: GridPos = { x: pos.x as number, y: pos.y as number };
		check(Number.isInteger(at.x) && Number.isInteger(at.y) && inBounds(scene.grid, at), 'object');
		// Saves from before things could be turned have none.
		const rotation = (o.rotation === undefined ? 0 : int(o.rotation, 0, 3, 'object')) as Rotation;
		origins.set(id, { pos: at, assetId, rotation });
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
			leg: int(sentry.leg, 0, route.length - 1, 'sentries'),
			...(sentry.waiting === undefined
				? {}
				: { waiting: bool(sentry.waiting, 'sentries') || undefined })
		});
	}

	let encounter: Encounter | null = null;
	// Milestone 48 kept lasting effects on the fight.
	const oldEffects = isRecord(data.encounter) ? data.encounter.effects : undefined;
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
				// A character's id for its action; `<id>:<type>` for another part of its turn.
				list(e.acted, 'turns').map((key) => {
					check(typeof key === 'string', 'turns');
					const [who, type, ...rest] = (key as string).split(':');
					check(isCharacterId(who) && rest.length === 0, 'turns');
					check(type === undefined || /^[a-z][a-z0-9-]{0,15}$/.test(type), 'turns');
					return key as string;
				})
			),
			moved,
			...(e.turnSpeed === undefined
				? {}
				: { turnSpeed: int(e.turnSpeed, 0, COUNT_MAX, 'movement') }),
			...(e.reacted === undefined
				? {}
				: {
						reacted: new Set(
							list(e.reacted, 'reactions').map((key) => {
								check(
									typeof key === 'string' && (isCharacterId(key) || enemies.has(key)),
									'reactions'
								);
								return key as string;
							})
						)
					}),
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
	// Lasting effects: whose, on whom (a token on this table), what they change, by the rules.
	const effectCtx: EffectContext = {
		character: (id) => {
			const c = characters.get(id);
			return c && A.characters[id]
				? { name: A.characters[id].name, tokenId: c.tokenId }
				: undefined;
		},
		isToken: (id) => tokenIds.has(id),
		isEnemy: (id) => !!encounter?.enemies.has(id) || sentries.has(id),
		isCondition: (id) => !!ruleset.conditions?.known(id),
		isSave: (stat) => ruleset.isStat(stat, 'save')
	};
	const effects = [
		...(data.effects === undefined ? [] : lastingEffects(data.effects, effectCtx)),
		...(oldEffects === undefined ? [] : lastingEffects(oldEffects, effectCtx))
	];
	check(
		effects.length <= EFFECTS_MAX && new Set(effects.map((e) => e.id)).size === effects.length,
		'effects'
	);
	// Things put down: where they lie (a table of the story, a cell on it) and what they are, by the rules.
	const piles = new Map<string, Pile>();
	if (data.piles !== undefined) {
		const saved = Object.entries(record(data.piles, 'piles'));
		check(!!ruleset.equipment && saved.length <= PILES_MAX, 'piles');
		for (const [id, raw] of saved) {
			check(PILE_ID.test(id), 'piles');
			const p = record(raw, 'piles');
			const where = oneOf(p.location, Object.keys(A.locations), 'piles');
			const at = record(p.pos, 'piles');
			const pos = { x: at.x as number, y: at.y as number };
			const grid = where === location ? scene.grid : A.locations[where].scene().grid;
			check(Number.isInteger(pos.x) && Number.isInteger(pos.y) && inBounds(grid, pos), 'piles');
			const items = list(p.items, 'piles').map((item) => {
				const name = ruleset.equipment!.nameOf(item);
				check(name !== null && typeof item === 'object', 'piles');
				return { item: item as JsonData, name: name! };
			});
			check(items.length > 0 && items.length <= PILE_ITEMS_MAX, 'piles');
			// A pile on this table lies under its prop.
			if (where === location) {
				const prop = scene.props.find((x) => x.id === id);
				check(!!prop && prop.pos.x === pos.x && prop.pos.y === pos.y, 'piles');
			}
			piles.set(id, { location: where, pos, items });
		}
	}
	return {
		id: A.id,
		rules,
		...(built.size ? { built } : {}),
		...(bestiary.length ? { bestiary } : {}),
		...(packs.length ? { packs } : {}),
		...(kept.size ? { kept } : {}),
		...(piles.size ? { piles } : {}),
		...(effects.length ? { effects } : {}),
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
		rewards,
		...(notes.size ? { notes } : {}),
		...(library ? { library } : {}),
		...(collection ? { collection } : {}),
		...(entitlements?.length ? { entitlements } : {}),
		...(steps?.length ? { steps } : {}),
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

/** A ruleset this server has, by exact id and version. */
function rulesRef(value: unknown): RulesetRef {
	const raw = record(value, 'rules');
	check(
		typeof raw.id === 'string' &&
			typeof raw.version === 'number' &&
			findRuleset({ id: raw.id, version: raw.version }) !== undefined,
		'rules this server does not have'
	);
	return { id: raw.id as string, version: raw.version as number };
}

/**
 * A story's collection, read back: well formed (as a collection names its
 * pieces), and naming this story as the adventure it is playing and every
 * one of its packs among the story's, so a save resolves to the set it was
 * started with and nothing else.
 */
function collectionSource(
	value: unknown,
	adventureId: string,
	library: LibrarySource | undefined,
	packs: readonly string[]
): CollectionSource {
	const raw = record(value, 'collection');
	check(
		Object.keys(raw).every((k) =>
			['id', 'version', 'title', 'creator', 'entry', 'adventures', 'packs', 'tables'].includes(k)
		),
		'collection'
	);
	const source = librarySource({ id: raw.id, version: raw.version, creator: raw.creator });
	const titled = (v: unknown) =>
		typeof v === 'string' && v.trim().length > 0 && v.length <= COLLECTION_LIMITS.title;
	check(titled(raw.title), 'collection');
	const adventures = list(raw.adventures, 'collection').map((a) => {
		const entry = record(a, 'collection');
		check(titled(entry.title) && Object.keys(entry).length === 2, 'collection');
		return { ref: entry.ref, title: entry.title as string };
	});
	const packList = list(raw.packs, 'collection').map((p) => {
		const entry = record(p, 'collection');
		check(
			titled(entry.title) &&
				typeof entry.packId === 'string' &&
				packs.includes(entry.packId) &&
				Object.keys(entry).length === 3,
			'collection homebrew'
		);
		return { ref: entry.ref, title: entry.title as string, packId: entry.packId as string };
	});
	// The references, as a collection writes them.
	const parsed = parseCollectionFile({
		format: COLLECTION_FORMAT,
		formatVersion: COLLECTION_FORMAT_VERSION,
		title: raw.title,
		adventures: adventures.map((a) => a.ref),
		packs: packList.map((p) => p.ref),
		tables: raw.tables
	});
	check(parsed.ok, 'collection');
	const file = (parsed as { file: CollectionDraft }).file;
	const entry = raw.entry;
	check(
		typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry < adventures.length,
		'collection'
	);
	const playing = file.adventures[entry as number];
	check(
		'builtIn' in playing
			? playing.builtIn === adventureId && !library
			: !!library && library.id === playing.library && library.version === playing.version,
		'collection: this story is not its adventure'
	);
	return {
		...source,
		title: file.title,
		entry: entry as number,
		adventures: adventures.map((a, i) => ({ ref: file.adventures[i], title: a.title.trim() })),
		packs: packList.map((p, i) => ({
			ref: file.packs[i],
			title: p.title.trim(),
			packId: p.packId
		})),
		tables: file.tables
	};
}

function librarySource(value: unknown): LibrarySource {
	const raw = record(value, 'library');
	const creator = record(raw.creator, 'library');
	const name = normalizeCreatorName(creator.name);
	check(
		typeof raw.id === 'string' &&
			LIBRARY_ID_PATTERN.test(raw.id) &&
			Number.isInteger(raw.version) &&
			(raw.version as number) >= 1 &&
			(raw.version as number) <= LIBRARY_LIMITS.versions &&
			typeof creator.id === 'string' &&
			CREATOR_ID_PATTERN.test(creator.id) &&
			name !== null,
		'library'
	);
	return {
		id: raw.id as string,
		version: raw.version as number,
		creator: { id: creator.id as string, name: name! }
	};
}

/** Resources a player marked spent: only the card's hand-marked ones, each within its maximum. */
function markedResources(
	value: unknown,
	resources: CardResource[] | undefined,
	name: string
): Map<string, number> {
	const out = new Map<string, number>();
	for (const [id, n] of Object.entries(record(value, `${name}'s resources`))) {
		const r = resources?.find((x) => x.id === id && x.trackedBy === null);
		check(r, `${name}'s resources`);
		out.set(id, int(n, 0, r.max, `${name}'s resources`));
	}
	return out;
}

/** The rewards an adventure can give (its `reward` effects). */
function rewardsOf(A: AdventureDef): string[] {
	const found: string[] = [];
	JSON.stringify(A, (key, value) => {
		if (key === 'reward' && typeof value === 'string') found.push(value);
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

/** Death saving throws so far: fewer than three of each, and Stable only with none. */
function deathSaves(
	value: unknown,
	name: string
): { successes: number; failures: number; stable?: boolean } {
	const d = record(value, `${name}'s death saves`);
	const successes = int(d.successes, 0, 2, `${name}'s death saves`);
	const failures = int(d.failures, 0, 2, `${name}'s death saves`);
	if (d.stable === undefined) return { successes, failures };
	check(d.stable === true && !successes && !failures, `${name}'s death saves`);
	return { successes, failures, stable: true };
}
