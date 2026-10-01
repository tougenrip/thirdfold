// GridLights' sources (#228) come only from what the viewer was sent: a hidden token carrying a
// lantern right beside a player's token is never one of the player's lights, while the GM, who is
// sent it, gets its light in its own colour.

import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../../server/rooms';
import { createToken, setAmbient, updateToken } from '../../../server/scene';
import { viewFor } from '../../../server/views';
import { carriedAt, HAND, litSources, strength } from './grid-light-layer';

function table() {
	const rooms = new RoomManager();
	const created = rooms.create('Gemma');
	if (!created.ok) throw new Error(created.message);
	const { room, player: gm } = created;
	const joined = rooms.join(room.id, 'Pip', 'player');
	if (!joined.ok) throw new Error(joined.message);
	setAmbient(room, gm, 'dark');
	const place = (name: string, x: number, ownerId: string | null) => {
		const made = createToken(room, gm, { name, color: '#c0392b', pos: { x, y: 4 }, ownerId });
		if (!made.ok) throw new Error(made.message);
		return made.token;
	};
	const pip = place('Pip', 4, joined.player.id);
	updateToken(room, gm, pip.id, { vision: 6 });
	const cultist = place('Cultist', 5, null);
	updateToken(room, gm, cultist.id, { light: 2, lightColor: '#6fe08a', hidden: true });
	return { room, gm, player: joined.player, cultist };
}

describe("GridLights' sources", () => {
	it("leave out a hidden lantern carrier beside a player's token, for the player only", () => {
		const { room, gm, player, cultist } = table();
		const seen = viewFor(room, player);
		expect(seen.tokens.map((t) => t.id)).not.toContain(cultist.id);
		expect(litSources(seen.lights, seen.tokens)).toEqual([]);

		const gms = viewFor(room, gm);
		const lit = litSources(gms.lights, gms.tokens);
		expect(lit.map((l) => [l.id, l.source.color, l.source.radius])).toEqual([
			[cultist.id, '#6fe08a', 2]
		]);
	});

	it('hold each carried light in its mini’s hand, by its size and lift', () => {
		const grid = { kind: 'square' as const, cellSize: 2, width: 10, height: 10 };
		const token = { pos: { x: 5, y: 5 }, scale: 1.5, lift: 0 };
		const at = carriedAt(grid, token as never, null);
		expect(at.y).toBeCloseTo(HAND.y * 2 * 1.5);
		expect(at.x).toBeCloseTo(1 + HAND.x * 3);
		expect(strength(4)).toBeGreaterThan(strength(2));
	});
});
