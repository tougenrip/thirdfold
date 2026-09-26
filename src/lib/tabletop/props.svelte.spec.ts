import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { Prop } from '$lib/game/props';
import { PropLayer } from './props';

const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 10, height: 10 };
const crate = (x: number): Prop => ({
	id: 'crate',
	assetId: 'crate',
	pos: { x, y: 2 },
	rotation: 0,
	scale: 1
});

/** Where the crate is drawn now (x). */
function drawnX(layer: PropLayer): number {
	const mesh = layer.group.children.find((c) => c instanceof THREE.InstancedMesh);
	if (!(mesh instanceof THREE.InstancedMesh)) throw new Error('no prop mesh');
	const m = new THREE.Matrix4();
	mesh.getMatrixAt(0, m);
	return new THREE.Vector3().setFromMatrixPosition(m).x;
}

describe('a prop that moves', () => {
	it('glides on the injected clock, and holds still while the clock does', () => {
		let now = 10_000;
		const layer = new PropLayer(undefined, () => now);
		layer.sync([crate(1)], grid);
		const from = drawnX(layer);
		layer.sync([crate(4)], grid);
		layer.tick(now);
		expect(drawnX(layer)).toBeCloseTo(from);
		// The clock holds still: nothing moves however often it is drawn.
		expect(layer.tick(now)).toBe(true);
		expect(drawnX(layer)).toBeCloseTo(from);
		now += 450;
		expect(layer.tick(now)).toBe(false);
		expect(drawnX(layer)).toBeCloseTo(from + 3);
		layer.dispose();
	});
});
