// The room log: player chat, dice results and system notices, in one
// ordered stream. Text is always plain text; clients must render it as such.

import type { DiceRoll } from './dice';
import type { GridPos } from './grid';

/**
 * Who may read a log entry, when not everyone: the GM only, or the GM and
 * these players (someone who found something by themselves).
 */
export type LogAudience = 'gm' | { players: string[] };

/**
 * A cinematic moment for clients to play with a line of narration: the bell
 * tolling (the bell swings, dust falls, the table shakes), or a flash of
 * light over the table. Presentation only; nothing about the game state
 * depends on it (a flash's effect on sight is the server's, sent as fog).
 */
export type Cue = 'toll' | 'flash';

export const CUES: readonly Cue[] = ['toll', 'flash'];

/**
 * A camera move a moment calls for: look at `focus` (a cell; null for the
 * whole table), framed close or wide, or pulled right back to show the
 * table's scale, then give the camera back to the viewer. Presentation only;
 * a viewer can take the camera back at any time.
 */
export interface Shot {
	focus: GridPos | null;
	frame: 'close' | 'wide' | 'table';
}

/** A d20 rolled twice, keeping the higher or the lower (rules that have advantage). */
export type RollMode = 'advantage' | 'disadvantage';

export type ChatMessage =
	| { seq: number; at: number; kind: 'chat'; authorId: string; authorName: string; text: string }
	| {
			seq: number;
			at: number;
			kind: 'roll';
			authorId: string;
			authorName: string;
			roll: DiceRoll;
			/** A secret roll: only the roller and the GM see it. */
			audience?: LogAudience;
	  }
	| {
			seq: number;
			at: number;
			/** Story text: the GM narrating, or a character speaking (`speaker`). */
			kind: 'narration';
			text: string;
			speaker?: string;
			audience?: LogAudience;
			cue?: Cue;
			shot?: Shot;
	  }
	| {
			seq: number;
			at: number;
			/** An investigation check: a d20 plus a stat, against a difficulty. */
			kind: 'check';
			/** The player whose character made it. */
			authorId: string;
			/** The character, e.g. "The Veil". */
			authorName: string;
			/** What they did, e.g. "Search the chest" or "Listen". */
			action: string;
			/** The stat added, e.g. "Wits". */
			stat: string;
			roll: DiceRoll;
			dc: number;
			success: boolean;
			/** A saving throw, for rules that tell saves from checks. */
			save?: boolean;
			/** Rolled twice, keeping the higher (advantage) or lower (disadvantage). */
			mode?: RollMode;
			/** How the rules resolved it, in a line, e.g. "d20 17 (advantage over 4) + 5 = 22 vs DC 13". */
			explain?: string;
	  }
	| {
			seq: number;
			at: number;
			/** An attack resolved by the server: the to-hit roll, and damage when it hit. */
			kind: 'attack';
			/** The attacking player, or the attacking token's id for enemies. */
			authorId: string;
			/** Who attacked, e.g. "The Warden". */
			authorName: string;
			attack: string;
			/** The target's token, for effects drawn over it. */
			targetId?: string;
			targetName: string;
			toHit: DiceRoll;
			defense: number;
			hit: boolean;
			damage: DiceRoll | null;
			/** What came of it, e.g. "The Hollow Hound falls." */
			outcome?: string;
			/** A status it put on the target, e.g. "Slowed". */
			effect?: string;
			mode?: RollMode;
			/** A critical hit (its damage dice rolled twice, by rules that have them). */
			critical?: boolean;
			/** How the rules resolved it, in a line. */
			explain?: string;
	  }
	| {
			seq: number;
			at: number;
			/** Something other than an attack: healing, a guard, fire burning. */
			kind: 'ability';
			authorId: string;
			authorName: string;
			ability: string;
			targetId: string | null;
			targetName: string | null;
			/** The dice rolled, if any (e.g. healing). */
			roll: DiceRoll | null;
			/** Hit points gained (positive) or lost (negative) by the target. */
			amount: number | null;
			text: string;
	  }
	| {
			seq: number;
			at: number;
			kind: 'system';
			text: string;
			/** 'gm' for notices that would reveal hidden things (e.g. an NPC placed in the dark). */
			audience?: LogAudience;
	  };

export const CHAT_MAX_LENGTH = 500;
/** GM narration can run longer than chat. */
export const NARRATION_MAX_LENGTH = 1000;
/** Messages kept per room and sent to (re)joining clients. */
export const LOG_LIMIT = 200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** Collapses whitespace runs, strips control characters; null when empty or too long. */
export function normalizeChatText(raw: unknown, max = CHAT_MAX_LENGTH): string | null {
	if (typeof raw !== 'string') return null;
	const text = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 0 && text.length <= max ? text : null;
}

export type ChatInput =
	{ type: 'chat'; text: string } | { type: 'roll'; expression: string; secret: boolean };

/**
 * Interprets what a user typed into the chat box: `/roll 2d6+3` (or `/r`)
 * rolls, `/gmroll` (or `/gr`) rolls in secret (for the roller and the GM);
 * anything else is chat.
 */
export function parseChatInput(input: string): ChatInput {
	const m = /^\/(r(?:oll)?|g(?:m)?r(?:oll)?)(?:\s+(.*))?$/i.exec(input.trim());
	if (m)
		return {
			type: 'roll',
			expression: (m[2] ?? '1d20').trim(),
			secret: m[1].toLowerCase().startsWith('g')
		};
	return { type: 'chat', text: input };
}
