// Hero shadows on the picture (#230): a torch near the camera's focus holds a slot and its mini
// casts a shadow on the floor away from it, while a cell with nothing between it and the torch
// reads the same with or without the slot (within 2%); the cube redraws only when something in
// the light's reach changes, never for the camera alone. Drawn with SwiftShader's WebGL2; the
// program count across slot handovers is program-count.svelte.spec.ts's.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import type { Light } from '$lib/game/lights';
import type { Token } from '$lib/game/token';
import { encodeMask } from '$lib/game/visibility';
import { HeroLight } from './materials/hero-light-node';
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

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 14, height: 10 };
const torch: Light = { id: 'brazier', pos: { x: 5, y: 5 }, radius: 5, color: '#ffb060', on: true };
const mini = (pos: GridPos): Token => ({
	id: 'mini',
	name: 'Mini',
	color: '#8090a0',
	pos,
	ownerId: null,
	vision: 0,
	light: 0
});
const above: GridPose = { target: { x: 6, y: 5 }, distance: 12, azimuth: 0, elevation: 80 };

async function table(): Promise<FixtureView> {
	const base = await loadView('dungeon-40', 'dark', 'gm');
	const all = encodeMask(new Uint8Array(grid.width * grid.height).fill(1));
	return {
		...base,
		grid,
		terrain: null,
		darkness: null,
		interior: null,
		floor: null,
		fog: { enabled: false, visible: all, explored: all, shared: false },
		tokens: [mini({ x: 6, y: 5 })],
		props: [],
		objects: [],
		lights: [torch]
	};
}

/** Mounts a view at `pose` on medium with `slots` hero slots, nothing spreading light. */
async function mount(view: FixtureView, pose: GridPose, slots: 0 | 2 = 2) {
	let scene: THREE.Scene | null = null;
	const devScene = (s: THREE.Scene) => (scene = s);
	const m = await mountFixture(view, pose, { clock: manualClock(), devScene });
	mounted = m;
	const settings = settingsFor('medium', m.tabletop.capabilities().backend);
	const quiet = { bloom: false, aberration: false, grain: false, vignette: false };
	m.tabletop.setQuality({ ...settings, ...quiet, miniature: false, shadowedTorches: slots });
	m.tabletop.setFog(null, 'gm');
	const heroes = () => {
		const out: HeroLight[] = [];
		(scene as THREE.Scene | null)?.traverse((o) => o instanceof HeroLight && out.push(o));
		return out;
	};
	const frame = async () => {
		await settle(m.tabletop, 500, 60_000);
		return readFrame(m.canvas, WIDTH, HEIGHT);
	};
	return { m, heroes, frame };
}

/** A cell centre's pixel on the floor, from the camera the tabletop draws with. */
function pixelAt(m: Mounted, cell: GridPos) {
	const pose = m.tabletop.cameraPose()!;
	const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
	camera.position.set(pose.position.x, pose.position.y, pose.position.z);
	camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
	camera.updateMatrixWorld();
	const w = gridToWorld(grid, cell);
	const v = new THREE.Vector3(w.x, 0, w.z).project(camera);
	return [Math.floor(((v.x + 1) / 2) * WIDTH), Math.floor(((1 - v.y) / 2) * HEIGHT)] as const;
}

const luma = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Close enough: within 2% of `b`, or a level of 8-bit luma. */
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.02 * b);

describe('hero shadows', () => {
	it('give a brazier near the focus a slot and its mini a shadow, no brighter elsewhere', async () => {
		const view = await table();
		const cells = {
			behind: { x: 8, y: 5 }, // past the mini, away from the brazier
			open: [
				{ x: 5, y: 3 },
				{ x: 3, y: 5 },
				{ x: 5, y: 7 },
				{ x: 4, y: 4 }
			]
		};
		const measure = async (slots: 0 | 2) => {
			const { m, heroes, frame } = await mount(view, above, slots);
			const read = await frame();
			const at = (c: GridPos) => luma(read(...pixelAt(m, c)));
			const out = {
				behind: at(cells.behind),
				open: cells.open.map(at),
				heroes: heroes().length,
				owners: m.tabletop.stats().heroes?.owners ?? []
			};
			await m.unmount();
			mounted = null;
			return out;
		};
		const shadowed = await measure(2);
		const plain = await measure(0);
		expect(shadowed.heroes).toBe(2);
		expect(shadowed.owners).toContain('brazier');
		expect(plain.heroes).toBe(0);
		expect(plain.behind).toBeGreaterThan(5);
		expect(shadowed.behind, 'the floor behind the mini').toBeLessThan(plain.behind / 2);
		// A light gets no brighter for its slot: where nothing stands between it and the floor.
		const off = shadowed.open.filter((v, i) => !near(v, plain.open[i]));
		expect(off, `open cells ${shadowed.open} against ${plain.open}`).toEqual([]);
	});

	it('redraw a cube only for a change in its reach, never for the camera', async () => {
		// The brazier by the mini, and a lamp in the far corner with nothing near it.
		const lamp: Light = { id: 'lamp', pos: { x: 11, y: 2 }, radius: 2, color: '#ffd090', on: true };
		const view = { ...(await table()), lights: [torch, lamp] };
		const focus: GridPose = { target: { x: 8, y: 4 }, distance: 14, azimuth: 0, elevation: 70 };
		const { m, frame } = await mount(view, focus);
		await frame();
		const stats = () => m.tabletop.stats().heroes!;
		const { owners } = stats();
		expect([...owners].sort()).toEqual(['brazier', 'lamp']);
		const [a, b] = [owners.indexOf('brazier'), owners.indexOf('lamp')];
		const before = stats().redraws;
		// The camera turns and moves a little: no cube redraws.
		m.tabletop.setGridPose({ ...focus, azimuth: 20, distance: 12 });
		await frame();
		m.tabletop.setGridPose({ ...focus, target: { x: 8.2, y: 4.1 } });
		await frame();
		expect(stats().redraws, 'cubes redrawn for the camera').toEqual(before);
		expect(stats().owners).toEqual(owners);
		// The mini steps within the brazier's reach: its cube alone redraws.
		m.tabletop.setTokens([mini({ x: 6, y: 6 })]);
		await frame();
		const after = stats().redraws;
		expect(after[a], "the brazier's cube").toBeGreaterThan(before[a]);
		expect(after[b], "the lamp's cube").toBe(before[b]);
		expect(stats().lastRedraws).toBeLessThanOrEqual(1); // medium's budget a frame
	});

	it('make no slot on the low tier', async () => {
		let scene: THREE.Scene | null = null;
		const m = await mountFixture(await table(), above, {
			tier: 'low',
			devScene: (s: THREE.Scene) => (scene = s)
		});
		mounted = m;
		await settle(m.tabletop, 500, 60_000);
		const found: HeroLight[] = [];
		(scene as THREE.Scene | null)?.traverse((o) => o instanceof HeroLight && found.push(o));
		expect(found).toEqual([]);
		expect(m.tabletop.stats().heroes?.cubeBytes).toBe(0);
	});
});
