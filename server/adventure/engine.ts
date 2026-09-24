// The Hollow Bell's rules, part one. Every action takes the acting player and
// checks role, ownership, reach and turn order before changing anything, like
// the scene actions in server/scene.ts. Dice are rolled here, on the server.
//
// Actions return an Outcome: the log entries they added (the game server
// announces them after syncing views) and whether the table was replaced or
// the enemies' turn should be scheduled. The game server owns timing and
// transport; nothing here touches a socket or a timer.

import { randomUUID } from 'node:crypto';
import { canReach, inAttackRange, type AdventureStage } from '../../src/lib/adventure/adventure';
import {
	CHARACTER_IDS,
	CHARACTERS,
	defenseFor,
	type Attack,
	type CharacterId
} from '../../src/lib/adventure/characters';
import { NARRATION_MAX_LENGTH, normalizeChatText, type ChatMessage } from '../../src/lib/game/chat';
import { parseDice, rollDice, type DiceRoll, type DieRoller } from '../../src/lib/game/dice';
import { gridDistance, type GridPos } from '../../src/lib/game/grid';
import { findPath, type Door, type Obstacles } from '../../src/lib/game/objects';
import { footprintCells, isSolidCell } from '../../src/lib/game/props';
import type { AdventureControl } from '../../src/lib/game/protocol';
import { tokenAt, type Token } from '../../src/lib/game/token';
import { hasLineOfSight, rectCells } from '../../src/lib/game/visibility';
import { appendLog, postSystem } from '../chat';
import { fail, type Player, type Result, type Room } from '../rooms';
import { obstacles } from '../scene';
import { applyScene } from '../scene-io';
import { bellweatherScene, EXIT, IDS, PATH_AREA, SPAWN, WELL_RING } from './bellweather';
import { CLUES, CUES, HOUND, TEXT, TITLE, type ClueId } from './content';
import type { AdventureState, CharacterState, Encounter } from './state';

export interface Outcome {
	/** Log entries added, oldest first; announce them after syncing. */
	log: ChatMessage[];
	/** The whole table was replaced: send everyone a fresh snapshot. */
	reset?: boolean;
	/** The enemies should act: run `runEnemyTurn` for this encounter turn (after a pause). */
	enemyTurn?: number;
}

type Outcomes = Result<Outcome>;

const NO_ADVENTURE = fail('no_adventure', 'No adventure is running at this table.');
const GM_ONLY = fail('forbidden', 'Only the GM can do that.');

/** Things a character can walk up to and use, and what they are in the scene. */
export const INTERACTABLES = [
	{ id: 'maren', label: 'Talk to Maren', token: IDS.maren },
	{ id: 'well', label: 'Examine the well', prop: IDS.well },
	{ id: 'noticeboard', label: 'Read the notice board', prop: IDS.noticeboard },
	{ id: 'chest', label: 'Search the chest', prop: IDS.chest }
] as const;

type InteractableId = (typeof INTERACTABLES)[number]['id'];

/** The cells an interactable covers now, or null if it is gone from the table. */
export function interactableCells(
	room: Room,
	def: (typeof INTERACTABLES)[number]
): GridPos[] | null {
	if ('token' in def) {
		const token = room.tokens.get(def.token);
		return token ? [token.pos] : null;
	}
	const prop = room.props.get(def.prop);
	return prop ? footprintCells(prop) : null;
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

/** Characters still standing. */
function standing(room: Room, adventure: AdventureState): Played[] {
	return played(room, adventure).filter((c) => c.state.hp > 0);
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

function placeCharacter(room: Room, id: CharacterId, ownerId: string | null): Token | null {
	const cell = SPAWN.find((c) => isFree(room, c));
	if (!cell) return null;
	const def = CHARACTERS[id];
	const token: Token = {
		id: randomUUID(),
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

function newState(): AdventureState {
	return {
		id: 'hollow-bell',
		stage: 'choosing',
		characters: new Map(),
		clues: [],
		cuesRead: new Set(),
		encounter: null,
		begunAt: null,
		completedAt: null
	};
}

/** GM: sets up The Hollow Bell. Replaces the table with Bellweather. */
export function startAdventure(room: Room, actor: Player): Outcomes {
	if (actor.role !== 'gm') return GM_ONLY;
	applyScene(room, bellweatherScene());
	room.adventure = newState();
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
		return fail('forbidden', 'This section is over.');
	}
	const mine = characterOf(room, actor.id);
	if (mine) return fail('forbidden', `You are already playing ${CHARACTERS[mine.id].name}.`);
	const existing = adventure.characters.get(id);
	if (existing && room.tokens.has(existing.tokenId)) {
		return fail('character_taken', `${CHARACTERS[id].name} is already taken.`);
	}
	const token = placeCharacter(room, id, actor.id);
	if (!token) return fail('cell_occupied', 'There is no room on the road. Ask the GM to clear it.');
	adventure.characters.set(id, { tokenId: token.id, hp: CHARACTERS[id].hp });
	return {
		ok: true,
		log: [postSystem(room, `${actor.name} is playing ${CHARACTERS[id].name}.`)]
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
	adventure.stage = 'arrival';
	adventure.begunAt = now;
	return { ok: true, log: [appendLog(room, { kind: 'narration', text: TEXT.arrival })] };
}

// ---------------------------------------------------------------------------
// Interacting with the world

function addClue(room: Room, adventure: AdventureState, id: ClueId): ChatMessage[] {
	if (adventure.clues.includes(id)) return [];
	adventure.clues.push(id);
	return [postSystem(room, `New clue: ${CLUES[id].title}.`)];
}

function say(room: Room, text: string, speaker?: string): ChatMessage {
	return appendLog(
		room,
		speaker ? { kind: 'narration', text, speaker } : { kind: 'narration', text }
	);
}

/** Player: their character talks to, examines or searches something beside it. */
export function interact(room: Room, actor: Player, targetId: string): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const def = INTERACTABLES.find((i) => i.id === targetId);
	const cells = def && interactableCells(room, def);
	if (!def || !cells) return fail('object_not_found', "That isn't here any more.");
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	if (me.state.hp <= 0) return fail('forbidden', `${CHARACTERS[me.id].name} is down.`);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	if (adventure.encounter) return fail('not_your_turn', TEXT.notNow);
	if (!canReach(obstacles(room), me.token.pos, cells)) {
		return fail('out_of_reach', `Move ${CHARACTERS[me.id].name} next to it first.`);
	}
	const log = respond(room, adventure, def.id);
	return { ok: true, log };
}

function respond(room: Room, adventure: AdventureState, id: InteractableId): ChatMessage[] {
	const stage = adventure.stage;
	switch (id) {
		case 'maren': {
			if (stage === 'arrival') {
				adventure.stage = 'investigate';
				return [say(room, TEXT.marenArrival, 'Maren')];
			}
			const line =
				stage === 'aftermath'
					? TEXT.marenAftermath
					: stage === 'complete'
						? TEXT.marenComplete
						: TEXT.marenInvestigate;
			return [say(room, line, 'Maren')];
		}
		case 'well': {
			if (stage !== 'investigate') {
				return [say(room, stage === 'arrival' ? TEXT.wellEarly : CLUES.scratches.text)];
			}
			const log = [say(room, TEXT.wellClue), ...addClue(room, adventure, 'scratches')];
			return [...log, ...startEncounter(room, adventure)];
		}
		case 'noticeboard':
			return [say(room, CLUES.notice.text), ...addClue(room, adventure, 'notice')];
		case 'chest':
			return [say(room, CLUES.rope.text), ...addClue(room, adventure, 'rope')];
	}
}

// ---------------------------------------------------------------------------
// The encounter

function startEncounter(room: Room, adventure: AdventureState): ChatMessage[] {
	const cell = WELL_RING.find((c) => isFree(room, c)) ?? SPAWN.find((c) => isFree(room, c));
	if (!cell) return [];
	const hp = HOUND.hpFor(standing(room, adventure).length);
	const hound: Token = {
		id: randomUUID(),
		name: HOUND.name,
		color: HOUND.color,
		pos: { ...cell },
		ownerId: null,
		vision: HOUND.vision,
		light: 0
	};
	room.tokens.set(hound.id, hound);
	adventure.stage = 'encounter';
	adventure.encounter = {
		round: 1,
		phase: 'players',
		acted: new Set(),
		moved: new Map(),
		enemies: new Map([[hound.id, { kind: 'hound', hp, maxHp: hp }]]),
		turn: 1
	};
	// Light up the square so the whole party can see the fight.
	for (const i of rectCells(room.grid, { x: 8, y: 10 }, { x: 16, y: 17 })) room.fog.revealed[i] = 1;
	return [
		say(room, TEXT.houndEmerges),
		postSystem(room, 'Round 1. Each character can move up to their speed and act once.')
	];
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

/** A d20 plus the attack's bonus against the target's defense; a natural 20 always hits. */
function strike(attack: Attack, defense: number, roller: DieRoller): Strike {
	const toHit = roll(`1d20+${attack.toHit}`, roller);
	const natural = toHit.terms[0].kind === 'dice' ? toHit.terms[0].rolls[0] : 0;
	const hit = natural === 20 || (natural !== 1 && toHit.total >= defense);
	return { hit, toHit, damage: hit ? roll(attack.damage, roller) : null };
}

/** Player: their character attacks an enemy. */
export function attack(room: Room, actor: Player, targetId: string, roller: DieRoller): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const encounter = adventure.encounter;
	if (!encounter) return fail('forbidden', 'There is nothing to fight.');
	if (encounter.phase !== 'players') return fail('not_your_turn', "It's the enemies' turn.");
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can attack.');
	const def = CHARACTERS[me.id];
	if (me.state.hp <= 0) return fail('forbidden', `${def.name} is down.`);
	if (encounter.acted.has(me.id)) {
		return fail('not_your_turn', `${def.name} has already acted this round.`);
	}
	const enemy = encounter.enemies.get(targetId);
	const target = room.tokens.get(targetId);
	if (!enemy || !target) return fail('token_not_found', "That enemy isn't here.");
	if (!inAttackRange(obstacles(room), me.token.pos, target.pos, def.attack.range)) {
		return fail(
			'out_of_reach',
			def.attack.range === 1
				? `Move ${def.name} next to the ${target.name} first.`
				: `The ${target.name} is out of range or out of sight.`
		);
	}

	const result = strike(def.attack, defenseFor(HOUND.armor), roller);
	let outcome: string | undefined;
	if (result.damage) {
		enemy.hp = Math.max(0, enemy.hp - result.damage.total);
		if (enemy.hp === 0) {
			encounter.enemies.delete(target.id);
			room.tokens.delete(target.id);
			outcome = `The ${target.name} falls.`;
		}
	}
	encounter.acted.add(me.id);
	const log = [
		appendLog(room, {
			kind: 'attack',
			authorId: actor.id,
			authorName: def.name,
			attack: def.attack.name,
			targetName: target.name,
			toHit: result.toHit,
			defense: defenseFor(HOUND.armor),
			hit: result.hit,
			damage: result.damage,
			...(outcome ? { outcome } : {})
		})
	];
	return { ok: true, ...afterAction(room, adventure, encounter, log) };
}

/** Player: their character is done for this round. */
export function endTurn(room: Room, actor: Player): Outcomes {
	const adventure = room.adventure;
	if (!adventure) return NO_ADVENTURE;
	const encounter = adventure.encounter;
	if (!encounter) return fail('forbidden', 'There are no turns outside a fight.');
	if (encounter.phase !== 'players') return fail('not_your_turn', "It's the enemies' turn.");
	const me = characterOf(room, actor.id);
	if (!me) return fail('forbidden', 'Only a character in the story can do that.');
	if (encounter.acted.has(me.id)) return fail('not_your_turn', 'You already ended your turn.');
	encounter.acted.add(me.id);
	const log = [postSystem(room, `${CHARACTERS[me.id].name} is ready.`)];
	return { ok: true, ...afterAction(room, adventure, encounter, log) };
}

/** After a character acts: the fight may be won, or every character may have had a turn. */
function afterAction(
	room: Room,
	adventure: AdventureState,
	encounter: Encounter,
	log: ChatMessage[]
): Outcome {
	if (encounter.enemies.size === 0) return { log: [...log, ...victory(room, adventure)] };
	const waiting = standing(room, adventure).filter((c) => !encounter.acted.has(c.id));
	if (waiting.length > 0) return { log };
	return { log, enemyTurn: enemiesAct(encounter) };
}

function enemiesAct(encounter: Encounter): number {
	encounter.phase = 'enemies';
	return ++encounter.turn;
}

function victory(room: Room, adventure: AdventureState): ChatMessage[] {
	adventure.encounter = null;
	adventure.stage = 'aftermath';
	const log = [say(room, TEXT.houndFalls)];
	const fallen = played(room, adventure).filter((c) => c.state.hp <= 0);
	for (const c of fallen) c.state.hp = 1;
	if (fallen.length) log.push(say(room, TEXT.revive));
	const gate = room.objects.get(IDS.gate);
	if (gate?.kind === 'door') gate.open = true;
	for (const i of rectCells(room.grid, PATH_AREA.from, PATH_AREA.to)) room.fog.revealed[i] = 1;
	log.push(say(room, TEXT.gateOpens));
	return log;
}

/**
 * The enemies act: each moves toward the nearest standing character and bites
 * if it can reach. Then a new round begins, or the party has fallen. Returns
 * null when `turn` is stale (the fight moved on while this was scheduled).
 */
export function runEnemyTurn(room: Room, turn: number, roller: DieRoller): Outcome | null {
	const adventure = room.adventure;
	const encounter = adventure?.encounter;
	if (!adventure || !encounter || encounter.phase !== 'enemies' || encounter.turn !== turn) {
		return null;
	}
	const log: ChatMessage[] = [];
	const blocked = obstacles(room);
	for (const [id] of encounter.enemies) {
		const hound = room.tokens.get(id);
		if (!hound) continue;
		const targets = standing(room, adventure);
		if (targets.length === 0) break;
		// The nearest character it can get beside, by walking distance.
		let best: { target: Played; path: GridPos[] } | null = null;
		for (const target of targets) {
			const beside = (c: GridPos) =>
				gridDistance(c, target.token.pos) <= 1 && hasLineOfSight(blocked, c, target.token.pos);
			const path = beside(hound.pos)
				? []
				: findPath(room.grid, blocked, hound.pos, beside, (c) =>
						isFree(room, c, blocked, hound.id)
					);
			if (!path) continue;
			if (
				!best ||
				path.length < best.path.length ||
				(path.length === best.path.length && target.state.hp < best.target.state.hp)
			) {
				best = { target, path };
			}
		}
		if (!best) continue;
		const steps = best.path.slice(0, HOUND.speed);
		if (steps.length) hound.pos = { ...steps[steps.length - 1] };
		const { target } = best;
		if (!inAttackRange(blocked, hound.pos, target.token.pos, HOUND.attack.range)) continue;
		const def = CHARACTERS[target.id];
		const result = strike(HOUND.attack, defenseFor(def.armor), roller);
		let outcome: string | undefined;
		if (result.damage) {
			target.state.hp = Math.max(0, target.state.hp - result.damage.total);
			if (target.state.hp === 0) outcome = `${def.name} falls!`;
		}
		log.push(
			appendLog(room, {
				kind: 'attack',
				authorId: hound.id,
				authorName: hound.name,
				attack: HOUND.attack.name,
				targetName: def.name,
				toHit: result.toHit,
				defense: defenseFor(def.armor),
				hit: result.hit,
				damage: result.damage,
				...(outcome ? { outcome } : {})
			})
		);
	}

	if (standing(room, adventure).length === 0) {
		adventure.encounter = null;
		adventure.stage = 'defeat';
		log.push(say(room, TEXT.defeat));
		return { log };
	}
	encounter.round++;
	encounter.phase = 'players';
	encounter.acted.clear();
	encounter.moved.clear();
	encounter.turn++;
	log.push(postSystem(room, `Round ${encounter.round}. Your move.`));
	return { log };
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
	if (me.state.hp <= 0) return fail('forbidden', `${def.name} is down and can't move.`);
	if (adventure.stage === 'choosing') return fail('forbidden', 'Wait for the GM to begin.');
	const encounter = adventure.encounter;
	if (!encounter) return { ok: true, cost: null };
	if (encounter.phase !== 'players') return fail('not_your_turn', "It's the enemies' turn.");
	const cost = walkCost(room, me.token.pos, to);
	if (cost === null) return fail('no_path', "There's no way through to that cell.");
	const left = def.speed - (encounter.moved.get(me.id) ?? 0);
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

/** After a token moved: charge its movement, and see whether the party has left the village. */
export function afterMove(
	room: Room,
	token: Token,
	cost: number | null,
	now = Date.now()
): Outcome {
	const adventure = room.adventure;
	const me = characterByToken(room, token.id);
	if (!adventure || !me) return { log: [] };
	if (cost !== null && adventure.encounter) {
		adventure.encounter.moved.set(me.id, (adventure.encounter.moved.get(me.id) ?? 0) + cost);
	}
	if (
		adventure.stage === 'aftermath' &&
		EXIT.some((c) => c.x === token.pos.x && c.y === token.pos.y)
	) {
		adventure.stage = 'complete';
		adventure.completedAt = now;
		return { log: [say(room, TEXT.complete)] };
	}
	return { log: [] };
}

/** Why a door won't open for this actor, or null if it will. The GM can always force it. */
export function doorLock(room: Room, actor: Player, door: Door): string | null {
	const stage = room.adventure?.stage;
	if (!stage || actor.role === 'gm' || door.id !== IDS.gate) return null;
	const open: AdventureStage[] = ['aftermath', 'complete'];
	return open.includes(stage) ? null : TEXT.gateLocked;
}

/** After the GM removed a token: a character leaves the story, an enemy leaves the fight. */
export function afterTokenDeleted(room: Room, tokenId: string): Outcome {
	const adventure = room.adventure;
	if (!adventure) return { log: [] };
	for (const [id, state] of adventure.characters) {
		if (state.tokenId === tokenId) adventure.characters.delete(id);
	}
	const encounter = adventure.encounter;
	if (!encounter || !encounter.enemies.delete(tokenId)) return { log: [] };
	if (encounter.enemies.size === 0) return { log: victory(room, adventure) };
	return { log: [] };
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

/** GM: ends the players' phase, restarts the section, or ends the adventure. */
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
		case 'end_round': {
			const encounter = adventure.encounter;
			if (!encounter || encounter.phase !== 'players') {
				return fail('forbidden', 'There is no players’ turn to end.');
			}
			const log = [postSystem(room, `${actor.name} ended the players' turn.`)];
			return { ok: true, log, enemyTurn: enemiesAct(encounter) };
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

/** Resets Bellweather and the story; everyone keeps their character, back on the road at full health. */
function restart(room: Room, adventure: AdventureState, actor: Player, now: number): Outcome {
	const keep = played(room, adventure).map((c) => ({ id: c.id, ownerId: c.token.ownerId }));
	const begun = adventure.stage !== 'choosing';
	applyScene(room, bellweatherScene());
	const next = newState();
	for (const { id, ownerId } of keep) {
		const owner = ownerId && room.players.get(ownerId);
		const token = placeCharacter(room, id, owner && owner.role === 'player' ? owner.id : null);
		if (token) next.characters.set(id, { tokenId: token.id, hp: CHARACTERS[id].hp });
	}
	room.adventure = next;
	const log = [postSystem(room, `${actor.name} started the section over.`)];
	if (begun) {
		next.stage = 'arrival';
		next.begunAt = now;
		log.push(say(room, TEXT.arrival));
	}
	return { reset: true, log };
}
