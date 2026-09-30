// The floors' painted surfaces on the terrain kind (#187): a texture array per map (albedo with
// height in alpha, normal, ORM), a layer per surface of the environment's library, and each
// floor's layer from the ground map's floor byte. Globals, as the ground map is: the renderer
// puts a table's arrays in with `wearFloors`, and an array standing in for an array (the blank
// one while they load, or where an environment has none) compiles nothing. A floor with no layer
// (plain, water, the void) keeps its `floorPalette` colour.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { FLOOR_IDS } from '../../game/floor';
import { groundTexel } from '../cell-maps';
import { blankTexture, SLOTS } from './defaults';
import type { Variant } from './kinds';
import { worldBox } from './mapping';
import type { N } from './tsl';

export type FloorMap = 'albedo' | 'normal' | 'orm';
export const FLOOR_MAPS: readonly FloorMap[] = ['albedo', 'normal', 'orm'];

/** One repeat of a surface covers this many cells. */
export const SURFACE_CELLS = 2;

const BLANKS = Object.fromEntries(
	FLOOR_MAPS.map((m) => [m, blankTexture({ ...SLOTS[m], type: 'array' })])
) as Record<FloorMap, THREE.Texture>;

const maps = Object.fromEntries(FLOOR_MAPS.map((m) => [m, T.texture(BLANKS[m])])) as Record<
	string,
	unknown
> as Record<FloorMap, { value: THREE.Texture }>;
/** Each floor's layer + 1 by `FLOOR_IDS` index; 0 has none. */
const layers = T.uniformArray(
	FLOOR_IDS.map(() => 0),
	'float'
);
/** Repeats per world unit: `SURFACE_CELLS` cells a repeat (`wearFloors` sets it by cell size). */
const repeat = T.uniform(new THREE.Vector2(1, 1));

/** A table's floor arrays: the textures by map and the layer of each floor that has one. */
export interface FloorSurfaces {
	maps: Record<FloorMap, THREE.Texture>;
	/** Layer by floor id. */
	layers: Record<string, number>;
}

/** Puts a table's floor arrays on the terrain kind, or none (every floor its palette colour). */
export function wearFloors(floors: FloorSurfaces | null, cellSize: number): void {
	for (const m of FLOOR_MAPS) maps[m].value = floors?.maps[m] ?? BLANKS[m];
	FLOOR_IDS.forEach((id, i) => (layers.array[i] = (floors?.layers[id] ?? -1) + 1));
	repeat.value.setScalar(1 / (SURFACE_CELLS * cellSize));
}

const loose = (node: unknown) => node as N;

/** The fragment's floor surface, for the terrain kind's graph (built once per variant). */
export interface FloorSurface {
	/** Whether the cell's floor has a layer. */
	has: N;
	albedo: N;
	/** The floor's ORM, or `own` where it has none. */
	orm(own: N): N;
	/** The view-space normal with the floor's normal map, or `own` where it has none. */
	normal(own: N): N;
}

export function floorSurface(variant: Variant): FloorSurface {
	const layer = loose(layers).element(loose(groundTexel).x.mul(255).add(0.5).toInt());
	const has = layer.greaterThan(0.5);
	const index = layer.sub(1).max(0);
	const mapping = worldBox(loose(repeat), variant.antiTiled, (slot, at) =>
		loose(maps[slot as FloorMap])
			.sample(at)
			.depth(index)
	);
	return {
		has,
		albedo: mapping.sample('albedo'),
		orm: (own) => has.select(mapping.sample('orm'), own),
		normal: (own) => has.select(mapping.normal(), own)
	};
}
