// Edge autotiling (#251) on every fixture table and committed view: the
// clearance envelope, the rules' precedence, ids that change nothing, the
// sealed secret doors that look exactly like plain wall, the monastery's drops,
// and a differential secrecy test over every fogged viewer.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeFloor, VOID } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import { edgeKey, type SceneObject, unitEdges, windowEdges } from '$lib/game/objects';
import { parseSceneFile } from '$lib/game/scene-file';
import { decodeLevels } from '$lib/game/terrain';
import { decodeMask, fnv1a, type FogView } from '$lib/game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../ground';
import { autotile, keySeed, SITE, tileInput, TILE_ROLES, type WallPieces } from './autotile';
import { checkWallPieces } from './invariants';
import { random } from './random-table';
import { knownOf, worldShape, type ShapeInput } from './shape';

interface Sent {
	grid: SquareGrid;
	terrain: string | null;
	floor: string | null;
	interior?: string | null;
	objects: SceneObject[];
	fog?: FogView;
}
interface Fixture {
	name: string;
	input: ShapeInput;
	building: Uint8Array | null;
}

function fixture(name: string, sent: Sent, known: ShapeInput['known']): Fixture {
	const n = sent.grid.width * sent.grid.height;
	return {
		name,
		input: {
			grid: sent.grid,
			levels: sent.terrain ? decodeLevels(sent.terrain, n) : null,
			floor: sent.floor ? decodeFloor(sent.floor, n) : null,
			objects: sent.objects,
			known
		},
		building: sent.interior ? decodeMask(sent.interior, n) : null
	};
}

const SCENES = 'tests/fixtures/scenes';
const VIEWS = 'tests/fixtures/views';
const scenes = readdirSync(SCENES)
	.filter((f) => f.endsWith('.json') && !f.endsWith('.poses.json'))
	.map((f) => {
		const parsed = parseSceneFile(JSON.parse(readFileSync(path.join(SCENES, f), 'utf8')));
		if (!parsed.ok) throw new Error(`${f}: ${parsed.error}`);
		return fixture(f.replace('.json', ''), parsed.scene as unknown as Sent, null);
	});
const views = readdirSync(VIEWS)
	.filter((f) => f.endsWith('.json'))
	.flatMap((f) => {
		const all = JSON.parse(readFileSync(path.join(VIEWS, f), 'utf8')) as Record<string, Sent>;
		return (['gm', 'player', 'spectator'] as const).map((viewer) => {
			const v = all[viewer];
			return fixture(`${f} ${viewer}`, v, v.fog ? knownOf(v.grid, v.fog, viewer === 'gm') : null);
		});
	});
const every = [...scenes, ...views];

const tiled = (f: Fixture, objects = f.input.objects, over: Partial<ShapeInput> = {}) => {
	const shape = worldShape({ ...f.input, ...over, objects });
	return autotile(tileInput(shape, objects, f.building));
};
const scene = (name: string) => scenes.find((s) => s.name === name)!;

/** Each piece as [role, site, x, y, rotation, y0, y1]. */
function list(pieces: Map<number, WallPieces>) {
	const out: [string, number, number, number, number, number, number][] = [];
	for (const p of pieces.values())
		for (let k = 0; k < p.count; k++)
			out.push([TILE_ROLES[p.role[k]], p.site[k], p.x[k], p.y[k], p.rotation[k], p.y0[k], p.y1[k]]);
	return out;
}

describe('autotile on every fixture', () => {
	it('has every scene and every viewer of every view', () => {
		expect(scenes.length).toBeGreaterThanOrEqual(15);
		expect(views.filter((v) => v.input.known).length).toBeGreaterThan(20);
	});

	it('keeps every piece out of every walkable base disk and off unexplored ground', () => {
		let pieces = 0;
		for (const f of every) {
			const shape = worldShape(f.input);
			const out = autotile(tileInput(shape, f.input.objects, f.building));
			for (const p of out.values()) pieces += p.count;
			expect(checkWallPieces(shape, out.values()), f.name).toEqual([]);
		}
		expect(pieces).toBeGreaterThan(5000);
	});

	it('draws a window wherever the sight rule has one, and one main piece per known built edge', () => {
		const MAIN = new Set(['wall.retaining', 'plinth']);
		for (const f of every) {
			const { grid, objects, known } = f.input;
			const main = new Map<string, string>();
			for (const [role, site, x, y] of list(tiled(f)))
				if (site !== SITE.corner && !MAIN.has(role)) {
					const key = `${site === SITE.h ? 'h' : 'v'}:${x}:${y}`;
					expect(main.has(key), `${f.name} ${key}`).toBe(false);
					main.set(key, role);
				}
			const isKnown = (cx: number, cy: number) =>
				cx >= 0 &&
				cy >= 0 &&
				cx < grid.width &&
				cy < grid.height &&
				(!known || known[cy * grid.width + cx] === 1);
			const built = new Set(objects.flatMap((o) => unitEdges(o.a, o.b)).map((e) => edgeKey(e)));
			const windows = windowEdges(objects);
			let count = 0;
			for (const key of built) {
				const [axis, x, y] = [key[0], ...key.slice(2).split(':').map(Number)] as [
					string,
					number,
					number
				];
				if (axis === 'h' ? x >= grid.width || y > grid.height : y >= grid.height || x > grid.width)
					continue;
				const side =
					axis === 'h' ? isKnown(x, y - 1) || isKnown(x, y) : isKnown(x - 1, y) || isKnown(x, y);
				expect(main.has(key), `${f.name} ${key}`).toBe(side);
				if (side) count++;
				if (side && windows.has(key))
					expect(main.get(key), `${f.name} ${key}`).toMatch(/^window\./);
			}
			expect(main.size, f.name).toBe(count);
		}
	});

	it('reads no id: renaming every object and reversing their order changes nothing', () => {
		for (const f of every) {
			const renamed = f.input.objects
				.map((o, k) => ({ ...o, id: `x${(k * 7919) % 1000}-${k}` }))
				.reverse();
			expect(tiled(f, renamed), f.name).toEqual(tiled(f));
		}
	});

	it('seeds an edge with the FNV-1a of its edgeKey and a corner with that of c:x:y', () => {
		const bytes = (s: string) => fnv1a(new TextEncoder().encode(s));
		for (const [x, y] of [
			[0, 0],
			[8, 5],
			[47, 35],
			[123, 9]
		]) {
			expect(keySeed('h', x, y)).toBe(bytes(edgeKey({ a: { x, y }, b: { x: x + 1, y } })));
			expect(keySeed('v', x, y)).toBe(bytes(edgeKey({ a: { x, y }, b: { x, y: y + 1 } })));
			expect(keySeed('c', x, y)).toBe(bytes(`c:${x}:${y}`));
		}
	});
});

describe('sealed secret doors look exactly like plain wall', () => {
	const merge = (objects: readonly SceneObject[], ids: string[], into: SceneObject) => [
		...objects.filter((o) => !ids.includes(o.id)),
		into
	];

	it("tiles the monastery's sealed segment as one wall with mn-inner-n and mn-inner-s", () => {
		const f = scene('monastery');
		const objects = f.input.objects;
		expect(objects.some((o) => o.id === 'mn-secret-door-sealed')).toBe(true);
		const merged = merge(objects, ['mn-inner-n', 'mn-secret-door-sealed', 'mn-inner-s'], {
			id: 'mn-inner',
			kind: 'wall',
			a: { x: 8, y: 2 },
			b: { x: 8, y: 10 }
		});
		const renamed = objects.map((o) =>
			o.id === 'mn-secret-door-sealed' ? { ...o, id: 'plain' } : o
		);
		const base = tiled(f);
		expect(tiled(f, merged)).toEqual(base);
		expect(tiled(f, renamed)).toEqual(base);
		const posts = list(base).filter(
			([, site, x, y]) => site === SITE.corner && x === 8 && (y === 5 || y === 6)
		);
		expect(posts).toEqual([]);
		// And for every viewer of every committed monastery view.
		for (const v of views.filter((v) => v.name.startsWith('monastery'))) {
			const vMerged = merge(
				v.input.objects,
				['mn-inner-n', 'mn-secret-door-sealed', 'mn-inner-s'],
				merged.at(-1)!
			);
			if (v.input.objects.some((o) => o.id === 'mn-secret-door-sealed'))
				expect(tiled(v, vMerged), v.name).toEqual(tiled(v));
		}
	});

	it("tiles the Hollow's sealed cleft as one wall with the island's west wall", () => {
		const f = scene('hollow');
		const cleft = f.input.objects.find((o) => o.id === 'ho-cleft')!;
		const sealed: SceneObject[] = [
			...f.input.objects.filter((o) => o.id !== 'ho-cleft'),
			{ id: 'ho-cleft-sealed', kind: 'wall', a: cleft.a, b: cleft.b }
		];
		const merged = merge(sealed, ['ho-wall-w', 'ho-cleft-sealed', 'ho-wall-w2'], {
			id: 'west',
			kind: 'wall',
			a: { x: 17, y: 5 },
			b: { x: 17, y: 19 }
		});
		expect(tiled(f, sealed)).toEqual(tiled(f, merged));
		const posts = list(tiled(f, sealed)).filter(
			([, site, x, y]) => site === SITE.corner && x === 17 && (y === 13 || y === 14)
		);
		expect(posts).toEqual([]);
	});
});

describe("the monastery's drops", () => {
	it('stands mn-tower-w on the belfry over a retaining piece down five levels to the ledge', () => {
		const f = scene('monastery');
		const tower = f.input.objects.find((o) => o.id === 'mn-tower-w')!;
		const pieces = list(tiled(f));
		for (const e of unitEdges(tower.a, tower.b)) {
			const at = pieces.filter(
				([, site, x, y]) => site === SITE.v && x === e.a.x && y === Math.min(e.a.y, e.b.y)
			);
			const [main, retaining, plinth] = at;
			// Neither the belfry nor the ledge is roofed, so it is a boundary wall.
			expect(at.map(([role]) => role)).toEqual(['wall.boundary', 'wall.retaining', 'plinth']);
			expect(Math.round((retaining[6] - retaining[5]) / STEP_HEIGHT)).toBe(5);
			expect(main[5]).toBe(retaining[6]);
			expect(main[6] - main[5]).toBeCloseTo(WALL_HEIGHT, 5);
			expect(plinth[6]).toBe(retaining[6]);
			expect(main[4]).toBe(retaining[4]); // the face looks down, toward the ledge
		}
	});

	it('frames the gallery railing (mn-railing, 5 over 0) as window sills', () => {
		const f = scene('monastery');
		const railing = f.input.objects.find((o) => o.id === 'mn-railing')!;
		const pieces = list(tiled(f));
		for (const e of unitEdges(railing.a, railing.b)) {
			const [main] = pieces.filter(
				([, site, x, y]) => site === SITE.v && x === e.a.x && y === e.a.y
			);
			expect(main[0]).toBe('window.sill');
		}
	});
});

describe('secrecy', () => {
	it("leaves a player's and a spectator's pieces unchanged whatever the server holds in unexplored cells", () => {
		let checked = 0;
		for (const [k, f] of views.entries()) {
			const known = f.input.known;
			if (!known) continue;
			const { grid } = f.input;
			const { width: w, height: h } = grid;
			const n = w * h;
			const rnd = random(k + 1);
			const unknown = (cx: number, cy: number) =>
				cx < 0 || cy < 0 || cx >= w || cy >= h || !known[cy * w + cx];
			const scramble = (m: Uint8Array | null) =>
				Uint8Array.from({ length: n }, (_, i) =>
					known[i] ? (m ? m[i] : 0) : Math.floor(rnd() * 8)
				);
			const levels = scramble(f.input.levels);
			const floor = scramble(f.input.floor).map((v, i) => (!known[i] && v % 2 ? VOID : v));
			// The context is the kit's (#257): null stays null, a mask is scrambled where unexplored.
			const building =
				f.building &&
				Uint8Array.from({ length: n }, (_, i) => (known[i] ? f.building![i] : rnd() < 0.5 ? 1 : 0));
			// Walls, windows and doors on edges with no explored side.
			const extra: SceneObject[] = [];
			for (let y = 0; y <= h; y++)
				for (let x = 0; x <= w; x++) {
					if (x < w && unknown(x, y - 1) && unknown(x, y) && rnd() < 0.3)
						extra.push({
							id: `s${extra.length}`,
							kind: 'wall',
							a: { x, y },
							b: { x: x + 1, y },
							window: rnd() < 0.3
						});
					if (y < h && unknown(x - 1, y) && unknown(x, y) && rnd() < 0.3)
						extra.push({
							id: `s${extra.length}`,
							kind: 'door',
							a: { x, y },
							b: { x, y: y + 1 },
							open: false
						});
				}
			const objects = [...f.input.objects, ...extra];
			const shape = worldShape({ ...f.input, levels, floor, objects });
			expect(autotile(tileInput(shape, objects, building)), f.name).toEqual(tiled(f));
			checked++;
		}
		expect(checked).toBeGreaterThan(20);
	}, 60_000);
});
