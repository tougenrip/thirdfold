// Ambient occlusion (milestone 63, #159), from the prepass's depth and normals,
// fed to the scene pass's materials through `builtinAOContext`: it darkens
// indirect light only (the hemisphere), so creases and the ground under things
// darken while faces lit by torches, lamps and the sun keep their light.
// Medium draws SSAO (self-denoised) at half resolution; high draws GTAO at half
// resolution with temporal filtering, which TRAA resolves, and ultra the same
// at full resolution (`aoKind` in quality.ts). Every knob is a uniform, so an
// environment or a tier within the same kind writes uniforms only; GTAO's
// `samples` is compiled in, so it stays at its default.

import * as THREE from 'three/webgpu';
import { builtinAOContext, float, mix, sample, screenUV, unpackRGBToNormal } from 'three/tsl';
import { ssao } from 'three/examples/jsm/tsl/display/SSAONode.js';
import GTAONode from 'three/examples/jsm/tsl/display/GTAONode.js';
import type { Tier } from './quality';

/** Ambient occlusion's reach and depth per environment, in cells; unlisted ones get `default`. */
const AO_LOOKS: Record<string, { radius: number; intensity: number }> = {
	default: { radius: 0.5, intensity: 1 },
	// Open streets: a wider, softer darkening along walls and under eaves.
	village: { radius: 0.8, intensity: 0.9 },
	// Tight rock: crevices and the ground under things.
	cavern: { radius: 0.35, intensity: 1.2 },
	'living-cave': { radius: 0.35, intensity: 1.2 }
};

/**
 * GTAO, drawn only once set up: the scene pass draws it first (passes.ts), before its own
 * materials, whose AO context sets it up, are built; r186's GTAONode would draw without a shader.
 * Its first frame is left out, and TRAA's converge frames draw over it.
 */
class Gtao extends GTAONode {
	updateBefore(frame: THREE.NodeFrame) {
		if ((this as unknown as { _ao: unknown })._ao) return super.updateBefore(frame);
	}
}

export type AoNode = ReturnType<typeof ssao> | GTAONode;

/**
 * Builds the AO over the prepass and puts it into the scene pass's materials at `strength`: at 0
 * the context is exactly 1 (and the gate stops the AO's passes), kept for the pipeline's lifetime.
 */
export function buildAo(
	kind: 'ssao' | 'gtao',
	prepass: THREE.PassNode,
	scenePass: THREE.PassNode,
	camera: THREE.Camera,
	strength: THREE.Node<'float'>
): AoNode {
	const normals = prepass.getTextureNode('output');
	const normal = sample((uv) => unpackRGBToNormal(normals.sample(uv).rgb));
	const depth = prepass.getTextureNode('depth');
	const node = kind === 'gtao' ? new Gtao(depth, normal, camera) : ssao(depth, normal, camera);
	// A new rotation each frame, averaged by TRAA's history (GTAO is built only with TRAA).
	if ('useTemporalFiltering' in node) node.useTemporalFiltering = true;
	const occlusion = mix(float(1), node.getTextureNode().sample(screenUV).r, strength);
	scenePass.contextNode = builtinAOContext(occlusion);
	return node;
}

/** The AO's resolution for a tier: full on ultra, half below. */
export const aoScale = (tier: Tier) => (tier === 'ultra' ? 1 : 0.5);

/** Sizes the AO for a table: its environment's reach, in cells of `cellSize` world units. */
export function sizeAo(node: AoNode, environment: string | null, cellSize: number): void {
	const look = AO_LOOKS[environment ?? ''] ?? AO_LOOKS.default;
	const radius = look.radius * cellSize;
	node.radius.value = radius;
	if ('intensity' in node) {
		node.intensity.value = look.intensity;
		return;
	}
	// GTAO darkens by a power; it ignores what lies further in front or behind than `thickness`.
	node.scale.value = look.intensity;
	node.thickness.value = radius * 2;
}
