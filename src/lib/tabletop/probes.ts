// The probe grid's side of the renderer (#235): where the tier wants probes (`wantsProbes`) it
// loads probe-grid.ts (a lazy chunk), lays the grid out per table and bakes it as the scheduler's
// background work (scheduler.ts `Work`) on CONVERGE frames, by the pure policy in light-model.ts
// (`ProbeBake`): BAKE_DEBOUNCE_MS after anything it captures changes (the table and its levels,
// walls and doors, props, floors, the dark, roofs, placed lights, what the viewer has explored,
// the environment, the band and the hour to the half hour, and every warm-up, which a model or a
// look arriving brings; never tokens), PROBES_PER_FRAME a frame, then a fade in over
// PROBE_FADE_MS (at once under reduced motion), then nothing: an idle table draws no frame for it.
// Every warm-up's hold also captures one probe, so the bake's own programs (the cube faces' draws,
// the SH projection) never compile later. It wraps the tabletop's own setters, so the renderer
// only makes it.

import type * as THREE from 'three/webgpu';
import type { SquareGrid } from '$lib/game/grid';
import type { WorldLook } from '$lib/game/world';
import {
	PROBE_FADE_MS,
	PROBE_HEIGHTS,
	PROBE_INTENSITY,
	PROBE_MAX,
	ProbeBake,
	probeLayout,
	wantsProbes
} from './light-model';
import { baking } from './materials/grid-light-node';
import { skyAmbient } from './materials/world-modify';
import type { PerfRecorder } from './perf';
import type { ProbeGrid } from './probe-grid';
import type { QualitySettings } from './quality';
import type { RenderScheduler, Work } from './scheduler';
import type { Tabletop } from './types';

/** The hour is baked to the half hour: the sky turning by less bakes nothing. */
const HOUR_STEP = 30;
/** The setters whose values the bake captures, besides the table's and its levels. */
const WATCHED = [
	'setObjects',
	'setProps',
	'setFloor',
	'setDarkness',
	'setInterior',
	'setEnvironment',
	'setFog',
	'setLighting'
] as const;

export interface ProbeHooks {
	renderer: THREE.WebGPURenderer;
	scene: THREE.Scene;
	loop: RenderScheduler;
	clock: () => number;
	perf: PerfRecorder;
	/** Warm the table up again (the grid came or went). */
	warm: () => void;
	/** Cells between probes (tests only, `TabletopOptions.probeSpacing`). */
	spacing?: number;
}

export class ProbeLayer implements Work {
	private grid: ProbeGrid | null = null;
	private wanted = false;
	private disposed = false;
	private readonly bake = new ProbeBake();
	private timer: ReturnType<typeof setTimeout> | 0 = 0;
	/** The table (a new object only for a new size) and its levels; the inputs by setter. */
	private table: SquareGrid | null = null;
	private levels: Uint8Array | null = null;
	private readonly inputs = new Map<string, unknown>();
	/** Probes the layout uses: 0 until laid out for the table. */
	private total = 0;
	/** Bumped by each layout and warm-up: either always rebakes. */
	private version = 0;
	/** The bake under way began at (wall ms), and its fade at (clock ms; -1 none). */
	private started = 0;
	private fadeFrom = -1;

	/** `unbaked`: what the bake leaves out of the picture (tokens, dice, effects, the fog cloud). */
	constructor(
		private readonly hooks: ProbeHooks,
		private readonly unbaked: readonly THREE.Object3D[]
	) {
		hooks.loop.addWork(this);
	}

	/** Follows the tabletop's setters (after each has run) and its tier; disposes with it. */
	watch(t: Tabletop): void {
		const after = <K extends keyof Tabletop>(key: K, note: (...args: never[]) => void) => {
			const run = t[key] as (...args: unknown[]) => unknown;
			(t[key] as unknown) = (...args: unknown[]) => {
				const out = run(...args);
				note(...(args as never[]));
				this.changed();
				return out;
			};
		};
		after('setGrid', (g: SquareGrid) => {
			const was = this.table;
			if (!was || was.width !== g.width || was.height !== g.height || was.cellSize !== g.cellSize)
				[this.table, this.total] = [{ ...g }, 0];
		});
		after('setTerrain', (levels: Uint8Array | null) => {
			if (levels !== this.levels) [this.levels, this.total] = [levels, 0];
		});
		for (const key of WATCHED)
			after(key, (...args: unknown[]) => this.inputs.set(key, inputOf(key, args)));
		after('setQuality', (settings: QualitySettings) => this.setTier(settings, t));
		after('dispose', () => this.dispose());
	}

	/** Bakes this frame's probes and fades (Work); true while it wants more frames. */
	frame(reducedMotion: boolean): boolean {
		const grid = this.grid;
		if (!grid?.light.parent) return false;
		const { clock, perf, scene } = this.hooks;
		const now = clock();
		const step = this.bake.step(now);
		if (step) {
			const t0 = performance.now();
			if (step.start === 0) this.started = t0;
			grid.capture(scene, step.start, step.count, this.unbaked);
			perf.add('probes', performance.now() - t0);
			if (step.last) {
				perf.add('probe-bake', performance.now() - this.started);
				if (grid.light.intensity < PROBE_INTENSITY) this.fadeFrom = now;
			}
		}
		if (this.fadeFrom >= 0) {
			const k = reducedMotion ? 1 : Math.min(1, (now - this.fadeFrom) / PROBE_FADE_MS);
			grid.light.intensity = PROBE_INTENSITY * k;
			if (k === 1) this.fadeFrom = -1;
		}
		return this.bake.wait(now) === 0 || this.fadeFrom >= 0;
	}

	/** In a warm-up's hold (Work): one probe captured, compiling the bake; then a rebake is due. */
	warm(): void {
		if (!this.grid?.light.parent || !this.total) return;
		this.grid.capture(this.hooks.scene, 0, 1, this.unbaked);
		this.version++;
		this.changed();
	}

	/** Loads, shows or hides the grid for a tier; either warms the table up again. */
	private setTier(settings: QualitySettings, t: Tabletop): void {
		const want = wantsProbes(settings, t.capabilities());
		if (want === this.wanted) return;
		this.wanted = want;
		if (this.grid) return this.show();
		void import('./probe-grid').then(({ ProbeGrid }) => {
			if (this.disposed || this.grid || !this.wanted) return;
			const size = [PROBE_MAX, PROBE_HEIGHTS, PROBE_MAX] as const;
			this.grid = new ProbeGrid(this.hooks.renderer, { skyAmbient, baking }, size);
			this.show();
		});
	}

	/** Puts the grid in the scene (dark until baked) or takes it out, and warms up. */
	private show(): void {
		const light = this.grid!.light;
		if (this.wanted) this.hooks.scene.add(light);
		else light.removeFromParent();
		this.total = 0;
		this.changed();
		this.hooks.warm();
	}

	private dispose(): void {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
		this.grid?.dispose();
	}

	/** Lays the grid out for a new table (dark until baked), and restarts the bake on a change. */
	private changed(): void {
		const grid = this.grid;
		if (!grid?.light.parent || !this.table) return;
		if (!this.total) {
			const layout = probeLayout(this.table, this.levels, this.hooks.spacing);
			this.total = grid.layout(this.table, layout);
			grid.light.intensity = 0;
			this.fadeFrom = -1;
			this.version++;
		}
		const key = [this.version, ...WATCHED.map((k) => this.inputs.get(k))];
		if (this.bake.change(key, this.total, this.hooks.clock())) this.arm();
	}

	/** Wakes the scheduler when the debounce ends, checking the clock (tests hold it) first. */
	private arm(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = 0;
		const wait = this.bake.wait(this.hooks.clock());
		if (!(wait > 0 && wait < Infinity)) return;
		this.timer = setTimeout(() => {
			this.timer = 0;
			if (this.bake.wait(this.hooks.clock()) === 0) this.hooks.loop.wake();
			else this.arm();
		}, wait);
	}
}

/** What of a setter's arguments the bake captures, comparable with `===`. */
function inputOf(key: (typeof WATCHED)[number], args: unknown[]): unknown {
	if (key === 'setFog') {
		const [fog, mode] = args as Parameters<Tabletop['setFog']>;
		return `${mode} ${fog?.explored ?? 'all'}`;
	}
	if (key === 'setLighting') {
		const [ambient, lights, world] = args as [string, unknown, WorldLook | null | undefined];
		const look = world && { ...world, time: Math.round(world.time / HOUR_STEP) };
		return JSON.stringify([ambient, lights, look]);
	}
	return args[0];
}
