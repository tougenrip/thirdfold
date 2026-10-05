// Void cells as chasms (#243): the style and depth each backdrop kind gives the void, and on every
// fixture scene and every GM, player and spectator view, with each style (a chasm, the sea, the
// moving ground, closed or open at the border): the invariant harness with the void's floor as a
// decoration (nothing over a walkable disk), that floor below every walkable floor and only under
// void cells (or past the border beside a known one), nothing drawn toward unexplored ground, rays
// from above that never fall through; the night train's gaps and edges on the moving ground; and
// picks into a hole landing on the void cell, or on the car whose wall the ray meets first.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor, VOID } from '$lib/game/floor';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { BACKDROPS, type WorldLook } from '$lib/game/world';
import type { FogView } from '$lib/game/visibility';
import { STEP_HEIGHT } from '../ground';
import {
	chasmGround,
	chasmOf,
	CHASM_DEPTH,
	chasmY,
	depthShade,
	mistTexels,
	OPEN_REACH,
	SCROLL_DEPTH,
	voidStyle,
	type Chasm
} from './chasm';
import { chunkWorld } from './cliffs';
import { checkEmitter } from './invariants';
import { joinMeshes, tableGround } from './join';
import { pickCell } from './pick';
import { cracks, topAt } from './random-table';
import { chunksAcross, knownOf, worldShape, type ShapeInput, type WorldShape } from './shape';

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
	world?: WorldLook;
}

function input(sent: Sent, known: ShapeInput['known']): ShapeInput {
	const size = sent.grid.width * sent.grid.height;
	return {
		grid: sent.grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, size) : null,
		floor: sent.floor ? decodeFloor(sent.floor, size) : null,
		objects: sent.objects,
		known
	};
}

const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const scenes = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		const sent = parsed.scene as unknown as Sent;
		return { name: f.replace('.json', ''), input: input(sent, null), world: sent.world! };
	});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
			return { name: `${f} ${viewer}`, input: input(v, known), world: v.world! };
		});
	});
const every = [...scenes, ...views];
const hasVoid = every.filter((t) => t.input.floor?.includes(VOID));
/** Every style, closed and open: the chasm (none), the abyss's open chasm, the sea, the moving ground. */
const STYLES = (['none', 'abyss', 'sea', 'prairie-scroll'] as const).map((kind) =>
	chasmOf({ kind, level: 0 })
);

/** The void's floor of a whole table. */
function bottoms(s: WorldShape, chasm: Chasm) {
	const across = chunksAcross(s.grid);
	const parts = [];
	for (let c = 0; c < across.x * across.y; c++) parts.push(chunkWorld(s, c, chasm).bottom);
	return joinMeshes(parts);
}

/** Where the void's floor breaks its rules: above 0, under a cell that isn't void, past the border. */
function bottomProblems(s: WorldShape, chasm: Chasm): string[] {
	const { width: w, height: h, cellSize: cs } = s.grid;
	const m = bottoms(s, chasm);
	const out: string[] = [];
	const y = chasmY(chasm, cs);
	for (let t = 0; t < m.indices.length; t += 3) {
		const v = [0, 1, 2].map((k) => m.indices[t + k]);
		const owner = m.owners[v[0]];
		if (v.some((i) => Math.abs(m.positions[i * 3 + 1] - y) > 1e-5)) out.push(`${t}: not flat`);
		// Under a void cell, or a sector of an unexplored one split toward a known void (black).
		const hidden = s.known && !s.known[owner];
		if (s.floor[owner] !== VOID && !hidden) out.push(`${t}: under cell ${owner}, not void`);
		// Its middle lies in its owner's cell, or past the border beside it if it is known and open.
		const [mx, mz] = [0, 2].map((o) => v.reduce((a, i) => a + m.positions[i * 3 + o], 0) / 3);
		const [cx, cy] = [Math.floor(mx / cs + w / 2), Math.floor(mz / cs + h / 2)];
		const inside = cx >= 0 && cy >= 0 && cx < w && cy < h;
		const [ox, oy] = [owner % w, Math.floor(owner / w)];
		if (inside && cy * w + cx !== owner) out.push(`${t}: in ${cx},${cy}, owned by ${owner}`);
		if (!inside) {
			const near = Math.abs(cx - ox) <= 1 && Math.abs(cy - oy) <= 1;
			const past = Math.max(-mx / cs - w / 2, mx / cs - w / 2, -mz / cs - h / 2, mz / cs - h / 2);
			if (!chasm.open || !near || past > OPEN_REACH) out.push(`${t}: past the border`);
			if (s.known && !s.known[owner]) out.push(`${t}: past the border, unexplored`);
		}
	}
	return out;
}

describe('the void by backdrop', () => {
	it('is a chasm, the sea or the moving ground, open where the backdrop beyond is no land', () => {
		const styles = Object.fromEntries(BACKDROPS.map((k) => [k, voidStyle(k)]));
		expect(styles).toEqual({
			none: 'chasm',
			plains: 'chasm',
			hills: 'chasm',
			forest: 'chasm',
			mountains: 'chasm',
			sea: 'sea',
			abyss: 'chasm',
			cavern: 'chasm',
			'prairie-scroll': 'scroll'
		});
		expect(voidStyle(null)).toBe('chasm');
		expect(chasmOf({ kind: null, level: 0 })).toEqual({
			style: 'chasm',
			depth: -CHASM_DEPTH,
			open: false
		});
		expect(chasmOf({ kind: 'abyss', level: 0 })).toMatchObject({ depth: -12, open: true });
		expect(chasmOf({ kind: 'prairie-scroll', level: 0 })).toMatchObject({
			depth: -SCROLL_DEPTH,
			open: true
		});
		// The sea half a level below the backdrop's, never above level 0's floors.
		expect(chasmOf({ kind: 'sea', level: 0 }).depth).toBe(-0.5);
		expect(chasmOf({ kind: 'sea', level: 3 }).depth).toBe(-0.5);
		expect(chasmOf({ kind: 'sea', level: 0 }).open).toBe(true);
		for (const kind of BACKDROPS)
			for (const level of [0, 2]) expect(chasmOf({ kind, level }).depth).toBeLessThan(0);
	});

	it('darkens with depth, and the mist tiles', () => {
		expect(depthShade(0.4, 1)).toBe(1);
		expect(depthShade(-1, 1)).toBeLessThan(1);
		expect(depthShade(-4.8, 1)).toBe(0.15);
		const mist = mistTexels(32);
		expect(mist).toHaveLength(32 * 32 * 4);
		expect(mistTexels(32)).toEqual(mist);
		const grey = (x: number, y: number) => mist[((y % 32) * 32 + (x % 32)) * 4];
		// Its first column and row run on from its last: no seam.
		for (let i = 0; i < 32; i++) {
			expect(Math.abs(grey(0, i) - grey(31, i))).toBeLessThan(40);
			expect(Math.abs(grey(i, 0) - grey(i, 31))).toBeLessThan(40);
		}
		expect(new Set(mist).size).toBeGreaterThan(20);
	});
});

describe('chasms on every fixture', () => {
	it('has void to check: the night train, the ghost town and ref-3', () => {
		expect(hasVoid.map((t) => t.name)).toEqual(
			expect.arrayContaining(['railcar', 'ghost-town', 'ref-3'])
		);
		expect(hasVoid.filter((t) => t.input.known).length).toBeGreaterThan(0);
	});

	it('pass the harness in every style, their floors under the void and below every floor', () => {
		for (const { name, input: i } of hasVoid) {
			const s = worldShape(i);
			for (const chasm of STYLES) {
				const label = `${name} ${chasm.style} ${chasm.open ? 'open' : 'closed'}`;
				const all = tableGround(s, chasm);
				expect(checkEmitter(s, all, bottoms(s, chasm)), label).toEqual([]);
				expect(bottomProblems(s, chasm), label).toEqual([]);
				// Nothing owned by the void stands above level 0, the lowest floor anyone stands on.
				for (let v = 0; v < all.owners.length; v++)
					if (s.floor[all.owners[v]] === VOID)
						expect(all.positions[v * 3 + 1], label).toBeLessThanOrEqual(1e-5);
				expect(cracks(all, s.grid, 7, 200), label).toEqual([]);
			}
		}
	}, 120_000);

	it('pass the harness with cliffs down the chasm, in every scene’s own style', () => {
		for (const { name, input: i, world } of hasVoid) {
			const s = worldShape(i);
			const chasm = chasmOf(world.backdrop);
			const across = chunksAcross(s.grid);
			const parts = [];
			for (let c = 0; c < across.x * across.y; c++) {
				const { top, sides, bottom } = chunkWorld(s, c, chasm);
				parts.push(top, ...sides, bottom);
			}
			expect(checkEmitter(s, joinMeshes(parts)), name).toEqual([]);
		}
	}, 60_000);

	it("drops the night train's gaps and edges to the moving ground, open past the border", () => {
		const train = scenes.find((t) => t.name === 'railcar')!;
		const s = worldShape(train.input);
		const chasm = chasmOf(train.world.backdrop);
		expect(chasm).toMatchObject({ style: 'scroll', open: true });
		const ground = tableGround(s, chasm);
		const drop = -SCROLL_DEPTH * STEP_HEIGHT;
		const top = (x: number, y: number) => {
			const c = gridToWorld(s.grid, { x, y });
			return topAt(ground, c.x, c.z);
		};
		// The gaps between the cars (x = 14, 29, 46 beside the gangway), the border rows.
		for (const x of [14, 29, 46]) {
			expect(top(x, 1)).toBeCloseTo(drop);
			expect(top(x, 5)).toBeCloseTo(drop);
			expect(top(x, 3)).toBeCloseTo(0); // the gangway
		}
		expect(top(30, 0)).toBeCloseTo(drop);
		// Past the edge, the moving ground runs on under the backdrop's lip.
		const edge = gridToWorld(s.grid, { x: 30, y: 0 });
		expect(topAt(ground, edge.x, edge.z - 0.5 - OPEN_REACH / 2)).toBeCloseTo(drop);
	});

	it('picks the void cell down a hole, and the car whose wall a ray meets first', () => {
		const train = scenes.find((t) => t.name === 'railcar')!;
		const s = worldShape(train.input);
		const chasm = chasmOf({ kind: null, level: 0 }); // the deepest: a chasm
		const g = chasmGround(s.grid, s.ground, s.floor, () => chasm);
		const at = (x: number, y: number) => g.pickY!({ x, y });
		// Straight down into the gap at x = 14: the gap, on the chasm's floor.
		const gap = gridToWorld(s.grid, { x: 14, y: 1 });
		const down = pickCell(s.grid, at, { x: gap.x, y: 10, z: gap.z }, { x: 0, y: -1, z: 0 });
		expect(down.cell).toEqual({ x: 14, y: 1 });
		expect(down.point!.y).toBeCloseTo(-CHASM_DEPTH * STEP_HEIGHT);
		// Steeply east into the gap: the ray meets the dining car's wall at x = 15 first.
		const d = { x: 0.3, y: -1, z: 0 };
		const slant = pickCell(s.grid, at, { x: gap.x - 0.2, y: 0.5, z: gap.z }, d);
		expect(slant.cell).toEqual({ x: 15, y: 1 });
		expect(slant.face).toBe('side');
		// The floor everything stands on is unchanged: the void's level.
		expect(g.floorY({ x: 14, y: 1 })).toBe(s.ground.floorY({ x: 14, y: 1 }));
		expect(g.pickY!({ x: 15, y: 1 })).toBe(0);
	});
});
