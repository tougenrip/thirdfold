import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { convexity, occlusionAt, solidOf } from './bake';
import { writeGlb } from './glb';
import { bakeModel, chamferOf, readModelSource, shapeAt, SHAPES, type PartSource } from './models';

const part = (shape: PartSource['shape'], size: number[], at: number[]): PartSource => ({
	shape,
	size: size as PartSource['size'],
	at: at as PartSource['at'],
	color: '#808080'
});
const up = new THREE.Vector3(0, 1, 0);

describe('part shapes (#190)', () => {
	it('a chamfered box has 44 triangles and keeps its outer size', () => {
		const g = shapeAt('box', [0.8, 0.5, 0.3]);
		expect(g.getIndex()!.count / 3).toBe(44);
		g.computeBoundingBox();
		const round = (v: THREE.Vector3) => v.toArray().map((n) => Number(n.toFixed(6)));
		expect(round(g.boundingBox!.min)).toEqual([-0.4, -0.25, -0.15]);
		expect(round(g.boundingBox!.max)).toEqual([0.4, 0.25, 0.15]);
	});

	it('chamfers keep their width however far a part is stretched', () => {
		expect(chamferOf([0.1, 0.1, 0.1])).toBeCloseTo(0.008);
		expect(chamferOf([0.1, 5, 0.1])).toBeCloseTo(0.008);
		expect(chamferOf([2, 2, 2])).toBe(0.04);
		expect(chamferOf([0.004, 1, 1])).toBe(0.001);
		// The chamfer's inner edge is the same distance in from each side, long or short.
		const g = shapeAt('box', [0.2, 3, 0.2]);
		const p = g.getAttribute('position');
		const xs = new Set(Array.from({ length: p.count }, (_, i) => Math.abs(p.getX(i)).toFixed(4)));
		const ys = new Set(Array.from({ length: p.count }, (_, i) => Math.abs(p.getY(i)).toFixed(4)));
		expect([...xs].sort()).toEqual(['0.0840', '0.1000']);
		expect([...ys].sort()).toEqual(['1.4840', '1.5000']);
	});

	it.each(SHAPES)('a %s has unit normals, faces wound outward and no slivers', (shape) => {
		const g = shapeAt(shape, [0.6, 0.4, 0.3]);
		const index = g.getIndex()!.array;
		const p = g.getAttribute('position');
		const n = g.getAttribute('normal');
		const [a, b, c, normal] = Array.from({ length: 4 }, () => new THREE.Vector3());
		for (let i = 0; i < n.count; i++) {
			expect(normal.fromBufferAttribute(n, i).length()).toBeCloseTo(1, 4);
		}
		for (let i = 0; i < index.length; i += 3) {
			a.fromBufferAttribute(p, index[i]);
			b.fromBufferAttribute(p, index[i + 1]).sub(a);
			c.fromBufferAttribute(p, index[i + 2]).sub(a);
			const face = b.cross(c);
			expect(face.length()).toBeGreaterThan(1e-9);
			// Outward: with its corners' normals (an oval cone's chamfer bends past 90° across).
			const corners = [index[i], index[i + 1], index[i + 2]].map((v) =>
				new THREE.Vector3().fromBufferAttribute(n, v)
			);
			expect(face.dot(corners[0].add(corners[1]).add(corners[2]))).toBeGreaterThan(0);
		}
	});
});

describe('the occlusion and convexity bake (#190)', () => {
	// A slab on the floor with a post standing on it.
	const slab = solidOf(part('box', [1, 0.2, 1], [0, 0.1, 0]));
	const post = solidOf(part('box', [0.2, 0.5, 0.2], [0, 0.45, 0]));

	it('is darker in the corner where two parts meet than on an open face', () => {
		const corner = occlusionAt(new THREE.Vector3(0.11, 0.2, 0), up, [slab, post]);
		const open = occlusionAt(new THREE.Vector3(0.4, 0.2, 0.4), up, [slab, post]);
		const top = occlusionAt(new THREE.Vector3(0, 0.7, 0), up, [slab, post]);
		expect(top).toBe(1);
		expect(corner).toBeLessThan(open);
		expect(corner).toBeLessThan(0.8);
	});

	it('darkens where a part meets the floor', () => {
		const side = new THREE.Vector3(1, 0, 0);
		const foot = occlusionAt(new THREE.Vector3(0.5, 0.01, 0), side, [slab]);
		const high = occlusionAt(new THREE.Vector3(0.5, 0.6, 0), side, []);
		expect(high).toBe(1);
		expect(foot).toBeLessThan(0.6);
	});

	it('is convex at a chamfered edge and flat on a plane', () => {
		const box = convexity(shapeAt('box', [0.5, 0.5, 0.5]));
		expect(Math.min(...box)).toBeGreaterThan(0.55);
		const plane = new THREE.PlaneGeometry(1, 1, 2, 2);
		expect(convexity(plane)[4]).toBeCloseTo(0.5, 5);
	});

	it('gives every vertex of a model its bake, and builds the same bytes twice', () => {
		const source = readModelSource(
			{
				parts: [
					{ shape: 'box', size: [1, 0.2, 1], at: [0, 0.1, 0], color: '#806040' },
					{ shape: 'cylinder', size: [0.2, 0.5, 0.2], at: [0, 0.45, 0], accent: true },
					{ shape: 'cone', size: [0.3, 0.3, 0.3], at: [0, 0.85, 0], color: '#406080' }
				]
			},
			new Set()
		);
		const meshes = bakeModel(source, () => '#fff');
		for (const m of meshes) {
			expect(m.bake!.length).toBe((m.positions.length / 3) * 2);
			expect(m.normals!.length).toBe(m.positions.length);
		}
		expect(writeGlb(meshes).equals(writeGlb(bakeModel(source, () => '#fff')))).toBe(true);
	});
});

describe('flames (#232)', () => {
	const sconce = {
		parts: [
			{ shape: 'box', size: [0.1, 0.3, 0.05], at: [0, 1.2, -0.4], color: '#3d3a38' },
			{ shape: 'sphere', size: [0.1, 0.12, 0.1], at: [0, 1.4, -0.35], emissive: true },
			{ shape: 'cone', size: [0.08, 0.16, 0.08], at: [0, 1.5, -0.35], emissive: true }
		]
	};

	it('bakes emissive parts into one white flame mesh beside the body', () => {
		const meshes = bakeModel(readModelSource(sconce, new Set()), () => '#fff');
		expect(meshes.map((m) => m.name)).toEqual(['body', 'flame']);
		const flame = meshes[1];
		expect(flame.colors!.every((c) => c === 1)).toBe(true);
		expect(flame.bake!.length).toBe((flame.positions.length / 3) * 2);
		// The body keeps its own colour, unshaded by the flame beside it.
		expect(meshes[0].colors![0]).toBeLessThan(0.1);
	});

	it('refuses a flame with a colour, a swing or an accent, and a flag that is not true', () => {
		const flame = sconce.parts[1];
		const read = (p: object) => () => readModelSource({ parts: [p] }, new Set(['iron']));
		expect(read({ ...flame, color: '#ff8800' })).toThrow(/a flame is white/);
		expect(read({ ...flame, material: 'iron' })).toThrow(/a flame is white/);
		expect(read({ ...flame, accent: true })).toThrow(/a flame is white/);
		expect(read({ ...flame, swings: true })).toThrow(/a flame is white/);
		expect(read({ ...flame, emissive: 'yes' })).toThrow(/"emissive" is true or absent/);
	});
});
