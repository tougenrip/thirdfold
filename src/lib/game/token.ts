// Tokens: the miniatures on the table. System-agnostic: a token is a named,
// coloured piece at a grid cell, optionally controlled by one player.

import type { GridPos } from './grid';

export interface Token {
	id: string;
	name: string;
	/** `#rrggbb`. */
	color: string;
	pos: GridPos;
	/** Player allowed to move this token besides the GM; null means GM-only. */
	ownerId: string | null;
	/** How far the token sees, in cells, when fog of war is on. Only owned tokens reveal anything. */
	vision: number;
	/** Light the token carries (a torch), in cells; 0 for none. */
	light: number;
	/** GM: kept out of every player's and spectator's view (a lurking enemy); its owner still sees it. */
	hidden?: true;
}

export const TOKEN_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

/** Suggested colours for the GM's picker; any `#rrggbb` is accepted. */
export const TOKEN_COLORS = [
	'#c0392b',
	'#2e86c1',
	'#27ae60',
	'#d4ac0d',
	'#8e44ad',
	'#e67e22',
	'#16a085',
	'#ecf0f1'
] as const;

/** Upper bound on tokens per room, so one client cannot grow room state without limit. */
export const MAX_TOKENS_PER_ROOM = 200;

export function tokenAt(tokens: Iterable<Token>, pos: GridPos): Token | undefined {
	for (const t of tokens) if (t.pos.x === pos.x && t.pos.y === pos.y) return t;
	return undefined;
}
