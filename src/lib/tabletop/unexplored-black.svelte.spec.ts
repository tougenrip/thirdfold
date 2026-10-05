// Unexplored cells are exactly black (#176, the acceptance item of #161): for
// players and spectators, on every tier, with every layer on (grid lines shown,
// mist at dusk and after dark, fixtures, carried light, bloom, the lens and
// grain; no dice, no hover), the centre of every unexplored cell a pose shows
// reads (0, 0, 0) in the captured frame, the path the goldens use. It is the
// picture's side of the server keeping secrets: no layer or effect may lift
// space the viewer was never shown. Cells right beside explored ground count
// too, where bloom and the lens spread light and the output stage's re-mask
// (#173) must take it away again; left out are cells hidden behind something
// standing on explored ground, cells too small to hold a 3x3 block and cells
// off screen. A new layer is turned on here when it lands (docs/RENDERING.md). Many lights (#228):
// dungeon-40's torches and ref-6's braziers, and beside the player a light carrier on ground it
// never saw, its lantern reaching on into the dark (the server never sends one, grid-light-layer.spec.ts;
// here the picture holds even if it did). The sky (#225) adds
// its own poses, always run: a low camera toward the horizon, dense haze, a dark area at noon and a
// roofed table. Bounce and cavity (#234) are on, at each tier's strength. The probe grid (#235), off
// by default, is baked and on for the test world's player on high. The world's chunks (#240) and
// their cliffs and risers (#241, the rock kind reading the cell behind each face) are in every case;
// the Hollow's fogged player sees cliffs on every tier, biplanar on low and triplanar above. The
// void's chasms (#243) too: the night train's player looks down its gaps onto the moving ground,
// and a hole's sample is left out where its ray falls on to ground the viewer was shown (`pastHole`).
// Kit walls (#252) are in every case: every fixture's walls are the batched pieces autotile picks
// (posts, caps, plinths and retaining pieces down drops), the surface kind's `batched` variant, the
// same whether a role is the built-in piece or a kit's (walls.svelte.spec.ts draws a synthetic kit).
// Kit floor tiles (#254): the stand-in kit's tiles on every case's default ground and man-made
// floors, packed round the camera (built only from explored cells, so none stand on hidden ones).
// Stairs (#255) are in the chunks too: the monastery's and the Hollow's steps, stringers, rails and
// kerbs, built only from explored cells, and a rail stands as tall as `TALL.rail` over its step.
// Window and door frames and door leaves (#253) are in every case with walls: frames are wall
// pieces, leaves one batch in the kit pieces' material (the Hollow's player, in the slim set on
// every tier, has a door open), and an open leaf stands round its hinge's corner.
//
// CI takes the slim set (`SLIM`, a few cases per tier); every fixture with fog,
// the player and the spectator, every pose and tier, and the medium tier again
// with reduced motion run by hand, before a rendering PR:
//   THIRDFOLD_UNEXPLORED=full npm run test:render -- src/lib/tabletop/unexplored-black.svelte.spec.ts
//   THIRDFOLD_WEBGPU=1 THIRDFOLD_UNEXPLORED=full npx vitest run --project client-webgpu src/lib/tabletop/unexplored-black.svelte.spec.ts

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { cellsBeside, MAX_STEP, orderCorners, unitEdges } from '$lib/game/objects';
import { footprintCells } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import { decodeMask, WALL_LEVELS } from '$lib/game/visibility';
import { STEP_HEIGHT } from './ground';
import { useTileSet } from './floor-tiles-layer';
import { decodeFloor } from '$lib/game/floor';
import { pastHole } from './world/invariants';
import { knownOf, worldShape } from './world/shape';
import { builtGround, stairsOf } from './world/stairs';
import type { GridPose } from './poses';
import { settingsFor, type QualitySettings, type Tier } from './quality';
import {
	BACKEND,
	FIXTURES,
	HEIGHT,
	WIDTH,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	testTiles,
	wait,
	type Band,
	type FixtureView,
	type Mounted,
	type PoseName,
	type Viewer
} from './testing';

vi.setConfig({ testTimeout: 300_000 });

/**
 * How tall, in cells above its floor, what the viewer was sent stands, with room to spare: explored
 * floor (grid lines, mist), a wall or door beside its edge (WALL_LEVELS steps, the lintel), a mini
 * with its name label, a light's fixture, and a prop (the tallest model, a tree or a bell frame).
 */
const TALL = {
	floor: 0.1,
	wall: WALL_LEVELS * STEP_HEIGHT + 0.3,
	token: 2,
	light: 2,
	prop: 4,
	rail: 1.1 // a kit's balustrade stands 1.0 (#261)
};
/** Cells between baked probes in the probe cases: 4 × 3 × 4 on the test world, not 9 × 3 × 9. */
const PROBE_TEST_SPACING = 8;
/** Fewer samples than this and a pose proves nothing: it is left out, and said so. */
const MIN_SAMPLES = 20;
/** From above a light carrier on unexplored ground (#228), round its cell. */
const ABOVE = { distance: 12, azimuth: 20, elevation: 70 };
/** The rig camera's vertical field of view (camera.ts). */
const FOV = 45;
const POSES: readonly PoseName[] = ['overview', 'close', 'low', 'dark'];
const TIERS: readonly Tier[] =
	BACKEND === 'webgpu' ? ['low', 'medium', 'high', 'ultra'] : ['low', 'medium', 'high'];
/**
 * CI's cases, a few minutes on its software GPU: the Hollow (the most unexplored ground in view)
 * on every tier, ref-8's own spectator at dusk, whose close and low poses keep enough samples, and
 * its dark pose with reduced motion.
 */
const SLIM = new Set([
	...TIERS.map((t) => `hollow player dark ${t}`),
	'ref-8 spectator dusk medium',
	'ref-8 spectator dark medium reduced',
	'railcar player dusk medium',
	'hollow player dark medium cloud',
	'dungeon-40 player dark medium carrier',
	'ref-6 player dark medium carrier',
	'test-world player dusk high probes'
]);
const FULL = inject('unexplored') === 'full';

interface Case {
	fixture: string;
	viewer: Viewer;
	band: Band;
	poses: PoseName[];
	tier: Tier;
	reduced: boolean;
	/** The fog cloud's layer on, off by default until the owner's review (#174). */
	cloud: boolean;
	/** A light carrier on unexplored ground beside the player's token (#228). */
	carrier: boolean;
	/** The probe grid's layer on (#235, off by default until its gates), baked before the poses. */
	probes: boolean;
	label: string;
}

/**
 * Every case: each fixture's views with fog on and ground unexplored, for the player and the
 * spectator (left out where the spectator is sent exactly what the player is: the one player is
 * the whole party), the poses grouped by the band they draw in (the dark pose is its own), on every
 * tier, and the medium tier again with reduced motion (the static cloud, instant reveals) and
 * again with the fog cloud's layer on (#174).
 */
async function allCases(): Promise<Case[]> {
	const out: Case[] = [];
	for (const fixture of FIXTURES) {
		const sidecar = await loadSidecar(fixture);
		const bands = new Map<Band, PoseName[]>();
		for (const pose of POSES) {
			const band = (sidecar.poses[pose] as { ambient?: Band }).ambient ?? sidecar.ambient;
			bands.set(band, [...(bands.get(band) ?? []), pose]);
		}
		for (const [band, poses] of bands)
			for (const viewer of ['player', 'spectator'] as const) {
				const view = await loadView(fixture, band, viewer);
				const size = view.grid.width * view.grid.height;
				if (!view.fog.enabled || decodeMask(view.fog.explored, size).every((c) => c === 1))
					continue;
				const player = await loadView(fixture, band, 'player');
				const same = (v: FixtureView) => JSON.stringify({ ...v, viewer: null });
				if (viewer === 'spectator' && same(view) === same(player)) continue;
				const each = (
					tier: Tier,
					reduced: boolean,
					cloud = false,
					carrier = false,
					probes = false
				) => {
					const label =
						`${fixture} ${viewer} ${band} ${tier}` +
						`${reduced ? ' reduced' : ''}${cloud ? ' cloud' : ''}${carrier ? ' carrier' : ''}` +
						`${probes ? ' probes' : ''}`;
					out.push({ fixture, viewer, band, poses, tier, reduced, cloud, carrier, probes, label });
				};
				for (const tier of TIERS) each(tier, false);
				each('medium', true);
				each('medium', false, true);
				if (viewer === 'player') each('medium', false, false, true);
				if (viewer === 'player') each('high', false, false, false, true);
			}
	}
	return out;
}

const CHOSEN = (await allCases()).filter((c) => FULL || SLIM.has(c.label));
/** `THIRDFOLD_SHARD=k/n`: every nth case from the kth, so CI takes them in parallel jobs. */
const [k, n] = inject('shard').split('/').map(Number);
/**
 * Whether the `i`th of the other tests (the cases without probes, then the sky's, then the last) is
 * this shard's: every one but the last shard takes them in turn; the probe cases (a bake each,
 * minutes on SwiftShader) have the last shard to themselves.
 */
const ours = (i: number) => (n === 1 ? true : k < n && i % (n - 1) === k - 1);
const LIGHT = CHOSEN.filter((c) => !c.probes);
const CASES = [
	...LIGHT.filter((_, i) => ours(i)),
	...CHOSEN.filter((c) => c.probes && (n === 1 || k === n))
];

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	useTileSet(null);
});

interface Sample {
	cell: { x: number; y: number };
	/** Pixel, from the top left. */
	px: number;
	py: number;
}

/**
 * The unexplored cell centres a camera shows clearly: on screen with a 3x3 block inside the cell,
 * and with nothing the viewer was sent standing between them and the camera (`standing`).
 */
function samplesFor(
	grid: SquareGrid,
	tall: Float32Array,
	camera: THREE.PerspectiveCamera,
	hole: ReturnType<typeof pastHole> | null = null
): Sample[] {
	const { width: w, height: h, cellSize } = grid;
	const toPixel = (v: THREE.Vector3) => {
		v.project(camera);
		return { x: ((v.x + 1) / 2) * WIDTH, y: ((1 - v.y) / 2) * HEIGHT, z: v.z };
	};
	const top = tall.reduce((a, b) => Math.max(a, b), 0) * cellSize;
	const out: Sample[] = [];
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			if (tall[y * w + x] >= 0) continue;
			const at = gridToWorld(grid, { x, y });
			const p = toPixel(new THREE.Vector3(at.x, 0, at.z));
			if (p.z > 1 || p.x < 2 || p.y < 2 || p.x > WIDTH - 3 || p.y > HEIGHT - 3) continue;
			// The 3x3 block, whole pixels, must lie inside the cell's outline on screen: at a grazing
			// angle a cell is thinner than it is wide, and what stands beyond it shows just past it.
			const outline = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			].map(([dx, dz]) =>
				toPixel(new THREE.Vector3(at.x + (dx * cellSize) / 2, 0, at.z + (dz * cellSize) / 2))
			);
			const px = Math.floor(p.x);
			const py = Math.floor(p.y);
			const block = [
				[px - 1, py - 1],
				[px + 2, py - 1],
				[px + 2, py + 2],
				[px - 1, py + 2]
			];
			if (!block.every(([bx, by]) => inside(outline, bx, by))) continue;
			// A hole (the void, #243) shows what its ray falls on to: left out if that was shown.
			if (hole?.(y * w + x, camera.position)) continue;
			if (!occluded(at, camera.position, grid, tall, top)) out.push({ cell: { x, y }, px, py });
		}
	return out;
}

/** Whether a point is inside a convex outline (either winding). */
function inside(outline: { x: number; y: number }[], x: number, y: number): boolean {
	const sides = outline.map((a, i) => {
		const b = outline[(i + 1) % outline.length];
		return Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x));
	});
	return sides.every((s) => s >= 0) || sides.every((s) => s <= 0);
}

/**
 * Whether the ray from a floor point up to the camera passes through something standing in a cell
 * (as tall as `standing` says), or leaves the table below `top`, the tallest thing on it (the rim
 * and what lies beyond count as in the way).
 */
function occluded(
	at: { x: number; z: number },
	eye: THREE.Vector3,
	grid: SquareGrid,
	tall: Float32Array,
	top: number
): boolean {
	const { width: w, height: h, cellSize } = grid;
	const run = Math.hypot(eye.x - at.x, eye.z - at.z);
	for (let s = 0; s <= run; s += cellSize / 8) {
		const k = s / run;
		const up = eye.y * k;
		if (up > top) return false;
		const cx = Math.floor((at.x + (eye.x - at.x) * k) / cellSize + w / 2);
		const cy = Math.floor((at.z + (eye.z - at.z) * k) / cellSize + h / 2);
		if (cx < 0 || cy < 0 || cx >= w || cy >= h) return true;
		if (tall[cy * w + cx] * cellSize >= up) return true;
	}
	return false;
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

/**
 * Waits for the warm-up to end and a first frame, then for the frames a pose takes to converge
 * (TRAA's history), then for quiet or a moment: flames and mist keep drawing at the ambient rate,
 * so a table with them never goes quiet.
 */
async function converge(m: Mounted, frames: number): Promise<void> {
	const until = performance.now() + 60_000;
	const stats = () => m.tabletop.stats();
	while ((stats().frames === 0 || stats().holding) && performance.now() < until) await wait(50);
	const start = stats().frames;
	while (stats().frames - start < frames + 1 && performance.now() < until) await wait(50);
	await settle(m.tabletop, 250, 1000);
	expect(stats().frames, 'frames drawn').toBeGreaterThan(0);
}

/** Whether any pixel of the frame, every fourth along both axes, is not black. */
function litAnywhere(at: (x: number, y: number) => number[]): boolean {
	for (let y = 0; y < HEIGHT; y += 4)
		for (let x = 0; x < WIDTH; x += 4) if (at(x, y).some((c) => c !== 0)) return true;
	return false;
}

/** What the samples read that isn't exactly black, named by case, pose, cell and pixel. */
function litAt(name: string, samples: Sample[], at: (x: number, y: number) => number[]): string[] {
	const lit: string[] = [];
	for (const { cell, px, py } of samples)
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const rgb = at(px + dx, py + dy);
				if (rgb.some((c) => c !== 0))
					lit.push(`${name}: cell ${cell.x},${cell.y} at ${px + dx},${py + dy}: ${rgb}`);
			}
	return lit;
}

/**
 * How tall (in cells, from level 0) what the viewer was sent stands in each cell, or -1 for a cell
 * it knows nothing of: explored ground, the cells beside every wall and door it was sent, and every
 * token, light and prop. The server sends a wall whole once any cell beside it was explored
 * (views.ts `touches`), so a long wall runs on through unexplored ground (village: the smithy's
 * south wall); that is the view's rule, not a layer lifting black, and this test holds the picture
 * to what the viewer was sent.
 */
function standing(view: FixtureView): Float32Array {
	const { grid } = view;
	const size = grid.width * grid.height;
	const levels = view.terrain ? decodeLevels(view.terrain, size) : null;
	const tall = new Float32Array(size).fill(-1);
	const raise = (c: { x: number; y: number }, above: number) => {
		if (c.x < 0 || c.y < 0 || c.x >= grid.width || c.y >= grid.height) return;
		const i = c.y * grid.width + c.x;
		tall[i] = Math.max(tall[i], (levels?.[i] ?? 0) * STEP_HEIGHT + above);
	};
	const explored = decodeMask(view.fog.explored, size);
	for (let i = 0; i < size; i++)
		if (explored[i]) raise({ x: i % grid.width, y: Math.floor(i / grid.width) }, TALL.floor);
	for (const o of view.objects)
		for (const e of unitEdges(o.a, o.b))
			for (const c of cellsBeside(grid, e)) raise(c, TALL.wall + MAX_STEP * STEP_HEIGHT);
	// An open door's leaf (#253) stands along a grid line from its hinge, its first corner: the
	// four cells round that corner.
	for (const o of view.objects) {
		if (o.kind !== 'door' || !o.open) continue;
		const { a } = orderCorners(o.a, o.b);
		for (const [dx, dy] of [
			[-1, -1],
			[0, -1],
			[-1, 0],
			[0, 0]
		])
			raise({ x: a.x + dx, y: a.y + dy }, TALL.wall + MAX_STEP * STEP_HEIGHT);
	}
	for (const t of view.tokens) raise(t.pos, TALL.token);
	for (const l of view.lights) raise(l.pos, TALL.light);
	for (const p of view.props) for (const c of footprintCells(p)) raise(c, TALL.prop);
	// A stair's rail or kerb (#255) over its step and the edge beside it, from the step's floor.
	const shape = worldShape({
		grid,
		levels,
		floor: view.floor ? decodeFloor(view.floor, size) : null,
		objects: view.objects,
		known: knownOf(grid, view.fog, false)
	});
	for (const p of stairsOf(shape, { built: builtGround(view.environment) }).pieces) {
		if (p.role !== 'railing' && p.role !== 'kerb') continue;
		const top = shape.levels[p.cell] * STEP_HEIGHT + TALL.rail;
		for (const i of [p.cell, p.across]) tall[i] = Math.max(tall[i], top);
	}
	return tall;
}

/**
 * Mounts a case's view at its first pose with every layer on: the full grid and a highlight on an
 * unexplored cell (#245), and grain and dither on unless motion is reduced.
 */
async function mountCase(
	c: Pick<Case, 'fixture' | 'viewer' | 'band' | 'tier' | 'reduced'> & {
		cloud?: boolean;
		carrier?: boolean;
		probes?: boolean;
	}
) {
	const sidecar = await loadSidecar(c.fixture);
	const sent = await loadView(c.fixture, c.band, c.viewer);
	const view = c.carrier ? withCarrier(sent, sidecar.player.tokenId) : sent;
	expect(view.fog.enabled).toBe(true);
	const clock = manualClock(5000);
	useTileSet(testTiles()); // kit floor tiles (#254) on every case, until #261's greybox kits
	const m = await mountFixture(view, sidecar.poses.overview, {
		clock,
		reducedMotion: c.reduced,
		tier: c.tier,
		// A coarser lattice than the app's (PROBE_SPACING), corners and all: probes still stand over
		// the hidden ground and light it, a fraction of the bake's minutes on SwiftShader.
		probeSpacing: c.probes ? PROBE_TEST_SPACING : undefined
	});
	mounted = m;
	// The shader grid in full on every chunk's twin (#245), and a hatched highlight on an
	// unexplored cell: neither may lay anything over black.
	m.tabletop.setGridMode('build');
	const { width, height } = view.grid;
	const unexplored = decodeMask(view.fog.explored, width * height).indexOf(0);
	if (unexplored >= 0)
		m.tabletop.setHighlight(
			{ x: unexplored % width, y: Math.floor(unexplored / width) },
			'blocked'
		);
	clock.set(65_000); // past every fade; flames, mist and grain still hold still
	const settings = settingsFor(c.tier, m.tabletop.capabilities().backend);
	expect(settings.bloom && settings.layers.lens && settings.grain).toBe(true);
	expect(settings.layers.bounce, 'bounce and cavity on (#234)').toBe(true);
	if (c.cloud) {
		const layers = { ...settings.layers, fogcloud: true };
		m.tabletop.setQuality({ ...settings, miniature: false, layers });
	}
	if (c.probes) await bakeProbes(m, clock, settings);
	return { m, sidecar, view, settings };
}

/**
 * Turns the probe grid on (#235) and moves the held clock on until a bake has finished and faded
 * in, so the poses draw with the probes at full strength.
 */
async function bakeProbes(m: Mounted, clock: ReturnType<typeof manualClock>, s: QualitySettings) {
	m.tabletop.setQuality({ ...s, miniature: false, layers: { ...s.layers, probes: true } });
	const baked = () => m.tabletop.stats().timings['probe-bake']?.count ?? 0;
	const until = performance.now() + 600_000;
	while (!baked() && performance.now() < until) {
		clock.set(clock.now() + 1000);
		await wait(250);
	}
	expect(baked(), 'the probes baked').toBeGreaterThan(0);
	clock.set(clock.now() + 1000); // past the fade
	// Its frames drawn: torches flicker at dusk with motion on, so the table never goes quiet (a
	// settle waited out its whole limit, two minutes on SwiftShader).
	await converge(m, 1);
}

/**
 * The view with a lantern carrier on the unexplored cell nearest the player's token: what the
 * server never sends (grid-light-layer.spec.ts), so its light reaches on into hidden ground.
 */
function withCarrier(view: FixtureView, tokenId: string): FixtureView {
	const { width, height } = view.grid;
	const me = view.tokens.find((t) => t.id === tokenId) ?? view.tokens[0];
	const explored = decodeMask(view.fog.explored, width * height);
	let [at, best] = [me.pos, Infinity];
	for (let i = 0; i < explored.length; i++) {
		const cell = { x: i % width, y: Math.floor(i / width) };
		const d = Math.hypot(cell.x - me.pos.x, cell.y - me.pos.y);
		if (!explored[i] && d < best) [at, best] = [cell, d];
	}
	expect(best).toBeLessThan(Infinity);
	const carrier = { ...me, id: 'unseen-carrier', pos: at, light: 6, lightColor: '#6fe08a' };
	return { ...view, tokens: [...view.tokens, carrier] };
}

describe(`unexplored cells on ${BACKEND}`, () => {
	// A slim case whose fixture or view changed would otherwise drop out of CI without a word.
	it.skipIf(FULL)('finds every case of the slim set', () => {
		expect(CHOSEN.map((c) => c.label).sort()).toEqual([...SLIM].sort());
	});

	for (const c of CASES)
		it(`${c.label}: black at ${c.poses.join(', ')}`, async () => {
			const { m, sidecar, view, settings } = await mountCase(c);
			const tall = standing(view);
			const lit: string[] = [];
			let checked = 0;
			// A carrier's case also looks down on it from above (ref-6's own poses keep too few samples).
			const carrier = view.tokens.find((t) => t.id === 'unseen-carrier');
			const poses: [string, GridPose][] = c.poses.map((p) => [p, sidecar.poses[p]]);
			if (carrier) poses.push(['carrier', { ...ABOVE, target: carrier.pos }]);
			for (const [pose, where] of poses) {
				// The camera takes the pose at once: a pose with too few samples draws nothing more.
				m.tabletop.setGridPose(where);
				const camera = cameraOf(m);
				const hole = pastHole(view, (i) => tall[i] >= 0);
				const samples = samplesFor(view.grid, tall, camera, hole);
				if (samples.length < MIN_SAMPLES) {
					console.info(`${c.label} ${pose}: ${samples.length} samples, left out`);
					continue;
				}
				checked++;
				await converge(m, settings.convergeFrames);
				const at = await readFrame(m.canvas, WIDTH, HEIGHT);
				lit.push(...litAt(`${c.label} ${pose}`, samples, at));
				// The frame read back isn't all black (the self-check below shows a lit sample fails).
				expect(litAnywhere(at), `${pose}: anything lit`).toBe(true);
			}
			// A view whose every pose is left out proves nothing (ref-6, and the dark pose close by the
			// party on four tables); every case CI takes checks at least one pose.
			if (!FULL) expect(checked, 'poses with enough samples').toBeGreaterThan(0);
			else if (!checked) console.info(`${c.label}: no pose with ${MIN_SAMPLES} samples, left out`);
			expect(lit.slice(0, 10), `${lit.length} lit pixels`).toEqual([]);
		});

	// The sky's poses (#225): the atmosphere never lifts unexplored ground. The village's player at
	// noon under a clear sky: a low camera toward the horizon across hidden cells (on the dome's tier
	// and the flat sky's), dense haze, a dark area at noon (the sky's light and IBL out of it), and a
	// roof over the whole table (the sky's reach indoors).
	const NOON = 780;
	const size = (v: FixtureView) => v.grid.width * v.grid.height;
	const SKY_CASES: [string, Tier, (m: Mounted, v: FixtureView) => void][] = [
		['low toward the horizon', 'medium', () => {}],
		['low toward the horizon, flat sky', 'low', () => {}],
		[
			'dense haze',
			'medium',
			(m, v) =>
				m.tabletop.setLighting('day', v.lights, {
					...v.world,
					time: NOON,
					haze: { density: 1, color: '#d8dde4' }
				})
		],
		[
			'a dark area at noon',
			'medium',
			(m, v) => m.tabletop.setDarkness(new Uint8Array(size(v)).fill(1))
		],
		['roofed', 'medium', (m, v) => m.tabletop.setInterior(new Uint8Array(size(v)).fill(1))]
	];
	for (const [i, [name, tier, setUp]] of SKY_CASES.entries())
		it.runIf(ours(LIGHT.length + i))(`the sky's poses: ${name} on ${tier}, black`, async () => {
			const { m, sidecar, view, settings } = await mountCase({
				fixture: 'village',
				viewer: 'player',
				band: 'day',
				tier,
				reduced: true
			});
			m.tabletop.setLighting('day', view.lights, { ...view.world, time: NOON, sky: 'temperate' });
			setUp(m, view);
			const tall = standing(view);
			// Low, over the hidden cell nearest the table's middle, so it looks across hidden ground to
			// the horizon (in view below 22.5 degrees, half the field of view), turned four ways.
			const { width, height } = view.grid;
			let target = { x: 0, y: 0 };
			for (let i = 0, best = Infinity; i < tall.length; i++) {
				const cell = { x: i % width, y: Math.floor(i / width) };
				const d = Math.hypot(cell.x - width / 2, cell.y - height / 2);
				if (tall[i] < 0 && d < best) [best, target] = [d, cell];
			}
			const poses = name.startsWith('low')
				? [0, 90, 180, 270].map((azimuth) => ({ target, distance: 14, azimuth, elevation: 12 }))
				: [sidecar.poses.overview];
			const lit: string[] = [];
			let checked = 0;
			for (const pose of poses) {
				m.tabletop.setGridPose(pose as never);
				const samples = samplesFor(view.grid, tall, cameraOf(m));
				if (samples.length < MIN_SAMPLES) {
					console.info(`${name} ${JSON.stringify(pose)}: ${samples.length} samples, left out`);
					continue;
				}
				checked++;
				await converge(m, settings.convergeFrames);
				const at = await readFrame(m.canvas, WIDTH, HEIGHT);
				lit.push(...litAt(`village ${name} ${JSON.stringify(pose)}`, samples, at));
				expect(litAnywhere(at), `${name}: anything lit`).toBe(true);
			}
			expect(checked, 'poses with enough samples').toBeGreaterThan(0);
			expect(lit.slice(0, 10), `${lit.length} lit pixels`).toEqual([]);
		});

	it.runIf(ours(LIGHT.length + SKY_CASES.length))(
		'fails on a layer exempt from the fog, naming the fixture, pose and cell',
		async () => {
			const c = { fixture: 'dungeon-40', viewer: 'player', band: 'dark', tier: 'medium' } as const;
			const { m, view, settings } = await mountCase({ ...c, reduced: false });
			// The GM's reveal preview over the whole table: an overlay the fog never shades.
			const { width, height } = view.grid;
			m.tabletop.setPreview([
				{ kind: 'area', from: { x: 0, y: 0 }, to: { x: width - 1, y: height - 1 }, tone: 'reveal' }
			]);
			await converge(m, settings.convergeFrames);
			const samples = samplesFor(view.grid, standing(view), cameraOf(m));
			expect(samples.length).toBeGreaterThanOrEqual(MIN_SAMPLES);
			const lit = litAt('dungeon-40 overview', samples, await readFrame(m.canvas, WIDTH, HEIGHT));
			expect(lit.length).toBeGreaterThan(0);
			expect(lit[0]).toMatch(/^dungeon-40 overview: cell \d+,\d+ at \d+,\d+: /);
		}
	);
});
