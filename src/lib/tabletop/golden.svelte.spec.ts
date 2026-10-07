// Golden images of the renderer (milestone 61, baseline v0; per tier since
// #168): every fixture table at its named poses, in each ambient band, for the
// GM, a fogged player and a spectator, on the medium tier, and a smaller set on
// low and high (TRAA converged, GTAO), drawn with SwiftShader at DPR 1 on an
// 800x500 canvas with a frozen clock and reduced motion; the close and low
// poses draw with depth of field, focused on the pose's pivot. Captures with
// TRAA, GTAO or depth of field compare by SSIM (tests/visual/ssim.ts), the rest
// by pixelmatch. The mini look-dev pair (#278: ref-7 on grass, ref-1 in torchlight) is taken close
// and overhead for every viewer and tier, and its close GM frames again as each dichromacy sees
// them (cvd.ts), for review; ring-colour-vision.svelte.spec.ts measures the rings. Unexplored cells are checked black per tier by
// unexplored-black.svelte.spec.ts. Only Linux references are committed.
//
// They never run with the other tests. CI takes the slim set (`SLIM`, a few
// minutes) on pull requests that touch rendering, and only there; the full set
// runs by hand before a rendering PR is opened. To run or update them on
// purpose (and show before and after in the PR, see docs/RENDERING.md):
//   npm run test:golden              # the slim set, as CI
//   npm run test:golden:full         # every image; add -- --update to re-record
//   npm run test:golden:webgpu       # every image on the local GPU

import { page, server } from 'vitest/browser';
import { afterEach, describe, expect, inject, it, vi } from 'vitest';
import {
	BACKEND,
	HEIGHT,
	WIDTH,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	type Band,
	type Mounted,
	type PoseName,
	type Viewer
} from './testing';
import type { Tier } from './quality';
import { simulatePixels, type Deficiency } from './cvd';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });

const STORY = ['village', 'monastery', 'hollow', 'heart', 'railcar', 'ghost-town'];
const COMPOSED = ['ref-1', 'ref-3', 'ref-6', 'ref-7', 'ref-8'];
const STRESS = ['dungeon-40', 'outdoor-64', 'crowd-60'];
const BANDS: Band[] = ['day', 'dusk', 'dark'];

interface Shot {
	fixture: string;
	pose: PoseName;
	band: Band | 'own';
	viewer: Viewer;
	/** Medium unless said. */
	tier?: Tier;
	/** The hour in minutes, over the band's view's own (#208: the presets blend between bands). */
	time?: number;
	/** Also the frame as each dichromacy sees it (#278), for human review of the minis' rings. */
	cvd?: boolean;
}

/** The mini look-dev pair (#278): ref-7's minis on grass at noon and ref-1's torch room. */
const MINIS = ['ref-7', 'ref-1'];
const DEFICIENCIES: Deficiency[] = ['protanopia', 'deuteranopia', 'tritanopia'];

/** Which images are taken: see the table in #132. */
export const MATRIX: Shot[] = [
	...[...STORY, ...COMPOSED].flatMap((fixture): Shot[] => [
		{ fixture, pose: 'overview', band: 'own', viewer: 'gm' },
		{ fixture, pose: 'overview', band: 'own', viewer: 'player' },
		{ fixture, pose: 'overview', band: 'own', viewer: 'spectator' },
		...BANDS.map((band): Shot => ({ fixture, pose: 'overview', band, viewer: 'gm' })),
		{ fixture, pose: 'close', band: 'own', viewer: 'gm', cvd: MINIS.includes(fixture) },
		{ fixture, pose: 'close', band: 'own', viewer: 'player' },
		{ fixture, pose: 'low', band: 'own', viewer: 'gm' },
		{ fixture, pose: 'dark', band: 'dark', viewer: 'gm' },
		{ fixture, pose: 'dark', band: 'dark', viewer: 'player' }
	]),
	...STRESS.map((fixture): Shot => ({ fixture, pose: 'overview', band: 'own', viewer: 'gm' })),
	// Low and high (#168): the compositions for the GM and a player, close up, and a spectator
	// and the dark Hollow, where the tiers differ most. High on SwiftShader takes seconds a shot.
	...(['low', 'high'] as const).flatMap((tier): Shot[] => [
		...COMPOSED.flatMap((fixture): Shot[] => [
			{ fixture, pose: 'overview', band: 'own', viewer: 'gm', tier },
			{ fixture, pose: 'overview', band: 'own', viewer: 'player', tier },
			{ fixture, pose: 'close', band: 'own', viewer: 'gm', tier }
		]),
		{ fixture: 'village', pose: 'overview', band: 'own', viewer: 'spectator', tier },
		{ fixture: 'hollow', pose: 'overview', band: 'own', viewer: 'player', tier }
	]),
	// #278: the minis close up with depth of field and from overhead, for every viewer on every
	// tier (the rest of the three views per tier are above), and their close GM frames as each
	// dichromacy sees them.
	...MINIS.flatMap((fixture): Shot[] => [
		{ fixture, pose: 'close', band: 'own', viewer: 'spectator' },
		...(['low', 'high'] as const).flatMap((tier): Shot[] => [
			{ fixture, pose: 'close', band: 'own', viewer: 'player', tier },
			{ fixture, pose: 'close', band: 'own', viewer: 'spectator', tier },
			{ fixture, pose: 'overview', band: 'own', viewer: 'spectator', tier }
		])
	]),
	// #208: between the canonical hours, 06:30 a quarter day and 20:30 mostly dusk (both dusk by the rules).
	...[390, 1230].map((time): Shot => ({
		fixture: 'ref-8',
		pose: 'overview',
		band: 'dusk',
		viewer: 'gm',
		time
	})),
	// #225: dawn on the village (its noon, dusk and night are the band overviews: 12:00, 19:30,
	// 23:00), and the enclosed Hollow and Heart at noon, which must match their midnight (#221).
	{ fixture: 'village', pose: 'overview', band: 'dusk', viewer: 'gm', time: 360 },
	...['hollow', 'heart'].map((fixture): Shot => ({
		fixture,
		pose: 'overview',
		band: 'own',
		viewer: 'gm',
		time: 720
	}))
];

/** 390 → "0630". */
const hhmm = (time: number) =>
	`${Math.floor(time / 60)}`.padStart(2, '0') + `${time % 60}`.padStart(2, '0');

/**
 * The images CI takes (#168's follow-up: a verify run stays within minutes): every table's
 * overview for the GM, the fog's secrecy for players and a spectator, night and dusk, depth of
 * field close and low, a stress table, and a few on low and high. Names as the tests are.
 */
const SLIM = new Set([
	...[...STORY, ...COMPOSED].map((f) => `${f} overview own gm`),
	'village overview own player',
	'hollow overview own player',
	'ref-8 overview own player',
	'ref-8 overview own spectator',
	'village dark dark player',
	'village overview dark gm',
	'village overview dusk gm 0600',
	'ref-1 close own gm',
	'ref-7 close own gm',
	'ref-1 close own spectator',
	'village low own gm',
	'crowd-60 overview own gm',
	'ref-1 overview own gm low',
	'ref-8 overview own player low',
	'ref-1 close own gm high',
	'village overview own spectator high',
	'hollow overview own player high'
]);
const FULL = inject('goldens') === 'full';
/** `THIRDFOLD_SHARD=k/n`: every nth image from the kth, so CI takes the set in parallel jobs. */
const [k, n] = inject('shard').split('/').map(Number);
let taken = 0;

/** Depth of field at the close and low poses, as a shot or Miniature draws them there. */
const FOCUSED: readonly PoseName[] = ['close', 'low'];

/**
 * The drawn frame as a dichromat sees it (cvd.ts, Machado 2009), on a 2D canvas in the page to
 * capture: read as the goldens capture the WebGL2 canvas, or from its screenshot on WebGPU.
 */
async function simulated(canvas: HTMLCanvasElement, kind: Deficiency): Promise<HTMLCanvasElement> {
	const pixel = await readFrame(canvas, WIDTH, HEIGHT);
	const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++) rgba.set([...pixel(x, y), 255], (y * WIDTH + x) * 4);
	const out = document.createElement('canvas');
	[out.width, out.height] = [WIDTH, HEIGHT];
	out.style.cssText = `display:block;width:${WIDTH}px;height:${HEIGHT}px`;
	out.getContext('2d')!.putImageData(new ImageData(simulatePixels(rgba, kind), WIDTH), 0, 0);
	document.body.appendChild(out);
	simulations.push(out);
	return out;
}
const simulations: HTMLCanvasElement[] = [];

const linux = server.platform === 'linux';
if (import.meta.env.CI && !linux) throw new Error('Golden images are checked on Linux in CI.');

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	for (const c of simulations.splice(0)) c.remove();
});

describe.skipIf(!linux)('golden images', () => {
	const seen = new Set<string>();
	for (const shot of MATRIX) {
		const tier = shot.tier ?? 'medium';
		const at = shot.time === undefined ? '' : ` ${hhmm(shot.time)}`;
		const base = `${shot.fixture} ${shot.pose} ${shot.band} ${shot.viewer}${at}`;
		const label = tier === 'medium' ? base : `${base} ${tier}`;
		if (!FULL && !SLIM.has(label)) continue;
		if (taken++ % n !== k - 1) continue;
		it(label, async () => {
			const sidecar = await loadSidecar(shot.fixture);
			const band = shot.band === 'own' ? sidecar.ambient : shot.band;
			// Each backend keeps its own references: the rasterisers differ at edges.
			const suffix =
				(tier === 'medium' ? '' : `-${tier}`) + (BACKEND === 'webgpu' ? '-webgpu' : '');
			const at = shot.time === undefined ? '' : `-${hhmm(shot.time)}`;
			const name = `${shot.fixture}-${shot.pose}-${band}${at}-${shot.viewer}${suffix}`;
			// "own" can repeat an explicit band: take each image once.
			if (seen.has(name)) return expect(true).toBe(true);
			seen.add(name);
			const own = await loadView(shot.fixture, band, shot.viewer);
			const view =
				shot.time === undefined ? own : { ...own, world: { ...own.world, time: shot.time } };
			const focused = FOCUSED.includes(shot.pose);
			mounted = await mountFixture(view, sidecar.poses[shot.pose], {
				clock: manualClock(5000),
				tier,
				miniature: focused
			});
			await settle(mounted.tabletop);
			// TRAA's jitter, GTAO's rotations and the bokeh vary a little between runs and drivers.
			const structural = tier === 'high' || focused;
			const options = structural
				? { comparatorName: 'ssim' as const, comparatorOptions: { minScore: 0.98 } }
				: {};
			await expect.element(page.elementLocator(mounted.canvas)).toMatchScreenshot(name, options);
			// The full set only: a few hundred ms each, from the frame already drawn.
			if (FULL && shot.cvd)
				for (const kind of DEFICIENCIES)
					await expect
						.element(page.elementLocator(await simulated(mounted.canvas, kind)))
						.toMatchScreenshot(`${name}-${kind}`, options);
		});
	}
});

// #163: a still on the high tier, drawn after TRAA's converge frames under the held clock (the
// Halton jitter and GTAO's rotations follow the frame count, so the still is the same each run).
describe.skipIf(!linux || !FULL)('golden images, TRAA converged', () => {
	it('ref-1 close high converged gm', async () => {
		const sidecar = await loadSidecar('ref-1');
		const view = await loadView('ref-1', sidecar.ambient, 'gm');
		mounted = await mountFixture(view, sidecar.poses.close, {
			clock: manualClock(5000),
			tier: 'high'
		});
		await settle(mounted.tabletop);
		const stats = mounted.tabletop.stats();
		// Converged and stopped: nothing more is drawn.
		expect([stats.tier, stats.mode]).toEqual(['high', 'idle']);
		expect(stats.frames).toBeGreaterThanOrEqual(24);
		const suffix = BACKEND === 'webgpu' ? '-webgpu' : '';
		await expect
			.element(page.elementLocator(mounted.canvas))
			.toMatchScreenshot(`ref-1-close-high-converged-gm${suffix}`);
	});
});
