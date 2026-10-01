// GridLights on the picture (#228): rendered point light is above zero exactly on the cells the
// rules light, and never through a wall. Each test draws a table twice, with and without a light
// (the GridLight's intensity, or one light's colour turned black, which leaves the rules' light
// as it was), and compares the two frames at cell centres and wall faces, so whatever else lights
// the table (the moon, the sky, the rules' darkness, the exposure) drops out: what changes is that
// light's alone. Bloom, the lens and grain are off (they spread light across cells; tested
// elsewhere), motion is reduced. Runs on both backends: SwiftShader's WebGL2 here, WebGPU on the
// real GPU (`npm run test:webgpu`). Bounce (#234): a lit green floor tints the wall beside it
// green, and nothing of it reaches past the wall.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFloor, encodeFloor, FLOOR_IDS } from '$lib/game/floor';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { lightSources, litMask, type Light } from '$lib/game/lights';
import { unitEdges, type SceneObject } from '$lib/game/objects';
import { footprintCells, obstaclesFor } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import { encodeMask, WALL_LEVELS } from '$lib/game/visibility';
import { groundFor, STEP_HEIGHT, WALL_HEIGHT, type Ground } from './ground';
import { GridLight } from './materials/grid-light-node';
import type { GridPose } from './poses';
import { settingsFor } from './quality';
import {
	HEIGHT,
	WIDTH,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	type FixtureView,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 300_000 });

/** The rig camera's vertical field of view (camera.ts). */
const FOV = 45;
/** How tall what stands in a cell is, in cells over its floor (as unexplored-black counts it). */
const TALL = { wall: (WALL_LEVELS + 1) * STEP_HEIGHT, token: 2, light: 2, prop: 4 };
/** How near a wall's line, in cells, a ray counts as passing through it (its thickness, and some). */
const WALL_NEAR = 0.25;

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

type Read = (x: number, y: number) => number[];
type Sample = { cell: GridPos; px: number; py: number };

/** Mounts a view at a pose with fog off and nothing that spreads light; its GridLight and frames. */
async function mount(
	view: FixtureView,
	pose: GridPose,
	options: Parameters<typeof mountFixture>[2] = {}
) {
	let scene: THREE.Scene | null = null;
	let redraw = () => {};
	const devScene = (s: THREE.Scene, r: () => void) => ([scene, redraw] = [s, r]);
	const m = await mountFixture(view, pose, { ...options, devScene });
	mounted = m;
	const settings = settingsFor('medium', m.tabletop.capabilities().backend);
	const quiet = { bloom: false, aberration: false, grain: false, vignette: false };
	m.tabletop.setQuality({ ...settings, ...quiet, miniature: false });
	m.tabletop.setFog(null, 'gm');
	const grids: GridLight[] = [];
	(scene as THREE.Scene | null)?.traverse((o) => o instanceof GridLight && grids.push(o));
	expect(grids).toHaveLength(1);
	const frame = async () => {
		await settle(m.tabletop, 500, 60_000);
		return readFrame(m.canvas, WIDTH, HEIGHT);
	};
	return { m, light: grids[0], redraw, frame };
}

/** The camera the tabletop draws with now. */
function cameraOf(m: Mounted): THREE.PerspectiveCamera {
	const pose = m.tabletop.cameraPose()!;
	const camera = new THREE.PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 1000);
	camera.position.set(pose.position.x, pose.position.y, pose.position.z);
	camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
	camera.updateMatrixWorld();
	return camera;
}

/** A world point's pixel (from the top left), or null off screen with a margin. */
function pixelOf(camera: THREE.Camera, x: number, y: number, z: number) {
	const v = new THREE.Vector3(x, y, z).project(camera);
	const [px, py] = [Math.floor(((v.x + 1) / 2) * WIDTH), Math.floor(((1 - v.y) / 2) * HEIGHT)];
	return v.z > 1 || px < 2 || py < 2 || px > WIDTH - 3 || py > HEIGHT - 3 ? null : { px, py };
}

/** The most any channel changed between two frames over a 3x3 block, or at its centre. */
function change(a: Read, b: Read, px: number, py: number, block = true): number {
	let most = 0;
	for (let dy = block ? -1 : 0; dy <= (block ? 1 : 0); dy++)
		for (let dx = block ? -1 : 0; dx <= (block ? 1 : 0); dx++) {
			const [p, q] = [a(px + dx, py + dy), b(px + dx, py + dy)];
			most = Math.max(most, ...p.map((c, i) => Math.abs(c - q[i])));
		}
	return most;
}

/** What a view's table is made of, as the renderer works it out. */
function groundOf(view: FixtureView) {
	const size = view.grid.width * view.grid.height;
	const levels = view.terrain ? decodeLevels(view.terrain, size) : null;
	const floor = view.floor ? decodeFloor(view.floor, size) : null;
	const blocked = obstaclesFor(view.grid, view.objects, view.props, levels, floor);
	return { blocked, ground: groundFor(view.grid, levels) };
}

/** Cells something stands on (tokens, props, lights' fixtures): their centres aren't floor. */
function occupied(view: FixtureView): Set<string> {
	const cells = [
		...view.tokens.map((t) => t.pos),
		...view.lights.map((l) => l.pos),
		...view.props.flatMap((p) => footprintCells(p))
	];
	return new Set(cells.map((c) => `${c.x},${c.y}`));
}

/** How high (world units) what stands in each cell reaches: a mini, a light's fixture, a prop. */
function standing(view: FixtureView, ground: Ground): Float32Array {
	const { grid } = view;
	const tall = new Float32Array(grid.width * grid.height);
	const raise = (c: GridPos, above: number) => {
		if (c.x < 0 || c.y < 0 || c.x >= grid.width || c.y >= grid.height) return;
		const i = c.y * grid.width + c.x;
		tall[i] = Math.max(tall[i], ground.floorY(c) + above * grid.cellSize);
	};
	for (const t of view.tokens) raise(t.pos, TALL.token);
	for (const l of view.lights) raise(l.pos, TALL.light);
	for (const p of view.props) for (const c of footprintCells(p)) raise(c, TALL.prop);
	return tall;
}

/**
 * Cell centres on screen, on their floor, that nothing stands in front of: the ray up to the
 * camera passes over every wall (within `WALL_NEAR` of its line, below its top and a level) and
 * over what stands in the cells it crosses; but for `skip`.
 */
function centres(view: FixtureView, ground: Ground, camera: THREE.Camera, skip: Set<string>) {
	const { grid } = view;
	const tall = standing(view, ground);
	const top = Math.max(0, ...tall) + TALL.wall * grid.cellSize;
	const walls = view.objects.flatMap((o) => unitEdges(o.a, o.b));
	const near = (gx: number, gy: number) =>
		walls.some((e) =>
			e.a.x === e.b.x
				? Math.abs(gx - e.a.x) < WALL_NEAR && gy >= e.a.y - WALL_NEAR && gy <= e.b.y + WALL_NEAR
				: Math.abs(gy - e.a.y) < WALL_NEAR && gx >= e.a.x - WALL_NEAR && gx <= e.b.x + WALL_NEAR
		);
	const eye = camera.position;
	const out: Sample[] = [];
	for (let y = 0; y < grid.height; y++)
		for (let x = 0; x < grid.width; x++) {
			if (skip.has(`${x},${y}`)) continue;
			const w = gridToWorld(grid, { x, y });
			const floor = ground.floorY({ x, y });
			const p = pixelOf(camera, w.x, floor, w.z);
			if (!p) continue;
			const run = Math.hypot(eye.x - w.x, eye.z - w.z);
			let hidden = false;
			for (let s = grid.cellSize / 16; s <= run && !hidden; s += grid.cellSize / 16) {
				const k = s / run;
				const up = floor + (eye.y - floor) * k;
				if (up > top) break;
				const gx = (w.x + (eye.x - w.x) * k) / grid.cellSize + grid.width / 2;
				const gy = (w.z + (eye.z - w.z) * k) / grid.cellSize + grid.height / 2;
				const [cx, cy] = [Math.floor(gx), Math.floor(gy)];
				if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) break;
				const wallTop = ground.floorY({ x: cx, y: cy }) + TALL.wall * grid.cellSize;
				if (up < wallTop && near(gx, gy)) hidden = true;
				else if (cx !== x || cy !== y) hidden = tall[cy * grid.width + cx] >= up;
			}
			if (!hidden) out.push({ cell: { x, y }, ...p });
		}
	return out;
}

const key = (c: GridPos) => `${c.x},${c.y}`;

describe('GridLights', () => {
	it('light every cell the rules light on dungeon-40, and no other, at its centre', async () => {
		const view = await loadView('dungeon-40', 'dark', 'gm');
		const pose = { target: { x: 20, y: 15 }, distance: 40, azimuth: 0, elevation: 80 };
		const { m, light, redraw, frame } = await mount(view, pose);
		const lit = await frame();
		light.intensity = 0;
		redraw();
		const unlit = await frame();
		const { blocked, ground } = groundOf(view);
		const rules = litMask(view.grid, blocked, lightSources(view.lights, view.tokens));
		const samples = centres(view, ground, cameraOf(m), occupied(view));
		const [lonely, leaks] = [[] as string[], [] as string[]];
		// Each torch whose pool is in view, by the cells beside it, and those lighting them.
		const [seen, shining] = [new Set<string>(), new Set<string>()];
		for (const { cell, px, py } of samples) {
			const isLit = rules[cell.y * view.grid.width + cell.x] === 1;
			const d = change(lit, unlit, px, py, !isLit);
			if (isLit && d < 1) lonely.push(key(cell));
			if (!isLit && d > 0) leaks.push(`${key(cell)}: ${d}`);
			for (const l of view.lights)
				if (isLit && Math.hypot(l.pos.x - cell.x, l.pos.y - cell.y) <= 1.5) {
					seen.add(l.id);
					if (d >= 1) shining.add(l.id);
				}
		}
		expect(samples.length).toBeGreaterThan(400);
		expect(lonely, 'lit cells drawn unlit').toEqual([]);
		expect(leaks, 'unlit cells drawn lit').toEqual([]);
		expect(seen.size, 'torches in view').toBeGreaterThanOrEqual(32);
		expect([...shining].sort(), 'torches lighting their pools').toEqual([...seen].sort());
	});

	it('never light through a wall, its far face or the floor behind it', async () => {
		const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 14, height: 8 };
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 7, y: 0 }, b: { x: 7, y: 8 } };
		const torch = (id: string, x: number): Light => ({
			id,
			pos: { x, y: 4 },
			radius: 4,
			color: '#ff9a3c',
			on: true,
			fixture: false
		});
		// A, half a cell from the wall (mounted on it), and B lighting the far room. A is switched
		// by its colour (black is no light), so the rules' light, and everything it moves, stays.
		const [a, b] = [torch('a', 6), torch('b', 10)];
		const black = { ...a, color: '#000000' };
		const dungeon = await loadView('dungeon-40', 'dark', 'gm');
		const all = encodeMask(new Uint8Array(grid.width * grid.height).fill(1));
		const view: FixtureView = {
			...dungeon,
			grid,
			terrain: null,
			darkness: null,
			interior: null,
			floor: null,
			fog: { enabled: false, visible: all, explored: all, shared: false },
			tokens: [],
			props: [],
			objects: [wall],
			lights: [a, b]
		};
		// From above for the floors on both sides, then from the east for the far face.
		const above = { target: { x: 7, y: 4 }, distance: 14, azimuth: 0, elevation: 80 };
		const east = { target: { x: 7, y: 4 }, distance: 8, azimuth: 90, elevation: 30 };
		const { m, frame } = await mount(view, above);
		const pair = async () => {
			m.tabletop.setLighting('dark', [a, b], view.world);
			const on = await frame();
			m.tabletop.setLighting('dark', [black, b], view.world);
			return [on, await frame()] as const;
		};
		const { ground } = groundOf(view);
		const [on, off] = await pair();
		const floors = centres(view, ground, cameraOf(m), new Set());
		const far = floors.filter((s) => s.cell.x >= 7);
		const near = floors.filter((s) => s.cell.x < 7 && Math.hypot(s.cell.x - 6, s.cell.y - 4) <= 3);
		expect(far.length).toBeGreaterThan(30);
		expect(near.length).toBeGreaterThan(10);
		const dim = near.filter((s) => change(on, off, s.px, s.py, false) < 1).map((s) => s.cell);
		expect(dim, "A's own cells unlit").toEqual([]);
		const leaks = far.filter((s) => change(on, off, s.px, s.py) > 0).map((s) => s.cell);
		expect(leaks, 'floor behind the wall lit by A').toEqual([]);

		m.tabletop.setGridPose(east);
		const [faceOn, faceOff] = await pair();
		const camera = cameraOf(m);
		const face: string[] = [];
		let seen = 0;
		for (let y = 1; y < grid.height - 1; y++)
			for (const h of [0.2, 0.5, 0.8]) {
				const z = gridToWorld(grid, { x: 7, y }).z;
				const p = pixelOf(camera, 0.02, h * WALL_HEIGHT * grid.cellSize, z);
				if (!p) continue;
				seen++;
				const d = change(faceOn, faceOff, p.px, p.py);
				if (d > 0) face.push(`row ${y} at ${h}: ${d}`);
			}
		expect(seen).toBeGreaterThan(10);
		expect(face, 'the far face lit by A').toEqual([]);
	});

	it('bounce a lit green floor onto the wall beside it, and never through it (#234)', async () => {
		const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 14, height: 8 };
		const wall: SceneObject = { id: 'w', kind: 'wall', a: { x: 7, y: 0 }, b: { x: 7, y: 8 } };
		const a: Light = { id: 'a', pos: { x: 5, y: 4 }, radius: 4, color: '#ffffff', on: true };
		const black = { ...a, color: '#000000' };
		const dungeon = await loadView('dungeon-40', 'dark', 'gm');
		const all = encodeMask(new Uint8Array(grid.width * grid.height).fill(1));
		const grass = new Uint8Array(grid.width * grid.height).fill(FLOOR_IDS.indexOf('grass'));
		const view: FixtureView = {
			...dungeon,
			grid,
			environment: null,
			terrain: null,
			darkness: null,
			interior: null,
			floor: encodeFloor(grass),
			fog: { enabled: false, visible: all, explored: all, shared: false },
			tokens: [],
			props: [],
			objects: [wall],
			lights: [{ ...a, fixture: false }]
		};
		// From the west, onto the wall's lit face.
		const west = { target: { x: 6, y: 4 }, distance: 7, azimuth: 270, elevation: 20 };
		const { m, frame } = await mount(view, west);
		const settings = settingsFor('medium', m.tabletop.capabilities().backend);
		const quiet = { bloom: false, aberration: false, grain: false, vignette: false };
		const bounce = (on: boolean) =>
			m.tabletop.setQuality({
				...settings,
				...quiet,
				miniature: false,
				layers: { ...settings.layers, bounce: on }
			});
		const on = await frame();
		bounce(false);
		const off = await frame();
		// Over the face's upper half (above the cavity's fade): how much each channel rose.
		const camera = cameraOf(m);
		const rise = [0, 0, 0];
		let seen = 0;
		for (let y = 2; y < grid.height - 2; y++)
			for (const h of [0.5, 0.7, 0.9]) {
				const z = gridToWorld(grid, { x: 7, y }).z;
				const p = pixelOf(camera, -0.02, h * WALL_HEIGHT * grid.cellSize, z);
				if (!p) continue;
				seen++;
				const [lit, dark] = [on(p.px, p.py), off(p.px, p.py)];
				for (let i = 0; i < 3; i++) rise[i] += lit[i] - dark[i];
			}
		expect(seen).toBeGreaterThan(6);
		expect(rise[1], 'green the bounce adds').toBeGreaterThan(seen);
		expect(rise[1], 'more green than red').toBeGreaterThan(rise[0]);
		expect(rise[1], 'more green than blue').toBeGreaterThan(rise[2]);

		// With bounce on, A on and off: nothing past the wall changes, floor or far face.
		bounce(true);
		const above = { target: { x: 7, y: 4 }, distance: 14, azimuth: 0, elevation: 80 };
		m.tabletop.setGridPose(above);
		const pair = async () => {
			m.tabletop.setLighting('dark', [{ ...a, fixture: false }], view.world);
			const lit = await frame();
			m.tabletop.setLighting('dark', [{ ...black, fixture: false }], view.world);
			return [lit, await frame()] as const;
		};
		const [lit, unlit] = await pair();
		const { ground } = groundOf(view);
		const far = centres(view, ground, cameraOf(m), new Set()).filter((s) => s.cell.x >= 7);
		expect(far.length).toBeGreaterThan(30);
		const leaks = far.filter((s) => change(lit, unlit, s.px, s.py) > 0).map((s) => s.cell);
		expect(leaks, 'floor behind the wall lit by A').toEqual([]);
		m.tabletop.setGridPose({ target: { x: 7, y: 4 }, distance: 8, azimuth: 90, elevation: 30 });
		const [faceOn, faceOff] = await pair();
		const east = cameraOf(m);
		const face: string[] = [];
		for (let y = 1; y < grid.height - 1; y++)
			for (const h of [0.2, 0.5, 0.8]) {
				const z = gridToWorld(grid, { x: 7, y }).z;
				const p = pixelOf(east, 0.02, h * WALL_HEIGHT * grid.cellSize, z);
				const d = p ? change(faceOn, faceOff, p.px, p.py) : 0;
				if (d > 0) face.push(`row ${y} at ${h}: ${d}`);
			}
		expect(face, 'the far face lit by A').toEqual([]);
	});

	it("keep the monastery's gallery lamp to the cells it lights, from its balcony", async () => {
		const view = await loadView('monastery', 'dark', 'gm');
		const lamp = view.lights.find((l) => l.id === 'mn-gallery-lamp')!;
		expect(lamp.on).toBe(true);
		const pose = { target: lamp.pos, distance: 16, azimuth: 0, elevation: 80 };
		const { m, frame } = await mount(view, pose);
		const on = await frame();
		// Its colour turned black (no light): the rules' light stays as it was.
		const others = view.lights.map((l) => (l === lamp ? { ...l, color: '#000000' } : l));
		m.tabletop.setLighting(view.ambient, others, view.world);
		const off = await frame();
		const { blocked, ground } = groundOf(view);
		const rules = litMask(view.grid, blocked, [lamp]);
		const samples = centres(view, ground, cameraOf(m), occupied(view));
		const isLit = (s: Sample) => rules[s.cell.y * view.grid.width + s.cell.x] === 1;
		const leaks = samples.filter((s) => !isLit(s) && change(on, off, s.px, s.py) > 0);
		expect(samples.length).toBeGreaterThan(100);
		const lights = samples.filter((s) => isLit(s) && change(on, off, s.px, s.py, false) >= 1);
		expect(lights.length, 'cells the lamp lights').toBeGreaterThan(0);
		expect(
			leaks.map((s) => key(s.cell)),
			'cells it lights past the rules'
		).toEqual([]);
	});

	it('flicker by the clock alone: two held times, two frames, each the same again (#231)', async () => {
		const view = await loadView('dungeon-40', 'dark', 'gm');
		const pose = { target: { x: 20, y: 15 }, distance: 40, azimuth: 0, elevation: 80 };
		const clock = manualClock(1_000_000);
		const { m } = await mount(view, pose, { clock, reducedMotion: false });
		// The torches flicker, so the table never rests: wait for frames drawn at the held time.
		const at = async (t: number) => {
			clock.set(t);
			const start = m.tabletop.stats().frames;
			await expect
				.poll(() => m.tabletop.stats().frames, { timeout: 60_000, interval: 50 })
				.toBeGreaterThan(start + 1);
			return readFrame(m.canvas, WIDTH, HEIGHT);
		};
		await settle(m.tabletop, 500, 20_000);
		const [a, b, again] = [await at(1_000_000), await at(1_000_400), await at(1_000_000)];
		// The output's dither follows the clock too (a level or two everywhere); flicker is more.
		const DITHER = 2;
		let [moved, differ] = [0, 0];
		for (let y = 0; y < HEIGHT; y += 2)
			for (let x = 0; x < WIDTH; x += 2) {
				if (change(a, b, x, y, false) > DITHER) moved++;
				if (change(a, again, x, y, false) > 0) differ++;
			}
		expect(moved, 'pixels the flicker changed').toBeGreaterThan(1000);
		expect(differ, 'pixels that differ at the same time').toBe(0);
	});
});
