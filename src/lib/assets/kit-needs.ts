// What a table needs of its kit (#250): the roles its walls, windows, doors,
// steps, drops and roofs ask for, read from the scene file alone. `checkScenes`
// holds every built-in table's kit to it, and #352 reuses it. Pure, relative
// imports only; apart from kit.ts so the client's manifest parser stays small.

import { decodeFloor, VOID } from '../game/floor';
import { MAX_STEP, orderCorners } from '../game/objects';
import type { SceneFile } from '../game/scene-file';
import { decodeLevels } from '../game/terrain';
import { decodeMaskExact } from '../game/visibility';
import { worldShape } from '../tabletop/world/shape';
import { builtGround, stairsOf } from '../tabletop/world/stairs';
import type { KitRole } from './kit';

type Built = 'wall' | 'window' | 'door';
export type NeedsInput = Pick<SceneFile, 'grid' | 'objects' | 'terrain' | 'floor' | 'interior'> &
	Partial<Pick<SceneFile, 'environment'>>;

/**
 * The roles a table's kit must fill. Walls ask for a straight run and a cap, an outer face toward
 * the void or the table's edge, and a plinth and retaining wall down a drop; windows a frame and
 * glass (and a sill between different floors); doors a frame and a leaf; every corner where built
 * edges meet a post by how they meet; a one-level step without a wall a riser, a higher drop a
 * cliff face; roofed cells a ridge, eaves and corners; a stair run (#255) a side down to each lower
 * neighbour of its steps and, on a built stair, a railing on a drop (stairs.ts, as the client
 * draws it). ponytail: bridges and chimneys need #256's and #257's readings of a table; add them
 * here when those land.
 */
export function rolesNeeded(scene: NeedsInput): Set<KitRole> {
	const { width: w, height: h } = scene.grid;
	const size = w * h;
	const levels = scene.terrain ? decodeLevels(scene.terrain, size) : null;
	const floor = scene.floor ? decodeFloor(scene.floor, size) : null;
	const on = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < w && y < h && (!floor || floor[y * w + x] !== VOID);
	const level = (x: number, y: number) => (levels ? levels[y * w + x] : 0);
	const roles = new Set<KitRole>();

	// Each unit edge once, keyed like shape.ts: 'h' along the top of (x, y), 'v' along its left.
	const built = new Map<string, Built>();
	for (const o of scene.objects) {
		const { a, b } = orderCorners(o.a, o.b);
		const vertical = a.x === b.x;
		const kind: Built = o.kind === 'door' ? 'door' : o.window ? 'window' : 'wall';
		for (let u = 0; u < (vertical ? b.y - a.y : b.x - a.x); u++) {
			const key = vertical ? `v${a.x},${a.y + u}` : `h${a.x + u},${a.y}`;
			// A door cut into a wall wins its edge, as on the table.
			if (kind === 'door' || !built.has(key)) built.set(key, kind);
		}
	}
	for (const [key, kind] of built) {
		const [x, y] = key.slice(1).split(',').map(Number);
		const [px, py] = key[0] === 'v' ? [x - 1, y] : [x, y - 1];
		const sides = [
			[px, py],
			[x, y]
		].filter(([cx, cy]) => on(cx, cy));
		const drop =
			sides.length === 2 && level(sides[0][0], sides[0][1]) !== level(sides[1][0], sides[1][1]);
		if (kind === 'door') roles.add('door.frame').add('door.leaf');
		else if (kind === 'window') {
			roles.add('window.frame').add('window.glass');
			if (drop) roles.add('window.sill');
		} else {
			roles.add('wall.straight').add('cap');
			if (sides.length < 2) roles.add('wall.outer');
			if (drop) roles.add('plinth').add('wall.retaining');
		}
	}

	// Corners: the built edges meeting at each, and whether two of them run straight through.
	const at = (cx: number, cy: number) => [
		built.has(`v${cx},${cy - 1}`),
		built.has(`h${cx},${cy}`),
		built.has(`v${cx},${cy}`),
		built.has(`h${cx - 1},${cy}`)
	];
	for (let cy = 0; cy <= h; cy++)
		for (let cx = 0; cx <= w; cx++) {
			const [n, e, s, west] = at(cx, cy);
			const count = [n, e, s, west].filter(Boolean).length;
			if (count === 1) roles.add('post.end');
			else if (count === 2 && !((n && s) || (e && west))) roles.add('post.L');
			else if (count === 3) roles.add('post.T');
			else if (count === 4) roles.add('post.X');
		}

	// Steps and drops with no wall on them.
	if (levels)
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				for (const [nx, ny, key] of [
					[x + 1, y, `v${x + 1},${y}`],
					[x, y + 1, `h${x},${y + 1}`]
				] as const) {
					if (!on(x, y) || !on(nx, ny) || built.has(key)) continue;
					const d = Math.abs(level(x, y) - level(nx, ny));
					if (d === 0) continue;
					roles.add(d <= MAX_STEP ? 'stair.riser' : 'cliff.face');
				}
			}

	if (levels) {
		const objects = scene.objects;
		const shape = worldShape({ grid: scene.grid, levels, floor, objects, known: null });
		const built = builtGround(scene.environment);
		for (const p of stairsOf(shape, { built }).pieces) if (p.role !== 'kerb') roles.add(p.role);
	}

	const roofed = scene.interior ? decodeMaskExact(scene.interior, size) : null;
	if (roofed?.some((c) => c === 1)) roles.add('roof.ridge').add('roof.eave').add('roof.corner');
	return roles;
}
