// Bridges and balustrades (#256): the Hollow's high bridge, ruins' bridge and
// causeway as bridges with parapets and piers and no arch over its walkable
// lake; arches only over known void; the monastery's open ledge and gallery
// balustraded and no rail between cells one level apart; every fixture scene and
// view and seeded tables of narrow runs over ground and void, fogged and not,
// through the harness (bodies with the ground, parapets with the trim, no ray
// through, nothing toward unexplored ground); a change rebuilding its chunks.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURE_CLEAR } from '$lib/assets/kit';
import { rolesNeeded } from '$lib/assets/kit-needs';
import { decodeFloor, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { parseSceneFile, type SceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import type { FogView } from '$lib/game/visibility';
import { bridgeTrim, DECK } from './bridge-mesh';
import { ALONG_Y, UNDER } from './bridges';
import { tableWorld } from './cliffs';
import { checkEmitter } from './invariants';
import { joinMeshes } from './join';
import { cracks, hit, random } from './random-table';
import { chunksAcross, knownOf, worldShape, type ShapeInput, type WorldShape } from './shape';
import { builtGround, stairDirty, stairTrim, withStairs, type Stairs } from './stairs';

const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const N = 0;
const E = 1;
const S = 2;
const W = 3;

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	objects: SceneObject[];
	fog?: FogView;
	environment?: string | null;
}

const input = (sent: Sent, known: ShapeInput['known']): ShapeInput => {
	const size = sent.grid.width * sent.grid.height;
	return {
		grid: sent.grid,
		levels: sent.terrain ? decodeLevels(sent.terrain, size) : null,
		floor: sent.floor ? decodeFloor(sent.floor, size) : null,
		objects: sent.objects,
		known
	};
};
const files = readdirSync(SCENES).filter((f) => f.endsWith('.json') && !f.includes('.poses.'));
const raw = new Map(
	files.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		return [f.replace('.json', ''), parsed.scene] as const;
	})
);
const scenes = [...raw].map(([name, scene]) => {
	const sent = scene as unknown as Sent;
	return { name, input: input(sent, null), env: sent.environment };
});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			const known = v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null;
			return { name: `${f} ${viewer}`, input: input(v, known), env: v.environment };
		});
	});
type Table = (typeof scenes)[number];
const shaped = (t: Table) => withStairs(worldShape(t.input), { built: builtGround(t.env) });
const scene = (name: string) => shaped(scenes.find((s) => s.name === name)!);
const at = (s: WorldShape, x: number, y: number) => y * s.grid.width + x;
const under = (s: { stairs: Stairs }, cell: number) => s.stairs.bridges[cell] & 3;
const rails = (s: { stairs: Stairs }, cell: number) =>
	s.stairs.pieces.filter((p) => p.role === 'railing' && p.cell === cell).map((p) => p.dir);
const trim = (s: WorldShape) => {
	const across = chunksAcross(s.grid);
	return joinMeshes(Array.from({ length: across.x * across.y }, (_, c) => stairTrim(s, c)).flat());
};
const bodies = (s: WorldShape) => {
	const across = chunksAcross(s.grid);
	return joinMeshes(Array.from({ length: across.x * across.y }, (_, c) => bridgeTrim(s, c)).flat());
};
const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});

describe('bridges on the Hollow', () => {
	const s = scene('hollow');

	it('makes the high bridge (x 32 to 39, row 9) a bridge with parapets and piers, no arches', () => {
		const cells = [32, 33, 34, 35, 36, 37, 38, 39].map((x) => at(s, x, 9));
		for (const c of cells) {
			expect(under(s, c), `${c % 48}`).not.toBe(UNDER.none);
			expect(s.stairs.bridges[c] & ALONG_Y).toBe(0);
			expect(rails(s, c)).toEqual([N, S]);
		}
		expect(cells.some((c) => under(s, c) === UNDER.pier)).toBe(true);
		// The watch stair's cells on it keep their treads.
		for (const x of [38, 39]) expect(s.stairs.steps[at(s, x, 9)]).toBe(1);
		// Its ends are the island's and the watch's ground, not the bridge's.
		expect(under(s, at(s, 31, 9))).toBe(UNDER.none);
		expect(under(s, at(s, 40, 9))).toBe(UNDER.none);
	});

	it("makes the ruins' bridge a bridge at y 16 to 21, not at 14 and 15 beside the ledge", () => {
		for (let y = 16; y <= 21; y++) {
			expect(under(s, at(s, 12, y)), `${y}`).not.toBe(UNDER.none);
			expect(rails(s, at(s, 12, y))).toEqual([W, E]);
		}
		for (const y of [14, 15]) {
			expect(under(s, at(s, 12, y)), `${y}`).toBe(UNDER.none);
			expect(rails(s, at(s, 12, y))).toEqual([]);
		}
	});

	it('gives the two-wide causeway parapets on both outer sides and nothing between', () => {
		for (let y = 19; y <= 29; y++) {
			expect(rails(s, at(s, 23, y)), `${y}`).toEqual([W]);
			expect(rails(s, at(s, 24, y)), `${y}`).toEqual([E]);
			expect(under(s, at(s, 23, y))).toBe(under(s, at(s, 24, y)));
		}
	});

	it('opens no arch over the lake, and draws spandrels and piers down to it', () => {
		expect([...s.stairs.bridges].some((m) => (m & 3) === UNDER.arch)).toBe(false);
		// A ray across the causeway at the lake's height plus a level meets its side.
		const y = 0.4;
		expect(hit(bodies(s), [-30, y, 23 - 18 + 0.5 + 0.0], [1, 0, 0])).toBeLessThan(Infinity);
		// The kit needs a railing for the Hollow now.
		expect(rolesNeeded(raw.get('hollow') as SceneFile).has('railing')).toBe(true);
	});
});

describe('arches only over the void', () => {
	// A one-wide bridge along x on row 2, level 4, from a block at x 0 to one at x 7.
	const G = grid(8, 5);
	const levels = new Uint8Array(40);
	for (let x = 0; x < 8; x++) levels[2 * 8 + x] = 4;
	for (const y of [0, 1, 3, 4]) levels[y * 8] = levels[y * 8 + 7] = 4;
	const span = (floor: Uint8Array | null, known: Uint8Array | null = null) =>
		withStairs(worldShape({ grid: G, levels, floor, objects: [], known }), { built: true });
	const voidAround = new Uint8Array(40);
	for (let i = 0; i < 40; i++) if (levels[i] === 0) voidAround[i] = VOID;

	it('gets arches over void on both sides', () => {
		const s = span(voidAround);
		const marks = [1, 2, 3, 4, 5, 6].map((x) => under(s, at(s, x, 2)));
		expect(marks.filter((m) => m === UNDER.arch).length).toBeGreaterThan(0);
		expect(marks.every((m) => m === UNDER.arch || m === UNDER.pier)).toBe(true);
		// Through an arch a ray passes under the deck; a pier's ray meets stone.
		const arch = [1, 2, 3, 4, 5, 6].find((x) => under(s, at(s, x, 2)) === UNDER.arch)!;
		const m = joinMeshes([tableWorld(s), trim(s)]);
		const through = (x: number) => hit(m, [x + 0.5 - 4, 1.0, -3], [0, 0, 1]);
		expect(through(arch)).toBe(Infinity);
		const pier = [1, 2, 3, 4, 5, 6].find((x) => under(s, at(s, x, 2)) === UNDER.pier);
		if (pier !== undefined) expect(through(pier)).toBeLessThan(Infinity);
		expect(cracks(tableWorld(s), s.grid, 7, 200)).toEqual([]);
	});

	it('gets a spandrel with void on one side and walkable ground on the other', () => {
		const floor = voidAround.slice();
		for (let x = 1; x < 7; x++) floor[3 * 8 + x] = 0; // the south side: ground at level 0
		const s = span(floor);
		for (let x = 1; x < 7; x++) {
			expect(under(s, at(s, x, 2))).not.toBe(UNDER.arch);
			expect(under(s, at(s, x, 2))).not.toBe(UNDER.none);
		}
		const m = joinMeshes([tableWorld(s), trim(s)]);
		for (let x = 1; x < 7; x++) expect(hit(m, [x + 0.5 - 4, 1.0, -3], [0, 0, 1])).toBeLessThan(9);
	});

	it('is no bridge toward an unexplored side: no arch, no rail, nothing drawn', () => {
		const known = new Uint8Array(40).fill(1);
		for (let x = 0; x < 8; x++) known[3 * 8 + x] = 0;
		const s = span(voidAround, known);
		expect([...s.stairs.bridges].every((m) => m === 0)).toBe(true);
		expect(s.stairs.pieces.filter((p) => p.cell >= 16 && p.cell < 24 && p.dir === S)).toEqual([]);
	});
});

describe('balustrades', () => {
	const s = scene('monastery');

	it("rails the ledge's open east edge and the gallery's window, not a one-level step", () => {
		for (let y = 6; y <= 9; y++) expect(rails(s, at(s, 23, y)), `${y}`).toContain(E);
		for (let y = 2; y <= 8; y++) {
			const p = s.stairs.pieces.find((q) => q.cell === at(s, 19, y) && q.role === 'railing');
			expect(p?.dir, `${y}`).toBe(W);
			expect(p?.model, 'under the window sill: procedural').toBeNull();
		}
		for (const p of s.stairs.pieces.filter((q) => q.role === 'railing'))
			expect(p.drop === null || p.drop >= 2, `${p.cell}`).toBe(true);
	});

	it('rails only built floors: none on the cavern, the village or the heart', () => {
		for (const name of ['hollow', 'village', 'heart']) {
			const t = scene(name);
			const open = t.stairs.pieces.filter(
				(p) => p.role === 'railing' && !t.stairs.bridges[p.cell] && !t.stairs.steps[p.cell]
			);
			expect(open, name).toEqual([]);
		}
	});

	it("rails the night train's gangways, never its windows out to the void", () => {
		const t = scene('railcar');
		const open = t.stairs.pieces.filter((p) => p.role === 'railing');
		expect(open.map((p) => [p.cell % t.grid.width, Math.floor(p.cell / t.grid.width)])).toEqual([
			[14, 3],
			[14, 3],
			[29, 3],
			[29, 3],
			[46, 3],
			[46, 3]
		]);
	});
});

/** A seeded table of narrow raised runs (one or two wide) over ground, water and void, fogged. */
function bridgeTable(seed: number): ShapeInput {
	const rnd = random(seed);
	const int = (n: number) => Math.floor(rnd() * n);
	const [w, h] = [16, 12];
	const levels = new Uint8Array(w * h);
	const floor = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) floor[i] = rnd() < 0.5 ? VOID : rnd() < 0.2 ? 6 : 0;
	for (let k = 0; k < 3; k++) {
		const [along, wide, len, l] = [rnd() < 0.5, 1 + int(2), 3 + int(8), 2 + int(5)];
		const [x0, y0] = [int(w), int(h)];
		for (let a = 0; a < len; a++)
			for (let b = 0; b < wide; b++) {
				const [x, y] = along ? [x0 + a, y0 + b] : [x0 + b, y0 + a];
				if (x >= w || y >= h) continue;
				levels[y * w + x] = l + (a > len - 3 ? a - len + 3 : 0); // stairs at the far end
				floor[y * w + x] = rnd() < 0.5 ? 1 : 0;
			}
	}
	const known = new Uint8Array(w * h);
	const [cx, cy, r] = [int(w), int(h), 3 + int(6)];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) known[y * w + x] = 1;
	for (let i = 0; i < known.length; i++) if (!known[i]) levels[i] = floor[i] = 0;
	const objects: SceneObject[] =
		seed % 3 === 0 ? [{ id: 'w', kind: 'wall', a: { x: 3, y: 4 }, b: { x: 9, y: 4 } }] : [];
	return { grid: grid(w, h), levels, floor, objects, known };
}

/** Every bridge cell, side and rail stands between known cells; arches only over known void. */
function bridgeProblems(s: WorldShape & { stairs: Stairs }): string[] {
	const out: string[] = [];
	const known = (i: number) => i >= 0 && (!s.known || s.known[i] === 1);
	s.stairs.bridges.forEach((m, i) => {
		if (m && !known(i)) out.push(`bridge on unexplored ${i}`);
	});
	for (const p of s.stairs.pieces)
		if (!known(p.cell) || !known(p.across)) out.push(`${p.role} at ${p.cell} toward ${p.across}`);
	const w = s.grid.width;
	s.stairs.bridges.forEach((m, i) => {
		if ((m & 3) !== UNDER.arch) return;
		const sides = m & ALONG_Y ? [i - 1, i + 1] : [i - w, i + w];
		for (const j of sides)
			if (s.stairs.bridges[j] === 0 && (!known(j) || s.floor[j] !== VOID))
				out.push(`arch at ${i} over ${j}, not known void`);
	});
	return out;
}

describe('bridges through the harness', () => {
	const check = (s: WorldShape & { stairs: Stairs }, name: string) => {
		expect(
			checkEmitter(s, tableWorld(s), trim(s), { allowance: 0, clear: FIGURE_CLEAR }),
			name
		).toEqual([]);
		expect(bridgeProblems(s), name).toEqual([]);
	};

	it('keeps every fixture scene and view clear, with nothing toward unexplored ground', () => {
		let bridged = 0;
		for (const t of [...scenes, ...views]) {
			const s = shaped(t);
			bridged += s.stairs.bridges.filter((m) => m !== 0).length;
			check(s, t.name);
			expect(cracks(tableWorld(s), s.grid, 3, 40), t.name).toEqual([]);
		}
		expect(bridged).toBeGreaterThan(30);
	}, 240_000);

	it('passes on seeded tables of narrow runs over ground and void, fogged and not', () => {
		let arches = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const t = bridgeTable(seed);
			for (const known of [t.known, null]) {
				const s = withStairs(worldShape({ ...t, known }), { built: seed % 2 === 0 });
				arches += s.stairs.bridges.filter((m) => (m & 3) === UNDER.arch).length;
				const name = `seed ${seed}${known ? '' : ', all known'}`;
				check(s, name);
				expect(cracks(tableWorld(s), s.grid, seed, 120), name).toEqual([]);
			}
		}
		expect(arches).toBeGreaterThan(0);
	}, 120_000);

	it('rebuilds the chunks whose bridges changed', () => {
		const t = scenes.find((x) => x.name === 'hollow')!;
		const before = shaped(t);
		// A wall along the high bridge's north side: no parapet there, and it is no bridge any more.
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 32, y: 9 }, b: { x: 38, y: 9 } };
		const after = withStairs(worldShape({ ...t.input, objects: [...t.input.objects, wall] }));
		expect(under(after, at(after, 34, 9))).toBe(UNDER.none);
		expect(stairDirty(before, after)).toEqual([1, 2]); // x 31 to 39 with the margin, y 8 to 10
		expect(stairDirty(before, before)).toEqual([]);
	});

	it('hangs every body under its deck: nothing over the floor but the parapets', () => {
		for (const name of ['hollow', 'monastery']) {
			const s = scene(name);
			const m = bodies(s);
			for (let v = 0; v < m.owners.length; v++) {
				const c = m.owners[v];
				const top = s.ground.floorY({ x: c % s.grid.width, y: Math.floor(c / s.grid.width) });
				expect(m.positions[v * 3 + 1]).toBeLessThanOrEqual(top + 1e-6);
			}
			expect(DECK).toBeGreaterThan(0);
		}
	});
});
