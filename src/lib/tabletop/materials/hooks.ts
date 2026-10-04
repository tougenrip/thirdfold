// The places later looks attach to the kinds' graphs (#169), each the identity (or today's
// behaviour) until its issue lands. They are called while a kind's graph is built, once, so
// whatever they return is part of that graph for good: no runtime value may choose between
// branches here, only uniforms and slots may vary.
//
// - `surfaceMapping`: where a kind's slots lie (#177, mapping.ts): box projection from world
//   position on the surface and terrain kinds, the geometry's own space for a `local` material
//   (door panels), triplanar on rock (biplanar on low, #241), the mesh's uv elsewhere (props and
//   minis: glTF uvs, #188).
// - `slotSample`: samples with #179's mip bias (`mipBias`, a uniform: 0 but on high with TRAA).
// - `paintNormal`, `paintRoughness`: #178's paint noise on props and minis (paint.ts).
// - `ownAlbedo`, `ownOutput`: #172's per-surface colour (floors and height on the terrain kind,
//   each mini's colour; the floors' painted surfaces, floors.ts, #187) and the mini's
//   screen-door see-through for a GM-hidden token.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLOOR_IDS } from '../../game/floor';
import { cellUniforms, groundTexel } from '../cell-maps';
import { FLOOR_LOOKS } from '../floor-looks';
import type { SlotName } from './defaults';
import { splatUniforms, type FloorSurface } from './floors';
import { slotDefault, slotProperty } from './defaults';
import type { ShaderKind, Variant } from './kinds';
import { biplanar } from './biplanar';
import { localBox, triplanar, uvMapping, worldBox, type Mapping } from './mapping';
import { paintedNormal, paintedRoughness } from './paint';
import { mipBias } from './texture-quality';
import { tsl, type N } from './tsl';

/**
 * Where a kind lays its slots, `repeat` (`params.repeat`) being the tile: a box projection of
 * the world on walls and raised ground, so textures run on across instances and heights (two
 * offset fetches blended against visible tiling in the `antiTiled` variant, #181), or of
 * the geometry's own space for a `local` material (door panels, whose texture must not slide as
 * they swing); triplanar on rock; the mesh's uv, moved by `offset` (water's flow), elsewhere: on
 * props and minis a cooked model's glTF uvs (#188), which part lists carry as zeros so both draw
 * with one program (models.ts). Their paint (#178) keeps to object space on its own.
 */
export function surfaceMapping(
	kind: ShaderKind,
	variant: Variant,
	repeat: N,
	offset: N | null = null
): Mapping {
	if (kind === 'surface' || kind === 'terrain')
		return variant.local ? localBox(repeat) : worldBox(repeat, variant.antiTiled);
	// Rock (#241): triplanar from medium up (the `antiTiled` graph the tier picks), biplanar on low.
	if (kind === 'rock')
		return variant.local
			? localBox(repeat)
			: variant.antiTiled
				? triplanar(repeat)
				: biplanar(repeat);
	const at = tsl.uv().mul(repeat);
	return uvMapping(offset ? at.add(offset) : at);
}

/**
 * A slot's texture sampled at `at`: one node per slot and graph, a `materialReference` to the
 * drawn material's `<slot>Slot`, so every material of a kind shares the node and its program.
 * Its texture node samples at `at`, never through the texture's own matrix, which r186 snapshots
 * from the first texture it sees (hence `repeat`), biased by the tier's `mipBias` (#179). Not
 * `texture().onObjectUpdate`: TextureNode's setup resets its update type, so on WebGPU (no
 * flip-Y uniform) the update would never run.
 */
export function slotSample(slot: SlotName, at: N): N {
	const ref = tsl.materialReference(slotProperty(slot), 'texture') as N & { node: unknown };
	// The reference's own texture node, made here (it would make one without `at`): sampled at
	// `at` with the bias (fragment code only: the kinds sample no slot in the vertex stage), and
	// without the texture matrix a node given no uv applies.
	ref.node = tsl.texture(slotDefault(slot), at, null, mipBias).setUpdateMatrix(false);
	return ref;
}

const painted = (kind: ShaderKind) => kind === 'prop' || kind === 'mini';

/** The view-space normal after paint noise: props and minis only. */
export const paintNormal = (kind: ShaderKind, normal: N): N =>
	painted(kind) ? paintedNormal(normal) : normal;

/** Roughness after paint gloss: props and minis only. */
export const paintRoughness = (kind: ShaderKind, roughness: N): N =>
	painted(kind) ? paintedRoughness(roughness) : roughness;

/** How much paler the highest ground is drawn than the table (terrain.ts before #172). */
export const HIGHER = 0.25;

/**
 * Each floor's colour (linear) and cover (0-1) by `FLOOR_IDS` index, for the terrain kind: a
 * uniform array, so a palette change compiles nothing (#172).
 */
export const floorPalette = T.uniformArray(
	FLOOR_IDS.map((id) => {
		const { color, alpha } = FLOOR_LOOKS[id];
		const c = new THREE.Color(color);
		return new THREE.Vector4(c.r, c.g, c.b, alpha / 255);
	}),
	'vec4'
);

const loose = (node: unknown) => node as N;

/**
 * The terrain kind's albedo from the ground map (#172), as terrain.ts and floor.ts drew it with
 * instance colours and a plane: on the table, the floors over the textured surface at their cover
 * (plain covers nothing, the void everything); a raised cell's texture in its floor's colour (or
 * the look's), paler with height, less so where painted. A floor with a painted surface (#187,
 * floors.ts) is that surface, all of it, a little paler with height. With the splat (#242) that is
 * each of the two floors blended, mixed by the height blend's share and darkened along a kerb.
 */
export function groundColour(texel: N, colour: N, floor: FloorSurface | null = null): N {
	const g = loose(groundTexel);
	const level = g.y.mul(255);
	const of = (id: N, surface: N | null, has: N | null): N => {
		const entry = loose(floorPalette).element(id);
		const painted = entry.w.greaterThan(0);
		const flat = tsl.mix(texel.mul(colour), entry.xyz, entry.w);
		const high = tsl.mix(colour, tsl.vec3(1), HIGHER);
		const k = level.div(loose(cellUniforms.maxLevel)).mul(painted.select(0.4, 1));
		const raised = texel.mul(tsl.mix(painted.select(entry.xyz, colour), high, k.saturate()));
		const tint = level.greaterThan(0.5).select(raised, flat);
		if (!surface || !has) return tint;
		const paler = tsl.mix(surface, tsl.vec3(1), k.saturate().mul(HIGHER));
		return has.select(level.greaterThan(0.5).select(paler, surface), tint);
	};
	if (!floor) return of(g.x.mul(255).add(0.5).toInt(), null, null);
	const [f1, f2] = floor.floors;
	const mixed = tsl.mix(
		of(f1, floor.albedo[0].xyz, floor.has[0]),
		of(f2, floor.albedo[1].xyz, floor.has[1]),
		floor.share
	);
	return mixed.mul(floor.kerb.mul(loose(splatUniforms.kerbDark)).oneMinus());
}

const WHITE = new THREE.Color(0xffffff);
type Drawn = { object: THREE.Object3D | null };

/**
 * A mini's own colour (#172): the drawn mesh's `userData.miniColor` (the token's colour on its
 * accent or placeholder parts), else white. Per object, so one material serves every token.
 */
export const miniColour = T.uniform(new THREE.Color()).onObjectUpdate(
	({ object }: Drawn) => (object?.userData.miniColor as THREE.Color | undefined) ?? WHITE
);

/** How much of a mini shows (`userData.mini.opacity`, 1 unless the GM sees it hidden). */
export const miniOpacity = T.uniform(1).onObjectUpdate(
	({ object }: Drawn) => (object?.userData.mini as { opacity: number } | undefined)?.opacity ?? 1
);

/**
 * A kind's albedo from its sampled albedo slot and its colour: the ground's on terrain, and times
 * the mini's own colour on minis (#172).
 */
export function ownAlbedo(kind: ShaderKind, albedo: N, colour: N, floor: FloorSurface | null): N {
	if (kind === 'terrain') return tsl.vec4(groundColour(albedo.xyz, colour, floor), albedo.w);
	return albedo.mul(tsl.vec4(kind === 'mini' ? colour.mul(loose(miniColour)) : colour, 1));
}

const Fn = T.Fn as unknown as (body: () => N) => () => N;
const { Discard, If } = T as unknown as Record<'Discard' | 'If', (...args: unknown[]) => N>;

/**
 * A kind's final colour: on minis, a screen-door see-through (hashed alpha, Wyman and McGuire
 * 2017) by `miniOpacity`, so hiding a token never flips `transparent` (a program of its own);
 * noisy without TAA, which is fine for a GM-only state (#172).
 */
export function ownOutput(kind: ShaderKind, output: N): N {
	if (kind !== 'mini') return output;
	const noise = loose(T.interleavedGradientNoise(T.screenCoordinate.xy));
	return Fn(() => {
		If(noise.greaterThanEqual(loose(miniOpacity)), () => {
			Discard();
		});
		return output;
	})();
}
