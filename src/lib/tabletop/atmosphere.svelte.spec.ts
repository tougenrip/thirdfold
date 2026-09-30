// The key light follows the hour (#215): the shadow map is drawn again about once per half degree
// the light turns (SHADOW_STEP_DEG), and when it switches body, never while nothing changes, and
// the hour compiles nothing. Under reduced motion a new hour snaps (no tween frames); with motion
// it plays over TWEEN_MS on the held clock and then the table comes to rest.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadManifest } from '$lib/assets/load';
import { bandOf, type WorldLook } from '$lib/game/world';
import {
	atmosphereAt,
	presetOf,
	shadowDirection,
	shadowNeedsRedraw,
	type KeyLight
} from './atmosphere-curve';
import { TWEEN_MS } from './atmosphere';
import type { Tabletop } from './types';
import { loadSidecar, loadView, manualClock, mountFixture, settle, type Mounted } from './testing';

vi.setConfig({ testTimeout: 300_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

async function mount(reducedMotion: boolean) {
	const sidecar = await loadSidecar('test-world');
	const view = await loadView('test-world', 'day', 'gm');
	const clock = manualClock();
	mounted = await mountFixture(view, sidecar.poses.overview, { clock, reducedMotion });
	await settle(mounted.tabletop);
	return { tabletop: mounted.tabletop, view, clock };
}

/** Waits for a frame drawn after now, past any hold. */
async function drawn(t: Tabletop): Promise<void> {
	const from = t.stats().frames;
	const until = performance.now() + 20_000;
	while (performance.now() < until) {
		await new Promise(requestAnimationFrame);
		const { frames, holding } = t.stats();
		if (!holding && frames > from) return;
	}
	throw new Error('no frame drawn');
}

const shadows = (t: Tabletop) => t.stats().timings.shadows?.count ?? 0;
const copyKey = (k: KeyLight): KeyLight => ({ ...k, dir: [...k.dir], color: [...k.color] });

describe('the key light', () => {
	it('redraws its shadows by the angle it turns, and body switches, compiling nothing', async () => {
		const { tabletop, view } = await mount(true);
		const setTime = (time: number) =>
			tabletop.setLighting(bandOf(time), view.lights, { ...view.world, time } as WorldLook);
		// The hours to sweep: an hour past noon a minute at a time, then night (the moon).
		const times = [...Array.from({ length: 61 }, (_, i) => 720 + i), 1380];
		// What the rule expects, from the table's own sky (the test world is under temperate).
		const preset = presetOf((await loadManifest()).skies.temperate);
		const none = { kind: 'none' as const, intensity: 0 };
		let last = copyKey(atmosphereAt(preset, 720, none).key);
		let [expected, switches, angle] = [0, 0, 0];
		for (const t of times) {
			const key = atmosphereAt(preset, t, none).key;
			if (!shadowNeedsRedraw(last, key)) continue;
			const [a, b] = [shadowDirection(last.dir), shadowDirection(key.dir)];
			if (key.body === last.body)
				angle += Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
			else switches++;
			expected++;
			last = copyKey(key);
		}
		const { programs, pipelines } = tabletop.stats();
		const [before, framesBefore] = [shadows(tabletop), tabletop.stats().frames];
		for (const t of times) {
			setTime(t);
			await drawn(tabletop);
		}
		await settle(tabletop);
		expect(shadows(tabletop) - before).toBe(expected);
		expect(switches).toBe(1);
		// About the angle turned over half a degree (each redraw is at least that far on).
		expect(expected - switches).toBeLessThanOrEqual((angle * 180) / Math.PI / 0.5 + 1e-6);
		expect(expected - switches).toBeGreaterThan(10);
		// A new hour snaps under reduced motion: a frame or two each, no tween (180 at 60 fps).
		expect(tabletop.stats().frames - framesBefore).toBeLessThanOrEqual(times.length * 2);
		expect(tabletop.stats()).toMatchObject({ programs, pipelines });
		// At rest, nothing more.
		const rest = shadows(tabletop);
		await settle(tabletop);
		expect(shadows(tabletop)).toBe(rest);
	});

	it('plays a new hour over its tween, then rests', async () => {
		const { tabletop, view, clock } = await mount(false);
		const { programs, pipelines } = tabletop.stats();
		const before = shadows(tabletop);
		tabletop.setLighting('day', view.lights, { ...view.world, time: 1110 });
		await drawn(tabletop);
		// Halfway: the scheduler keeps drawing while the light turns.
		clock.set(clock.now() + TWEEN_MS / 2);
		await drawn(tabletop);
		expect(tabletop.stats().mode).toBe('active');
		const mid = shadows(tabletop);
		expect(mid).toBeGreaterThan(before);
		clock.set(clock.now() + TWEEN_MS);
		await drawn(tabletop);
		await settle(tabletop);
		expect(shadows(tabletop)).toBeGreaterThan(mid);
		expect(tabletop.stats().mode).not.toBe('active');
		expect(tabletop.stats()).toMatchObject({ programs, pipelines });
	});
});
