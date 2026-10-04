// Seeded random tables for the world specs (test support, pure): raised blocks
// and stairs, painted floors, walls, and a fogged viewer's explored blobs, the
// same tables on every run.

import { FLOOR_IDS, VOID } from '../../game/floor';
import type { SquareGrid } from '../../game/grid';
import type { SceneObject } from '../../game/objects';
import type { EmitterMesh } from './invariants';
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

/** The first hit along a ray from `o` in direction `d` (any facing), as its distance, or Infinity. */
export function hit(m: EmitterMesh, o: number[], d: number[]): number {
	const p = m.positions;
	let best = Infinity;
	for (let t = 0; t < m.indices.length; t += 3) {
		const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
		const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
		const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
		const q = [
			d[1] * e2[2] - d[2] * e2[1],
			d[2] * e2[0] - d[0] * e2[2],
			d[0] * e2[1] - d[1] * e2[0]
		];
		const det = e1[0] * q[0] + e1[1] * q[1] + e1[2] * q[2];
		if (Math.abs(det) < 1e-12) continue;
		const s = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]];
		const u = (s[0] * q[0] + s[1] * q[1] + s[2] * q[2]) / det;
		if (u < -1e-7 || u > 1 + 1e-7) continue;
		const r = [
			s[1] * e1[2] - s[2] * e1[1],
			s[2] * e1[0] - s[0] * e1[2],
			s[0] * e1[1] - s[1] * e1[0]
		];
		const v = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / det;
		if (v < -1e-7 || u + v > 1 + 1e-7) continue;
		const dist = (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]) / det;
		if (dist > 0 && dist < best) best = dist;
	}
	return best;
}

/** The height of the ground straight below (x, z). */
export const topAt = (m: EmitterMesh, x: number, z: number) => 10 - hit(m, [x, 10, z], [0, -1, 0]);

/** Rays slanting down from above the table that reach the lowest ground still over it, unhit. */
export function cracks(m: EmitterMesh, g: SquareGrid, seed: number, rays = 60): string[] {
	const rnd = random(seed);
	const [hw, hd] = [g.width / 2, g.height / 2];
	let [lo, hi] = [Infinity, -Infinity];
	for (let i = 1; i < m.positions.length; i += 3) {
		lo = Math.min(lo, m.positions[i]);
		hi = Math.max(hi, m.positions[i]);
	}
	const out: string[] = [];
	for (let k = 0; k < rays; k++) {
		const o = [(rnd() * 2 - 1) * hw * 0.98, hi + 1, (rnd() * 2 - 1) * hd * 0.98];
		const [tilt, turn] = [0.3 + rnd(), rnd() * Math.PI * 2];
		const d = [Math.sin(tilt) * Math.cos(turn), -Math.cos(tilt), Math.sin(tilt) * Math.sin(turn)];
		const reach = (o[1] - lo + 0.01) / -d[1];
		const [ex, ez] = [o[0] + d[0] * reach, o[2] + d[2] * reach];
		if (Math.abs(ex) > hw - 1e-3 || Math.abs(ez) > hd - 1e-3) continue;
		if (hit(m, o, d) > reach) out.push(`ray ${k} from ${o} along ${d}`);
	}
	return out;
}
