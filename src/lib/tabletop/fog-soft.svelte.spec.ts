// Reveal fades and the fog cloud on the clock (#174), on the test world as a player, on the low
// tier (no converge frames): a block of hidden cells revealed at once fades in over FADE_MS of the
// held clock, black at its start, part way at its middle, full at its end, and then no frame is
// drawn; under reduced motion the reveal is whole on its first frame and the cloud, turned on,
// draws no ambient frames. The power saver keeps the test world's flames still, so the table
// comes to rest with motion not reduced.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld, type GridPos } from '$lib/game/grid';
import { decodeMask, encodeMask, type FogView } from '$lib/game/visibility';
import { FADE_MS } from './fog-soft';
import { settingsFor } from './quality';
import {
	HEIGHT,
	WIDTH,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	wait,
	type FixtureView,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 120_000 });

const FIXTURE = 'test-world';
/** A block of cells the player has never seen, all revealed at once (x, y from its corner). */
const BLOCK = { x: 4, y: 13, size: 6 };
/** A cell in the block's middle, whose whole neighbourhood is revealed with it. */
const PROBE: GridPos = { x: 6, y: 15 };
/** How long a table at rest must draw nothing, in ms. */
const IDLE_MS = 2000;

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

/** The view's fog with the block visible (and so explored). */
function revealed(view: FixtureView): FogView {
	const n = view.grid.width * view.grid.height;
	const [visible, explored] = [view.fog.visible, view.fog.explored].map((m) => decodeMask(m, n));
	for (let y = BLOCK.y; y < BLOCK.y + BLOCK.size; y++)
		for (let x = BLOCK.x; x < BLOCK.x + BLOCK.size; x++)
			visible[y * view.grid.width + x] = explored[y * view.grid.width + x] = 1;
	return { ...view.fog, visible: encodeMask(visible), explored: encodeMask(explored) };
}

/** The probe cell's centre pixel's brightness (r + g + b) in the drawn frame. */
function probe(m: Mounted, view: FixtureView): number {
	const pose = m.tabletop.cameraPose()!;
	const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 1000);
	camera.position.set(pose.position.x, pose.position.y, pose.position.z);
	camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
	camera.updateMatrixWorld();
	const at = gridToWorld(view.grid, PROBE);
	const p = new THREE.Vector3(at.x, 0, at.z).project(camera);
	const [x, y] = [Math.floor(((p.x + 1) / 2) * WIDTH), Math.floor(((1 - p.y) / 2) * HEIGHT)];
	const px = m.pixels();
	const i = ((HEIGHT - 1 - y) * WIDTH + x) * 4;
	return px[i] + px[i + 1] + px[i + 2];
}

/** Waits for a frame drawn after now. */
async function nextDrawn(m: Mounted): Promise<void> {
	const from = m.tabletop.stats().frames;
	const until = performance.now() + 20_000;
	while (performance.now() < until) {
		await new Promise(requestAnimationFrame);
		const { frames, holding } = m.tabletop.stats();
		if (!holding && frames > from) return;
	}
	throw new Error('no frame drawn');
}

/** Whether nothing was drawn for IDLE_MS. */
async function idle(m: Mounted): Promise<number> {
	await settle(m.tabletop, 250, 10_000);
	const from = m.tabletop.stats().frames;
	await wait(IDLE_MS);
	return m.tabletop.stats().frames - from;
}

async function mount(reducedMotion: boolean) {
	const sidecar = await loadSidecar(FIXTURE);
	const view = await loadView(FIXTURE, sidecar.ambient, 'player');
	expect(view.fog.enabled).toBe(true);
	const clock = manualClock();
	const m = await mountFixture(view, sidecar.poses.overview, { clock, reducedMotion, tier: 'low' });
	mounted = m;
	m.tabletop.setPowerSaver(true);
	await settle(m.tabletop, 250, 20_000);
	return { m, view, clock };
}

describe('reveal fades', () => {
	it('fade a reveal in over FADE_MS on the clock, then draw nothing', async () => {
		const { m, view, clock } = await mount(false);
		expect(probe(m, view), 'hidden before').toBe(0);
		const start = clock.now();
		m.tabletop.setFog(revealed(view), 'player');
		await nextDrawn(m);
		const first = probe(m, view);
		clock.set(start + FADE_MS / 2);
		await nextDrawn(m);
		const middle = probe(m, view);
		clock.set(start + FADE_MS);
		await nextDrawn(m);
		const end = probe(m, view);
		expect({ first, middle: middle > first + 10, end: end > middle + 10 }).toEqual({
			first: 0,
			middle: true,
			end: true
		});
		expect(await idle(m), 'frames after the fade ended').toBe(0);
		expect(probe(m, view)).toBe(end);
	});

	it('are instant under reduced motion, and the cloud draws no ambient frames', async () => {
		const { m, view } = await mount(true);
		m.tabletop.setFog(revealed(view), 'player');
		await nextDrawn(m);
		const first = probe(m, view);
		expect(first, 'revealed on the first frame').toBeGreaterThan(10);
		expect(await idle(m)).toBe(0);
		expect(probe(m, view)).toBe(first);
		// The cloud, turned on, is held still.
		m.tabletop.setPowerSaver(false);
		const settings = settingsFor('low', m.tabletop.capabilities().backend);
		m.tabletop.setQuality({ ...settings, layers: { ...settings.layers, fogcloud: true } });
		await nextDrawn(m);
		expect(await idle(m), 'ambient frames with the cloud on').toBe(0);
		expect(m.tabletop.stats().mode).toBe('idle');
	});
});
