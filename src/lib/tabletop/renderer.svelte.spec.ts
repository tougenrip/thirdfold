import type { WorldLook } from '$lib/game/world';
// Renderer smoke tests (milestone 61): the grid's modes draw and idle (#245), a tabletop
// with no table carries no camera pose, and a disposed tabletop answers
// nothing. When frames are drawn (idle, ambient, converge) is
// scheduling.svelte.spec.ts; every fixture drawing for every viewer is
// fixtures.svelte.spec.ts; determinism, leaks and recompiles are
// stability.svelte.spec.ts. The ground beyond the grid (#220): never picked, running to the
// horizon with no gap under the sky, and the camera never below it. Cells picked by the DDA
// (#246) on the monastery's gallery, and only the pick layer raycast.

import * as THREE from 'three/webgpu';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { DiceLayer } from './dice3d';
import { buildDieModel } from './dice-geometry';
import { WALL_HEIGHT } from './ground';
import type { GridMode } from './grid-modes';
import { PreviewLayer, type Bucket } from './previews';
import { PICK_LAYER } from './picking';
import { createTabletop } from './renderer';
import {
	BACKEND,
	loadSidecar,
	loadView,
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
	test('draws no grid when off, a draw per chunk top in every other mode, compiling nothing', async () => {
		const { tabletop } = await mount('village', 'gm');
		const draw = async (mode: GridMode) => {
			tabletop.setGridMode(mode, [{ x: 4, y: 4 }]);
			await settle(tabletop);
			await tabletop.benchmark(1);
			return tabletop.stats();
		};
		const rest = await draw('off');
		const shown = await draw('build');
		// The shader grid (#245): one twin per chunk with tops, however the mode weighs the lines.
		expect(shown.drawCalls).toBeGreaterThan(rest.drawCalls);
		expect(shown.drawCalls - rest.drawCalls).toBeLessThanOrEqual(shown.world!.chunks);
		for (const mode of ['explore', 'overview'] as const)
			expect((await draw(mode)).drawCalls).toBe(shown.drawCalls);
		const again = await draw('off');
		expect(again.drawCalls).toBe(rest.drawCalls);
		// The highlight is the same pass: with the grid off, its twins draw for it alone.
		tabletop.setHighlight({ x: 4, y: 4 }, 'blocked');
		await settle(tabletop);
		await tabletop.benchmark(1);
		expect(tabletop.stats().drawCalls).toBe(shown.drawCalls);
		tabletop.setHighlight(null, 'move');
		expect((await draw('off')).programs).toBe(shown.programs);
	});

	test('draws a frame when the grid mode changes, then idles', async () => {
		const m = await mount('ref-7', 'gm');
		const t = m.tabletop;
		for (const mode of ['build', 'explore', 'overview', 'off'] as const) {
			const before = t.stats().frames;
			t.setGridMode(mode, [{ x: 2, y: 2 }]);
			await settle(t);
			expect(t.stats().frames, mode).toBeGreaterThan(before);
			// No fade, nothing animates: the table goes quiet at once.
			const quiet = t.stats().frames;
			await wait(1000);
			expect(t.stats().frames, mode).toBe(quiet);
		}
		// Setting the same mode again draws nothing.
		const same = t.stats().frames;
		t.setGridMode('off', [{ x: 2, y: 2 }]);
		await wait(500);
		expect(t.stats().frames).toBe(same);
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

	test('picks cells by the DDA, raised ground included, and raycasts only the pick layer', async () => {
		const sidecar = await loadSidecar('monastery');
		const view = await loadView('monastery', sidecar.ambient, 'gm');
		const events = { onClick: vi.fn(), onHover: vi.fn() };
		const m = await mountFixture(view, sidecar.poses.overview, { events, heroes: false });
		mounted.push(m);
		await settle(m.tabletop);
		// Every object a raycast tests, by any of the raycastable classes (not the stand-in mesh an
		// instanced mesh tests each instance with).
		const tested = new Set<THREE.Object3D>();
		const spied = [THREE.Mesh, THREE.InstancedMesh, THREE.Sprite, THREE.Line, THREE.Points];
		const originals = spied.map((c) => c.prototype.raycast);
		let depth = 0;
		spied.forEach((c, k) => {
			c.prototype.raycast = function (this: THREE.Object3D, ...args: never[]) {
				if (depth === 0) tested.add(this);
				depth++;
				try {
					return (originals[k] as (...a: never[]) => void).apply(this, args);
				} finally {
					depth--;
				}
			};
		});
		const { position: eye, target } = m.tabletop.cameraPose()!;
		const f = unit(sub(target, eye));
		const r = unit({ x: -f.z, y: 0, z: f.x });
		const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
		const rect = m.canvas.getBoundingClientRect();
		const tan = Math.tan(Math.PI / 8); // the 45 degree field of view
		/** Clicks where a world point shows, by the camera's own projection. */
		const click = (p: { x: number; y: number; z: number }) => {
			const d = sub(p, eye);
			const z = dot(d, f);
			const nx = dot(d, r) / (z * tan * (rect.width / rect.height));
			const ny = dot(d, u) / (z * tan);
			const at = {
				clientX: rect.left + ((nx + 1) / 2) * rect.width,
				clientY: rect.top + ((1 - ny) / 2) * rect.height,
				button: 0,
				bubbles: true
			};
			m.canvas.dispatchEvent(new PointerEvent('pointerdown', at));
			m.canvas.dispatchEvent(new PointerEvent('pointerup', at));
			return events.onClick.mock.calls.at(-1)![0];
		};
		m.canvas.setPointerCapture = m.canvas.releasePointerCapture = () => {};
		try {
			// The gallery's floor at level 5, the nave's below it, and the gallery's south face.
			expect(click({ x: 5.5, y: 2, z: -4.5 }).cell).toEqual({ x: 20, y: 5 });
			expect(click({ x: 1.5, y: 0, z: -4.5 }).cell).toEqual({ x: 16, y: 5 });
			expect(click({ x: 4.5, y: 1, z: 0 }).cell).toEqual({ x: 19, y: 9 });
			// Beyond the grid's south edge: no cell, but a corner on the border still snaps.
			const beyond = click({ x: 0.2, y: 0, z: 10.3 });
			expect(beyond.cell).toBeNull();
			expect(beyond.corner).toEqual({ x: 15, y: 20 });
		} finally {
			spied.forEach((c, k) => (c.prototype.raycast = originals[k]));
		}
		expect(tested.size).toBeGreaterThan(0);
		for (const o of tested) expect(o.layers.isEnabled(PICK_LAYER), o.name || o.type).toBe(true);
	});

	test('lands a die on the monastery gallery and lays previews on its ground (#247)', async () => {
		const throws = vi.spyOn(DiceLayer.prototype, 'throw');
		const sets = vi.spyOn(PreviewLayer.prototype, 'set');
		const m = await mount('monastery', 'gm');
		// Looking at the gallery's cell (20, 5), at level 5 (2 up), from the nave's side.
		m.tabletop.setPose({ position: { x: -2.5, y: 9, z: 3.5 }, target: { x: 5.5, y: 2, z: -4.5 } });
		await settle(m.tabletop);
		const { position: eye, target } = m.tabletop.cameraPose()!;
		/** The canvas pixel where a world point shows, by the camera's own projection. */
		const f = unit(sub(target, eye));
		const r = unit({ x: -f.z, y: 0, z: f.x });
		const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
		const tan = Math.tan(Math.PI / 8); // the 45 degree field of view
		const pixelOf = (p: V3) => {
			const d = sub(p, eye);
			const z = dot(d, f);
			const nx = dot(d, r) / (z * tan * (WIDTH / HEIGHT));
			const ny = dot(d, u) / (z * tan);
			return [Math.round(((nx + 1) / 2) * WIDTH), Math.round(((1 - ny) / 2) * HEIGHT)] as const;
		};
		const before = await readFrame(m.canvas, WIDTH, HEIGHT);

		// Reduced motion lands it at once; the held clock keeps it resting there.
		m.tabletop.throwDice({ seq: 3, dice: [{ kind: 'd20', face: 19 }], color: '#2050d0' });
		const frames = m.tabletop.stats().frames;
		while (m.tabletop.stats().frames < frames + 3) await wait(50);
		const layer = throws.mock.contexts[0] as DiceLayer;
		const [die] = layer.group.children;
		const rest = buildDieModel('d20', 1).inradius * 0.9;
		expect(die.position.y - rest).toBeCloseTo(2, 5); // on the gallery's floor, not the nave's
		expect(Math.abs(die.position.x - target.x)).toBeLessThan(1.5);
		const [px, py] = pixelOf(die.position);
		const [was, now] = [before(px, py), (await readFrame(m.canvas, WIDTH, HEIGHT))(px, py)];
		expect(now, `the die drawn at ${px}, ${py}`).not.toEqual(was);

		// An area from the nave (cells 17, 18 at level 0) onto the gallery (19, 20 at 5), the gallery's
		// corner over the nave, and a segment down its edge, a cliff from 0 to 2.
		m.tabletop.setPreview([
			{ kind: 'area', from: { x: 17, y: 5 }, to: { x: 20, y: 5 }, tone: 'reveal' },
			{ kind: 'corner', at: { x: 19, y: 5 } },
			{ kind: 'segment', a: { x: 19, y: 4 }, b: { x: 19, y: 6 }, tone: 'valid' }
		]);
		const previews = sets.mock.contexts.at(-1) as PreviewLayer;
		const placed = (bucket: Bucket) => {
			const mesh = previews.pool.get(bucket)!;
			return Array.from({ length: mesh.count }, (_, i) => {
				const [at, q, s] = [new THREE.Vector3(), new THREE.Quaternion(), new THREE.Vector3()];
				mesh.getMatrixAt(i, new THREE.Matrix4()).decompose(at, q, s);
				return { y: at.y, low: at.y - s.y / 2, high: at.y + s.y / 2 };
			});
		};
		expect(
			placed('reveal')
				.map((p) => +p.low.toFixed(3))
				.sort()
		).toEqual([0, 2]);
		expect(placed('corner').map((p) => +p.y.toFixed(3))).toEqual([2.15]);
		const [edge] = placed('valid');
		expect([edge.low, edge.high].map((y) => +y.toFixed(3))).toEqual([0, 2 + WALL_HEIGHT / 2]);
		const groups = new Set(previews.pool.values());
		for (let i = 0; i < 100; i++)
			m.tabletop.setPreview([
				{
					kind: 'area',
					from: { x: 17, y: 5 },
					to: { x: 17 + (i % 5), y: 2 + (i % 7) },
					tone: 'hide'
				}
			]);
		expect(new Set(previews.group.children)).toEqual(groups); // no new meshes
		m.tabletop.setPreview([]);
	});
});

type V3 = { x: number; y: number; z: number };
const sub = (a: V3, b: V3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const unit = (a: V3) => {
	const l = Math.hypot(a.x, a.y, a.z);
	return { x: a.x / l, y: a.y / l, z: a.z / l };
};

describe('the ground to the horizon', () => {
	/** The village's grid and look at `time` with nothing on it: a clear view to the horizon. */
	async function bare(
		time: number,
		events?: { onClick: () => void; onHover: () => void },
		tier: Tier = 'medium',
		backdrop?: WorldLook['backdrop']['kind']
	) {
		const view = await loadView('village', 'day', 'gm');
		const plain = { ...view, tokens: [], props: [], objects: [], lights: [], terrain: null };
		const sidecar = await loadSidecar('village');
		const m = await mountFixture(
			{
				...plain,
				world: {
					...view.world,
					time,
					...(backdrop === undefined ? {} : { backdrop: { kind: backdrop, level: 0 } })
				}
			},
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
			// No silhouettes (#244): their ridges are edges in the sky on purpose (beyond.svelte.spec.ts
			// covers them); this checks the ground meets the sky with no band.
			const { tabletop, canvas } = await bare(time, undefined, tier, 'none');
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
