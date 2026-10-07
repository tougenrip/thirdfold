// Large creatures' bases (#270): a token's scale picks its base's mesh, a mini beside it shrinks it
// to the small one, a lifted figure leaves its base on the floor, and a large base's rim over a
// neighbouring cell never takes that cell's click.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it } from 'vitest';
import { gridToWorld, type SquareGrid } from '$lib/game/grid';
import type { Token } from '$lib/game/token';
import { OverlayLayer } from './overlay';
import { TokenLayer } from './tokens';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 6, height: 6 };
const token = (id: string, x: number, y: number, more: Partial<Token> = {}): Token => ({
	id,
	name: id,
	color: '#8a3b3b',
	pos: { x, y },
	ownerId: null,
	vision: 0,
	light: 0,
	...more
});
const keeper = token('keeper', 2, 2, { scale: 1.8 });

let layer: TokenLayer;
afterEach(() => layer?.dispose());

/** A ray straight down onto a world point `dx` cells east of a cell's centre. */
function rayOnto(x: number, y: number, dx = 0): THREE.Raycaster {
	const w = gridToWorld(grid, { x, y });
	return new THREE.Raycaster(new THREE.Vector3(w.x + dx, 10, w.z), new THREE.Vector3(0, -1, 0));
}

const counts = (l: TokenLayer) => l.bases.meshes.map((m) => (m.visible ? m.count : 0));

describe('large bases', () => {
	it('stand a scaled token on the base of its size, in a mesh of its own', () => {
		layer = new TokenLayer(new OverlayLayer());
		layer.sync([keeper, token('pip', 5, 5)], grid, null, true);
		expect(layer.bases.diameter('keeper')).toBe(1.9);
		expect(layer.bases.diameter('pip')).toBe(0.86);
		expect(counts(layer)).toEqual([1, 1]);
		const big = layer.bases.meshes[1];
		big.geometry.computeBoundingBox();
		expect(big.geometry.boundingBox!.max.x * 2).toBeCloseTo(1.9);
		expect(big.geometry.boundingBox!.max.y).toBeCloseTo(0.1); // as tall as a small one
	});

	it('shrinks to the small base with a mini beside it, and grows back when it goes', () => {
		layer = new TokenLayer(new OverlayLayer());
		layer.sync([keeper, token('pip', 3, 2)], grid, null, true);
		expect(layer.bases.diameter('keeper')).toBe(0.86);
		expect(counts(layer)).toEqual([2]); // no large mesh made yet
		layer.sync([keeper, token('pip', 4, 2)], grid, null, true);
		expect(layer.bases.diameter('keeper')).toBe(1.9);
		expect(counts(layer)).toEqual([1, 1]);
		layer.sync([keeper, token('pip', 3, 2)], grid, null, true);
		expect(counts(layer)).toEqual([2, 0]); // the large mesh kept, not drawn
		expect(layer.bases.meshes[1].visible).toBe(false);
	});

	it("leaves a neighbouring cell's click to the cell, under the rim", () => {
		layer = new TokenLayer(new OverlayLayer());
		layer.sync([keeper], grid, null, true);
		// 0.85 east of the Keeper's centre: the next cell, on its 0.95 rim, clear of the figure.
		const rim = rayOnto(2, 2, 0.85);
		expect(rim.intersectObjects(layer.bases.meshes).length).toBeGreaterThan(0);
		expect(layer.pick(rim)).toBeNull();
		expect(layer.pick(rayOnto(2, 2, 0.3))).toBe('keeper'); // the centre disc
		expect(layer.pick(rayOnto(2, 2))).toBe('keeper');
	});

	it("keeps a lifted figure's base on the floor", () => {
		layer = new TokenLayer(new OverlayLayer());
		layer.sync([token('bat', 1, 1, { lift: 2 })], grid, null, true);
		const m = new THREE.Matrix4();
		layer.bases.meshes[0].getMatrixAt(0, m);
		expect(new THREE.Vector3().setFromMatrixPosition(m).y).toBe(0);
		expect(layer.rootOf('bat')!.position.y).toBeGreaterThan(0);
	});
});
