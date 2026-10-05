// Against coplanar flicker and visible tiling (#181): the micro-offset that lifts prop and decal
// instances off what they lie on (lift.ts works out each instance's share), the low-frequency
// macro variation of tint and roughness on the tiled kinds, and the noise index iq's two-fetch
// anti-tiling picks its offsets by (mapping.ts). All ALU on uniforms and attributes, so strengths
// and scales change without a program; only the anti-tiling is a graph of its own (a variant).

import type { ShaderKind } from './kinds';
import { tsl, type N } from './tsl';

/**
 * The per-instance lift an instanced prop, decal or water reads: x in [0, 1) of `params.lift`, and
 * y its drop-in's start (#249; `dropLift`): one vertex buffer for both, since WebGPU allows 8 and a
 * prop's pipeline is at that.
 */
export const LIFT_ATTRIBUTE = 'aLift';

/**
 * The kinds that lie on other surfaces and are lifted off them: props and decals, and water, whose
 * sheets (the Hollow's lake) lie on floors as props do.
 */
export const LIFTED: readonly ShaderKind[] = ['prop', 'decal', 'water'];

/** The tiled kinds that get macro variation. */
export const VARIED: readonly ShaderKind[] = ['surface', 'terrain', 'rock'];

/**
 * An instance's position lifted along its normal by `aLift` times `unit` (`params.lift`, a
 * thousandth of a cell in world units). After instancing, `positionLocal` and `normalLocal` are
 * already the instance's (NodeMaterial.setupPosition runs `positionNode` last).
 */
export const lifted = (unit: N): N =>
	tsl.positionLocal.add(
		tsl.normalLocal.normalize().mul(tsl.attribute(LIFT_ATTRIBUTE, 'vec2').x).mul(unit)
	);

/**
 * Macro variation, 0 to 1: MaterialX fractal noise of the world's xz times `scale` (per world
 * unit), so it spans many texture repeats and walls share it with the ground at their feet.
 */
export const macroOf = (scale: N): N =>
	tsl
		.mx_fractal_noise_float(tsl.vec3(tsl.positionWorld.x, tsl.positionWorld.z, 0).mul(scale))
		.mul(0.5)
		.add(0.5)
		.saturate();

/** Albedo times `1 ± tint` by the macro value: 0 leaves it as it is. */
export const macroTint = (macro: N, tint: N): N => macro.mul(2).sub(1).mul(tint).add(1);

/** Roughness moved by up to ± `shift` by the macro value, kept in [0, 1]. */
export const macroRoughness = (roughness: N, macro: N, shift: N): N =>
	roughness.add(macro.mul(2).sub(1).mul(shift)).saturate();

/** How many texture repeats one step of the anti-tiling index spans, about. */
const INDEX_SCALE = 0.15;

/**
 * iq's cheapest anti-tiling ("Texture repetition", technique 3): a low-frequency noise of the
 * coordinates chooses between offset copies of the pattern, index `i` and `i + 1`, blended by
 * `f`. Returns the two offsets and the blend; mapping.ts samples each slot at both with the
 * coordinates' own gradients, since the offsets jump where the index does.
 */
export function antiTile(at: N): { a: N; b: N; blend: N } {
	const index = tsl
		.mx_noise_float(tsl.vec3(at.mul(INDEX_SCALE), 0))
		.mul(0.5)
		.add(0.5)
		.mul(8);
	const i = index.floor();
	const offset = (k: N) => tsl.sin(tsl.vec2(3, 7).mul(k));
	return { a: offset(i), b: offset(i.add(1)), blend: tsl.smoothstep(0.2, 0.8, index.fract()) };
}
