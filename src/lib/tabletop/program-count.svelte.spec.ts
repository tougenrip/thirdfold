// Runtime state never compiles a shader (#170). A table is warmed up (every environment drawn once,
// every table the sweep travels to visited once), its shader counts taken (shaderCounts in perf.ts:
// programs, pipelines, node states), and then everything that changes at runtime is done one named
// step at a time, a frame drawn after each: environments, times of day, floors, fog and its modes
// (with the fog cloud on and a reveal fading, #174), dark areas, light counts past the pool, tokens
// and props in every state, both cues and table travel. No step may change the programs or
// pipelines; a change names the step and the stages it made or dropped (a stage is named after its
// material, and the material module names its materials by kind: the layers #172 ported show as
// surface, terrain, prop and mini). Compiles today's renderer still makes are listed in KNOWN, with
// the issue that ends them. New node states with no new program are reported, not failed: they cost
// code generation, not a driver compile. r186 gives every InstancedMesh a vertex stage of its own
// (materials.svelte.spec.ts), so the warm-up visits every table the sweep travels to: their props'
// meshes are compiled then, and a table left behind keeps its programs. A deliberately bad material
// (a literal of its own in the graph) proves the sweep is not vacuous. Per tier, on both backends
// (WebGL2 on SwiftShader here; WebGPU on the real GPU in the client-webgpu project). Reduced
// motion, as the other renderer tests, so the toll's dust is not drawn in the sweep: a second test
// plays it with motion (the warm-up's gallery compiles it, #180). The sky (#225): a 24-hour sweep in
// hourly steps under the default open sky, every other sky in the manifest at the band hours (an
// enclosed sky takes its band's key whole, and each hour is a capture: every sky every hour took
// ten minutes a tier), haze 0 to 1, a roof on and off, and the flash with Reduce flashing on and off.
// Each tier's runtime state (in two halves), its table travel and its sky are tests of their own, one CI shard each (shardedIt).
// Many lights (#228, `lightSteps`): 40 torches coming and going, carried light on, coloured, moved
// and off, kinds and colours changing, on every tier, in a shard of its own; later lighting tasks
// (hero shadows, flicker, fixtures, bounce, strips, translucency) append their steps there; the
// flicker's (#231) are every profile on the 40 torches.

import * as THREE from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { afterEach, describe, expect, vi } from 'vitest';
import { decodeFloor, encodeFloor, FLOOR_IDS } from '$lib/game/floor';
import { FLICKERS, LIGHT_KINDS, type Light } from '$lib/game/lights';
import { bandOf, type WorldLook } from '$lib/game/world';
import { loadManifest } from '$lib/assets/load';
import { decodeLevels } from '$lib/game/terrain';
import { decodeMask, encodeMask } from '$lib/game/visibility';
import { loadEnvironment } from './environment';
import { loadModel } from './models';
import { shaderCounts, shaderStages, type ShaderCounts } from './perf';
import { aoKind, settingsFor, type Tier } from './quality';
import type { Tabletop } from './types';
import {
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	shardedIt,
	type FixtureView,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 600_000, hookTimeout: 90_000 });

/** Every environment in the manifest, and the plain table. */
const ENVIRONMENTS = [
	'village',
	'stone-halls',
	'cavern',
	'living-cave',
	'railcar',
	'ghost-town',
	null
] as const;
/** The tables the sweep travels between: other sizes and environments than the test world's. */
const TRAVEL = ['village', 'hollow', 'heart'] as const;
const HOME = 'test-world';
/** More lights than a cell lists (K, 4 to 16 by tier) and the pool under `?off=manylights` (8). */
const MANY_LIGHTS = 12;
const TIERS: readonly Tier[] = ['low', 'medium', 'high'];
/** The sky swept every hour; the others at the hours standing for each band, dawn and dusk apart. */
const HOURLY_SKY = 'temperate';
const BAND_HOURS = [360, 720, 1170, 1380];

let mounted: Mounted | null = null;
afterEach(async () => {
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

/** Every viewer's view of a fixture at its own time of day. */
async function viewOf(fixture: string, viewer: 'gm' | 'player' = 'gm') {
	const sidecar = await loadSidecar(fixture);
	return { view: await loadView(fixture, sidecar.ambient, viewer), sidecar };
}

/** A named change, and how far the held clock moves before its frame (default: past its end). */
type Step = readonly [name: string, run: () => void, advance?: number];
type Clock = ReturnType<typeof manualClock>;

/**
 * Waits for a frame drawn after a step, past any warm-up. What a change compiles, it compiles on
 * its first frame; waiting for rest instead takes minutes a step on SwiftShader (TRAA's converge
 * frames on high). The held clock is first moved past any transition the step starts (a grade
 * blending into a new environment's, a cue), so the frames after it draw its end.
 */
async function drawn(t: Tabletop, clock: Clock, advance = 30_000): Promise<boolean> {
	const from = t.stats().frames;
	clock.set(clock.now() + advance);
	const until = performance.now() + 10_000;
	while (performance.now() < until) {
		await new Promise(requestAnimationFrame);
		const { frames, holding } = t.stats();
		if (!holding && frames > from) return true;
	}
	return false;
}

/**
 * Compiles today's renderer still makes at runtime, by step, and the issue that ends each. A step
 * listed here may change the counts; one in FIRST_USE that changes nothing fails, so the list
 * shrinks as they are fixed.
 */
const KNOWN: Record<string, string> = {
	// The first switch of anti-tiling in place swaps the table's, the walls' and the raised
	// ground's materials for their twins (kept since #180, so switching back and again compiles
	// nothing). A compile can't make what the draw will use: r186 gives every InstancedMesh a
	// vertex stage of its own and declares a shadowed material's uniforms in another order compiled
	// than drawn, and the real meshes can't be drawn in their twins unseen. It happens only where a
	// tier switch keeps the pipeline (no AO: low, or medium with Advanced options off), in the hold
	// the switch starts anyway (the lobby's gallery, drawn on the same renderer, doesn't prevent it).
	'anti-tiling on': 'r186 (no issue: see above)'
};
/** The KNOWN steps that always compile (on their first use). */
const FIRST_USE: string[] = ['anti-tiling on'];

interface Sweep {
	/** Runs `steps`, drawing after each; returns the steps that changed the counts, and how. */
	run(steps: readonly Step[]): Promise<string[]>;
	/** Node states made without a program (reported, not failed). */
	codegen: string[];
	counts(): ShaderCounts;
}

/** The sweep over a mounted tabletop, reading the renderer its warm-up compiles with. */
function sweeper(m: Mounted, renderer: THREE.WebGPURenderer, clock: Clock): Sweep {
	const codegen: string[] = [];
	const counts = () => shaderCounts(renderer);
	return {
		codegen,
		counts,
		async run(steps) {
			const changes: string[] = [];
			for (const [name, run, advance] of steps) {
				const [was, stages] = [counts(), shaderStages(renderer)];
				run();
				// A step that draws nothing could compile nothing: it would pass without testing.
				if (!(await drawn(m.tabletop, clock, advance))) changes.push(`${name}: no frame drawn`);
				const now = counts();
				if (now.programs !== was.programs || now.pipelines !== was.pipelines) {
					const after = shaderStages(renderer);
					const made = [...after].filter(([code]) => !stages.has(code)).map(([, n]) => n);
					const dropped = [...stages].filter(([code]) => !after.has(code)).map(([, n]) => n);
					changes.push(
						`${name}: programs ${was.programs} → ${now.programs}, pipelines ` +
							`${was.pipelines} → ${now.pipelines}; made [${made.join(', ')}], ` +
							`dropped [${dropped.join(', ')}]`
					);
				} else if (now.nodeStates !== was.nodeStates) {
					codegen.push(`${name}: node states ${was.nodeStates} → ${now.nodeStates}`);
				}
			}
			return changes;
		}
	};
}

/** Puts a whole fixture view on the table, in the order the Tabletop component does. */
function show(m: Mounted, view: FixtureView): void {
	const t = m.tabletop;
	const size = view.grid.width * view.grid.height;
	t.setGrid(view.grid);
	t.setTerrain(view.terrain ? decodeLevels(view.terrain, size) : null);
	t.setFloor(view.floor ? decodeFloor(view.floor, size) : null);
	t.setDarkness(view.darkness ? decodeMask(view.darkness, size) : null);
	t.setEnvironment(view.environment);
	t.setTokens(view.tokens);
	t.setObjects(view.objects);
	t.setFog(view.fog, view.fogMode);
	t.setLighting(view.ambient, view.lights);
	t.setProps(view.props);
}

/** Everything that changes at runtime on the home table, as named steps. */
function homeSteps(m: Mounted, home: FixtureView, tier: Tier): Step[] {
	const t = m.tabletop;
	const size = home.grid.width * home.grid.height;
	const all = encodeMask(new Uint8Array(size).fill(1));
	const none = encodeMask(new Uint8Array(size));
	const floorOf = (i: number) => decodeFloor(encodeFloor(new Uint8Array(size).fill(i))!, size);
	const floor = home.floor ? decodeFloor(home.floor, size) : null;
	const light = (i: number, over: Partial<Light> = {}): Light => ({
		id: `sweep-${i}`,
		pos: { x: 2 + (i % 8) * 2, y: 2 + Math.floor(i / 8) * 4 },
		radius: 4,
		color: '#ff9a3c',
		on: true,
		...over
	});
	const lights = (n: number, over: Partial<Light> = {}) =>
		Array.from({ length: n }, (_, i) => light(i, over));
	const [token] = home.tokens;
	const withToken = (over: object) => home.tokens.map((k) => (k === token ? { ...k, ...over } : k));
	const [prop] = home.props;
	const withProp = (over: object) => home.props.map((p) => (p === prop ? { ...p, ...over } : p));
	const [wall, door] = (['wall', 'door'] as const).map((k) =>
		home.objects.find((o) => o.kind === k)!
	);
	const cue = (c: 'flash' | 'toll') => () => t.playCue(c, c === 'toll' ? prop.id : null);
	// The tier as mounted, with the fog cloud's layer on or off (#174).
	const cloud = (on: boolean) => () => {
		const settings = settingsFor(tier, t.capabilities().backend);
		t.setQuality({ ...settings, miniature: false, layers: { ...settings.layers, fogcloud: on } });
	};
	return [
		...ENVIRONMENTS.map((e): Step => [`environment ${e ?? 'none'}`, () => t.setEnvironment(e)]),
		['environment back', () => t.setEnvironment(home.environment)],
		...(['day', 'dusk', 'dark', 'dusk', 'day'] as const).map((a): Step => [
			`ambient ${a}`,
			() => t.setLighting(a, home.lights)
		]),
		['ambient back', () => t.setLighting(home.ambient, home.lights)],
		...FLOOR_IDS.map((id, i): Step => [`floor ${id}`, () => t.setFloor(floorOf(i))]),
		['floor cleared', () => t.setFloor(null)],
		['floor back', () => t.setFloor(floor)],
		['fog off', () => t.setFog(null, 'gm')],
		['fog on, GM', () => t.setFog(home.fog, 'gm')],
		['fog on, player', () => t.setFog(home.fog, 'player')],
		['fog, all visible', () => t.setFog({ ...home.fog, visible: all, explored: all }, 'player')],
		['fog, all explored', () => t.setFog({ ...home.fog, visible: none, explored: all }, 'player')],
		['fog, nothing seen', () => t.setFog({ ...home.fog, visible: none, explored: none }, 'player')],
		['fog back', () => t.setFog(home.fog, home.fogMode)],
		// Soft edges are always on; a reveal fades on a map and a uniform, the cloud is warmed up.
		['fog cloud on, player', () => (cloud(true)(), t.setFog(home.fog, 'player'))],
		[
			'fog revealed, fading',
			() => t.setFog({ ...home.fog, visible: all, explored: all }, 'player')
		],
		['fog cloud, GM', () => t.setFog(home.fog, 'gm')],
		['fog cloud off', () => (cloud(false)(), t.setFog(home.fog, 'player'))],
		['fog back again', () => t.setFog(home.fog, home.fogMode)],
		['dark areas everywhere', () => t.setDarkness(new Uint8Array(size).fill(1))],
		['dark areas removed', () => t.setDarkness(null)],
		['lights 0', () => t.setLighting('dark', [])],
		['lights 1', () => t.setLighting('dark', lights(1))],
		[`lights ${MANY_LIGHTS}`, () => t.setLighting('dark', lights(MANY_LIGHTS))],
		['lights recoloured', () => t.setLighting('dark', lights(MANY_LIGHTS, { color: '#3c7aff' }))],
		['lights off', () => t.setLighting('dark', lights(MANY_LIGHTS, { on: false }))],
		['lights on', () => t.setLighting('dark', lights(MANY_LIGHTS))],
		['lights 0 again', () => t.setLighting('dark', [])],
		['token carrying light', () => t.setTokens(withToken({ light: 4 }))],
		['lights back', () => t.setLighting(home.ambient, home.lights)],
		['token without a model', () => t.setTokens(withToken({ model: undefined }))],
		['token hidden', () => t.setTokens(withToken({ hidden: true }))],
		['tokens back', () => t.setTokens(home.tokens)],
		['token selected', () => t.setSelected(token.id)],
		['token fallen', () => t.setFallen([token.id])],
		['token active', () => t.setActive(token.id, false)],
		['enemy active', () => t.setActive(token.id, true)],
		[
			'token states cleared',
			() => (t.setSelected(null), t.setFallen([]), t.setActive(null, false))
		],
		['prop selected', () => t.setSelectedProp(prop.id)],
		['prop hovered', () => t.setHoveredProp(prop.id)],
		['prop states cleared', () => (t.setSelectedProp(null), t.setHoveredProp(null))],
		// Walls take the hover as a tint per instance, a door by swapping to its tinted twin (#172).
		['wall hovered', () => t.setHoveredObject(wall.id)],
		['door hovered', () => t.setHoveredObject(door.id)],
		['hover cleared', () => t.setHoveredObject(null)],
		['prop hidden', () => t.setProps(withProp({ hidden: true }))],
		['prop moved', () => t.setProps(withProp({ pos: { x: prop.pos.x + 1, y: prop.pos.y } }))],
		['props back', () => t.setProps(home.props)],
		['flash cue', cue('flash')],
		['toll cue', cue('toll')],
		// Reduced motion throws instantly; the frame is drawn with the die at rest, then fading
		// (after REST_S, 3.2 s, dice3d.ts), then gone.
		['die thrown', () => t.throwDice(THROW), 100],
		['die fading', () => {}, 3_300],
		['die gone', () => {}]
	];
}

/** The sky and the rest of the world's look on the home table, as named steps (#225). */
function skySteps(m: Mounted, home: FixtureView, skies: readonly string[]): Step[] {
	const t = m.tabletop;
	const size = home.grid.width * home.grid.height;
	const world = (over: Partial<WorldLook>): WorldLook => ({ ...home.world, time: 780, ...over });
	const flash = () => t.playCue('flash', null);
	return [
		// The sky (#225): a day in hourly steps under the open sky most tables wear, every sky at
		// the band hours (each step captures it again, the clock moved past the tier's interval),
		// haze from none to dense, a roof on and off, the flash and Reduce flashing.
		...skies.flatMap((sky) =>
			(sky === HOURLY_SKY ? Array.from({ length: 24 }, (_, h) => h * 60) : BAND_HOURS).map(
				(time): Step => [
					`sky ${sky} ${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`,
					() => t.setLighting(bandOf(time), home.lights, world({ sky, time }))
				]
			)
		),
		...[0, 0.25, 0.5, 1].map((density): Step => [
			`haze ${density}`,
			() => t.setLighting('day', home.lights, world({ haze: { density, color: '#b8c0cc' } }))
		]),
		['roofed', () => t.setInterior(new Uint8Array(size).fill(1))],
		['roof off', () => t.setInterior(null)],
		['flash, reduced', () => (t.setReduceFlashing(true), flash())],
		['flash, not reduced', () => (t.setReduceFlashing(false), flash())],
		['world back', () => t.setLighting(home.ambient, home.lights, home.world)]
	];
}

/**
 * The most textures a fragment stage may sample: WebGPU's default `maxSampledTexturesPerShaderStage`
 * is 16, and GridLights' two textures (#228) brought the largest stage to 15; one is kept spare.
 */
const STAGE_TEXTURES = 15;

/** The most textures any fragment stage of each material name samples, WGSL or GLSL. */
function stageTextures(renderer: THREE.WebGPURenderer): Map<string, number> {
	const most = new Map<string, number>();
	for (const [code, label] of shaderStages(renderer)) {
		if (!label.endsWith(' fragment')) continue;
		const wgsl = code.match(/var\s+\w+\s*:\s*texture_/g)?.length ?? 0;
		const glsl = code.match(/uniform\s+(?:(?:high|medium|low)p\s+)?\w*sampler\w*/g)?.length ?? 0;
		const name = label.slice(0, -' fragment'.length);
		most.set(name, Math.max(most.get(name) ?? 0, wgsl, glsl));
	}
	return most;
}

/** Torches the many-light steps put on the table: dungeon-40's count. */
const TORCHES = 40;

/**
 * The point lights (#228) on the home table, as named steps: 40 torches added and taken away, a
 * carried light switched on, coloured, carried a cell and off, every light kind and a recolour.
 * Later lighting tasks append their steps here.
 */
function lightSteps(m: Mounted, home: FixtureView): Step[] {
	const t = m.tabletop;
	const { width, height } = home.grid;
	const torch = (i: number, over: Partial<Light> = {}): Light => ({
		id: `torch-${i}`,
		pos: { x: 1 + ((i * 3) % (width - 2)), y: 1 + ((i * 5) % (height - 2)) },
		radius: 2 + (i % 5),
		color: '#ff9a3c',
		on: true,
		...over
	});
	const torches = (n: number, over: Partial<Light> = {}) =>
		Array.from({ length: n }, (_, i) => torch(i, over));
	const [token] = home.tokens;
	const carry = (over: object) => home.tokens.map((k) => (k === token ? { ...k, ...over } : k));
	const step = { x: Math.min(token.pos.x + 1, width - 1), y: token.pos.y };
	return [
		['no lights', () => t.setLighting('dark', [])],
		[`${TORCHES} torches`, () => t.setLighting('dark', torches(TORCHES))],
		['torches taken away', () => t.setLighting('dark', torches(TORCHES / 4))],
		[`${TORCHES} torches again`, () => t.setLighting('dark', torches(TORCHES))],
		['torches off', () => t.setLighting('dark', torches(TORCHES, { on: false }))],
		['torches recoloured', () => t.setLighting('dark', torches(TORCHES, { color: '#3c7aff' }))],
		// With fixtures, so a GM's handles on fixture-less lights (#209, an overlay made on first
		// need) stay out of it.
		...LIGHT_KINDS.map((kind): Step => [
			`torches as ${kind}`,
			() => t.setLighting('dark', torches(TORCHES, { kind, intensity: 2, fixture: true }))
		]),
		// Flicker (#231): each profile is numbers in a light's data and a uniform array, no program.
		...FLICKERS.map((flicker): Step => [
			`torches flicker ${flicker}`,
			() => t.setLighting('dark', torches(TORCHES, { flicker }))
		]),
		['carried light on', () => t.setTokens(carry({ light: 4 }))],
		['carried light coloured', () => t.setTokens(carry({ light: 4, lightColor: '#6fe08a' }))],
		['carried light moved', () => t.setTokens(carry({ light: 4, pos: step }))],
		['carried light off', () => t.setTokens(home.tokens)],
		['no lights again', () => t.setLighting('dark', [])],
		['lights back', () => t.setLighting(home.ambient, home.lights)]
	];
}

/** A roll to throw: a d20 showing its last face. */
const THROW = { seq: 1, dice: [{ kind: 'd20' as const, face: 19 }], color: '#8a2f24' };

async function mountHome(tier: Tier, reducedMotion = true) {
	const { view: home, sidecar } = await viewOf(HOME);
	const travel = await Promise.all(TRAVEL.map((f) => viewOf(f)));
	// Loaded before the sweep, so a step's frame is its final one (models arrive by then).
	const views = [home, ...travel.map((v) => v.view)];
	const models = new Set<string>(views.flatMap((v) => v.props.map((p) => p.assetId)));
	for (const v of views) for (const k of v.tokens) if (k.model) models.add(k.model);
	const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
	const clock = manualClock();
	const m = await mountFixture(home, sidecar.poses.overview, { clock, tier, reducedMotion });
	mounted = m;
	// Once the table is there: its renderer decodes the KTX2 files (models.ts).
	await Promise.all([...models].map((id) => loadModel(id)));
	await Promise.all(ENVIRONMENTS.flatMap((e) => (e ? [loadEnvironment(e)] : [])));
	// Flames and mist still with motion on, so frames come only from the steps.
	if (!reducedMotion) m.tabletop.setPowerSaver(true);
	await drawn(m.tabletop, clock);
	const renderer = compile.mock.contexts[0] as THREE.WebGPURenderer;
	const scene = compile.mock.calls[0][2] as THREE.Scene;
	expect(renderer).toBeInstanceOf(THREE.WebGPURenderer);
	return { m, home, travel: travel.map((v) => v.view), clock, renderer, scene };
}

/**
 * The runtime state on a tier against KNOWN: the home table's steps, or table travel (each its own
 * test, so a CI job holds one of them within its budget).
 */
async function runtimeState(tier: Tier, part: 'home' | 'more' | 'travel'): Promise<void> {
	const { m, home, travel, sweep } = await warmHome(tier);
	const t = m.tabletop;
	const p0 = sweep.counts();
	if (part === 'travel') {
		const changes: string[] = [];
		// Table travel: to each table and back home, in both directions.
		for (const view of [...travel, ...[...travel].reverse()]) {
			const [w, h] = [view.grid.width, view.grid.height];
			changes.push(
				...(await sweep.run([
					[`travel to ${w}×${h} ${view.environment}`, () => show(m, view)],
					['travel home', () => show(m, home)]
				]))
			);
		}
		expect(changes).toEqual([]);
		return;
	}
	// The home steps in two halves, each a test (and a CI job) of its own.
	const steps = homeSteps(m, home, tier);
	const half = Math.ceil(steps.length / 2);
	const changes = await sweep.run(part === 'home' ? steps.slice(0, half) : steps.slice(half));
	if (part === 'home') {
		expect(changes.filter((c) => !(c.slice(0, c.indexOf(':')) in KNOWN))).toEqual([]);
		return;
	}
	// Low draws one fetch a slot, medium and up anti-tile (#181). A switch that keeps the
	// pipeline swaps the table's, the walls' and the raised ground's materials for their twins;
	// it has no AO (low has none, and a new AO kind is a new renderer, Tabletop.svelte), so it
	// is swept where there is none. See KNOWN for the first one.
	const settings = settingsFor(tier, t.capabilities().backend);
	const antiTile = (on: boolean) => () => t.setQuality({ ...settings, antiTile: on });
	if (aoKind(settings) === 'none')
		changes.push(
			...(await sweep.run([
				[`anti-tiling ${settings.antiTile ? 'off' : 'on'}`, antiTile(!settings.antiTile)],
				['anti-tiling back', antiTile(settings.antiTile)],
				['anti-tiling again', antiTile(!settings.antiTile)],
				['anti-tiling as it was', antiTile(settings.antiTile)]
			]))
		);
	const stepOf = (change: string) => change.slice(0, change.indexOf(':'));
	const known = changes.filter((c) => stepOf(c) in KNOWN);
	console.info(`${tier} after the warm-up: ${JSON.stringify(p0)}; then\n${known.join('\n')}`);
	if (sweep.codegen.length) console.info(`${tier}: code generated\n${sweep.codegen.join('\n')}`);
	expect(changes.filter((c) => !(stepOf(c) in KNOWN))).toEqual([]);
	const swept = (step: string) => !step.startsWith('anti-tiling') || aoKind(settings) === 'none';
	const gone = FIRST_USE.filter(swept).filter((step) => !known.some((c) => stepOf(c) === step));
	expect(gone, 'known compiles that are gone: drop them from KNOWN').toEqual([]);
}

/**
 * The home table on a tier, warmed up: every environment once, every table once. The programs of a
 * table left behind stay compiled, so from here the counts hold still. (The lobby's gallery can't
 * stand in, #180: r186 orders a shadowed lit material's uniforms by what the renderer built before.)
 */
async function warmHome(tier: Tier) {
	const home = await mountHome(tier);
	const { m, travel, clock } = home;
	for (const e of ENVIRONMENTS) {
		m.tabletop.setEnvironment(e);
		await drawn(m.tabletop, clock);
	}
	for (const view of [...travel, home.home]) {
		show(m, view);
		await drawn(m.tabletop, clock);
	}
	return { ...home, sweep: sweeper(m, home.renderer, clock) };
}

// One test per tier for the runtime state and one for the sky, so CI runs each in a job of its own
// (`THIRDFOLD_SHARD=k/13`, .github/workflows/rendering.yml), the many lights' the 13th; the last two
// join the first shards.
describe('the shader program count', () => {
	const test = shardedIt();
	for (const tier of TIERS) {
		test(`stays put through runtime state on ${tier}`, async () => {
			await runtimeState(tier, 'home');
		});
		test(`stays put through more runtime state on ${tier}`, async () => {
			await runtimeState(tier, 'more');
		});
		test(`stays put through table travel on ${tier}`, async () => {
			await runtimeState(tier, 'travel');
		});
		test(`stays put through the sky on ${tier}`, async () => {
			const { m, home, sweep } = await warmHome(tier);
			const skies = Object.keys((await loadManifest()).skies ?? {});
			expect(skies).toContain(HOURLY_SKY);
			const changes = await sweep.run(skySteps(m, home, skies));
			if (sweep.codegen.length)
				console.info(`${tier}: code generated\n${sweep.codegen.join('\n')}`);
			expect(changes).toEqual([]);
		});
	}

	// Many lights (#228): every tier in one test, its own shard (programs 13). With the table's
	// warm-up done (every kind's gallery compiled, warmup.ts), no fragment stage samples more than
	// STAGE_TEXTURES textures: GridLights' two keep the largest within WebGPU's default 16.
	test('stays put through many lights on every tier', async () => {
		for (const tier of TIERS) {
			const { m, home, clock, renderer } = await mountHome(tier);
			// The pipeline's own passes settle over its first frames (the AO's blur): draw a few first.
			for (let i = 0; i < 3; i++) {
				m.tabletop.setPose(m.tabletop.cameraPose()!);
				await drawn(m.tabletop, clock);
			}
			const changes = await sweeper(m, renderer, clock).run(lightSteps(m, home));
			expect(changes, tier).toEqual([]);
			console.info(
				`${tier} textures per fragment stage: ${JSON.stringify([...stageTextures(renderer)])}`
			);
			const over = [...stageTextures(renderer)].filter(([, n]) => n > STAGE_TEXTURES);
			expect(over, `${tier}: fragment stages over ${STAGE_TEXTURES} textures`).toEqual([]);
			expect(stageTextures(renderer).get('terrain'), `${tier}: terrain`).toBeGreaterThan(2);
			await m.unmount();
			mounted = null;
			vi.restoreAllMocks(); // the next tier's renderer is the next spy's first
		}
	});

	test('stays put through the toll with motion, its dust and shadow shown (#180)', async () => {
		const { m, home, clock, renderer } = await mountHome('medium', false);
		const sweep = sweeper(m, renderer, clock);
		const [prop] = home.props;
		// The pipeline's own passes settle over its first frames (the AO's blur): draw a few first.
		for (let i = 0; i < 3; i++) {
			m.tabletop.setPose(m.tabletop.cameraPose()!);
			await drawn(m.tabletop, clock);
		}
		// A second in: the dust is falling and the shadow crossing; then the toll ends. A die thrown
		// with motion flies, lands and fades.
		const changes = await sweep.run([
			['toll cue, with motion', () => m.tabletop.playCue('toll', prop.id), 1_000],
			['toll over', () => {}],
			['die thrown, with motion', () => m.tabletop.throwDice({ ...THROW, seq: 2 }), 500],
			['die fading, with motion', () => {}, 4_300],
			['die gone, with motion', () => {}]
		]);
		expect(changes).toEqual([]);
	});

	test('reports a material with a literal of its own, by step', async () => {
		const { m, renderer, scene, clock } = await mountHome('medium');
		const sweep = sweeper(m, renderer, clock);
		const bad = (value: number): Step => [
			`bad material ${value}`,
			() => {
				const material = new THREE.MeshBasicNodeMaterial();
				// A baked literal: every value is a program of its own.
				material.colorNode = vec3(float(value));
				scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
				m.tabletop.setHighlight({ x: value, y: 0 }, 'move'); // asks for a frame
			}
		];
		const failures = await sweep.run([bad(1), bad(2)]);
		expect(failures).toHaveLength(2);
		expect(failures[0]).toMatch(/^bad material 1: programs \d+ → \d+/);
		expect(failures[1]).toMatch(/^bad material 2:/);
	});
});
