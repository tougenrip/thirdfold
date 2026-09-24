// The Hollow Bell's rules. Every action takes the acting player and checks
// role, ownership, reach and turn order before changing anything, like the
// scene actions in server/scene.ts. Dice are rolled here, on the server.
//
// The story moves by events (see story.ts): an action that matters to the
// story calls `happen`, which records the event, does what it does to the
// table, and moves to the next chapter when the current one was waiting for
// it, travelling to another table when the chapter is played elsewhere.
//
// Actions return an Outcome: the log entries they added (the game server
// announces them after syncing views) and whether the table was replaced or
// the enemies' turn should be scheduled. The game server owns timing and
// transport; nothing here touches a socket or a timer.

import { randomInt, randomUUID } from 'node:crypto';
import {
	canReach,
	inActionRange,
	EVIDENCE_KINDS,
	INVESTIGATION_ACTIONS,
	type ChapterId,
	type Check,
	type LocationId,
	type ObjectState,
	type Physical,
	type Sense
} from '../../src/lib/adventure/adventure';
import {
	actionOf,
	BLEED_OUT_ROUNDS,
	CHARACTER_IDS,
	CHARACTERS,
	defenseFor,
	STATS,
	STATUSES,
	toHitFor,
	type Action,
	type Attack,
	type CharacterDef,
	type CharacterId
} from '../../src/lib/adventure/characters';
import {
	NARRATION_MAX_LENGTH,
	normalizeChatText,
	type ChatMessage,
	type LogAudience
} from '../../src/lib/game/chat';
import { parseDice, rollDice, type DiceRoll, type DieRoller } from '../../src/lib/game/dice';
import { gridDistance, inBounds, type GridPos } from '../../src/lib/game/grid';
import type { Motion, Sound } from '../../src/lib/game/motion';
import {
	canStep,
	cellsBeside,
	findPath,
	type Door,
	type Obstacles
} from '../../src/lib/game/objects';
import {
	footprintCells,
	isSolidCell,
	obstaclesFor,
	type Prop,
	type Rotation
} from '../../src/lib/game/props';
import type { AdventureControl, CharacterPatch } from '../../src/lib/game/protocol';
import { tokenAt, type Token } from '../../src/lib/game/token';
import { hasLineOfSight, rectCells } from '../../src/lib/game/visibility';
import { appendLog, postSystem } from '../chat';
import { fail, type Player, type Result, type Room } from '../rooms';
import { lightFor, obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { IDS, PATH_AREA, WELL_RING } from './bellweather';
import {
	CLUES,
	CUES,
	ENDINGS,
	PROMISE_KEPT,
	TEXT,
	TITLE,
	type ClueDef,
	type ClueId
} from './content';
import { areaAt, LOCATIONS } from './locations';
import { ENEMIES, PUP_HP, type EnemyDef, type EnemyKind } from './enemies';
import { CAVERN, CULTIST_ROUNDS, KEEPER_POST } from './hollow';
import { patrolStep, plan as planTurn, seenBy, type Foe as Foe_, type Situation } from './ai';
import { MECHANISMS, TRIGGERS, type MechanismId } from './mechanisms';
import { CHAMBER, MONASTERY_IDS, STAIR, STAIR_RING } from './monastery';
import {
	actionOfVerb,
	applyLook,
	initialStates,
	objectDef,
	objectForDoor,
	OBJECTS,
	objectsAt,
	propIdOf,
	recordOrigins,
	type ObjectDef,
	type Verb
} from './objects';
import { SIGNS } from './signs';
import type {
	AdventureState,
	CharacterState,
	Encounter,
	EnemyState,
	Statuses,
	TurnEntry
} from './state';
import {
	CHAPTERS,
	DECISIONS,
	ENDING_FOR,
	transition,
	type DecisionId,
	type EncounterId,
	type EventId
} from './story';
import { isNpcId, NPC_IDS, NPCS, placeFor, REACTIONS, type NpcId, type When } from './npcs';

export interface Outcome {
	/** Log entries added, oldest first; announce them after syncing. */
	log: ChatMessage[];
	/** The whole table was replaced: send everyone a fresh snapshot. */
	reset?: boolean;
	/** The enemies should act: run `runEnemyTurn` for this encounter turn (after a pause). */
	enemyTurn?: number;
	/** How the changes show: motions and sounds on props, sent after syncing. */
	motions?: Motion[];
	/** Mechanism steps to run later: `runMechanism(id, step)` after `delay` ms. */
	mechanisms?: { id: MechanismId; step: number; delay: number }[];
}

type Outcomes = Result<Outcome>;

const NO_ADVENTURE = fail('no_adventure', 'No adventure is running at this table.');
const GM_ONLY = fail('forbidden', 'Only the GM can do that.');

/** The cells a world object covers now, or null if it is not on the table. */
export function objectCells(room: Room, def: ObjectDef): GridPos[] | null {
	// An item is wherever it was put down, on any table, and nowhere while carried.
	if (def.carry && 'prop' in def.thing) {
		if (room.adventure?.carried.has(def.id)) return [];
		const prop = room.props.get(def.thing.prop);
		return prop ? footprintCells(prop) : null;
	}
	if (room.adventure && def.location !== room.adventure.location) return null;
	if ('token' in def.thing) {
		const token = room.tokens.get(def.thing.token);
		return token ? [token.pos] : null;
	}
	if ('door' in def.thing) {
		const door = room.objects.get(def.thing.door) ?? def.secret;
		return door ? cellsBeside(room.grid, door) : null;
	}
	const prop = room.props.get(def.thing.prop);
	return prop ? footprintCells(prop) : null;
}

/** The state of a world object (its starting state if the adventure has not touched it). */
export function objectState(adventure: AdventureState, def: ObjectDef): ObjectState {
	return adventure.objects.get(def.id) ?? def.initial;
}

/**
 * The state an object shows as: its own, except that something only light
 * reveals (`litBy`) is hidden while that light is out.
 */
export function shownState(adventure: AdventureState, def: ObjectDef): ObjectState {
	const state = objectState(adventure, def);
	const light = def.litBy ? objectDef(def.litBy) : undefined;
	return light && objectState(adventure, light) !== 'lit' ? 'hidden' : state;
}

/** What can be done with an object in the state it is in. */
export function verbsFor(adventure: AdventureState, def: ObjectDef): readonly Verb[] {
	const state = objectState(adventure, def);
	return def.verbs.filter((v) => v.from.includes(state));
}

/** Puts an object in a state and makes the table show it. */
function setObjectState(room: Room, adventure: AdventureState, def: ObjectDef, state: ObjectState) {
	adventure.objects.set(def.id, state);
	applyLook(room, def, shownState(adventure, def), adventure.origins);
	// Lighting or putting out a light shows or hides what only it reveals.
	for (const other of OBJECTS) {
		if (other.litBy === def.id && objectCells(room, other)) {
			applyLook(room, other, shownState(adventure, other), adventure.origins);
		}
	}
}

/** Props players must not see: hidden world objects. The GM still sees them. */
export function hiddenPropIds(room: Room): Set<string> {
	const hidden = new Set<string>();
	const adventure = room.adventure;
	if (!adventure) return hidden;
	for (const def of OBJECTS) {
		const id = propIdOf(def);
		if (id && shownState(adventure, def) === 'hidden') hidden.add(id);
	}
	return hidden;
}

// ---------------------------------------------------------------------------
// Characters

interface Played {
	id: CharacterId;
	state: CharacterState;
	token: Token;
}

/** Characters on the table (their token exists), with their state. */
function played(room: Room, adventure: AdventureState): Played[] {
	const list: Played[] = [];
	for (const id of CHARACTER_IDS) {
		const state = adventure.characters.get(id);
		const token = state && room.tokens.get(state.tokenId);
		if (state && token) list.push({ id, state, token });
	}
	return list;
}

/** Characters still standing: not down, not dead. */
function standing(room: Room, adventure: AdventureState): Played[] {
	return played(room, adventure).filter((c) => c.state.hp > 0 && !c.state.dead);
}

function newCharacter(tokenId: string, id: CharacterId): CharacterState {
	return {
		tokenId,
		hp: CHARACTERS[id].hp,
		statuses: new Map(),
		uses: new Map(),
		downedFor: 0,
		dead: false
	};
}

/** Uses left this encounter for a limited action; null for unlimited. */
export function usesLeft(state: CharacterState, action: Action): number | null {
	return action.uses === null ? null : Math.max(0, action.uses - (state.uses.get(action.id) ?? 0));
}

/** Why a character can't act or move right now, or null if it can. */
function unableReason(me: Played): string | null {
	const name = CHARACTERS[me.id].name;
	if (me.state.dead) return `${name} is dead.`;
	if (me.state.hp <= 0) return `${name} is down.`;
	return null;
}

export function characterOf(room: Room, playerId: string): Played | null {
	const adventure = room.adventure;
	if (!adventure) return null;
	return played(room, adventure).find((c) => c.token.ownerId === playerId) ?? null;
}

function characterByToken(room: Room, tokenId: string): Played | null {
	const adventure = room.adventure;
	if (!adventure) return null;
	return played(room, adventure).find((c) => c.token.id === tokenId) ?? null;
}

function isFree(
	room: Room,
	cell: GridPos,
	blocked: Obstacles = obstacles(room),
	ignoreId?: string
): boolean {
	const occupant = tokenAt(room.tokens.values(), cell);
	return (!occupant || occupant.id === ignoreId) && !isSolidCell(blocked, cell);
}

function placeCharacter(
	room: Room,
	location: LocationId,
	id: CharacterId,
	ownerId: string | null,
	tokenId: string = randomUUID()
): Token | null {
	const cell = LOCATIONS[location].spawn.find((c) => isFree(room, c));
	if (!cell) return null;
	const def = CHARACTERS[id];
	const token: Token = {
		id: tokenId,
		name: def.name,
		color: def.color,
		pos: { ...cell },
		ownerId,
		vision: def.vision,
		light: def.light
	};
	room.tokens.set(token.id, token);
	return token;
}

// ---------------------------------------------------------------------------
// Starting, choosing characters, beginning

/** Fresh story state for a table that has just been set to Bellweather. */
function newState(room: Room): AdventureState {
	return {
		id: 'hollow-bell',
		stage: 'choosing',
		chapter: 'village',
		location: 'bellweather',
		characters: new Map(),
		evidence: new Map(),
		tried: new Set(),
		events: [],
		defeated: [],
		npcs: new Map(NPC_IDS.map((id) => [id, NPCS[id].states[0]])),
		said: new Set(),
		decisions: new Map(),
		pending: null,
		encounters: new Map(),
		ending: null,
		objects: initialStates(),
		origins: recordOrigins(room),
		carried: new Map(),
		running: new Map(),
		sentries: new Map(),
		cuesRead: new Set(),
		encounter: null,
		begunAt: null,
		completedAt: null
	};
}

/** GM: sets up The Hollow Bell. Replaces the table with Bellweather. */
export function startAdventure(room: Room, actor: Player): Outcomes {
	if (actor.role !== 'gm') return GM_ONLY;
	applyScene(room, LOCATIONS.bellweather.scene());
	room.adventure = newState(room);
	return {
		ok: true,
		reset: true,
		log: [
			postSystem(room, `${actor.name} set up ${TITLE}.`),
			appendLog(room, { kind: 'narration', text: TEXT.started })
		]
	};
}

export function claimCharacter(room: Room, actor: Player, id: CharacterId): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'player') return fail('forbidden', 'Only players can take a character.');
	if (adventure.stage === 'complete' || adventure.stage === 'defeat') {
		return fail('forbidden', 'This story is over.');
	}
	const mine = characterOf(room, actor.id);
	if (mine) return fail('forbidden', `You are already playing ${CHARACTERS[mine.id].name}.`);
	const existing = adventure.characters.get(id);
	if (existing && room.tokens.has(existing.tokenId)) {
		return fail('character_taken', `${CHARACTERS[id].name} is already taken.`);
	}
	const token = placeCharacter(room, adventure.location, id, actor.id);
	if (!token) return fail('cell_occupied', 'There is no room on the road. Ask the GM to clear it.');
	adventure.characters.set(id, newCharacter(token.id, id));
	return {
		ok: true,
		log: [
			postSystem(room, `${actor.name} is playing ${CHARACTERS[id].name}.`),
			say(room, CHARACTERS[id].intro)
		]
	};
}

export function releaseCharacter(room: Room, actor: Player): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (adventure.stage !== 'choosing') {
		return fail('forbidden', 'The adventure has begun. Ask the GM to change characters.');
	}
	const mine = characterOf(room, actor.id);
	if (!mine) return fail('forbidden', "You haven't chosen a character.");
	room.tokens.delete(mine.token.id);
	adventure.characters.delete(mine.id);
	return {
		ok: true,
		log: [postSystem(room, `${actor.name} put ${CHARACTERS[mine.id].name} back.`)]
	};
}

export function beginAdventure(room: Room, actor: Player, now = Date.now()): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	if (adventure.stage !== 'choosing') return fail('forbidden', 'The adventure has already begun.');
	if (played(room, adventure).length === 0) {
		return fail('forbidden', 'Wait until at least one player has chosen a character.');
	}
	adventure.stage = 'playing';
	adventure.begunAt = now;
	return { ok: true, log: [appendLog(room, { kind: 'narration', text: TEXT.arrival })] };
}

// ---------------------------------------------------------------------------
// Interacting with the world

/** Dice for checks when the game server doesn't pass its own. */
const RANDOM: DieRoller = (sides) => randomInt(1, sides + 1);

/** Only this player (and the GM) reads the entry. */
const only = (playerId: string): LogAudience => ({ players: [playerId] });

/** Whether a character knows a piece of evidence: they found it, or the party shares it. */
export function knows(adventure: AdventureState, who: CharacterId | null, id: string): boolean {
	const f = adventure.evidence.get(id);
	return !!f && (f.shared || (who !== null && f.by.includes(who)));
}

/**
 * Records evidence. Found by a character (`finder`), only that character
 * knows it until their player shares it; with no finder (someone said it
 * aloud, or everyone saw it) the whole party knows it at once. Evidence the
 * whole party comes to know can move the story on (`unlocks`).
 */
function addClue(
	room: Room,
	adventure: AdventureState,
	id: ClueId,
	finder: { id: CharacterId; playerId: string } | null
): ChatMessage[] {
	const def = CLUES[id];
	const found = adventure.evidence.get(id);
	if (!finder) {
		if (found?.shared) return [];
		if (found) found.shared = true;
		else adventure.evidence.set(id, { by: [], shared: true });
		return [postSystem(room, `New evidence: ${def.title}.`), ...unlock(room, adventure, id)];
	}
	if (found?.shared || found?.by.includes(finder.id)) return [];
	if (found) found.by.push(finder.id);
	else adventure.evidence.set(id, { by: [finder.id], shared: false });
	const name = CHARACTERS[finder.id].name;
	return [
		postSystem(room, `${name} found something (${EVIDENCE_KINDS[def.kind].toLowerCase()}).`),
		postSystem(
			room,
			`New evidence: ${def.title}. Only ${name} knows it; share it with the party from the evidence list.`,
			only(finder.playerId)
		)
	];
}

/** Evidence the party now knows may raise a story event (which can unlock objectives). */
function unlock(room: Room, adventure: AdventureState, id: ClueId): ChatMessage[] {
	const def: ClueDef = CLUES[id];
	const event = def.unlocks;
	return event ? happen(room, adventure, event).log : [];
}

function say(room: Room, text: string, speaker?: string, audience?: LogAudience): ChatMessage {
	return appendLog(room, {
		kind: 'narration',
		text,
		...(speaker ? { speaker } : {}),
		...(audience ? { audience } : {})
	});
}

/** How long a flash (the Bell's note as light) lights the whole table. */
export const FLASH_MS = 2500;

/**
 * Narration that every client plays as a flash, and the flash itself: for
 * FLASH_MS everything on the table is lit, for the party and the enemies
 * alike (the game server syncs again when it fades).
 */
function flare(room: Room, text: string): ChatMessage {
	room.flashUntil = Date.now() + FLASH_MS;
	return appendLog(room, { kind: 'narration', text, cue: 'flash' });
}

/** Narration that every client plays as the bell tolling. */
function toll(room: Room, text: string): ChatMessage {
	return appendLog(room, { kind: 'narration', text, cue: 'toll' });
}

/** A d20 plus the character's stat against a difficulty, rolled here and logged for all. */
function rollCheck(
	room: Room,
	actor: Player,
	me: Played,
	action: string,
	check: Check,
	roller: DieRoller
): { entry: ChatMessage; success: boolean } {
	const bonus = CHARACTERS[me.id].stats[check.stat];
	const rolled = roll(bonus ? `1d20+${bonus}` : '1d20', roller);
	const success = rolled.total >= check.dc;
	const entry = appendLog(room, {
		kind: 'check',
		authorId: actor.id,
		authorName: CHARACTERS[me.id].name,
		action,
		stat: STATS.find((s) => s.id === check.stat)?.name ?? check.stat,
		roll: rolled,
		dc: check.dc,
		success
	});
	return { entry, success };
}

/**
 * Player: their character does something to a world object beside it: talks,
 * examines, opens, searches, breaks, lights. `verbId` picks what; null takes
 * the first thing that can be done to the object in its state.
 */
export function interact(
	room: Room,
	actor: Player,
	targetId: string,
	verbId: string | null = null,
	roller: DieRoller = RANDOM
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const def = objectDef(targetId);
	const cells = def && objectCells(room, def);
	const state = def && objectState(adventure, def);
	if (!def || !cells || shownState(adventure, def) === 'hidden') {
		return fail('object_not_found', "That isn't here.");
	}
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	// In a fight there's no time for anything but a torch: lighting or dousing one is the turn's action.
	const encounter = adventure.encounter;
	if (encounter) {
		if (def.kind !== 'torch') return fail('not_your_turn', TEXT.notNow);
		if (!isTurnOf(encounter, me.id)) return fail('not_your_turn', notYourTurn(room, encounter));
		if (encounter.acted.has(me.id)) {
			return fail('not_your_turn', `${CHARACTERS[me.id].name} has already acted this turn.`);
		}
	}
	const verb = verbsFor(adventure, def).find((v) => verbId === null || v.id === verbId);
	if (!verb) {
		return fail(
			'forbidden',
			state === 'disabled'
				? (def.disabledText ?? `The ${def.name.toLowerCase()} can't be used.`)
				: `There's nothing more to do with the ${def.name.toLowerCase()}.`
		);
	}
	const name = CHARACTERS[me.id].name;
	const carrier = adventure.carried.get(def.id);
	if (carrier !== undefined) {
		if (carrier !== me.id) return fail('forbidden', 'Someone else is carrying that.');
	} else if (!canReach(obstacles(room), me.token.pos, cells)) {
		return fail('out_of_reach', `Move ${name} next to it first.`);
	}
	if (verb.needs && adventure.carried.get(verb.needs) !== me.id) {
		const needed = objectDef(verb.needs)?.name.toLowerCase() ?? 'something';
		return fail('forbidden', `${name} needs the ${needed} for that.`);
	}
	// Work out a move before any check is rolled, so a blocked push costs nothing.
	const moving = verb.physical ? plan(room, adventure, def, verb.physical, me) : null;
	if (moving && !moving.ok) return fail('forbidden', moving.message);
	const before = state!;
	let checked: ChatMessage[] = [];
	// A check stands between the character and what's there to find, once per character.
	if (verb.check && before !== 'used') {
		const key = `${me.id}:${def.id}:${verb.id}`;
		if (adventure.tried.has(key)) {
			return fail('forbidden', `${name} has tried that already. Someone else might see more.`);
		}
		const check = rollCheck(room, actor, me, verb.label, verb.check, roller);
		if (!check.success) {
			adventure.tried.add(key);
			return {
				ok: true,
				log: [check.entry, say(room, TEXT.nothingFound, undefined, only(actor.id))]
			};
		}
		checked = [check.entry];
	}
	if (moving?.ok) moving.apply();
	if (verb.to) setObjectState(room, adventure, def, verb.to);
	let outcome = respond(room, adventure, def, verb, before, me, actor);
	const shown = motionFor(def, verb);
	if (shown) outcome = merge({ log: [], motions: [shown] }, outcome);
	const mechanism = TRIGGERS[`${def.id}:${verb.id}`];
	if (mechanism) outcome = merge(outcome, startMechanism(room, adventure, mechanism));
	// What someone says about a private find would give it away: only the finder hears it.
	const investigating = actionOfVerb(verb) !== 'interact';
	const reactions = react(
		room,
		adventure,
		`${def.id}:${verb.id}`,
		me.token.pos,
		investigating ? only(actor.id) : undefined
	);
	const done = merge({ log: checked }, merge(outcome, { log: reactions }));
	if (!encounter) return { ok: true, ...done };
	encounter.acted.add(me.id);
	return { ok: true, ...merge(done, afterAction(room, adventure, encounter, me, [])) };
}

type Plan = { ok: true; apply: () => void } | { ok: false; message: string };

/**
 * What a physical verb does to the object's place, checked before anything
 * changes: pushing moves it a cell away from the character, pulling drags
 * it a cell toward the character (who steps back), turning rotates it a
 * quarter, picking up takes it into the character's hands, dropping puts
 * it down where the character stands. Null for verbs that only change state.
 */
function plan(
	room: Room,
	adventure: AdventureState,
	def: ObjectDef,
	physical: Physical,
	me: Played
): Plan | null {
	const propId = propIdOf(def);
	const origin = adventure.origins.get(def.id);
	const relook = () => applyLook(room, def, shownState(adventure, def), adventure.origins);
	if (physical === 'pick_up') {
		return { ok: true, apply: () => adventure.carried.set(def.id, me.id) };
	}
	if (physical === 'drop') {
		if (!origin) return { ok: false, message: 'There is nowhere to put it down.' };
		return {
			ok: true,
			apply: () => {
				adventure.carried.delete(def.id);
				origin.pos = { ...me.token.pos };
			}
		};
	}
	const prop = propId ? room.props.get(propId) : undefined;
	if (!prop || !origin) return null;
	const name = def.name.toLowerCase();
	if (physical === 'rotate') {
		const rotation = ((origin.rotation + 1) % 4) as Rotation;
		if (!fits(room, prop, { ...prop, rotation }, null)) {
			return { ok: false, message: `There isn’t room to turn the ${name}.` };
		}
		return {
			ok: true,
			apply: () => {
				origin.rotation = rotation;
				relook();
			}
		};
	}
	if (physical !== 'push' && physical !== 'pull') return null;
	// Square to it: beside one of its cells, not at a corner.
	const beside = footprintCells(prop).find(
		(c) => Math.abs(c.x - me.token.pos.x) + Math.abs(c.y - me.token.pos.y) === 1
	);
	if (!beside) return { ok: false, message: `Stand square to the ${name} to ${physical} it.` };
	const away = { x: beside.x - me.token.pos.x, y: beside.y - me.token.pos.y };
	const dir = physical === 'push' ? away : { x: -away.x, y: -away.y };
	const moved = { ...prop, pos: { x: prop.pos.x + dir.x, y: prop.pos.y + dir.y } };
	// Pulling, the character steps back to make room.
	const back = { x: me.token.pos.x + dir.x, y: me.token.pos.y + dir.y };
	if (physical === 'pull') {
		const blocked = obstacles(room);
		if (
			!inBounds(room.grid, back) ||
			!isFree(room, back, blocked) ||
			!canStep(blocked, me.token.pos, back)
		) {
			return { ok: false, message: `There’s no room behind ${CHARACTERS[me.id].name} to pull.` };
		}
	}
	if (!fits(room, prop, moved, physical === 'pull' ? me.token.id : null)) {
		return { ok: false, message: TEXT.crateBlocked.replace('crate', name) };
	}
	return {
		ok: true,
		apply: () => {
			origin.pos = { x: origin.pos.x + dir.x, y: origin.pos.y + dir.y };
			if (physical === 'pull') me.token.pos = back;
			relook();
		}
	};
}

/**
 * Whether `prop` can go to `to` (moved a cell, or turned): every cell it
 * would cover is on the table, open and unoccupied (but for `ignoreToken`),
 * and, moving, it slides there without crossing a wall or a drop.
 */
function fits(room: Room, prop: Prop, to: Prop, ignoreToken: string | null): boolean {
	const others = obstaclesFor(
		room.grid,
		room.objects.values(),
		[...room.props.values()].filter((p) => p.id !== prop.id),
		room.terrain
	);
	const from = footprintCells(prop);
	const dx = to.pos.x - prop.pos.x;
	const dy = to.pos.y - prop.pos.y;
	const slides = to.rotation === prop.rotation;
	return footprintCells(to).every((cell) => {
		if (!inBounds(room.grid, cell) || !isFree(room, cell, others, ignoreToken ?? undefined))
			return false;
		if (!slides) return true;
		const was = { x: cell.x - dx, y: cell.y - dy };
		return !from.some((c) => c.x === was.x && c.y === was.y) || canStep(others, was, cell);
	});
}

/** The motion and sound each kind of physical verb makes, unless the verb says otherwise. */
const PHYSICAL_MOTION: Partial<Record<Physical, Pick<Motion, 'kind' | 'sound'>>> = {
	push: { kind: null, sound: 'scrape' },
	pull: { kind: null, sound: 'scrape' },
	move: { kind: null, sound: 'scrape' },
	open: { kind: null, sound: 'thud' },
	close: { kind: null, sound: 'thud' },
	pick_up: { kind: null, sound: 'scrape' },
	drop: { kind: 'land', sound: 'thud' },
	rotate: { kind: null, sound: 'grind' },
	destroy: { kind: 'shake', sound: 'crack' }
};

/** How doing `verb` to an object shows on the table, if it shows at all. */
function motionFor(def: ObjectDef, verb: Verb): Motion | null {
	const base = verb.physical ? PHYSICAL_MOTION[verb.physical] : undefined;
	const sound: Sound | null = verb.sound ?? base?.sound ?? null;
	if (!base && !sound) return null;
	return { propId: propIdOf(def), kind: base?.kind ?? null, sound };
}

// ---------------------------------------------------------------------------
// Mechanisms (see mechanisms.ts)

/** Sets a mechanism going: its first step now, the rest scheduled by the game server. */
function startMechanism(room: Room, adventure: AdventureState, id: MechanismId): Outcome {
	if (adventure.running.has(id)) return { log: [] };
	adventure.running.set(id, 0);
	return runSteps(room, adventure, id);
}

/**
 * Runs a mechanism's next step, if it is still waiting for that step at this
 * table (a stale or repeated call does nothing), with any steps right after it.
 */
export function runMechanism(room: Room, id: MechanismId, step: number): Outcome | null {
	const adventure = room.adventure;
	if (!adventure || adventure.running.get(id) !== step) return null;
	if (MECHANISMS[id].location !== adventure.location) {
		adventure.running.delete(id);
		return null;
	}
	return runSteps(room, adventure, id);
}

function runSteps(room: Room, adventure: AdventureState, id: MechanismId): Outcome {
	const steps = MECHANISMS[id].steps;
	let outcome: Outcome = { log: [] };
	let index = adventure.running.get(id) ?? 0;
	do {
		const step = steps[index];
		if (step.set) {
			const def = objectDef(step.set.object);
			if (def) setObjectState(room, adventure, def, step.set.state);
		}
		if (step.motion) {
			const { prop, kind, sound } = step.motion;
			outcome = merge(outcome, { log: [], motions: [{ propId: prop, kind, sound }] });
		}
		if (step.text) outcome = merge(outcome, { log: [say(room, step.text)] });
		index += 1;
		if (index >= steps.length) adventure.running.delete(id);
		else adventure.running.set(id, index);
		if (step.event) outcome = merge(outcome, happen(room, adventure, step.event));
	} while (index < steps.length && steps[index].after === 0 && adventure.running.get(id) === index);
	if (index < steps.length && adventure.running.get(id) === index) {
		outcome = merge(outcome, {
			log: [],
			mechanisms: [{ id, step: index, delay: steps[index].after }]
		});
	}
	return outcome;
}

/** Mechanisms waiting for their next step, to schedule after a save is loaded. */
export function pendingMechanisms(
	adventure: AdventureState
): { id: MechanismId; step: number; delay: number }[] {
	return [...adventure.running].map(([id, step]) => ({
		id,
		step,
		delay: MECHANISMS[id].steps[step]?.after ?? 0
	}));
}

/** What happens in the story when a verb is done: narration, clues, events. */
function respond(
	room: Room,
	adventure: AdventureState,
	def: ObjectDef,
	verb: Verb,
	before: ObjectState,
	me: Played,
	actor: Player
): Outcome {
	const has = (event: EventId) => adventure.events.includes(event);
	const told = (...log: ChatMessage[]): Outcome => ({ log });
	const then = (log: ChatMessage[], event: EventId): Outcome => {
		const next = happen(room, adventure, event);
		return { ...next, log: [...log, ...next.log] };
	};
	// What a character finds by investigating is theirs until they share it.
	const clue = (id: ClueId) => [
		say(room, CLUES[id].text, undefined, only(actor.id)),
		...addClue(room, adventure, id, { id: me.id, playerId: actor.id })
	];
	if (verb.id === 'talk' && isNpcId(def.id)) return talk(room, adventure, def.id, me.id);
	switch (`${def.id}:${verb.id}`) {
		case 'well:examine': {
			if (has('well_clue')) return told(say(room, CLUES.scratches.text));
			if (!has('talked_maren')) return told(say(room, TEXT.wellEarly));
			return then(
				// Everyone sees what climbs out, so everyone knows.
				[say(room, TEXT.wellClue), ...addClue(room, adventure, 'scratches', null)],
				'well_clue'
			);
		}
		case 'noticeboard:read':
			return told(...clue('notice'));
		case 'register:read':
			return told(...clue('register'));
		case 'table:examine':
			return told(say(room, before === 'used' ? TEXT.tableAgain : TEXT.table));
		case 'shrine:pray':
			return told(say(room, TEXT.shrine));
		case 'chest:open':
			return told(say(room, TEXT.chestOpen));
		case 'chest:search':
			return before === 'used' ? told(say(room, TEXT.chestEmpty)) : told(...clue('rope'));
		case 'rug:lift': {
			const hatch = objectDef('hatch');
			if (hatch && objectState(adventure, hatch) === 'hidden') {
				setObjectState(room, adventure, hatch, 'closed');
			}
			return told(say(room, TEXT.rug));
		}
		case 'hatch:search':
			return before === 'used' ? told(say(room, TEXT.hatchEmpty)) : told(...clue('drawing'));
		case 'crate:break':
			return told(say(room, TEXT.crate));
		case 'brazier:light':
			return told(say(room, TEXT.brazierLit));
		case 'brazier:extinguish':
			return told(say(room, TEXT.brazierOut));
		case 'remains:search':
			return before === 'used' ? told(say(room, TEXT.remainsEmpty)) : told(...clue('clapper'));
		case 'graves:read':
			return told(say(room, TEXT.graves));
		case 'altar:read':
			return told(...clue('chronicle'));
		case 'agna:turn': {
			const door = objectDef('secret-door');
			if (door && objectState(adventure, door) === 'hidden') {
				setObjectState(room, adventure, door, 'closed');
			}
			return then([say(room, TEXT.agna)], 'found_hidden_door');
		}
		case 'rope:examine':
			return told(...clue('splice'));
		case 'bell:examine': {
			if (before !== 'interactable') return told(say(room, TEXT.bell));
			// The first touch: the Bell's note lights the cavern, and whoever watches sees who is there.
			const lit = told(say(room, TEXT.bell), flare(room, TEXT.bellFlash));
			return merge(lit, detect(room, adventure) ?? { log: [] });
		}
		case 'chamber-torch:light':
			return told(say(room, TEXT.chamberTorchLit));
		case 'chamber-torch:extinguish':
			return told(say(room, TEXT.chamberTorchOut));
		case 'carvings:read':
			return adventure.evidence.has('rule')
				? told(say(room, TEXT.carvingsAgain))
				: told(...clue('rule'));
		case 'hollow-torch:extinguish':
			return told(say(room, TEXT.hollowTorchOut));
		case 'hollow-torch:light':
			return told(say(room, TEXT.hollowTorchLit));
		case 'pit:examine':
			return told(say(room, TEXT.pit));
		case 'chapel-rope:examine':
			return told(say(room, TEXT.chapelRope));
		case 'chapel-agna:examine':
			return told(say(room, TEXT.chapelAgna));
		case 'ringers:examine':
			return before === 'used'
				? told(say(room, TEXT.ringers))
				: told(say(room, TEXT.ringers), ...clue('empty-graves'));
		case 'anvil:examine':
			return told(say(room, TEXT.anvil));
		case 'loom:examine':
			return told(say(room, TEXT.loom));
		case 'stall:examine':
			return told(say(room, TEXT.stall));
		case 'waystone:read':
			return told(say(room, TEXT.waystone));
		case 'ledgers:read':
			return told(...clue('tollings'));
		case 'belfry-bell:search':
			return before === 'used' ? told(say(room, TEXT.bellEmpty)) : told(...clue('clapperless'));
		case 'chamber-crate:push':
		case 'chamber-crate:pull':
			// Moving it the first time shows what it hid.
			return adventure.evidence.has('tally')
				? told(say(room, TEXT.crateMoved))
				: told(...clue('tally'));
		case 'handbell:take':
			return told(say(room, TEXT.handbellTaken, undefined, only(actor.id)));
		case 'handbell:ring': {
			if (adventure.said.has('handbell:rung')) return told(say(room, TEXT.handbellAgain));
			adventure.said.add('handbell:rung');
			return told(say(room, TEXT.handbellRung), ...tend(room, adventure, 2));
		}
		case 'door-chains:break': {
			const doors = objectDef('great-door');
			if (doors && objectState(adventure, doors) === 'disabled') {
				setObjectState(room, adventure, doors, 'closed');
			}
			return told(say(room, TEXT.chainsBroken));
		}
		case 'bones:search':
			return before === 'used' ? told(say(room, TEXT.bonesEmpty)) : told(...clue('badges'));
		default:
			return told();
	}
}

// ---------------------------------------------------------------------------
// People: talking, reacting, and where they stand

/** Whether a line's conditions hold now, for a speaker in `state`. */
function holds(
	adventure: AdventureState,
	state: string,
	when: When | undefined,
	who: CharacterId | null
): boolean {
	if (!when) return true;
	const has = (e: EventId) => adventure.events.includes(e);
	if (when.state && !when.state.includes(state)) return false;
	// People react to what the one talking to them knows.
	if (when.clues && !when.clues.every((c) => knows(adventure, who, c))) return false;
	if (when.events && !when.events.every(has)) return false;
	if (when.not && when.not.some(has)) return false;
	if (when.pending && adventure.pending !== when.pending) return false;
	for (const [id, states] of Object.entries(when.objects ?? {})) {
		const def = objectDef(id);
		if (!def || !states.includes(objectState(adventure, def))) return false;
	}
	return true;
}

/**
 * Talking to someone: they say the first of their lines that applies, which
 * may give a clue, change how they feel, move the story on or tend wounds.
 */
function talk(room: Room, adventure: AdventureState, id: NpcId, who: CharacterId): Outcome {
	const npc = NPCS[id];
	const state = adventure.npcs.get(id) ?? npc.states[0];
	const line = npc.lines.find(
		(l) => !(l.once && adventure.said.has(`${id}:${l.id}`)) && holds(adventure, state, l.if, who)
	);
	if (!line) return { log: [] };
	adventure.said.add(`${id}:${line.id}`);
	const log = [line.narrated ? say(room, line.text) : say(room, line.text, npc.speaker)];
	// Said aloud: the whole party hears it.
	if (line.clue) log.push(...addClue(room, adventure, line.clue, null));
	if (line.becomes) adventure.npcs.set(id, line.becomes);
	if (line.heals) log.push(...tend(room, adventure, line.heals));
	return line.event ? merge({ log }, happen(room, adventure, line.event)) : { log };
}

/**
 * Player: their character listens, or looks around, where it stands, and may
 * pick up signs nearby (each behind a check, one try per character).
 */
export function sense(
	room: Room,
	actor: Player,
	what: Sense,
	roller: DieRoller = RANDOM
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	if (adventure.encounter) return fail('not_your_turn', TEXT.notNow);
	const blocked = obstacles(room);
	const signs = SIGNS.filter(
		(s) =>
			s.location === adventure.location &&
			s.sense === what &&
			gridDistance(me.token.pos, s.at) <= s.range &&
			hasLineOfSight(blocked, me.token.pos, s.at) &&
			!knows(adventure, me.id, s.clue) &&
			!adventure.tried.has(`${me.id}:sign:${s.id}`)
	);
	const verb = INVESTIGATION_ACTIONS[what];
	if (signs.length === 0) {
		const nothing = what === 'listen' ? TEXT.hearNothing : TEXT.seeNothing;
		return { ok: true, log: [say(room, nothing, undefined, only(actor.id))] };
	}
	const log: ChatMessage[] = [];
	for (const s of signs) {
		const check = rollCheck(room, actor, me, verb, s.check, roller);
		log.push(check.entry);
		if (!check.success) {
			adventure.tried.add(`${me.id}:sign:${s.id}`);
			log.push(say(room, TEXT.cantMakeOut, undefined, only(actor.id)));
			continue;
		}
		log.push(say(room, CLUES[s.clue].text, undefined, only(actor.id)));
		log.push(...addClue(room, adventure, s.clue, { id: me.id, playerId: actor.id }));
	}
	return { ok: true, log };
}

/** Player (or the GM): tells the whole party about evidence their character found. */
export function share(room: Room, actor: Player, clueId: string): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const found = adventure.evidence.get(clueId);
	const me = actor.role === 'gm' ? null : characterOf(room, actor.id);
	if (!found || (actor.role !== 'gm' && (!me || !found.by.includes(me.id)))) {
		return fail('forbidden', 'You have nothing like that to share.');
	}
	if (found.shared) return fail('forbidden', 'The party already knows that.');
	found.shared = true;
	const id = clueId as ClueId;
	const by = me ? CHARACTERS[me.id].name : actor.name;
	return {
		ok: true,
		log: [
			postSystem(room, `${by} shared evidence: ${CLUES[id].title}.`),
			say(room, CLUES[id].text),
			...unlock(room, adventure, id)
		]
	};
}

/** Every standing character recovers up to `hp`. */
function tend(room: Room, adventure: AdventureState, hp: number): ChatMessage[] {
	const healed = standing(room, adventure).filter((c) => c.state.hp < CHARACTERS[c.id].hp);
	for (const c of healed) c.state.hp = Math.min(CHARACTERS[c.id].hp, c.state.hp + hp);
	if (healed.length === 0) return [];
	return [
		postSystem(room, `${healed.map((c) => CHARACTERS[c.id].name).join(', ')} recovered some HP.`)
	];
}

/**
 * People nearby call out when the party does something (`object:verb`, only
 * within earshot of `near`) or when something happens (`event:<id>`). Each
 * reaction is heard once.
 */
function react(
	room: Room,
	adventure: AdventureState,
	on: string,
	near?: GridPos,
	audience?: LogAudience
): ChatMessage[] {
	const log: ChatMessage[] = [];
	for (const r of REACTIONS) {
		if (r.on !== on || adventure.said.has(`reaction:${r.id}`)) continue;
		const npc = NPCS[r.npc];
		const token = npc.location === adventure.location ? room.tokens.get(npc.token) : undefined;
		if (!token) continue;
		if (r.within !== undefined && near && gridDistance(token.pos, near) > r.within) continue;
		adventure.said.add(`reaction:${r.id}`);
		log.push(say(room, r.text, npc.speaker, audience));
	}
	return log;
}

/** The village while the Hound is loose, after it is dead, or neither. */
function villagePhase(adventure: AdventureState): 'calm' | 'hiding' | 'after' {
	if (adventure.encounters.get('well') === 'active') return 'hiding';
	return adventure.events.includes('won_well') ? 'after' : 'calm';
}

/** People go where they belong now: indoors while the Hound is loose, back out after. */
function settlePeople(room: Room, adventure: AdventureState): void {
	const phase = villagePhase(adventure);
	for (const id of NPC_IDS) {
		const npc = NPCS[id];
		const token = npc.location === adventure.location ? room.tokens.get(npc.token) : undefined;
		if (!token) continue;
		const to = placeFor(npc, phase);
		if ((token.pos.x !== to.x || token.pos.y !== to.y) && isFree(room, to)) token.pos = { ...to };
	}
}

// ---------------------------------------------------------------------------
// The story: events, chapters, places, decisions

const merge = (a: Outcome, b: Outcome): Outcome => {
	const motions = [...(a.motions ?? []), ...(b.motions ?? [])];
	const mechanisms = [...(a.mechanisms ?? []), ...(b.mechanisms ?? [])];
	return {
		log: [...a.log, ...b.log],
		...(a.reset || b.reset ? { reset: true } : {}),
		...((b.enemyTurn ?? a.enemyTurn) !== undefined
			? { enemyTurn: b.enemyTurn ?? a.enemyTurn }
			: {}),
		...(motions.length ? { motions } : {}),
		...(mechanisms.length ? { mechanisms } : {})
	};
};

/**
 * Something happened in the story. Records it (once), does what it does to
 * the table, and moves on to the next chapter if the current one was waiting
 * for it.
 */
export function happen(
	room: Room,
	adventure: AdventureState,
	event: EventId,
	now = Date.now()
): Outcome {
	if (adventure.events.includes(event)) return { log: [] };
	adventure.events.push(event);
	let outcome: Outcome = { log: [] };
	switch (event) {
		case 'won_well': {
			adventure.npcs.set('maren', 'hopeful');
			settlePeople(room, adventure);
			const gate = objectDef('gate');
			if (gate) setObjectState(room, adventure, gate, 'opened');
			for (const i of rectCells(room.grid, PATH_AREA.from, PATH_AREA.to)) room.fog.revealed[i] = 1;
			outcome = { log: [say(room, TEXT.gateOpens)] };
			break;
		}
		case 'promised': {
			adventure.npcs.set('oswin', 'trusting');
			const door = objectDef('side-door');
			if (door && objectState(adventure, door) === 'disabled') {
				setObjectState(room, adventure, door, 'closed');
			}
			break;
		}
		case 'talked_oswin':
			outcome = offer(room, adventure, 'promise');
			break;
		case 'opened_grate': {
			// Someone already standing on the grate is on the stair now.
			const onStair = played(room, adventure).find(
				(c) => c.token.pos.x === STAIR.from.x && c.token.pos.y === STAIR.from.y
			);
			if (onStair) outcome = happen(room, adventure, 'reached_stair', now);
			break;
		}
	}
	outcome = merge(outcome, { log: react(room, adventure, `event:${event}`) });
	const next = transition(adventure.chapter, event);
	if (next === undefined) return outcome;
	return merge(
		outcome,
		next === null ? end(room, adventure, now) : enter(room, adventure, next, now)
	);
}

/** The party moves into a chapter: to its table, if it is played elsewhere, and what opens it. */
function enter(room: Room, adventure: AdventureState, chapter: ChapterId, now: number): Outcome {
	adventure.chapter = chapter;
	const def = CHAPTERS[chapter];
	let outcome: Outcome = {
		log: [postSystem(room, `Chapter ${chapterNumber(chapter)}: ${def.title}.`)]
	};
	if (def.location !== adventure.location) {
		travel(room, adventure, def.location);
		outcome.reset = true;
	}
	const tell = (...log: ChatMessage[]) => (outcome = merge(outcome, { log }));
	switch (chapter) {
		case 'discover_bell':
			outcome = merge(outcome, startEncounter(room, adventure, 'well'));
			settlePeople(room, adventure);
			break;
		case 'investigate_monastery':
			tell(say(room, TEXT.leaveVillage));
			break;
		case 'enter_monastery':
			// The signature moment: the tower bell swings, and something answers far below.
			tell(say(room, TEXT.nave), toll(room, TEXT.firstToll));
			break;
		case 'bell_rings': {
			tell(say(room, TEXT.chamber));
			const grate = objectDef('grate');
			if (grate) setObjectState(room, adventure, grate, 'opened');
			tell(toll(room, TEXT.bellRings));
			outcome = merge(outcome, startEncounter(room, adventure, 'chamber'));
			// The note lights the dark chamber for a moment: long enough to see what came up.
			outcome = merge(outcome, { log: [flare(room, TEXT.chamberFlash)] });
			break;
		}
		case 'descend': {
			// The grate slams back down: the lever by the door lifts it (see mechanisms.ts).
			const grate = objectDef('grate');
			if (grate) setObjectState(room, adventure, grate, 'disabled');
			tell(say(room, TEXT.chamberWon));
			outcome = merge(outcome, {
				log: [],
				motions: [{ propId: MONASTERY_IDS.grate, kind: 'shake', sound: 'clank' }]
			});
			break;
		}
		case 'the_hollow':
			adventure.npcs.set('tobin', 'entranced');
			// The Keeper stands watch by the Bell and cultists walk the dark with lanterns: sneak or fight.
			postSentries(room, adventure, 'hollow');
			tell(say(room, TEXT.downStair), say(room, TEXT.hollow));
			// The Bell sounds as the party arrives: its light shows them the whole Hollow for a
			// moment, and they remember its shape (not who stands in it).
			tell(flare(room, TEXT.hollowFlash));
			for (const p of room.players.values()) if (p.role !== 'gm') p.explored.fill(1);
			tell(say(room, TEXT.hollowWatch));
			break;
		case 'final_decision':
			outcome = merge(outcome, offer(room, adventure, 'bell'));
			break;
	}
	// The event this chapter waits for may already have happened (a GM
	// move, a save from an older build): move straight on.
	const waitingFor = def.next.on;
	if (adventure.events.includes(waitingFor)) {
		const next = transition(chapter, waitingFor);
		if (next) outcome = merge(outcome, enter(room, adventure, next, now));
		else if (next === null) outcome = merge(outcome, end(room, adventure, now));
	}
	return outcome;
}

/** Told to the table when a saved story is loaded back. */
export function resumeNotice(adventure: AdventureState): string {
	if (adventure.stage === 'complete')
		return `${TITLE} is over here: ${CHAPTERS[adventure.chapter].title}.`;
	return `${TITLE} continues. Chapter ${chapterNumber(adventure.chapter)}: ${CHAPTERS[adventure.chapter].title}.`;
}

export function chapterNumber(chapter: ChapterId): number {
	return Object.keys(CHAPTERS).indexOf(chapter) + 1;
}

/**
 * Takes the party to another table: the new scene replaces the old one, and
 * every character in play arrives at its spawn with the same token, owner
 * and condition.
 */
function travel(room: Room, adventure: AdventureState, to: LocationId): void {
	const party = played(room, adventure).map((c) => ({
		id: c.id,
		ownerId: c.token.ownerId,
		tokenId: c.token.id
	}));
	// What the party carries comes along, looks and all.
	const carried = [...adventure.carried.keys()].flatMap((id) => {
		const origin = adventure.origins.get(id);
		return origin ? [[id, origin] as const] : [];
	});
	// Whether the party shares its sight is the GM's choice for the whole story.
	const shared = room.fog.shared;
	applyScene(room, LOCATIONS[to].scene());
	room.fog.shared = shared;
	adventure.location = to;
	adventure.sentries.clear();
	adventure.origins = recordOrigins(room);
	for (const [id, origin] of carried) adventure.origins.set(id, origin);
	for (const id of adventure.running.keys()) {
		if (MECHANISMS[id].location !== to) adventure.running.delete(id);
	}
	for (const def of objectsAt(to))
		applyLook(room, def, shownState(adventure, def), adventure.origins);
	for (const c of party) {
		if (!placeCharacter(room, to, c.id, c.ownerId, c.tokenId)) adventure.characters.delete(c.id);
	}
}

/** Puts a choice to the party. */
function offer(room: Room, adventure: AdventureState, id: DecisionId): Outcome {
	if (adventure.decisions.has(id)) return { log: [] };
	adventure.pending = id;
	return { log: [postSystem(room, `A choice: ${DECISIONS[id].prompt}`)] };
}

/** The story has reached its ending. */
function end(room: Room, adventure: AdventureState, now: number): Outcome {
	const choice = adventure.decisions.get('bell')?.option;
	const ending = (choice && ENDING_FOR[choice]) || 'silent';
	adventure.ending = ending;
	adventure.stage = 'complete';
	adventure.completedAt = now;
	adventure.npcs.set('tobin', 'safe');
	const log = [say(room, ENDINGS[ending].text)];
	const promise = adventure.decisions.get('promise')?.option;
	const coda = promise && PROMISE_KEPT[promise]?.[ending];
	if (coda) log.push(say(room, coda));
	log.push(postSystem(room, `${TITLE}: ${ENDINGS[ending].title}.`));
	return { log };
}

/**
 * A player (for their character) or the GM answers the choice put to the
 * party. The first answer stands.
 */
export function decide(
	room: Room,
	actor: Player,
	decisionId: string,
	optionId: string,
	now = Date.now()
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (adventure.pending !== decisionId) {
		return fail('forbidden', 'There is no such choice to make right now.');
	}
	const def = DECISIONS[adventure.pending];
	const option = def.options.find((o) => o.id === optionId);
	if (!option) return fail('invalid_message', 'That is not one of the choices.');
	let by = actor.name;
	if (actor.role !== 'gm') {
		const me = characterOf(room, actor.id);
		if (!me) return fail('forbidden', 'Only a character in the story can choose.');
		const unable = unableReason(me);
		if (unable) return fail('forbidden', unable);
		by = CHARACTERS[me.id].name;
	}
	if (adventure.encounter) return fail('not_your_turn', TEXT.notNow);
	adventure.decisions.set(def.id, { option: option.id, by });
	adventure.pending = null;
	let outcome: Outcome = { log: [postSystem(room, `${by} chose: ${option.label}.`)] };
	if (def.id === 'promise') {
		const line = option.id === 'boy' ? TEXT.oswinBoy : TEXT.oswinSilence;
		outcome = merge(outcome, { log: [say(room, line, 'Oswin')] });
		outcome = merge(outcome, happen(room, adventure, 'promised', now));
	} else {
		outcome = merge(outcome, happen(room, adventure, 'decided_bell', now));
	}
	return { ok: true, ...outcome };
}

/** GM: puts any world object in one of its states: reveal a secret, unlock a door, break a crate. */
export function setObject(
	room: Room,
	actor: Player,
	objectId: string,
	state: ObjectState
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	const def = objectDef(objectId);
	if (!def) return fail('object_not_found', 'There is no such object.');
	if (!def.states.includes(state)) {
		return fail('invalid_message', `The ${def.name.toLowerCase()} can't be ${state}.`);
	}
	if (!objectCells(room, def))
		return fail('object_not_found', `The ${def.name} isn't on the table.`);
	if (adventure.carried.has(def.id)) {
		return fail('forbidden', `Someone is carrying the ${def.name.toLowerCase()}.`);
	}
	setObjectState(room, adventure, def, state);
	return {
		ok: true,
		log: [postSystem(room, `${actor.name} set ${def.name} to ${state}.`, 'gm')]
	};
}

// ---------------------------------------------------------------------------
// The encounter

/** A foe in a fight: its kind, and hit points if not the kind's usual. */
interface Foe {
	kind: EnemyKind;
	hp?: (characters: number) => number;
}

/** The fights in the story: who comes, where they appear, what lights up. */
const ENCOUNTERS: Record<
	EncounterId,
	{
		ring: readonly GridPos[];
		foes: readonly Foe[];
		/** Enemies already on the table, walking their rounds or standing guard (see `postSentries`). */
		sentries?: readonly { kind: EnemyKind; route: readonly GridPos[] }[];
		reveal: { from: GridPos; to: GridPos };
		/** Said as the fight begins. */
		opening?: string;
	}
> = {
	well: {
		ring: WELL_RING,
		foes: [{ kind: 'hound' }],
		// The square, so the whole party can see the fight.
		reveal: { from: { x: 8, y: 10 }, to: { x: 16, y: 17 } },
		opening: TEXT.houndEmerges
	},
	chamber: {
		ring: STAIR_RING,
		foes: [{ kind: 'hound', hp: PUP_HP }, { kind: 'hound', hp: PUP_HP }, { kind: 'cultist' }],
		reveal: CHAMBER
	},
	hollow: {
		ring: [],
		foes: [],
		sentries: [
			{ kind: 'keeper', route: [KEEPER_POST] },
			...CULTIST_ROUNDS.map((route) => ({ kind: 'cultist' as const, route }))
		],
		reveal: CAVERN,
		opening: TEXT.keeper
	}
};

/** The enemy's token, as it stands on the table. */
function enemyToken(kind: EnemyKind, pos: GridPos): Token {
	const def = ENEMIES[kind];
	return {
		id: randomUUID(),
		name: def.name,
		color: def.color,
		pos: { ...pos },
		ownerId: null,
		vision: def.vision,
		light: def.light
	};
}

/**
 * Puts a fight's sentries on the table: they walk their rounds (`patrol`)
 * or stand guard until one of them spots a character (`detect`), and then
 * the fight begins with them.
 */
export function postSentries(room: Room, adventure: AdventureState, id: EncounterId): void {
	for (const sentry of ENCOUNTERS[id].sentries ?? []) {
		const at = sentry.route.find((c) => isFree(room, c));
		if (!at) continue;
		const token = enemyToken(sentry.kind, at);
		room.tokens.set(token.id, token);
		adventure.sentries.set(token.id, {
			kind: sentry.kind,
			encounter: id,
			route: sentry.route.map((c) => ({ ...c })),
			leg: 0
		});
	}
}

/** What the enemies see: the table's obstacles and light, the standing party, the Bell. */
function situationFor(room: Room, adventure: AdventureState, selfId: string): Situation {
	const blocked = obstacles(room);
	const lit = lightFor(room, blocked);
	const bellDef = objectDef('bell');
	const bellCells = bellDef && objectCells(room, bellDef);
	return {
		grid: room.grid,
		blocked,
		lit,
		foes: standing(room, adventure).map((c) => ({ id: c.id, pos: c.token.pos, hp: c.state.hp })),
		free: (c) => isFree(room, c, blocked, selfId),
		bell:
			bellDef && bellCells?.length
				? { cells: bellCells, touched: objectState(adventure, bellDef) === 'used' }
				: null
	};
}

/**
 * Outside a fight: every sentry takes a step on its round, then looks about.
 * Run by the game server on a slow timer. Null when nothing moved.
 */
export function patrol(room: Room): Outcome | null {
	const adventure = room.adventure;
	if (!adventure || adventure.encounter || adventure.stage !== 'playing') return null;
	let moved = false;
	for (const [id, sentry] of adventure.sentries) {
		const token = room.tokens.get(id);
		if (!token || sentry.route.length <= 1) continue;
		const situation = situationFor(room, adventure, id);
		const step = patrolStep(situation, token.pos, sentry.route, sentry.leg);
		sentry.leg = step.leg;
		if (step.pos.x === token.pos.x && step.pos.y === token.pos.y) continue;
		token.pos = step.pos;
		moved = true;
	}
	const spotted = detect(room, adventure);
	return spotted ?? (moved ? { log: [] } : null);
}

/** Outside a fight: if a sentry can see a standing character, the fight begins. */
function detect(room: Room, adventure: AdventureState): Outcome | null {
	if (adventure.encounter || adventure.stage !== 'playing') return null;
	for (const [id, sentry] of adventure.sentries) {
		const token = room.tokens.get(id);
		if (!token) continue;
		const [spotted] = seenBy(situationFor(room, adventure, id), {
			kind: sentry.kind,
			pos: token.pos
		});
		if (spotted)
			return startEncounter(room, adventure, sentry.encounter, { by: token, who: spotted });
	}
	return null;
}

/** The dice the story rolls when no action brings its own (initiative): the room's, or secure ones. */
const diceOf = (room: Room): DieRoller => room.dice ?? RANDOM;

/**
 * A fight begins: the enemies appear, everyone rolls initiative (a d20 plus
 * Agility for characters, plus its own bonus for each enemy), and the first
 * in the order takes their turn.
 */
export function startEncounter(
	room: Room,
	adventure: AdventureState,
	id: EncounterId,
	spotted?: { by: Token; who: Foe_ }
): Outcome {
	const def = ENCOUNTERS[id];
	const party = standing(room, adventure);
	const spawn = LOCATIONS[adventure.location].spawn;
	const enemies = new Map<string, EnemyState>();
	for (const foe of def.foes) {
		const cell = def.ring.find((c) => isFree(room, c)) ?? spawn.find((c) => isFree(room, c));
		if (!cell) break;
		const token = enemyToken(foe.kind, cell);
		room.tokens.set(token.id, token);
		const hp = (foe.hp ?? ENEMIES[foe.kind].hp)(party.length);
		// It comes up beside the party: it knows where the nearest of them stands.
		const nearest = party.reduce<Played | null>(
			(a, b) => (!a || gridDistance(cell, b.token.pos) < gridDistance(cell, a.token.pos) ? b : a),
			null
		);
		enemies.set(token.id, {
			kind: foe.kind,
			hp,
			maxHp: hp,
			statuses: new Map(),
			rest: 0,
			...(nearest ? { lastSeen: { ...nearest.token.pos } } : {})
		});
	}
	// Sentries on the table join the fight where they stand, knowing where they saw someone.
	for (const [tokenId, sentry] of [...adventure.sentries]) {
		if (sentry.encounter !== id || !room.tokens.has(tokenId)) continue;
		adventure.sentries.delete(tokenId);
		const hp = ENEMIES[sentry.kind].hp(party.length);
		enemies.set(tokenId, {
			kind: sentry.kind,
			hp,
			maxHp: hp,
			statuses: new Map(),
			rest: 0,
			post: { ...sentry.route[0] },
			...(spotted ? { lastSeen: { ...spotted.who.pos } } : {})
		});
	}
	if (enemies.size === 0) return { log: [] };
	adventure.encounters.set(id, 'active');
	for (const c of played(room, adventure)) {
		c.state.uses.clear();
		c.state.statuses.clear();
	}
	const dice = diceOf(room);
	const rolled: { entry: TurnEntry; name: string; bonus: number; order: number }[] = [];
	for (const c of played(room, adventure)) {
		const bonus = CHARACTERS[c.id].stats.agility;
		rolled.push({
			entry: { kind: 'character', id: c.id, initiative: roll(`1d20+${bonus}`, dice).total },
			name: CHARACTERS[c.id].name,
			bonus,
			order: rolled.length
		});
	}
	for (const [tokenId, enemy] of enemies) {
		const bonus = ENEMIES[enemy.kind].initiative;
		const total = roll(bonus ? `1d20+${bonus}` : '1d20', dice).total;
		rolled.push({
			entry: { kind: 'enemy', tokenId, initiative: total },
			name: ENEMIES[enemy.kind].name,
			bonus,
			order: rolled.length
		});
	}
	// Highest first; on a tie the characters go first, then the quicker.
	rolled.sort(
		(a, b) =>
			b.entry.initiative - a.entry.initiative ||
			Number(b.entry.kind === 'character') - Number(a.entry.kind === 'character') ||
			b.bonus - a.bonus ||
			a.order - b.order
	);
	const encounter: Encounter = {
		id,
		round: 1,
		order: rolled.map((r) => r.entry),
		current: -1,
		acted: new Set(),
		moved: new Map(),
		speed: 0,
		enemies,
		turn: 1
	};
	adventure.encounter = encounter;
	for (const i of rectCells(room.grid, def.reveal.from, def.reveal.to)) room.fog.revealed[i] = 1;
	const log = [
		...(spotted
			? [say(room, `The ${spotted.by.name} spots ${CHARACTERS[spotted.who.id].name}!`)]
			: []),
		...(def.opening ? [say(room, def.opening)] : []),
		postSystem(
			room,
			`Initiative: ${rolled.map((r) => `${r.name} ${r.entry.initiative}`).join(', ')}. Round 1.`
		)
	];
	return merge({ log }, advance(room, adventure, encounter));
}

/**
 * A fallen enemy leaves the turn order. If it was its own turn (burning
 * killed it), the turn points just before the next, so advancing lands there.
 */
function leaveOrder(encounter: Encounter, tokenId: string): void {
	const i = encounter.order.findIndex((t) => t.kind === 'enemy' && t.tokenId === tokenId);
	if (i < 0) return;
	encounter.order.splice(i, 1);
	if (i <= encounter.current) encounter.current--;
}

/** Whose turn it is, or null outside a fight. */
function turnOf(encounter: Encounter | null): TurnEntry | null {
	return encounter?.order[encounter.current] ?? null;
}

/** Whether it is this character's turn. */
function isTurnOf(encounter: Encounter, id: CharacterId): boolean {
	const entry = turnOf(encounter);
	return entry?.kind === 'character' && entry.id === id;
}

/** Statuses count down one turn: at the start of their bearer's turn. */
function tick(statuses: Statuses): void {
	for (const [id, rounds] of statuses) {
		if (rounds <= 1) statuses.delete(id);
		else statuses.set(id, rounds - 1);
	}
}

/**
 * The turn passes to the next in the order who can take it (a new round
 * after the last). A character's turn starts here: its statuses count down
 * (a slow still halves this turn's movement), and one who is down bleeds
 * instead, dying after BLEED_OUT_ROUNDS of its turns. An enemy's turn is
 * returned as `enemyTurn` for the game server to run after a pause.
 */
function advance(room: Room, adventure: AdventureState, encounter: Encounter): Outcome {
	const log: ChatMessage[] = [];
	for (let tries = 0; tries <= encounter.order.length * 2; tries++) {
		encounter.current++;
		if (encounter.current >= encounter.order.length) {
			encounter.current = 0;
			encounter.round++;
			encounter.acted.clear();
			encounter.moved.clear();
			log.push(postSystem(room, `Round ${encounter.round}.`));
		}
		encounter.turn++;
		const entry = encounter.order[encounter.current];
		if (entry.kind === 'enemy') {
			if (!encounter.enemies.has(entry.tokenId) || !room.tokens.has(entry.tokenId)) continue;
			return { log, enemyTurn: encounter.turn };
		}
		const c = played(room, adventure).find((p) => p.id === entry.id);
		if (!c || c.state.dead) continue;
		const def = CHARACTERS[c.id];
		const slowed = c.state.statuses.has('slowed');
		tick(c.state.statuses);
		if (c.state.hp <= 0) {
			c.state.downedFor++;
			if (c.state.downedFor >= BLEED_OUT_ROUNDS) {
				c.state.dead = true;
				c.state.statuses.clear();
				log.push(say(room, `${def.name} is gone. The lamplight doesn't reach them any more.`));
			} else {
				const left = BLEED_OUT_ROUNDS - c.state.downedFor;
				log.push(
					postSystem(
						room,
						`${def.name} is bleeding out: ${left} more ${left === 1 ? 'turn' : 'turns'} to save them.`
					)
				);
			}
			continue;
		}
		encounter.speed = slowed ? Math.floor(def.speed / 2) : def.speed;
		log.push(postSystem(room, `${def.name}'s turn.`));
		return { log };
	}
	return { log };
}

function roll(expression: string, roller: DieRoller): DiceRoll {
	const parsed = parseDice(expression);
	if (!parsed.ok) throw new Error(`Bad dice in adventure data: ${expression}`);
	return rollDice(parsed.terms, roller);
}

interface Strike {
	hit: boolean;
	toHit: DiceRoll;
	damage: DiceRoll | null;
}

/** A d20 plus a bonus against the target's defense; a natural 20 always hits, a natural 1 never does. */
function strike(bonus: number, damage: string, defense: number, roller: DieRoller): Strike {
	const toHit = roll(`1d20+${bonus}`, roller);
	const natural = toHit.terms[0].kind === 'dice' ? toHit.terms[0].rolls[0] : 0;
	const hit = natural === 20 || (natural !== 1 && toHit.total >= defense);
	return { hit, toHit, damage: hit ? roll(damage, roller) : null };
}

/** Defense against attacks, counting a guard. */
function characterDefense(c: Played): number {
	return defenseFor(CHARACTERS[c.id].armor + (c.state.statuses.has('guarded') ? 2 : 0));
}

/**
 * Player: their character uses one of its actions: an attack on an enemy, a
 * heal on an ally (or itself), or a guard. In a fight this is the
 * character's action for its turn; outside one only healing makes sense.
 */
export function act(
	room: Room,
	actor: Player,
	actionId: string,
	targetId: string | null,
	roller: DieRoller
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	const def = CHARACTERS[me.id];
	const action = actionOf(def, actionId);
	if (!action) return fail('invalid_message', `${def.name} can't do that.`);
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	const encounter = adventure.encounter;
	if (!encounter && action.kind !== 'heal') return fail('forbidden', 'There is nothing to fight.');
	if (encounter && !isTurnOf(encounter, me.id))
		return fail('not_your_turn', notYourTurn(room, encounter));
	if (encounter?.acted.has(me.id)) {
		return fail('not_your_turn', `${def.name} has already acted this turn.`);
	}
	if (usesLeft(me.state, action) === 0) {
		return fail('forbidden', `${action.name} is spent until the next fight.`);
	}

	const blocked = obstacles(room);
	let log: ChatMessage[];
	if (action.target === 'enemy') {
		const enemy = targetId ? encounter?.enemies.get(targetId) : undefined;
		const target = targetId ? room.tokens.get(targetId) : undefined;
		if (!encounter || !enemy || !target) return fail('token_not_found', "That enemy isn't here.");
		if (!inActionRange(blocked, me.token.pos, target.pos, action)) {
			return fail(
				'out_of_reach',
				action.range <= 1
					? `Move ${def.name} next to the ${target.name} first.`
					: `The ${target.name} is out of range or out of sight.`
			);
		}
		log = [attackEnemy(room, actor, def, action, encounter, enemy, target, roller)];
	} else if (action.target === 'ally') {
		const ally = targetId ? characterByToken(room, targetId) : null;
		if (!ally) return fail('token_not_found', 'Choose one of the party.');
		if (ally.state.dead) return fail('forbidden', `${CHARACTERS[ally.id].name} is beyond help.`);
		if (!inActionRange(blocked, me.token.pos, ally.token.pos, action)) {
			return fail('out_of_reach', `${CHARACTERS[ally.id].name} is out of reach.`);
		}
		log = [heal(room, actor, def, action, ally, roller)];
	} else {
		log = [guard(room, adventure, actor, me, action)];
	}

	if (action.uses !== null) me.state.uses.set(action.id, (me.state.uses.get(action.id) ?? 0) + 1);
	if (!encounter) return { ok: true, log };
	encounter.acted.add(me.id);
	return { ok: true, ...afterAction(room, adventure, encounter, me, log) };
}

/** Who is taking the current turn, by name ("the Hollow Hound" for an enemy). */
function turnName(room: Room, encounter: Encounter): string {
	const entry = turnOf(encounter);
	if (!entry) return 'nobody';
	return entry.kind === 'character'
		? CHARACTERS[entry.id].name
		: `the ${room.tokens.get(entry.tokenId)?.name ?? 'enemy'}`;
}

/** Why it isn't this character's turn: whose it is. */
function notYourTurn(room: Room, encounter: Encounter): string {
	return `It's ${turnName(room, encounter)}'s turn.`;
}

function attackEnemy(
	room: Room,
	actor: Player,
	def: CharacterDef,
	action: Action,
	encounter: Encounter,
	enemy: EnemyState,
	target: Token,
	roller: DieRoller
): ChatMessage {
	const defense = defenseFor(ENEMIES[enemy.kind].armor);
	const result = strike(toHitFor(def, action), action.dice ?? '1d4', defense, roller);
	let outcome: string | undefined;
	let effect: string | undefined;
	if (result.hit) enemy.lastHitBy = def.id;
	if (result.damage) {
		enemy.hp = Math.max(0, enemy.hp - result.damage.total);
		if (enemy.hp === 0) {
			enemyDies(room, encounter, target);
			outcome = `The ${target.name} falls.`;
		} else if (action.applies) {
			enemy.statuses.set(action.applies.status, action.applies.rounds);
			effect = STATUSES[action.applies.status].name;
		}
	}
	return appendLog(room, {
		kind: 'attack',
		authorId: actor.id,
		authorName: def.name,
		attack: action.name,
		targetId: target.id,
		targetName: target.name,
		toHit: result.toHit,
		defense,
		hit: result.hit,
		damage: result.damage,
		...(outcome ? { outcome } : {}),
		...(effect ? { effect } : {})
	});
}

function heal(
	room: Room,
	actor: Player,
	def: CharacterDef,
	action: Action,
	ally: Played,
	roller: DieRoller
): ChatMessage {
	const rolled = roll(action.dice ?? '1d4', roller);
	const maxHp = CHARACTERS[ally.id].hp;
	const before = ally.state.hp;
	ally.state.hp = Math.min(maxHp, before + rolled.total);
	ally.state.downedFor = 0;
	const name = CHARACTERS[ally.id].name;
	const gained = ally.state.hp - before;
	return appendLog(room, {
		kind: 'ability',
		authorId: actor.id,
		authorName: def.name,
		ability: action.name,
		targetId: ally.token.id,
		targetName: name,
		roll: rolled,
		amount: gained,
		text: before <= 0 ? `${name} is back on their feet.` : `${name} recovers ${gained} HP.`
	});
}

/** Guards the character and every standing ally beside it, until the character's next turn. */
function guard(
	room: Room,
	adventure: AdventureState,
	actor: Player,
	me: Played,
	action: Action
): ChatMessage {
	const blocked = obstacles(room);
	const guarded = standing(room, adventure).filter(
		(c) =>
			c.id === me.id ||
			(gridDistance(c.token.pos, me.token.pos) <= 1 &&
				hasLineOfSight(blocked, me.token.pos, c.token.pos))
	);
	const status = action.applies ?? { status: 'guarded', rounds: 1 };
	// Statuses count down at their bearer's turn: an ally whose turn is still to come this
	// round gets one more, so the guard holds until the enemies have acted.
	const encounter = adventure.encounter;
	const place = (id: CharacterId) =>
		encounter?.order.findIndex((t) => t.kind === 'character' && t.id === id) ?? -1;
	for (const c of guarded) {
		const later = encounter && c.id !== me.id && place(c.id) > encounter.current;
		c.state.statuses.set(status.status, status.rounds + (later ? 1 : 0));
	}
	const names = guarded.map((c) => CHARACTERS[c.id].name);
	return appendLog(room, {
		kind: 'ability',
		authorId: actor.id,
		authorName: CHARACTERS[me.id].name,
		ability: action.name,
		targetId: null,
		targetName: null,
		roll: null,
		amount: null,
		text: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} ${STATUSES[status.status].name.toLowerCase()}.`
	});
}

/** Player: their character is done for this turn. */
export function endTurn(room: Room, actor: Player): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const encounter = adventure.encounter;
	if (!encounter) return fail('forbidden', 'There are no turns outside a fight.');
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (!isTurnOf(encounter, me.id)) return fail('not_your_turn', notYourTurn(room, encounter));
	return { ok: true, ...advance(room, adventure, encounter) };
}

/**
 * After a character acts: the fight may be won; otherwise the turn ends by
 * itself once the character has acted and has no movement left.
 */
function afterAction(
	room: Room,
	adventure: AdventureState,
	encounter: Encounter,
	me: Played,
	log: ChatMessage[]
): Outcome {
	if (encounter.enemies.size === 0) return merge({ log }, victory(room, adventure));
	const spent = (encounter.moved.get(me.id) ?? 0) >= encounter.speed;
	if (encounter.acted.has(me.id) && spent)
		return merge({ log }, advance(room, adventure, encounter));
	return { log };
}

/** An enemy is gone from the fight and the table; the well's Hound leaves its ashes where it fell. */
function enemyDies(room: Room, encounter: Encounter, token: Token): void {
	encounter.enemies.delete(token.id);
	leaveOrder(encounter, token.id);
	room.tokens.delete(token.id);
	const adventure = room.adventure;
	adventure?.defeated.push(token.name);
	const remains = objectDef('remains');
	if (!adventure || encounter.id !== 'well' || !remains || room.props.has(IDS.remains)) return;
	room.props.set(IDS.remains, {
		id: IDS.remains,
		assetId: 'ashes',
		pos: { ...token.pos },
		rotation: 0,
		scale: 1
	});
	adventure.origins.set(remains.id, { pos: { ...token.pos }, assetId: 'ashes', rotation: 0 });
	setObjectState(room, adventure, remains, 'interactable');
}

const WON: Record<EncounterId, { event: EventId; text?: string }> = {
	well: { event: 'won_well', text: TEXT.houndFalls },
	chamber: { event: 'won_chamber' },
	hollow: { event: 'won_hollow', text: TEXT.keeperFalls }
};

/** The fight is won: the fallen get back up, and the story hears of it. */
function victory(room: Room, adventure: AdventureState): Outcome {
	const encounter = adventure.encounter;
	const id = encounter?.id ?? 'well';
	adventure.encounter = null;
	adventure.encounters.set(id, 'won');
	const rounds = encounter?.round ?? 1;
	const log = [
		postSystem(room, `The fight is won in ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`)
	];
	if (WON[id].text) log.push(say(room, WON[id].text));
	const fallen = played(room, adventure).filter((c) => c.state.hp <= 0 && !c.state.dead);
	for (const c of fallen) {
		c.state.hp = 1;
		c.state.downedFor = 0;
	}
	if (fallen.length) log.push(say(room, TEXT.revive));
	for (const c of played(room, adventure)) {
		c.state.statuses.clear();
		c.state.uses.clear();
	}
	return merge({ log }, happen(room, adventure, WON[id].event));
}

/** Every character is down or dead: the fight, and the story, are lost. */
function defeat(room: Room, adventure: AdventureState, encounter: Encounter): ChatMessage[] {
	adventure.encounters.set(encounter.id, 'lost');
	adventure.encounter = null;
	adventure.stage = 'defeat';
	return [say(room, TEXT.defeat)];
}

/** The enemy whose turn the game server should run, if it is an enemy's turn (after loading a save). */
export function pendingEnemyTurn(adventure: AdventureState): number | null {
	const encounter = adventure.encounter;
	return turnOf(encounter)?.kind === 'enemy' ? encounter!.turn : null;
}

/**
 * An enemy takes its turn: burning eats at it, its statuses count down, and
 * it acts as its kind does (see enemies.ts). Then the turn passes on, or the
 * party has fallen. Returns null when `turn` is stale (the fight moved on
 * while this was scheduled).
 */
export function runEnemyTurn(room: Room, turn: number, roller: DieRoller): Outcome | null {
	const adventure = room.adventure;
	const encounter = adventure?.encounter;
	const entry = turnOf(encounter ?? null);
	if (!adventure || !encounter || encounter.turn !== turn || entry?.kind !== 'enemy') return null;
	const enemy = encounter.enemies.get(entry.tokenId);
	const token = room.tokens.get(entry.tokenId);
	if (!enemy || !token) return advance(room, adventure, encounter);
	const log: ChatMessage[] = [];
	if (enemy.statuses.has('burning')) {
		log.push(burn(room, encounter, enemy, token, roller));
		if (!encounter.enemies.has(token.id)) {
			if (encounter.enemies.size === 0) return merge({ log }, victory(room, adventure));
			return merge({ log }, advance(room, adventure, encounter));
		}
	}
	const kind = ENEMIES[enemy.kind];
	const speed = enemy.statuses.has('slowed') ? Math.floor(kind.speed / 2) : kind.speed;
	tick(enemy.statuses);
	if (enemy.rest > 0) enemy.rest--;
	log.push(...enemyActs(room, adventure, enemy, token, speed, roller));
	enemy.lastHitBy = undefined;
	if (standing(room, adventure).length === 0)
		return { log: [...log, ...defeat(room, adventure, encounter)] };
	return merge({ log }, advance(room, adventure, encounter));
}

/** What an enemy does on its turn: its kind decides (see ai.ts), and the rules carry it out. */
function enemyActs(
	room: Room,
	adventure: AdventureState,
	enemy: EnemyState,
	token: Token,
	speed: number,
	roller: DieRoller
): ChatMessage[] {
	if (standing(room, adventure).length === 0) return [];
	const decided = planTurn(situationFor(room, adventure, token.id), {
		kind: enemy.kind,
		pos: token.pos,
		hp: enemy.hp,
		maxHp: enemy.maxHp,
		speed,
		rest: enemy.rest,
		target: enemy.target,
		lastHitBy: enemy.lastHitBy,
		lastSeen: enemy.lastSeen,
		post: enemy.post
	});
	const last = decided.path.at(-1);
	if (last) token.pos = { ...last };
	enemy.target = decided.target;
	enemy.lastSeen = decided.lastSeen && { ...decided.lastSeen };
	const log: ChatMessage[] = [];
	const who = (id: CharacterId) => played(room, adventure).find((c) => c.id === id);
	const deed = decided.deed;
	if (decided.note === 'turns on' && decided.target) {
		log.push(say(room, `The ${token.name} turns on ${CHARACTERS[decided.target].name}.`));
	} else if (decided.note) {
		log.push(say(room, `The ${token.name} ${decided.note}.`));
	}
	if (deed?.kind === 'attack') {
		const target = who(deed.target);
		if (target) log.push(enemyAttack(room, token, deed.attack, target, roller));
	} else if (deed?.kind === 'toll') {
		const toll = ENEMIES[enemy.kind].toll;
		const targets = deed.targets.flatMap((id) => who(id) ?? []);
		if (toll && targets.length) {
			enemy.rest = toll.every;
			log.push(toll_(room, token, targets, toll, roller), flare(room, TEXT.tollFlash));
		}
	}
	return log;
}

/** An enemy attacks a character: to-hit against its defense, damage on a hit. */
function enemyAttack(
	room: Room,
	token: Token,
	attack: Attack,
	target: Played,
	roller: DieRoller
): ChatMessage {
	const def = CHARACTERS[target.id];
	const defense = characterDefense(target);
	const result = strike(attack.toHit, attack.damage, defense, roller);
	let outcome: string | undefined;
	if (result.damage) {
		target.state.hp = Math.max(0, target.state.hp - result.damage.total);
		if (target.state.hp === 0) {
			target.state.downedFor = 0;
			outcome = `${def.name} falls!`;
		}
	}
	return appendLog(room, {
		kind: 'attack',
		authorId: token.id,
		authorName: token.name,
		attack: attack.name,
		targetId: target.token.id,
		targetName: def.name,
		toHit: result.toHit,
		defense,
		hit: result.hit,
		damage: result.damage,
		...(outcome ? { outcome } : {})
	});
}

/** The Keeper's toll: everyone close by takes the damage and is slowed on their next turn. */
function toll_(
	room: Room,
	token: Token,
	near: Played[],
	toll: NonNullable<EnemyDef['toll']>,
	roller: DieRoller
): ChatMessage {
	const rolled = roll(toll.damage, roller);
	const fell: string[] = [];
	for (const t of near) {
		t.state.hp = Math.max(0, t.state.hp - rolled.total);
		if (t.state.hp === 0) {
			t.state.downedFor = 0;
			fell.push(CHARACTERS[t.id].name);
		} else t.state.statuses.set('slowed', toll.rounds);
	}
	const names = near.map((t) => CHARACTERS[t.id].name);
	return appendLog(room, {
		kind: 'ability',
		authorId: token.id,
		authorName: token.name,
		ability: 'Toll',
		targetId: near.length === 1 ? near[0].token.id : null,
		targetName: near.length === 1 ? names[0] : null,
		roll: rolled,
		amount: -rolled.total,
		text: `${TEXT.keeperToll} ${names.join(', ')} ${near.length === 1 ? 'takes' : 'each take'} ${rolled.total} and ${near.length === 1 ? 'is' : 'are'} slowed.${fell.length ? ` ${fell.join(', ')} ${fell.length === 1 ? 'falls' : 'fall'}!` : ''}`
	});
}

/** Fire eats at a burning enemy at the start of its turn. */
function burn(
	room: Room,
	encounter: Encounter,
	enemy: EnemyState,
	token: Token,
	roller: DieRoller
): ChatMessage {
	const rolled = roll('1d4', roller);
	enemy.hp = Math.max(0, enemy.hp - rolled.total);
	const dies = enemy.hp === 0;
	if (dies) enemyDies(room, encounter, token);
	return appendLog(room, {
		kind: 'ability',
		authorId: token.id,
		authorName: token.name,
		ability: STATUSES.burning.name,
		targetId: token.id,
		targetName: token.name,
		roll: rolled,
		amount: -rolled.total,
		text: dies
			? `The ${token.name} burns away to ash.`
			: `The ${token.name} burns for ${rolled.total}.`
	});
}

// ---------------------------------------------------------------------------
// Hooks the game server calls around ordinary scene actions

/**
 * Before a token move: characters that are down can't move, and in a fight a
 * character walks at most its speed per round, only in the players' phase.
 * Returns the walking distance to charge, or null when nothing is charged.
 */
export function checkMove(
	room: Room,
	actor: Player,
	tokenId: string,
	to: GridPos
): Result<{ cost: number | null }> {
	const adventure = room.adventure;
	const me = characterByToken(room, tokenId);
	if (!adventure || !me || actor.role === 'gm') return { ok: true, cost: null };
	const def = CHARACTERS[me.id];
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	const encounter = adventure.encounter;
	if (!encounter) return { ok: true, cost: null };
	if (!isTurnOf(encounter, me.id)) return fail('not_your_turn', notYourTurn(room, encounter));
	const cost = walkCost(room, me.token.pos, to);
	if (cost === null) return fail('no_path', "There's no way through to that cell.");
	const left = encounter.speed - (encounter.moved.get(me.id) ?? 0);
	if (cost > left) {
		return fail(
			'out_of_reach',
			left > 0
				? `${def.name} can move ${left} more ${left === 1 ? 'cell' : 'cells'} this round.`
				: `${def.name} has no movement left this round.`
		);
	}
	return { ok: true, cost };
}

function walkCost(room: Room, from: GridPos, to: GridPos): number | null {
	return (
		findPath(room.grid, obstacles(room), from, (c) => c.x === to.x && c.y === to.y)?.length ?? null
	);
}

/** After a token moved: charge its movement, and see whether a character walked into a place that matters. */
export function afterMove(
	room: Room,
	token: Token,
	cost: number | null,
	now = Date.now()
): Outcome {
	const adventure = room.adventure;
	const me = characterByToken(room, token.id);
	if (!adventure || !me) return { log: [] };
	const encounter = adventure.encounter;
	if (cost !== null && encounter) {
		encounter.moved.set(me.id, (encounter.moved.get(me.id) ?? 0) + cost);
		// Acted and walked as far as it can: the turn is over.
		const spent = (encounter.moved.get(me.id) ?? 0) >= encounter.speed;
		if (isTurnOf(encounter, me.id) && encounter.acted.has(me.id) && spent) {
			return advance(room, adventure, encounter);
		}
	}
	if (adventure.stage !== 'playing') return { log: [] };
	const area = areaAt(adventure.location, adventure.chapter, adventure.events, token.pos);
	const story = area ? happen(room, adventure, area.event, now) : { log: [] };
	// Walking into a sentry's sight starts its fight.
	const spotted = story.reset ? null : detect(room, adventure);
	return spotted ? merge(story, spotted) : story;
}

/** Why a door won't open for this actor, or null if it will. The GM can always force it. */
export function doorLock(room: Room, actor: Player, door: Door): string | null {
	const adventure = room.adventure;
	const def = objectForDoor(door.id);
	if (!adventure || !def || actor.role === 'gm') return null;
	return objectState(adventure, def) === 'disabled'
		? (def.disabledText ?? 'It will not open.')
		: null;
}

/** After a door was opened or closed: its world object follows. */
export function afterDoorToggle(room: Room, door: Door): void {
	const adventure = room.adventure;
	const def = objectForDoor(door.id);
	if (adventure && def) adventure.objects.set(def.id, door.open ? 'opened' : 'closed');
}

/** After the GM removed a token: a character leaves the story, an enemy leaves the fight. */
export function afterTokenDeleted(room: Room, tokenId: string, pos?: GridPos): Outcome {
	const adventure = room.adventure;
	if (!adventure) return { log: [] };
	for (const [id, state] of adventure.characters) {
		if (state.tokenId !== tokenId) continue;
		adventure.characters.delete(id);
		// What it carried falls where it stood.
		for (const [itemId, by] of adventure.carried) {
			const def = objectDef(itemId);
			const origin = adventure.origins.get(itemId);
			if (by !== id || !def) continue;
			adventure.carried.delete(itemId);
			if (origin && pos) origin.pos = { ...pos };
			setObjectState(room, adventure, def, origin && pos ? def.initial : 'hidden');
		}
	}
	const sentry = adventure.sentries.get(tokenId);
	if (sentry) {
		adventure.sentries.delete(tokenId);
		// The last of them gone before any fight: the way is clear.
		const left = [...adventure.sentries.values()].some((s) => s.encounter === sentry.encounter);
		if (!left && !adventure.encounters.has(sentry.encounter)) {
			adventure.encounters.set(sentry.encounter, 'won');
			return merge(
				{ log: [postSystem(room, 'The way is clear.')] },
				happen(room, adventure, WON[sentry.encounter].event)
			);
		}
		return { log: [] };
	}
	const encounter = adventure.encounter;
	if (!encounter) return { log: [] };
	const entry = turnOf(encounter);
	const theirs =
		(entry?.kind === 'enemy' && entry.tokenId === tokenId) ||
		(entry?.kind === 'character' && !adventure.characters.has(entry.id));
	const enemy = encounter.enemies.get(tokenId);
	if (enemy) {
		encounter.enemies.delete(tokenId);
		leaveOrder(encounter, tokenId);
		adventure.defeated.push(ENEMIES[enemy.kind].name);
		if (encounter.enemies.size === 0) return victory(room, adventure);
	}
	if (standing(room, adventure).length === 0) return { log: defeat(room, adventure, encounter) };
	// Whoever was taking their turn is gone: the turn passes on.
	return theirs ? advance(room, adventure, encounter) : { log: [] };
}

// ---------------------------------------------------------------------------
// The GM's tools

/** GM: narrates to the table. Works with or without an adventure running. */
export function narrate(room: Room, actor: Player, rawText: string): Outcomes {
	if (actor.role !== 'gm') return GM_ONLY;
	const text = normalizeChatText(rawText, NARRATION_MAX_LENGTH);
	if (!text) return fail('invalid_chat', `Narration must be 1-${NARRATION_MAX_LENGTH} characters.`);
	return { ok: true, log: [say(room, text)] };
}

/** GM: reads a prepared passage aloud. */
export function readCue(room: Room, actor: Player, cueId: string): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	const cue = CUES.find((c) => c.id === cueId);
	if (!cue) return fail('invalid_message', 'There is no such passage.');
	adventure.cuesRead.add(cue.id);
	return { ok: true, log: [say(room, cue.text)] };
}

/** GM: ends the current turn (a player's or an enemy's), restarts the story, or ends the adventure. */
export function control(
	room: Room,
	actor: Player,
	op: AdventureControl,
	now = Date.now()
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	switch (op) {
		case 'end_turn': {
			const encounter = adventure.encounter;
			if (!encounter) return fail('forbidden', 'There is no turn to end outside a fight.');
			const log = [postSystem(room, `${actor.name} ended ${turnName(room, encounter)}'s turn.`)];
			return { ok: true, ...merge({ log }, advance(room, adventure, encounter)) };
		}
		case 'restart':
			return { ok: true, ...restart(room, adventure, actor, now) };
		case 'end':
			room.adventure = null;
			return {
				ok: true,
				log: [postSystem(room, `${actor.name} ended ${TITLE}. The table stays as it is.`)]
			};
	}
}

/** Starts the story over in Bellweather; everyone keeps their character, back on the road at full health. */
function restart(room: Room, adventure: AdventureState, actor: Player, now: number): Outcome {
	const keep = played(room, adventure).map((c) => ({ id: c.id, ownerId: c.token.ownerId }));
	const begun = adventure.stage !== 'choosing';
	applyScene(room, LOCATIONS.bellweather.scene());
	const next = newState(room);
	for (const { id, ownerId } of keep) {
		const owner = ownerId && room.players.get(ownerId);
		const token = placeCharacter(
			room,
			next.location,
			id,
			owner && owner.role === 'player' ? owner.id : null
		);
		if (token) next.characters.set(id, newCharacter(token.id, id));
	}
	room.adventure = next;
	const log = [postSystem(room, `${actor.name} started the story over.`)];
	if (begun) {
		next.stage = 'playing';
		next.begunAt = now;
		log.push(say(room, TEXT.arrival));
	}
	return { reset: true, log };
}

/** GM: sets a character's hit points and statuses, or brings them back from the dead. */
export function override(
	room: Room,
	actor: Player,
	id: CharacterId,
	patch: CharacterPatch
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	const c = played(room, adventure).find((p) => p.id === id);
	if (!c) return fail('token_not_found', `${CHARACTERS[id].name} is not in play.`);
	const def = CHARACTERS[id];
	const changes: string[] = [];
	if (patch.revive && c.state.dead) {
		c.state.dead = false;
		c.state.hp = Math.max(1, c.state.hp);
		changes.push('brought back');
	}
	if (patch.hp !== undefined) {
		c.state.hp = Math.min(def.hp, patch.hp);
		changes.push(`set to ${c.state.hp} HP`);
	}
	if (c.state.hp > 0) c.state.downedFor = 0;
	if (patch.statuses) {
		c.state.statuses = new Map(patch.statuses.map((s) => [s, 1]));
		changes.push(
			patch.statuses.length
				? patch.statuses.map((s) => STATUSES[s].name.toLowerCase()).join(', ')
				: 'no statuses'
		);
	}
	if (changes.length === 0) return { ok: true, log: [] };
	return {
		ok: true,
		log: [postSystem(room, `${actor.name} adjusted ${def.name}: ${changes.join('; ')}.`)]
	};
}
