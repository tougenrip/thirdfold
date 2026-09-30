// The GM's handles on lights without a fixture (#209): only for the GM, one instanced mesh, and
// picking one gives its light.

import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Light } from '$lib/game/lights';
import { LightingLayer } from './lighting';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 6, height: 6 };
const lights: Light[] = [
	{ id: 'glow', pos: { x: 2, y: 3 }, radius: 3, color: '#8f7bff', on: true, kind: 'glow' },
	{ id: 'torch', pos: { x: 4, y: 1 }, radius: 3, color: '#ffa04d', on: true }
];

const layer = () => new LightingLayer();

/** A ray straight down onto a cell's centre. */
function rayOnto(x: number, y: number): THREE.Raycaster {
	const w = gridToWorld(grid, { x, y });
	return new THREE.Raycaster(new THREE.Vector3(w.x, 10, w.z), new THREE.Vector3(0, -1, 0));
}

const handlesOf = (l: LightingLayer) =>
	l.group.children.filter((o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);

describe('light handles', () => {
	it('are never made for players', () => {
		const l = layer();
		l.showHandles(grid, lights, null, false);
		expect(handlesOf(l)).toEqual([]);
		expect(l.pick(rayOnto(2, 3))).toBeNull();
	});

	it('mark the GM each fixture-less light, and picking one gives its id', () => {
		const l = layer();
		l.showHandles(grid, lights, null, true);
		const [handles] = handlesOf(l);
		expect(handles.count).toBe(1); // the glow; the torch has its fixture
		expect(l.pick(rayOnto(2, 3))).toBe('glow');
		expect(l.pick(rayOnto(0, 0))).toBeNull();
		// The same layer drawn for a player (a fogMode change) keeps none.
		l.showHandles(grid, lights, null, false);
		expect(handles.count).toBe(0);
	});
});
