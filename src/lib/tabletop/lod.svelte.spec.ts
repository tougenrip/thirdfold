// Levels of detail on the camera (#274): the Hollow's great bell (a cooked prop with two coarser
// levels) draws its full level close up and a coarser one from far off, the shadow map is
// never redrawn for it (its proxy casts at the cheapest level throughout), switching compiles
// nothing, and a table at rest draws no frames.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GridPose } from './poses';
import { loadView, mountFixture, settle, wait, type Mounted } from './testing';

vi.setConfig({ testTimeout: 300_000, hookTimeout: 90_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

/** Looking at the bell (3x3 at 23,8) from a few cells away. */
const BELL: GridPose = { target: { x: 24, y: 9 }, distance: 9, azimuth: 35, elevation: 35 };
/** The same, from as far as the camera goes on this table (800×500: the bell some 30 px across). */
const FAR: GridPose = { ...BELL, distance: 95, elevation: 55 };

describe('levels of detail', () => {
	it('drop with distance, come back close up, and never redraw the shadows', async () => {
		const view = await loadView('hollow', 'day', 'gm');
		let scene: THREE.Scene | null = null;
		const devScene = (s: THREE.Scene) => (scene = s);
		mounted = await mountFixture(view, BELL, { reducedMotion: true, heroes: false, devScene });
		const t = mounted.tabletop;
		await settle(t, 1000, 60_000);
		/** The bell's buckets drawn (props.ts): `<level>` with its triangles, and its proxy. */
		const bell = () => {
			const drawn: Record<string, number> = {};
			(scene as THREE.Scene | null)?.traverse((o) => {
				const key = o.userData.bucket as string | undefined;
				if (!key?.startsWith('great-bell:') || !(o as THREE.InstancedMesh).count) return;
				const [, level] = key.split(':');
				const g = (o as THREE.Mesh).geometry;
				drawn[level] = (drawn[level] ?? 0) + (g.index?.count ?? 0) / 3;
			});
			return drawn;
		};
		const stats = () => t.stats();
		const shadows = () => stats().timings.shadows?.count ?? 0;
		const picks = () => stats().timings.lod?.count ?? 0;
		const close = { bell: bell() };
		expect(Object.keys(close.bell).sort()).toEqual(['0', 'shadow']);
		const redraws = shadows();

		t.setGridPose(FAR);
		await settle(t, 1000, 60_000);
		const far = bell();
		const [level] = Object.keys(far).filter((k) => k !== 'shadow');
		expect(Number(level)).toBeGreaterThan(0);
		expect(far[level]).toBeLessThan(close.bell['0']); // a coarser level
		expect(far.shadow).toBe(close.bell.shadow); // the same proxy throughout
		expect(shadows()).toBe(redraws); // the camera moved: no shadow map for it, nor for the bell

		t.setGridPose(BELL);
		await settle(t, 1000, 60_000);
		expect(bell()).toEqual(close.bell); // its full level again
		expect(shadows()).toBe(redraws);
		// The first far view compiles what only it shows (small instanced meshes elsewhere, with
		// or without levels); after that, switching levels back and forth compiles nothing.
		const programs = stats().programs;
		for (const pose of [FAR, BELL, FAR, BELL]) {
			t.setGridPose(pose);
			await settle(t, 1000, 60_000);
		}
		expect(bell()).toEqual(close.bell);
		expect(stats().programs).toBe(programs);
		expect(shadows()).toBe(redraws);

		// At rest: no frames, and no picking.
		const [frames, picked] = [stats().frames, picks()];
		await wait(1500);
		expect(stats().frames).toBe(frames);
		expect(picks()).toBe(picked);
	});
});
