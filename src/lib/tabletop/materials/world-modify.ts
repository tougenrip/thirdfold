// Where the world changes a surface (#169, #171): every kind ends in `worldModify`, and its
// emissive goes through `worldEmissive` first. From the cell maps (cell-maps.ts) and their
// uniforms: fog of war (a player's hidden cells exactly black, explored ones dim, desaturated
// and cool; the GM's a light tint where the party can't see), darkness by the rules' light level
// with the perception fill on a player's visible cells, the flash, emissive dimmed under fog (so
// the emissive the MRT reads is too, #160), and the cut height's discard. Nothing here is a
// literal that runtime state picks: fog on or off, player or GM, the ambient, the flash and the
// cut are uniforms, and the maps' textures are swapped under their nodes, so no change compiles
// a program. Since #173 this is all the fog and darkness there is (the overlay planes are gone):
// `inWorld` puts it on the few materials that are not kinds (fixtures, flames, mist),
// `worldShade` fades the grid lines by it, and `worldHidden` is what the scene pass writes for
// the output stage to re-mask hidden cells after bloom, the lens and depth of field spread light
// over them (post.ts). Since #174 the fog's edges are soft and reveals fade (fog-soft.ts has the
// pure mirrors): both only ever darken, so a hidden cell's centre stays exactly 0 and `worldHidden`
// follows the soft edge. Since #219 the sky's light reads the same map: `skySun` and `skyAmbient`
// (sky-light.ts puts them on the key light and the hemisphere, atmosphere.ts on the IBL) keep the
// sun and the sky out of dark areas and the sun out from under roofs.

import type * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import {
	FLASH_THINS,
	cellUniforms,
	faceCell,
	groundFlat,
	groundTexel,
	onGrid,
	visibilitySmooth,
	visibilityTexel
} from '../cell-maps';
import { tsl, type N } from './tsl';

const loose = (node: unknown) => node as N;
type Loose = (...args: unknown[]) => N;
// Loosely typed, as tsl.ts does for the kinds (its reasons hold here).
const {
	Discard,
	If,
	float,
	luminance,
	min,
	mix,
	mx_noise_float,
	output,
	positionWorld,
	smoothstep
} = T as unknown as Record<
	| 'Discard'
	| 'If'
	| 'float'
	| 'luminance'
	| 'min'
	| 'mix'
	| 'mx_noise_float'
	| 'output'
	| 'positionWorld'
	| 'smoothstep',
	Loose
>;
const Fn = T.Fn as unknown as (body: () => N) => () => N;
const { max, vec3, vec4 } = tsl;
const u = cellUniforms as unknown as Record<keyof typeof cellUniforms, N>;

interface World {
	/** How much of the surface the fog lets through: 1 visible, 0 a player's hidden cell. */
	fog: N;
	/** How far the unseen tint applies: a player's explored cells, the GM's unseen ones. */
	unseen: N;
	/** How lit the cell is: 1 lit, down to 1 - the ambient's darkness. */
	light: N;
	/** The colour the dark takes there: the band's, a dark area's night (#167). */
	darkTint: N;
}

const worlds = new Map<boolean, World>();
let sky: { notDark: N; ambient: N; sun: N } | null = null;

/**
 * Sky visibility at the fragment (#219, cell-maps.ts `skyVisibilityMap`): the linear sample,
 * bounded by the cell's own value, so a dark cell reads exactly 0 and a roof never more than its
 * fill, while open ground softens toward them (never below the fill). The ambient term is that,
 * the sun's is what lies above the fill; the flash lifts both toward the open sky, and off the
 * grid both are 1. Built once, shared.
 */
function skyTerms() {
	if (sky) return sky;
	const [texel, smooth] = [loose(visibilityTexel), loose(visibilitySmooth)];
	const open = min(texel.w, max(smooth.w, u.indoorFill));
	const lift = (k: N) => mix(float(1), mix(k, float(1), u.flashLift), loose(onGrid));
	const sun = loose(open.sub(u.indoorFill).div(u.indoorFill.oneMinus())).saturate();
	sky = {
		notDark: loose(open.div(u.indoorFill)).saturate(),
		ambient: lift(open),
		sun: lift(sun)
	};
	return sky;
}

/** How much of the sun reaches the fragment: 0 in a dark area or under a roof, 1 in the open. */
export const skySun = (): N => skyTerms().sun;
/** How much of the sky's ambient light (hemisphere, IBL) reaches it: 0 dark, the fill indoors. */
export const skyAmbient = (): N => skyTerms().ambient;

/**
 * The per-fragment terms, built once and shared by every kind's graph. With `face` (the rock
 * kind's cliffs and risers, #241) the cell is looked up a hundredth of a cell behind the surface
 * (`faceCell`), so a face shades with the cell that owns it, not the one it looks onto.
 */
function terms(face = false): World {
	const built = worlds.get(face);
	if (built) return built;
	const texel = face ? loose(visibilityTexel).load(loose(faceCell)) : loose(visibilityTexel);
	const smooth = loose(visibilitySmooth);
	const { notDark } = skyTerms();
	const [visible, explored] = [texel.x, texel.y];
	const shown = loose(onGrid);
	const fogged = shown.mul(u.fogOn);
	/** The fog factor for a cell visible and explored this far (0-1 each). */
	const levelOf = (seen: N, known: N): N => {
		const player = mix(float(0), u.exploredLevel, known);
		const gm = mix(u.gmHiddenLevel, u.gmExploredLevel, known);
		return mix(float(1), mix(mix(player, gm, u.fogMode), float(1), seen), fogged);
	};
	// Soft edges (#174): the linear samples pulled through a band that noise pushes inward, never
	// above the hard factor. 0 on the line between cells, whatever the noise, so the edge is
	// continuous; at a known cell's centre the sample is the cell's own 1, past the band's reach.
	const at = loose(positionWorld).xz.div(u.cellSize).mul(u.edgeScale);
	const noise = mx_noise_float(at).mul(0.5).add(0.5).saturate().mul(u.edgeNoise);
	const shape = (x: N) => smoothstep(float(0.5), u.edgeBand.add(0.5), x.sub(noise));
	const current = min(levelOf(visible, explored), levelOf(shape(smooth.x), shape(smooth.y)));
	// Reveal fades (#174): from the state a newly visible cell came from, `remaining` of the way.
	const fade = loose(face ? groundTexel : groundFlat);
	const [remaining, from] = [fade.z, levelOf(float(0), fade.w)];
	const fog = min(current, mix(current, from, remaining));
	const seen = visible.mul(remaining.oneMinus());
	const unseen = fogged.mul(seen.oneMinus()).mul(mix(explored, float(1), u.fogMode));
	// Today's overlay (lighting.ts): a fogged player's visible cells are lit at least the fill.
	const fill = seen.mul(u.perceptionFill).mul(fogged).mul(u.fogMode.oneMinus());
	const level = max(smooth.z, fill);
	const shade = mix(max(u.ambientDark, u.nightDark), u.ambientDark, notDark);
	const dark = loose(shade).mul(loose(level).oneMinus());
	const lit = dark.oneMinus();
	const flashed = mix(lit, float(1), u.flash.mul(FLASH_THINS));
	const light = mix(float(1), flashed, shown);
	const darkTint = loose(mix(u.nightTint, u.darkTint, notDark));
	const world = { fog: loose(fog), unseen, light: loose(light), darkTint };
	worlds.set(face, world);
	return world;
}

/** The unseen tint on a colour: desaturated and cool for a player, the GM's own for the GM. */
function tinted(rgb: N, unseen: N): N {
	const grey = vec3(luminance(rgb));
	const cool = loose(mix(rgb, grey, u.exploredDesaturate)).mul(u.exploredTint);
	const marked = loose(mix(cool, rgb.mul(u.gmTint), u.fogMode));
	return loose(mix(rgb, marked, unseen));
}

/** A surface's authored emissive as the world lets it glow: dimmed by the fog, 0 where hidden. */
export const worldEmissive = (emissive: N, face = false): N => emissive.mul(terms(face).fog);

/**
 * How lit the fragment's cell is by the rules (1 lit, down to 1 - the ambient's darkness): what
 * the lit kinds' lighting model scales their indirect light by and `SkyLightNode` their key light
 * (materials/lighting-model.ts, #228), so their point lights are not dimmed twice.
 */
export const worldLight = (): N => terms().light;

/**
 * A surface's lit colour (`output`, haze included) as the viewer sees it, given the emissive
 * already in it (from `worldEmissive`): the rest goes toward the dark's tint by the darkness and
 * is fogged, the emissive kept, so `((output - emissive) x light + tint x (1 - light)) x fog +
 * emissive`. Hidden cells come out exactly 0, haze and all. With `lit` (the lit kinds, whose
 * lighting model already scaled the sky's light by `worldLight`) the light factor is not applied
 * again: only the dark's tint is added. With `face` the fog, the unseen tint and the reveal fades
 * are the cell's behind the surface (`terms`): the rock kind's cliffs and risers (#241).
 */
export function worldModify(output: N, emissive: N, lit = false, face = false): N {
	const { fog, unseen, light: factor, darkTint } = terms(face);
	const light = lit ? float(1) : factor;
	const kept = light.mul(fog);
	const tint = darkTint.mul(factor.oneMinus());
	const darkened = tinted(output.xyz, unseen).mul(light).add(tint);
	// Memory doesn't brighten with the exposure lift (#233): unseen cells divided by `2^lift`.
	const memory = mix(float(1), u.memoryGain, unseen);
	const rgb = darkened.mul(fog).add(emissive.mul(kept.oneMinus())).mul(memory);
	const above = loose(positionWorld).y.greaterThan(u.cutY);
	return Fn(() => {
		If(above, () => {
			Discard();
		});
		return vec4(rgb, output.w);
	})();
}

/** How much of a surface shows in its cell, light times fog: the grid lines fade by it. */
export const worldShade = (): N => terms().light.mul(terms().fog);

/** How much the fog lets through (1 visible, exactly 0 on a player's hidden cell): the shader grid's (#245). */
export const worldFog = (): N => terms().fog;

/**
 * 1 where a player's fog hides the fragment's cell, else 0: the scene pass's `hidden` attachment
 * (post.ts), which the output stage turns back to black after everything that spreads light.
 */
export const worldHidden = (): N => float(terms().fog.lessThan(1 / 1024));

/**
 * Puts the world on a material that is not a kind (a fixture's post, a flame, the mist):
 * `worldModify` last, and `glow` (if any) as its emissive through `worldEmissive`. Once, when made.
 */
export function inWorld<M extends THREE.NodeMaterial>(material: M, glow: unknown = null): M {
	const emissive = glow ? worldEmissive(loose(glow)) : vec3(0);
	const nodes = material as unknown as Record<string, unknown>;
	if (glow) nodes.emissiveNode = emissive;
	nodes.outputNode = worldModify(loose(output), emissive);
	return material;
}
