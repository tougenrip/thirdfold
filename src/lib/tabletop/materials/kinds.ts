// The closed set of shader kinds (#169) and their graphs. Each kind's graph is built once per
// variant fixed at creation (instanced or not, lines for the overlay), the first time a material
// of it is made, and then shared by every material of that kind: their values reach it through
// `materialReference` (`params.*` and the `<slot>Slot` textures of the drawn material, hooks.ts),
// so no literal in a graph ever differs between materials and a new material, value or texture
// adds no program.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { SlotName } from './defaults';
import { paintNormal, paintRoughness, slotSample, surfaceUV } from './hooks';
import { tsl, type N } from './tsl';
import { worldEmissive, worldModify } from './world-modify';

export type ShaderKind =
	| 'surface'
	| 'terrain'
	| 'rock'
	| 'prop'
	| 'mini'
	| 'emissive'
	| 'decal'
	| 'foliage'
	| 'water'
	| 'overlay';

export const SHADER_KINDS: readonly ShaderKind[] = [
	'surface',
	'terrain',
	'rock',
	'prop',
	'mini',
	'emissive',
	'decal',
	'foliage',
	'water',
	'overlay'
];

/**
 * A material's values, read by its kind's graph as `params.<name>`. They live in one object, not
 * as the material's own numbers: r186 keys node state by whether each number on a material is
 * zero, so a value crossing 0 would rebuild it (RenderObject.getMaterialCacheKey). Unused fields
 * cost nothing: a kind's graph reads only its own.
 */
export interface Params {
	/** Multiplies the albedo slot. */
	color: THREE.Color;
	/** Multiplied by the ORM slot's green. */
	roughness: number;
	/** The least metalness; the ORM slot's blue can only add metal. */
	metalness: number;
	/** Multiplies the emissive slot. */
	emissive: THREE.Color;
	emissiveIntensity: number;
	/** The emissive tint input, added to what glows: #172's hover, selection and hidden ghost. */
	tint: THREE.Color;
	/** Decals, water and overlays: times the albedo's alpha. */
	opacity: number;
	/** Slot repeats across the surface's uv (as `dress` sets `map.repeat` today). */
	repeat: THREE.Vector2;
	/** Foliage: alpha below this is cut. Never 0 as a material property: it is a uniform here. */
	cutoff: number;
	/** Foliage: how far a leaf sways, in local units per unit of height (0 still). */
	sway: number;
	/** Water: how fast its slots slide, in repeats per second. */
	flow: THREE.Vector2;
	/** Minis: clearcoat (0 until #267) and its roughness, uniforms so leaving 0 compiles nothing. */
	clearcoat: number;
	clearcoatRoughness: number;
}

/** What a caller may set: colours and vectors in any form three takes. */
export type ParamsInput = {
	[K in keyof Params]?: Params[K] extends THREE.Color
		? THREE.ColorRepresentation
		: Params[K] extends THREE.Vector2
			? { x: number; y: number }
			: Params[K];
};

export const PARAM_DEFAULTS: Required<ParamsInput> = {
	color: 0xffffff,
	roughness: 1,
	metalness: 0,
	emissive: 0x000000,
	emissiveIntensity: 1,
	tint: 0x000000,
	opacity: 1,
	repeat: { x: 1, y: 1 },
	cutoff: 0.5,
	sway: 0,
	flow: { x: 0, y: 0 },
	clearcoat: 0,
	clearcoatRoughness: 0.3
};

export interface KindDef {
	base: 'standard' | 'physical' | 'basic';
	/** Blended; fixed at creation, never toggled (it changes the program). */
	transparent: boolean;
	/** Cut by `params.cutoff` (foliage); fixed at creation. */
	alphaTested: boolean;
	side: THREE.Side;
	/** The slots its graph samples (lines sample none). */
	slots: readonly SlotName[];
	/** Today's look for its first users (docs/RENDERING.md, "Shader kinds"). */
	defaults: ParamsInput;
}

const ALL: readonly SlotName[] = ['albedo', 'normal', 'orm', 'emissive'];
const lit = (defaults: ParamsInput, more: Partial<KindDef> = {}): KindDef => ({
	base: 'standard',
	transparent: false,
	alphaTested: false,
	side: THREE.FrontSide,
	slots: ALL,
	defaults,
	...more
});

export const KINDS: Record<ShaderKind, KindDef> = {
	surface: lit({ roughness: 0.85 }),
	terrain: lit({ roughness: 0.9 }),
	rock: lit({ roughness: 0.95 }),
	prop: lit({ roughness: 0.75 }),
	mini: lit({ roughness: 0.45 }, { base: 'physical' }),
	emissive: lit({ roughness: 0.3 }),
	decal: lit({ color: 0x000000 }, { transparent: true }),
	foliage: lit({ roughness: 0.8 }, { alphaTested: true, side: THREE.DoubleSide }),
	water: lit({ color: 0x2a4a5a, roughness: 0.1, opacity: 0.8 }, { transparent: true }),
	overlay: {
		base: 'basic',
		transparent: true,
		alphaTested: false,
		side: THREE.FrontSide,
		slots: ['albedo'],
		defaults: {}
	}
};

/**
 * The world's clock for animated kinds (foliage, water), in seconds: the renderer owns it and
 * holds it still under reduced motion. Never three's `time`, which runs regardless.
 */
export const worldTime = uniform(0);

/** The name of the per-instance tint an instanced kind reads: rgb, and its strength in w. */
export const TINT_ATTRIBUTE = 'aTint';

/** The node properties a kind sets on its materials. */
export interface Graph {
	colorNode: N;
	opacityNode: N | null;
	alphaTestNode: N | null;
	positionNode: N | null;
	outputNode: N;
	lit: {
		roughnessNode: N;
		metalnessNode: N;
		aoNode: N;
		normalNode: N;
		emissiveNode: N;
		clearcoatNode: N | null;
		clearcoatRoughnessNode: N | null;
	} | null;
}

/** Which graph of a kind: fixed when a material is made. */
export interface Variant {
	/** Reads the per-instance tint (`TINT_ATTRIBUTE`); the mesh must be an InstancedMesh with it. */
	instanced: boolean;
	/** Overlay only: for LineSegments, which have no uv to sample. */
	lines: boolean;
}

const param = (name: keyof Params, type: string) => tsl.materialReference(`params.${name}`, type);

/**
 * Tangent-space normal mapping by screen-space derivatives of the coordinates the slots are
 * sampled at (Schüler, "Normal mapping without precomputed tangents"), as three's own frame does
 * with the mesh's uv: here any mapping (#177) works, and meshes without uv warn about nothing.
 */
function perturbNormal(sampled: N, at: N): N {
	const n = sampled.mul(2).sub(1);
	const q0 = tsl.positionView.dFdx();
	const q1 = tsl.positionView.dFdy();
	const st0 = at.dFdx();
	const st1 = at.dFdy();
	const normal = tsl.normalView;
	const q1perp = q1.cross(normal);
	const q0perp = normal.cross(q0);
	const T = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
	const B = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
	const det = tsl.max(T.dot(T), B.dot(B));
	const scale = det.equal(0).select(0, det.inverseSqrt());
	return T.mul(scale).mul(n.x).add(B.mul(scale).mul(n.y)).add(normal.mul(n.z)).normalize();
}

/** The emissive tint input: the material's, plus the instance's when instanced. */
function tintOf(variant: Variant): N {
	const own = param('tint', 'color');
	if (!variant.instanced) return own;
	const each = tsl.attribute(TINT_ATTRIBUTE, 'vec4');
	return own.add(each.xyz.mul(each.w));
}

function build(kind: ShaderKind, variant: Variant): Graph {
	const time = worldTime as unknown as N;
	const def = KINDS[kind];
	const tint = tintOf(variant);
	if (def.base === 'basic') {
		const colour = tsl.vec4(param('color', 'color'), 1);
		const opacity = param('opacity', 'float');
		const at = surfaceUV(kind, param('repeat', 'vec2'));
		const albedo = variant.lines ? null : slotSample('albedo', at);
		return {
			colorNode: (albedo ? albedo.mul(colour) : colour).add(tsl.vec4(tint, 0)),
			opacityNode: albedo ? albedo.w.mul(opacity) : opacity,
			alphaTestNode: null,
			positionNode: null,
			outputNode: worldModify(tsl.output, tsl.vec3(0)),
			lit: null
		};
	}
	let at = surfaceUV(kind, param('repeat', 'vec2'));
	if (kind === 'water') at = at.add(param('flow', 'vec2').mul(time));
	const albedo = slotSample('albedo', at);
	const orm = slotSample('orm', at);
	const glow = slotSample('emissive', at)
		.xyz.mul(param('emissive', 'color'))
		.mul(param('emissiveIntensity', 'float'))
		.add(tint);
	const emissive = worldEmissive(glow);
	const alpha = albedo.w.mul(param('opacity', 'float'));
	const sway =
		kind === 'foliage'
			? tsl.positionLocal.add(
					tsl.vec3(
						tsl
							.sin(time.mul(1.3).add(tsl.positionGeometry.x))
							.mul(param('sway', 'float'))
							.mul(tsl.positionGeometry.y),
						0,
						0
					)
				)
			: null;
	return {
		colorNode: albedo.mul(tsl.vec4(param('color', 'color'), 1)),
		opacityNode: def.transparent || def.alphaTested ? alpha : null,
		alphaTestNode: def.alphaTested ? param('cutoff', 'float') : null,
		positionNode: sway,
		outputNode: worldModify(tsl.output, emissive),
		lit: {
			roughnessNode: paintRoughness(kind, param('roughness', 'float').mul(orm.y)),
			metalnessNode: tsl.max(param('metalness', 'float'), orm.z),
			aoNode: orm.x,
			normalNode: paintNormal(kind, perturbNormal(slotSample('normal', at).xyz, at)),
			emissiveNode: emissive,
			clearcoatNode: def.base === 'physical' ? param('clearcoat', 'float') : null,
			clearcoatRoughnessNode: def.base === 'physical' ? param('clearcoatRoughness', 'float') : null
		}
	};
}

const graphs = new Map<string, Graph>();

/** A kind's graph for a variant, built the first time it is asked for and shared from then on. */
export function graphFor(kind: ShaderKind, variant: Variant): Graph {
	const key = `${kind}:${variant.instanced ? 'i' : ''}${variant.lines ? 'l' : ''}`;
	let graph = graphs.get(key);
	if (!graph) graphs.set(key, (graph = build(kind, variant)));
	return graph;
}
