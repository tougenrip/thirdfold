import { describe, expect, it } from 'vitest';
import { LOG_LIMIT } from '../src/lib/game/chat';
import { appendLog, postChat, postRoll, postSystem, secureRoller } from './chat';
import { RoomManager } from './rooms';

function setup() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	return created;
}

describe('room log', () => {
	it('numbers entries and caps the log, dropping the oldest', () => {
		const { room } = setup();
		for (let i = 0; i < LOG_LIMIT + 5; i++) postSystem(room, `notice ${i}`);
		expect(room.log).toHaveLength(LOG_LIMIT);
		expect(room.log[0]).toMatchObject({ seq: 6, text: 'notice 5' });
		expect(room.log.at(-1)).toMatchObject({ seq: LOG_LIMIT + 5 });
	});

	it('stamps server time', () => {
		const { room } = setup();
		expect(appendLog(room, { kind: 'system', text: 'x' }, 1234).at).toBe(1234);
	});
});

describe('postChat', () => {
	it('attributes messages to the sender and normalises text', () => {
		const { room, player } = setup();
		const r = postChat(room, player, '  hi   all ');
		expect(r.ok && r.message).toMatchObject({
			kind: 'chat',
			authorId: player.id,
			authorName: 'Gemma',
			text: 'hi all'
		});
	});

	it('rejects empty messages without logging', () => {
		const { room, player } = setup();
		expect(postChat(room, player, '   ')).toMatchObject({ ok: false, code: 'invalid_chat' });
		expect(room.log).toHaveLength(0);
	});
});

describe('postRoll', () => {
	it('rolls on the server with the given roller', () => {
		const { room, player } = setup();
		const r = postRoll(room, player, '1d20+5', () => 14);
		expect(r.ok && r.message).toMatchObject({
			kind: 'roll',
			authorName: 'Gemma',
			roll: { expression: '1d20+5', total: 19 }
		});
	});

	it('rejects bad expressions without logging', () => {
		const { room, player } = setup();
		expect(postRoll(room, player, '1d20;drop', () => 1)).toMatchObject({
			ok: false,
			code: 'invalid_dice'
		});
		expect(room.log).toHaveLength(0);
	});

	it('secure roller covers the whole die', () => {
		const seen = new Set<number>();
		for (let i = 0; i < 400; i++) seen.add(secureRoller(6));
		expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
	});
});
