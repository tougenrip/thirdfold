// The CPU side of GridLights (#228, docs/RENDERING.md "Many lights"): every source that is on,
// placed or carried, becomes a `LightEntry` with a rule origin (its cell: membership, reach and
// occlusion, from a client `SightCache` of the rules' own sight, so a token's move works out one
// sight) and a visual position (`lightMount`, a seat's top, or the carrier's hand as its mini
// glides, `carry`), written to the scene's GridLight (materials/grid-light-node.ts). Only what
// changed uploads: a light's own layer, the grid rows whose lists changed. Built only from what
// the viewer was sent (its lights and tokens) and the client's obstacles: a hidden carrier is never
// sent, so it is never a light here. Bounce and cavity (#234, grid-lights.ts) go in the lists
// texture's tail when the lights, the obstacles or the floors changed, and only while `bounce` is on.

import * as THREE from 'three/webgpu';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import {
	lightLook,
	lightSources,
	renderedReach,
	type Light,
	type LightSource
} from '$lib/game/lights';
import { asObstacles, type Blockers } from '$lib/game/objects';
import type { Token } from '$lib/game/token';
import { SightCache, type CellMask } from '$lib/game/visibility';
import { STEP_HEIGHT, type Ground } from './ground';
import {
	bounceField,
	buildLists,
	buildRows,
	cavityField,
	floorAlbedo,
	GRID_LIGHT_CAPACITY,
	LIGHT_FLAGS,
	openSides,
	packIndirect,
	strength,
	type LightEntry
} from './grid-lights';
import { flickerPhase, flickerProfile, lightMount } from './light-model';
import type { GridLight } from './materials/grid-light-node';

/** A carried light's hand, in the mini's size off its feet: to its side and at its chest. */
export const HAND = { x: 0.22, y: 0.75 };
/** A light on a sconce or brazier hangs this far over the prop's top, in cells. */
const ABOVE_SEAT = 0.1;
export { strength };

/** A source that is on: a placed light or a token's carried light, with its id. */
interface Lit {
	id: string;
	source: LightSource;
	carrier: Token | null;
}

/** The sources in effect, in `lightSources`' order (placed, then carried), with their ids. */
export function litSources(lights: readonly Light[], tokens: readonly Token[]): Lit[] {
	const placed = lights.filter((l) => l.on && l.radius > 0);
	const carriers = tokens.filter((t) => t.light > 0);
	return lightSources(lights, tokens).map((source, i) => {
		const carrier = i < placed.length ? null : carriers[i - placed.length];
		return { id: source.id ?? '', source, carrier };
	});
}

const same = (a: LightEntry | null, b: LightEntry | null) =>
	a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/** Where a carried light is drawn while its mini stands still: in its hand, by its size and lift. */
export function carriedAt(grid: SquareGrid, token: Token, ground: Ground | null) {
	const w = gridToWorld(grid, token.pos);
	const size = grid.cellSize * (token.scale ?? 1);
	const lift = (token.lift ?? 0) * STEP_HEIGHT * grid.cellSize;
	const feet = (ground?.floorY(token.pos) ?? w.y) + lift;
	return { x: w.x + HAND.x * size, y: feet + HAND.y * size, z: w.z };
}

export class GridLighting {
	private readonly sights = new SightCache();
	/** Each sight's occlusion row: a sight is a new object whenever the obstacles change. */
	private readonly rows = new WeakMap<CellMask, Float32Array>();
	/** The point lights drawn, by data layer. */
	entries: LightEntry[] = [];
	/** What each layer holds on the GPU, and its row. */
	private sent: (LightEntry | null)[] = [];
	private sentRows: (Float32Array | null)[] = [];
	/** The carrying token's id per layer, so `carry` follows its mini. */
	private carriers: (string | null)[] = [];
	/** How long the last build took, ms (`?perf`): bounce and cavity included. */
	buildMs = 0;
	/** What bounce and cavity were last built from, and the obstacles' sides and cavity (#234). */
	private indirectKey: unknown[] = [];
	private sides: { signature: string; open: Uint8Array; cavity: Float32Array } | null = null;

	constructor(readonly light: GridLight) {}

	/** Every source that is on into the light's lists, rows and data. */
	update(
		grid: SquareGrid,
		lit: readonly Lit[],
		blocked: Blockers,
		ground: Ground | null,
		seats: ReadonlyMap<number, number>,
		floor: Uint8Array | null = null,
		bounce = 0
	): void {
		const t0 = performance.now();
		const obstacles = asObstacles(blocked);
		const cache = this.sights.use(grid, blocked);
		const shown = lit.slice(0, GRID_LIGHT_CAPACITY);
		const colour = new THREE.Color();
		this.entries = shown.map(({ id, source: s, carrier }) => {
			const look = lightLook(s);
			colour.set(s.color); // linear, as three's colours are
			const seat = seats.get(s.pos.y * grid.width + s.pos.x);
			const at = gridToWorld(grid, s.pos);
			const floor = ground?.floorY(s.pos) ?? 0;
			const visual = carrier
				? carriedAt(grid, carrier, ground)
				: seat === undefined
					? lightMount(grid, s, obstacles.edges, ground)
					: { x: at.x, y: floor + (seat + ABOVE_SEAT) * grid.cellSize, z: at.z };
			return {
				id,
				ruleOrigin: { ...s.pos },
				visual,
				reach: renderedReach(s.radius),
				colour: [colour.r, colour.g, colour.b] as const,
				intensity: look.intensity * strength(s.radius),
				profile: flickerProfile(look.flicker),
				phase: flickerPhase(id),
				flags: carrier ? LIGHT_FLAGS.bakeExcluded : 0 // carried light never bakes (#235)
			};
		});
		this.carriers = shown.map((l) => l.carrier?.id ?? null);
		const levels = obstacles.levels ?? null;
		for (let i = 0; i < Math.max(this.entries.length, this.sent.length); i++) {
			const e = this.entries[i] ?? null;
			let row: Float32Array | null = null;
			if (e) {
				const sight = cache.sight(grid, e.ruleOrigin, shown[i].source.radius);
				row = this.rows.get(sight) ?? buildRows(grid, sight, e.ruleOrigin, levels);
				this.rows.set(sight, row);
			}
			if (row === (this.sentRows[i] ?? null) && same(e, this.sent[i] ?? null)) continue;
			this.light.setLight(i, e, row);
			[this.sent[i], this.sentRows[i]] = [e && { ...e }, row];
		}
		this.sent.length = this.sentRows.length = this.entries.length;
		const sources = shown.map((l) => l.source);
		this.light.setLists(grid, buildLists(grid, cache, sources, this.light.k));
		this.indirect(grid, cache, blocked, sources, floor, bounce);
		this.buildMs = performance.now() - t0;
	}

	/** Bounce and cavity (#234), rebuilt only when what they come from changed; off at 0. */
	private indirect(
		grid: SquareGrid,
		cache: SightCache,
		blocked: Blockers,
		sources: readonly LightSource[],
		floor: Uint8Array | null,
		bounce: number
	): void {
		this.light.bounceGain.value = bounce;
		this.light.cavityGain.value = bounce > 0 ? 1 : 0;
		const lights = sources.map((s) => [
			s.pos.x,
			s.pos.y,
			s.radius,
			s.color,
			lightLook(s).intensity
		]);
		const key = [bounce > 0, cache.signature, floor, JSON.stringify(lights)];
		if (key.every((v, i) => v === this.indirectKey[i])) return;
		this.indirectKey = key;
		if (!bounce) return;
		const cells = grid.width * grid.height;
		if (this.sides?.signature !== cache.signature) {
			this.sides = {
				signature: cache.signature,
				open: openSides(grid, blocked),
				cavity: cavityField(grid, blocked)
			};
		}
		const albedo = floorAlbedo(cells, floor?.length === cells ? floor : null);
		const field = bounceField(grid, cache, sources, albedo, this.sides.open);
		const { open, cavity } = this.sides;
		this.light.setIndirect(grid, packIndirect(grid.width, field, cavity, open));
	}

	/** Carried lights follow their minis (`rootOf`: a mini's root, tweened): a layer each. */
	carry(tokens: { rootOf(id: string): THREE.Object3D | null }): void {
		this.carriers.forEach((id, i) => {
			const root = id ? tokens.rootOf(id) : null;
			const e = this.entries[i];
			if (!root || !e) return;
			const size = root.scale.x;
			const { x, y, z } = root.position;
			const visual = { x: x + HAND.x * size, y: y + HAND.y * size, z };
			if (visual.x === e.visual.x && visual.y === e.visual.y && visual.z === e.visual.z) return;
			e.visual = visual;
			this.light.setLight(i, e, this.sentRows[i] ?? null);
			this.sent[i] = { ...e };
		});
	}

	dispose(): void {
		this.light.dispose();
	}
}
