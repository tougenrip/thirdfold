// The rules of an adventure, for whichever adventure the table is playing
// (see define.ts for what an adventure is made of, and server/adventures
// for the adventures themselves; nothing here knows any one of them). Every
// action takes the acting player and checks role, ownership, reach and turn
// order before changing anything, like the scene actions in server/scene.ts.
// Dice are rolled here, on the server.
//
// The story moves by events: an action that matters to the story calls
// `happen`, which records the event, does what the adventure says it does
// (its effects, see `run`), and moves to the next chapter when the current
// one was waiting for it, travelling to another table when the chapter is
// played elsewhere.
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
	type Check,
	type DirectorView,
	type ObjectState,
	type Physical,
	type Sense
} from '../../src/lib/adventure/adventure';
import {
	actionOf,
	BLEED_OUT_ROUNDS,
	defenseFor,
	STATS,
	STATUSES,
	toHitFor,
	type Action,
	type Attack,
	type CharacterDef
} from '../../src/lib/adventure/characters';
import {
	FLASH_MS,
	NARRATION_MAX_LENGTH,
	normalizeChatText,
	type ChatMessage,
	type LogAudience,
	type Shot
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
import type { AdventureControl, CharacterPatch, Direction } from '../../src/lib/game/protocol';
import { tokenAt, type Token } from '../../src/lib/game/token';
import { hasLineOfSight, rectCells } from '../../src/lib/game/visibility';
import { appendLog, postSystem } from '../chat';
import { fail, type Player, type Result, type Room } from '../rooms';
import { lightFor, obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { creatorIdOf } from '../library-store';
import { patrolStep, plan as planTurn, seenBy, type Foe as Foe_, type Situation } from './ai';
import {
	AMBUSH,
	type AdventureDef,
	type Area,
	type AreaDef,
	type Effect,
	type EncounterDef,
	type EndingDef,
	type EnemyDef,
	type HazardDef,
	type ObjectDef,
	type PhaseDef,
	type Verb,
	type When
} from './define';
import { contentOf, defaultAdventure, findAdventure } from './registry';
import type {
	AdventureState,
	CharacterState,
	Encounter,
	EnemyState,
	Statuses,
	TurnEntry
} from './state';
import {
	actionOfVerb,
	applyLook,
	initialStates,
	objectDef,
	objectForDoor,
	objectsAt,
	propIdOf,
	recordOrigins
} from './world';

/** The content of the adventure a story is of. */
export function content(adventure: AdventureState): AdventureDef {
	return contentOf(adventure.id);
}

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
	mechanisms?: { id: string; step: number; delay: number }[];
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
	const light = def.litBy ? objectDef(content(adventure), def.litBy) : undefined;
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
	for (const other of content(adventure).objects) {
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
	for (const def of content(adventure).objects) {
		const id = propIdOf(def);
		if (id && shownState(adventure, def) === 'hidden') hidden.add(id);
	}
	return hidden;
}

// ---------------------------------------------------------------------------
// Characters

interface Played {
	id: string;
	def: CharacterDef;
	state: CharacterState;
	token: Token;
}

/** Characters on the table (their token exists), with their state. */
function played(room: Room, adventure: AdventureState): Played[] {
	const list: Played[] = [];
	for (const [id, def] of Object.entries(content(adventure).characters)) {
		const state = adventure.characters.get(id);
		const token = state && room.tokens.get(state.tokenId);
		if (state && token) list.push({ id, def, state, token });
	}
	return list;
}

/** Characters still standing: not down, not dead. */
function standing(room: Room, adventure: AdventureState): Played[] {
	return played(room, adventure).filter((c) => c.state.hp > 0 && !c.state.dead);
}

function newCharacter(tokenId: string, def: CharacterDef): CharacterState {
	return {
		tokenId,
		hp: def.hp,
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
	const name = me.def.name;
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
	A: AdventureDef,
	location: string,
	id: string,
	ownerId: string | null,
	tokenId: string = randomUUID()
): Token | null {
	const cell = A.locations[location].spawn.find((c) => isFree(room, c));
	if (!cell) return null;
	const def = A.characters[id];
	const token: Token = {
		id: tokenId,
		name: def.name,
		color: def.color,
		pos: { ...cell },
		ownerId,
		vision: def.vision,
		light: def.light,
		model: id
	};
	room.tokens.set(token.id, token);
	return token;
}

// ---------------------------------------------------------------------------
// Starting, choosing characters, beginning

/** Fresh story state for a table that has just been set to the adventure's first table. */
function newState(A: AdventureDef, room: Room): AdventureState {
	return {
		id: A.id,
		stage: 'choosing',
		chapter: A.start.chapter,
		location: A.start.location,
		characters: new Map(),
		evidence: new Map(),
		tried: new Set(),
		events: [],
		defeated: [],
		npcs: new Map(Object.values(A.npcs).map((npc) => [npc.id, npc.states[0]])),
		said: new Set(),
		rewards: [],
		decisions: new Map(),
		pending: null,
		encounters: new Map(),
		ending: null,
		objects: initialStates(A),
		origins: recordOrigins(A, room),
		carried: new Map(),
		running: new Map(),
		sentries: new Map(),
		cuesRead: new Set(),
		encounter: null,
		begunAt: null,
		completedAt: null
	};
}

/** GM: sets up an adventure (the server's first, unless another is named). Replaces the table with its first. */
export function startAdventure(room: Room, actor: Player, id?: string): Outcomes {
	if (actor.role !== 'gm') return GM_ONLY;
	const A = id === undefined ? defaultAdventure() : findAdventure(id);
	if (!A) return fail('invalid_message', 'There is no such adventure on this server.');
	applyScene(room, A.locations[A.start.location].scene());
	room.adventure = newState(A, room);
	return {
		ok: true,
		reset: true,
		log: [
			postSystem(room, `${actor.name} set up ${A.title}.`),
			appendLog(room, { kind: 'narration', text: A.voice.started })
		]
	};
}

export function claimCharacter(room: Room, actor: Player, id: string): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const A = content(adventure);
	const def = Object.hasOwn(A.characters, id) ? A.characters[id] : undefined;
	if (!def) return fail('invalid_message', 'There is no such character in this story.');
	if (actor.role !== 'player') return fail('forbidden', 'Only players can take a character.');
	if (adventure.stage === 'complete' || adventure.stage === 'defeat') {
		return fail('forbidden', 'This story is over.');
	}
	const mine = characterOf(room, actor.id);
	if (mine) return fail('forbidden', `You are already playing ${mine.def.name}.`);
	const existing = adventure.characters.get(id);
	const theirs = existing && room.tokens.get(existing.tokenId);
	// A character in the story that nobody plays (a continued table, a player who left): take it up.
	if (existing && theirs && !theirs.ownerId && adventure.stage !== 'choosing') {
		theirs.ownerId = actor.id;
		return {
			ok: true,
			log: [postSystem(room, `${actor.name} takes up ${def.name} again.`)]
		};
	}
	if (existing && theirs) {
		return fail('character_taken', `${def.name} is already taken.`);
	}
	const token = placeCharacter(room, A, adventure.location, id, actor.id);
	if (!token) return fail('cell_occupied', 'There is no room on the road. Ask the GM to clear it.');
	adventure.characters.set(id, newCharacter(token.id, def));
	return {
		ok: true,
		log: [postSystem(room, `${actor.name} is playing ${def.name}.`), say(room, def.intro)]
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
		log: [postSystem(room, `${actor.name} put ${mine.def.name} back.`)]
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
	return { ok: true, ...run(room, adventure, content(adventure).start.arrival, { now }) };
}

// ---------------------------------------------------------------------------
// Interacting with the world

/** Dice for checks when the game server doesn't pass its own. */
const RANDOM: DieRoller = (sides) => randomInt(1, sides + 1);

/** Only this player (and the GM) reads the entry. */
const only = (playerId: string): LogAudience => ({ players: [playerId] });

/** Whether a character knows a piece of evidence: they found it, or the party shares it. */
export function knows(adventure: AdventureState, who: string | null, id: string): boolean {
	const f = adventure.evidence.get(id);
	return !!f && (f.shared || (who !== null && f.by.includes(who)));
}

/**
 * Records evidence. Found by a character (`finder`), only that character
 * knows it until their player shares it; with no finder (someone said it
 * aloud, or everyone saw it) the whole party knows it at once. Evidence the
 * whole party comes to know can move the story on (`unlocks`).
 */
export function addClue(
	room: Room,
	adventure: AdventureState,
	id: string,
	finder: { id: string; playerId: string } | null
): Outcome {
	const A = content(adventure);
	const def = A.clues[id];
	if (!def) return { log: [] };
	const found = adventure.evidence.get(id);
	if (!finder) {
		if (found?.shared) return { log: [] };
		if (found) found.shared = true;
		else adventure.evidence.set(id, { by: [], shared: true });
		return merge(
			{ log: [postSystem(room, `New evidence: ${def.title}.`)] },
			unlock(room, adventure, id)
		);
	}
	if (found?.shared || found?.by.includes(finder.id)) return { log: [] };
	if (found) found.by.push(finder.id);
	else adventure.evidence.set(id, { by: [finder.id], shared: false });
	const name = A.characters[finder.id]?.name ?? finder.id;
	return {
		log: [
			postSystem(room, `${name} found something (${EVIDENCE_KINDS[def.kind].toLowerCase()}).`),
			postSystem(
				room,
				`New evidence: ${def.title}. Only ${name} knows it; share it with the party from the evidence list.`,
				only(finder.playerId)
			)
		]
	};
}

/** Evidence the party now knows may raise a story event (which can unlock objectives). */
function unlock(room: Room, adventure: AdventureState, id: string): Outcome {
	const event = content(adventure).clues[id]?.unlocks;
	return event ? happen(room, adventure, event) : { log: [] };
}

/** The same line of narration, calling for a camera shot. */
function shoot(message: ChatMessage, shot: Shot): ChatMessage {
	if (message.kind === 'narration')
		message.shot = { ...shot, focus: shot.focus && { ...shot.focus } };
	return message;
}

function say(room: Room, text: string, speaker?: string, audience?: LogAudience): ChatMessage {
	return appendLog(room, {
		kind: 'narration',
		text,
		...(speaker ? { speaker } : {}),
		...(audience ? { audience } : {})
	});
}

export { FLASH_MS };

/**
 * Narration that every client plays as a flash, and the flash itself: for
 * FLASH_MS everything on the table is lit, for the party and the enemies
 * alike (the game server syncs again when it fades).
 */
function flare(room: Room, text: string): ChatMessage {
	room.flashUntil = Date.now() + FLASH_MS;
	return appendLog(room, { kind: 'narration', text, cue: 'flash' });
}

/** Narration that every client plays as a bell tolling. */
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
	const bonus = me.def.stats[check.stat];
	const rolled = roll(bonus ? `1d20+${bonus}` : '1d20', roller);
	const success = rolled.total >= check.dc;
	const entry = appendLog(room, {
		kind: 'check',
		authorId: actor.id,
		authorName: me.def.name,
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
	const A = content(adventure);
	const def = objectDef(A, targetId);
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
	if (adventure.stage !== 'playing') return fail('forbidden', 'This story is over.');
	// In a fight there's time only for what can be done in one (a torch, a rope), as the turn's action.
	const encounter = adventure.encounter;
	const verb = verbsFor(adventure, def).find(
		(v) => (verbId === null || v.id === verbId) && (!encounter || v.inFight)
	);
	if (encounter) {
		if (!verb) return fail('not_your_turn', A.voice.notNow);
		if (!isTurnOf(encounter, me.id)) return fail('not_your_turn', notYourTurn(room, encounter));
		if (encounter.acted.has(me.id)) {
			return fail('not_your_turn', `${me.def.name} has already acted this turn.`);
		}
	}
	if (!verb) {
		return fail(
			'forbidden',
			state === 'disabled'
				? (def.disabledText ?? `The ${def.name.toLowerCase()} can't be used.`)
				: `There's nothing more to do with the ${def.name.toLowerCase()}.`
		);
	}
	const name = me.def.name;
	const carrier = adventure.carried.get(def.id);
	if (carrier !== undefined) {
		if (carrier !== me.id) return fail('forbidden', 'Someone else is carrying that.');
	} else if (!canReach(obstacles(room), me.token.pos, cells)) {
		return fail('out_of_reach', `Move ${name} next to it first.`);
	}
	if (verb.needs && adventure.carried.get(verb.needs) !== me.id) {
		const needed = objectDef(A, verb.needs)?.name.toLowerCase() ?? 'something';
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
				log: [check.entry, say(room, A.voice.nothingFound, undefined, only(actor.id))]
			};
		}
		checked = [check.entry];
	}
	if (moving?.ok) moving.apply();
	if (verb.to) setObjectState(room, adventure, def, verb.to);
	let outcome = respond(room, adventure, def, verb, before, me, actor);
	const shown = motionFor(def, verb);
	if (shown) outcome = merge({ log: [], motions: [shown] }, outcome);
	if (verb.triggers) outcome = merge(outcome, startMechanism(room, adventure, verb.triggers));
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
			return { ok: false, message: `There’s no room behind ${me.def.name} to pull.` };
		}
	}
	if (!fits(room, prop, moved, physical === 'pull' ? me.token.id : null)) {
		return { ok: false, message: content(adventure).voice.blocked.replace('{name}', name) };
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
		room.terrain,
		room.floor
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
// Mechanisms: chains of changes, played out step by step

/** Sets a mechanism going: its first step now, the rest scheduled by the game server. */
function startMechanism(room: Room, adventure: AdventureState, id: string): Outcome {
	if (adventure.running.has(id) || !content(adventure).mechanisms[id]) return { log: [] };
	adventure.running.set(id, 0);
	return runSteps(room, adventure, id);
}

/**
 * Runs a mechanism's next step, if it is still waiting for that step at this
 * table (a stale or repeated call does nothing), with any steps right after it.
 */
export function runMechanism(room: Room, id: string, step: number): Outcome | null {
	const adventure = room.adventure;
	if (!adventure || adventure.running.get(id) !== step) return null;
	if (content(adventure).mechanisms[id]?.location !== adventure.location) {
		adventure.running.delete(id);
		return null;
	}
	return runSteps(room, adventure, id);
}

function runSteps(room: Room, adventure: AdventureState, id: string): Outcome {
	const A = content(adventure);
	const steps = A.mechanisms[id].steps;
	let outcome: Outcome = { log: [] };
	let index = adventure.running.get(id) ?? 0;
	do {
		const step = steps[index];
		if (step.set) {
			const def = objectDef(A, step.set.object);
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
): { id: string; step: number; delay: number }[] {
	const A = content(adventure);
	return [...adventure.running].map(([id, step]) => ({
		id,
		step,
		delay: A.mechanisms[id]?.steps[step]?.after ?? 0
	}));
}

/** What happens in the story when a verb is done: a talk, or the verb's first rule that holds. */
function respond(
	room: Room,
	adventure: AdventureState,
	def: ObjectDef,
	verb: Verb,
	before: ObjectState,
	me: Played,
	actor: Player
): Outcome {
	if (verb.id === 'talk' && content(adventure).npcs[def.id])
		return talk(room, adventure, def.id, me.id);
	const rule = verb.does?.find((r) => holds(adventure, r.if, me.id, before));
	return rule ? run(room, adventure, rule.do, { actor, me }) : { log: [] };
}

// ---------------------------------------------------------------------------
// Conditions and effects: what the adventure's data says happens

/** Whether conditions hold now, for the character `who` and something in `state`. */
export function holds(
	adventure: AdventureState,
	when: When | undefined,
	who: string | null = null,
	state?: string
): boolean {
	if (!when) return true;
	const A = content(adventure);
	const has = (e: string) => adventure.events.includes(e);
	const found = (c: string) => adventure.evidence.has(c);
	if (when.state && (state === undefined || !when.state.includes(state))) return false;
	// People react to what the one talking to them knows.
	if (when.clues && !when.clues.every((c) => knows(adventure, who, c))) return false;
	if (when.found && !when.found.every(found)) return false;
	if (when.unfound && when.unfound.some(found)) return false;
	if (when.events && !when.events.every(has)) return false;
	if (when.not && when.not.some(has)) return false;
	if (when.pending && adventure.pending !== when.pending) return false;
	for (const [id, states] of Object.entries(when.objects ?? {})) {
		const def = objectDef(A, id);
		if (!def || !states.includes(objectState(adventure, def))) return false;
	}
	if (when.chapter && !when.chapter.includes(adventure.chapter)) return false;
	if (when.said && !when.said.every((s) => adventure.said.has(s))) return false;
	if (when.unsaid && when.unsaid.some((s) => adventure.said.has(s))) return false;
	for (const [id, option] of Object.entries(when.chose ?? {})) {
		if (adventure.decisions.get(id)?.option !== option) return false;
	}
	if (when.phase !== undefined && adventure.encounter?.finale !== when.phase) return false;
	for (const [id, fight] of Object.entries(when.fights ?? {})) {
		if ((adventure.encounters.get(id) ?? 'none') !== fight) return false;
	}
	return true;
}

/** Who effects are done by, if anyone: the player and their character. */
interface Doer {
	actor?: Player;
	me?: Played;
	now?: number;
}

/** Does effects, in order, and returns what the table should hear and see. */
export function run(
	room: Room,
	adventure: AdventureState,
	effects: readonly Effect[],
	by: Doer = {}
): Outcome {
	let outcome: Outcome = { log: [] };
	const add = (next: Outcome) => (outcome = merge(outcome, next));
	const tell = (...log: ChatMessage[]) => add({ log });
	const now = by.now ?? Date.now();
	const A = content(adventure);
	for (const effect of effects) {
		if ('say' in effect) {
			const audience = effect.private && by.actor ? only(by.actor.id) : undefined;
			const line =
				effect.cue === 'flash'
					? flare(room, effect.say)
					: effect.cue === 'toll'
						? toll(room, effect.say)
						: say(room, effect.say, effect.speaker, audience);
			tell(effect.shot ? shoot(line, effect.shot) : line);
		} else if ('clue' in effect) {
			// What a character finds by investigating is theirs until they share it.
			const def = A.clues[effect.clue];
			if (by.me && by.actor) {
				if (def) tell(say(room, def.text, undefined, only(by.actor.id)));
				add(addClue(room, adventure, effect.clue, { id: by.me.id, playerId: by.actor.id }));
			} else {
				if (def) tell(say(room, def.text));
				add(addClue(room, adventure, effect.clue, null));
			}
		} else if ('tell' in effect) {
			add(addClue(room, adventure, effect.tell, null));
		} else if ('event' in effect) {
			add(happen(room, adventure, effect.event, now));
		} else if ('set' in effect) {
			const def = objectDef(A, effect.set);
			if (!def || (effect.if && objectState(adventure, def) !== effect.if)) continue;
			setObjectState(room, adventure, def, effect.to === 'initial' ? def.initial : effect.to);
		} else if ('npc' in effect) {
			adventure.npcs.set(effect.npc, effect.becomes);
		} else if ('offer' in effect) {
			add(offer(room, adventure, effect.offer));
		} else if ('fight' in effect) {
			add(startEncounter(room, adventure, effect.fight));
		} else if ('enter' in effect) {
			add(enter(room, adventure, effect.enter, now));
		} else if ('post' in effect) {
			postSentries(room, adventure, effect.post);
		} else if ('settle' in effect) {
			settlePeople(room, adventure);
		} else if ('reveal' in effect) {
			if (effect.reveal === 'all') room.fog.revealed.fill(1);
			else {
				const { from, to } = effect.reveal;
				for (const i of rectCells(room.grid, from, to)) room.fog.revealed[i] = 1;
			}
		} else if ('explore' in effect) {
			const area = effect.explore;
			const cells = area === 'all' ? null : rectCells(room.grid, area.from, area.to);
			for (const p of room.players.values()) {
				if (p.role === 'gm') continue;
				if (!cells) p.explored.fill(1);
				else for (const i of cells) p.explored[i] = 1;
			}
		} else if ('motion' in effect) {
			const { prop, kind, sound } = effect.motion;
			add({ log: [], motions: [{ propId: prop, kind, sound }] });
		} else if ('heal' in effect) {
			tell(...tend(room, adventure, effect.heal));
		} else if ('detect' in effect) {
			const spotted = detect(room, adventure);
			if (spotted) add(spotted);
		} else if ('remember' in effect) {
			adventure.said.add(effect.remember);
		} else if ('reward' in effect) {
			if (adventure.rewards.includes(effect.reward)) continue;
			adventure.rewards.push(effect.reward);
			tell(postSystem(room, `The party earned: ${effect.reward}.`));
		} else if ('count' in effect) {
			add(count(room, adventure, effect.count, effect.else));
		} else if ('phase' in effect) {
			const encounter = adventure.encounter;
			if (encounter) {
				encounter.finale = effect.phase;
				encounter.pulls = 0;
				encounter.pulled = false;
			}
		} else if ('hazard' in effect) {
			const encounter = adventure.encounter;
			if (encounter) tell(...openHazard(room, adventure, encounter));
		} else if ('light' in effect) {
			const light = room.lights.get(effect.light);
			if (!light) continue;
			if (effect.on !== undefined) light.on = effect.on;
			if (effect.color !== undefined) light.color = effect.color;
			if (effect.radius !== undefined) light.radius = effect.radius;
		} else if ('prop' in effect) {
			const prop = room.props.get(effect.prop);
			if (prop) prop.assetId = effect.asset;
		} else if ('ambient' in effect) {
			room.ambient = effect.ambient;
		} else if ('hurt' in effect) {
			const def = objectDef(A, effect.hurt.near);
			const cells = (def && objectCells(room, def)) ?? [];
			const dice = diceOf(room);
			for (const c of standing(room, adventure)) {
				if (!cells.some((b) => gridDistance(b, c.token.pos) <= effect.hurt.within)) continue;
				const text = effect.hurt.text.replace('{name}', c.def.name);
				tell(hurt(room, c, roll(effect.hurt.dice, dice).total, text));
			}
		} else if ('spawn' in effect) {
			const encounter = adventure.encounter;
			const cell = effect.spawn.at.find((c) => isFree(room, c));
			const def = A.enemies[effect.spawn.kind];
			if (!encounter || !cell || !def) continue;
			const token = enemyToken(A, effect.spawn.kind, cell);
			room.tokens.set(token.id, token);
			const hp = def.hp(standing(room, adventure).length);
			encounter.enemies.set(token.id, {
				kind: effect.spawn.kind,
				hp,
				maxHp: hp,
				statuses: new Map(),
				rest: 0
			});
			encounter.order.push({ kind: 'enemy', tokenId: token.id, initiative: 0 });
			tell(say(room, effect.spawn.text));
		} else if ('rules' in effect) {
			const rule = effect.rules.find((r) => holds(adventure, r.if, by.me?.id ?? null));
			if (rule) add(run(room, adventure, rule.do, by));
		}
	}
	return outcome;
}

// ---------------------------------------------------------------------------
// People: talking, reacting, and where they stand

/**
 * Talking to someone: they say the first of their lines that applies, which
 * may give a clue, change how they feel, move the story on or tend wounds.
 */
function talk(room: Room, adventure: AdventureState, id: string, who: string): Outcome {
	const npc = content(adventure).npcs[id];
	const state = adventure.npcs.get(id) ?? npc.states[0];
	const line = npc.lines.find(
		(l) => !(l.once && adventure.said.has(`${id}:${l.id}`)) && holds(adventure, l.if, who, state)
	);
	if (!line) return { log: [] };
	adventure.said.add(`${id}:${line.id}`);
	let outcome: Outcome = {
		log: [line.narrated ? say(room, line.text) : say(room, line.text, npc.speaker)]
	};
	// Said aloud: the whole party hears it.
	if (line.clue) outcome = merge(outcome, addClue(room, adventure, line.clue, null));
	if (line.becomes) adventure.npcs.set(id, line.becomes);
	if (line.heals) outcome = merge(outcome, { log: tend(room, adventure, line.heals) });
	return line.event ? merge(outcome, happen(room, adventure, line.event)) : outcome;
}

/** How far away looking around notices something there to be noticed. */
const NOTICE_RANGE = 8;

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
	const A = content(adventure);
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	if (adventure.stage !== 'playing') return fail('forbidden', 'This story is over.');
	if (adventure.encounter) return fail('not_your_turn', A.voice.notNow);
	const blocked = obstacles(room);
	const signs = A.signs.filter(
		(s) =>
			s.location === adventure.location &&
			s.sense === what &&
			gridDistance(me.token.pos, s.at) <= s.range &&
			hasLineOfSight(blocked, me.token.pos, s.at) &&
			!knows(adventure, me.id, s.clue) &&
			!adventure.tried.has(`${me.id}:sign:${s.id}`)
	);
	const verb = INVESTIGATION_ACTIONS[what];
	// Looking around, a character notices what is there to be noticed (a newcomer's first find).
	const noticed = A.objects.flatMap((def) => {
		if (what !== 'observe' || !def.noticed || def.location !== adventure.location) return [];
		if (shownState(adventure, def) !== 'interactable') return [];
		if (def.firstFind && knows(adventure, me.id, def.firstFind)) return [];
		const seen = (objectCells(room, def) ?? []).some(
			(c) =>
				gridDistance(me.token.pos, c) <= NOTICE_RANGE && hasLineOfSight(blocked, me.token.pos, c)
		);
		return seen ? [say(room, def.noticed, undefined, only(actor.id))] : [];
	});
	if (signs.length === 0) {
		if (noticed.length) return { ok: true, log: noticed };
		const nothing = what === 'listen' ? A.voice.hearNothing : A.voice.seeNothing;
		return { ok: true, log: [say(room, nothing, undefined, only(actor.id))] };
	}
	const log: ChatMessage[] = [...noticed];
	for (const s of signs) {
		const check = rollCheck(room, actor, me, verb, s.check, roller);
		log.push(check.entry);
		if (!check.success) {
			adventure.tried.add(`${me.id}:sign:${s.id}`);
			log.push(say(room, A.voice.cantMakeOut, undefined, only(actor.id)));
			continue;
		}
		const clue = A.clues[s.clue];
		if (clue) log.push(say(room, clue.text, undefined, only(actor.id)));
		log.push(...addClue(room, adventure, s.clue, { id: me.id, playerId: actor.id }).log);
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
	const clue = content(adventure).clues[clueId];
	const by = me ? me.def.name : actor.name;
	const told = {
		log: [
			postSystem(room, `${by} shared evidence: ${clue?.title ?? clueId}.`),
			...(clue ? [say(room, clue.text)] : [])
		]
	};
	return { ok: true, ...merge(told, unlock(room, adventure, clueId)) };
}

/** Every standing character recovers up to `hp`. */
function tend(room: Room, adventure: AdventureState, hp: number): ChatMessage[] {
	const healed = standing(room, adventure).filter((c) => c.state.hp < c.def.hp);
	for (const c of healed) c.state.hp = Math.min(c.def.hp, c.state.hp + hp);
	if (healed.length === 0) return [];
	return [postSystem(room, `${healed.map((c) => c.def.name).join(', ')} recovered some HP.`)];
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
	const A = content(adventure);
	const log: ChatMessage[] = [];
	for (const r of A.reactions) {
		if (r.on !== on || adventure.said.has(`reaction:${r.id}`)) continue;
		const npc = A.npcs[r.npc];
		const token = npc?.location === adventure.location ? room.tokens.get(npc.token) : undefined;
		if (!npc || !token) continue;
		if (r.within !== undefined && near && gridDistance(token.pos, near) > r.within) continue;
		adventure.said.add(`reaction:${r.id}`);
		log.push(say(room, r.text, npc.speaker, audience));
	}
	return log;
}

/** People go where they belong now (the adventure's `peoplePlaces`: the first that holds, else calm). */
function settlePeople(room: Room, adventure: AdventureState): void {
	const A = content(adventure);
	const place = A.peoplePlaces.find((p) => holds(adventure, p.if))?.place ?? 'calm';
	for (const npc of Object.values(A.npcs)) {
		const token = npc.location === adventure.location ? room.tokens.get(npc.token) : undefined;
		if (!token) continue;
		const to = npc.places[place] ?? npc.places.calm;
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

/** The chapter `event` leads to from `chapter`: undefined if it doesn't end it, null if the story ends. */
export function transition(
	A: AdventureDef,
	chapter: string,
	event: string
): string | null | undefined {
	const next = A.chapters[chapter]?.next;
	return next && next.on === event ? next.to : undefined;
}

/** Whether a cell is in an area. */
const inside = (area: Area, pos: GridPos) =>
	pos.x >= area.from.x && pos.x <= area.to.x && pos.y >= area.from.y && pos.y <= area.to.y;

/** The area `pos` raises an event in, while the story waits for it there. */
function areaAt(adventure: AdventureState, pos: GridPos): AreaDef | undefined {
	return content(adventure).areas.find(
		(a) =>
			a.location === adventure.location &&
			a.during === adventure.chapter &&
			(!a.after || adventure.events.includes(a.after)) &&
			inside(a, pos)
	);
}

/**
 * Something happened in the story. Records it (once), does what it does to
 * the table, and moves on to the next chapter if the current one was waiting
 * for it.
 */
export function happen(
	room: Room,
	adventure: AdventureState,
	event: string,
	now = Date.now()
): Outcome {
	if (adventure.events.includes(event)) return { log: [] };
	adventure.events.push(event);
	const A = content(adventure);
	let outcome = run(room, adventure, A.events[event]?.does ?? [], { now });
	// An area that waited for this: someone already standing in it walks in now.
	for (const area of A.areas) {
		if (area.after !== event) continue;
		const there = played(room, adventure).some((c) => areaAt(adventure, c.token.pos) === area);
		if (there) outcome = merge(outcome, happen(room, adventure, area.event, now));
	}
	outcome = merge(outcome, { log: react(room, adventure, `event:${event}`) });
	const next = transition(A, adventure.chapter, event);
	if (next === undefined) return outcome;
	return merge(
		outcome,
		next === null ? end(room, adventure, now) : enter(room, adventure, next, now)
	);
}

/** The party moves into a chapter: to its table, if it is played elsewhere, and what opens it. */
function enter(room: Room, adventure: AdventureState, chapter: string, now: number): Outcome {
	const A = content(adventure);
	adventure.chapter = chapter;
	const def = A.chapters[chapter];
	let outcome: Outcome = {
		log: [postSystem(room, `Chapter ${chapterNumber(A, chapter)}: ${def.title}.`)]
	};
	if (def.location !== adventure.location) {
		travel(room, adventure, def.location);
		outcome.reset = true;
	}
	outcome = merge(outcome, run(room, adventure, def.opening ?? [], { now }));
	// The event this chapter waits for may already have happened (a GM
	// move, a save from an older build): move straight on.
	const waitingFor = def.next.on;
	if (adventure.chapter === chapter && adventure.events.includes(waitingFor)) {
		const next = transition(A, chapter, waitingFor);
		if (next) outcome = merge(outcome, enter(room, adventure, next, now));
		else if (next === null) outcome = merge(outcome, end(room, adventure, now));
	}
	return outcome;
}

/** Told to the table when a saved story is loaded back. */
export function resumeNotice(adventure: AdventureState): string {
	const A = content(adventure);
	const title = A.chapters[adventure.chapter].title;
	if (adventure.stage === 'complete') return `${A.title} is over here: ${title}.`;
	return `${A.title} continues. Chapter ${chapterNumber(A, adventure.chapter)}: ${title}.`;
}

export function chapterNumber(A: AdventureDef, chapter: string): number {
	return Object.keys(A.chapters).indexOf(chapter) + 1;
}

/**
 * Takes the party to another table: the new scene replaces the old one, and
 * every character in play arrives at its spawn with the same token, owner
 * and condition.
 */
function travel(room: Room, adventure: AdventureState, to: string): void {
	const A = content(adventure);
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
	applyScene(room, A.locations[to].scene());
	room.fog.shared = shared;
	adventure.location = to;
	adventure.sentries.clear();
	adventure.origins = recordOrigins(A, room);
	for (const [id, origin] of carried) adventure.origins.set(id, origin);
	for (const id of adventure.running.keys()) {
		if (A.mechanisms[id]?.location !== to) adventure.running.delete(id);
	}
	for (const def of objectsAt(A, to))
		applyLook(room, def, shownState(adventure, def), adventure.origins);
	for (const c of party) {
		if (!placeCharacter(room, A, to, c.id, c.ownerId, c.tokenId)) adventure.characters.delete(c.id);
	}
}

/** Puts a choice to the party. */
function offer(room: Room, adventure: AdventureState, id: string): Outcome {
	const def = content(adventure).decisions[id];
	if (!def || adventure.decisions.has(id)) return { log: [] };
	adventure.pending = id;
	return { log: [postSystem(room, `A choice: ${def.prompt}`)] };
}

/** The answer the story ends on: the deciding choice's, or the adventure's fallback. */
export function endingAnswer(adventure: AdventureState): string {
	const E = content(adventure).endings;
	const option = adventure.decisions.get(E.decision)?.option;
	return option && option in E.byAnswer ? option : E.fallback;
}

/**
 * The story has reached its ending: the one its deciding answer leads to,
 * with its own final scene on the table, narration and result, and the
 * session is complete.
 */
function end(room: Room, adventure: AdventureState, now: number): Outcome {
	const A = content(adventure);
	const answer = endingAnswer(adventure);
	const def = A.endings.byAnswer[answer];
	adventure.ending = def.ending;
	adventure.stage = 'complete';
	adventure.completedAt = now;
	let outcome: Outcome = { log: [say(room, def.text)] };
	for (const rule of def.lines ?? []) {
		if (holds(adventure, rule.if)) outcome = merge(outcome, run(room, adventure, rule.do, { now }));
	}
	outcome = merge(outcome, run(room, adventure, def.does ?? [], { now }));
	const name = A.endings.names[def.ending]?.title ?? def.ending;
	return merge(outcome, {
		log: [
			finalScene(room, adventure, def),
			postSystem(room, `${A.title}: ${name}. ${def.subtitle}.`)
		]
	});
}

/**
 * The table as the story leaves it: the ending has changed the place it ends
 * in, and now all of it is shown to everyone, with nothing left moving.
 * Returns the last narration, which plays the ending's cue.
 */
function finalScene(room: Room, adventure: AdventureState, ending: EndingDef): ChatMessage {
	// Nothing is left moving: the watch and whatever cracked or rose are gone.
	for (const id of adventure.sentries.keys()) room.tokens.delete(id);
	adventure.sentries.clear();
	const prefixes = hazardPrefixes(content(adventure));
	for (const id of [...room.props.keys()]) {
		if (prefixes.some((p) => id.startsWith(p))) room.props.delete(id);
	}
	room.fog.revealed.fill(1);
	return ending.cue === 'flash' ? flare(room, ending.scene) : toll(room, ending.scene);
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
	const A = content(adventure);
	const def = A.decisions[adventure.pending];
	const option = def.options.find((o) => o.id === optionId);
	if (!option) return fail('invalid_message', 'That is not one of the choices.');
	let by = actor.name;
	if (actor.role !== 'gm') {
		const me = characterOf(room, actor.id);
		if (!me) return fail('forbidden', 'Only a character in the story can choose.');
		const unable = unableReason(me);
		if (unable) return fail('forbidden', unable);
		by = me.def.name;
	}
	if (adventure.encounter) return fail('not_your_turn', A.voice.notNow);
	adventure.decisions.set(def.id, { option: option.id, by });
	adventure.pending = null;
	const log = [postSystem(room, `${by} chose: ${option.label}.`)];
	return { ok: true, ...merge({ log }, run(room, adventure, option.does, { actor, now })) };
}

/** How a choice reads now, given what the party did and knows. */
export function optionLabel(
	adventure: AdventureState,
	decision: string,
	option: { id: string; label: string }
): string {
	const def = content(adventure).decisions[decision]?.options.find((o) => o.id === option.id);
	return def?.labels?.find((l) => holds(adventure, l.if))?.label ?? option.label;
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
	const def = objectDef(content(adventure), objectId);
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

/** The GM's own fight: whoever the GM brought on, anywhere. */
const AMBUSH_DEF: EncounterDef = {
	name: 'The enemies you placed',
	location: null,
	ring: [],
	foes: []
};

/** A fight of the adventure's, or the GM's own. */
export function encounterDef(A: AdventureDef, id: string): EncounterDef | undefined {
	return id === AMBUSH ? AMBUSH_DEF : A.encounters[id];
}

/** Every fight there can be: the adventure's, then the GM's own. */
export function encounterIds(A: AdventureDef): string[] {
	return [...Object.keys(A.encounters), AMBUSH];
}

/** The rules of the phase a fight is in, if it has phases. */
function phaseOf(A: AdventureDef, encounter: Encounter): PhaseDef | undefined {
	return encounter.finale
		? encounterDef(A, encounter.id)?.phases?.all[encounter.finale]
		: undefined;
}

/** The enemy's token, as it stands on the table. */
function enemyToken(A: AdventureDef, kind: string, pos: GridPos): Token {
	const def = A.enemies[kind];
	return {
		id: randomUUID(),
		name: def.name,
		color: def.color,
		pos: { ...pos },
		ownerId: null,
		vision: def.vision,
		light: def.light,
		model: def.model
	};
}

/**
 * Puts a fight's sentries on the table: they walk their rounds (`patrol`)
 * or stand guard until one of them spots a character (`detect`), and then
 * the fight begins with them.
 */
export function postSentries(room: Room, adventure: AdventureState, id: string): void {
	const A = content(adventure);
	for (const sentry of encounterDef(A, id)?.sentries ?? []) {
		const at = sentry.route.find((c) => isFree(room, c));
		if (!at) continue;
		const token = enemyToken(A, sentry.kind, at);
		room.tokens.set(token.id, token);
		adventure.sentries.set(token.id, {
			kind: sentry.kind,
			encounter: id,
			route: sentry.route.map((c) => ({ ...c })),
			leg: 0
		});
	}
}

/** What the enemies see: the table's obstacles and light, the standing party, what they guard. */
function situationFor(room: Room, adventure: AdventureState, selfId: string): Situation {
	const A = content(adventure);
	const blocked = obstacles(room);
	const lit = lightFor(room, blocked);
	const wardDef = A.ward && objectDef(A, A.ward.object);
	const wardCells = wardDef && objectCells(room, wardDef);
	return {
		grid: room.grid,
		blocked,
		lit,
		foes: standing(room, adventure).map((c) => ({ id: c.id, pos: c.token.pos, hp: c.state.hp })),
		free: (c) => isFree(room, c, blocked, selfId),
		ward:
			A.ward && wardDef && wardCells?.length
				? { cells: wardCells, touched: objectState(adventure, wardDef) === A.ward.touched }
				: null,
		enemies: A.enemies
	};
}

/**
 * Outside a fight: every sentry takes a step on its round, then looks about.
 * Run by the game server on a slow timer. Null when nothing moved.
 */
export function patrol(room: Room): Outcome | null {
	const adventure = room.adventure;
	if (!adventure || adventure.encounter || adventure.stage !== 'playing' || room.paused)
		return null;
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
	id: string,
	spotted?: { by: Token; who: Foe_ }
): Outcome {
	const A = content(adventure);
	const def = encounterDef(A, id);
	if (!def) return { log: [] };
	const party = standing(room, adventure);
	const spawn = A.locations[adventure.location].spawn;
	const enemies = new Map<string, EnemyState>();
	const more = (def.more ?? []).flatMap((m) => (holds(adventure, m.if) ? m.foes : []));
	for (const foe of [...def.foes, ...more]) {
		const kind = A.enemies[foe.kind];
		const cell = def.ring.find((c) => isFree(room, c)) ?? spawn.find((c) => isFree(room, c));
		if (!cell || !kind) break;
		const token = enemyToken(A, foe.kind, cell);
		room.tokens.set(token.id, token);
		const hp = (foe.hp ?? kind.hp)(party.length);
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
		const hp = A.enemies[sentry.kind].hp(party.length);
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
		const bonus = c.def.stats.agility;
		rolled.push({
			entry: { kind: 'character', id: c.id, initiative: roll(`1d20+${bonus}`, dice).total },
			name: c.def.name,
			bonus,
			order: rolled.length
		});
	}
	for (const [tokenId, enemy] of enemies) {
		const bonus = A.enemies[enemy.kind].initiative;
		const total = roll(bonus ? `1d20+${bonus}` : '1d20', dice).total;
		rolled.push({
			entry: { kind: 'enemy', tokenId, initiative: total },
			name: A.enemies[enemy.kind].name,
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
		turn: 1,
		...(def.phases ? { finale: def.phases.first, cracks: [], pulls: 0, pulled: false } : {})
	};
	adventure.encounter = encounter;
	if (def.reveal) {
		for (const i of rectCells(room.grid, def.reveal.from, def.reveal.to)) room.fog.revealed[i] = 1;
	}
	const log = [
		...(spotted
			? [
					say(
						room,
						`The ${spotted.by.name} spots ${A.characters[spotted.who.id]?.name ?? 'someone'}!`
					)
				]
			: []),
		...(def.opening
			? [def.shot ? shoot(say(room, def.opening), def.shot) : say(room, def.opening)]
			: []),
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
function isTurnOf(encounter: Encounter, id: string): boolean {
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
	const A = content(adventure);
	const log: ChatMessage[] = [];
	for (let tries = 0; tries <= encounter.order.length * 2; tries++) {
		encounter.current++;
		if (encounter.current >= encounter.order.length) {
			encounter.current = 0;
			encounter.round++;
			encounter.acted.clear();
			encounter.moved.clear();
			log.push(postSystem(room, `Round ${encounter.round}.`));
			if (encounter.finale) {
				log.push(...roundOfPhase(room, adventure, encounter));
				if (standing(room, adventure).length === 0) {
					return { log: [...log, ...defeat(room, adventure, encounter)] };
				}
			}
		}
		encounter.turn++;
		const entry = encounter.order[encounter.current];
		if (entry.kind === 'enemy') {
			if (!encounter.enemies.has(entry.tokenId) || !room.tokens.has(entry.tokenId)) continue;
			return { log, enemyTurn: encounter.turn };
		}
		const c = played(room, adventure).find((p) => p.id === entry.id);
		if (!c || c.state.dead) continue;
		const def = c.def;
		const slowed = c.state.statuses.has('slowed');
		tick(c.state.statuses);
		if (c.state.hp <= 0) {
			c.state.downedFor++;
			if (c.state.downedFor >= BLEED_OUT_ROUNDS) {
				c.state.dead = true;
				c.state.statuses.clear();
				log.push(say(room, A.voice.gone.replace('{name}', def.name)));
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
	return defenseFor(c.def.armor + (c.state.statuses.has('guarded') ? 2 : 0));
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
	const def = me.def;
	const action = actionOf(def, actionId);
	if (!action) return fail('invalid_message', `${def.name} can't do that.`);
	const unable = unableReason(me);
	if (unable) return fail('forbidden', unable);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	if (adventure.stage !== 'playing') return fail('forbidden', 'This story is over.');
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
		log = [attackEnemy(room, actor, me, action, encounter, enemy, target, roller)];
	} else if (action.target === 'ally') {
		const ally = targetId ? characterByToken(room, targetId) : null;
		if (!ally) return fail('token_not_found', 'Choose one of the party.');
		if (ally.state.dead) return fail('forbidden', `${ally.def.name} is beyond help.`);
		if (!inActionRange(blocked, me.token.pos, ally.token.pos, action)) {
			return fail('out_of_reach', `${ally.def.name} is out of reach.`);
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

/** Who is taking the current turn, by name ("the Hound" for an enemy). */
function turnName(room: Room, encounter: Encounter): string {
	const entry = turnOf(encounter);
	if (!entry) return 'nobody';
	if (entry.kind === 'character') {
		const adventure = room.adventure;
		return (adventure && content(adventure).characters[entry.id]?.name) ?? entry.id;
	}
	return `the ${room.tokens.get(entry.tokenId)?.name ?? 'enemy'}`;
}

/** Why it isn't this character's turn: whose it is. */
function notYourTurn(room: Room, encounter: Encounter): string {
	return `It's ${turnName(room, encounter)}'s turn.`;
}

function attackEnemy(
	room: Room,
	actor: Player,
	me: Played,
	action: Action,
	encounter: Encounter,
	enemy: EnemyState,
	target: Token,
	roller: DieRoller
): ChatMessage {
	const A = content(room.adventure!);
	const defense = defenseFor(A.enemies[enemy.kind].armor);
	const result = strike(toHitFor(me.def, action), action.dice ?? '1d4', defense, roller);
	let outcome: string | undefined;
	let effect: string | undefined;
	if (result.hit) enemy.lastHitBy = me.id;
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
		authorName: me.def.name,
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
	const maxHp = ally.def.hp;
	const before = ally.state.hp;
	ally.state.hp = Math.min(maxHp, before + rolled.total);
	ally.state.downedFor = 0;
	const name = ally.def.name;
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
	const place = (id: string) =>
		encounter?.order.findIndex((t) => t.kind === 'character' && t.id === id) ?? -1;
	for (const c of guarded) {
		const later = encounter && c.id !== me.id && place(c.id) > encounter.current;
		c.state.statuses.set(status.status, status.rounds + (later ? 1 : 0));
	}
	const names = guarded.map((c) => c.def.name);
	return appendLog(room, {
		kind: 'ability',
		authorId: actor.id,
		authorName: me.def.name,
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
	const done = cleared(room, adventure, encounter);
	if (done?.over) return merge({ log }, done.outcome);
	if (done) log = [...log, ...done.outcome.log];
	const spent = (encounter.moved.get(me.id) ?? 0) >= encounter.speed;
	if (encounter.acted.has(me.id) && spent)
		return merge({ log }, advance(room, adventure, encounter));
	return { log };
}

/** An enemy is gone from the fight and the table; a fight's first fallen may leave remains. */
function enemyDies(room: Room, encounter: Encounter, token: Token): void {
	encounter.enemies.delete(token.id);
	leaveOrder(encounter, token.id);
	room.tokens.delete(token.id);
	const adventure = room.adventure;
	adventure?.defeated.push(token.name);
	if (!adventure) return;
	const A = content(adventure);
	const remains = encounterDef(A, encounter.id)?.remains;
	const def = remains && objectDef(A, remains.object);
	if (!remains || !def || room.props.has(remains.prop)) return;
	room.props.set(remains.prop, {
		id: remains.prop,
		assetId: remains.asset,
		pos: { ...token.pos },
		rotation: 0,
		scale: 1
	});
	adventure.origins.set(def.id, { pos: { ...token.pos }, assetId: remains.asset, rotation: 0 });
	setObjectState(room, adventure, def, 'interactable');
}

/** The fight is won: the fallen get back up, and the story hears of it. */
function victory(room: Room, adventure: AdventureState): Outcome {
	const A = content(adventure);
	const encounter = adventure.encounter;
	const id = encounter?.id ?? AMBUSH;
	const won = encounterDef(A, id)?.won ?? {};
	adventure.encounter = null;
	adventure.encounters.set(id, 'won');
	const rounds = encounter?.round ?? 1;
	const log = [
		postSystem(room, `The fight is won in ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`)
	];
	if (won.text) log.push(say(room, won.text));
	const fallen = played(room, adventure).filter((c) => c.state.hp <= 0 && !c.state.dead);
	for (const c of fallen) {
		c.state.hp = 1;
		c.state.downedFor = 0;
	}
	if (fallen.length) log.push(say(room, A.voice.revive));
	for (const c of played(room, adventure)) {
		c.state.statuses.clear();
		c.state.uses.clear();
	}
	let outcome = merge({ log }, run(room, adventure, won.does ?? []));
	if (won.event) outcome = merge(outcome, happen(room, adventure, won.event));
	return outcome;
}

/** Every character is down or dead: the fight, and the story, are lost. */
function defeat(
	room: Room,
	adventure: AdventureState,
	encounter: Encounter,
	now = Date.now()
): ChatMessage[] {
	adventure.encounters.set(encounter.id, 'lost');
	adventure.encounter = null;
	adventure.stage = 'defeat';
	adventure.completedAt = now;
	return [say(room, content(adventure).voice.defeat)];
}

/**
 * In a fight, the turn of a character whose player isn't at the table (their
 * connection dropped, or nobody plays it): the game server gives them a
 * while to come back, then `passAwayTurn`. Null when it isn't such a turn.
 */
export function awayTurn(room: Room, isHere: (playerId: string) => boolean): number | null {
	const adventure = room.adventure;
	const encounter = adventure?.encounter;
	const entry = turnOf(encounter ?? null);
	if (!adventure || !encounter || entry?.kind !== 'character' || adventure.stage !== 'playing') {
		return null;
	}
	const state = adventure.characters.get(entry.id);
	const owner = state && room.tokens.get(state.tokenId)?.ownerId;
	return owner && isHere(owner) ? null : encounter.turn;
}

/** The turn of a character whose player is away passes on (a stale `turn` does nothing). */
export function passAwayTurn(room: Room, turn: number): Outcome | null {
	const adventure = room.adventure;
	const encounter = adventure?.encounter;
	const entry = turnOf(encounter ?? null);
	if (!adventure || !encounter || encounter.turn !== turn || entry?.kind !== 'character')
		return null;
	const name = content(adventure).characters[entry.id]?.name ?? entry.id;
	const log = [postSystem(room, `${name}'s player is away; their turn passes.`)];
	return merge({ log }, advance(room, adventure, encounter));
}

/** The enemy whose turn the game server should run, if it is an enemy's turn (after loading a save). */
export function pendingEnemyTurn(adventure: AdventureState): number | null {
	const encounter = adventure.encounter;
	return turnOf(encounter)?.kind === 'enemy' ? encounter!.turn : null;
}

/**
 * An enemy takes its turn: burning eats at it, its statuses count down, and
 * it acts as its kind does (see ai.ts). Then the turn passes on, or the
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
			const done = cleared(room, adventure, encounter);
			if (done?.over) return merge({ log }, done.outcome);
			return merge(
				{ log },
				merge(done?.outcome ?? { log: [] }, advance(room, adventure, encounter))
			);
		}
	}
	const kind = content(adventure).enemies[enemy.kind];
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
	const who = (id: string) => played(room, adventure).find((c) => c.id === id);
	const deed = decided.deed;
	if (decided.note === 'turns on' && decided.target) {
		log.push(
			say(room, `The ${token.name} turns on ${who(decided.target)?.def.name ?? 'someone'}.`)
		);
	} else if (decided.note) {
		log.push(say(room, `The ${token.name} ${decided.note}.`));
	}
	if (deed?.kind === 'attack') {
		const target = who(deed.target);
		if (target) log.push(enemyAttack(room, token, deed.attack, target, roller));
	} else if (deed?.kind === 'toll') {
		const toll = content(adventure).enemies[enemy.kind].toll;
		const targets = deed.targets.flatMap((id) => who(id) ?? []);
		if (toll && targets.length) {
			enemy.rest = toll.every;
			log.push(tollOn(room, token, targets, toll, roller), flare(room, toll.flash));
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
	const defense = characterDefense(target);
	const result = strike(attack.toHit, attack.damage, defense, roller);
	let outcome: string | undefined;
	if (result.damage) {
		target.state.hp = Math.max(0, target.state.hp - result.damage.total);
		if (target.state.hp === 0) {
			target.state.downedFor = 0;
			outcome = `${target.def.name} falls!`;
		}
	}
	return appendLog(room, {
		kind: 'attack',
		authorId: token.id,
		authorName: token.name,
		attack: attack.name,
		targetId: target.token.id,
		targetName: target.def.name,
		toHit: result.toHit,
		defense,
		hit: result.hit,
		damage: result.damage,
		...(outcome ? { outcome } : {})
	});
}

/** A toll: everyone close by takes the damage and is slowed on their next turn. */
function tollOn(
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
			fell.push(t.def.name);
		} else t.state.statuses.set('slowed', toll.rounds);
	}
	const names = near.map((t) => t.def.name);
	return appendLog(room, {
		kind: 'ability',
		authorId: token.id,
		authorName: token.name,
		ability: 'Toll',
		targetId: near.length === 1 ? near[0].token.id : null,
		targetName: near.length === 1 ? names[0] : null,
		roll: rolled,
		amount: -rolled.total,
		text: `${toll.text} ${names.join(', ')} ${near.length === 1 ? 'takes' : 'each take'} ${rolled.total} and ${near.length === 1 ? 'is' : 'are'} slowed.${fell.length ? ` ${fell.join(', ')} ${fell.length === 1 ? 'falls' : 'fall'}!` : ''}`
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
	const def = me.def;
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
	// A place is walked into between fights, never mid-fight (it could take the party elsewhere).
	const area = adventure.encounter ? undefined : areaAt(adventure, token.pos);
	const story = area ? happen(room, adventure, area.event, now) : { log: [] };
	// Walking into a sentry's sight starts its fight.
	const spotted = story.reset ? null : detect(room, adventure);
	return spotted ? merge(story, spotted) : story;
}

/** Why a door won't open for this actor, or null if it will. The GM can always force it. */
export function doorLock(room: Room, actor: Player, door: Door): string | null {
	const adventure = room.adventure;
	const def = adventure && objectForDoor(content(adventure), door.id);
	if (!adventure || !def || actor.role === 'gm') return null;
	return objectState(adventure, def) === 'disabled'
		? (def.disabledText ?? 'It will not open.')
		: null;
}

/** After a door was opened or closed: its world object follows. */
export function afterDoorToggle(room: Room, door: Door): void {
	const adventure = room.adventure;
	const def = adventure && objectForDoor(content(adventure), door.id);
	if (adventure && def) adventure.objects.set(def.id, door.open ? 'opened' : 'closed');
}

/** After the GM removed a token: a character leaves the story, an enemy leaves the fight. */
export function afterTokenDeleted(room: Room, tokenId: string, pos?: GridPos): Outcome {
	const adventure = room.adventure;
	if (!adventure) return { log: [] };
	const A = content(adventure);
	for (const [id, state] of adventure.characters) {
		if (state.tokenId !== tokenId) continue;
		adventure.characters.delete(id);
		// What it carried falls where it stood.
		for (const [itemId, by] of adventure.carried) {
			const def = objectDef(A, itemId);
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
		// (Not the GM's own: taking back an enemy the GM brought on clears nothing.)
		if (!left && !adventure.encounters.has(sentry.encounter) && sentry.encounter !== AMBUSH) {
			adventure.encounters.set(sentry.encounter, 'won');
			const event = encounterDef(A, sentry.encounter)?.won?.event;
			const clear = { log: [postSystem(room, 'The way is clear.')] };
			return event ? merge(clear, happen(room, adventure, event)) : clear;
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
		adventure.defeated.push(A.enemies[enemy.kind]?.name ?? enemy.kind);
		const done = cleared(room, adventure, encounter);
		if (done?.over) return done.outcome;
		if (done) {
			return merge(done.outcome, theirs ? advance(room, adventure, encounter) : { log: [] });
		}
	}
	if (standing(room, adventure).length === 0) return { log: defeat(room, adventure, encounter) };
	// Whoever was taking their turn is gone: the turn passes on.
	return theirs ? advance(room, adventure, encounter) : { log: [] };
}

// ---------------------------------------------------------------------------
// Fights with phases: hazards underfoot, and a counter the party works toward

/**
 * No enemies left. Most fights are won; in a phase that says otherwise, an
 * event happens (the fight goes on), or the fight simply goes on. `over`
 * says whether the caller should stop there.
 */
function cleared(
	room: Room,
	adventure: AdventureState,
	encounter: Encounter
): { over: boolean; outcome: Outcome } | null {
	if (encounter.enemies.size > 0) return null;
	const phase = phaseOf(content(adventure), encounter);
	if (!phase?.cleared) return { over: true, outcome: victory(room, adventure) };
	if (phase.cleared === 'continue') return null;
	return { over: false, outcome: happen(room, adventure, phase.cleared.event) };
}

/**
 * A new round of a fight with phases: the hazard strikes whoever stayed on
 * it, then either the phase gives way to the next (its `until` round), or,
 * with a counter, what happens depends on whether anything counted this
 * round; then the hazard opens again under the party.
 */
function roundOfPhase(room: Room, adventure: AdventureState, encounter: Encounter): ChatMessage[] {
	const A = content(adventure);
	const phase = phaseOf(A, encounter);
	const log = strikeHazard(room, adventure, encounter);
	if (phase?.until && encounter.round >= phase.until.round) {
		log.push(...happen(room, adventure, phase.until.event).log);
	} else if (phase?.counter) {
		const effects = encounter.pulled ? phase.answered : phase.unanswered;
		log.push(...run(room, adventure, effects ?? []).log);
		encounter.pulled = false;
	}
	log.push(...openHazard(room, adventure, encounter));
	return log;
}

/** The hazard of the phase a fight is in. */
function hazardOf(A: AdventureDef, encounter: Encounter): HazardDef | undefined {
	return phaseOf(A, encounter)?.hazard;
}

/** Every hazard's prop id prefix, to clear them all. */
function hazardPrefixes(A: AdventureDef): string[] {
	return Object.values(A.encounters).flatMap((e) =>
		Object.values(e.phases?.all ?? {}).flatMap((p) => (p.hazard ? [p.hazard.prefix] : []))
	);
}

/** Whoever still stands on the hazard when it strikes is hurt, and it closes. */
function strikeHazard(room: Room, adventure: AdventureState, encounter: Encounter): ChatMessage[] {
	const cracks = encounter.cracks ?? [];
	const hazard = hazardOf(content(adventure), encounter);
	if (!cracks.length || !hazard) {
		clearHazard(room, adventure, encounter);
		return [];
	}
	const log = [say(room, hazard.heaves)];
	const on = (p: GridPos) => cracks.some((c) => c.x === p.x && c.y === p.y);
	for (const c of standing(room, adventure)) {
		if (!on(c.token.pos)) continue;
		const rolled = roll(hazard.damage, diceOf(room));
		log.push(hurt(room, c, rolled.total, hazard.caught.replace('{name}', c.def.name)));
	}
	clearHazard(room, adventure, encounter);
	return log;
}

/** The hazard opens under each standing character and the cells beside them. */
function openHazard(room: Room, adventure: AdventureState, encounter: Encounter): ChatMessage[] {
	const A = content(adventure);
	const hazard = hazardOf(A, encounter);
	if (!hazard) return [];
	const blocked = obstacles(room);
	const avoid = hazard.avoid ? objectDef(A, hazard.avoid) : undefined;
	const avoided = (avoid && objectCells(room, avoid)) ?? [];
	const cells: GridPos[] = [];
	const add = (c: GridPos) => {
		if (!inBounds(room.grid, c) || isSolidCell(blocked, c)) return;
		if (room.terrain && room.terrain[c.y * room.grid.width + c.x] === 0) return;
		if (avoided.some((b) => b.x === c.x && b.y === c.y)) return;
		if (!cells.some((o) => o.x === c.x && o.y === c.y)) cells.push(c);
	};
	for (const c of standing(room, adventure)) {
		const p = c.token.pos;
		for (const [dx, dy] of [
			[0, 0],
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1]
		]) {
			add({ x: p.x + dx, y: p.y + dy });
		}
	}
	encounter.cracks = cells;
	for (const c of cells) {
		const id = `${hazard.prefix}${c.x}-${c.y}`;
		room.props.set(id, { id, assetId: hazard.asset, pos: { ...c }, rotation: 0, scale: 1 });
	}
	return cells.length ? [say(room, hazard.opens)] : [];
}

/** The hazard closes: its props leave the table. */
function clearHazard(room: Room, adventure: AdventureState, encounter: Encounter): void {
	const prefixes = hazardPrefixes(content(adventure));
	for (const c of encounter.cracks ?? []) {
		for (const prefix of prefixes) room.props.delete(`${prefix}${c.x}-${c.y}`);
	}
	encounter.cracks = [];
}

/** Damage from the place itself (the floor, a great note); at 0 the character is down. */
function hurt(room: Room, c: Played, amount: number, what: string): ChatMessage {
	c.state.hp = Math.max(0, c.state.hp - amount);
	const down = c.state.hp === 0;
	if (down) c.state.downedFor = 0;
	return say(room, `${what}: ${amount} damage.${down ? ` ${c.def.name} falls!` : ''}`);
}

/** The counter of the phase a fight is in, if it has one. */
export function counterOf(
	adventure: AdventureState
): { label: string; count: number; of: number } | null {
	const encounter = adventure.encounter;
	const counter = encounter && phaseOf(content(adventure), encounter)?.counter;
	return counter && encounter
		? { label: counter.label, count: encounter.pulls ?? 0, of: counter.target }
		: null;
}

/**
 * One step toward the counter of the phase a fight is in (a pull on a rope):
 * the round is answered, and at its target the counter's effects happen, the
 * foes are gone, the hazard closes, and the fight is won. With no counter
 * running, `otherwise` is said.
 */
function count(room: Room, adventure: AdventureState, text: string, otherwise?: string): Outcome {
	const encounter = adventure.encounter;
	const counter = encounter && phaseOf(content(adventure), encounter)?.counter;
	if (!encounter || !counter) return { log: otherwise ? [say(room, otherwise)] : [] };
	encounter.pulls = (encounter.pulls ?? 0) + 1;
	encounter.pulled = true;
	const log = [say(room, `${text} (${encounter.pulls} of ${counter.target})`)];
	if (encounter.pulls < counter.target) return { log };
	let outcome = merge({ log }, run(room, adventure, counter.reached));
	for (const tokenId of [...encounter.enemies.keys()]) {
		encounter.enemies.delete(tokenId);
		room.tokens.delete(tokenId);
	}
	clearHazard(room, adventure, encounter);
	outcome = merge(outcome, victory(room, adventure));
	return outcome;
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
	const cue = content(adventure).cues.find((c) => c.id === cueId);
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
				log: [
					postSystem(
						room,
						`${actor.name} ended ${content(adventure).title}. The table stays as it is.`
					)
				]
			};
	}
}

/**
 * A player at the end screen asks the GM to play the story again: a notice
 * for the table, once per player per ending (the GM replays with "restart").
 */
export function askAgain(room: Room, actor: Player): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (adventure.stage !== 'complete' && adventure.stage !== 'defeat') {
		return fail('forbidden', 'The story is still going.');
	}
	if (actor.role !== 'player') return fail('forbidden', 'Only players ask to play again.');
	adventure.again ??= new Set();
	if (adventure.again.has(actor.id)) return { ok: true, log: [] };
	adventure.again.add(actor.id);
	return { ok: true, log: [postSystem(room, `${actor.name} would like to play again.`)] };
}

/**
 * Why `viewer` may not rate the library adventure this table played, or
 * null when they may: it is from the library, its story is over, they
 * played it (a player with a character, or the GM), and it isn't theirs.
 */
export function cannotRate(room: Room, viewer: Player): string | null {
	const adventure = room.adventure;
	const source = adventure?.library;
	if (!adventure || !source) return 'This adventure is not from the library.';
	if (adventure.stage !== 'complete' && adventure.stage !== 'defeat') {
		return 'Rate it once the story is over.';
	}
	if (viewer.role === 'spectator') return 'Only those who played it rate it.';
	if (viewer.role === 'player' && !characterOf(room, viewer.id)) {
		return 'Only those who played it rate it.';
	}
	if (viewer.role === 'gm' && room.gmOwner && creatorIdOf(room.gmOwner) === source.creator.id) {
		return 'You made this adventure.';
	}
	return null;
}

/** Starts the story over at its first table; everyone keeps their character, back at the start at full health. */
function restart(room: Room, adventure: AdventureState, actor: Player, now: number): Outcome {
	const A = content(adventure);
	const keep = played(room, adventure).map((c) => ({ id: c.id, ownerId: c.token.ownerId }));
	const begun = adventure.stage !== 'choosing';
	applyScene(room, A.locations[A.start.location].scene());
	const next = newState(A, room);
	for (const { id, ownerId } of keep) {
		const owner = ownerId && room.players.get(ownerId);
		const token = placeCharacter(
			room,
			A,
			next.location,
			id,
			owner && owner.role === 'player' ? owner.id : null
		);
		if (token) next.characters.set(id, newCharacter(token.id, A.characters[id]));
	}
	// The same adventure from the same place in the library, and what the table made of it.
	if (adventure.library) next.library = adventure.library;
	if (adventure.rated) next.rated = adventure.rated;
	room.adventure = next;
	const log = [postSystem(room, `${actor.name} started the story over.`)];
	if (!begun) return { reset: true, log };
	next.stage = 'playing';
	next.begunAt = now;
	return merge({ reset: true, log }, run(room, next, A.start.arrival, { now }));
}

/** GM: sets a character's hit points and statuses, or brings them back from the dead. */
export function override(room: Room, actor: Player, id: string, patch: CharacterPatch): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	const c = played(room, adventure).find((p) => p.id === id);
	const def = c?.def;
	if (!c || !def)
		return fail('token_not_found', `${def?.name ?? 'That character'} is not in play.`);
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

// ---------------------------------------------------------------------------
// Directing: the GM runs the story without building anything

/** GM: directs the story (see `Direction` in protocol.ts). */
export function direct(
	room: Room,
	actor: Player,
	direction: Direction,
	now = Date.now()
): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	if (actor.role !== 'gm') return GM_ONLY;
	if (adventure.stage === 'choosing') return fail('forbidden', 'Begin the story first.');
	if (adventure.stage !== 'playing') return fail('forbidden', 'This story is over.');
	switch (direction.op) {
		case 'event':
			return raise(room, adventure, actor, direction.event, now);
		case 'skip':
			return skip(room, adventure, actor, now);
		case 'encounter_start':
			return beginFight(room, adventure, actor, direction.encounter);
		case 'encounter_end':
			return endFight(room, adventure, actor, direction.result, now);
		case 'spawn':
			return spawn(room, adventure, actor, direction.kind, direction.pos);
	}
}

/** The events the GM may still make happen, and the fights that can start where the party is. */
export function directorOptions(room: Room, adventure: AdventureState): DirectorView {
	const A = content(adventure);
	const encounter = adventure.encounter;
	const foes = [
		...[...(encounter?.enemies ?? [])].map(([tokenId, e]) => ({
			tokenId,
			name: A.enemies[e.kind]?.name ?? e.kind,
			hp: e.hp,
			maxHp: e.maxHp
		})),
		...[...adventure.sentries].map(([tokenId, s]) => ({
			tokenId,
			name: A.enemies[s.kind]?.name ?? s.kind,
			hp: null,
			maxHp: null
		}))
	].filter((f) => room.tokens.has(f.tokenId));
	const people = Object.values(A.npcs).flatMap((npc) => {
		const token = npc.location === adventure.location ? room.tokens.get(npc.token) : undefined;
		return token ? [{ tokenId: token.id, name: npc.name }] : [];
	});
	return {
		foes,
		people,
		events: Object.entries(A.events)
			.filter(([id]) => !adventure.events.includes(id))
			.map(([id, e]) => ({ id, label: e.label })),
		encounters: encounterIds(A).flatMap((id) => {
			const def = encounterDef(A, id)!;
			if (def.location !== null && def.location !== adventure.location) return [];
			return [{ id, name: def.name, state: adventure.encounters.get(id) ?? null }];
		}),
		enemies: Object.entries(A.enemies).map(([kind, e]) => ({ kind, name: e.name })),
		skip: skipTo(adventure)
	};
}

/** The event a fight's phase raises when its foes are down, if it raises one. */
function clearedEvent(A: AdventureDef, encounter: Encounter): string | null {
	const cleared = phaseOf(A, encounter)?.cleared;
	return cleared && cleared !== 'continue' ? cleared.event : null;
}

/** Where skipping leads from here, or null when it can't. */
function skipTo(adventure: AdventureState): string | null {
	if (adventure.stage !== 'playing') return null;
	const A = content(adventure);
	const encounter = adventure.encounter;
	if (encounter) {
		const event = clearedEvent(A, encounter);
		const to = event ? transition(A, adventure.chapter, event) : undefined;
		if (to) return A.chapters[to].title;
		return `Win the fight (${encounterDef(A, encounter.id)?.name ?? encounter.id})`;
	}
	if (adventure.pending) return null;
	const next = A.chapters[adventure.chapter].next.to;
	return next ? A.chapters[next].title : 'The ending';
}

/** The GM makes something in the story happen, as if the party had done it. */
function raise(
	room: Room,
	adventure: AdventureState,
	actor: Player,
	event: string,
	now: number
): Outcomes {
	const def = Object.hasOwn(content(adventure).events, event)
		? content(adventure).events[event]
		: undefined;
	if (!def) return fail('invalid_message', 'There is no such event in this story.');
	if (adventure.events.includes(event)) return fail('forbidden', 'That has already happened.');
	const log = [postSystem(room, `${actor.name} made it happen: ${def.label}.`, 'gm')];
	return { ok: true, ...merge({ log }, settleAndHappen(room, adventure, event, now)) };
}

/**
 * An event raised by the GM that a fight would have raised (a beast beaten,
 * say): that fight counts as won, and its enemies leave the table.
 */
function settleAndHappen(
	room: Room,
	adventure: AdventureState,
	event: string,
	now: number
): Outcome {
	const A = content(adventure);
	for (const id of Object.keys(A.encounters)) {
		if (A.encounters[id].won?.event !== event || adventure.encounters.get(id) === 'won') continue;
		const encounter = adventure.encounter;
		if (encounter?.id === id) {
			for (const tokenId of encounter.enemies.keys()) room.tokens.delete(tokenId);
			clearHazard(room, adventure, encounter);
			adventure.encounter = null;
		}
		for (const [tokenId, sentry] of [...adventure.sentries]) {
			if (sentry.encounter !== id) continue;
			adventure.sentries.delete(tokenId);
			room.tokens.delete(tokenId);
		}
		if (adventure.encounters.has(id) || encounter?.id === id) adventure.encounters.set(id, 'won');
	}
	return happen(room, adventure, event, now);
}

/**
 * On to the next scene. In a fight, the fight is won (or, in a phase whose
 * foes down would raise an event, that event happens); otherwise the event
 * the chapter waits for happens. A choice put to the party must be answered
 * first.
 */
function skip(room: Room, adventure: AdventureState, actor: Player, now: number): Outcomes {
	const encounter = adventure.encounter;
	if (!encounter && adventure.pending) {
		return fail('forbidden', 'The party has a choice to make first: answer it, or let them.');
	}
	const log = [postSystem(room, `${actor.name} skipped ahead.`)];
	const event = encounter && clearedEvent(content(adventure), encounter);
	if (event) return { ok: true, ...merge({ log }, happen(room, adventure, event, now)) };
	if (encounter) return { ok: true, ...merge({ log }, winFight(room, adventure, encounter, now)) };
	const next = content(adventure).chapters[adventure.chapter].next.on;
	return { ok: true, ...merge({ log }, settleAndHappen(room, adventure, next, now)) };
}

/** The fight is over and the party has won it: its enemies fall, and the story goes on. */
function winFight(
	room: Room,
	adventure: AdventureState,
	encounter: Encounter,
	now: number
): Outcome {
	// A phase whose foes down would raise an event raises it first (the Bell starts ringing).
	const event = clearedEvent(content(adventure), encounter);
	let outcome: Outcome = event ? happen(room, adventure, event, now) : { log: [] };
	for (const tokenId of [...encounter.enemies.keys()]) {
		const token = room.tokens.get(tokenId);
		if (token) enemyDies(room, encounter, token);
		else encounter.enemies.delete(tokenId);
	}
	clearHazard(room, adventure, encounter);
	outcome = merge(outcome, victory(room, adventure));
	return outcome;
}

/** Whether a fight has anyone to fight: foes of its own, or sentries of it on the table. */
function hasFoes(room: Room, adventure: AdventureState, id: string): boolean {
	return (
		(encounterDef(content(adventure), id)?.foes.length ?? 0) > 0 ||
		[...adventure.sentries].some(([tokenId, s]) => s.encounter === id && room.tokens.has(tokenId))
	);
}

/** The GM starts one of the story's fights (or the GM's own, with the enemies on the table). */
function beginFight(room: Room, adventure: AdventureState, actor: Player, id: string): Outcomes {
	const A = content(adventure);
	const def = encounterIds(A).includes(id) ? encounterDef(A, id) : undefined;
	if (!def) return fail('invalid_message', 'There is no such fight in this story.');
	if (adventure.encounter) return fail('forbidden', 'A fight is already on.');
	const where = def.location;
	if (where && where !== adventure.location) {
		return fail('forbidden', `That fight is fought at ${A.locations[where].name}.`);
	}
	if (standing(room, adventure).length === 0) {
		return fail('forbidden', 'Nobody in the party is standing to fight.');
	}
	if (!hasFoes(room, adventure, id)) {
		return fail('forbidden', 'There is nobody to fight: bring on some enemies first.');
	}
	const log = [postSystem(room, `${actor.name} started a fight.`)];
	return { ok: true, ...merge({ log }, startEncounter(room, adventure, id)) };
}

/**
 * The GM ends the fight: won (as if the party had beaten every enemy) or
 * called off (the enemies leave the table, and the fight can be started
 * again). Either way the fallen get back up.
 */
function endFight(
	room: Room,
	adventure: AdventureState,
	actor: Player,
	result: 'won' | 'called_off',
	now: number
): Outcomes {
	const encounter = adventure.encounter;
	if (!encounter) return fail('forbidden', 'There is no fight to end.');
	if (result === 'won') {
		const log = [postSystem(room, `${actor.name} ended the fight: the party wins.`)];
		return { ok: true, ...merge({ log }, winFight(room, adventure, encounter, now)) };
	}
	const log = [postSystem(room, `${actor.name} called off the fight.`)];
	for (const tokenId of encounter.enemies.keys()) room.tokens.delete(tokenId);
	clearHazard(room, adventure, encounter);
	const undo = encounterDef(content(adventure), encounter.id)?.calledOff ?? [];
	adventure.encounter = null;
	adventure.encounters.delete(encounter.id);
	for (const c of played(room, adventure)) {
		if (c.state.hp <= 0 && !c.state.dead) {
			c.state.hp = 1;
			c.state.downedFor = 0;
		}
		c.state.statuses.clear();
		c.state.uses.clear();
	}
	return { ok: true, ...merge({ log }, run(room, adventure, undo, { now })) };
}

/**
 * The GM brings on an enemy. In a fight it joins at once, rolling its
 * initiative, and acts this round if it beat whoever is still to go. Outside
 * one it stands guard where it was put, and the fight (the GM's own) begins
 * when it spots someone, unless the game is paused.
 */
function spawn(
	room: Room,
	adventure: AdventureState,
	actor: Player,
	kind: string,
	pos: GridPos
): Outcomes {
	const A = content(adventure);
	const def = Object.hasOwn(A.enemies, kind) ? A.enemies[kind] : undefined;
	if (!def) return fail('invalid_message', 'There is no such enemy in this story.');
	if (!inBounds(room.grid, pos)) return fail('invalid_position', 'That cell is off the table.');
	if (!isFree(room, pos)) return fail('cell_occupied', 'Something is already there.');
	const log = [postSystem(room, `${actor.name} brought on ${def.name}.`, 'gm')];
	const token = enemyToken(A, kind, pos);
	room.tokens.set(token.id, token);
	const encounter = adventure.encounter;
	if (!encounter) {
		adventure.sentries.set(token.id, { kind, encounter: AMBUSH, route: [{ ...pos }], leg: 0 });
		// Placed ones may be looked for again: the GM's fight is fought as often as the GM likes.
		if (adventure.encounters.get(AMBUSH) !== 'active') adventure.encounters.delete(AMBUSH);
		const spotted = room.paused ? null : detect(room, adventure);
		return { ok: true, ...(spotted ? merge({ log }, spotted) : { log }) };
	}
	const party = standing(room, adventure);
	const hp = def.hp(party.length);
	const nearest = party.reduce<Played | null>(
		(a, b) => (!a || gridDistance(pos, b.token.pos) < gridDistance(pos, a.token.pos) ? b : a),
		null
	);
	encounter.enemies.set(token.id, {
		kind,
		hp,
		maxHp: hp,
		statuses: new Map(),
		rest: 0,
		post: { ...pos },
		...(nearest ? { lastSeen: { ...nearest.token.pos } } : {})
	});
	const initiative = roll(def.initiative ? `1d20+${def.initiative}` : '1d20', diceOf(room)).total;
	// Among those still to go this round, by initiative.
	let at = encounter.order.findIndex((t, i) => i > encounter.current && t.initiative < initiative);
	if (at < 0) at = encounter.order.length;
	encounter.order.splice(at, 0, { kind: 'enemy', tokenId: token.id, initiative });
	log.push(postSystem(room, `${def.name} joins the fight (initiative ${initiative}).`, 'gm'));
	return { ok: true, log };
}
