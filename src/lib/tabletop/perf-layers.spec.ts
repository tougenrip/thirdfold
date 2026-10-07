import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { layerOf, passOf } from './perf-layers';

const node = (userData: Record<string, unknown>, parent: unknown = null, material?: unknown) =>
	({ userData, parent, material }) as unknown as Parameters<typeof layerOf>[0];

describe('perf layers (#264)', () => {
	it('puts a draw down to the nearest tagged layer, else its kind, else post', () => {
		const scene = node({});
		const walls = node({ perfLayer: 'walls' }, scene);
		const doors = node({ perfLayer: 'doors' }, walls);
		expect(layerOf(node({}, doors))).toBe('doors');
		expect(layerOf(node({}, walls))).toBe('walls');
		expect(layerOf(node({}, scene, { name: 'prop' }))).toBe('prop');
		expect(layerOf(node({}))).toBe('post');
	});

	it('tells the passes apart by camera and outputs', () => {
		const main = { isPerspectiveCamera: true, fov: 50, aspect: 1.7 } as unknown as THREE.Camera;
		const sun = { isOrthographicCamera: true } as unknown as THREE.Camera;
		const hero = { fov: 90, aspect: 1 } as unknown as THREE.Camera;
		const copy = { fov: 50, aspect: 1.7 } as unknown as THREE.Camera;
		const mrt = (...keys: string[]) => ({
			outputNodes: Object.fromEntries(keys.map((k) => [k, 1]))
		});
		expect(passOf({ camera: sun }, main)).toBe('shadow');
		expect(passOf({ camera: hero }, main)).toBe('hero');
		expect(passOf({ camera: main, mrt: mrt('output', 'emissive', 'hidden') }, main)).toBe('scene');
		expect(passOf({ camera: main, mrt: mrt('normal', 'velocity') }, main)).toBe('prepass');
		expect(passOf({ camera: copy }, main)).toBe('overlay');
		expect(passOf({ camera: main }, main)).toBe('output');
	});
});
