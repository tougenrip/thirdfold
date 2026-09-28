// The places later looks attach to the kinds' graphs (#169), each the identity (or today's
// behaviour) until its issue lands. They are called while a kind's graph is built, once, so
// whatever they return is part of that graph for good: no runtime value may choose between
// branches here, only uniforms and slots may vary.
//
// - `surfaceUV`: #177's mapping (box projection for walls and ground, object space for door
//   panels, triplanar for rock). Today every kind reads the mesh's uv, repeated per material.
// - `slotSample`: #179's sampler settings (the `uMipBias` with TRAA on high). A plain sample.
// - `paintNormal`, `paintRoughness`: #178's paint noise on props and minis. Unpainted.

import type { SlotName } from './defaults';
import { slotDefault, slotProperty } from './defaults';
import type { ShaderKind } from './kinds';
import { tsl, type N } from './tsl';

/**
 * Where a kind samples its slots, times the material's `repeat`: the mesh's uv, except on props
 * and minis, whose models carry no uv and whose paint (#178) sits in object space.
 */
export const surfaceUV = (kind: ShaderKind, repeat: N): N =>
	(kind === 'prop' || kind === 'mini' ? tsl.positionGeometry.xz : tsl.uv()).mul(repeat);

/**
 * A slot's texture sampled at `at`: one node per slot and graph, a `materialReference` to the
 * drawn material's `<slot>Slot`, so every material of a kind shares the node and its program.
 * Its texture node samples at `at`, never through the texture's own matrix, which r186 snapshots
 * from the first texture it sees (hence `repeat`). Not `texture().onObjectUpdate`: TextureNode's
 * setup resets its update type, so on WebGPU (no flip-Y uniform) the update would never run.
 */
export function slotSample(slot: SlotName, at: N): N {
	const ref = tsl.materialReference(slotProperty(slot), 'texture') as N & { node: unknown };
	// The reference's own texture node, made here (it would make one without `at`): sampled at
	// `at`, and without the texture matrix a node given no uv applies.
	ref.node = tsl.texture(slotDefault(slot), at).setUpdateMatrix(false);
	return ref;
}

/** The view-space normal after paint noise. Unpainted until #178. */
export const paintNormal = (kind: ShaderKind, normal: N): N => normal;

/** Roughness after paint gloss. Unpainted until #178. */
export const paintRoughness = (kind: ShaderKind, roughness: N): N => roughness;
