// Renderer smoke tests (milestone 61): grid lines show and fade, a tabletop
// with no table carries no camera pose, and a disposed tabletop answers
// nothing. When frames are drawn (idle, ambient, converge) is
// scheduling.svelte.spec.ts; every fixture drawing for every viewer is
// fixtures.svelte.spec.ts; determinism, leaks and recompiles are
// stability.svelte.spec.ts. The ground beyond the grid (#220): never picked, running to the
// horizon with no gap under the sky, and the camera never below it.

import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { GRID_FADE_MS } from './overlay';
import { createTabletop } from './renderer';
import {
	BACKEND,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	readFrame,
	settle,
	wait,
	shardedIt,
	type Mounted,
	type Viewer,
	HEIGHT,
	WIDTH
} from './testing';
import type { Tier } from './quality';
import { GROUND_CLEARANCE } from './world-ground';

// Software frames on CI's small runners take seconds since the shader kinds (M64).
vi.setConfig({ testTimeout: 180_000, hookTimeout: 90_000 });
// Two CI shards (shardedIt): `THIRDFOLD_SHARD=k/2`.
const test = shardedIt();

let errors: ReturnType<typeof vi.spyOn>;
const mounted: Mounted[] = [];
beforeEach(() => {
	errors = vi.spyOn(console, 'error');
});
afterEach(async () => {
	for (const m of mounted.splice(0)) await m.unmount();
	expect(errors, 'console.error was called').not.toHaveBeenCalled();
	errors.mockRestore();
});

async function mount(fixture: string, viewer: Viewer, options: { reducedMotion?: boolean } = {}) {
	const sidecar = await loadSidecar(fixture);
	const view = await loadView(fixture, sidecar.ambient, viewer);
	const m = await mountFixture(view, sidecar.poses.overview, { heroes: false, ...options });
	mounted.push(m);
	await settle(m.tabletop);
	return m;
}

describe('the renderer', () => {
	test('draws no grid lines at rest, one draw call when shown, compiling nothing', async () => {
		const { tabletop } = await mount('village', 'gm');
		await settle(tabletop);
		const draw = async (shown: boolean) => {
			tabletop.setGridShown(shown);
			await settle(tabletop);
			await tabletop.benchmark(1);
			return tabletop.stats();
		};
		const rest = await draw(false);
		const shown = await draw(true);
		expect(shown.drawCalls).toBe(rest.drawCalls + 1);
		const again = await draw(false);
		expect(again.drawCalls).toBe(rest.drawCalls);
		expect(again.programs).toBe(shown.programs);
	});

	test('fades the grid lines in and out on the clock, drawing until they are gone', async () => {
		const clock = manualClock();
		const sidecar = await loadSidecar('ref-7');
		const view = await loadView('ref-7', 'day', 'gm');
		const m = await mountFixture(view, sidecar.poses.overview, {
			clock,
			reducedMotion: false,
			heroes: false
		});
		mounted.push(m);
		const t = m.tabletop;
		await settle(t);
		const drawAt = async (ms: number) => {
			clock.set(clock.now() + ms);
			await settle(t);
			await t.benchmark(1);
			return t.stats();
		};
		const rest = await drawAt(0);
		t.setGridShown(true);
		const shown = await drawAt(GRID_FADE_MS);
		expect(shown.drawCalls).toBe(rest.drawCalls + 1);
		// Halfway out the clock stands still: the lines are still drawn, and frames keep coming.
		t.setGridShown(false);
		clock.set(clock.now() + GRID_FADE_MS / 2);
		const frames = t.stats().frames;
		await wait(300);
		expect(t.stats().frames).toBeGreaterThan(frames);
		expect(t.stats().mode).toBe('active');
		await t.benchmark(1);
		expect(t.stats().drawCalls).toBe(rest.drawCalls + 1);
		// Faded out, they cost no draw call, the table goes quiet, and nothing was compiled.
		const gone = await drawAt(GRID_FADE_MS);
		expect(gone.drawCalls).toBe(rest.drawCalls);
		expect(gone.programs).toBe(shown.programs);
		const quiet = t.stats().frames;
		await wait(1000);
		expect(t.stats().frames).toBe(quiet);
	});

	test('has no camera pose to carry before it frames a table', async () => {
		const canvas = document.createElement('canvas');
		document.body.appendChild(canvas);
		const t = await createTabletop(
			canvas,
			{ onClick: () => {}, onHover: () => {} },
			{ backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl' }
		);
		expect(t.cameraPose()).toBeNull();
		await t.dispose();
		canvas.remove();
		const { tabletop } = await mount('ref-7', 'gm');
		expect(tabletop.cameraPose()).not.toBeNull();
	});

	test('disposes cleanly and stops answering the pointer', async () => {
		const sidecar = await loadSidecar('ref-1');
		const view = await loadView('ref-1', sidecar.ambient, 'gm');
		const events = { onClick: vi.fn(), onHover: vi.fn() };
		const m = await mountFixture(view, sidecar.poses.overview, { events, heroes: false });
		await settle(m.tabletop);
		expect(() => m.tabletop.dispose()).not.toThrow();
		const at = { clientX: 400, clientY: 250, bubbles: true };
		m.canvas.dispatchEvent(new PointerEvent('pointermove', at));
		m.canvas.dispatchEvent(new PointerEvent('pointerdown', at));
		m.canvas.dispatchEvent(new PointerEvent('pointerup', at));
		expect(events.onHover).not.toHaveBeenCalled();
		expect(events.onClick).not.toHaveBeenCalled();
		m.canvas.remove();
	});
});

describe('the ground to the horizon', () => {
	/** The village's grid and look at `time` with nothing on it: a clear view to the horizon. */
	async function bare(
		time: number,
		events?: { onClick: () => void; onHover: () => void },
		tier: Tier = 'medium'
	) {
		const view = await loadView('village', 'day', 'gm');
		const plain = { ...view, tokens: [], props: [], objects: [], lights: [], terrain: null };
		const sidecar = await loadSidecar('village');
		const m = await mountFixture(
			{ ...plain, world: { ...view.world, time } },
			sidecar.poses.overview,
			{ events, tier, heroes: false }
		);
		mounted.push(m);
		return m;
	}
	/** Standing 1.5 up over the middle of the grid, looking past its far edge `pitch` degrees down. */
	const outward = (pitch: number) => ({
		position: { x: 0, y: 1.5, z: 0 },
		target: { x: 0, y: 1.5 - 50 * Math.tan((pitch * Math.PI) / 180), z: -50 }
	});

	test('never picks the ground beyond the grid', async () => {
		const events = { onClick: vi.fn(), onHover: vi.fn() };
		const { tabletop, canvas } = await bare(720, events);
		// Looking out from beyond the grid's far edge: everything in view is off the grid.
		const depth = 28;
		tabletop.setPose({
			position: { x: 0, y: 4, z: -depth / 2 - 4 },
			target: { x: 0, y: 0, z: -depth / 2 - 30 }
		});
		await settle(tabletop);
		// Synthetic pointers can't be captured: the orbit controls would throw.
		canvas.setPointerCapture = canvas.releasePointerCapture = () => {};
		const rect = canvas.getBoundingClientRect();
		for (const [x, y] of [
			[0.5, 0.9],
			[0.2, 0.7],
			[0.8, 0.6]
		]) {
			const at = { clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height };
			canvas.dispatchEvent(new PointerEvent('pointerdown', { ...at, button: 0, bubbles: true }));
			canvas.dispatchEvent(new PointerEvent('pointerup', { ...at, button: 0, bubbles: true }));
		}
		expect(events.onClick).toHaveBeenCalledTimes(3);
		for (const [pick] of events.onClick.mock.calls)
			expect(pick).toMatchObject({ cell: null, tokenId: null, objectId: null, propId: null });
	});

	test('runs to the horizon at 85 degrees with no gap under the sky, day and dusk', async () => {
		// The low tier hides the dome: the sky is its horizon's colour, so ground shows as ground.
		for (const [time, tier] of [
			[720, 'medium'],
			[1170, 'medium'],
			[720, 'low']
		] as const) {
			const { tabletop, canvas } = await bare(time, undefined, tier);
			const pitch = 5; // the camera's full tilt: 85 degrees from straight down
			tabletop.setPose(outward(pitch));
			await settle(tabletop);
			const at = await readFrame(canvas, WIDTH, HEIGHT);
			// The horizon's row: `pitch` above the middle, at a 45 degree field of view.
			const horizon = Math.round(
				HEIGHT / 2 - (Math.tan((pitch * Math.PI) / 180) / Math.tan(Math.PI / 8)) * (HEIGHT / 2)
			);
			// From the sky above it, across the horizon, down to the ground near the grid's edge the
			// colour changes smoothly, so no band of anything else lies between ground and sky. At the
			// horizon itself the dome's haze is the fog's colour, so the fogged ground meets the sky with
			// no step (measured 2 on SwiftShader). On low, with range fog only (#225), the ground comes
			// out of the flat sky over fewer rows: a steeper fade, still no band (steeper again since
			// #377 darkened the ring: a pale sky down to darker land over the same rows).
			const column = (x: number) => {
				const rows: number[][] = [];
				for (let y = horizon - 30; y < horizon + 40; y++) rows.push(at(x, y));
				return rows;
			};
			for (const x of [100, 400, 700]) {
				const rows = column(x);
				for (let i = 1; i < rows.length; i++) {
					const jump = Math.max(...rows[i].map((c, k) => Math.abs(c - rows[i - 1][k])));
					const seam = i >= 28 && i <= 36; // horizon - 2 to horizon + 6
					const limit = seam ? 8 : tier === 'low' ? 40 : 20;
					expect(jump, `${time} ${tier} at ${x}, row ${i}`).toBeLessThan(limit);
				}
				// Never the old void's near-black.
				for (const px of rows) expect(Math.max(...px), `${time} at ${x}`).toBeGreaterThan(30);
			}
			// The ground near the grid is ground, not sky: it differs from the sky above the horizon.
			const sky = at(400, horizon - 30);
			const near = at(400, horizon + 40);
			expect(
				Math.max(...sky.map((c, k) => Math.abs(c - near[k]))),
				`${time} ${tier}`
			).toBeGreaterThan(8);
			await mounted.pop()!.unmount();
		}
	});

	test('keeps the camera above the ground', async () => {
		const { tabletop } = await bare(720);
		tabletop.setPose({ position: { x: 0, y: 0.05, z: 3 }, target: { x: 0, y: 0, z: 0 } });
		await settle(tabletop);
		expect(tabletop.cameraPose()!.position.y).toBeGreaterThanOrEqual(GROUND_CLEARANCE - 1e-6);
	});
});
