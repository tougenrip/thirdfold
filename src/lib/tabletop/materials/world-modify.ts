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
// over them (post.ts). Soft edges and reveal fades are #174's.

import type * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLASH_THINS, cellUniforms, onGrid, visibilitySmooth, visibilityTexel } from '../cell-maps';
import { tsl, type N } from './tsl';

const loose = (node: unknown) => node as N;
type Loose = (...args: unknown[]) => N;
// Loosely typed, as tsl.ts does for the kinds (its reasons hold here).
const { Discard, If, float, luminance, mix, output, positionWorld } = T as unknown as Record<
	'Discard' | 'If' | 'float' | 'luminance' | 'mix' | 'output' | 'positionWorld',
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
}

let world: World | null = null;

/** The per-fragment terms, built once and shared by every kind's graph. */
function terms(): World {
	if (world) return world;
	const texel = loose(visibilityTexel);
	const smooth = loose(visibilitySmooth);
	const [visible, explored] = [texel.x, texel.y];
	const shown = loose(onGrid);
	const fogged = shown.mul(u.fogOn);
	const player = mix(float(0), u.exploredLevel, explored);
	const gm = mix(u.gmHiddenLevel, u.gmExploredLevel, explored);
	const unseenLevel = loose(mix(player, gm, u.fogMode));
	const fog = mix(float(1), mix(unseenLevel, float(1), visible), fogged);
	const unseen = fogged.mul(visible.oneMinus()).mul(mix(explored, float(1), u.fogMode));
	// Today's overlay (lighting.ts): a fogged player's visible cells are lit at least the fill.
	const fill = visible.mul(u.perceptionFill).mul(fogged).mul(u.fogMode.oneMinus());
	const level = max(smooth.z, fill);
	const shade = mix(max(u.ambientDark, u.nightDark), u.ambientDark, smooth.w);
	const dark = loose(shade).mul(loose(level).oneMinus());
	const lit = dark.oneMinus();
	const flashed = mix(lit, float(1), u.flash.mul(FLASH_THINS));
	const light = mix(float(1), flashed, shown);
	world = { fog: loose(fog), unseen, light: loose(light) };
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
export const worldEmissive = (emissive: N): N => emissive.mul(terms().fog);

/**
 * A surface's lit colour (`output`, haze included) as the viewer sees it, given the emissive
 * already in it (from `worldEmissive`): the rest is darkened and fogged, the emissive kept, so
 * `(output - emissive) x light x fog + emissive`. Hidden cells come out exactly 0, haze and all.
 */
export function worldModify(output: N, emissive: N): N {
	const { fog, unseen, light } = terms();
	const kept = light.mul(fog);
	const rgb = tinted(output.xyz, unseen).mul(kept).add(emissive.mul(kept.oneMinus()));
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
