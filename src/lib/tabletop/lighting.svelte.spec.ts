// Lights on the props that hold them (#367): a light on a sconce or brazier
// draws only its flame, on the prop's top, and hangs its point light there (#228: its GridLights
// entry's visual position).

import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Light } from '$lib/game/lights';
import type { Prop } from '$lib/game/props';
import { LightingLayer, lightSeats } from './lighting';
import { loadModel } from './models';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 4, height: 4 };
const light = (id: string, x: number, y: number): Light => ({
	id,
	pos: { x, y },
	radius: 3,
	color: '#ffa04d',
	on: true
});
const lights = [light('seated', 1, 1), light('standing', 3, 3)];
const props: Prop[] = [{ id: 'b', assetId: 'brazier', pos: { x: 1, y: 1 }, rotation: 0, scale: 1 }];

function layerWith(seats: Map<number, number>) {
	const layer = new LightingLayer();
	layer.update(grid, 'dark', lights, [], new Set(), null, null, seats);
	return layer;
}

/** The fixture group drawn for a light. */
function fixtureOf(layer: LightingLayer, id: string): THREE.Object3D {
	const found = layer.group.children.find((o) => o.userData.lightId === id);
	if (!found) throw new Error(`no fixture for ${id}`);
	return found;
}

describe('lights on the props that hold them', () => {
	it('seat on the prop: no post, the flame and the point light on its top', () => {
		const seats = lightSeats(grid, props);
		const top = seats.get(1 * grid.width + 1)!;
		expect(top).toBeGreaterThan(0);
		const layer = layerWith(seats);

		const seated = fixtureOf(layer, 'seated');
		expect(seated.children[0].visible).toBe(false);
		expect(seated.children[1].position.y).toBeCloseTo(top);
		const standing = fixtureOf(layer, 'standing');
		expect(standing.children[0].visible).toBe(true);
		expect(standing.children[1].position.y).toBeCloseTo(1.5);

		const w = gridToWorld(grid, { x: 1, y: 1 });
		const over = layer.grid!.entries.find((e) => e.id === 'seated')!;
		expect([over.visual.x, over.visual.z]).toEqual([w.x, w.z]);
		expect(over.visual.y).toBeCloseTo(top + 0.1);
	});

	it("take the prop's size from its model once loaded, scaled with the prop", async () => {
		const model = await loadModel('brazier');
		const height = model!.entry.bounds.max[1];
		const scaled = [{ ...props[0], scale: 1.5 }];
		expect(lightSeats(grid, scaled).get(1 * grid.width + 1)).toBeCloseTo(height * 1.5);
	});

	it('are still picked by their flame', () => {
		const layer = layerWith(lightSeats(grid, props));
		layer.group.updateMatrixWorld(true);
		const w = gridToWorld(grid, { x: 1, y: 1 });
		const ray = new THREE.Raycaster(new THREE.Vector3(w.x, 10, w.z), new THREE.Vector3(0, -1, 0));
		expect(layer.pick(ray)).toBe('seated');
	});
});
