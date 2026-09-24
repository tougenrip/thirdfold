// Authoritative adventure state kept on a room. Plain data: tokens, walls and
// props stay in the room's scene; this records the story around them (the
// chapter, clues, events, decisions, hit points, the encounter) and refers to
// scene things by id. persist.ts turns it into a save and back.
//
// Who plays a character is not stored here: it is whoever owns the
// character's token, so the GM reassigning or removing the token just works.

import type {
	AdventureStage,
	EncounterState,
	ObjectState
} from '../../src/lib/adventure/adventure';
import type { StatusId } from '../../src/lib/adventure/characters';
import type { GridPos } from '../../src/lib/game/grid';
import type { Origins } from './world';

// Ids are the adventure's own (see define.ts): plain strings here.
type CharacterId = string;
type ChapterId = string;
type LocationId = string;
type EnemyKind = string;
type MechanismId = string;
type NpcId = string;
type DecisionId = string;
type EncounterId = string;
type EndingId = string;
type EventId = string;

/** Active statuses and the rounds each has left (counting the current one). */
export type Statuses = Map<StatusId, number>;

export interface CharacterState {
	tokenId: string;
	hp: number;
	statuses: Statuses;
	/** Times each limited action has been used this encounter, by action id. */
	uses: Map<string, number>;
	/** Rounds spent at 0 HP; at BLEED_OUT_ROUNDS the character dies. */
	downedFor: number;
	dead: boolean;
}

export interface EnemyState {
	kind: EnemyKind;
	hp: number;
	maxHp: number;
	statuses: Statuses;
	/** Turns before it can use its special again (a toll); 0 when ready. */
	rest: number;
	/** Where it stands guard (a guardian's post). */
	post?: GridPos;
	/** Who it is after. */
	target?: CharacterId;
	/** Who hurt it last. */
	lastHitBy?: CharacterId;
	/** Where it last saw a character. */
	lastSeen?: GridPos;
}

/** An enemy on the table outside a fight: walking its round, or standing guard, until it spots someone. */
export interface Sentry {
	kind: EnemyKind;
	/** The fight it starts when it spots someone. */
	encounter: EncounterId;
	/** Waypoints it walks between in a loop; one point is a post it guards. */
	route: GridPos[];
	/** The waypoint it is walking to. */
	leg: number;
}

/** Someone with a place in the turn order. */
export type Combatant = { kind: 'character'; id: CharacterId } | { kind: 'enemy'; tokenId: string };

/** A place in the turn order: who, and what they rolled for initiative. */
export type TurnEntry = Combatant & { initiative: number };

export interface Encounter {
	id: EncounterId;
	round: number;
	/** Everyone in the fight, in initiative order; turns go down the list, then round again. */
	order: TurnEntry[];
	/** Whose turn it is: an index into `order`. */
	current: number;
	/** Characters who have used their action this round. */
	acted: Set<CharacterId>;
	/** Cells moved this round, per character. */
	moved: Map<CharacterId, number>;
	/** Cells the character whose turn it is may move this turn (half its speed when slowed). */
	speed: number;
	/** By token id. */
	enemies: Map<string, EnemyState>;
	/** Bumped on every turn, so a stale scheduled enemy turn does nothing. */
	turn: number;
	/** The phase it is in, for a fight with phases (see `PhaseDef`). */
	finale?: string;
	/** Cells of its hazard open under the party: whoever still stands on one when it strikes is hurt. */
	cracks?: GridPos[];
	/** Its phase's counter so far (pulls on a rope). */
	pulls?: number;
	/** Something counted since the round began (so the unanswered rule doesn't strike). */
	pulled?: boolean;
}

export interface Finding {
	/** Characters who found it themselves (they know it even before it is shared). */
	by: CharacterId[];
	/** The whole party knows it: it was shared, or everyone heard it. */
	shared: boolean;
}

export interface Decision {
	option: string;
	/** Who answered: a character's name, or the GM's. */
	by: string;
}

export interface AdventureState {
	/** Which adventure (see server/adventures). */
	id: string;
	stage: AdventureStage;
	chapter: ChapterId;
	/** The table the party is on. */
	location: LocationId;
	characters: Map<CharacterId, CharacterState>;
	/**
	 * Evidence found, in the order it was found, by clue id: who found it
	 * themselves, and whether the whole party knows it.
	 */
	evidence: Map<string, Finding>;
	/** Checks already failed, one try each: `<character>:<object>:<verb>` or `<character>:sign:<id>`. */
	tried: Set<string>;
	/** Story events that have happened, in order (see story.ts). */
	events: EventId[];
	/** Enemies the party has beaten, by name, in order. */
	defeated: string[];
	/** Each NPC's state, e.g. wary or trusting. */
	npcs: Map<NpcId, string>;
	/** Lines already said (`<npc>:<line>`) and reactions heard (`reaction:<id>`). */
	said: Set<string>;
	/** Choices made, by decision id. */
	decisions: Map<DecisionId, Decision>;
	/** The choice put to the party and not yet answered. */
	pending: DecisionId | null;
	/** How each fight went; fights not listed have not started. */
	encounters: Map<EncounterId, EncounterState>;
	ending: EndingId | null;
	/** Each world object's state, by object id (see objects.ts). Kept after the party moves on. */
	objects: Map<string, ObjectState>;
	/** Where object props at this location stand before their looks (moved by pushing, pulling, turning, dropping), and carried items' looks. */
	origins: Origins;
	/** Items in characters' hands, by world object id. */
	carried: Map<string, CharacterId>;
	/** Mechanisms playing out, and the step each runs next. */
	running: Map<MechanismId, number>;
	/** Enemies on the table outside a fight, by token id. */
	sentries: Map<string, Sentry>;
	/** Read-aloud cues the GM has used. */
	cuesRead: Set<string>;
	encounter: Encounter | null;
	begunAt: number | null;
	completedAt: number | null;
	/** Players who asked to play again once the story ended (not saved: it is only for this ending). */
	again?: Set<string>;
}
