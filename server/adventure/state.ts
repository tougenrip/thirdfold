// Authoritative adventure state kept on a room. Plain data: tokens, walls and
// props stay in the room's scene; this records the story around them (the
// chapter, clues, events, decisions, hit points, the encounter) and refers to
// scene things by id. persist.ts turns it into a save and back.
//
// Who plays a character is not stored here: it is whoever owns the
// character's token, so the GM reassigning or removing the token just works.

import type {
	AdventureStage,
	ChapterId,
	EncounterState,
	LocationId,
	ObjectState
} from '../../src/lib/adventure/adventure';
import type { CharacterId, StatusId } from '../../src/lib/adventure/characters';
import type { MechanismId } from './mechanisms';
import type { Origins } from './objects';
import type { NpcId } from './npcs';
import type { DecisionId, EncounterId, EndingId, EventId } from './story';

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
	kind: 'hound';
	hp: number;
	maxHp: number;
	statuses: Statuses;
}

export interface Encounter {
	id: EncounterId;
	round: number;
	phase: 'players' | 'enemies';
	acted: Set<CharacterId>;
	/** Cells moved this round, per character. */
	moved: Map<CharacterId, number>;
	/** By token id. */
	enemies: Map<string, EnemyState>;
	/** Bumped whenever the phase changes, so a stale scheduled enemy turn does nothing. */
	turn: number;
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
	id: 'hollow-bell';
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
	/** Each NPC's state, e.g. Oswin wary or trusting. */
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
	/** Read-aloud cues the GM has used. */
	cuesRead: Set<string>;
	encounter: Encounter | null;
	begunAt: number | null;
	completedAt: number | null;
}
