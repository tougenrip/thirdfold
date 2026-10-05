// The closed set of shader kinds (#169) and their graphs. Each kind's graph is built once per
// variant fixed at creation (instanced or not, lines for the overlay, local mapping, anti-tiling),
// the first time a material of it is made, and then shared by every material of that kind: their values reach it through
// `materialReference` (`params.*` and the `<slot>Slot` textures of the drawn material, hooks.ts),
// so no literal in a graph ever differs between materials and a new material, value or texture
// adds no program.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import type { SlotName } from './defaults';
import { dropLift } from './drop';
import { flickerNode } from './flicker';
import { floorSurface } from './floors';
import { gridGraph } from './grid';
import { ownAlbedo, ownOutput, paintNormal, paintRoughness, surfaceMapping } from './hooks';
import { tsl, type N } from './tsl';
import {
	LIFT_ATTRIBUTE,
	LIFTED,
	VARIED,
	lifted,
	macroOf,
	macroRoughness,
	macroTint
} from './variation';
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
	/** Water and surface: how fast its slots slide, in repeats per second (#243's moving ground). */
	flow: THREE.Vector2;
	/** Minis: clearcoat (0 until #267) and its roughness, uniforms so leaving 0 compiles nothing. */
	clearcoat: number;
	clearcoatRoughness: number;
	/**
	 * Props, decals and water (instanced): world units an instance is lifted along its normal at an
	 * `aLift` of 1, against z-fighting (#181): a thousandth of a cell, so the layer sets it from
	 * the grid's cell size.
	 */
	lift: number;
	/** Surface, terrain and rock: the macro variation's frequency, per world unit (#181). */
	macroScale: number;
	/** How far macro variation moves albedo, as a fraction (0 off, 0.1 is ±10%). */
	macroTint: number;
	/** How far macro variation moves roughness, either way (0 off). */
	macroRoughness: number;
	/** Props and minis: how much of their baked occlusion (`BAKE_ATTRIBUTE`) shades their ambient light. */
	bake: number;
	/**
	 * Props, minis and foliage: how much light behind them shines through (#237, lighting-model.ts:
	 * tent canvas, banners, candles, crystals, leaves). 0 is opaque; a uniform, so changing it
	 * compiles nothing.
	 */
	translucency: number;
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
	clearcoatRoughness: 0.3,
	lift: 1e-3,
	macroScale: 0.08,
	macroTint: 0,
	macroRoughness: 0,
	bake: 1,
	translucency: 0
};

/** The tiled kinds' macro variation (#181): gentle, over about a dozen cells. */
const VARY: ParamsInput = { macroTint: 0.1, macroRoughness: 0.08 };

export interface KindDef {
	base: 'standard' | 'physical' | 'basic';
	/** Blended; fixed at creation, never toggled (it changes the program). */
	transparent: boolean;
	/** Cut by `params.cutoff` (foliage); fixed at creation. */
	alphaTested: boolean;
	side: THREE.Side;
	/** The slots its graph samples (lines sample none). */
	slots: readonly SlotName[];
	/** Today's look for its first users (docs/RENDERING.md, "Materials and world visibility"). */
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
	surface: lit({ roughness: 0.85, ...VARY }),
	// No emissive slot: no floor glows, and the binding it saves keeps terrain's fragment stage
	// within WebGPU's 16 sampled textures on high with the probes and the hero atlas (#235, #230).
	terrain: lit({ roughness: 0.9, ...VARY }, { slots: ['albedo', 'normal', 'orm'] }),
	rock: lit({ roughness: 0.95, ...VARY }),
	prop: lit({ roughness: 0.75 }),
	mini: lit({ roughness: 0.45 }, { base: 'physical' }),
	emissive: lit({ roughness: 0.3 }),
	decal: lit({ color: 0x000000 }, { transparent: true }),
	foliage: lit(
		{ roughness: 0.8, translucency: 0.6 },
		{ alphaTested: true, side: THREE.DoubleSide }
	),
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

/** The per-instance colour an instanced prop's albedo is multiplied by: a prop's tint (#202), else white. */
export const PAINT_ATTRIBUTE = 'aPaint';

/**
 * The per-vertex bake props and minis read (#190): occlusion by the model's own parts and the
 * floor, and convexity (for #267). Every geometry drawn with those kinds has it (`withBake`), or
 * the graph would differ and compile a program of its own.
 */
export const BAKE_ATTRIBUTE = 'aBake';
const BAKED: readonly ShaderKind[] = ['prop', 'mini'];

/** The node properties a kind sets on its materials. */
export interface Graph {
	colorNode: N;
	opacityNode: N | null;
	alphaTestNode: N | null;
	positionNode: N | null;
	/** Where the shadow pass puts a vertex: at rest, so a drop-in never redraws a shadow (#249). */
	castShadowPositionNode: N | null;
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
	/** Overlay only: the shader grid and the hover highlight on a chunk top's twin (#245, grid.ts). */
	grid: boolean;
	/** Surface, terrain and rock: box mapping in the geometry's own space (door panels, #177). */
	local: boolean;
	/** Surface and terrain in world space: two-fetch anti-tiling, medium tier and up (#181). */
	antiTiled: boolean;
	/** Terrain and rock: the world's chunks, dropping in by a start per vertex (#249, drop.ts). */
	dropped: boolean;
}

const param = (name: keyof Params, type: string) => tsl.materialReference(`params.${name}`, type);

/**
 * The emissive tint input: the material's, plus the instance's when instanced. The instanced
 * emissive kind is the lights' flames (#232): their glow breathes with their light's flicker
 * (#231), its profile and phase in the instance's paint (`aPaint` x and y, unused by the kind).
 */
function tintOf(kind: ShaderKind, variant: Variant): N {
	const own = param('tint', 'color');
	if (!variant.instanced) return own;
	const each = tsl.attribute(TINT_ATTRIBUTE, 'vec4');
	const glow = each.xyz.mul(each.w);
	if (kind !== 'emissive') return own.add(glow);
	const paint = tsl.attribute(PAINT_ATTRIBUTE, 'vec3');
	return own.add(glow.mul(flickerNode(paint.x, paint.y)));
}

function build(kind: ShaderKind, variant: Variant): Graph {
	const time = worldTime as unknown as N;
	const def = KINDS[kind];
	const tint = tintOf(kind, variant);
	if (def.base === 'basic' && variant.grid) {
		const { colorNode, opacityNode, outputNode } = gridGraph();
		return {
			colorNode,
			opacityNode,
			alphaTestNode: null,
			positionNode: null,
			castShadowPositionNode: null,
			outputNode,
			lit: null
		};
	}
	if (def.base === 'basic') {
		const colour = tsl.vec4(param('color', 'color'), 1);
		const opacity = param('opacity', 'float');
		const albedo = variant.lines
			? null
			: surfaceMapping(kind, variant, param('repeat', 'vec2')).sample('albedo');
		return {
			colorNode: (albedo ? albedo.mul(colour) : colour).add(tsl.vec4(tint, 0)),
			opacityNode: albedo ? albedo.w.mul(opacity) : opacity,
			alphaTestNode: null,
			positionNode: null,
			castShadowPositionNode: null,
			outputNode: worldModify(tsl.output, tsl.vec3(0)),
			lit: null
		};
	}
	// Water's slots slide, and a surface's (the void's moving ground and mist, #243): 0 holds still.
	const flow = kind === 'water' || kind === 'surface' ? param('flow', 'vec2').mul(time) : null;
	const mapping = surfaceMapping(kind, variant, param('repeat', 'vec2'), flow);
	const floor = kind === 'terrain' ? floorSurface(variant) : null;
	const albedo = mapping.sample('albedo');
	const orm = floor ? floor.orm(mapping.sample('orm')) : mapping.sample('orm');
	// Without an emissive slot (terrain) the glow is the tint alone, as a blank slot's black gives.
	const glow = def.slots.includes('emissive')
		? mapping
				.sample('emissive')
				.xyz.mul(param('emissive', 'color'))
				.mul(param('emissiveIntensity', 'float'))
				.add(tint)
		: tint;
	// Rock is the cliffs' and risers' kind (#241): its faces read the cell behind them.
	const face = kind === 'rock';
	const emissive = worldEmissive(glow, face);
	const alpha = albedo.w.mul(param('opacity', 'float'));
	const macro = VARIED.includes(kind) ? macroOf(param('macroScale', 'float')) : null;
	const colour = macro
		? param('color', 'color').mul(macroTint(macro, param('macroTint', 'float')))
		: param('color', 'color');
	const roughness = param('roughness', 'float').mul(orm.y);
	// Instanced props, decals and water lift off what they lie on and drop in (#181, #249); the
	// world's chunks drop in; the shadow pass draws both at rest.
	const rest =
		variant.instanced && LIFTED.includes(kind)
			? lifted(param('lift', 'float'))
			: variant.dropped
				? tsl.positionGeometry
				: null;
	const position =
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
			: rest &&
				rest.add(
					variant.instanced && LIFTED.includes(kind)
						? dropLift(tsl.attribute(LIFT_ATTRIBUTE, 'vec2').y)
						: dropLift()
				);
	const painted =
		kind === 'prop' && variant.instanced
			? colour.mul(tsl.attribute(PAINT_ATTRIBUTE, 'vec3'))
			: colour;
	return {
		colorNode: ownAlbedo(kind, albedo, painted, floor),
		opacityNode: def.transparent || def.alphaTested ? alpha : null,
		alphaTestNode: def.alphaTested ? param('cutoff', 'float') : null,
		positionNode: position,
		castShadowPositionNode: rest,
		outputNode: ownOutput(kind, worldModify(tsl.output, emissive, true, face)),
		lit: {
			roughnessNode: paintRoughness(
				kind,
				macro ? macroRoughness(roughness, macro, param('macroRoughness', 'float')) : roughness
			),
			metalnessNode: tsl.max(param('metalness', 'float'), orm.z),
			// Only indirect light takes ambient occlusion, so the bake never darkens a torch's.
			aoNode: BAKED.includes(kind)
				? orm.x.mul(tsl.mix(1, tsl.attribute(BAKE_ATTRIBUTE, 'vec2').x, param('bake', 'float')))
				: orm.x,
			normalNode: paintNormal(kind, floor ? floor.normal(mapping.normal()) : mapping.normal()),
			emissiveNode: emissive,
			clearcoatNode: def.base === 'physical' ? param('clearcoat', 'float') : null,
			clearcoatRoughnessNode: def.base === 'physical' ? param('clearcoatRoughness', 'float') : null
		}
	};
}

const graphs = new Map<string, Graph>();

/** A kind's graph for a variant, built the first time it is asked for and shared from then on. */
export function graphFor(kind: ShaderKind, variant: Variant): Graph {
	const flags: [keyof Variant, string][] = [
		['instanced', 'i'],
		['lines', 'l'],
		['grid', 'g'],
		['local', 'o'],
		['antiTiled', 'a'],
		['dropped', 'd']
	];
	const key = `${kind}:${flags.map(([f, c]) => (variant[f] ? c : '')).join('')}`;
	let graph = graphs.get(key);
	if (!graph) graphs.set(key, (graph = build(kind, variant)));
	return graph;
}
