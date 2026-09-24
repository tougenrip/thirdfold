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
import type { Action, CharacterId, StatId, StatusId } from './characters';

/** Which adventure is being played (its own id; see server/adventures). */
export type AdventureId = string;

/** Whether the story is being played: before it begins, during, and how it ended. */
export type AdventureStage =
	/** Players are picking characters; the GM begins when ready. */
	| 'choosing'
	| 'playing'
	/** The story reached an ending. */
	| 'complete'
	/** Every character went down; the GM can start again. */
	| 'defeat';

/** A chapter of the adventure being played (its own id; see server/adventure/define.ts). */
export type ChapterId = string;

/** A table the adventure is played on (its own id). */
export type LocationId = string;

export interface ChapterView {
	id: ChapterId;
	title: string;
	/** 1-based position in the story. */
	number: number;
	of: number;
}

/** A choice put to the party. Anyone playing a character (or the GM) can answer it, once. */
export interface DecisionView {
	id: string;
	prompt: string;
	options: { id: string; label: string }[];
}

/** A choice the party has made, as the story remembers it. */
export interface DecisionMade {
	id: string;
	prompt: string;
	choice: string;
	/** Who answered: a character's name, or the GM's. */
	by: string;
}

export interface EndingView {
	/** Which ending: silence, descent or communion. */
	id: string;
	/** The first words of the end screen, e.g. "The Bell is silent". */
	headline: string;
	/** The ending's name, e.g. "Silence". */
	title: string;
	/** How the party came to it, e.g. "The Bell Broken". */
	subtitle: string;
	/** What happened, told at the end. */
	text: string;
	/** The last look at the table: what the final scene shows. */
	scene: string;
	/** What came of it all, e.g. { label: 'The Bell', value: 'Broken' }. */
	result: { label: string; value: string }[];
}

/** What the party did, shown when the story is over (won or lost). */
export interface SessionSummary {
	/** Fights won. */
	fightsWon: number;
	/** Enemies that fell. */
	foesDefeated: number;
	/** Pieces of evidence found, by anyone. */
	evidence: number;
	/** Chapters played through, the last one included. */
	chapters: number;
	/** Players who asked to play again. */
	again: string[];
}

/** GM only: the story's bookkeeping, for following along and checking a save. */
export interface StoryLedger {
	events: string[];
	defeated: string[];
	/** Everyone in the story, where they are found and how they are. */
	npcs: { id: string; name: string; home: string; state: string }[];
	encounters: { id: string; state: EncounterState }[];
}

/** GM only: what the GM can direct from here (see `Direction` in protocol.ts). */
export interface DirectorView {
	/** Enemies on the table: in the fight (with hp), or standing watch (hp null). */
	foes: { tokenId: string; name: string; hp: number | null; maxHp: number | null }[];
	/** The people of the story at this location, on the table. */
	people: { tokenId: string; name: string }[];
	/** Story events that have not happened yet. */
	events: { id: string; label: string }[];
	/** Fights that can be fought where the party is, and how each stands (null: not started). */
	encounters: { id: string; name: string; state: EncounterState | null }[];
	/** The enemies the GM can bring on. */
	enemies: { kind: string; name: string }[];
	/** What skipping ahead leads to, or null when it can't (a choice is waiting). */
	skip: string | null;
}

/** Where a fight is in its life. Encounters not listed have not started. */
export type EncounterState = 'active' | 'won' | 'lost';

export interface Objective {
	id: string;
	text: string;
	done: boolean;
	/** Worth doing, but the story goes on without it. */
	optional?: boolean;
}

/**
 * How a character investigates. Examining, inspecting (reading), searching
 * and interacting are done to a thing; listening and observing take in the
 * surroundings wherever the character stands.
 */
export type InvestigationAction =
	'examine' | 'inspect' | 'search' | 'listen' | 'observe' | 'interact';

export const INVESTIGATION_ACTIONS: Record<InvestigationAction, string> = {
	examine: 'Examine',
	inspect: 'Inspect',
	search: 'Search',
	listen: 'Listen',
	observe: 'Observe',
	interact: 'Interact'
};

/** The senses a character can use anywhere. */
export type Sense = Extract<InvestigationAction, 'listen' | 'observe'>;

export function isSense(value: unknown): value is Sense {
	return value === 'listen' || value === 'observe';
}

/** What a piece of evidence is. */
export type EvidenceKind = 'document' | 'object' | 'environment' | 'testimony';

export const EVIDENCE_KINDS: Record<EvidenceKind, string> = {
	document: 'Document',
	object: 'Object',
	environment: 'Trace',
	testimony: 'Testimony'
};

/**
 * What a character physically does to a thing. Most change its state (the
 * table shows the new state); pushing, pulling and rotating move its prop,
 * picking up takes it off the table into the character's hands, dropping
 * puts it back down, and triggering sets off a mechanism, a chain of
 * changes the server plays out step by step.
 */
export type Physical =
	| 'push'
	| 'pull'
	| 'open'
	| 'close'
	| 'pick_up'
	| 'drop'
	| 'rotate'
	| 'activate'
	| 'destroy'
	| 'move'
	| 'trigger';

export const PHYSICAL_ACTIONS: Record<Physical, string> = {
	push: 'Push',
	pull: 'Pull',
	open: 'Open',
	close: 'Close',
	pick_up: 'Pick up',
	drop: 'Drop',
	rotate: 'Rotate',
	activate: 'Activate',
	destroy: 'Destroy',
	move: 'Move',
	trigger: 'Trigger'
};

/** A check a character must pass: a d20 plus one of its stats, against a difficulty. */
export interface Check {
	stat: StatId;
	dc: number;
}

/**
 * A piece of evidence as this viewer knows it. Evidence found by
 * investigating is known only to the character who found it (and the GM)
 * until that player shares it with the party; what people say is heard by all.
 */
export interface Clue {
	id: string;
	title: string;
	text: string;
	kind: EvidenceKind;
	/** The characters who found it themselves, by name; empty when it was heard by all. */
	foundBy: string[];
	/** Known to the whole party. */
	shared: boolean;
	/** This viewer's character found it (and so can share it). */
	mine: boolean;
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
	/** Gone for the rest of the story. */
	dead: boolean;
	/** Rounds a downed character has been down. */
	downedFor: number;
	statuses: ActiveStatus[];
	/** Uses left this encounter per action id; null means unlimited. */
	usesLeft: Record<string, number | null>;
	/** What it carries, by world object. */
	carrying: { id: string; name: string }[];
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
	| 'unlit'
	/** In a character's hands, off the table. */
	| 'carried';

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
	'unlit',
	'carried'
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
	| 'landmark'
	/** A lever, a counterweight: something that works something else. */
	| 'mechanism'
	/** Something a character can pick up and carry. */
	| 'item';

/** Something in the world a character can walk up to and use. */
export interface Interactable {
	id: string;
	name: string;
	kind: ObjectKind;
	state: ObjectState;
	/** The cells it occupies; a character must stand beside one of them. Empty when carried. */
	cells: GridPos[];
	/** This viewer's character is carrying it. */
	carried: boolean;
	/** What can be done with it now, e.g. { id: 'open', label: 'Open the chest' }. */
	verbs: {
		id: string;
		label: string;
		action: InvestigationAction;
		/** What it physically does, if it does something to the thing. */
		physical: Physical | null;
		/** A check to pass first, if any. */
		check: Check | null;
		/** This viewer's character already tried the check and failed. */
		tried: boolean;
		/** It can be done in a fight, on the character's turn, as its action. */
		inFight: boolean;
	}[];
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

/** A place in the turn order, as a viewer sees it. */
export interface TurnView {
	kind: 'character' | 'enemy';
	/** The character, for a character's turn. */
	characterId: CharacterId | null;
	name: string;
	/** What it rolled for initiative. */
	initiative: number;
	/** Its token, when this viewer can see it. */
	tokenId: string | null;
	/** Gone from the fight (a fallen enemy), or down or dead (a character): its turns are skipped. */
	out: boolean;
}

export interface EncounterView {
	round: number;
	/** Everyone in the fight, in initiative order. */
	order: TurnView[];
	/** Whose turn it is: an index into `order`. */
	current: number;
	/** Characters who have used their action this round. */
	acted: CharacterId[];
	/** Cells each character has moved this round. */
	moved: Partial<Record<CharacterId, number>>;
	/** Cells the character whose turn it is may move this turn. */
	speed: number;
	/** Enemies this viewer can see. */
	enemies: EnemyStatus[];
	/** Something the party works toward in this phase of the fight (pulls holding a bell): so far, of how many; else null. */
	counter: { label: string; count: number; of: number } | null;
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
	stage: AdventureStage;
	chapter: ChapterView;
	location: { id: LocationId; name: string };
	objectives: Objective[];
	clues: Clue[];
	characters: CharacterStatus[];
	/** Things this viewer knows are there and can do something with now. */
	interactables: Interactable[];
	/** GM only: every world object, hidden ones included, with its state. */
	objects: WorldObject[] | null;
	encounter: EncounterView | null;
	/** The choice waiting on the party, if any. */
	decision: DecisionView | null;
	/** Choices made so far, oldest first. */
	decisions: DecisionMade[];
	/** How the story ended, once it has. */
	ending: EndingView | null;
	/** GM only: triggered events, defeated enemies, NPC states and encounters. */
	ledger: StoryLedger | null;
	/** GM only: what the GM can direct. */
	director: DirectorView | null;
	/** How the place the party is in greets someone arriving (a new player's welcome card). */
	welcome: { title: string; text: string };
	/**
	 * Something here for a new player to find first (onboarding shows it glowing and has them
	 * walk up and inspect it): the object, where it lies, and the evidence it gives. Null if none.
	 */
	firstFind: { objectId: string; cells: GridPos[]; clueId: string } | null;
	/** When the GM began play (ms since epoch), for the time played. */
	begunAt: number | null;
	/** When the story ended, won or lost. */
	completedAt: number | null;
	/** What the party did, once the story is over; null while it goes on. */
	summary: SessionSummary | null;
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
