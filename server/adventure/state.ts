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
import type { Creator } from '../../src/lib/game/library';
import type { EffectMods, EffectSpec, JsonData, RulesetRef } from '../rules/ruleset';
import type { BuiltCharacter } from './built';
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
	/**
	 * Uses spent of the rules' resources its player marks by hand (spell
	 * slots, …), by resource id; those an action tracks count in `uses`.
	 * Absent when none were marked.
	 */
	resources?: Map<string, number>;
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
	/** Parts of their turn characters have spent: a character's id for its action, `<id>:<type>` for another (a bonus action). */
	acted: Set<string>;
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
	/** Lasting effects saved by milestone 48 on the fight: read into `AdventureState.effects`. */
	effects?: LastingEffect[];
}

/** Who an effect comes from: a character's id, an enemy's token, the GM, or the story itself. */
export type EffectSource =
	| { kind: 'character'; id: CharacterId; name: string }
	| { kind: 'enemy'; id: string; name: string }
	| { kind: 'gm'; name: string }
	| { kind: 'story'; name: string };

/**
 * A lasting effect (Bless, a Ray of Frost's chill, the Poisoned condition a
 * bite leaves, a GM's ruling) on one bearer, from a source: what it changes
 * (`EffectMods`, conditions among them) and when it ends (see effects.ts).
 */
export interface LastingEffect {
	/** `fx-N`, unique in the story. */
	id: string;
	name: string;
	source: EffectSource;
	/** The source's token, when it has one (a charmer, the source of a fear). */
	sourceToken?: string;
	/** The token it is on. */
	target: string;
	/** Whose turns its time counts on, when not its source's (a GM's ruling counts on its bearer's). */
	clock?: string;
	mods: EffectMods;
	/** Counted on its source's turns; null for until it is removed or saved against. */
	ends: { at: 'start' | 'end'; turns: number } | null;
	concentration: boolean;
	/** Its bearer repeats this save at the end of each of its turns (and when damaged, with `onDamage`). */
	repeat?: { stat: string; dc: number; onDamage?: boolean };
	/** What a failed repeat save turns it into. */
	worsens?: EffectSpec;
	/** It ends when its bearer takes damage. */
	endsOnDamage?: boolean;
	/** Exhaustion's level. */
	level?: number;
}

/** A published adventure a table plays: its library id, the version, and whose it is. */
export interface LibrarySource {
	id: string;
	version: number;
	creator: Creator;
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

/** Things put down together on one cell of one table. */
export interface Pile {
	location: LocationId;
	pos: GridPos;
	/** Each item as its rules keep it, and its name. */
	items: { item: JsonData; name: string }[];
}

export interface AdventureState {
	/** Which adventure (see server/adventures). */
	id: string;
	/** The rules the story plays by, pinned when it starts (see server/rules). */
	rules: RulesetRef;
	stage: AdventureStage;
	chapter: ChapterId;
	/** The table the party is on. */
	location: LocationId;
	characters: Map<CharacterId, CharacterState>;
	/**
	 * Characters players built for this story under its rules, by id (see
	 * built.ts). Replaced, never changed in place, whenever one is added or
	 * removed. Absent or empty when nobody built one.
	 */
	built?: ReadonlyMap<CharacterId, BuiltCharacter>;
	/**
	 * The adventure's own characters whose rules data changed in play (what
	 * they carry and wield, under rules with equipment), by id: played in
	 * place of the adventure's definition. Replaced, never changed in place.
	 * Absent until one changes.
	 */
	kept?: ReadonlyMap<CharacterId, BuiltCharacter>;
	/**
	 * Things characters put down, by the id of the prop that shows each pile
	 * on its table: where it lies and what is in it, as the rules' own data
	 * (`Equipment`). The prop is only a marker; the items are not props.
	 */
	piles?: ReadonlyMap<string, Pile>;
	/** Lasting effects on those in the story (see effects.ts); absent when none. */
	effects?: LastingEffect[];
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
	/** What the party has earned (`reward` effects), in order. */
	rewards: string[];
	/** Each character's own notes, by character id, written by its player or the GM. Absent when none. */
	notes?: Map<CharacterId, string>;
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
	/** The library adventure being played (a creator's, published), if it is one. */
	library?: LibrarySource;
	/** The stars each player gave it at this table, by player id (not saved: the library keeps them). */
	rated?: Map<string, number>;
}
