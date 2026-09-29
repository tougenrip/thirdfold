// How a kind's slots are laid on its surface (#177), the graphs behind hooks.ts's `surfaceMapping`:
// the mesh's uv, a box projection from world position (walls and raised ground: textures run on
// across instances and heights), the same in the geometry's own space (door panels, which swing,
// so their texture must not slide), or triplanar (rock). Each is fixed when the graph is built;
// the tile size is always `params.repeat`, a uniform, so changing it compiles nothing.

import type { SlotName } from './defaults';
import { slotSample } from './hooks';
import { tsl, type N } from './tsl';
import { antiTile } from './variation';

/** A kind's slots as laid on its surface. */
export interface Mapping {
	/** A slot's texture (rgba) where the fragment lies. */
	sample(slot: SlotName): N;
	/** The view-space normal with the normal slot applied. */
	normal(): N;
}

/**
 * The tangent frame screen-space derivatives of `at` make over `normal` (Schüler, "Normal mapping
 * without precomputed tangents"), as three's own frame does with the mesh's uv, so meshes without
 * tangents warn about nothing. It holds under any instance transform, since both the derivatives
 * and `positionView` include it. Shared with the paint's object-space triplanar (paint.ts).
 */
export function derivativeFrame(at: N, normal: N): { T: N; B: N } {
	const q1perp = tsl.positionView.dFdy().cross(normal);
	const q0perp = normal.cross(tsl.positionView.dFdx());
	const st0 = at.dFdx();
	const st1 = at.dFdy();
	const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
	const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
	const det = tsl.max(T.dot(T), B.dot(B));
	const scale = det.equal(0).select(0, det.inverseSqrt());
	return { T: T.mul(scale), B: B.mul(scale) };
}

/** Tangent-space normal mapping in the derivative frame of the coordinates sampled at. */
function perturbNormal(sampled: N, at: N): N {
	const n = sampled.mul(2).sub(1);
	const normal = tsl.normalView;
	const { T, B } = derivativeFrame(at, normal);
	return T.mul(n.x).add(B.mul(n.y)).add(normal.mul(n.z)).normalize();
}

/** Slots sampled at `at` (the mesh's uv, times the tile). */
export function uvMapping(at: N): Mapping {
	return {
		sample: (slot) => slotSample(slot, at),
		normal: () => perturbNormal(slotSample('normal', at).xyz, at)
	};
}

/** 1 or -1 by a component's sign; never 0, so a face always has a direction. */
const signOf = (v: N) => v.greaterThanEqual(0).select(1, -1);

/**
 * Box projection (#177): the face is the normal's largest axis (tiling.ts `dominantAxis`, the
 * same ties), and the coordinates are the other two, u flipped by the face's sign so opposite
 * faces don't mirror and v up the world on sides. Sides repeat `repeat.x` across and `repeat.y`
 * up (tiling.ts `repeatFor`), tops `repeat.x` both ways. Each face has a constant tangent frame,
 * so normal maps need no tangents; `toView` takes the perturbed normal from the input's space.
 * With `antiTiled` (#181, terrain on medium and up) each slot is fetched twice, at the pattern's
 * two offsets `antiTile` picks, with the coordinates' own gradients, and blended: the offsets
 * are translations, so the tangent frame holds.
 */
export function boxMapping(
	position: N,
	geometric: N,
	repeat: N,
	toView: (n: N) => N,
	antiTiled = false
): Mapping {
	const p = tsl.vec3(position);
	const n = tsl.vec3(geometric).normalize();
	const a = n.abs();
	const onX = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
	const onY = onX.not().and(a.y.greaterThanEqual(a.z));
	const [sx, sy, sz] = [signOf(n.x), signOf(n.y), signOf(n.z)];
	const side = (u: N) => tsl.vec2(u.mul(repeat.x), p.y.mul(repeat.y));
	const at = onX.select(
		side(p.z.mul(sx).negate()),
		onY.select(tsl.vec2(p.x, p.z.mul(sy).negate()).mul(repeat.x), side(p.x.mul(sz)))
	);
	const tangent = onX.select(tsl.vec3(0, 0, sx.negate()), tsl.vec3(onY.select(1, sz), 0, 0));
	const bitangent = onY.select(tsl.vec3(0, 0, sy.negate()), tsl.vec3(0, 1, 0));
	const tiles = antiTiled ? antiTile(at) : null;
	const fetch = (slot: SlotName): N => {
		if (!tiles) return slotSample(slot, at);
		const a = slotSample(slot, at.add(tiles.a)) as N & { node: N & { gradNode: N[] } };
		a.node.gradNode = [at.dFdx(), at.dFdy()];
		// A clone of the same texture node, so both fetches bind the slot once (TextureNode.sample).
		return tsl.mix(a, a.node.sample(at.add(tiles.b)), tiles.blend);
	};
	return {
		sample: fetch,
		normal() {
			const t = fetch('normal').xyz.mul(2).sub(1);
			return toView(tangent.mul(t.x).add(bitangent.mul(t.y)).add(n.mul(t.z))).normalize();
		}
	};
}

/** Box projection in world space: walls and raised ground, continuous across instances. */
export const worldBox = (repeat: N, antiTiled = false): Mapping =>
	boxMapping(
		tsl.positionWorld,
		tsl.normalWorldGeometry,
		repeat,
		(n) => n.transformDirection(tsl.cameraViewMatrix),
		antiTiled
	);

/** Box projection in the geometry's own space: a door panel's texture swings with it. */
export const localBox = (repeat: N): Mapping =>
	boxMapping(tsl.positionGeometry, tsl.normalGeometry, repeat, (n) => tsl.transformNormalToView(n));

/**
 * How sharply triplanar blends between its three projections: weights are |n| to this power,
 * normalised. A uniform, so tuning it compiles nothing.
 */
export const triplanarSharpness = tsl.uniform(4);

/**
 * Triplanar mapping (#177) in world space, for rock: three projections (x on zy, y on xz, z on
 * xy) weighted by `pow(|n|, triplanarSharpness)`, `repeat.x` per world unit. The three fetches
 * of a slot are one reference and two `.sample()` clones of its texture node, which keep a
 * `referenceNode` to it, so a new texture in the slot reaches all three and binds once. Normal
 * maps blend by Whiteout (Golus, "Normal Mapping for a Triplanar Shader").
 */
export function triplanar(repeat: N): Mapping {
	const p = tsl.positionWorld.mul(repeat.x);
	const n = tsl.normalWorldGeometry.normalize();
	const raw = n.abs().pow(tsl.vec3(triplanarSharpness));
	const w = raw.div(raw.x.add(raw.y).add(raw.z));
	const uvs = [p.zy, p.xz, p.xy];
	const three = (slot: SlotName): [N, N, N] => {
		const ref = slotSample(slot, uvs[0]) as N & { node: N };
		return [ref, ref.node.sample(uvs[1]), ref.node.sample(uvs[2])];
	};
	return {
		sample(slot) {
			const [x, y, z] = three(slot);
			return x.mul(w.x).add(y.mul(w.y)).add(z.mul(w.z));
		},
		normal() {
			const [x, y, z] = three('normal').map((s) => s.xyz.mul(2).sub(1));
			// Whiteout: each projection's tangent normal added to the surface normal's matching
			// components, then swizzled back to world axes.
			const tx = tsl.vec3(x.xy.add(n.zy), x.z.abs().mul(n.x));
			const ty = tsl.vec3(y.xy.add(n.xz), y.z.abs().mul(n.y));
			const tz = tsl.vec3(z.xy.add(n.xy), z.z.abs().mul(n.z));
			const world = tx.zyx.mul(w.x).add(ty.xzy.mul(w.y)).add(tz.xyz.mul(w.z)).normalize();
			return world.transformDirection(tsl.cameraViewMatrix);
		}
	};
}
