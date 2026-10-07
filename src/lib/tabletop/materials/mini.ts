// The miniature kind's look (#267): every figure reads as a painted miniature. Over the albedo
// (vertex colours, or a cooked mini's texture) and the token's tint go a darker wash in the
// cavities (the bake's occlusion, and ORM red on a textured mini), a lighter drybrush on convex
// edges (the bake's convexity; a textured mini paints its own), a clearcoat varnish and a fresnel
// rim that keeps silhouettes apart from the floor at night. Exactly two programs for the figures:
// vertex-coloured (part lists, accents, the placeholder) and textured (`vertexColors` off), one
// graph between them (`ByColours`). Every value is a uniform shared by every mini (`miniLook`), so
// tuning it, the tier taking the varnish off, the hour or a hover compiles nothing. The rim is an
// emissive, so `worldModify` fogs it like any glow, and it is multiplied by the cell's light level
// where the rules keep the dark (night, or a dark area): it outlines only what the viewer may
// already see, never an unlit mini.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { BAKE_ATTRIBUTE, PAINT_ATTRIBUTE, TINT_ATTRIBUTE, type Variant } from './kinds';
import { tsl, type N } from './tsl';
import { worldRim } from './world-modify';

const loose = (node: unknown) => node as N;

/** The miniatures' tuning, one set for every mini (docs/ART.md, "Painted miniatures"). */
export const miniLook = {
	/** The wash's colour at full occlusion: albedo times `mix(1, washDark, 1 - ao)`. */
	washDark: T.uniform(0.55),
	/** How much lighter the drybrush leaves the most convex edges: albedo times `1 + edgeLight`. */
	edgeLight: T.uniform(0.35),
	/** The varnish (clearcoat) on or off by tier: 0 on low, its lobe still compiled. */
	varnish: T.uniform(1),
	/** How tightly the rim hugs the silhouette (the fresnel's power). */
	rimPower: T.uniform(3),
	/** The rim's strength by day and at night (or in a dark area), and its colour each way (linear). */
	rimDay: T.uniform(0.04),
	rimNight: T.uniform(0.35),
	rimDayColour: T.uniform(new THREE.Color(1, 0.92, 0.8)),
	rimNightColour: T.uniform(new THREE.Color(0.45, 0.6, 1)),
	/** How much a hovered or selected mini's rim grows, by its tint's strength (`aTint.w`). */
	hoverRim: T.uniform(1)
};
const look = miniLook as unknown as Record<keyof typeof miniLook, N>;

/** An instanced mini's paint: rgb its tint, w its opacity (#266's batches). */
export const miniPaint = (): N => tsl.attribute(PAINT_ATTRIBUTE, 'vec4');

/**
 * `part` for a vertex-coloured mini's program, `textured` for a textured one's: picked as each
 * material's program is built, by its `vertexColors` (which three's own colour multiply already
 * keys programs by), so both share one graph and no variant is added for the warm-ups to make.
 */
class ByColours extends THREE.Node {
	constructor(
		private readonly part: N,
		private readonly textured: N
	) {
		super('vec4');
	}

	setup(builder: THREE.NodeBuilder) {
		const coloured = (builder.material as { vertexColors?: boolean } | null)?.vertexColors;
		return (coloured ? this.part : this.textured) as unknown as THREE.Node;
	}
}

/**
 * A mini's albedo from its sampled albedo slot, its material's colour, its tint (the token's colour
 * on accents, placeholders and textured minis, white on vertex-coloured bodies) and its ORM: tinted,
 * then washed and, on a vertex-coloured mini, drybrushed. Vertex colours are multiplied in after
 * this by three, which a multiplicative wash and drybrush don't mind.
 */
export function miniAlbedo(albedo: N, colour: N, tint: N, orm: N): N {
	const bake = tsl.attribute(BAKE_ATTRIBUTE, 'vec2');
	const base = albedo.xyz.mul(colour);
	const wash = tsl.mix(1, look.washDark, orm.x.mul(bake.x).oneMinus());
	// Both made here, with the graph, never while a program builds.
	// Convexity is 0.5 on flat ground (and on an unbaked model, `withBake`), above it an edge.
	const edge = bake.y.sub(0.5).mul(2).saturate();
	const part = tsl.vec4(base.mul(tint).mul(wash).mul(edge.mul(look.edgeLight).add(1)), albedo.w);
	// Textured: toward the tint at the base's own luminance, where ORM alpha masks it (cloak trim,
	// shield face; docs/ART.md); its painted edge highlights are in the albedo.
	const lum = (rgb: N) => loose(T.luminance(rgb as never));
	const toward = tint.mul(lum(base).div(tsl.max(lum(tint), 1e-3))).min(1);
	const textured = tsl.vec4(tsl.mix(base, toward, orm.w).mul(wash), albedo.w);
	return loose(new ByColours(part, textured));
}

/** The rim, an emissive: fresnel, by the hour and the dark, gated by the rules' light. */
export function miniRim(variant: Variant): N {
	const facing = loose(T.normalView)
		.dot(loose(T.positionViewDirection))
		.saturate()
		.oneMinus()
		.pow(look.rimPower);
	const { night, lit } = worldRim();
	const hover = variant.instanced
		? tsl.attribute(TINT_ATTRIBUTE, 'vec4').w.mul(look.hoverRim).add(1)
		: 1;
	const strength = tsl.mix(look.rimDay, look.rimNight, night).mul(hover);
	return tsl.mix(look.rimDayColour, look.rimNightColour, night).mul(strength.mul(facing).mul(lit));
}

/** The varnish: the material's clearcoat, off on the low tier. */
export const miniClearcoat = (clearcoat: N): N => clearcoat.mul(look.varnish);
