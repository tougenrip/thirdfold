// Authoritative adventure state kept on a room. Plain data: tokens, walls and
// props stay in the room's scene; this records the story around them (stage,
// clues, hit points, the encounter) and refers to scene things by id.
//
// Who plays a character is not stored here: it is whoever owns the
// character's token, so the GM reassigning or removing the token just works.

import type { AdventureStage } from '../../src/lib/adventure/adventure';
import type { CharacterId } from '../../src/lib/adventure/characters';

export interface CharacterState {
	tokenId: string;
	hp: number;
}

export interface EnemyState {
	kind: 'hound';
	hp: number;
	maxHp: number;
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
	/** Read-aloud cues the GM has used. */
	cuesRead: Set<string>;
	encounter: Encounter | null;
	begunAt: number | null;
	completedAt: number | null;
}
