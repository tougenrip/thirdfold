import { readAdventure } from '../adventure/persist';
import { RoomManager } from '../rooms';
import { applyScene } from '../scene-io';
import { viewsFor } from '../views';
import { perfScenes, PERF_PLAYERS } from './scenes';
const scene = perfScenes().hollow;
const rooms = new RoomManager();
const made = rooms.create('Gia');
if (!made.ok) throw new Error();
const room = made.room;
for (const n of [...PERF_PLAYERS, 'Cy', 'Di', 'Ed']) rooms.join(room.id, n, 'player');
rooms.join(room.id, 'Sam', 'spectator');
const story = readAdventure(scene.adventure!, scene);
if (!story.ok) throw new Error();
applyScene(room, scene);
room.adventure = story.adventure;
const viewers = [...room.players.values()];
const token = [...room.tokens.values()].find((t) => t.ownerId)!;
const home = { ...token.pos };
for (let i = 0; i < 400; i++) {
	token.pos = i % 2 ? home : { x: home.x, y: home.y + 1 };
	viewsFor(room, viewers);
}
console.log('done');
