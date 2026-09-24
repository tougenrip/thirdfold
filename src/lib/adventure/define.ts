// What an adventure is made of, as data the engine runs (server/adventure/engine.ts;
// an adventure file, see file.ts, is the same written as plain JSON):
//
//   Adventure
//    ├── Scenes      the tables it is played on (`locations`), and the places on them that matter (`areas`)
//    ├── Characters  the ones players choose (src/lib/adventure/characters.ts)
//    ├── NPCs        the people, where they stand, and what they say (`npcs`, `reactions`)
//    ├── Enemies     stat blocks and how each fights (`enemies`, behaviours in ai.ts)
//    ├── Objects     things to use, with states, looks and verbs (`objects`, `mechanisms`, `signs`)
//    ├── Encounters  fights: who comes, where, and their phases (`encounters`)
//    ├── Events      what happens, and what it does to the table (`events`)
//    ├── Dialogues   NPCs' lines, each with conditions and effects (`npcs[].lines`)
//    ├── Objectives  chapters of the story, each with objectives and the event that ends it (`chapters`)
//    └── Endings     choices and how the story ends (`decisions`, `endings`)
//
// Only what The Hollow Bell proved it needs: things happen through Effects
// (say something, find a clue, raise an event, change an object, start a
// fight...) and are chosen by Rules (the first whose conditions hold), the
// same way NPC lines always worked. Ids are plain strings; an adventure
// keeps its own ids to itself.

import type {
	Check,
	EvidenceKind,
	InvestigationAction,
	ObjectKind,
	ObjectState,
	Physical,
	Sense
} from './adventure';
import type { Attack, CharacterDef } from './characters';
import type { Cue, Shot } from '../game/chat';
import type { GridPos } from '../game/grid';
import type { Ambient } from '../game/lights';
import type { MotionKind, Sound } from '../game/motion';
import type { AssetId } from '../game/props';
import type { SavedToken, SceneFile } from '../game/scene-file';

/** An inclusive rectangle of cells. */
export interface Area {
	from: GridPos;
	to: GridPos;
}

// ---------------------------------------------------------------------------
// Conditions and effects

/** When something applies: every listed condition must hold. */
export interface When {
	/**
	 * The state of whoever or whatever it is about: the speaker's (a line), the
	 * object's before the verb was done (a verb's rule).
	 */
	state?: readonly string[];
	/** The character acting knows all of these clues. */
	clues?: readonly string[];
	/** Someone in the party has found all of these (shared or not). */
	found?: readonly string[];
	/** Nobody has found any of these. */
	unfound?: readonly string[];
	/** All of these have happened. */
	events?: readonly string[];
	/** None of these has happened. */
	not?: readonly string[];
	/** This choice is waiting on the party. */
	pending?: string;
	/** World objects are in one of these states. */
	objects?: Readonly<Record<string, readonly ObjectState[]>>;
	/** The story is in one of these chapters. */
	chapter?: readonly string[];
	/** These lines, reactions or remembered moments (see `remember`) have happened. */
	said?: readonly string[];
	/** None of these has. */
	unsaid?: readonly string[];
	/** Choices made: decision id → the option chosen. */
	chose?: Readonly<Record<string, string>>;
	/** The fight at hand is in this phase. */
	phase?: string;
	/** Fights are in these states ('none' for never started). */
	fights?: Readonly<Record<string, 'active' | 'won' | 'lost' | 'none'>>;
}

/** Effects by id (a chapter's opening, an event's). */
export type EffectsTo = Readonly<Record<string, readonly Effect[]>>;

/** Some effects, if the conditions hold. */
export interface Rule {
	if?: When;
	do: readonly Effect[];
}

/** Something that happens to the story or the table. Each has exactly one kind. */
export type Effect =
	/** Narration (or, with a speaker, a line spoken); `private` tells only the character acting. */
	| { say: string; speaker?: string; private?: true; cue?: Cue; shot?: Shot }
	/** Evidence found by the character acting: theirs until they share it. */
	| { clue: string }
	/** Evidence the whole party learns at once (everyone saw it, or someone said it aloud). */
	| { tell: string }
	/** A story event. */
	| { event: string }
	/** A world object put in a state; with `if`, only when it is in that state now. */
	| { set: string; to: ObjectState | 'initial'; if?: ObjectState }
	/** Someone's state changes. */
	| { npc: string; becomes: string }
	/** A choice put to the party. */
	| { offer: string }
	/** A fight begins. */
	| { fight: string }
	/** The story moves straight to this chapter. */
	| { enter: string }
	/** A fight's sentries take their posts. */
	| { post: string }
	/** People go where they belong now (see `AdventureDef.peoplePlaces`). */
	| { settle: true }
	/** Cells the GM would reveal, revealed to everyone. */
	| { reveal: Area | 'all' }
	/** Players remember cells as explored (not who stands in them). */
	| { explore: Area | 'all' }
	/** A prop moves or makes a sound. */
	| { motion: { prop: string; kind: MotionKind | null; sound: Sound | null } }
	/** Every standing character recovers up to this many HP. */
	| { heal: number }
	/** Whoever keeps watch looks about (sentries may spot someone). */
	| { detect: true }
	/** A moment to remember (for `said` conditions later). */
	| { remember: string }
	/** Something the party earns (an item, a boon, a title), listed for them and at the end. */
	| { reward: string }
	/** Toward the fight phase's counter (a pull on the rope); `else` is said when no counter runs. */
	| { count: string; else?: string }
	/** The fight at hand moves to another phase. */
	| { phase: string }
	/** Its hazard opens (cracks under the party). */
	| { hazard: 'open' }
	/** A light changes. */
	| { light: string; on?: boolean; color?: string; radius?: number }
	/** A prop becomes another asset. */
	| { prop: string; asset: AssetId }
	/** The time of day. */
	| { ambient: Ambient }
	/** Standing characters near an object are hurt. */
	| { hurt: { near: string; within: number; dice: string; text: string } }
	/** An enemy comes up and joins the fight (the first free cell of `at`). */
	| { spawn: { kind: string; at: readonly GridPos[]; text: string } }
	/** The first of these rules whose conditions hold. */
	| { rules: readonly Rule[] };

// ---------------------------------------------------------------------------
// Scenes

export interface LocationDef {
	name: string;
	scene(): SceneFile;
	/** Where characters appear, in order. */
	spawn: readonly GridPos[];
	/** Greets someone arriving (a new player's welcome card). */
	welcome: string;
}

/** A place on a table that raises an event when a character walks in, while its chapter waits for it. */
export interface AreaDef extends Area {
	event: string;
	during: string;
	location: string;
	/** Only once this has happened. */
	after?: string;
}

// ---------------------------------------------------------------------------
// The story

export interface ObjectiveDef {
	id: string;
	text: string;
	/** Worth doing, but the story goes on without it. */
	optional?: boolean;
	/** Shown once this has happened (always shown if omitted). */
	after?: string;
	/** Done once this has happened. */
	done: string;
}

export interface ChapterDef {
	id: string;
	title: string;
	location: string;
	objectives: readonly ObjectiveDef[];
	/** The event that ends this chapter, and the chapter it leads to (null: the story ends). */
	next: { on: string; to: string | null };
	/** What happens as the party enters it. */
	opening?: readonly Effect[];
}

export interface EventDef {
	/** How it reads in the GM's list of what can be made to happen. */
	label: string;
	/** What it does to the table when it happens. */
	does?: readonly Effect[];
}

export interface DecisionDef {
	id: string;
	prompt: string;
	options: readonly {
		id: string;
		label: string;
		/** Other wordings, when their conditions hold (the first that does). */
		labels?: readonly { if: When; label: string }[];
		/** What choosing it does. */
		does: readonly Effect[];
	}[];
}

export interface EndingDef {
	subtitle: string;
	/** The first words of the end screen. */
	headline: string;
	text: string;
	/** The last look at the table, narrated with the ending's cue. */
	scene: string;
	cue: Cue;
	result: readonly { label: string; value: string }[];
	/** Said after the text, when their conditions hold (every one that does). */
	lines?: readonly Rule[];
	/** What the ending does to the table before its final scene. */
	does?: readonly Effect[];
}

/** How the story ends: the choice that decides it, and the ending each answer leads to. */
export interface EndingsDef {
	decision: string;
	/** The answer taken if the decision was never made. */
	fallback: string;
	/** Endings by answer (several answers may share an ending's id). */
	byAnswer: Readonly<Record<string, { ending: string } & EndingDef>>;
	/** What the ending ids are called (the three endings). */
	names: Readonly<Record<string, { title: string }>>;
}

// ---------------------------------------------------------------------------
// People

export interface Line {
	id: string;
	text: string;
	if?: When;
	/** Said only once. */
	once?: boolean;
	/** Told by the narrator rather than spoken. */
	narrated?: boolean;
	clue?: string;
	/** The speaker's new state. */
	becomes?: string;
	event?: string;
	/** Hit points restored to every standing character. */
	heals?: number;
}

export interface NpcDef {
	id: string;
	name: string;
	/** Who they are, for the GM. */
	role: string;
	/** Speaker label in the log. */
	speaker: string;
	token: string;
	color: string;
	/** The figure they are drawn as (a model asset). */
	model: string;
	location: string;
	/** Where they are found, for the GM. */
	home: string;
	/** Where they stand: `calm` normally, and other places by name (see `peoplePlaces`). */
	places: { calm: GridPos } & Readonly<Record<string, GridPos>>;
	/** The first is where they start. */
	states: readonly string[];
	/** In order of priority: the first that applies is said. The last should always apply. */
	lines: readonly Line[];
}

/** A line someone calls out when something happens: `object:verb` nearby, or `event:<id>`. Once each. */
export interface Reaction {
	id: string;
	npc: string;
	on: string;
	text: string;
	/** For interactions: only if the speaker stands within this many cells of the character. */
	within?: number;
}

// ---------------------------------------------------------------------------
// Objects

export interface Verb {
	id: string;
	label: string;
	/** States it can be done in. */
	from: readonly ObjectState[];
	/** The state it leaves the object in; unchanged if omitted. */
	to?: ObjectState;
	/** What kind of investigating it is; see `actionOfVerb` for the default. */
	action?: InvestigationAction;
	/** A check the character must pass first; one try per character. */
	check?: Check;
	/** What it physically does (see `Physical`); a change of state if omitted. */
	physical?: Physical;
	/** A carried item (world object id) the character must be holding. */
	needs?: string;
	/** The sound it makes, if not the usual one for what it does. */
	sound?: Sound;
	/** It can be done in a fight too, on the character's turn, as its action. */
	inFight?: true;
	/** A mechanism it sets going. */
	triggers?: string;
	/** What it does in the story: the first rule whose conditions hold (`state` is the object's before). */
	does?: readonly Rule[];
}

/** How a state shows on the table. Unlisted states keep the object's scene look. */
export interface Look {
	assetId?: AssetId;
	/** Shift from the object's place in the scene, in cells. */
	offset?: GridPos;
	/** The object's light (torches) switched on or off. */
	lit?: boolean;
}

export interface ObjectDef {
	id: string;
	name: string;
	kind: ObjectKind;
	location: string;
	/** What it is in the scene: a token (people), a prop, or a door. */
	thing: { token: string } | { prop: string } | { door: string };
	/** A light that belongs to it (a torch's flame). */
	light?: string;
	initial: ObjectState;
	/** States the GM can put it in. */
	states: readonly ObjectState[];
	verbs: readonly Verb[];
	looks?: Partial<Record<ObjectState, Look>>;
	/** What the refusal says when it is disabled (doors). */
	disabledText?: string;
	/** A secret door's edge: while hidden it is a plain wall (`<door id>-sealed`) there. */
	secret?: { a: GridPos; b: GridPos };
	/** An item: it can be picked up, carried from table to table, and put down anywhere. */
	carry?: true;
	/** A newcomer's first find: onboarding points new players at it, and it yields this clue. */
	firstFind?: string;
	/** Told privately to someone who looks around (Observe) within sight of it, until they find it. */
	noticed?: string;
	/** Only there while this light (a world object) is lit. */
	litBy?: string;
}

/** Evidence that is part of a place, found by listening or looking around nearby. */
export interface SignDef {
	id: string;
	location: string;
	sense: Sense;
	at: GridPos;
	range: number;
	check: Check;
	clue: string;
}

export interface ClueDef {
	id: string;
	title: string;
	text: string;
	kind: EvidenceKind;
	/** The story event it raises once the whole party knows it. */
	unlocks?: string;
}

/** A chain of changes one interaction sets off, played out step by step. */
export interface MechanismDef {
	id: string;
	/** Where it is: a mechanism stops if the party leaves the table. */
	location: string;
	steps: readonly {
		/** Ms after the previous step; the first runs as it is set off. */
		after: number;
		set?: { object: string; state: ObjectState };
		motion?: { prop: string; kind: MotionKind | null; sound: Sound | null };
		text?: string;
		event?: string;
	}[];
}

// ---------------------------------------------------------------------------
// Enemies and encounters

/** How an enemy chooses what to do on its turn (see ai.ts). */
export type Behavior = 'rush' | 'skirmish' | 'guardian' | 'grasp';

export interface EnemyDef {
	/** The figure it is drawn as (a model asset). */
	model: string;
	kind: string;
	name: string;
	/** Token colour, `#rrggbb`. */
	color: string;
	armor: number;
	speed: number;
	vision: number;
	/** Light it carries, in cells; 0 for none. */
	light: number;
	/** Added to its d20 for initiative. */
	initiative: number;
	/** Hit points for a party of this many characters. */
	hp: (characters: number) => number;
	/** The first is its melee attack; a second, longer one is ranged. */
	attacks: readonly Attack[];
	behavior: Behavior;
	/** A toll: damage and a slow to everyone standing within `range`, then a rest; told as `text`, lighting the table (`flash`). */
	toll?: {
		range: number;
		damage: string;
		rounds: number;
		every: number;
		text: string;
		flash: string;
	};
}

/** A foe in a fight: its kind, and hit points if not the kind's usual. */
export interface Foe {
	kind: string;
	hp?: (characters: number) => number;
}

/** Ground that gives way: cracks open under the party each round, and hurt whoever still stands on them. */
export interface HazardDef {
	/** The prop the cracks are drawn as, and its id prefix. */
	asset: AssetId;
	prefix: string;
	damage: string;
	/** Said as cracks open, as the ground heaves, and as someone is caught (`{name}`). */
	opens: string;
	heaves: string;
	caught: string;
	/** No cracks under this object, nor on the lowest ground (water). */
	avoid?: string;
}

/** A stage of a fight with its own rules (the Hollow waking, then the Bell ringing itself). */
export interface PhaseDef {
	/** Every foe down: this event happens (the fight goes on), or the fight simply goes on ('continue'). The fight is won if omitted. */
	cleared?: { event: string } | 'continue';
	/** From this round on, a new round raises this event. */
	until?: { round: number; event: string };
	hazard?: HazardDef;
	/** Something the party works toward, one step per `count` effect: done at `target`. */
	counter?: { label: string; target: number; reached: readonly Effect[] };
	/** At a new round: if nothing counted since the last one (`unanswered`), or if something did. */
	unanswered?: readonly Effect[];
	answered?: readonly Effect[];
}

export interface EncounterDef {
	name: string;
	/** Where it is fought (null: anywhere, the GM's own). */
	location: string | null;
	ring: readonly GridPos[];
	foes: readonly Foe[];
	/** More foes, when their conditions hold. */
	more?: readonly { if: When; foes: readonly Foe[] }[];
	/** Enemies already on the table, walking their rounds or standing guard. */
	sentries?: readonly { kind: string; route: readonly GridPos[] }[];
	/** Shown to everyone as the fight begins. */
	reveal?: Area;
	/** Said as the fight begins, and the camera shot it calls for. */
	opening?: string;
	shot?: Shot;
	/** The phase it starts in, and each phase's rules. */
	phases?: { first: string; all: Readonly<Record<string, PhaseDef>> };
	/** Won: what is said, the event it raises, and what else it does. */
	won?: { text?: string; event?: string; does?: readonly Effect[] };
	/** Called off by the GM: what it undoes. */
	calledOff?: readonly Effect[];
	/** What its first fallen enemy leaves where it fell: a world object's prop. */
	remains?: { object: string; prop: string; asset: AssetId };
}

// ---------------------------------------------------------------------------
// The adventure

/** Words the rules speak in the adventure's own voice. */
export interface Voice {
	started: string;
	notNow: string;
	nothingFound: string;
	hearNothing: string;
	seeNothing: string;
	cantMakeOut: string;
	blocked: string;
	revive: string;
	defeat: string;
	gone: string;
}

export interface AdventureDef {
	id: string;
	title: string;
	/** The version of its saved state (see persist.ts). */
	version: number;
	characters: Readonly<Record<string, CharacterDef>>;
	/** Where it starts, and what the arrival does when the GM begins. */
	start: { location: string; chapter: string; arrival: readonly Effect[] };
	locations: Readonly<Record<string, LocationDef>>;
	areas: readonly AreaDef[];
	chapters: Readonly<Record<string, ChapterDef>>;
	events: Readonly<Record<string, EventDef>>;
	decisions: Readonly<Record<string, DecisionDef>>;
	endings: EndingsDef;
	npcs: Readonly<Record<string, NpcDef>>;
	/** Where people stand by name when a condition holds (the first that does; else `calm`). */
	peoplePlaces: readonly { place: string; if: When }[];
	reactions: readonly Reaction[];
	objects: readonly ObjectDef[];
	signs: readonly SignDef[];
	clues: Readonly<Record<string, ClueDef>>;
	mechanisms: Readonly<Record<string, MechanismDef>>;
	enemies: Readonly<Record<string, EnemyDef>>;
	encounters: Readonly<Record<string, EncounterDef>>;
	/** What an enemy guards (the guardian behaviour), and the state that counts as touched. */
	ward?: { object: string; touched: ObjectState };
	/** Prepared text for the GM to read aloud. */
	cues: readonly { id: string; title: string; text: string }[];
	voice: Voice;
	/** Saved stories from older versions: answers and endings that were renamed. */
	renamed?: {
		options?: Readonly<Record<string, string>>;
		endings?: Readonly<Record<string, string>>;
	};
}

/** The GM's own fight: whoever the GM brought on, anywhere. Every adventure has it. */
export const AMBUSH = 'ambush';

/** Tokens a location starts with: its people. */
export type PeopleTokens = (location: string) => SavedToken[];
