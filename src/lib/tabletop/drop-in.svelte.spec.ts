// Drop-in (#249) on ref-7 (no light flickers there, so the table rests), for the GM, with motion
// on and the clock held: a placed prop, a painted floor and raised ground start lifted and keep
// the scheduler active while the clock stands inside the drop, come to rest and go idle once it
// has passed DROP_MS, draw the sun's shadow at most once per edit and compile nothing. In the
// update after a load (`setGrid` with the same grid), and under reduced motion, nothing drops:
// the table goes idle with the clock still held.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFloor } from '$lib/game/floor';
import type { Prop } from '$lib/game/props';
import { decodeLevels } from '$lib/game/terrain';
import { DROP_MS } from './drop-in';
import type { Tabletop } from './types';
import {
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	wait,
	type FixtureView,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 90_000 });

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
});

async function mount(reducedMotion: boolean) {
	const sidecar = await loadSidecar('ref-7');
	const sent = await loadView('ref-7', 'day', 'gm');
	// A crate on the table already, so placing another is the edit alone (an asset's first use
	// on a layer asks for its model and draws again when it is there, shadows too).
	const first: Prop = {
		id: 'crate-0',
		assetId: 'crate',
		pos: { x: 0, y: 7 },
		rotation: 0,
		scale: 1
	};
	const view = { ...sent, props: [...sent.props, first] };
	const clock = manualClock();
	const m = await mountFixture(view, sidecar.poses.overview, { clock, reducedMotion });
	mounted = m;
	await rest(m.tabletop, clock);
	return { m, view, clock };
}

/**
 * At rest for 2 s, nothing loading and the scheduler only ambient or idle (at most 60 s); the held
 * clock moves on while something plays on it (as scheduling.svelte.spec.ts does).
 */
async function rest(t: Tabletop, clock: ReturnType<typeof manualClock>): Promise<void> {
	const until = performance.now() + 60_000;
	let since = performance.now();
	while (performance.now() < until) {
		await new Promise(requestAnimationFrame);
		const { mode, holding, frames } = t.stats();
		const [loaded, loading] = t.loads();
		const busy =
			holding || frames === 0 || loaded < loading || (mode !== 'ambient' && mode !== 'idle');
		if (mode === 'active' && !holding) clock.set(clock.now() + 500);
		if (busy) since = performance.now();
		else if (performance.now() - since >= 2000) break;
	}
}

const frames = (t: Tabletop) => t.stats().frames;
const shadows = (t: Tabletop) => t.stats().timings.shadows?.count ?? 0;
const nextFrames = async (n: number) => {
	for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
};

/** Waits (at most 20 s) until the scheduler is neither active nor converging. */
async function quiet(t: Tabletop) {
	const until = performance.now() + 20_000;
	const busy = () => t.stats().mode === 'active' || t.stats().mode === 'converge';
	while (performance.now() < until && busy()) await new Promise(requestAnimationFrame);
}

/**
 * Frames drawn over 800 ms: none at rest, or the table's own (ambient flicker, a frame for a load
 * landing), measured before each edit. (`mode` reads active for any frame on its way.)
 */
async function idleFrames(t: Tabletop): Promise<number> {
	const start = frames(t);
	await wait(800);
	return frames(t) - start;
}

/**
 * Whether the table comes to rest within 30 s with the clock held: an 800 ms spell drawing no
 * more than its own rest did (`idle`). A drop that never ended would keep it drawing throughout;
 * what an edit sets off besides (a relight, a load landing) settles by itself.
 */
async function rests(t: Tabletop, idle: number): Promise<boolean> {
	const until = performance.now() + 30_000;
	while (performance.now() < until) if ((await idleFrames(t)) <= idle + 1) return true;
	return false;
}

/** Pixels that differ by more than 8 in any channel. */
function changed(a: Uint8Array, b: Uint8Array): number {
	let n = 0;
	for (let i = 0; i < a.length; i += 4)
		if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c] - b[i + c]))) > 8) n++;
	return n;
}

/** The three edits a GM makes: place a prop, paint a floor area, raise ground. */
function edits(view: FixtureView, id = 'dropped-crate'): [string, (t: Tabletop) => void][] {
	const n = view.grid.width * view.grid.height;
	const floor = (view.floor && decodeFloor(view.floor, n)) || new Uint8Array(n);
	const levels = (view.terrain && decodeLevels(view.terrain, n)) || new Uint8Array(n);
	// A corner with no token (a token climbing raised ground glides on the clock).
	const area = (map: Uint8Array, value: number) => {
		const out = map.slice();
		for (let y = 6; y < 8; y++) for (let x = 9; x < 12; x++) out[y * view.grid.width + x] = value;
		return out;
	};
	const crate: Prop = { id, assetId: 'crate', pos: { x: 1, y: 6 }, rotation: 0, scale: 1 };
	const props: Prop[] = [...view.props, crate];
	return [
		['a placed prop', (t) => t.setProps(props)],
		['a painted floor', (t) => t.setFloor(area(floor, 4))],
		['raised ground', (t) => t.setTerrain(area(levels, 2))]
	];
}

describe('drop-in', () => {
	it('drops each edit in for DROP_MS, draws shadows once, then idles, compiling nothing', async () => {
		const { m, view, clock } = await mount(false);
		const t = m.tabletop;
		const programs = t.stats().programs;
		for (const [what, edit] of edits(view)) {
			const idle = await idleFrames(t);
			const [before, shadowed] = [frames(t), shadows(t)];
			edit(t);
			// Held inside the drop: the scheduler draws on, the piece still up.
			await nextFrames(12);
			expect(t.stats().mode, what).toBe('active');
			expect(frames(t) - before, what).toBeGreaterThanOrEqual(5);
			const up = m.pixels().slice();
			clock.set(clock.now() + DROP_MS / 2);
			await nextFrames(4);
			expect(t.stats().mode, what).toBe('active');
			// Past the drop: one frame at rest, then nothing.
			clock.set(clock.now() + DROP_MS);
			await quiet(t);
			expect(await rests(t, idle), what).toBe(true);
			expect(changed(up, m.pixels()), what).toBeGreaterThan(20);
			expect(shadows(t) - shadowed, what).toBeLessThanOrEqual(1);
		}
		expect(t.stats().programs).toBe(programs);
		// A load (setGrid with the same grid) and a new prop in the same update: nothing drops.
		const idle = await idleFrames(t);
		t.setGrid({ ...view.grid });
		const [[, place]] = edits(view, 'loaded-crate');
		place(t);
		await quiet(t);
		expect(await rests(t, idle)).toBe(true);
	});

	it('drops nothing under reduced motion: the table goes idle with the clock held', async () => {
		const { m, view } = await mount(true);
		const t = m.tabletop;
		for (const [what, edit] of edits(view)) {
			const idle = await idleFrames(t);
			edit(t);
			await quiet(t);
			expect(await rests(t, idle), what).toBe(true);
		}
	});
});
