// The room log: player chat, dice results and system notices, in one
// ordered stream. Text is always plain text; clients must render it as such.

import type { DiceRoll } from './dice';

export type ChatMessage =
	| { seq: number; at: number; kind: 'chat'; authorId: string; authorName: string; text: string }
	| { seq: number; at: number; kind: 'roll'; authorId: string; authorName: string; roll: DiceRoll }
	| {
			seq: number;
			at: number;
			kind: 'system';
			text: string;
			/** 'gm' for notices that would reveal hidden things (e.g. an NPC placed in the dark). */
			audience?: 'gm';
	  };

export const CHAT_MAX_LENGTH = 500;
/** Messages kept per room and sent to (re)joining clients. */
export const LOG_LIMIT = 200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

/** Collapses whitespace runs, strips control characters; null when empty or too long. */
export function normalizeChatText(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const text = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 0 && text.length <= CHAT_MAX_LENGTH ? text : null;
}

export type ChatInput = { type: 'chat'; text: string } | { type: 'roll'; expression: string };

/** Interprets what a user typed into the chat box: `/roll 2d6+3` (or `/r`) rolls; anything else is chat. */
export function parseChatInput(input: string): ChatInput {
	const m = /^\/r(?:oll)?(?:\s+(.*))?$/i.exec(input.trim());
	if (m) return { type: 'roll', expression: (m[1] ?? '1d20').trim() };
	return { type: 'chat', text: input };
}
