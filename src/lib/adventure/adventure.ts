// What a client is told about the adventure running at its table. The server
// computes one of these per viewer (enemies and things to interact with are
// filtered by what that viewer can see, and only the GM gets the read-aloud
// cues) and sends it with the room snapshot and as `adventure_update`.
//
// The reach rules below are shared: the server enforces them, the client
// uses them only to decide which buttons to offer.

import { gridDistance, type GridPos } from '../game/grid';
import type { Blockers } from '../game/objects';
import { hasLineOfSight } from '../game/visibility';
import type { Action, CharacterId, StatusId } from './characters';

export type AdventureId = 'hollow-bell';

/** Where the party is in the section. */
export type AdventureStage =
	/** Players are picking characters; the GM begins when ready. */
	| 'choosing'
	| 'arrival'
	| 'investigate'
	| 'encounter'
	| 'aftermath'
	/** The section is over: the party reached the mountain path. */
	| 'complete'
	/** Every character went down; the GM can start the section again. */
	| 'defeat';

export interface Objective {
	id: string;
	text: string;
	done: boolean;
}

export interface Clue {
	id: string;
	title: string;
	text: string;
}

export interface CharacterStatus {
	id: CharacterId;
	/** Whether this character is on the table (someone picked it). */
	inPlay: boolean;
	/** Who plays this character: null while nobody has picked it, or if the GM took it over. */
	playerId: string | null;
	/** Its token, when this viewer can see it. */
	tokenId: string | null;
	hp: number;
	maxHp: number;
	/** At 0 HP: can't move or act, and dies if not healed in time. */
	downed: boolean;
	/** Gone for the rest of the section. */
	dead: boolean;
	/** Rounds a downed character has been down. */
	downedFor: number;
	statuses: ActiveStatus[];
	/** Uses left this encounter per action id; null means unlimited. */
	usesLeft: Record<string, number | null>;
}

export interface ActiveStatus {
	id: StatusId;
	/** Rounds left, counting the current one. */
	rounds: number;
}

/** Where a world object is in its life: seen, used, opened, broken, … */
export type ObjectState =
	/** Not in the world for players yet (a secret not found). */
	| 'hidden'
	/** There, but nothing can be done with it right now. */
	| 'visible'
	| 'interactable'
	/** Done with: searched, read. */
	| 'used'
	/** Can't be used: locked, jammed, chained. */
	| 'disabled'
	| 'destroyed'
	| 'moved'
	| 'opened'
	| 'closed'
	/** A fire burning (torches, braziers). */
	| 'lit'
	| 'unlit';

export const OBJECT_STATES: readonly ObjectState[] = [
	'hidden',
	'visible',
	'interactable',
	'used',
	'disabled',
	'destroyed',
	'moved',
	'opened',
	'closed',
	'lit',
	'unlit'
];

export function isObjectState(value: unknown): value is ObjectState {
	return typeof value === 'string' && (OBJECT_STATES as readonly string[]).includes(value);
}

export type ObjectKind =
	| 'npc'
	| 'door'
	| 'chest'
	| 'book'
	| 'table'
	| 'torch'
	| 'ritual'
	| 'corpse'
	| 'secret'
	| 'container'
	| 'landmark';

/** Something in the world a character can walk up to and use. */
export interface Interactable {
	id: string;
	name: string;
	kind: ObjectKind;
	state: ObjectState;
	/** The cells it occupies; a character must stand beside one of them. */
	cells: GridPos[];
	/** What can be done with it now, e.g. { id: 'open', label: 'Open the chest' }. */
	verbs: { id: string; label: string }[];
}

/** For the GM: every world object and the states it can be put in. */
export interface WorldObject {
	id: string;
	name: string;
	kind: ObjectKind;
	state: ObjectState;
	states: ObjectState[];
}

export interface EnemyStatus {
	tokenId: string;
	name: string;
	hp: number;
	maxHp: number;
	/** What an attack roll must reach to hit it. */
	defense: number;
	statuses: ActiveStatus[];
}

export interface EncounterView {
	round: number;
	/** Characters act (in any order) in the players' phase, then the enemies act. */
	phase: 'players' | 'enemies';
	/** Characters who have used their action (or ended their turn) this round. */
	acted: CharacterId[];
	/** Cells each character has moved this round. */
	moved: Partial<Record<CharacterId, number>>;
	/** Enemies this viewer can see. */
	enemies: EnemyStatus[];
}

export interface ReadAloud {
	id: string;
	title: string;
	text: string;
	read: boolean;
}

export interface AdventureView {
	id: AdventureId;
	title: string;
	section: string;
	stage: AdventureStage;
	objectives: Objective[];
	clues: Clue[];
	characters: CharacterStatus[];
	/** Things this viewer knows are there and can do something with now. */
	interactables: Interactable[];
	/** GM only: every world object, hidden ones included, with its state. */
	objects: WorldObject[] | null;
	encounter: EncounterView | null;
	/** When the GM began play (ms since epoch), for the time played. */
	begunAt: number | null;
	completedAt: number | null;
	/** GM only: prepared text to read aloud. */
	cues: ReadAloud[] | null;
}

/** Whether a character standing at `from` can reach something covering `cells`: beside it, not through a wall. */
export function canReach(blocked: Blockers, from: GridPos, cells: readonly GridPos[]): boolean {
	return cells.some((c) => gridDistance(from, c) <= 1 && hasLineOfSight(blocked, from, c));
}

/** Whether an attack with `range` can hit `to` from `from`: close enough, with a clear line. */
export function inAttackRange(
	blocked: Blockers,
	from: GridPos,
	to: GridPos,
	range: number
): boolean {
	return gridDistance(from, to) <= range && hasLineOfSight(blocked, from, to);
}

/** Whether an action can be aimed from `from` at `to`: within its range, with a clear line. */
export function inActionRange(
	blocked: Blockers,
	from: GridPos,
	to: GridPos,
	action: Pick<Action, 'range' | 'target'>
): boolean {
	if (action.target === 'self') return true;
	return inAttackRange(blocked, from, to, Math.max(1, action.range));
}
