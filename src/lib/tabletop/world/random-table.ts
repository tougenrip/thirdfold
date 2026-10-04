// Seeded random tables for the world specs (test support, pure): raised blocks
// and stairs, painted floors, walls, and a fogged viewer's explored blobs, the
// same tables on every run.

import { FLOOR_IDS, VOID } from '../../game/floor';
import type { SquareGrid } from '../../game/grid';
import type { SceneObject } from '../../game/objects';
import type { ShapeInput } from './shape';

const WATER = FLOOR_IDS.indexOf('water');

/** A seeded generator (mulberry32). */
export function random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A random table: raised blocks and stairs, painted floors, walls, and a fogged viewer's explored blobs. */
export function randomTable(seed: number, width = 14, height = 12): ShapeInput {
	const rnd = random(seed);
	const int = (n: number) => Math.floor(rnd() * n);
	const g: SquareGrid = { kind: 'square', cellSize: 1, width, height };
	const levels = new Uint8Array(width * height);
	const floor = new Uint8Array(width * height);
	for (let r = 0; r < 6; r++) {
		const [x0, y0, w, h, l] = [int(width), int(height), 1 + int(5), 1 + int(5), int(6)];
		for (let y = y0; y < Math.min(y0 + h, height); y++)
			for (let x = x0; x < Math.min(x0 + w, width); x++) levels[y * width + x] = l;
	}
	for (let k = int(4); k > 0; k--) {
		const [x0, y] = [int(width - 4), int(height)];
		for (let s = 0; s < 4; s++) levels[y * width + x0 + s] = s + 1;
	}
	for (let r = 0; r < 4; r++) {
		const [x0, y0, w, h] = [int(width), int(height), 1 + int(4), 1 + int(4)];
		const f = [VOID, WATER, 1, 3][int(4)];
		for (let y = y0; y < Math.min(y0 + h, height); y++)
			for (let x = x0; x < Math.min(x0 + w, width); x++) floor[y * width + x] = f;
	}
	const known = new Uint8Array(width * height);
	for (let b = 0; b < 3; b++) {
		const [cx, cy, r] = [int(width), int(height), 1 + int(5)];
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) known[y * width + x] = 1;
	}
	// What a fogged viewer is sent: only explored cells' ground.
	for (let i = 0; i < known.length; i++) if (!known[i]) levels[i] = floor[i] = 0;
	const objects: SceneObject[] = [];
	for (let k = 0; k < 3; k++) {
		const [x, y, len] = [int(width), 1 + int(height - 1), 1 + int(4)];
		objects.push({
			id: `w${k}`,
			kind: 'wall',
			a: { x, y },
			b: { x: Math.min(x + len, width), y },
			window: k === 2
		});
	}
	return { grid: g, levels, floor, objects, known };
}
