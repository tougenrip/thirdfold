// The room log: chat, dice results and system notices. Dice are rolled here,
// on the server, with a cryptographically secure source; clients only ever
// send the expression.

import { randomInt } from 'node:crypto';
import {
	LOG_LIMIT,
	normalizeChatText,
	type ChatMessage,
	type LogAudience
} from '../src/lib/game/chat';
import { parseDice, rollDice, type DieRoller } from '../src/lib/game/dice';
import { fail, type Player, type Result, type Room } from './rooms';

export const secureRoller: DieRoller = (sides) => randomInt(1, sides + 1);

type NewEntry = ChatMessage extends infer M
	? M extends ChatMessage
		? Omit<M, 'seq' | 'at'>
		: never
	: never;

export function appendLog(room: Room, entry: NewEntry, now = Date.now()): ChatMessage {
	const message = { ...entry, seq: room.nextSeq++, at: now } as ChatMessage;
	room.log.push(message);
	if (room.log.length > LOG_LIMIT) room.log.splice(0, room.log.length - LOG_LIMIT);
	return message;
}

export function postChat(
	room: Room,
	actor: Player,
	rawText: unknown
): Result<{ message: ChatMessage }> {
	const text = normalizeChatText(rawText);
	if (!text) return fail('invalid_chat', 'Messages must be 1-500 characters.');
	return {
		ok: true,
		message: appendLog(room, { kind: 'chat', authorId: actor.id, authorName: actor.name, text })
	};
}

export function postRoll(
	room: Room,
	actor: Player,
	expression: unknown,
	roller: DieRoller = secureRoller,
	secret = false
): Result<{ message: ChatMessage }> {
	const parsed = parseDice(expression);
	if (!parsed.ok) return fail('invalid_dice', parsed.error);
	const roll = rollDice(parsed.terms, roller);
	const entry = { kind: 'roll' as const, authorId: actor.id, authorName: actor.name, roll };
	// A secret roll is the roller's and the GM's alone.
	const audience: LogAudience | null = !secret
		? null
		: actor.role === 'gm'
			? 'gm'
			: { players: [actor.id] };
	return { ok: true, message: appendLog(room, audience ? { ...entry, audience } : entry) };
}

/**
 * Posts a notice; `audience: 'gm'` keeps it from players and spectators (e.g.
 * it names a hidden NPC), `{ players }` shows it only to those players (and the GM).
 */
export function postSystem(room: Room, text: string, audience?: LogAudience): ChatMessage {
	return appendLog(room, audience ? { kind: 'system', text, audience } : { kind: 'system', text });
}
