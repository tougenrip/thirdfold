// Tables to measure performance on: The Hollow Bell played with the engine
// to each of its three big tables (the village at the start, the monastery's
// nave, the Hollow with the watch posted), saved as scene files with the
// story, the way a GM's save or import would bring them in.
//
//   npx tsx server/perf/scenes.ts <out-dir>
//
// Writes village.json, monastery.json and hollow.json; the client
// measurement (scripts/perf-client.mjs) imports them at a live table.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SceneFile } from '../../src/lib/game/scene-file';
import { EXIT } from '../adventures/hollow-bell/bellweather';
import * as engine from '../adventure/engine';
import { RoomManager, type Player, type Room } from '../rooms';
import { exportScene } from '../scene-io';

/** Players named as the measurement joins them, so the saved characters are theirs again. */
export const PERF_PLAYERS = ['Ana', 'Ben'] as const;

export function perfScenes(): Record<'village' | 'monastery' | 'hollow', SceneFile> {
	const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
		if (!r.ok) throw new Error(JSON.stringify(r));
		return r as Extract<T, { ok: true }>;
	};
	const rooms = new RoomManager();
	const created = ok(rooms.create('Gia'));
	const room: Room = created.room;
	const gm = created.player;
	const ana: Player = ok(rooms.join(room.id, PERF_PLAYERS[0], 'player')).player;
	const ben: Player = ok(rooms.join(room.id, PERF_PLAYERS[1], 'player')).player;
	ok(engine.startAdventure(room, gm));
	ok(engine.claimCharacter(room, ana, 'warden'));
	ok(engine.claimCharacter(room, ben, 'saint'));
	ok(engine.beginAdventure(room, gm, 1000));
	const village = exportScene(room, 'Perf: village');

	const token = (p: Player) => engine.characterOf(room, p.id)!.token;
	const walk = (p: Player, x: number, y: number) => {
		token(p).pos = { x, y };
		engine.afterMove(room, token(p), null);
	};
	const clear = () => {
		for (const id of [...(room.adventure!.encounter?.enemies.keys() ?? [])]) {
			room.tokens.delete(id);
			engine.afterTokenDeleted(room, id);
		}
	};
	walk(ana, 7, 10);
	ok(engine.interact(room, ana, 'maren'));
	walk(ana, 11, 12);
	ok(engine.interact(room, ana, 'well'));
	clear();
	walk(ana, EXIT[0].x, EXIT[0].y);
	walk(ana, 4, 15);
	walk(ben, 4, 16);
	const monastery = exportScene(room, 'Perf: monastery');

	ok(engine.interact(room, ana, 'oswin'));
	ok(engine.decide(room, ana, 'promise', 'boy'));
	walk(ana, 21, 6);
	walk(ana, 9, 4);
	ok(engine.interact(room, ana, 'agna'));
	token(ana).pos = { x: 6, y: 6 };
	token(ben).pos = { x: 4, y: 3 };
	walk(ana, 7, 5);
	clear();
	walk(ana, 6, 7);
	walk(ben, 4, 5);
	ok(engine.interact(room, ana, 'lever'));
	for (let i = 0; i < 5 && room.adventure!.running.size; i++) {
		for (const n of engine.pendingMechanisms(room.adventure!)) {
			engine.runMechanism(room, n.id, n.step);
		}
	}
	walk(ana, 3, 8);
	if (room.adventure!.location !== 'hollow') throw new Error('did not reach the Hollow');
	const hollow = exportScene(room, 'Perf: the Hollow');
	return { village, monastery, hollow };
}

if (process.argv[1]?.endsWith('scenes.ts')) {
	const out = process.argv[2] ?? 'data/perf';
	mkdirSync(out, { recursive: true });
	for (const [name, scene] of Object.entries(perfScenes())) {
		writeFileSync(path.join(out, `${name}.json`), JSON.stringify(scene));
		console.log(`${name}: ${scene.grid.width}×${scene.grid.height}, ${scene.tokens.length} tokens`);
	}
}
