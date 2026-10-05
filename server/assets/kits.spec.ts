// Architecture kits (#250): the schema and roles (src/lib/assets/kit.ts), the
// envelopes the pipeline and the manifest's parser hold every piece to, the
// roles a table needs (kit-needs.ts) and role coverage in checkScenes, phased
// in by KIT_PENDING. The clearance rule through the world's harness is in
// src/lib/tabletop/world/kit-clearance.spec.ts.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	CAP_OVERHANG,
	ENVELOPES,
	FIGURE_CLEAR,
	KIT_FLOOR_IDS,
	KIT_ROLES,
	PLAIN_KIT,
	STEP_HEIGHT as KIT_STEP,
	WALL_HEIGHT as KIT_WALL,
	POST_SIZE,
	TOKEN_DISK,
	WALL_HALF_THICK,
	WALL_HALF_THIN,
	envelopeProblem,
	parseKit
} from '../../src/lib/assets/kit';
import { rolesNeeded, type NeedsInput } from '../../src/lib/assets/kit-needs';
import type { Manifest, ModelEntry } from '../../src/lib/assets/manifest';
import { parseManifest } from '../../src/lib/assets/manifest-parse';
import { encodeFloor, FLOOR_IDS, VOID } from '../../src/lib/game/floor';
import type { SceneObject } from '../../src/lib/game/objects';
import { encodeLevels, MAX_LEVEL } from '../../src/lib/game/terrain';
import { encodeMask } from '../../src/lib/game/visibility';
import { STEP_HEIGHT, WALL_HEIGHT } from '../../src/lib/tabletop/ground';
import { buildAssets, type BuiltAssets } from './pipeline';
import { checkScenes, KIT_PENDING } from './scenes';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** The roles every greybox kit fills: all but the stone halls' own and the roofs. */
const GREYBOX_ROLES =
	/^(wall\.|cap$|plinth|post\.|window\.|door\.|stair\.|railing|bridge\.|cliff\.)/;

let built: BuiltAssets;
beforeAll(async () => {
	built = await buildAssets('assets');
});

const copy = (m: Manifest): Manifest => JSON.parse(JSON.stringify(m));
const kitModel = (bounds: ModelEntry['bounds'], kind: ModelEntry['kind'] = 'kit') =>
	({ kind, bounds }) as ModelEntry;

describe('the clearance constants', () => {
	it('keep a wall, a post and a buttress out of every base disk', () => {
		// A wall's face toward a walkable cell is a disk's edge away from its centre.
		expect(0.5 - WALL_HALF_THIN).toBeCloseTo(TOKEN_DISK, 9);
		expect(Math.hypot(0.5 - POST_SIZE / 2, 0.5 - POST_SIZE / 2)).toBeCloseTo(0.495, 3);
		expect(Math.hypot(0.5 - 0.1, 0.5 - 0.3)).toBeGreaterThan(TOKEN_DISK);
		expect(WALL_HALF_THICK).toBeGreaterThan(WALL_HALF_THIN);
		expect(CAP_OVERHANG).toBeLessThan(0.05);
		expect(FIGURE_CLEAR).toBeLessThan(WALL_HEIGHT);
	});

	it('copy the rules: the heights, the deepest level and every floor but the void', () => {
		expect([KIT_STEP, KIT_WALL]).toEqual([STEP_HEIGHT, WALL_HEIGHT]);
		expect(ENVELOPES['bridge.pier'].y[0]).toBeCloseTo(-MAX_LEVEL * STEP_HEIGHT, 9);
		expect(KIT_FLOOR_IDS).toEqual(FLOOR_IDS.filter((f) => f !== 'void'));
	});

	it('let nothing on an edge rise over the wall, and no cap below FIGURE_CLEAR', () => {
		for (const role of KIT_ROLES) {
			const env = ENVELOPES[role];
			if (env.pivot === 'edge') expect(env.y[1], role).toBeLessThanOrEqual(WALL_HEIGHT);
		}
		expect(ENVELOPES.cap.y[0]).toBe(FIGURE_CLEAR);
		expect(ENVELOPES['wall.straight'].z).toEqual([-WALL_HALF_THIN, WALL_HALF_THIN]);
		expect(ENVELOPES['wall.outer'].z).toEqual([-WALL_HALF_THIN, WALL_HALF_THICK]);
	});

	it('hold a piece by its bounds: thickness, height, and a corner piece by the disks', () => {
		const wall = (z: number) => ({ min: [-0.5, 0, -z], max: [0.5, 2, z] }) as ModelEntry['bounds'];
		expect(envelopeProblem(wall(0.07), ENVELOPES['wall.straight'])).toBeNull();
		expect(envelopeProblem(wall(0.1), ENVELOPES['wall.straight'])).toBe('0.1 > 0.07 toward -z');
		const post = (s: number) =>
			({ min: [-s / 2, 0, -s / 2], max: [s / 2, 2.1, s / 2] }) as ModelEntry['bounds'];
		expect(envelopeProblem(post(POST_SIZE), ENVELOPES['post.X'])).toBeNull();
		expect(envelopeProblem(post(0.4), ENVELOPES['post.X'])).toMatch(/0.424 < 0.43 from the cell/);
		const tall = { min: [-0.15, 0, -0.15], max: [0.15, 2.3, 0.15] } as ModelEntry['bounds'];
		expect(envelopeProblem(tall, ENVELOPES['post.end'])).toBe('2.3 > 2.15 toward +y');
	});
});

describe('parseKit', () => {
	const models = {
		wall: kitModel({ min: [-0.5, 0, -0.07], max: [0.5, 2, 0.07] }),
		crate: kitModel({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, 'prop'),
		tile: kitModel({ min: [-0.5, -0.1, -0.5], max: [0.5, 0, 0.5] })
	};
	const parse = (raw: unknown) => parseKit(raw, models, built.manifest.materials);

	it('reads pieces by role, tiles by floor and a roof', () => {
		const roof = { style: 'gable', pitch: 40, eave: 0.2, material: 'monastery-stone' };
		expect(
			parse({
				name: 'Test',
				roof,
				pieces: { 'wall.straight': [{ model: 'wall', weight: 2 }] },
				floors: { stone: { tiles: [{ model: 'tile' }] } },
				unknown: 1
			})
		).toEqual({
			ok: true,
			kit: {
				name: 'Test',
				roof,
				presumeRoofs: false,
				pieces: { 'wall.straight': [{ model: 'wall', weight: 2 }] },
				floors: { stone: { tiles: [{ model: 'tile' }], broken: [] } }
			}
		});
	});

	it('names an unknown role, an unknown model, a model of another kind and a bad floor', () => {
		const one = (pieces: unknown, floors: unknown = {}) =>
			parse({ name: 'Test', pieces, floors }) as { ok: false; error: string };
		expect(one({ 'wall.curved': [{ model: 'wall' }] }).error).toBe('unknown role "wall.curved"');
		expect(one({ cap: [{ model: 'nope' }] }).error).toBe('cap: unknown model "nope"');
		expect(one({ cap: [{ model: 'crate' }] }).error).toBe(
			'cap: "crate" is a prop, not a kit piece'
		);
		expect(one({ cap: [] }).error).toBe('cap: 1 to 8 pieces');
		expect(one({ cap: [{ model: 'wall' }] }).error).toBe('cap "wall": y 0 < 1.45');
		expect(one({}, { void: { tiles: [{ model: 'tile' }] } }).error).toBe('unknown floor "void"');
	});
});

describe('the built kits', () => {
	it('give every built-in environment a greybox kit of its own, and leave plain procedural', () => {
		expect(built.manifest.kits[PLAIN_KIT]).toEqual({
			name: 'Plain',
			roof: null,
			presumeRoofs: false,
			pieces: {},
			floors: {}
		});
		expect(KIT_PENDING.size).toBe(0);
		for (const [id, env] of Object.entries(built.manifest.environments)) {
			const kit = built.manifest.kits[env.kit!];
			expect(env.kit, id).not.toBe(PLAIN_KIT);
			// Every role the rules can ask a table of, so a GM's own table finds pieces too.
			for (const role of KIT_ROLES.filter((r) => GREYBOX_ROLES.test(r)))
				expect(kit.pieces[role]?.length, `${id} ${role}`).toBeGreaterThan(0);
			// Roofs where the look has them, all six roles.
			for (const role of KIT_ROLES.filter((r) => r.startsWith('roof.')))
				expect(!!kit.pieces[role], `${id} ${role}`).toBe(kit.roof !== null);
			// Every piece is a thirdfold original within the kit budget.
			for (const p of [
				...Object.values(kit.pieces).flat(),
				...Object.values(kit.floors).flatMap((f) => [...f!.tiles, ...f!.broken])
			]) {
				const model = built.manifest.models[p!.model];
				expect(model.credit.license, p!.model).toBe('LicenseRef-thirdfold-original');
				expect(model.triangles, p!.model).toBeLessThanOrEqual(1_500);
			}
		}
		// No built-in table is short of a role.
		expect(checkScenes(built.manifest).filter((p) => p.includes('kit'))).toEqual([]);
	});

	it('are checked by parseManifest, which refuses an unknown kit or a bad piece', () => {
		const m = copy(built.manifest);
		m.environments.village.kit = 'nope';
		expect(parseManifest(m)).toEqual({ ok: false, error: 'environment village: unknown kit' });
		const n = copy(built.manifest);
		n.kits.plain.pieces = { cap: [{ model: 'well' }] };
		expect(parseManifest(n)).toEqual({
			ok: false,
			error: 'kit plain: cap: "well" is a prop, not a kit piece'
		});
		// Without kits (an older manifest), an environment still parses without one.
		const o = copy(built.manifest) as Partial<Manifest>;
		delete o.kits;
		for (const env of Object.values(o.environments!)) delete env.kit;
		expect(parseManifest(o).ok).toBe(true);
	});
});

describe('the pipeline on kits', () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('refuses a 0.2-thick wall, naming it, and an environment without a kit', async () => {
		dir = mkdtempSync(path.join(tmpdir(), 'thirdfold-kits-'));
		cpSync('assets', dir, { recursive: true });
		const kitDir = path.join(dir, 'models', 'kit');
		const wall = (z: number) => ({
			parts: [{ shape: 'box', size: [1, 2, z], at: [0, 1, 0], color: '#8a8a8a' }]
		});
		writeFileSync(path.join(kitDir, 'thick-wall.json'), JSON.stringify(wall(0.2)));
		writeFileSync(
			path.join(dir, 'kits', 'plain.json'),
			JSON.stringify({ name: 'Plain', pieces: { 'wall.straight': [{ model: 'thick-wall' }] } })
		);
		await expect(buildAssets(dir)).rejects.toThrow(
			/plain\.json: wall\.straight "thick-wall": 0\.1 > 0\.07 toward -z/
		);

		writeFileSync(path.join(kitDir, 'thick-wall.json'), JSON.stringify(wall(0.14)));
		const ok = await buildAssets(dir);
		expect(ok.manifest.kits.plain.pieces['wall.straight']).toEqual([{ model: 'thick-wall' }]);
		expect(ok.manifest.models['thick-wall'].kind).toBe('kit');

		const env = path.join(dir, 'environments', 'village.json');
		const village = JSON.parse(readFileSync(env, 'utf8'));
		delete village.kit;
		writeFileSync(env, JSON.stringify(village));
		await expect(buildAssets(dir)).rejects.toThrow(/village\.json: "kit" must name a kit/);
	});
});

describe('role coverage', () => {
	const grid = (width: number, height: number) =>
		({ kind: 'square', cellSize: 1, width, height }) as const;
	const wall = (id: string, a: [number, number], b: [number, number], window = false) =>
		({
			id,
			kind: 'wall',
			a: { x: a[0], y: a[1] },
			b: { x: b[0], y: b[1] },
			...(window ? { window } : {})
		}) as SceneObject;
	const scene = (over: Partial<NeedsInput>): NeedsInput => ({
		grid: grid(3, 3),
		objects: [],
		terrain: null,
		floor: null,
		interior: null,
		...over
	});

	it('reads walls, posts, the outer face, doors, windows, steps, drops and roofs', () => {
		expect(rolesNeeded(scene({}))).toEqual(new Set());
		// One run across the middle: a straight wall, its cap and a post at each end.
		expect(rolesNeeded(scene({ objects: [wall('w', [1, 1], [1, 3])] }))).toEqual(
			new Set(['wall.straight', 'cap', 'post.end'])
		);
		// Along the table's edge, an L: the outer face, an L post.
		expect(
			rolesNeeded(scene({ objects: [wall('w', [0, 0], [2, 0]), wall('v', [0, 0], [0, 2])] }))
		).toEqual(new Set(['wall.straight', 'cap', 'wall.outer', 'post.end', 'post.L']));
		// A cross: an X post; a door; a window between floors, and a bare step and drop.
		const levels = encodeLevels(Uint8Array.of(0, 1, 3, 0, 0, 0, 0, 0, 0));
		const cross = rolesNeeded(
			scene({
				terrain: levels,
				objects: [
					wall('a', [0, 2], [3, 2]),
					wall('b', [1, 1], [1, 3]),
					{ id: 'd', kind: 'door', a: { x: 2, y: 2 }, b: { x: 3, y: 2 }, open: false },
					wall('g', [1, 0], [1, 1], true)
				]
			})
		);
		expect(cross).toEqual(
			new Set([
				'wall.straight',
				'cap',
				'post.end',
				'post.X',
				'door.frame',
				'door.leaf',
				'window.frame',
				'window.glass',
				'window.sill',
				'stair.riser',
				'cliff.face'
			])
		);
		// A T.
		expect(
			rolesNeeded(scene({ objects: [wall('a', [0, 1], [3, 1]), wall('b', [1, 1], [1, 2])] }))
		).toEqual(new Set(['wall.straight', 'cap', 'post.end', 'post.T']));
		// A wall down a drop needs its plinth and retaining wall; toward the void, its outer face.
		const floor = encodeFloor(Uint8Array.of(0, 0, VOID, 0, 0, 0, 0, 0, 0));
		expect(rolesNeeded(scene({ floor, objects: [wall('w', [2, 0], [2, 1])] }))).toEqual(
			new Set(['wall.straight', 'cap', 'wall.outer', 'post.end'])
		);
		const ledge = encodeLevels(Uint8Array.of(0, 1, 1, 0, 1, 1, 0, 1, 1));
		expect(rolesNeeded(scene({ terrain: ledge, objects: [wall('w', [1, 0], [1, 3])] }))).toEqual(
			new Set(['wall.straight', 'cap', 'plinth', 'wall.retaining', 'post.end'])
		);
		const interior = encodeMask(Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0, 0));
		expect(rolesNeeded(scene({ interior }))).toEqual(
			new Set(['roof.ridge', 'roof.eave', 'roof.corner'])
		);
	});

	it("reads a stair run's sides, and its railings where its ground is built (#255)", () => {
		// A two-wide stair climbing east on rows 1 and 2 of a 5x4 table, level 0 north and a terrace
		// one level below it south (a drop on one side only: a stair, not a bridge, #256).
		const terrain = encodeLevels(
			Uint8Array.of(0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 0, 1, 2, 3, 3, 0, 0, 1, 2, 2)
		);
		const stair = { grid: grid(5, 4), terrain };
		const earthen = rolesNeeded(scene(stair));
		expect(earthen).toEqual(new Set(['stair.riser', 'stair.side', 'cliff.face']));
		expect(rolesNeeded(scene({ ...stair, environment: 'stone-halls' }))).toEqual(
			new Set([...earthen, 'railing'])
		);
		expect(rolesNeeded(scene({ ...stair, environment: 'cavern' }))).toEqual(earthen);
	});

	it("reads a bridge's parapets and a built floor's open drop as railings (#256)", () => {
		// A one-wide run at level 3 across a 5x3 table, level 0 north and south: a bridge.
		const terrain = encodeLevels(Uint8Array.of(0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0));
		expect(rolesNeeded(scene({ grid: grid(5, 3), terrain })).has('railing')).toBe(true);
		// A raised terrace (three wide, no bridge): railed on a built floor only.
		const terrace = encodeLevels(Uint8Array.of(3, 3, 3, 3, 3, 3, 0, 0, 0));
		const flat = { grid: grid(3, 3), terrain: terrace };
		expect(rolesNeeded(scene(flat)).has('railing')).toBe(false);
		expect(rolesNeeded(scene({ ...flat, environment: 'stone-halls' })).has('railing')).toBe(true);
	});

	it('fails a table whose kit lacks a role, and an environment on plain or pending', () => {
		const m = copy(built.manifest);
		m.kits.halls = { ...m.kits.plain, pieces: { 'wall.straight': [{ model: 'x' }] } };
		m.environments['stone-halls'].kit = 'halls';
		const problems = checkScenes(m);
		expect(problems).toContain('hollow-bell: monastery: the kit "halls" has no cap piece');
		expect(problems).toContain('hollow-bell: monastery: the kit "halls" has no stair.riser piece');
		expect(problems.some((p) => p.includes('wall.straight'))).toBe(false);
		expect(checkScenes(m, new Set(['stone-halls']))).toContain(
			'environment stone-halls: has the kit "halls"; take it off KIT_PENDING'
		);
		// Back on plain: it needs a kit of its own.
		m.environments['stone-halls'].kit = PLAIN_KIT;
		expect(checkScenes(m)).toEqual([
			'environment stone-halls: on the plain kit; it needs a kit of its own (#261)'
		]);
	});
});
