// What a client is told about the adventure running at its table. The server
// computes one of these per viewer (enemies and things to interact with are
// filtered by what that viewer can see, and only the GM gets the read-aloud
// cues) and sends it with the room snapshot and as `adventure_update`.
//
// The reach rules below are shared: the server enforces them, the client
// uses them only to decide which buttons to offer.

import type { VersionsView } from './versions';
import { gridDistance, type GridPos } from '../game/grid';
import type { Blockers } from '../game/objects';
import type { CampaignStoryView } from '../game/campaign';
import type { CollectionView } from '../game/collection';
import type { Creator } from '../game/library';
import { hasLineOfSight } from '../game/visibility';
import type { Action, CharacterDef, CharacterId, StatusId } from './characters';

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
	/** The conditions the story's rules have, for the GM to put on someone (empty under rules without). */
	conditions: { id: string; name: string }[];
	/** Who a condition can be put on: the characters in play and the enemies on the table. */
	bearers: { tokenId: string; name: string }[];
	/**
	 * Under rules with a bestiary: the monsters brought into this story (on
	 * the table or not), and what the GM's own fight comes to as it stands;
	 * else null.
	 */
	bestiary: {
		monsters: MonsterListing[];
		/** The enemies on the table waiting for the GM's fight, and how hard it looks. */
		summary: EncounterSummary | null;
	} | null;
}

/**
 * A content pack a story has (homebrew under its rules, milestone 52), as
 * the table lists it: what it is, whose, and what it holds. What its records
 * say reaches a viewer only where the rules offer them (a creation page, a
 * sheet, the GM's bestiary).
 */
export interface ContentPackListing {
	id: string;
	name: string;
	/** The creator's own version of it. */
	version: string;
	creator: string | null;
	license: string | null;
	about: string | null;
	/** Its records by kind and name. */
	records: { kind: string; id: string; name: string }[];
	access: PackAccess;
}

/** Who a content pack belongs to and who may use it (prepared for milestones 53–55). */
export interface PackAccess {
	/** The public creator id of the GM key that brought it to the story (never the key), or null. */
	owner: string | null;
	/** `table`: shared with this story's table by its GM, and nobody else. */
	visibility: 'table';
}

/**
 * A monster a GM may bring to the table under the story's rules, as its
 * source prints it: its kind (the id the table plays it by), name, challenge
 * and XP, and what of it the table doesn't play yet.
 */
export interface MonsterListing {
	kind: string;
	name: string;
	/** e.g. "Small Fey (Goblinoid)". */
	type: string;
	challenge: string;
	xp: number;
	armorClass: number;
	hitPoints: number;
	/** Its attacks as the table plays them, in a line each. */
	attacks: string[];
	/** Its traits and actions the table doesn't play yet, by name. */
	notPlayed: string[];
	/** Where it comes from: "SRD 5.2.1, Monsters A–Z › Goblins, p. 289". */
	source: string;
}

/**
 * How hard a fight looks by its rules' own guidance: advisory only. The
 * monsters' total XP against the party's budgets, the band it falls in, and
 * the assumptions behind it, in words.
 */
export interface EncounterSummary {
	monsters: { name: string; count: number; xp: number }[];
	xp: number;
	party: { characters: number; levels: number[] };
	/** The budgets by difficulty, for this party ("Low", "Moderate", "High"). */
	budgets: { name: string; xp: number }[];
	/** Where the total falls: "Below Low", "Low", "Moderate", "High", "Beyond High". */
	band: string;
	notes: string[];
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

/**
 * A check a character must pass: a d20 plus its bonus for `stat`, against a
 * difficulty. What `stat` may name is the story's ruleset's (the classic
 * rules: might, agility, wits, spirit); `save` makes it a saving throw, for
 * rules that tell the two apart.
 */
export interface Check {
	stat: string;
	dc: number;
	save?: boolean;
}

/** A check as a character would make it, worked out by the story's rules on the server. */
export interface CheckView extends Check {
	/** What is rolled, e.g. "Wits" or "Wisdom (Perception)". */
	label: string;
	/** This viewer's character's bonus to it; null for a viewer without a character. */
	bonus: number | null;
}

/** The rules a story plays by, as the table shows them. */
export interface RulesInfo {
	id: string;
	version: number;
	name: string;
	/** Required credit for rules material from an outside source (a licence's attribution), if any. */
	attribution: string | null;
}

/** A number on a character's sheet, e.g. an ability or a skill. */
export interface SheetValue {
	id: string;
	name: string;
	/** What a d20 roll of it adds. */
	bonus: number;
	/** The score the bonus comes from, where the rules have one (an ability score). */
	score: number | null;
	/** Whether the character's proficiency counts, where the rules have proficiency. */
	proficient: boolean;
}

/**
 * A character's numbers as the story's rules work them out, sent by the
 * server so no client has to know the rules.
 */
export interface CharacterCard {
	/** Who the character is by the rules, e.g. "Orc Fighter 1 (Soldier)", where the rules say. */
	title?: string;
	/** Damage types it has Resistance to, where the rules have them. */
	resistances?: string[];
	/** e.g. "Defense" or "Armor Class", and its value now (statuses counted). */
	defense: { name: string; value: number };
	level: number | null;
	proficiency: number | null;
	/** What checks add, e.g. the four classic stats or six abilities. */
	stats: SheetValue[];
	/** Saving throws, for rules that have them. */
	saves: SheetValue[];
	/** Skills, for rules that have them. */
	skills: SheetValue[];
	/**
	 * Each action's one-line summary and the part of a turn it takes: `part` as
	 * `CharacterStatus.spent` lists it ("action", "bonus"), `partName` as players read it.
	 */
	actions: { id: string; summary: string; part: string; partName: string }[];
	/**
	 * Limited resources the rules give the character (spell slots, Second
	 * Wind, …), where the rules have them. `trackedBy` names the action whose
	 * uses count it (the table keeps that count); the rest a player marks by hand.
	 */
	resources?: CardResource[];
	/**
	 * Whether the rules have a full sheet for this character, which a page
	 * asks for when it opens it (`character_sheet`): it only changes with the
	 * character, so it stays out of the live view.
	 */
	details?: string;
	/**
	 * What the character owns, where the rules keep an inventory: each thing
	 * with its quantity, where it is equipped and where it came from. It
	 * changes in play (`adventure_gear`), so it travels with the card.
	 */
	inventory?: CardItem[];
	/** What it carries and can carry, in pounds, where the rules count weight. */
	carrying?: { weight: number; capacity: number };
}

/** Something a character owns, as the rules word it. */
export interface CardItem {
	/** The entry, to name it in a `GearChange`. */
	id: string;
	name: string;
	quantity: number;
	/** Where it is equipped, in words ("Worn", "Shield", "In hand"), or null when only carried. */
	equipped: string | null;
	/** What it is, in words: "Martial melee weapon", "Heavy armor", "Ammunition". */
	kind: string;
	/** What all of it weighs, in pounds. */
	weight: number;
	/** Where it came from, in words: "Starting equipment", "Given by The Veil". */
	source: string;
	/** Whether it is something to equip (armor, a Shield, a weapon). */
	equippable: boolean;
}

/**
 * A change to what a character carries (message `adventure_gear`), by its
 * player or the GM; the rules check it and work out what follows from it.
 */
export type GearChange =
	/** Wear armor, carry a Shield, take a weapon in hand. */
	| { kind: 'equip'; item: string }
	/** Take it off, or put it away. */
	| { kind: 'unequip'; item: string }
	/** Put some of it down where the character stands. */
	| { kind: 'drop'; item: string; quantity: number }
	/** Hand some of it to a character beside this one. */
	| { kind: 'give'; item: string; quantity: number; to: string }
	/** Pick up something lying beside the character (`AdventureView.piles`). */
	| { kind: 'take'; pile: string; index: number }
	/** The GM gives the character something from the rules' catalog. */
	| { kind: 'grant'; item: string; quantity: number };

/** Things put down on the table, which characters beside them may pick up. */
export interface PileView {
	/** The prop that shows it on the table. */
	id: string;
	cell: GridPos;
	items: { index: number; name: string }[];
}

/** A change to a character's sheet its player (or the GM) may make. */
export type SheetEdit =
	/** Rename a character its player built. */
	| { kind: 'name'; name: string }
	/** The player's own notes about the character. */
	| { kind: 'notes'; text: string }
	/** Mark uses of a resource spent (or restored), where the table doesn't track it itself. */
	| { kind: 'resource'; resource: string; spent: number }
	/** Let the table take the character's reaction for it (opportunity attacks), or hold it. */
	| { kind: 'reaction'; ready: boolean };

/** The most a character's notes may hold, in characters. */
export const SHEET_NOTES_MAX = 2000;

export interface CardResource {
	id: string;
	name: string;
	max: number;
	trackedBy: string | null;
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
	/** Its death saving throws while down, under rules that have them; else null. */
	deathSaves: { successes: number; failures: number; stable: boolean } | null;
	/**
	 * Its reaction, under rules that have them: ready (the table takes it for
	 * an opportunity attack), used since its turn began, or held by its
	 * player; null under rules without.
	 */
	reaction: 'ready' | 'used' | 'held' | null;
	statuses: ActiveStatus[];
	/** Uses left this encounter per action id; null means unlimited. */
	usesLeft: Record<string, number | null>;
	/** What it carries, by world object. */
	carrying: { id: string; name: string }[];
	/** Who the character is (name, colour, actions), as this story defines them. */
	def: CharacterDef;
	/** Its numbers by the story's rules. */
	card: CharacterCard;
	/** Parts of its turn already spent in the fight at hand ("action", "bonus"). */
	spent: string[];
	/** Uses spent of each of its card's resources, by id (those tracked by an action count its uses). */
	resourcesSpent: Record<string, number>;
	/** Its player's own notes: sent to its player and the GM only, else null. */
	notes: string | null;
	/** Whether this viewer may change the sheet (its player, or the GM). */
	editable: boolean;
	/** Whether this viewer may rename it (a character its player built). */
	renamable: boolean;
	/** Lasting effects on it (a spell's), as a line each: "Bless: +1d4 to attack rolls and saves". */
	effects: string[];
	/** The conditions it holds. */
	conditions: ConditionMark[];
	/** The spell it is concentrating on, if any. */
	concentrating: string | null;
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
		check: CheckView | null;
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
	/** Lasting effects on it (a spell's), as a line each: "Guiding Bolt: the next attack has advantage". */
	effects: string[];
	/** The conditions it holds. */
	conditions: ConditionMark[];
}

/** A condition someone holds, as the table shows it: the rules' words, where it came from, and how long it lasts. */
export interface ConditionMark {
	id: string;
	name: string;
	/** Its rules text. */
	text: string;
	/** What its text says that the table doesn't play yet. */
	notPlayed: string[];
	/** Exhaustion's level. */
	level?: number;
	/** The effect that gives it, and who that comes from ("Hideous Laughter, from the Ember"). */
	from: string;
	/** How long it lasts, in words ("until it saves: Wisdom DC 13"). */
	until: string;
	/** The effect, for the GM to remove. */
	effect: string;
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
	/** Things put down on this table that this viewer has seen, to pick up (rules with equipment). */
	piles: PileView[];
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
	/** What the party has earned so far, in order. */
	rewards: string[];
	/** The rules the story plays by. */
	rules: RulesInfo;
	/**
	 * Whether players may build their own character for this story under its
	 * rules (the rules' id, for the creation page), else null.
	 */
	build: { rules: string } | null;
	/** The content packs (homebrew) the story has; null under rules that take none. */
	packs: ContentPackListing[] | null;
	/** The collection the story was started from (milestone 53), else null. */
	collection: CollectionView | null;
	/** The campaign the story is played for (milestone 58), else null. */
	campaign: CampaignStoryView | null;
	/**
	 * What the story plays by, at the versions it found, and the moves made
	 * between versions (milestone 55): the GM's only, null for anyone else.
	 */
	versions: VersionsView | null;
	/** Where the adventure came from, when it is from the library; null otherwise. */
	library: LibrarySourceView | null;
	/** GM only: prepared text to read aloud. */
	cues: ReadAloud[] | null;
}

/** A library adventure a table plays: which version, whose, and what this viewer made of it. */
export interface LibrarySourceView {
	id: string;
	version: number;
	creator: Creator;
	/** The stars this viewer gave it, or null. */
	rated: number | null;
	/** Whether this viewer may rate it (they played it, it is over, and it isn't their own). */
	canRate: boolean;
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

/**
 * The cells of an area that starts at `origin` and is aimed at `aim` (a
 * spell's cone or cube from its caster), `size` cells long. A cone widens
 * as it goes, as wide as it is far (half a right angle's worth, about 26.6°
 * each side of its line), and reaches `size` cells along it. A cube's face
 * touches the origin: `size` cells square, straight ahead along the nearest
 * of the eight directions to the aim (centred on that line when it runs
 * along the grid, cornered on the origin when it runs diagonally). The
 * origin itself is never in either. A sphere is centred on the aim, `size`
 * cells in radius (a spell cast at a point). The server and the aiming preview use this
 * same rule.
 */
export function areaCells(
	origin: GridPos,
	aim: GridPos,
	area: { shape: 'cone' | 'cube' | 'sphere'; size: number },
	bounds: { width: number; height: number }
): GridPos[] {
	const cells: GridPos[] = [];
	const n = area.size;
	if (area.shape === 'sphere') {
		// Centred on the cell aimed at: every cell whose centre lies within the radius (and half a cell).
		for (let y = aim.y - n; y <= aim.y + n; y++)
			for (let x = aim.x - n; x <= aim.x + n; x++)
				if (
					x >= 0 &&
					y >= 0 &&
					x < bounds.width &&
					y < bounds.height &&
					Math.hypot(x - aim.x, y - aim.y) <= n + 0.5
				)
					cells.push({ x, y });
		return cells;
	}
	const dx = aim.x - origin.x;
	const dy = aim.y - origin.y;
	if (!dx && !dy) return [];
	const inside = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < bounds.width && y < bounds.height && (x !== origin.x || y !== origin.y);
	if (area.shape === 'cone') {
		const len = Math.hypot(dx, dy);
		const ux = dx / len;
		const uy = dy / len;
		const half = Math.atan(0.5) + 1e-6;
		for (let y = origin.y - n; y <= origin.y + n; y++)
			for (let x = origin.x - n; x <= origin.x + n; x++) {
				const cx = x - origin.x;
				const cy = y - origin.y;
				const along = cx * ux + cy * uy;
				if (along <= 0 || along > n + 1e-6) continue;
				const angle = Math.acos(Math.min(1, along / Math.hypot(cx, cy)));
				if (angle <= half && inside(x, y)) cells.push({ x, y });
			}
		return cells;
	}
	// The nearest of the eight directions.
	const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
	const sx = Math.round(Math.cos((octant * Math.PI) / 4));
	const sy = Math.round(Math.sin((octant * Math.PI) / 4));
	const side = (s: number, i: number) => (s === 0 ? i - Math.floor(n / 2) : s * (i + 1));
	for (let i = 0; i < n; i++)
		for (let j = 0; j < n; j++) {
			const x = origin.x + (sx === 0 ? side(0, j) : side(sx, i));
			const y = origin.y + (sy === 0 ? side(0, j) : side(sy, sx === 0 ? i : j));
			if (inside(x, y)) cells.push({ x, y });
		}
	return cells;
}
