// Wire protocol shared by the game server and the browser client. Everything
// arriving from the network is untrusted: parse it with parseClientMessage /
// parseServerMessage (server-message.ts) rather than casting.

import {
	isObjectState,
	isSense,
	SHEET_NOTES_MAX,
	type AdventureView,
	type ObjectState,
	type Sense,
	type GearChange,
	type MonsterListing,
	type SheetEdit
} from '../adventure/adventure';
import { isStatusId, type CharacterId, type StatusId } from '../adventure/characters';
import { ASSET_ID_PATTERN } from '../assets/manifest';
import type { ChatMessage } from './chat';
import type { GridPos, SquareGrid } from './grid';
import {
	AMBIENTS,
	LIGHT_LOOK_KEYS,
	MAX_LIGHT_RADIUS,
	parseLightLook,
	type Ambient,
	type Light,
	type LightLook
} from './lights';
import type { SceneObject } from './objects';
import type { Motion } from './motion';
import {
	parsePropLook,
	resolveAssetId,
	PROP_SCALE,
	type AssetId,
	type Prop,
	type Rotation
} from './props';
import type { SceneFile } from './scene-file';
import { isFloorId, type FloorId } from './floor';
import { parseWorldPatch, type WorldLook, type WorldPatch } from './world';
import {
	CREATOR_ID_PATTERN,
	LIBRARY_ID_PATTERN,
	LIBRARY_LIMITS,
	LIBRARY_KINDS,
	LIBRARY_SORTS,
	type BuiltInStory,
	type Creator,
	type LibraryKind,
	type LibraryListing,
	type LibrarySort,
	type MyAdventure,
	type PublicGame,
	type SharedListing,
	type StoryDetail
} from './library';
import type { CollectionReport } from './collection';
import { GRANT_ID_PATTERN, parseNewGrant, type NewGrant } from './access';
import type { UpgradeReview } from '../adventure/versions';
import type { AdventurePreview } from '../adventure/preview';
import {
	CONTENT_KINDS,
	type ContentKind,
	type Diagnostic,
	type Validation
} from '../validation/diagnostics';
import { MAX_LEVEL } from './terrain';
import { parseTokenLook, TOKEN_COLOR_PATTERN, type Token } from './token';
import { MAX_VISION, type FogView } from './visibility';
import { NAME_MAX_LENGTH, normalizeName, ROOM_ID_PATTERN } from './names';

export { NAME_MAX_LENGTH, normalizeName, ROOM_ID_PATTERN };

export type Role = 'gm' | 'player' | 'spectator';
/** Roles a client may ask for when joining. GM is only ever the room creator. */
export type JoinRole = Exclude<Role, 'gm'>;

export interface PublicPlayer {
	id: string;
	name: string;
	role: Role;
	connected: boolean;
}

/** An adventure the server can run, as the GM picks one. */
export interface AdventureListing {
	id: string;
	title: string;
	about: string;
}

export interface RoomSnapshot {
	id: string;
	/** The adventures this server can run (the same for every table). */
	adventures: AdventureListing[];
	/** Name of the scene on the table (last saved, loaded or imported). */
	sceneName: string;
	grid: SquareGrid;
	players: PublicPlayer[];
	tokens: Token[];
	/** Walls and doors. */
	objects: SceneObject[];
	/** Furniture and scenery (with fog on: ones this client has seen). */
	props: Prop[];
	/** Light sources this client knows of (with fog on: ones it has seen). */
	lights: Light[];
	ambient: Ambient;
	/** What this client may see. With fog on, tokens and objects above are already filtered to it. */
	fog: FogView;
	/** Most recent room log entries, oldest first. */
	log: ChatMessage[];
	/** The adventure being played at this table (as this client may know it), or null for a free table. */
	adventure: AdventureView | null;
	/** Each cell's level (base64, see terrain.ts), as far as this client knows the ground; null when flat. */
	terrain: string | null;
	/** What each cell is made of (base64, see floor.ts), as far as this client knows; null when nothing is painted. */
	floor: string | null;
	/** The table's dark areas (a base64 CellMask), as far as this client knows them; null for none. */
	darkness: string | null;
	/** Roofed cells (a base64 CellMask), as far as this client knows them; null for none. Presentation only. */
	interior: string | null;
	/** The GM has paused the game. */
	paused: boolean;
	/** How the table looks (an environment asset's id), or null for the plain table. */
	environment: string | null;
	/** How the world looks (the hour, sky, weather, haze, grade, backdrop): the same for everyone. */
	world: WorldLook;
	/** The GM lists this game for anyone to find and join (else only its invite link leads here). */
	listed: boolean;
}

/** Fields the GM may change on an existing token. Omitted fields stay as they are. */
export interface TokenPatch {
	name?: string;
	color?: string;
	ownerId?: string | null;
	vision?: number;
	light?: number;
	/** Keep it out of players' views (true), or show it again (false). */
	hidden?: boolean;
	/** The model it is drawn as (an asset id), or null for the plain miniature. */
	model?: string | null;
	/** Look only (TokenLook): size, lift in levels, and the carried light's colour (null clears). */
	scale?: number;
	lift?: number;
	lightColor?: string | null;
}

/** Fields the GM may change on a placed prop: move, rotate, scale. */
export interface PropPatch {
	pos?: GridPos;
	rotation?: Rotation;
	scale?: number;
	/** Keep it out of players' views (true), or show it again (false). */
	hidden?: boolean;
	/** Look only (PropLook): a tint over the model (null clears) and its variant. */
	tint?: string | null;
	variant?: number;
}

/** Fields the GM may change on an existing light; a look field set to null goes back to its kind's. */
export type LightPatch = {
	radius?: number;
	color?: string;
	on?: boolean;
} & { [K in keyof LightLook]?: LightLook[K] | null };

export type ClientMessage =
	/**
	 * Opens a table as its GM. `gmKey` is the GM's lasting key (their saves are
	 * theirs by it; the server issues one if none is given); `continueFrom` is a
	 * save of theirs to open the table on.
	 */
	| { type: 'create'; name: string; gmKey?: string; continueFrom?: string }
	| { type: 'join'; roomId: string; name: string; role: JoinRole }
	| { type: 'resume'; roomId: string; sessionToken: string }
	| {
			type: 'token_create';
			name: string;
			color: string;
			pos: GridPos;
			ownerId: string | null;
	  }
	| { type: 'token_move'; tokenId: string; to: GridPos }
	| { type: 'token_update'; tokenId: string; patch: TokenPatch }
	| { type: 'token_delete'; tokenId: string }
	/** GM: a wall between two corners, or a door on one unit edge (cut into any wall there). */
	| { type: 'object_create'; kind: 'wall' | 'door'; a: GridPos; b: GridPos }
	| { type: 'object_delete'; objectId: string }
	/** Open or close a door: the GM always, a player only with a token beside it. */
	| { type: 'door_toggle'; objectId: string }
	/** GM: turn fog of war on or off for the room. */
	| { type: 'fog_set'; enabled: boolean }
	/** GM: reveal (or hide again) the rectangle of cells between two corner cells. */
	| { type: 'fog_area'; from: GridPos; to: GridPos; reveal: boolean }
	/** GM: reveal (or hide again) the whole room (walled-in space) around a cell. */
	| { type: 'fog_room'; cell: GridPos; reveal: boolean }
	/** GM: whether the party shares what it sees, or each player sees only through their own tokens. */
	| { type: 'fog_share'; shared: boolean }
	/** GM: place a prop from the catalog, its footprint starting at `pos`. */
	| { type: 'prop_create'; assetId: AssetId; pos: GridPos; rotation: Rotation }
	| { type: 'prop_update'; propId: string; patch: PropPatch }
	| { type: 'prop_delete'; propId: string }
	/** GM: place a light source on a cell. */
	| ({ type: 'light_create'; pos: GridPos; radius: number; color: string } & Partial<LightLook>)
	| { type: 'light_update'; lightId: string; patch: LightPatch }
	| { type: 'light_delete'; lightId: string }
	/** GM: the room's ambient light level. */
	| { type: 'ambient_set'; ambient: Ambient }
	/** GM: how the table looks (an environment asset's id), or null for the plain table. */
	| { type: 'environment_set'; environment: string | null }
	/** GM: the world's look (time, sky, weather, haze, grade, backdrop); with a sun the hour sets the band. */
	| { type: 'world_set'; patch: WorldPatch }
	/** GM: set the level (elevation) of every cell in the rectangle between two cells. */
	| { type: 'terrain_set'; from: GridPos; to: GridPos; level: number }
	/** GM: paints an area's floor, or puts it off the map (`void`). */
	| { type: 'floor_set'; from: GridPos; to: GridPos; floor: FloorId }
	| { type: 'darkness_set'; from: GridPos; to: GridPos; dark: boolean }
	/** GM: roofs (or unroofs) every cell in the rectangle between two cells. */
	| { type: 'interior_set'; from: GridPos; to: GridPos; roofed: boolean }
	/** GM: save the current table under a name. Replies with scene_saved. */
	| { type: 'scene_save'; name: string }
	/** GM: replace the table with a saved scene. */
	| { type: 'scene_load'; sceneId: string }
	/** GM: get the current table as a scene file (to download). Replies with scene_exported. */
	| { type: 'scene_export'; name: string }
	/** GM: replace the table with an uploaded scene file. The server validates it fully. */
	| { type: 'scene_import'; file: unknown }
	/**
	 * A GM's saves, newest first. At a table the GM's own; before joining one,
	 * the saves of `gmKey` (on the landing page). Replies with scene_list.
	 */
	| { type: 'scene_list'; gmKey?: string }
	/** GM: forget one of their saves. */
	| { type: 'scene_delete'; sceneId: string }
	/** GM: replace the table with a new, empty one of this size and look (and starting world). */
	| {
			type: 'scene_new';
			name: string;
			width: number;
			height: number;
			environment: string | null;
			world?: WorldPatch;
	  }
	/**
	 * GM: share the current table (the world, without the story or who plays
	 * whom). Replies with scene_shared: a code any GM can open it with.
	 */
	| { type: 'scene_share'; name: string }
	| { type: 'chat_send'; text: string }
	/** Roll dice; `secret` shows the result only to the roller and the GM. */
	| { type: 'dice_roll'; expression: string; secret?: true }
	/** GM: pause the game (players can't move or act; enemies wait) or carry on. */
	| { type: 'pause_set'; paused: boolean }
	/** GM: set up The Hollow Bell on this table (replaces the table). */
	/**
	 * GM: set up the server's adventure (`adventureId`), one from the library
	 * (`libraryId`, its latest version or `version`), or a creator's from an
	 * adventure file (checked in full).
	 */
	| {
			type: 'adventure_start';
			adventureId?: string;
			libraryId?: string;
			/** A collection from the library (milestone 53): its adventure `entry` (the first by default). */
			collectionId?: string;
			entry?: number;
			version?: number;
			file?: unknown;
	  }
	/** Player or GM, once a library adventure's story is over: 1-5 stars for it. */
	| { type: 'adventure_rate'; stars: number }
	/**
	 * GM: another version of the story's library content (milestone 55): its
	 * adventure, or the collection it was started from; the latest without a
	 * `version`. `review` says what would change and whether the story fits;
	 * `apply` moves it there (or back). Replies with upgrade_review.
	 */
	| {
			type: 'adventure_upgrade';
			op: 'review' | 'apply';
			what: 'adventure' | 'collection';
			version?: number;
	  }
	/** GM: list this game for anyone to find and join, or make it invite-only again. */
	| { type: 'room_listing'; listed: boolean }
	/** Anyone, at a table or not: the library's listed adventures (a creator's, with `creator`). */
	| {
			type: 'library_list';
			query?: string;
			creator?: string;
			sort?: LibrarySort;
			/** Adventures when absent; homebrew packs or collections when asked. */
			kind?: LibraryKind;
	  }
	/**
	 * Anyone: a collection from the library (its latest version, or `version`)
	 * and everything it names, found or not. Its creator's unlisted one with
	 * their `gmKey`. Replies with collection_report.
	 */
	| { type: 'collection_check'; id: string; version?: number; gmKey?: string }
	/**
	 * Anyone: one adventure, opened (its opening and facts), when they may
	 * read it: a public one, or with the `gmKey` of its owner or of someone
	 * it was shared with; its latest version, or `version` (milestone 55:
	 * every version stays readable). Replies with library_story.
	 */
	| { type: 'library_story'; id: string; gmKey?: string; version?: number }
	/**
	 * A creator's own published items, listed or not, and what others shared
	 * with them, by their GM key. Replies with library_mine.
	 */
	| { type: 'library_mine'; gmKey: string }
	/**
	 * Publishes an adventure file (checked in full) under a creator name; with
	 * `adventureId`, as the next version of one of the creator's. Without a
	 * GM key the server issues one (sent back in library_published).
	 */
	| {
			type: 'library_publish';
			gmKey?: string;
			creator: string;
			file: unknown;
			adventureId?: string;
			/** What `file` is: an adventure (the default), a homebrew pack or a collection. */
			kind?: LibraryKind;
	  }
	/**
	 * A creator makes one of their items public (`list`), private (`unlist`)
	 * or restricted (`restrict`), or removes it. Replies with library_mine.
	 */
	| { type: 'library_manage'; gmKey: string; adventureId: string; op: LibraryOp }
	/** A creator grants a role on one of their items (milestone 54). Replies with library_mine. */
	| { type: 'library_grant'; gmKey: string; adventureId: string; grant: NewGrant }
	/** A creator revokes a grant on one of their items. Replies with library_mine. */
	| { type: 'library_revoke'; gmKey: string; adventureId: string; grantId: string }
	/**
	 * Anyone: checks a piece of content the way the server will use it
	 * (milestone 56): an adventure file, a homebrew pack, a collection (as the
	 * `gmKey`'s creator may include its pieces, `collection` naming the one it
	 * becomes a version of), a character's `{ rules, choices }` or a saved
	 * table. Changes nothing. Replies with validation.
	 */
	| {
			type: 'content_validate';
			kind: ContentKind;
			file: unknown;
			gmKey?: string;
			collection?: string;
	  }
	/** Anyone: the games GMs have listed. */
	| { type: 'games_list' }
	/** Player: play this character (one each). */
	| { type: 'adventure_claim'; characterId: CharacterId }
	/** Player: give back your character, before play begins. */
	| { type: 'adventure_release' }
	/**
	 * Player: build your own character under the story's rules (where the
	 * story allows it) and take it to the table. `choices` is the rules' own
	 * shape, checked in full on the server.
	 */
	| { type: 'adventure_build'; choices: CharacterChoicesData }
	/** A character's player, or the GM: change its sheet (notes, a resource marked, a built character's name). */
	| { type: 'adventure_sheet'; characterId: CharacterId; edit: SheetEdit }
	/** A character's player (or the GM): equip, put away, drop, hand over or pick up something; the GM may grant. */
	| { type: 'adventure_gear'; characterId: CharacterId; change: GearChange }
	/** Anyone at the table: a character's full sheet, in its rules' shape. */
	| { type: 'character_sheet'; characterId: CharacterId }
	/** Anyone at the table: what a character may be built from, under the story's rules. */
	| { type: 'character_options' }
	/** GM: monsters the story's rules can bring on, matching a search (name, type or challenge). */
	| { type: 'monster_search'; query: string }
	/**
	 * Anyone, at a table or not (milestone 57: the builder): monsters a
	 * ruleset's bestiary can play, by name, type or challenge. Replies with
	 * monster_search.
	 */
	| { type: 'bestiary_search'; rules: { id: string; version: number }; query: string }
	/**
	 * GM: bring a content pack (homebrew under the story's rules, checked in
	 * full on the server) to the story, or take one out that nothing uses.
	 */
	| { type: 'adventure_pack'; op: 'attach'; pack: unknown }
	| { type: 'adventure_pack'; op: 'detach'; id: string }
	/** Anyone at the table: what these choices would come to, or what is wrong with them. Changes nothing. */
	| { type: 'character_preview'; choices: CharacterChoicesData }
	/** GM: characters are chosen, start playing. */
	| { type: 'adventure_begin' }
	/** Player: your character does `verb` (or the first thing it can) to something beside it. */
	| { type: 'adventure_interact'; targetId: string; verb: string | null }
	/** GM: put a world object in a state (reveal, hide, open, break, …). */
	| { type: 'adventure_object'; objectId: string; state: ObjectState }
	/** Player: your character uses an action (an attack, a heal, a guard) on a token, or on no one. */
	| {
			type: 'adventure_act';
			actionId: string;
			targetId: string | null;
			/** For a spell: the slot level to cast it with, its targets (darts may repeat one), or the cell an area is aimed at. */
			cast?: { slot: number | null; targets: string[]; at: GridPos | null };
	  }
	/** Player, in an encounter: your character is done for this round. */
	| { type: 'adventure_end_turn' }
	/** GM: put a condition on someone, or end a lasting effect. */
	| { type: 'adventure_effect'; op: EffectOp }
	/** GM: narrate to the table. */
	| { type: 'adventure_narrate'; text: string }
	/** GM: read one of the adventure's prepared passages aloud. */
	| { type: 'adventure_cue'; cueId: string }
	/** Answer the choice put to the party (a player for their character, or the GM). */
	| { type: 'adventure_decide'; decisionId: string; optionId: string }
	/** Player: their character listens or looks around where it stands. */
	| { type: 'adventure_sense'; sense: Sense }
	/** Player: tell the party about evidence their character found. */
	| { type: 'adventure_share'; clueId: string }
	/** GM: end whoever's turn it is now, start the story over, or stop the adventure (the table stays). */
	| { type: 'adventure_control'; op: AdventureControl }
	/** Player, once the story is over: ask the GM to play it again. */
	| { type: 'adventure_again' }
	/** GM: direct the story (raise an event, skip a scene, start or end a fight, bring on an enemy). */
	| { type: 'adventure_direct'; direction: Direction }
	/** GM: set a character's hit points and statuses, or bring them back from the dead. */
	| { type: 'adventure_override'; characterId: CharacterId; patch: CharacterPatch };

/** What the GM may set on a character. Omitted fields stay as they are. */
export interface CharacterPatch {
	hp?: number;
	/** The full set of statuses, each for one round. */
	statuses?: StatusId[];
	/** Bring a dead character back (at 1 HP if they had none). */
	revive?: true;
}

/** One of a GM's saves, as their list shows it. */
export interface SavedScene {
	id: string;
	name: string;
	savedAt: string;
	/** Saved by the table itself as the story went on (the GM's own saves are false). */
	auto: boolean;
	/** The story saved with it, if any: where it had got to and who was playing. */
	story: { title: string; chapter: string; location: string; party: string[] } | null;
}

/** A GM's lasting key, like a session token: 64 hex characters, secret. */
export const GM_KEY_PATTERN = /^[0-9a-f]{64}$/;
const SCENE_ID = /^[0-9a-f]{32}$/;

/** The sides of a new table, in cells. */
export const NEW_TABLE_LIMITS = { min: 4, max: 64 } as const;

export type AdventureControl = 'end_turn' | 'restart' | 'end';

export const LIBRARY_OPS = ['list', 'unlist', 'restrict', 'remove'] as const;
export type LibraryOp = (typeof LIBRARY_OPS)[number];

/**
 * What the GM directs. Ids are the story's own (events, fights, enemy kinds),
 * offered to the GM in its view of the adventure; the server checks them.
 */
export type Direction =
	/** Something in the story happens, as if the party had done it. */
	| { op: 'event'; event: string }
	/** On to the next scene: the fight at hand is won, and the chapter's event happens. */
	| { op: 'skip' }
	| { op: 'encounter_start'; encounter: string }
	/** The fight ends: won (the story goes on as if the party won) or called off (the enemies leave). */
	| { op: 'encounter_end'; result: 'won' | 'called_off' }
	/** An enemy appears on a cell: it joins the fight, or stands guard until it spots someone. */
	| {
			op: 'spawn';
			kind: string;
			pos: GridPos;
			/** Placed for the GM's own fight, started when the GM says: it spots nobody until then. */
			waiting?: boolean;
	  };

/** The longest monster search. */
/** A content pack's id: `hb-` and 16 hex digits. */
const PACK_ID = /^hb-[0-9a-f]{16}$/;

export const MONSTER_QUERY_MAX = 40;

export const ENCOUNTER_RESULTS = ['won', 'called_off'] as const;

/** The GM's ruling on a lasting effect: a condition on someone (for rounds of its turns, or until removed), or an effect ended. */
export type EffectOp =
	| { kind: 'apply'; target: string; condition: string; rounds: number | null }
	| { kind: 'remove'; effect: string };

/** Most rounds a GM's condition lasts, when timed. */
export const EFFECT_ROUNDS_MAX = 100;

function parseEffectOp(value: unknown): EffectOp | null {
	if (!isRecord(value)) return null;
	if (value.kind === 'remove')
		return typeof value.effect === 'string' && /^fx-\d{1,6}$/.test(value.effect)
			? { kind: 'remove', effect: value.effect }
			: null;
	if (value.kind !== 'apply' || !isId(value.target)) return null;
	if (typeof value.condition !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(value.condition))
		return null;
	const r = value.rounds;
	if (
		r !== null &&
		(typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > EFFECT_ROUNDS_MAX)
	)
		return null;
	return { kind: 'apply', target: value.target, condition: value.condition, rounds: r };
}

/** A player's character choices: plain, bounded JSON; the rules check what it says. */
export type CharacterChoicesData = Record<string, unknown>;

function parseSheetEdit(value: unknown): SheetEdit | null {
	if (!isRecord(value)) return null;
	switch (value.kind) {
		case 'name':
			return typeof value.name === 'string' && value.name.length <= 80
				? { kind: 'name', name: value.name }
				: null;
		case 'notes':
			return typeof value.text === 'string' && value.text.length <= SHEET_NOTES_MAX
				? { kind: 'notes', text: value.text }
				: null;
		case 'resource':
			return isId(value.resource) &&
				typeof value.spent === 'number' &&
				Number.isInteger(value.spent) &&
				value.spent >= 0 &&
				value.spent <= 999
				? { kind: 'resource', resource: value.resource, spent: value.spent }
				: null;
		case 'reaction':
			return typeof value.ready === 'boolean' ? { kind: 'reaction', ready: value.ready } : null;
		default:
			return null;
	}
}

/** A rules catalog id, e.g. srd-5.2.1:weapon:longsword. */
const isCatalogId = (v: unknown): v is string =>
	typeof v === 'string' && v.length <= 120 && /^[a-z0-9][a-z0-9.:-]*$/.test(v);
const isCount = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999;

function parseGearChange(value: unknown): GearChange | null {
	if (!isRecord(value)) return null;
	switch (value.kind) {
		case 'equip':
		case 'unequip':
			return isId(value.item) ? { kind: value.kind, item: value.item } : null;
		case 'drop':
			return isId(value.item) && isCount(value.quantity)
				? { kind: 'drop', item: value.item, quantity: value.quantity }
				: null;
		case 'give':
			return isId(value.item) && isCount(value.quantity) && isId(value.to)
				? { kind: 'give', item: value.item, quantity: value.quantity, to: value.to }
				: null;
		case 'take':
			return isId(value.pile) &&
				typeof value.index === 'number' &&
				Number.isInteger(value.index) &&
				value.index >= 0 &&
				value.index < 100
				? { kind: 'take', pile: value.pile, index: value.index }
				: null;
		case 'grant':
			return isCatalogId(value.item) && isCount(value.quantity)
				? { kind: 'grant', item: value.item, quantity: value.quantity }
				: null;
		default:
			return null;
	}
}

const CHOICES_LIMITS = { depth: 6, nodes: 400 };

/** Choices are an object of plain JSON, small enough for any character. */
function isChoices(value: unknown): value is CharacterChoicesData {
	const count = { nodes: 0 };
	const plain = (v: unknown, depth: number): boolean => {
		if (++count.nodes > CHOICES_LIMITS.nodes || depth > CHOICES_LIMITS.depth) return false;
		if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
		if (typeof v === 'number') return Number.isFinite(v);
		if (Array.isArray(v)) return v.every((x) => plain(x, depth + 1));
		if (!isRecord(v) || Object.getPrototypeOf(v) !== Object.prototype) return false;
		return Object.values(v).every((x) => plain(x, depth + 1));
	};
	return isRecord(value) && plain(value, 0);
}

export type ErrorCode =
	| 'invalid_message'
	| 'invalid_name'
	| 'room_not_found'
	| 'session_not_found'
	| 'already_joined'
	| 'not_joined'
	| 'forbidden'
	| 'token_not_found'
	| 'invalid_owner'
	| 'invalid_position'
	| 'cell_occupied'
	| 'limit_reached'
	| 'invalid_object'
	| 'object_not_found'
	| 'edge_occupied'
	| 'no_path'
	| 'light_not_found'
	| 'prop_not_found'
	| 'scene_not_found'
	| 'adventure_not_found'
	| 'invalid_scene'
	| 'persistence_failed'
	| 'invalid_chat'
	| 'invalid_dice'
	| 'rate_limited'
	| 'no_adventure'
	| 'character_taken'
	| 'not_your_turn'
	| 'out_of_reach'
	| 'paused'
	| 'server_error';

export type ServerMessage =
	/**
	 * Sent to a client once it has created, joined or resumed a room. `sessionToken`
	 * is private to that client; so is `gmKey`, sent only to the GM who opened the table.
	 */
	| { type: 'welcome'; playerId: string; sessionToken: string; room: RoomSnapshot; gmKey?: string }
	| { type: 'player_joined'; player: PublicPlayer }
	| { type: 'player_presence'; playerId: string; connected: boolean }
	/** A token was created or its properties changed. */
	| { type: 'token_upserted'; token: Token }
	| { type: 'token_moved'; tokenId: string; pos: GridPos; byPlayerId: string }
	| { type: 'token_deleted'; tokenId: string }
	/** Scene objects added/changed and removed, applied together (e.g. a wall split by a door). */
	| { type: 'objects_changed'; upserted: SceneObject[]; removed: string[] }
	/** Props added/changed and removed. */
	| { type: 'props_changed'; upserted: Prop[]; removed: string[] }
	/** Light sources added/changed and removed. */
	| { type: 'lights_changed'; upserted: Light[]; removed: string[] }
	| { type: 'ambient_update'; ambient: Ambient }
	| { type: 'environment_update'; environment: string | null }
	| { type: 'world_update'; world: WorldLook }
	/** This client's visibility changed (vision moved, doors, GM reveal, fog toggled). */
	| { type: 'fog_update'; fog: FogView }
	/** The ground this client knows changed (the GM reshaped it, or more of it was explored). */
	| { type: 'terrain_update'; terrain: string | null }
	| { type: 'floor_update'; floor: string | null }
	| { type: 'darkness_update'; darkness: string | null }
	/** The roofed cells this client knows changed. */
	| { type: 'interior_update'; interior: string | null }
	| { type: 'pause_update'; paused: boolean }
	/** To the GM who saved: where the scene is stored. Keep the id to load it again. */
	| { type: 'scene_saved'; sceneId: string; name: string; savedAt: string }
	/** To the GM who asked: their saves, newest first. */
	| { type: 'scene_list'; scenes: SavedScene[] }
	/** To the GM who asked: the current table as a scene file. */
	| { type: 'scene_exported'; file: SceneFile }
	/** To the GM who shared: the code (a scene id) that opens the shared table. */
	| { type: 'scene_shared'; code: string; name: string }
	/** The whole table changed (a scene was loaded): replace local room state with this. */
	| { type: 'room_reset'; room: RoomSnapshot }
	/** A new room log entry: chat, a dice result, or a system notice. */
	| { type: 'chat'; message: ChatMessage }
	/** Something on the table moves or sounds (a lever swings, a chain rattles); presentation only. */
	| { type: 'motion'; motions: Motion[] }
	/** The adventure changed (as this client may know it); null when it ended. */
	| { type: 'adventure_update'; adventure: AdventureView | null }
	/** The GM listed the game, or made it invite-only. */
	| { type: 'listing_update'; listed: boolean }
	/** To whoever asked: adventures in the library (and whose, when a creator's were asked for). */
	| {
			type: 'library_list';
			adventures: LibraryListing[];
			creator: Creator | null;
			/** The adventures that come with thirdfold (on the whole library, not a creator's page). */
			builtIn: BuiltInStory[];
	  }
	/**
	 * A collection and what became of everything it names; null when there is
	 * no such collection for the asker (`locked` when it is listed but
	 * restricted to those it was shared with).
	 */
	| { type: 'collection_report'; report: CollectionReport | null; locked?: boolean }
	/** One adventure opened, or null when there is none the asker may open (`locked`: restricted). */
	| { type: 'library_story'; story: StoryDetail | null; locked?: boolean }
	/**
	 * To a creator: their own items (with their grants), what others shared
	 * with them, and their public creator id (what others grant to).
	 */
	| {
			type: 'library_mine';
			adventures: MyAdventure[];
			shared: SharedListing[];
			creatorId: string;
	  }
	/** To the creator who published: where it is. `gmKey` only when the server just issued it. */
	| { type: 'library_published'; adventureId: string; version: number; gmKey?: string }
	/** To whoever asked: the games open to join. */
	| { type: 'games_list'; games: PublicGame[] }
	/** To whoever asked: a character's full sheet (the rules' own shape). */
	| {
			type: 'character_sheet';
			characterId: string;
			rules: string;
			details: Record<string, unknown>;
	  }
	/** To whoever asked: what a character may be built from (the rules' own shape). */
	| { type: 'character_options'; rules: string; options: Record<string, unknown> }
	/** To the GM who searched: the monsters found. */
	| { type: 'monster_search'; query: string; monsters: MonsterListing[] }
	/** To the GM who asked: what moving the story to another version would do, or did. */
	| { type: 'upgrade_review'; review: UpgradeReview; applied: boolean }
	/** To whoever asked: what the choices come to (the rules' own shape), or what is wrong. */
	| {
			type: 'character_preview';
			preview: { ok: true; summary: Record<string, unknown> } | { ok: false; problems: string[] };
	  }
	/** What a content_validate found; for an adventure that reads, what it comes to under its rules. */
	| { type: 'validation'; validation: Validation; preview?: AdventurePreview }
	/** A refusal; one of content carries what was found in it (milestone 56). */
	| { type: 'error'; code: ErrorCode; message: string; diagnostics?: Diagnostic[] };

const SESSION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const ID_MAX_LENGTH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX_LENGTH;
}

function isGmKey(value: unknown): value is string {
	return typeof value === 'string' && GM_KEY_PATTERN.test(value);
}

function isLibraryId(value: unknown): value is string {
	return typeof value === 'string' && LIBRARY_ID_PATTERN.test(value);
}

function isVersion(value: unknown): value is number {
	return (
		Number.isInteger(value) &&
		(value as number) >= 1 &&
		(value as number) <= LIBRARY_LIMITS.versions
	);
}

function isRoomId(value: unknown): value is string {
	return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

function isColor(value: unknown): value is string {
	return typeof value === 'string' && TOKEN_COLOR_PATTERN.test(value);
}

/** Shape check only (integers); whether the cell is on this room's grid is the server's call. */
function parseGridPos(value: unknown): GridPos | null {
	if (!isRecord(value)) return null;
	const { x, y } = value;
	return Number.isSafeInteger(x) && Number.isSafeInteger(y)
		? { x: x as number, y: y as number }
		: null;
}

function parseDirection(value: unknown): Direction | null {
	if (!isRecord(value)) return null;
	switch (value.op) {
		case 'event':
			return isId(value.event) ? { op: 'event', event: value.event } : null;
		case 'skip':
			return { op: 'skip' };
		case 'encounter_start':
			return isId(value.encounter) ? { op: 'encounter_start', encounter: value.encounter } : null;
		case 'encounter_end':
			return ENCOUNTER_RESULTS.includes(value.result as 'won')
				? { op: 'encounter_end', result: value.result as 'won' | 'called_off' }
				: null;
		case 'spawn': {
			const pos = parseGridPos(value.pos);
			if (value.waiting !== undefined && typeof value.waiting !== 'boolean') return null;
			return isId(value.kind) && pos
				? { op: 'spawn', kind: value.kind, pos, ...(value.waiting ? { waiting: true } : {}) }
				: null;
		}
		default:
			return null;
	}
}

function parseOwner(value: unknown): string | null | undefined {
	if (value === null) return null;
	return isId(value) ? value : undefined;
}

/** A reference to an asset (a model, an environment) by id: only ever the id, never content. */
function isAssetRef(value: unknown): value is string {
	return typeof value === 'string' && ASSET_ID_PATTERN.test(value);
}

function parseTokenPatch(value: unknown): TokenPatch | null {
	if (!isRecord(value)) return null;
	const patch: TokenPatch = {};
	if ('name' in value) {
		if (typeof value.name !== 'string') return null;
		patch.name = value.name;
	}
	if ('color' in value) {
		if (!isColor(value.color)) return null;
		patch.color = value.color;
	}
	if ('vision' in value) {
		const v = value.vision;
		if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_VISION) return null;
		patch.vision = v as number;
	}
	if ('light' in value) {
		const v = value.light;
		if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > MAX_LIGHT_RADIUS) return null;
		patch.light = v as number;
	}
	if ('ownerId' in value) {
		const owner = parseOwner(value.ownerId);
		if (owner === undefined) return null;
		patch.ownerId = owner;
	}
	if ('hidden' in value) {
		if (typeof value.hidden !== 'boolean') return null;
		patch.hidden = value.hidden;
	}
	if ('model' in value) {
		const model = value.model;
		if (model !== null && !isAssetRef(model)) return null;
		patch.model = model;
	}
	const { lightColor, ...rest } = value;
	const look = parseTokenLook({ ...rest, lightColor: lightColor ?? undefined });
	if (!look) return null;
	Object.assign(patch, look);
	if (lightColor === null) patch.lightColor = null;
	return Object.keys(patch).length > 0 ? patch : null;
}

function isRotation(value: unknown): value is Rotation {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function parsePropPatch(value: unknown): PropPatch | null {
	if (!isRecord(value)) return null;
	const patch: PropPatch = {};
	if ('pos' in value) {
		const pos = parseGridPos(value.pos);
		if (!pos) return null;
		patch.pos = pos;
	}
	if ('rotation' in value) {
		if (!isRotation(value.rotation)) return null;
		patch.rotation = value.rotation;
	}
	if ('scale' in value) {
		const s = value.scale;
		if (typeof s !== 'number' || !(s >= PROP_SCALE.min && s <= PROP_SCALE.max)) return null;
		patch.scale = s;
	}
	if ('hidden' in value) {
		if (typeof value.hidden !== 'boolean') return null;
		patch.hidden = value.hidden;
	}
	const look = parsePropLook({ variant: value.variant, tint: value.tint ?? undefined });
	if (!look) return null;
	Object.assign(patch, look);
	if (value.tint === null) patch.tint = null;
	return Object.keys(patch).length > 0 ? patch : null;
}

function isLightRadius(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_LIGHT_RADIUS;
}

function parseLightPatch(value: unknown): LightPatch | null {
	if (!isRecord(value)) return null;
	const patch: LightPatch = {};
	if ('radius' in value) {
		if (!isLightRadius(value.radius)) return null;
		patch.radius = value.radius;
	}
	if ('color' in value) {
		if (!isColor(value.color)) return null;
		patch.color = value.color;
	}
	if ('on' in value) {
		if (typeof value.on !== 'boolean') return null;
		patch.on = value.on;
	}
	const set: Record<string, unknown> = {};
	for (const key of LIGHT_LOOK_KEYS) {
		if (value[key] === null) (patch as Record<string, unknown>)[key] = null;
		else if (value[key] !== undefined) set[key] = value[key];
	}
	const look = parseLightLook(set);
	if (!look) return null;
	Object.assign(patch, look);
	return Object.keys(patch).length > 0 ? patch : null;
}

function parseCharacterPatch(value: unknown): CharacterPatch | null {
	if (!isRecord(value)) return null;
	const patch: CharacterPatch = {};
	if ('hp' in value) {
		if (!Number.isInteger(value.hp) || (value.hp as number) < 0 || (value.hp as number) > 999)
			return null;
		patch.hp = value.hp as number;
	}
	if ('statuses' in value) {
		const list = value.statuses;
		if (!Array.isArray(list) || list.length > 10 || !list.every(isStatusId)) return null;
		patch.statuses = [...new Set(list)];
	}
	if ('revive' in value) {
		if (value.revive !== true) return null;
		patch.revive = true;
	}
	return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Validates the shape of a client message and drops unknown fields. Semantic
 * checks (name rules, permissions, room existence, bounds) belong to the server.
 */
export function parseClientMessage(data: unknown): ClientMessage | null {
	if (!isRecord(data)) return null;
	switch (data.type) {
		case 'create': {
			if (typeof data.name !== 'string') return null;
			const msg: Extract<ClientMessage, { type: 'create' }> = { type: 'create', name: data.name };
			if (data.gmKey !== undefined) {
				if (typeof data.gmKey !== 'string' || !GM_KEY_PATTERN.test(data.gmKey)) return null;
				msg.gmKey = data.gmKey;
			}
			if (data.continueFrom !== undefined) {
				if (typeof data.continueFrom !== 'string' || !SCENE_ID.test(data.continueFrom)) return null;
				msg.continueFrom = data.continueFrom;
			}
			return msg;
		}
		case 'join':
			if (!isRoomId(data.roomId) || typeof data.name !== 'string') return null;
			if (data.role !== 'player' && data.role !== 'spectator') return null;
			return { type: 'join', roomId: data.roomId, name: data.name, role: data.role };
		case 'resume':
			if (!isRoomId(data.roomId)) return null;
			if (typeof data.sessionToken !== 'string' || !SESSION_TOKEN_PATTERN.test(data.sessionToken))
				return null;
			return { type: 'resume', roomId: data.roomId, sessionToken: data.sessionToken };
		case 'token_create': {
			const pos = parseGridPos(data.pos);
			const ownerId = parseOwner(data.ownerId);
			if (typeof data.name !== 'string' || !isColor(data.color) || !pos || ownerId === undefined)
				return null;
			return { type: 'token_create', name: data.name, color: data.color, pos, ownerId };
		}
		case 'token_move': {
			const to = parseGridPos(data.to);
			return isId(data.tokenId) && to ? { type: 'token_move', tokenId: data.tokenId, to } : null;
		}
		case 'token_update': {
			const patch = parseTokenPatch(data.patch);
			return isId(data.tokenId) && patch
				? { type: 'token_update', tokenId: data.tokenId, patch }
				: null;
		}
		case 'token_delete':
			return isId(data.tokenId) ? { type: 'token_delete', tokenId: data.tokenId } : null;
		case 'object_create': {
			const a = parseGridPos(data.a);
			const b = parseGridPos(data.b);
			if ((data.kind !== 'wall' && data.kind !== 'door') || !a || !b) return null;
			return { type: 'object_create', kind: data.kind, a, b };
		}
		case 'object_delete':
			return isId(data.objectId) ? { type: 'object_delete', objectId: data.objectId } : null;
		case 'door_toggle':
			return isId(data.objectId) ? { type: 'door_toggle', objectId: data.objectId } : null;
		case 'fog_set':
			return typeof data.enabled === 'boolean' ? { type: 'fog_set', enabled: data.enabled } : null;
		case 'fog_area': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			if (!from || !to || typeof data.reveal !== 'boolean') return null;
			return { type: 'fog_area', from, to, reveal: data.reveal };
		}
		case 'fog_room': {
			const cell = parseGridPos(data.cell);
			if (!cell || typeof data.reveal !== 'boolean') return null;
			return { type: 'fog_room', cell, reveal: data.reveal };
		}
		case 'fog_share':
			return typeof data.shared === 'boolean' ? { type: 'fog_share', shared: data.shared } : null;
		case 'prop_create': {
			const pos = parseGridPos(data.pos);
			const assetId = resolveAssetId(data.assetId);
			if (!assetId || !pos || !isRotation(data.rotation)) return null;
			return { type: 'prop_create', assetId, pos, rotation: data.rotation };
		}
		case 'prop_update': {
			const patch = parsePropPatch(data.patch);
			return isId(data.propId) && patch
				? { type: 'prop_update', propId: data.propId, patch }
				: null;
		}
		case 'prop_delete':
			return isId(data.propId) ? { type: 'prop_delete', propId: data.propId } : null;
		case 'light_create': {
			const pos = parseGridPos(data.pos);
			if (!pos || !isLightRadius(data.radius) || !isColor(data.color)) return null;
			const look = parseLightLook(data);
			if (!look) return null;
			return { type: 'light_create', pos, radius: data.radius, color: data.color, ...look };
		}
		case 'light_update': {
			const patch = parseLightPatch(data.patch);
			return isId(data.lightId) && patch
				? { type: 'light_update', lightId: data.lightId, patch }
				: null;
		}
		case 'light_delete':
			return isId(data.lightId) ? { type: 'light_delete', lightId: data.lightId } : null;
		case 'terrain_set': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			const level = data.level;
			return from &&
				to &&
				Number.isInteger(level) &&
				(level as number) >= 0 &&
				(level as number) <= MAX_LEVEL
				? { type: 'terrain_set', from, to, level: level as number }
				: null;
		}
		case 'floor_set': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			return from && to && isFloorId(data.floor)
				? { type: 'floor_set', from, to, floor: data.floor }
				: null;
		}
		case 'darkness_set': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			return from && to && typeof data.dark === 'boolean'
				? { type: 'darkness_set', from, to, dark: data.dark }
				: null;
		}
		case 'interior_set': {
			const from = parseGridPos(data.from);
			const to = parseGridPos(data.to);
			return from && to && typeof data.roofed === 'boolean'
				? { type: 'interior_set', from, to, roofed: data.roofed }
				: null;
		}
		case 'environment_set': {
			const environment = data.environment;
			return environment === null || isAssetRef(environment)
				? { type: 'environment_set', environment }
				: null;
		}
		case 'world_set': {
			const patch = parseWorldPatch(data.patch);
			return patch ? { type: 'world_set', patch } : null;
		}
		case 'ambient_set':
			return AMBIENTS.includes(data.ambient as Ambient)
				? { type: 'ambient_set', ambient: data.ambient as Ambient }
				: null;
		case 'scene_save':
			return typeof data.name === 'string' ? { type: 'scene_save', name: data.name } : null;
		case 'scene_export':
			return typeof data.name === 'string' ? { type: 'scene_export', name: data.name } : null;
		case 'scene_load':
			return typeof data.sceneId === 'string' && /^[0-9a-f]{32}$/.test(data.sceneId)
				? { type: 'scene_load', sceneId: data.sceneId }
				: null;
		case 'scene_import':
			return isRecord(data.file) ? { type: 'scene_import', file: data.file } : null;
		case 'scene_list':
			if (data.gmKey === undefined) return { type: 'scene_list' };
			return typeof data.gmKey === 'string' && GM_KEY_PATTERN.test(data.gmKey)
				? { type: 'scene_list', gmKey: data.gmKey }
				: null;
		case 'scene_delete':
			return typeof data.sceneId === 'string' && SCENE_ID.test(data.sceneId)
				? { type: 'scene_delete', sceneId: data.sceneId }
				: null;
		case 'scene_new': {
			const size = (v: unknown) =>
				Number.isInteger(v) &&
				(v as number) >= NEW_TABLE_LIMITS.min &&
				(v as number) <= NEW_TABLE_LIMITS.max;
			const environment = data.environment ?? null;
			const world = data.world === undefined ? undefined : parseWorldPatch(data.world);
			return typeof data.name === 'string' &&
				size(data.width) &&
				size(data.height) &&
				(environment === null || isAssetRef(environment)) &&
				world !== null
				? {
						type: 'scene_new',
						name: data.name,
						width: data.width as number,
						height: data.height as number,
						environment,
						...(world && { world })
					}
				: null;
		}
		case 'scene_share':
			return typeof data.name === 'string' ? { type: 'scene_share', name: data.name } : null;
		case 'chat_send':
			return typeof data.text === 'string' ? { type: 'chat_send', text: data.text } : null;
		case 'dice_roll':
			if (typeof data.expression !== 'string') return null;
			return data.secret === true
				? { type: 'dice_roll', expression: data.expression, secret: true }
				: { type: 'dice_roll', expression: data.expression };
		case 'pause_set':
			return typeof data.paused === 'boolean' ? { type: 'pause_set', paused: data.paused } : null;
		case 'adventure_direct': {
			const direction = parseDirection(data.direction);
			return direction ? { type: 'adventure_direct', direction } : null;
		}
		case 'adventure_start':
			if (data.file !== undefined) {
				return isRecord(data.file) ? { type: 'adventure_start', file: data.file } : null;
			}
			if (data.collectionId !== undefined) {
				if (!isLibraryId(data.collectionId)) return null;
				if (data.version !== undefined && !isVersion(data.version)) return null;
				if (
					data.entry !== undefined &&
					!(
						Number.isInteger(data.entry) &&
						(data.entry as number) >= 0 &&
						(data.entry as number) < 12
					)
				)
					return null;
				return {
					type: 'adventure_start',
					collectionId: data.collectionId,
					...(data.version !== undefined ? { version: data.version as number } : {}),
					...(data.entry !== undefined ? { entry: data.entry as number } : {})
				};
			}
			if (data.libraryId !== undefined) {
				if (!isLibraryId(data.libraryId)) return null;
				if (data.version === undefined) {
					return { type: 'adventure_start', libraryId: data.libraryId };
				}
				return isVersion(data.version)
					? { type: 'adventure_start', libraryId: data.libraryId, version: data.version }
					: null;
			}
			if (data.adventureId !== undefined) {
				return isId(data.adventureId)
					? { type: 'adventure_start', adventureId: data.adventureId }
					: null;
			}
			return { type: 'adventure_start' };
		case 'adventure_upgrade':
			if (data.op !== 'review' && data.op !== 'apply') return null;
			if (data.what !== 'adventure' && data.what !== 'collection') return null;
			if (data.version !== undefined && !isVersion(data.version)) return null;
			return {
				type: 'adventure_upgrade',
				op: data.op,
				what: data.what,
				...(data.version !== undefined ? { version: data.version as number } : {})
			};
		case 'adventure_rate':
			return Number.isInteger(data.stars) &&
				(data.stars as number) >= 1 &&
				(data.stars as number) <= 5
				? { type: 'adventure_rate', stars: data.stars as number }
				: null;
		case 'room_listing':
			return typeof data.listed === 'boolean'
				? { type: 'room_listing', listed: data.listed }
				: null;
		case 'library_story':
			if (!isLibraryId(data.id)) return null;
			if (data.gmKey !== undefined && !isGmKey(data.gmKey)) return null;
			if (data.version !== undefined && !isVersion(data.version)) return null;
			return {
				type: 'library_story',
				id: data.id,
				...(data.gmKey !== undefined ? { gmKey: data.gmKey } : {}),
				...(data.version !== undefined ? { version: data.version as number } : {})
			};
		case 'library_list': {
			const out: Extract<ClientMessage, { type: 'library_list' }> = { type: 'library_list' };
			if (data.query !== undefined) {
				if (typeof data.query !== 'string' || data.query.length > LIBRARY_LIMITS.query) return null;
				out.query = data.query;
			}
			if (data.creator !== undefined) {
				if (typeof data.creator !== 'string' || !CREATOR_ID_PATTERN.test(data.creator)) return null;
				out.creator = data.creator;
			}
			if (data.sort !== undefined) {
				if (!LIBRARY_SORTS.includes(data.sort as LibrarySort)) return null;
				out.sort = data.sort as LibrarySort;
			}
			if (data.kind !== undefined) {
				if (!LIBRARY_KINDS.includes(data.kind as LibraryKind)) return null;
				out.kind = data.kind as LibraryKind;
			}
			return out;
		}
		case 'collection_check':
			if (!isLibraryId(data.id)) return null;
			if (data.version !== undefined && !isVersion(data.version)) return null;
			if (data.gmKey !== undefined && !isGmKey(data.gmKey)) return null;
			return {
				type: 'collection_check',
				id: data.id,
				...(data.version !== undefined ? { version: data.version as number } : {}),
				...(data.gmKey !== undefined ? { gmKey: data.gmKey } : {})
			};
		case 'library_mine':
			return isGmKey(data.gmKey) ? { type: 'library_mine', gmKey: data.gmKey } : null;
		case 'content_validate':
			if (!CONTENT_KINDS.includes(data.kind as ContentKind) || !isRecord(data.file)) return null;
			if (data.gmKey !== undefined && !isGmKey(data.gmKey)) return null;
			if (data.collection !== undefined && !isLibraryId(data.collection)) return null;
			return {
				type: 'content_validate',
				kind: data.kind as ContentKind,
				file: data.file,
				...(data.gmKey !== undefined ? { gmKey: data.gmKey } : {}),
				...(data.collection !== undefined ? { collection: data.collection } : {})
			};
		case 'library_publish': {
			if (typeof data.creator !== 'string' || !isRecord(data.file)) return null;
			if (data.gmKey !== undefined && !isGmKey(data.gmKey)) return null;
			if (data.adventureId !== undefined && !isLibraryId(data.adventureId)) return null;
			if (data.kind !== undefined && !LIBRARY_KINDS.includes(data.kind as LibraryKind)) return null;
			return {
				type: 'library_publish',
				creator: data.creator,
				file: data.file,
				...(data.kind !== undefined ? { kind: data.kind as LibraryKind } : {}),
				...(data.gmKey !== undefined ? { gmKey: data.gmKey } : {}),
				...(data.adventureId !== undefined ? { adventureId: data.adventureId } : {})
			};
		}
		case 'library_manage':
			return isGmKey(data.gmKey) &&
				isLibraryId(data.adventureId) &&
				LIBRARY_OPS.includes(data.op as LibraryOp)
				? {
						type: 'library_manage',
						gmKey: data.gmKey,
						adventureId: data.adventureId,
						op: data.op as LibraryOp
					}
				: null;
		case 'library_grant': {
			if (!isGmKey(data.gmKey) || !isLibraryId(data.adventureId)) return null;
			const parsed = parseNewGrant(data.grant);
			return parsed.ok
				? {
						type: 'library_grant',
						gmKey: data.gmKey,
						adventureId: data.adventureId,
						grant: parsed.grant
					}
				: null;
		}
		case 'library_revoke':
			return isGmKey(data.gmKey) &&
				isLibraryId(data.adventureId) &&
				typeof data.grantId === 'string' &&
				GRANT_ID_PATTERN.test(data.grantId)
				? {
						type: 'library_revoke',
						gmKey: data.gmKey,
						adventureId: data.adventureId,
						grantId: data.grantId
					}
				: null;
		case 'games_list':
			return { type: 'games_list' };
		case 'adventure_release':
		case 'adventure_begin':
		case 'adventure_end_turn':
			return { type: data.type };
		case 'adventure_claim':
			return isId(data.characterId)
				? { type: 'adventure_claim', characterId: data.characterId }
				: null;
		case 'adventure_interact': {
			if (!isId(data.targetId)) return null;
			const verb = data.verb ?? null;
			if (verb !== null && !isId(verb)) return null;
			return { type: 'adventure_interact', targetId: data.targetId, verb };
		}
		case 'adventure_object':
			return isId(data.objectId) && isObjectState(data.state)
				? { type: 'adventure_object', objectId: data.objectId, state: data.state }
				: null;
		case 'adventure_act': {
			if (!isId(data.actionId)) return null;
			if (data.targetId !== null && !isId(data.targetId)) return null;
			if (data.cast === undefined)
				return { type: 'adventure_act', actionId: data.actionId, targetId: data.targetId };
			const cast = parseCast(data.cast);
			return cast
				? { type: 'adventure_act', actionId: data.actionId, targetId: data.targetId, cast }
				: null;
		}
		case 'adventure_effect': {
			const op = parseEffectOp(data.op);
			return op ? { type: 'adventure_effect', op } : null;
		}
		case 'adventure_override': {
			const patch = parseCharacterPatch(data.patch);
			return isId(data.characterId) && patch
				? { type: 'adventure_override', characterId: data.characterId, patch }
				: null;
		}
		case 'adventure_narrate':
			return typeof data.text === 'string' ? { type: 'adventure_narrate', text: data.text } : null;
		case 'adventure_cue':
			return isId(data.cueId) ? { type: 'adventure_cue', cueId: data.cueId } : null;
		case 'adventure_sense':
			return isSense(data.sense) ? { type: 'adventure_sense', sense: data.sense } : null;
		case 'adventure_share':
			return isId(data.clueId) ? { type: 'adventure_share', clueId: data.clueId } : null;
		case 'adventure_decide':
			return isId(data.decisionId) && isId(data.optionId)
				? { type: 'adventure_decide', decisionId: data.decisionId, optionId: data.optionId }
				: null;
		case 'adventure_again':
			return { type: 'adventure_again' };
		case 'adventure_sheet': {
			const edit = parseSheetEdit(data.edit);
			return isId(data.characterId) && edit
				? { type: 'adventure_sheet', characterId: data.characterId, edit }
				: null;
		}
		case 'adventure_gear': {
			const change = parseGearChange(data.change);
			return isId(data.characterId) && change
				? { type: 'adventure_gear', characterId: data.characterId, change }
				: null;
		}
		case 'character_options':
			return { type: 'character_options' };
		case 'adventure_pack':
			if (data.op === 'attach')
				return isRecord(data.pack)
					? { type: 'adventure_pack', op: 'attach', pack: data.pack }
					: null;
			return data.op === 'detach' && typeof data.id === 'string' && PACK_ID.test(data.id)
				? { type: 'adventure_pack', op: 'detach', id: data.id }
				: null;
		case 'bestiary_search': {
			const r = data.rules;
			if (!isRecord(r) || typeof r.id !== 'string' || !/^[a-z][a-z0-9.-]{0,47}$/.test(r.id))
				return null;
			if (!Number.isSafeInteger(r.version) || (r.version as number) < 1) return null;
			if (typeof data.query !== 'string' || data.query.length > MONSTER_QUERY_MAX) return null;
			return {
				type: 'bestiary_search',
				rules: { id: r.id, version: r.version as number },
				query: data.query
			};
		}
		case 'monster_search':
			return typeof data.query === 'string' && data.query.length <= MONSTER_QUERY_MAX
				? { type: 'monster_search', query: data.query }
				: null;
		case 'character_sheet':
			return isId(data.characterId)
				? { type: 'character_sheet', characterId: data.characterId }
				: null;
		case 'adventure_build':
		case 'character_preview':
			return isChoices(data.choices) ? { type: data.type, choices: data.choices } : null;
		case 'adventure_control':
			return data.op === 'end_turn' || data.op === 'restart' || data.op === 'end'
				? { type: 'adventure_control', op: data.op }
				: null;
		default:
			return null;
	}
}
/** Most targets a cast may name (darts and blessings at a high slot). */
export const CAST_TARGETS_MAX = 12;

function parseCast(
	raw: unknown
): { slot: number | null; targets: string[]; at: GridPos | null } | null {
	if (!isRecord(raw)) return null;
	const { slot, targets, at } = raw;
	if (slot !== null && (!Number.isInteger(slot) || (slot as number) < 0 || (slot as number) > 9))
		return null;
	if (!Array.isArray(targets) || targets.length > CAST_TARGETS_MAX || !targets.every(isId))
		return null;
	const cell = at === null ? null : parseGridPos(at);
	if (at !== null && !cell) return null;
	return { slot: slot as number | null, targets: [...targets], at: cell };
}
