// The material module (#169): every surface the renderer draws is one of a closed set of shader
// kinds, made here. A kind's graph is shared by all its materials (kinds.ts), its values are
// `params` and its textures sit in typed slots that are never empty (defaults.ts), so making a
// material, changing its values or swapping its textures adds no program. The rules are in
// docs/RENDERING.md, "Shader kinds"; what later looks plug into, in hooks.ts and world-modify.ts.
//
// What is fixed when a material is made (each changes the program, so never toggle it later):
// the kind, `instanced`, `lines`, `local`, `antiTiled`, `vertexColors`, and the kind's
// `transparent`, `side` and alpha test.

import * as THREE from 'three/webgpu';
import { SLOT_NAMES, slotDefault, slotProperty, type SlotName } from './defaults';
import { LIFT_ATTRIBUTE } from './variation';
import {
	graphFor,
	KINDS,
	PARAM_DEFAULTS,
	TINT_ATTRIBUTE,
	type Params,
	type ParamsInput,
	type ShaderKind
} from './kinds';

export { SHADER_KINDS, KINDS, TINT_ATTRIBUTE, worldTime } from './kinds';
export { LIFT_ATTRIBUTE } from './variation';
export { liftOf } from './lift';
export { repeatFor } from './tiling';
export type { Params, ParamsInput, ShaderKind } from './kinds';
export { SLOTS, SLOT_NAMES, blankTexture, prepareSlotTexture, slotDefault } from './defaults';
export type { SlotName, SlotSpec, SlotType } from './defaults';
export { loadPaint, paint } from './paint';

/** A material of a shader kind: its values and its slots' textures. */
export type KindMaterial = THREE.NodeMaterial & {
	readonly kind: ShaderKind;
	params: Params;
} & { [S in SlotName as `${S}Slot`]: THREE.Texture };

export interface MaterialOptions {
	/** For an InstancedMesh whose geometry has `TINT_ATTRIBUTE` (`addInstanceTints`). */
	instanced?: boolean;
	/** Overlay only: a LineBasicNodeMaterial for LineSegments. */
	lines?: boolean;
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
	/** Multiplies the geometry's vertex colours in (figure bodies, part-list props). */
	vertexColors?: boolean;
	params?: ParamsInput;
	/** Textures for the kind's slots (see `prepareSlotTexture`); the rest hold their blanks. */
	slots?: Partial<Record<SlotName, THREE.Texture>>;
}

function baseMaterial(kind: ShaderKind, lines: boolean): THREE.NodeMaterial {
	switch (KINDS[kind].base) {
		case 'physical':
			return new THREE.MeshPhysicalNodeMaterial();
		case 'standard':
			return new THREE.MeshStandardNodeMaterial();
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
		macroRoughness: 0
	};
	setParams(material, { ...PARAM_DEFAULTS, ...def.defaults, ...options.params });
	for (const slot of lines ? [] : SLOT_NAMES)
		if (def.slots.includes(slot)) setSlot(material, slot, options.slots?.[slot] ?? null);

	const graph = graphFor(kind, {
		instanced: !!options.instanced,
		lines,
		local: !!options.local,
		antiTiled: !!options.antiTiled
	});
	const nodes = material as unknown as Record<string, unknown>;
	nodes.colorNode = graph.colorNode;
	nodes.opacityNode = graph.opacityNode;
	nodes.alphaTestNode = graph.alphaTestNode;
	nodes.positionNode = graph.positionNode;
	nodes.outputNode = graph.outputNode;
	for (const [name, node] of Object.entries(graph.lit ?? {})) if (node) nodes[name] = node;
	return material;
}

/**
 * Gives a geometry what an instanced kind reads per instance: the tint (rgb and strength, all 0)
 * and the lift (`LIFT_ATTRIBUTE`, 0; the layer writes `liftOf` each instance's asset and cell).
 */
export function addInstanceTints(geometry: THREE.BufferGeometry, count: number): void {
	geometry.setAttribute(
		TINT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
	);
	geometry.setAttribute(
		LIFT_ATTRIBUTE,
		new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
	);
}
