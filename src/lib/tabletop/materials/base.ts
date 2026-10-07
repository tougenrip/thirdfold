// The base kind's graph (#265): token bases, one InstancedMesh of a lathed profile (bases.ts)
// whose uv.y says which band a fragment is on. A glossy black rim and bevel with a clearcoat
// masked to them (so `useClearcoat` is fixed when it is built), the environment's surface on the
// inner disc (the albedo slot, laid on the base's own top, so it never slides as a mini glides),
// and an inset ring in a palette colour: TaleWeaver's recipe, its albedo the colour at 0.31 and
// its emission the colour times the instance's strength, so a hovered or selected ring blooms and
// `worldEmissive` keeps a hidden cell's ring black. Each instance's `aTint` (the instanced kinds'
// own attribute, here x the palette index, y the emission, z the shape flags: 1 notched, 2 double;
// w how far it is see-through) is all that differs between bases, so a hover, a selection, a turn
// or a GM-hidden token is a write to it, never a program: the see-through is a screen-door
// discard, as minis', never `transparent`.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { BANDS, BASE_PALETTE, EMISSION, NEUTRAL, NOTCHES } from '../bases';
import type { Graph, Variant } from './kinds';
import { slotSample } from './hooks';
import { tsl, type N } from './tsl';
import { worldEmissive, worldModify } from './world-modify';

/** Each instance's ring: the instanced kinds' tint attribute, read as above. */
export const BASE_ATTRIBUTE = 'aTint';
/** What shows of a GM-hidden token's base (`aTint.w` 1). */
export const HIDDEN_OPACITY = 0.35;
/** A ring's albedo, as a fraction of its colour (TaleWeaver's 0.311). */
const RING_ALBEDO = 0.31;
/** A notch's glow, as a fraction of the ring's. */
const NOTCH_GLOW = 0.6;
/** The rim's colour and roughness: glossy black. */
const RIM = { color: 0.018, roughness: 0.25 };

/** The ring colours, linear, by `BASE_PALETTE` index: a uniform array, so nothing compiles. */
export const basePalette = T.uniformArray(
	BASE_PALETTE.map((hex) => {
		const c = new THREE.Color(hex);
		return new THREE.Vector4(c.r, c.g, c.b, 1);
	}),
	'vec4'
);

const loose = (node: unknown) => node as N;
const step = (edge: N | number, x: N | number): N => loose(T.step(edge as never, x as never));
const param = (name: string, type: string) => tsl.materialReference(`params.${name}`, type);
const Fn = T.Fn as unknown as (body: () => N) => () => N;
const { Discard, If } = T as unknown as Record<'Discard' | 'If', (...args: unknown[]) => N>;

export function baseGraph(variant: Variant): Graph {
	// A base drawn on its own (the materials' sweep) wears a neutral ring at rest.
	const data = variant.instanced
		? tsl.attribute(BASE_ATTRIBUTE, 'vec4')
		: tsl.vec4(NEUTRAL, EMISSION.rest, 0, 0);
	const double = step(1.5, data.z);
	const notched = step(0.5, data.z.sub(double.mul(2)));
	const opacity = tsl.mix(1, HIDDEN_OPACITY, data.w);
	const colour = loose(basePalette).element(data.x.add(0.5).toInt()).xyz;

	const v = tsl.uv().y;
	const [r0, r1] = BANDS.ring;
	const disc = step(BANDS.disc + 1e-3, v);
	const inRing = step(r0, v).mul(step(v, r1));
	// Two thin rings for 'mine': the band's middle left dark.
	const across = v.sub(r0).div(r1 - r0);
	const middle = step(0.34, across).mul(step(across, 0.66));
	const ring = inRing.mul(tsl.mix(1, middle.oneMinus(), double));
	// An enemy's rim: notches round the lip and bevel, lit in the ring's colour.
	const stripe = step(tsl.uv().x.mul(NOTCHES).fract(), 0.12);
	const notch = notched.mul(stripe).mul(step(v, BANDS.rim));
	const glow = ring.add(notch.mul(NOTCH_GLOW));

	// The disc's surface, laid on the base's own top: one repeat over `1 / params.repeat` cells.
	const top = slotSample('albedo', tsl.positionGeometry.xz.mul(param('repeat', 'vec2')));
	const body = tsl.mix(tsl.vec3(RIM.color), top.xyz.mul(param('color', 'color')), disc);
	const albedo = tsl.mix(body, colour.mul(RING_ALBEDO), tsl.max(ring, notch));
	const emissive = worldEmissive(colour.mul(glow).mul(data.y));
	const lit = worldModify(tsl.output, emissive, true);
	const noise = loose(T.interleavedGradientNoise(T.screenCoordinate.xy));
	const outputNode = Fn(() => {
		If(noise.greaterThanEqual(opacity), () => {
			Discard();
		});
		return lit;
	})();
	return {
		colorNode: tsl.vec4(albedo, 1),
		opacityNode: null,
		alphaTestNode: null,
		positionNode: null,
		castShadowPositionNode: null,
		outputNode,
		lit: {
			roughnessNode: tsl.mix(RIM.roughness, param('roughness', 'float'), disc),
			metalnessNode: param('metalness', 'float'),
			aoNode: loose(T.float(1)),
			normalNode: tsl.normalView,
			emissiveNode: emissive,
			clearcoatNode: param('clearcoat', 'float').mul(disc.oneMinus()),
			clearcoatRoughnessNode: param('clearcoatRoughness', 'float')
		}
	};
}
