// The decal kind's instanced graph (#271): contact shadows, soft dark halos under token bases and
// standing props (contact.ts draws them, one InstancedMesh for all). Each instance is a flat unit
// quad scaled to its halo; its `aTint` (the instanced kinds' own attribute) is x its strength, y
// and z its width and depth in world units, and w how soft its corners are (1 a disc, under 1 a
// rounded rectangle), so every halo is one program. Black, its alpha a falloff from the quad's
// rounded core to its edge times `params.opacity` (the tier's strength): blended over the floor it
// only ever darkens, and `worldModify` puts the fog and the dark on it, so on a hidden cell it is
// black on black. It ignores the lighting: a shadow takes nothing from a torch.

import * as T from 'three/tsl';
import type { Graph } from './kinds';
import { tsl, type N } from './tsl';
import { worldModify } from './world-modify';

/** Each halo: strength, width, depth, corner softness. */
export const CONTACT_ATTRIBUTE = 'aTint';

const loose = (node: unknown) => node as N;
const min = T.min as unknown as (a: N, b: N) => N;
const float = (x: number) => loose(T.float(x));
const param = (name: string, type: string) => tsl.materialReference(`params.${name}`, type);

/** The graph of the decal kind's instanced variant (its plain one stays the kind's own). */
export function contactGraph(): Graph {
	const data = tsl.attribute(CONTACT_ATTRIBUTE, 'vec4');
	const half = data.yz.mul(0.5);
	const p = tsl.uv().sub(0.5).mul(data.yz).abs();
	const radius = tsl.max(min(half.x, half.y).mul(data.w), 1e-4);
	const out = tsl.max(p.sub(half.sub(radius)), tsl.vec2(0)).length();
	const fall = out.div(radius).saturate().oneMinus();
	const alpha = fall.mul(fall).mul(data.x).mul(param('opacity', 'float'));
	return {
		colorNode: tsl.vec4(0, 0, 0, 1),
		opacityNode: alpha,
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode: worldModify(tsl.vec4(0, 0, 0, tsl.output.w), tsl.vec3(0), true),
		lit: {
			roughnessNode: float(1),
			metalnessNode: float(0),
			aoNode: float(1),
			normalNode: tsl.normalView,
			emissiveNode: tsl.vec3(0),
			clearcoatNode: null,
			clearcoatRoughnessNode: null
		}
	};
}
