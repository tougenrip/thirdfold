// Test harness for the renderer (client-project tests only; no app code
// imports it). Mounts a fixture table as a given viewer sees it, with a clock
// the test holds, at DPR 1 on an 800x500 canvas, posed at one of the
// fixture's named poses, so the same inputs always draw the same pixels.
// Fixtures and views are JSON made by server/fixtures (see docs/PERFORMANCE.md).

import { inject } from 'vitest';
import { page } from 'vitest/browser';
import { decodeFloor } from '$lib/game/floor';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient, Light } from '$lib/game/lights';
import type { SceneObject } from '$lib/game/objects';
import type { Prop } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import type { Token } from '$lib/game/token';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { loadEnvironment } from './environment';
import type { FogMode } from './fog';
import { groundFor } from './ground';
import { labelFontReady } from './label-font';
import { loadPaint } from './materials';
import { loadModel } from './models';
import { poseFor, type GridPose } from './poses';
import { settingsFor, toneMapperFrom, type Tier } from './quality';
import { createTabletop } from './renderer';
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
	ambient: Ambient;
	fog: FogView;
	terrain: string | null;
	darkness: string | null;
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
		/** `k/n`: take every nth fixture from the kth in fixtures.svelte.spec.ts (CI's parallel jobs). */
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
	} = {}
): Promise<Mounted> {
	await labelFontReady;
	const models = new Set<string>([
		...view.tokens.flatMap((t) => (t.model ? [t.model] : [])),
		...view.props.map((p) => p.assetId)
	]);
	// The paint maps too (#178), so no fixture's first frame races them.
	await Promise.all([...[...models].map((id) => loadModel(id)), loadPaint()]);
	// The page's `?tonemap=` (the look-metrics A/B runs), as the room page would.
	const toneMapper = toneMapperFrom(location.search) ?? undefined;
	if (view.environment) await loadEnvironment(view.environment, toneMapper);

	const canvas = options.warm?.canvas ?? document.createElement('canvas');
	canvas.style.cssText = `display:block;width:${WIDTH}px;height:${HEIGHT}px`;
	document.body.appendChild(canvas);
	const webgpu = BACKEND === 'webgpu';
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
			// Reduced motion unless the test says otherwise; `undefined` leaves it to the media query.
			reducedMotion: 'reducedMotion' in options ? options.reducedMotion : !options.miniature
		}
	);
	const backend = tabletop.capabilities().backend;
	// A WebGPU project that silently fell back to WebGL2 would test the wrong thing.
	if (webgpu && backend === 'webgl2') throw new Error('Asked for WebGPU, drawing with WebGL2');
	// One tier for every test unless it asks, whatever the device suggests (a software rasteriser
	// picks low).
	const miniature = !!options.miniature;
	// Depth of field needs motion not reduced; the power saver still keeps flames and mist still,
	// so the picture comes to rest (TRAA's jitter never would on an ambient table).
	if (miniature) tabletop.setPowerSaver(true);
	tabletop.setQuality({ ...settingsFor(options.tier ?? 'medium', backend), toneMapper, miniature });
	const size = view.grid.width * view.grid.height;
	const levels = view.terrain ? decodeLevels(view.terrain, size) : null;
	// In the order the Tabletop component sets them.
	tabletop.setGrid(view.grid);
	tabletop.setTerrain(levels);
	tabletop.setFloor(view.floor ? decodeFloor(view.floor, size) : null);
	tabletop.setDarkness(view.darkness ? decodeMask(view.darkness, size) : null);
	tabletop.setEnvironment(view.environment);
	tabletop.setTokens(view.tokens);
	tabletop.setObjects(view.objects);
	tabletop.setFog(view.fog, view.fogMode);
	tabletop.setLighting(view.ambient, view.lights);
	tabletop.setProps(view.props);
	const at = poseFor(view.grid, groundFor(view.grid, levels), pose);
	// The tabletop view focuses by depth; the pose then ends the move to it.
	if (miniature) tabletop.setView('tabletop');
	tabletop.setPose(at);
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

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Waits until the tabletop has drawn and then stopped drawing for `quietMs`,
 * or `limitMs` has passed (a table with flickering flames never goes quiet).
 * Time-based, so slow machines (CI's software rendering) wait as long as fast ones.
 */
export async function settle(tabletop: Tabletop, quietMs = 250, limitMs = 8000): Promise<void> {
	const start = performance.now();
	let last = -1;
	let quietSince = start;
	while (performance.now() - start < limitMs) {
		await nextFrame();
		const { frames, holding } = tabletop.stats();
		// A warm-up holds frames for up to WARM_UP_LIMIT_MS: that isn't quiet.
		if (frames !== last || frames === 0 || holding) {
			last = frames;
			quietSince = performance.now();
		} else if (performance.now() - quietSince >= quietMs) return;
	}
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
