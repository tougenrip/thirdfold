// The floors' painted surfaces on the terrain kind (#187): a texture array per map (albedo with
// height in alpha, normal, ORM), a layer per surface of the environment's library, and each
// floor's layer from the ground map's floor byte. Globals, as the ground map is: the renderer
// puts a table's arrays in with `wearFloors`, and an array standing in for an array (the blank
// one while they load, or where an environment has none) compiles nothing. A floor with no layer
// (plain, water, the void, or every floor until the arrays arrive) keeps its `floorPalette` colour.
//
// The splat (#242; its rules and their mirror in splat-weights.ts): on a top, each fragment blends
// the floors of the 2x2 cells round its nearest grid corner, read from the ground map (the
// continued floors, #239) by texel loads of the one map already bound, and whether each is known
// from the visibility map, also bound already: no new binding. The two heaviest floors are fetched
// from the same arrays (a layer each) and blended by height; man-made floors keep their border on
// the grid line, with a kerb. Styles, depth and the kerb are uniforms, so painting any floor or
// changing a value compiles nothing; the noise is in the anti-tiled graph only (medium and up).

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLOOR_IDS, VOID } from '../../game/floor';
import { cellUniforms, groundTexel, visibilityTexel } from '../cell-maps';
import { blankTexture, SLOTS } from './defaults';
import type { Variant } from './kinds';
import { worldBox, type Mapping } from './mapping';
import { SPLAT, STYLE_BY_INDEX } from './splat-weights';
import { pick, tsl, type N } from './tsl';

export type FloorMap = 'albedo' | 'normal' | 'orm';
export const FLOOR_MAPS: readonly FloorMap[] = ['albedo', 'normal', 'orm'];

/** One repeat of a surface covers this many cells. */
export const SURFACE_CELLS = 2;

const BLANKS = Object.fromEntries(
	FLOOR_MAPS.map((m) => [m, blankTexture({ ...SLOTS[m], type: 'array' })])
) as Record<FloorMap, THREE.Texture>;

const maps = Object.fromEntries(FLOOR_MAPS.map((m) => [m, T.texture(BLANKS[m])])) as Record<
	string,
	unknown
> as Record<FloorMap, { value: THREE.Texture }>;
/** Each floor's layer + 1 by `FLOOR_IDS` index; 0 has none. */
const layers = T.uniformArray(
	FLOOR_IDS.map(() => 0),
	'float'
);
/** Repeats per world unit: `SURFACE_CELLS` cells a repeat (`wearFloors` sets it by cell size). */
const repeat = T.uniform(new THREE.Vector2(1, 1));
/** Each floor's border style by `FLOOR_IDS` index (`FLOOR_STYLE`): data, never a program. */
const styles = T.uniformArray(STYLE_BY_INDEX.slice(), 'float');

/** The splat's tuning (splat-weights.ts `SPLAT`), as uniforms. */
export const splatUniforms = {
	reach: T.uniform(SPLAT.reach),
	noiseScale: T.uniform(SPLAT.noiseScale),
	depth: T.uniform(SPLAT.depth),
	kerbWidth: T.uniform(SPLAT.kerbWidth),
	kerbDark: T.uniform(SPLAT.kerbDark),
	kerbBevel: T.uniform(SPLAT.kerbBevel)
};

/** A table's floor arrays: the textures by map and the layer of each floor that has one. */
export interface FloorSurfaces {
	maps: Record<FloorMap, THREE.Texture>;
	/** Layer by floor id. */
	layers: Record<string, number>;
}

/**
 * Puts a table's floor arrays on the terrain kind, or none (every floor its palette colour), and
 * the height blend's depth (kept under `1 - heightRange`, so a weight of 0 never shows).
 */
export function wearFloors(
	floors: FloorSurfaces | null,
	cellSize: number,
	depth = SPLAT.depth
): void {
	for (const m of FLOOR_MAPS) maps[m].value = floors?.maps[m] ?? BLANKS[m];
	FLOOR_IDS.forEach((id, i) => (layers.array[i] = (floors?.layers[id] ?? -1) + 1));
	repeat.value.setScalar(1 / (SURFACE_CELLS * cellSize));
	splatUniforms.depth.value = Math.min(depth, 0.99 - SPLAT.heightRange);
}

const loose = (node: unknown) => node as N;
const L = T as unknown as Record<string, (...args: unknown[]) => N>;
const flag = (b: N): N => b.select(1, 0);
const idOf = (texel: N): N => texel.x.mul(255).add(0.5).floor();
const levelOf = (texel: N): N => texel.y.mul(255).add(0.5).floor();
/** Of two (weight, floor) pairs, the heavier, the first on a tie; and the other. */
const heavier = (a: N, b: N): N => a.x.greaterThanEqual(b.x).select(a, b);
const lighter = (a: N, b: N): N => a.x.greaterThanEqual(b.x).select(b, a);

/** The fragment's floor surface, for the terrain kind's graph (built once per variant). */
export interface FloorSurface {
	/** The two floors blended (`FLOOR_IDS` indices, as ints), the heavier first. */
	floors: [N, N];
	/** How much of the second shows, after the height blend. */
	share: N;
	/** Each one's painted surface (rgb, height in a), and whether it has one. */
	albedo: [N, N];
	has: [N, N];
	/** The kerb's strength here, 0-1. */
	kerb: N;
	/** The blended ORM; `own` (the environment's) for a floor without a layer. */
	orm(own: N): N;
	/** The blended view-space normal with the kerb's bevel; `own` for a floor without a layer. */
	normal(own: N): N;
}

export function floorSurface(variant: Variant): FloorSurface {
	const u = cellUniforms as unknown as Record<string, N>;
	const v = splatUniforms as unknown as Record<string, N>;
	const ground = loose(groundTexel);
	const seen = loose(visibilityTexel);
	const n = tsl.normalWorldGeometry;
	// The fragment's cell as groundTexel finds it (a hair inside the surface, so a side reads its
	// own cell), and where in it the fragment lies.
	const inward = tsl.positionWorld.sub(n.mul(u.cellSize.mul(0.01)));
	const c = inward.xz.div(u.cellSize).add(u.gridSize.mul(0.5));
	const cell = c.floor();
	const q = c.sub(cell);
	const toward = L.vec2(
		q.x.greaterThanEqual(0.5).select(1, -1),
		q.y.greaterThanEqual(0.5).select(1, -1)
	);
	const s = q.sub(0.5).abs();
	// Noise moves the point in the world, by nothing at the cells' centre lines (splat-weights.ts).
	let moved = s;
	if (variant.antiTiled) {
		const p = c.mul(v.noiseScale);
		const noise = L.vec2(tsl.mx_noise_float(tsl.vec3(p, 0)), tsl.mx_noise_float(tsl.vec3(p, 17.3)));
		const ramp = L.clamp(s.div(v.reach), 0, 1);
		moved = L.clamp(s.add(toward.mul(noise).mul(v.reach).mul(ramp)), 0, 1);
	}
	const top = n.y.greaterThan(0.5);
	const last = u.gridSize.sub(1);
	const at = (dx: N | number, dy: N | number) =>
		L.ivec2(L.clamp(cell.add(L.vec2(dx, dy)), L.vec2(0, 0), last));
	// Across x, across y, the diagonal: off the table, the cell itself.
	const cellsAt = [at(toward.x, 0), at(0, toward.y), at(toward.x, toward.y)];
	const texels = cellsAt.map((k) => ground.load(k));
	const fO = idOf(ground);
	const lO = levelOf(ground);
	const fs = texels.map(idOf);
	const styleOf = (fl: N): N => loose(styles).element(fl.toInt());
	const allKnown = u.fogOn.lessThan(0.5).or(u.fogMode.greaterThan(0.5));
	// Known and on the fragment's level: a neighbour the splat may look at at all.
	const near = cellsAt.map((k, i) =>
		top.and(allKnown.or(seen.load(k).y.greaterThan(0.5))).and(levelOf(texels[i]).equal(lO))
	);
	const softO = styleOf(fO).lessThan(0.5);
	const joins = near.map((b, i) => flag(b.and(softO).and(styleOf(fs[i]).lessThan(0.5))));
	const [x, y] = [moved.x, moved.y];
	const w = [
		x.oneMinus().mul(y.oneMinus()),
		x.mul(y.oneMinus()).mul(joins[0]),
		x.oneMinus().mul(y).mul(joins[1]),
		x.mul(y).mul(joins[2])
	];
	// Merged per floor, onto the first corner of each.
	const f = [fO, ...fs];
	const eq = (a: N, b: N): N => flag(a.equal(b));
	const merged = w.map((wi, i) => {
		const first = f.slice(0, i).reduce<N>((k, fj) => k.mul(eq(f[i], fj).oneMinus()), L.float(1));
		const sum = w.reduce<N>((acc, wj, j) => (j <= i ? acc : acc.add(eq(f[j], f[i]).mul(wj))), wi);
		return first.mul(sum);
	});
	const pairs = merged.map((m, i) => L.vec2(m, f[i]));
	const [hi1, lo1] = [heavier(pairs[0], pairs[1]), lighter(pairs[0], pairs[1])];
	const [hi2, lo2] = [heavier(pairs[2], pairs[3]), lighter(pairs[2], pairs[3])];
	const best = heavier(hi1, hi2);
	const next = hi1.x.greaterThanEqual(hi2.x).select(heavier(lo1, hi2), heavier(hi1, lo2));
	const a2 = next.x.div(best.x.add(next.x));
	const a1 = a2.oneMinus();
	// Integer variables: an index converted at each use is dropped by r186 in some (a uniform
	// array of vec4, behind a select), so each floor is made an int once.
	const f1 = best.y.toInt().toVar();
	// The one-layer fast path: with no second floor, the second fetch reads the first's layer
	// (a cache hit), since WGSL allows no implicitly derived sample in a per-fragment branch.
	const f2 = a2.greaterThan(0).select(next.y, best.y).toInt().toVar();
	// Both floors' fetches from one box projection (mapping.ts `BoxMapping.on`): one set of
	// coordinates, anti-tiling and gradients, each floor its own layer.
	const [l1, l2] = [f1, f2].map((fl) => loose(layers).element(fl));
	const layerSource = (layer: N) => (slot: string, p: N) =>
		loose(maps[slot as FloorMap])
			.sample(p)
			.depth(layer.sub(1).max(0));
	const box = worldBox(loose(repeat), variant.antiTiled, layerSource(l1));
	const surface = (layer: N, mapping: Mapping) => ({
		has: layer.greaterThan(0.5),
		mapping,
		albedo: mapping.sample('albedo')
	});
	const [one, two] = [surface(l1, box), surface(l2, box.on(layerSource(l2)))];
	// Mishkinis's height blend: the higher surface shows through near an even split.
	const height = (k: typeof one): N =>
		pick(k.has, k.albedo.w, L.float(SPLAT.flatHeight)).mul(SPLAT.heightRange);
	const [p1, p2] = [height(one).add(a1), height(two).add(a2)];
	const ma = L.max(p1, p2).sub(v.depth);
	const [b1, b2] = [L.max(p1.sub(ma), 0), L.max(p2.sub(ma), 0)];
	const share = b2.div(b1.add(b2));
	// The kerb: inside a man-made floor's cell along an edge to a floor it outranks.
	const priority = (fl: N): N => styleOf(fl).mul(16).add(fl);
	const kerbs = (i: 0 | 1): N =>
		flag(
			near[i]
				.and(styleOf(fO).greaterThan(1.5))
				.and(fs[i].notEqual(fO))
				.and(fs[i].notEqual(VOID))
				.and(priority(fO).greaterThan(priority(fs[i])))
		);
	const band = (d: N): N => L.smoothstep(v.kerbWidth.mul(0.6), v.kerbWidth, d).oneMinus();
	const kx = kerbs(0).mul(band(L.float(0.5).sub(s.x)));
	const ky = kerbs(1).mul(band(L.float(0.5).sub(s.y)));
	return {
		floors: [f1, f2],
		share,
		albedo: [one.albedo, two.albedo],
		has: [one.has, two.has],
		kerb: L.max(kx, ky),
		orm: (own) =>
			tsl.mix(
				pick(one.has, one.mapping.sample('orm'), own),
				pick(two.has, two.mapping.sample('orm'), own),
				share
			),
		normal(own) {
			const blended = tsl
				.mix(
					pick(one.has, one.mapping.normal(), own),
					pick(two.has, two.mapping.normal(), own),
					share
				)
				.normalize();
			// The bevel leans the normal toward the edge across the band: a direction in view
			// space, zero away from a kerb (so not normalised on its own).
			const lean = tsl.cameraViewMatrix.mul(tsl.vec4(toward.x.mul(kx), 0, toward.y.mul(ky), 0)).xyz;
			return blended.add(lean.mul(v.kerbBevel)).normalize();
		}
	};
}
