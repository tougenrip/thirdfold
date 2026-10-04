// The material module (#169): every surface the renderer draws is one of a closed set of shader
// kinds, made here. A kind's graph is shared by all its materials (kinds.ts), its values are
// `params` and its textures sit in typed slots that are never empty (defaults.ts), so making a
// material, changing its values or swapping its textures adds no program. The rules are in
// docs/RENDERING.md, "Materials and world visibility"; what later looks plug into, in hooks.ts
// and world-modify.ts.
//
// What is fixed when a material is made (each changes the program, so never toggle it later):
// the kind, `instanced`, `lines`, `grid`, `local`, `antiTiled`, `dropped`, `vertexColors`, and the kind's
// `transparent`, `side` and alpha test.

import * as THREE from 'three/webgpu';
import { SLOT_NAMES, slotDefault, slotProperty, type SlotName } from './defaults';
import { LIFT_ATTRIBUTE } from './variation';
import { DROP_ATTRIBUTE } from './drop';
import { NO_DROP } from '../drop-in';
import { KindPhysicalMaterial, KindStandardMaterial } from './lighting-model';
import {
	BAKE_ATTRIBUTE,
	graphFor,
	KINDS,
	PAINT_ATTRIBUTE,
	PARAM_DEFAULTS,
	TINT_ATTRIBUTE,
	type Params,
	type ParamsInput,
	type ShaderKind
} from './kinds';

export {
	BAKE_ATTRIBUTE,
	SHADER_KINDS,
	KINDS,
	PAINT_ATTRIBUTE,
	TINT_ATTRIBUTE,
	worldTime
} from './kinds';
export { LIFT_ATTRIBUTE } from './variation';
export { DROP_ATTRIBUTE, dropHeight, dropNow } from './drop';
export { liftOf } from './lift';
export { repeatFor } from './tiling';
export type { Params, ParamsInput, ShaderKind } from './kinds';
export { SLOTS, SLOT_NAMES, blankTexture, prepareSlotTexture, slotDefault } from './defaults';
export type { SlotName, SlotSpec, SlotType } from './defaults';
export { loadPaint, paint } from './paint';
export { mipBias, setTextureQuality, worldTexture } from './texture-quality';

/** A material of a shader kind: its values and its slots' textures. */
export type KindMaterial = THREE.NodeMaterial & {
	readonly kind: ShaderKind;
	/** What it was made with (its variant), for `remake`. */
	readonly options: MaterialOptions;
	params: Params;
} & { [S in SlotName as `${S}Slot`]: THREE.Texture };

export interface MaterialOptions {
	/** For an InstancedMesh whose geometry has `TINT_ATTRIBUTE` (`addInstanceTints`). */
	instanced?: boolean;
	/** Overlay only: a LineBasicNodeMaterial for LineSegments. */
	lines?: boolean;
	/** Overlay only: the shader grid and hover highlight (#245), for a twin of a chunk's tops. */
	grid?: boolean;
	/**
	 * Surface, terrain and rock: box mapping in the geometry's own space, not the world's, for a
	 * mesh that moves (door panels swing, so a world mapping would slide across them; #177).
	 */
	local?: boolean;
	/**
	 * Surface and terrain: two-fetch anti-tiling (#181), for the medium tier and up; low keeps
	 * one fetch. A graph of its own, so the tier's pipeline chooses it (#169), never at runtime.
	 */
	antiTiled?: boolean;
	/**
	 * Terrain and rock: drops in by the geometry's per-vertex start (`DROP_ATTRIBUTE`, #249), for
	 * the world's chunks. A graph of its own; every geometry it draws must carry the attribute.
	 */
	dropped?: boolean;
	/** Multiplies the geometry's vertex colours in (figure bodies, part-list props). */
	vertexColors?: boolean;
	params?: ParamsInput;
	/** Textures for the kind's slots (see `prepareSlotTexture`); the rest hold their blanks. */
	slots?: Partial<Record<SlotName, THREE.Texture>>;
}

function baseMaterial(kind: ShaderKind, lines: boolean): THREE.NodeMaterial {
	switch (KINDS[kind].base) {
		case 'physical':
			return new KindPhysicalMaterial();
		case 'standard':
			return new KindStandardMaterial();
		default:
			return lines ? new THREE.LineBasicNodeMaterial() : new THREE.MeshBasicNodeMaterial();
	}
}

/** Sets some of a material's values; the rest keep theirs. */
export function setParams(material: KindMaterial, input: ParamsInput): void {
	const p = material.params;
	for (const [name, value] of Object.entries(input) as [keyof Params, unknown][]) {
		if (value === undefined) continue;
		const target = p[name];
		if (target instanceof THREE.Color) target.set(value as THREE.ColorRepresentation);
		else if (target instanceof THREE.Vector2) {
			const v = value as { x: number; y: number };
			target.set(v.x, v.y);
		} else (p as unknown as Record<string, number>)[name] = value as number;
	}
}

/** Puts a texture in a slot, or its blank back with null. Compiles nothing either way. */
export function setSlot(material: KindMaterial, slot: SlotName, texture: THREE.Texture | null) {
	(material as unknown as Record<string, THREE.Texture>)[slotProperty(slot)] =
		texture ?? slotDefault(slot);
}

/** A material of `kind`, its values from the kind's defaults and then `options.params`. */
export function createMaterial(kind: ShaderKind, options: MaterialOptions = {}): KindMaterial {
	const def = KINDS[kind];
	const lines = def.base === 'basic' && !!options.lines;
	const material = baseMaterial(kind, lines) as KindMaterial;
	Object.defineProperty(material, 'kind', { value: kind, enumerable: true });
	Object.defineProperty(material, 'options', { value: options });
	material.transparent = def.transparent;
	material.depthWrite = !def.transparent;
	material.side = def.side;
	material.vertexColors = !!options.vertexColors;
	material.name = kind;
	material.params = {
		color: new THREE.Color(),
		roughness: 0,
		metalness: 0,
		emissive: new THREE.Color(),
		emissiveIntensity: 0,
		tint: new THREE.Color(),
		opacity: 0,
		repeat: new THREE.Vector2(),
		cutoff: 0,
		sway: 0,
		flow: new THREE.Vector2(),
		clearcoat: 0,
		clearcoatRoughness: 0,
		lift: 0,
		macroScale: 0,
		macroTint: 0,
		macroRoughness: 0,
		bake: 0,
		translucency: 0
	};
	setParams(material, { ...PARAM_DEFAULTS, ...def.defaults, ...options.params });
	for (const slot of lines ? [] : SLOT_NAMES)
		if (def.slots.includes(slot)) setSlot(material, slot, options.slots?.[slot] ?? null);

	const graph = graphFor(kind, {
		instanced: !!options.instanced,
		lines,
		grid: def.base === 'basic' && !lines && !!options.grid,
		local: !!options.local,
		antiTiled: !!options.antiTiled,
		dropped: !!options.dropped
	});
	const nodes = material as unknown as Record<string, unknown>;
	nodes.colorNode = graph.colorNode;
	nodes.opacityNode = graph.opacityNode;
	nodes.alphaTestNode = graph.alphaTestNode;
	nodes.positionNode = graph.positionNode;
	nodes.castShadowPositionNode = graph.castShadowPositionNode;
	nodes.outputNode = graph.outputNode;
	for (const [name, node] of Object.entries(graph.lit ?? {})) if (node) nodes[name] = node;
	return material;
}

/**
 * A new material of `material`'s kind with its values and textures, made with `change` to its
 * variant (the tier's `antiTiled`). Never `clone()` a kind material: Material.copy drops
 * `params` and the slots (#169). A new variant is a new program, so only a tier switch does this.
 */
export function remake(material: KindMaterial, change: Partial<MaterialOptions>): KindMaterial {
	const slots = Object.fromEntries(
		SLOT_NAMES.map((s) => [
			s,
			(material as unknown as Record<string, THREE.Texture>)[slotProperty(s)]
		])
	);
	const params = Object.fromEntries(
		Object.entries(material.params).map(([k, v]) => [k, v instanceof THREE.Color ? v.clone() : v])
	) as ParamsInput;
	return createMaterial(material.kind, { ...material.options, ...change, params, slots });
}

const twins = new WeakMap<KindMaterial, KindMaterial>();

/**
 * `material` in the other anti-tiling variant (#181), with its values and textures now: made once
 * and kept both ways, so switching tiers back and forth makes no material and releases no program
 * (#180): only the first switch compiles. `disposeTwins` disposes both.
 */
export function twinOf(material: KindMaterial): KindMaterial {
	let twin = twins.get(material);
	if (!twin) {
		twin = remake(material, { antiTiled: !material.options.antiTiled });
		twins.set(material, twin).set(twin, material);
		return twin;
	}
	setParams(twin, material.params as unknown as ParamsInput);
	for (const s of SLOT_NAMES) {
		const texture = (material as unknown as Record<string, THREE.Texture>)[slotProperty(s)];
		if (texture) (twin as unknown as Record<string, THREE.Texture>)[slotProperty(s)] = texture;
	}
	return twin;
}

/** Disposes a material and its twin, if it has one. */
export function disposeTwins(material: KindMaterial): void {
	twins.get(material)?.dispose();
	material.dispose();
}

/**
 * Gives a geometry what an instanced kind reads per instance: the tint (rgb and strength, all 0)
 * the lift (`LIFT_ATTRIBUTE`, 0; the layer writes `liftOf` each instance's asset and cell), the
 * paint (`PAINT_ATTRIBUTE`, white; props multiply their albedo by it) and the drop-in's start
 * (`DROP_ATTRIBUTE`, none; #249).
 */
export function addInstanceTints(geometry: THREE.BufferGeometry, count: number): void {
	geometry.setAttribute(
		PAINT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3)
	);
	geometry.setAttribute(
		TINT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
	);
	geometry.setAttribute(
		LIFT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
	);
	geometry.setAttribute(
		DROP_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count).fill(NO_DROP), 1)
	);
}

/** A per-vertex drop start for a `dropped` material's geometry: none, or `starts` (#249). */
export function withDrops(geometry: THREE.BufferGeometry, starts?: Float32Array): void {
	const count = geometry.getAttribute('position').count;
	const values = starts ?? new Float32Array(count).fill(NO_DROP);
	geometry.setAttribute(DROP_ATTRIBUTE, new THREE.BufferAttribute(values, 1));
}

/**
 * Gives a geometry the bake props and minis read (`BAKE_ATTRIBUTE`) when it has none: open to the
 * sky and flat, so it shades as before and draws with the same program as a baked model.
 */
export function withBake<G extends THREE.BufferGeometry>(geometry: G): G {
	if (geometry.getAttribute(BAKE_ATTRIBUTE)) return geometry;
	const count = geometry.getAttribute('position').count;
	const bake = new Float32Array(count * 2);
	for (let i = 0; i < count; i++) bake.set([1, 0.5], i * 2);
	geometry.setAttribute(BAKE_ATTRIBUTE, new THREE.BufferAttribute(bake, 2));
	return geometry;
}
