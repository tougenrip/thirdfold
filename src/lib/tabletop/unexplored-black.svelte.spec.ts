// Unexplored cells are exactly black (#176, the acceptance item of #161): for
// players and spectators, on every tier, with grain and dither on (motion not
// reduced, the clock held), the centre of every unexplored cell a pose shows
// reads (0, 0, 0) in the captured frame, the path the goldens use. It is the
// picture's side of the server keeping secrets: no layer or effect may lift
// space the viewer was never shown. Cells near explored ground are left out
// (bloom and the lens carry what the viewer already sees a little way over the
// fog's edge), and so are cells hidden behind something standing on explored
// ground, cells too small to hold a 3x3 block and cells off screen.

import * as THREE from 'three/webgpu';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import { cellsBeside, unitEdges } from '$lib/game/objects';
import { decodeMask } from '$lib/game/visibility';
import { settingsFor, type Tier } from './quality';
import {
	BACKEND,
	HEIGHT,
	WIDTH,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	wait,
	type FixtureView,
	type Mounted,
	type PoseName,
	type Viewer
} from './testing';

vi.setConfig({ testTimeout: 120_000 });

/** Cells (Chebyshev) a sample keeps from explored ground: beyond the bloom of its lights. */
const MARGIN = 3;
/** Taller than anything that can stand on explored ground (raised ground, a wall, a bell). */
const TALLEST = 8;
/** Fewer samples than this and a pose proves nothing. */
const MIN_SAMPLES = 20;
/** The rig camera's vertical field of view (camera.ts). */
const FOV = 45;

const TIERS: Tier[] = ['low', 'medium', 'high'];
/**
 * The fixtures with fog on and enough unexplored ground in view at the overview pose, one of each
 * kind (dark, dusk, day, raised ground, a large table), and who looks. The spectator sees the whole
 * party, which is the one player in every fixture but ref-8, so only ref-8's spectator is its own
 * case. Left out: ref-1, ref-3 and ref-7 have nothing unexplored; the close and low poses look at
 * the party, whose explored ground leaves fewer than MIN_SAMPLES cells in view; the other story
 * and stress tables repeat these (and SwiftShader's readback costs seconds a frame, #176's budget).
 */
/**
 * Every tier on the two darkest player views (the most unexplored ground in view), and the dusk
 * village and ref-8's spectator on medium: kept to a few minutes on CI's software GPU. Soft edges
 * are always on; the Hollow on medium is taken again with the fog cloud's layer on (#174).
 */
const CASES: { fixture: string; viewer: Viewer; tiers: readonly Tier[]; cloud?: boolean }[] = [
	{ fixture: 'dungeon-40', viewer: 'player', tiers: TIERS },
	{ fixture: 'hollow', viewer: 'player', tiers: TIERS },
	{ fixture: 'village', viewer: 'player', tiers: ['medium'] },
	{ fixture: 'ref-8', viewer: 'spectator', tiers: ['medium'] },
	{ fixture: 'hollow', viewer: 'player', tiers: ['medium'], cloud: true }
];
const POSE: PoseName = 'overview';

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

interface Sample {
	cell: { x: number; y: number };
	/** Pixel, from the top left. */
	px: number;
	py: number;
}

/**
 * The unexplored cell centres a camera shows clearly: at least MARGIN cells from known ground
 * (knownGround), on screen with a 3x3 block inside the cell, and with nothing that could stand on
 * known ground (or off the table) between them and the camera.
 */
function samplesFor(
	grid: SquareGrid,
	ground: Uint8Array,
	camera: THREE.PerspectiveCamera
): Sample[] {
	const { width: w, height: h, cellSize } = grid;
	const known = (x: number, y: number) =>
		x < 0 || y < 0 || x >= w || y >= h || ground[y * w + x] === 1;
	const near = (x: number, y: number) => {
		for (let dy = -MARGIN + 1; dy < MARGIN; dy++)
			for (let dx = -MARGIN + 1; dx < MARGIN; dx++)
				if (ground[(y + dy) * w + (x + dx)] === 1) return true;
		return false;
	};
	const toPixel = (v: THREE.Vector3) => {
		v.project(camera);
		return { x: ((v.x + 1) / 2) * WIDTH, y: ((1 - v.y) / 2) * HEIGHT, z: v.z };
	};
	const out: Sample[] = [];
	for (let y = MARGIN - 1; y <= h - MARGIN; y++)
		for (let x = MARGIN - 1; x <= w - MARGIN; x++) {
			if (ground[y * w + x] || near(x, y)) continue;
			const at = gridToWorld(grid, { x, y });
			const p = toPixel(new THREE.Vector3(at.x, 0, at.z));
			if (p.z > 1 || p.x < 2 || p.y < 2 || p.x > WIDTH - 3 || p.y > HEIGHT - 3) continue;
			// The cell's half-width on screen, along both axes: a 3x3 block must fit.
			const ex = toPixel(new THREE.Vector3(at.x + cellSize / 2, 0, at.z));
			const ez = toPixel(new THREE.Vector3(at.x, 0, at.z + cellSize / 2));
			if (Math.min(Math.hypot(ex.x - p.x, ex.y - p.y), Math.hypot(ez.x - p.x, ez.y - p.y)) < 2.5)
				continue;
			if (!occluded(at, camera.position, cellSize, grid, known))
				out.push({ cell: { x, y }, px: Math.floor(p.x), py: Math.floor(p.y) });
		}
	return out;
}

/** Whether the ray from a floor point to the camera passes, below TALLEST, over known ground. */
function occluded(
	at: { x: number; z: number },
	eye: THREE.Vector3,
	cellSize: number,
	grid: SquareGrid,
	known: (x: number, y: number) => boolean
): boolean {
	const run = Math.hypot(eye.x - at.x, eye.z - at.z);
	const reach = Math.min(run, ((TALLEST * cellSize) / eye.y) * run);
	for (let s = 0; s <= reach; s += cellSize / 4) {
		const k = s / run;
		const x = at.x + (eye.x - at.x) * k;
		const z = at.z + (eye.z - at.z) * k;
		const cx = Math.floor(x / cellSize + grid.width / 2);
		const cy = Math.floor(z / cellSize + grid.height / 2);
		if (known(cx, cy)) return true;
	}
	return false;
}

/**
 * The finished frame's colour at a pixel (from the top left). WebGL2 reads the drawing buffer back;
 * WebGPU has no readback here, so it decodes a screenshot, as the goldens capture (seconds each).
 */
async function capture(m: Mounted): Promise<(x: number, y: number) => number[]> {
	if (BACKEND !== 'webgpu') {
		const px = m.pixels();
		// Indexed as WIDTH x HEIGHT: a tier's pixel cap shrinking the buffer would misread it.
		expect(px.length, 'drawing buffer size').toBe(WIDTH * HEIGHT * 4);
		return (x, y) => [
			...px.slice(((HEIGHT - 1 - y) * WIDTH + x) * 4, ((HEIGHT - 1 - y) * WIDTH + x) * 4 + 3)
		];
	}
	const png = await page.screenshot({ element: m.canvas, save: false });
	const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
	const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
	expect([bitmap.width, bitmap.height]).toEqual([WIDTH, HEIGHT]);
	const ctx = new OffscreenCanvas(WIDTH, HEIGHT).getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
	return (x, y) => [...data.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3)];
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
	while (stats().frames - start < frames && performance.now() < until) await wait(50);
	await settle(m.tabletop, 250, 1000);
	expect(stats().frames, 'frames drawn').toBeGreaterThan(0);
}

/** What the samples read that isn't exactly black, named by cell and pixel. */
function litAt(samples: Sample[], at: (x: number, y: number) => number[]): string[] {
	const lit: string[] = [];
	for (const { cell, px, py } of samples)
		for (let dy = -1; dy <= 1; dy++)
			for (let dx = -1; dx <= 1; dx++) {
				const rgb = at(px + dx, py + dy);
				if (rgb.some((c) => c !== 0))
					lit.push(`cell ${cell.x},${cell.y} at ${px + dx},${py + dy}: ${rgb}`);
			}
	return lit;
}

/**
 * The cells the viewer knows something stands on: explored ground, and the cells beside every wall
 * and door it was sent. The server sends a wall whole once any cell beside it was explored
 * (views.ts `touches`), so a long wall runs on through unexplored ground (village: the smithy's
 * south wall); that is the view's rule, not a layer lifting black, and this test holds the picture
 * to what the viewer was sent.
 */
function knownGround(view: FixtureView): Uint8Array {
	const known = decodeMask(view.fog.explored, view.grid.width * view.grid.height);
	for (const o of view.objects)
		for (const e of unitEdges(o.a, o.b))
			for (const c of cellsBeside(view.grid, e)) known[c.y * view.grid.width + c.x] = 1;
	return known;
}

describe(`unexplored cells on ${BACKEND}`, () => {
	for (const { fixture, viewer, tiers, cloud } of CASES)
		for (const tier of tiers)
			it(`${fixture} ${viewer} ${tier}${cloud ? ' with the cloud' : ''}: black at ${POSE}`, async () => {
				const sidecar = await loadSidecar(fixture);
				const view = await loadView(fixture, sidecar.ambient, viewer);
				expect(view.fog.enabled).toBe(true);
				const size = view.grid.width * view.grid.height;
				const known = knownGround(view);
				// Grain and dither on: motion not reduced, the clock held so they hold still.
				mounted = await mountFixture(view, sidecar.poses[POSE], {
					clock: manualClock(5000),
					reducedMotion: false,
					tier
				});
				const settings = settingsFor(tier, mounted.tabletop.capabilities().backend);
				expect(settings.grain && settings.layers.lens).toBe(true);
				if (cloud) {
					const layers = { ...settings.layers, fogcloud: true };
					mounted.tabletop.setQuality({ ...settings, miniature: false, layers });
				}
				await converge(mounted, settings.convergeFrames);
				const camera = cameraOf(mounted);
				const samples = samplesFor(view.grid, known, camera);
				expect(samples.length, `${fixture} ${POSE}: samples`).toBeGreaterThanOrEqual(MIN_SAMPLES);
				const at = await capture(mounted);
				const lit = litAt(samples, at);
				expect(lit.slice(0, 10), `${fixture} ${POSE}: ${lit.length} lit pixels`).toEqual([]);
				// The check can fail: taken as if nothing were explored, the same frame shows lit cells.
				const planted = litAt(samplesFor(view.grid, new Uint8Array(size), camera), at);
				expect(planted.length, 'lit pixels with nothing counted as explored').toBeGreaterThan(0);
			});
});
