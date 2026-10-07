// The kit's clearance rule (#250) through the harness: every role's envelope
// (kit.ts), placed where a kit would put its pieces on the world's shape and
// filled to the brim, keeps out of every known walkable cell's base disk below
// FIGURE_CLEAR with no INTRUSION allowance; on every fixture scene and view, on
// all 16 ways walls meet at a corner, against the void, and down drops of 1
// and 5. So no kit inside its envelopes can crowd a mini, whatever #252 draws.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ENVELOPES, FIGURE_CLEAR, POST_SIZE, type KitRole } from '$lib/assets/kit';
import { decodeFloor, VOID } from '$lib/game/floor';
import { cornerToWorld, type SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { checkEmitter, referenceBoxes, type EmitterMesh } from './invariants';
import { EDGE_BUILT, EDGE_GROUND, knownOf, worldShape, type WorldShape } from './shape';

// Every fixture scene and view through the harness: a few seconds when the whole suite runs.
vi.setConfig({ testTimeout: 30_000 });

const KIT_RULE = { allowance: 0, clear: FIGURE_CLEAR };
type Axes = { o: [number, number]; x: [number, number]; z: [number, number]; y: number };

/**
 * Every role's whole envelope as a box, where a kit puts it: on each built edge a wall (outer
 * toward the void or off the table), its cap, and down a drop its retaining wall and a window's
 * sill; on each bare step a riser; a post on every corner where built edges meet. `thin` widens
 * the walls, to show the check bites.
 */
function envelopeKit(shape: WorldShape, thin = 0): EmitterMesh {
	const { grid } = shape;
	const { width: w, height: h, cellSize: cs } = grid;
	const pos: number[] = [];
	const idx: number[] = [];
	const known = (i: number) => !shape.known || shape.known[i] === 1;
	const on = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < w && y < h && (!known(y * w + x) || shape.floor[y * w + x] !== VOID);
	const floorY = (x: number, y: number) => shape.ground.floorY({ x, y });
	// A corner's envelope is its disk rule, so a post fills POST_SIZE of it.
	const box = (role: KitRole, a: Axes, wider = 0, side?: number) => {
		const env = ENVELOPES[role];
		const plan = (span: readonly [number, number]) => (side ? [-side / 2, side / 2] : span);
		const base = pos.length / 3;
		for (const y of env.y)
			for (const z of plan([env.z[0] - wider, env.z[1] + wider]))
				for (const x of plan(env.x))
					pos.push(
						a.o[0] + (a.x[0] * x + a.z[0] * z) * cs,
						a.y + y * cs,
						a.o[1] + (a.x[1] * x + a.z[1] * z) * cs
					);
		// The box's six sides, by its corners' bits: x 1, z 2, y 4.
		for (const [p, q, r, s] of [
			[0, 1, 3, 2],
			[4, 6, 7, 5],
			[0, 4, 5, 1],
			[2, 3, 7, 6],
			[0, 2, 6, 4],
			[1, 5, 7, 3]
		])
			idx.push(base + p, base + q, base + r, base + p, base + r, base + s);
	};

	for (const axis of ['h', 'v'] as const) {
		const built = shape.edges.built[axis];
		const ground = shape.edges.ground[axis];
		const across = axis === 'h' ? w : w + 1;
		for (let i = 0; i < built.length; i++) {
			const [x, y] = [i % across, Math.floor(i / across)];
			const cells =
				axis === 'h'
					? [
							[x, y - 1],
							[x, y]
						]
					: [
							[x - 1, y],
							[x, y]
						];
			const sides = cells.filter(([cx, cy]) => on(cx, cy));
			const floors = sides.map(([cx, cy]) => floorY(cx, cy));
			const top = floors.length ? Math.max(...floors) : 0;
			// Out: toward the side off the map, else the lower side.
			const outer = sides.length === 1 ? (sides[0] === cells[1] ? 0 : 1) : null;
			const lower =
				floors.length === 2 && floors[0] !== floors[1] ? (floors[0] < floors[1] ? 0 : 1) : 1;
			const toward = outer ?? lower;
			const p = cornerToWorld(grid, { x, y });
			const sign = toward === 1 ? 1 : -1;
			const a: Axes =
				axis === 'h'
					? { o: [p.x + cs / 2, p.z], x: [1, 0], z: [0, sign], y: top }
					: { o: [p.x, p.z + cs / 2], x: [0, 1], z: [sign, 0], y: top };
			const drop = floors.length === 2 && floors[0] !== floors[1];
			if (built[i] === EDGE_BUILT.none) {
				if (ground[i] === EDGE_GROUND.step) box('stair.riser', a);
				continue;
			}
			box(outer === null ? 'wall.straight' : 'wall.outer', a, thin);
			box('cap', a);
			if (drop) {
				box('wall.retaining', a);
				box('window.sill', a);
			}
		}
	}

	for (let cy = 0; cy <= h; cy++)
		for (let cx = 0; cx <= w; cx++) {
			const meets = [
				cy > 0 && shape.edges.built.v[(cy - 1) * (w + 1) + cx],
				cx < w && shape.edges.built.h[cy * w + cx],
				cy < h && shape.edges.built.v[cy * (w + 1) + cx],
				cx > 0 && shape.edges.built.h[cy * w + cx - 1]
			];
			if (!meets.some(Boolean)) continue;
			const round = [
				[cx - 1, cy - 1],
				[cx, cy - 1],
				[cx - 1, cy],
				[cx, cy]
			].filter(([x, y]) => on(x, y));
			const top = Math.max(0, ...round.map(([x, y]) => floorY(x, y)));
			const p = cornerToWorld(grid, { x: cx, y: cy });
			box('post.X', { o: [p.x, p.z], x: [1, 0], z: [0, 1], y: top }, 0, POST_SIZE + thin);
		}

	return {
		positions: new Float32Array(pos),
		indices: Uint32Array.from(idx),
		owners: new Int32Array(pos.length / 3).fill(-1)
	};
}

const clearance = (shape: WorldShape, thin = 0) =>
	checkEmitter(shape, referenceBoxes(shape), envelopeKit(shape, thin), KIT_RULE);

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
}

const shapeOf = (sent: Sent, known: Uint8Array | null) => {
	const size = sent.grid.width * sent.grid.height;
	return worldShape({
		grid: sent.grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, size) : null,
		floor: sent.floor ? decodeFloor(sent.floor, size) : null,
		objects: sent.objects,
		known
	});
};

describe('the kit clearance rule', () => {
	it('holds on every fixture scene and every committed view', () => {
		const scenes = readdirSync('tests/fixtures/scenes').filter(
			(f) => f.endsWith('.json') && !f.endsWith('.poses.json')
		);
		for (const f of scenes) {
			const parsed = parseSceneFile(
				JSON.parse(readFileSync(path.join('tests/fixtures/scenes', f), 'utf8'))
			);
			if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
			expect(clearance(shapeOf(parsed.scene as unknown as Sent, null)), f).toEqual([]);
		}
		for (const f of readdirSync('tests/fixtures/views').filter((n) => n.endsWith('.json'))) {
			const all = JSON.parse(readFileSync(path.join('tests/fixtures/views', f), 'utf8'));
			for (const viewer of ['gm', 'player', 'spectator'] as const) {
				const v = all[viewer] as Sent;
				const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
				expect(clearance(shapeOf(v, known)), `${f} ${viewer}`).toEqual([]);
			}
		}
	});

	// A 2x2 table: walls on any of the four edges meeting at its centre, over flat ground, a void
	// cell, and a cell raised 1 and 5 levels.
	const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 2, height: 2 };
	const arms = [
		{ a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
		{ a: { x: 1, y: 1 }, b: { x: 2, y: 1 } },
		{ a: { x: 1, y: 1 }, b: { x: 1, y: 2 } },
		{ a: { x: 0, y: 1 }, b: { x: 1, y: 1 } }
	];
	const grounds = {
		flat: { levels: null, floor: null },
		void: { levels: null, floor: Uint8Array.of(0, 0, 0, VOID) },
		'a drop of 1': { levels: Uint8Array.of(0, 0, 0, 1), floor: null },
		'a drop of 5': { levels: Uint8Array.of(0, 0, 0, 5), floor: null }
	};
	const corner = (mask: number, ground: (typeof grounds)[keyof typeof grounds]) =>
		worldShape({
			grid,
			...ground,
			known: null,
			objects: arms
				.filter((_, k) => mask & (1 << k))
				.map((e, k): SceneObject => ({ id: `w${k}`, kind: 'wall', ...e }))
		});

	it('holds at all 16 corner masks, against the void and down drops of 1 and 5', () => {
		for (const [name, ground] of Object.entries(grounds))
			for (let mask = 0; mask < 16; mask++)
				expect(clearance(corner(mask, ground)), `${name}, mask ${mask}`).toEqual([]);
	});

	it('catches walls and posts a hair thicker than WALL_HALF_THIN and POST_SIZE', () => {
		expect(clearance(corner(0b1111, grounds.flat), 0.01).map((v) => v.rule)).toContain('intrusion');
	});
});
