// Test harness for the renderer (client-project tests only; no app code
// imports it). Mounts a fixture table as a given viewer sees it, with a clock
// the test holds, at DPR 1 on an 800x500 canvas, posed at one of the
// fixture's named poses, so the same inputs always draw the same pixels.
// Fixtures and views are JSON made by server/fixtures (see docs/PERFORMANCE.md).

import * as THREE from 'three/webgpu';
import { inject, it } from 'vitest';
import { page } from 'vitest/browser';
import { decodeFloor, FLOOR_IDS } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient, Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import type { Token } from '$lib/game/token';
import { decodeMask, type FogView } from '$lib/game/visibility';
import type { WorldLook } from '$lib/game/world';
import { loadEnvironment } from './environment';
import type { FogMode } from './fog';
import { groundFor } from './ground';
import { labelFontReady } from './label-font';
import { loadPaint } from './materials';
import { fixtureFor } from './light-model';
import { loadModel } from './models';
import { poseFor, type GridPose } from './poses';
import { settingsFor, toneMapperFrom, type Tier } from './quality';
import { createTabletop } from './renderer';
import { JOINT, type TileSet } from './floor-tiles-layer';
import type { Tabletop, TabletopEvents } from './types';
import type { WarmRenderer } from './lobby';

export type Band = 'day' | 'dusk' | 'dark';
export type Viewer = 'gm' | 'player' | 'spectator';
export type PoseName = 'overview' | 'close' | 'low' | 'dark';

export interface FixtureView {
	viewer: Viewer;
	band: Band;
	fogMode: FogMode;
	grid: SquareGrid;
	environment: string | null;
	world: WorldLook;
	ambient: Ambient;
	fog: FogView;
	terrain: string | null;
	darkness: string | null;
	interior?: string | null;
	floor: string | null;
	tokens: Token[];
	objects: SceneObject[];
	props: Prop[];
	lights: Light[];
}

export interface FixtureSidecar {
	ambient: Band;
	player: { tokenId: string };
	poses: Record<PoseName, GridPose>;
}

const views = import.meta.glob<Record<Viewer, FixtureView>>('/tests/fixtures/views/*.json', {
	import: 'default'
});
const sidecars = import.meta.glob<FixtureSidecar>('/tests/fixtures/scenes/*.poses.json', {
	import: 'default'
});

/** Every fixture's name. */
export const FIXTURES = Object.keys(sidecars)
	.map((p) => p.slice(p.lastIndexOf('/') + 1, -'.poses.json'.length))
	.sort();

export async function loadSidecar(fixture: string): Promise<FixtureSidecar> {
	const load = sidecars[`/tests/fixtures/scenes/${fixture}.poses.json`];
	if (!load) throw new Error(`No fixture ${fixture}`);
	return load();
}

export async function loadView(fixture: string, band: Band, viewer: Viewer): Promise<FixtureView> {
	const load = views[`/tests/fixtures/views/${fixture}.${band}.json`];
	if (!load) throw new Error(`No views for ${fixture} in ${band}`);
	return (await load())[viewer];
}

/** A clock that only moves when the test says so. */
export function manualClock(t = 1_000_000) {
	return {
		now: () => t,
		set(next: number) {
			t = next;
		}
	};
}

export interface Mounted {
	tabletop: Tabletop;
	canvas: HTMLCanvasElement;
	/** The drawn frame's pixels (RGBA, bottom row first). */
	pixels(): Uint8Array;
	/** Resolves once the renderer is gone, so the next test's starts clean. */
	unmount(): Promise<void>;
}

export const WIDTH = 800;
export const HEIGHT = 500;

/** Mounts a fixture view at a pose. Models and the environment are loaded first, so the first frame is final. */
/** Which of WebGPURenderer's backends a client test project draws with (vite.config.ts). */
declare module 'vitest' {
	export interface ProvidedContext {
		backend: 'webgl' | 'webgpu';
		/** Which golden images to take: the slim set CI takes, or every one (by hand). */
		goldens: 'slim' | 'full';
		/** `k/n`: this CI job's share of a sharded spec (`shardedIt`, and the goldens' and cases' own). */
		shard: string;
		/** Which unexplored-black cases to run: the slim set CI takes, or every one (by hand). */
		unexplored: 'slim' | 'full';
	}
}

/** The backend this project draws with ('webgl' outside a Vitest browser project). */
export const BACKEND = (() => {
	try {
		return inject('backend');
	} catch {
		return 'webgl' as const;
	}
})();

export async function mountFixture(
	view: FixtureView,
	pose: GridPose,
	options: {
		clock?: { now: () => number };
		reducedMotion?: boolean;
		events?: TabletopEvents;
		/** As under `?perf`: GPU timestamps recorded. */
		perf?: boolean;
		/** Miniature on in the tabletop view: depth of field at the pose (#165; motion not reduced). */
		miniature?: boolean;
		/** The quality tier, medium unless said (the high tier's TRAA golden, #163). */
		tier?: Tier;
		/** A renderer the lobby warmed up, adopted with its canvas (#180; no `pixels()` then). */
		warm?: WarmRenderer;
		/** The renderer's dev-only hook: the scene, and a redraw (sky-light.svelte.spec.ts). */
		devScene?: (scene: THREE.Scene, redraw: () => void) => void;
		/** WebGL2 in the WebGPU project too: on the real GPU (the probe bake's times, #235). */
		webgl?: boolean;
		/**
		 * The tier's hero shadow slots (#230), on unless a test of something else turns them off: they
		 * add a third to every lit shader, so to a table's compile under SwiftShader (tens of seconds
		 * on CI). Tests of the slots, their pixels and their programs keep them (hero-shadows,
		 * program-count, the goldens, ...).
		 */
		heroes?: boolean;
		/** Cells between baked probes (#235; `TabletopOptions.probeSpacing`). */
		probeSpacing?: number;
	} = {}
): Promise<Mounted> {
	await labelFontReady;
	const canvas = options.warm?.canvas ?? document.createElement('canvas');
	canvas.style.cssText = `display:block;width:${WIDTH}px;height:${HEIGHT}px`;
	document.body.appendChild(canvas);
	const webgpu = BACKEND === 'webgpu' && !options.webgl;
	const tabletop = await createTabletop(
		canvas,
		options.events ?? { onClick: () => {}, onHover: () => {} },
		{
			now: (options.clock ?? manualClock()).now,
			pixelRatio: 1,
			// Reading pixels back needs it, and it forces WebGL2; WebGPU tests read screenshots.
			preserveDrawingBuffer: !webgpu,
			backend: webgpu ? 'webgpu' : 'webgl',
			perf: options.perf,
			warm: options.warm,
			devScene: options.devScene,
			probeSpacing: options.probeSpacing,
			// Reduced motion unless the test says otherwise; `undefined` leaves it to the media query.
			reducedMotion: 'reducedMotion' in options ? options.reducedMotion : !options.miniature
		}
	);
	// Loaded once the table is there, whose renderer decodes the KTX2 files (models.ts), and
	// before it is set up, so no fixture's first frame races them. The paint maps too (#178).
	const models = new Set<string>([
		...view.tokens.flatMap((t) => (t.model ? [t.model] : [])),
		...view.props.map((p) => p.assetId),
		// The lights' fixtures (#232), which would otherwise arrive after the first warm-up and
		// hold another: the same table, one warm-up fewer.
		...view.lights.flatMap((l) =>
			(['wall', 'floor'] as const).flatMap((m) => fixtureFor(l, m) ?? [])
		)
	]);
	await Promise.all([...[...models].map((id) => loadModel(id)), loadPaint()]);
	// The page's `?tonemap=` (the look-metrics A/B runs), as the room page would.
	const toneMapper = toneMapperFrom(location.search) ?? undefined;
	if (view.environment) await loadEnvironment(view.environment, toneMapper);
	const backend = tabletop.capabilities().backend;
	// A WebGPU project that silently fell back to WebGL2 would test the wrong thing.
	if (webgpu && backend === 'webgl2') throw new Error('Asked for WebGPU, drawing with WebGL2');
	// One tier for every test unless it asks, whatever the device suggests (a software rasteriser
	// picks low).
	const miniature = !!options.miniature;
	// Depth of field needs motion not reduced; the power saver still keeps flames and mist still,
	// so the picture comes to rest (TRAA's jitter never would on an ambient table).
	if (miniature) tabletop.setPowerSaver(true);
	const settings = settingsFor(options.tier ?? 'medium', backend);
	if (options.heroes === false) settings.shadowedTorches = 0;
	tabletop.setQuality({ ...settings, toneMapper, miniature });
	const size = view.grid.width * view.grid.height;
	const levels = view.terrain ? decodeLevels(view.terrain, size) : null;
	// In the order the Tabletop component sets them.
	tabletop.setGrid(view.grid);
	tabletop.setTerrain(levels);
	tabletop.setFloor(view.floor ? decodeFloor(view.floor, size) : null);
	tabletop.setDarkness(view.darkness ? decodeMask(view.darkness, size) : null);
	tabletop.setInterior(view.interior ? decodeMask(view.interior, size) : null);
	tabletop.setEnvironment(view.environment);
	tabletop.setTokens(view.tokens);
	tabletop.setObjects(view.objects);
	tabletop.setFog(view.fog, view.fogMode);
	tabletop.setLighting(view.ambient, view.lights, view.world);
	tabletop.setProps(view.props);
	const at = poseFor(view.grid, groundFor(view.grid, levels), pose);
	// The tabletop view focuses by depth; the pose then ends the move to it.
	if (miniature) tabletop.setView('tabletop');
	tabletop.setPose(at);
	if (!webgpu) canvases.set(tabletop, canvas);
	return {
		tabletop,
		canvas,
		pixels() {
			if (webgpu) throw new Error('pixels() reads WebGL2 only: compare screenshots on WebGPU');
			const gl = canvas.getContext('webgl2')!;
			const out = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
			gl.readPixels(
				0,
				0,
				gl.drawingBufferWidth,
				gl.drawingBufferHeight,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				out
			);
			return out;
		},
		async unmount() {
			await tabletop.dispose();
			canvas.remove();
		}
	};
}

/**
 * `it` for the tests of this CI shard (`THIRDFOLD_SHARD=k/n`: every nth test of the file from the
 * kth) and `it.skip` for the others, so one spec runs in parallel jobs; one shard runs them all.
 * Made per file: `const test = shardedIt()`.
 */
export function shardedIt(): typeof it {
	const [k, n] = inject('shard').split('/').map(Number);
	let index = 0;
	const pick = () => (index++ % n === k - 1 ? it : it.skip);
	return new Proxy(it, {
		apply: (_, self, args) => Reflect.apply(pick(), self, args),
		get: (target, key) =>
			key === 'skipIf' ? (skip: boolean) => (skip ? it.skip : pick()) : Reflect.get(target, key)
	});
}

/** Each WebGL2 tabletop's canvas, for `settle` to wait on the GPU (mountFixture). */
const canvases = new WeakMap<Tabletop, HTMLCanvasElement>();

/**
 * Waits for the GPU to finish what was sent: a pixel read back. Under SwiftShader the GPU process
 * still compiles (JITs) a new table's pipelines and draws its frames for many seconds after the
 * frames stop (17 s for the test world's GM view on a fast machine); whatever touches the
 * context next, a read or the renderer's dispose, waits for all of it. Waiting here keeps that
 * time in the test that drew, not in the next step (an afterEach unmount timed out on it).
 */
export function finishGpu(tabletop: Tabletop): void {
	const canvas = canvases.get(tabletop);
	const gl = canvas?.isConnected ? canvas.getContext('webgl2') : null;
	if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
/** How far `settle` moves a held clock a frame while the table is drawing actively. */
const ADVANCE_MS = 500;
/** The most of one wait for a frame that counts toward `settle`'s limit, in ms. */
const STALL_MS = 2000;

/**
 * Waits until the tabletop has drawn and then stopped drawing for `quietMs`,
 * or `limitMs` has passed (a table with flickering flames never goes quiet).
 * Time-based, so slow machines (CI's software rendering) wait as long as fast ones. A second
 * of quiet by default: on a loaded machine something still loading (a model, a texture) can
 * land after a shorter spell and draw once more.
 */
export async function settle(
	tabletop: Tabletop,
	quietMs = 1000,
	limitMs = 20_000,
	/**
	 * The test's held clock, moved on while the scheduler is drawing actively, so what plays on the
	 * clock (a grade blending into a new band's, a glide) ends instead of holding the table busy
	 * until the limit. For tests of what a table comes to, not of the frames on the way.
	 */
	clock?: { now: () => number; set: (t: number) => void }
): Promise<void> {
	let last = -1;
	let [quietSince, before, spent] = [performance.now(), performance.now(), 0];
	// The limit counts at most STALL_MS a wait: one frame that stalls the page for half a minute
	// (a loaded machine compiling what a timed-out warm-up left) must not end it before the
	// frames after it, which compile the rest (the AO's real passes come on the second).
	// Nor does a warm-up's hold count: it ends once the compile under way does, which on a loaded
	// machine (render specs side by side on SwiftShader) can take longer than the whole limit, and a
	// settle that ended in it read the canvas before the table's first real frame.
	while (spent < limitMs) {
		await nextFrame();
		const now = performance.now();
		const { frames, holding, mode } = tabletop.stats();
		[spent, before] = [spent + (holding ? 0 : Math.min(now - before, STALL_MS)), now];
		// A warm-up holds frames for at least WARM_UP_LIMIT_MS: that isn't quiet. Nor is a scheduler
		// still drawing: one software frame can outlast the quiet spell (CI's small runners). Nor
		// a first view's load still out (the environment's look, the decoders): on a loaded machine
		// it lands after the frames went quiet and changes the picture (the floor's maps, #230).
		const drawing = mode === 'active' || mode === 'converge';
		if (clock && mode === 'active' && !holding) clock.set(clock.now() + ADVANCE_MS);
		const [loaded, loading] = tabletop.loads();
		if (frames !== last || frames === 0 || holding || drawing || loaded < loading) {
			last = frames;
			quietSince = performance.now();
		} else if (performance.now() - quietSince >= quietMs) return finishGpu(tabletop);
	}
	finishGpu(tabletop);
}

/** Waits `ms` of real time. */
export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The finished frame, RGB at (x, y) from the top left, read as the goldens capture it: the drawing
 * buffer on WebGL2 (`preserveDrawingBuffer`), a decoded screenshot of the canvas on WebGPU, which
 * has no readback of the canvas here (seconds each). The canvas must be in the page, at DPR 1.
 */
export async function readFrame(
	canvas: HTMLCanvasElement,
	width: number,
	height: number
): Promise<(x: number, y: number) => number[]> {
	if (BACKEND !== 'webgpu') {
		const gl = canvas.getContext('webgl2')!;
		// Indexed as width x height: a buffer of another size (a tier's pixel cap) would misread.
		const size = [gl.drawingBufferWidth, gl.drawingBufferHeight];
		if (size[0] !== width || size[1] !== height) throw new Error(`Drawing buffer ${size}`);
		const px = new Uint8Array(width * height * 4);
		gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
		const row = (y: number) => (height - 1 - y) * width;
		return (x, y) => [...px.slice((row(y) + x) * 4, (row(y) + x) * 4 + 3)];
	}
	const png = await page.screenshot({ element: canvas, save: false });
	const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
	const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
	if (bitmap.width !== width || bitmap.height !== height)
		throw new Error(`Screenshot ${bitmap.width}x${bitmap.height}`);
	const ctx = new OffscreenCanvas(width, height).getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const { data } = ctx.getImageData(0, 0, width, height);
	return (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
}

/**
 * A stand-in kit's floor tiles (#254), until #261's greybox kits: slabs with their tops at the
 * floor, in a few greys, for the default ground and the man-made floors (`useTileSet`).
 */
export function testTiles(): TileSet {
	const slab = (w: number, d: number, h: number, grey: number) => {
		const g = new THREE.BoxGeometry(w, h, d).translate(0, -h / 2, 0);
		const n = g.getAttribute('position').count;
		g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(grey), 3));
		return g;
	};
	const floor = (size: number, greys: number[]) => ({
		spec: {
			pitch: { x: size + JOINT, z: size + JOINT },
			tiles: greys.map(() => 1),
			broken: [1]
		},
		tiles: greys.map((g) => slab(size, size, 0.08, g)),
		broken: [slab(size * 0.8, size * 0.7, 0.06, 0.5)]
	});
	const id = (f: (typeof FLOOR_IDS)[number]) => FLOOR_IDS.indexOf(f);
	return new Map([
		[id('plain'), floor(0.6, [0.75, 0.7, 0.8])],
		[id('stone'), floor(0.6, [0.75, 0.7, 0.8])],
		[id('flagstone'), floor(0.72, [0.8, 0.72])],
		[id('cobble'), floor(0.3, [0.65, 0.6])],
		[id('tile'), floor(0.45, [0.85, 0.6])],
		[id('grating'), floor(0.5, [0.4])]
	]);
}
