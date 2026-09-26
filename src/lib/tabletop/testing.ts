// Test harness for the renderer (client-project tests only; no app code
// imports it). Mounts a fixture table as a given viewer sees it, with a clock
// the test holds, at DPR 1 on an 800x500 canvas, posed at one of the
// fixture's named poses, so the same inputs always draw the same pixels.
// Fixtures and views are JSON made by server/fixtures (see docs/PERFORMANCE.md).

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
import { loadModel } from './models';
import { poseFor, type GridPose } from './poses';
import { createTabletop, type Tabletop, type TabletopEvents } from './renderer';

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
	unmount(): void;
}

export const WIDTH = 800;
export const HEIGHT = 500;

/** Mounts a fixture view at a pose. Models and the environment are loaded first, so the first frame is final. */
export async function mountFixture(
	view: FixtureView,
	pose: GridPose,
	options: {
		clock?: { now: () => number };
		reducedMotion?: boolean;
		events?: TabletopEvents;
	} = {}
): Promise<Mounted> {
	await labelFontReady;
	const models = new Set<string>([
		...view.tokens.flatMap((t) => (t.model ? [t.model] : [])),
		...view.props.map((p) => p.assetId)
	]);
	await Promise.all([...models].map((id) => loadModel(id)));
	if (view.environment) await loadEnvironment(view.environment);

	const canvas = document.createElement('canvas');
	canvas.style.cssText = `display:block;width:${WIDTH}px;height:${HEIGHT}px`;
	document.body.appendChild(canvas);
	const tabletop = createTabletop(
		canvas,
		options.events ?? { onClick: () => {}, onHover: () => {} },
		{
			now: (options.clock ?? manualClock()).now,
			pixelRatio: 1,
			preserveDrawingBuffer: true,
			// Reduced motion unless the test says otherwise; `undefined` leaves it to the media query.
			reducedMotion: 'reducedMotion' in options ? options.reducedMotion : true
		}
	);
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
	tabletop.setPose(poseFor(view.grid, groundFor(view.grid, levels), pose));
	return {
		tabletop,
		canvas,
		pixels() {
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
		unmount() {
			tabletop.dispose();
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
		const frames = tabletop.stats().frames;
		if (frames !== last || frames === 0) {
			last = frames;
			quietSince = performance.now();
		} else if (performance.now() - quietSince >= quietMs) return;
	}
}

/** Waits `ms` of real time. */
export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
