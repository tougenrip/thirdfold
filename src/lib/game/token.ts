// Tokens: the miniatures on the table. System-agnostic: a token is a named,
// coloured piece at a grid cell, optionally controlled by one player.

import type { GridPos } from './grid';

/** How a miniature is drawn; look only. Every field is optional. */
export interface TokenLook {
	/** Size against a plain miniature, 0.5 to 3. */
	scale: number;
	/** Raised off its floor, in levels (a flier), 0 to 10. */
	lift: number;
	/** The colour of the light it carries, `#rrggbb`. */
	lightColor: string;
}

export const TOKEN_SCALE = { min: 0.5, max: 3 };
export const MAX_TOKEN_LIFT = 10;

export interface Token extends Partial<TokenLook> {
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
	/**
	 * The figure it is drawn as: a model asset's id (see src/lib/assets/manifest.ts), or none for
	 * the plain miniature. Only the id is kept; the look comes from the asset.
	 */
	model?: string;
}

export const TOKEN_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const num = (v: unknown, min: number, max: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** The look fields present on `raw`, or null when any is invalid. Absent fields stay absent. */
export function parseTokenLook(raw: Record<string, unknown>): Partial<TokenLook> | null {
	const look: Partial<TokenLook> = {};
	if (raw.scale !== undefined) {
		if (!num(raw.scale, TOKEN_SCALE.min, TOKEN_SCALE.max)) return null;
		look.scale = raw.scale as number;
	}
	if (raw.lift !== undefined) {
		if (!num(raw.lift, 0, MAX_TOKEN_LIFT)) return null;
		look.lift = raw.lift as number;
	}
	if (raw.lightColor !== undefined) {
		if (typeof raw.lightColor !== 'string' || !TOKEN_COLOR_PATTERN.test(raw.lightColor)) {
			return null;
		}
		look.lightColor = raw.lightColor;
	}
	return look;
}

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
