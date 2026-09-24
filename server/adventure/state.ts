// Authoritative adventure state kept on a room. Plain data: tokens, walls and
// props stay in the room's scene; this records the story around them (stage,
// clues, hit points, the encounter) and refers to scene things by id.
//
// Who plays a character is not stored here: it is whoever owns the
// character's token, so the GM reassigning or removing the token just works.

import type { AdventureStage, ObjectState } from '../../src/lib/adventure/adventure';
import type { Origins } from './objects';
import type { CharacterId, StatusId } from '../../src/lib/adventure/characters';

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

export interface AdventureState {
	id: 'hollow-bell';
	stage: AdventureStage;
	characters: Map<CharacterId, CharacterState>;
	/** Clue ids in the order they were found. */
	clues: string[];
	/** Each world object's state, by object id (see objects.ts). */
	objects: Map<string, ObjectState>;
	/** Where object props started in the scene, for their looks. */
	origins: Origins;
	/** Read-aloud cues the GM has used. */
	cuesRead: Set<string>;
	encounter: Encounter | null;
	begunAt: number | null;
	completedAt: number | null;
}
