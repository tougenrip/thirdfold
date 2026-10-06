import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { DrawDepths, unlit, type RenderContexts } from './warmup';

describe('the warm-up compiles as frames draw', () => {
	/** Three's render contexts in miniature: one per target, outputs and depth. */
	function contexts() {
		const made = new Map<string, object>();
		const ids = new Map<object | null, number>();
		const id = (o: object | null) => ids.get(o) ?? (ids.set(o, ids.size), ids.size - 1);
		const c: RenderContexts = {
			get: (target = null, mrt = null, depth = 0) => {
				const key = `${id(target)}-${id(mrt)}-${depth}`;
				return made.get(key) ?? (made.set(key, { key }), made.get(key)!);
			}
		};
		return c;
	}

	it('compiles a target in the context its frames last drew it in', () => {
		const c = contexts();
		const depths = new DrawDepths(c);
		const [scenePass, mrt] = [{}, {}];
		const drawn = c.get(scenePass, mrt, 2); // a frame: the scene pass nested in the pipeline
		expect(c.get(scenePass, mrt)).not.toBe(drawn); // compileAsync outside a warm-up: depth 0
		depths.warming = true;
		expect(c.get(scenePass, mrt)).toBe(drawn);
		expect(c.get(scenePass, null)).not.toBe(drawn); // other outputs: never drawn, depth 0
		expect(c.get(null, null)).toBe(c.get(null, null, 0)); // the canvas
		c.get(scenePass, mrt, -1); // a clear's context records nothing
		expect(c.get(scenePass, mrt)).toBe(drawn);
	});

	it('leaves lights out, which would key every graph on lights no frame draws with', () => {
		const torch = new THREE.PointLight();
		const lamp = new THREE.Group().add(new THREE.SpotLight());
		const prop = new THREE.Mesh();
		const fixture = new THREE.Mesh();
		lamp.add(fixture);
		expect(unlit([torch, prop, lamp])).toEqual([prop, fixture]);
	});
});
