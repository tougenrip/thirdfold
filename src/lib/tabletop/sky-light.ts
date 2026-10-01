// The sky's lights, masked by sky visibility (#219): `SkyLight` is the key light (the sun or the
// moon, the only directional light), whose direct light and shadows every fragment takes times
// `skySun`, and `SkyHemisphere` the sky's ambient, whose irradiance it takes times `skyAmbient`
// (materials/world-modify.ts), so a dark area stays as dark at noon as at midnight and a roof keeps
// its indoor fill without the sun. Point lights are untouched. Each node class is registered on
// the renderer's node library before its first compile (`registerSkyLights`, from
// `createNodeRenderer`), the pattern of three's `SunLight`: the library maps a light's exact
// class, so registering against `DirectionalLight` itself would be ignored. The terms are the
// same shared nodes on every renderer, so nothing here compiles a program at runtime.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import type { N } from './materials/tsl';
import { skyAmbient, skySun } from './materials/world-modify';

/** The key light, masked by sky visibility. */
export class SkyLight extends THREE.DirectionalLight {}

/** The sky's ambient light, masked by sky visibility. */
export class SkyHemisphere extends THREE.HemisphereLight {}

// Loosely typed, as tsl.ts does for the kinds; @types/three leaves the hemisphere's nodes off.
const { mix, normalWorld } = T as unknown as { mix: (...args: unknown[]) => N; normalWorld: N };
type Hemisphere = Record<'colorNode' | 'groundColorNode' | 'lightDirectionNode', N>;
type Setup = ReturnType<THREE.HemisphereLightNode['setup']>;

class SkyLightNode extends THREE.DirectionalLightNode {
	static get type() {
		return 'SkyLightNode';
	}

	/** Three's own, its colour (shadow included) times the sun term. */
	setupDirect(builder: THREE.NodeBuilder) {
		const direct = super.setupDirect(builder) as unknown as { lightColor: N };
		return { ...direct, lightColor: direct.lightColor.mul(skySun()) } as unknown as ReturnType<
			THREE.DirectionalLightNode['setupDirect']
		>;
	}
}

class SkyHemisphereNode extends THREE.HemisphereLightNode {
	static get type() {
		return 'SkyHemisphereNode';
	}

	/** Three's own setup, its irradiance times the ambient term. */
	setup(builder: THREE.NodeBuilder): Setup {
		const { colorNode, groundColorNode, lightDirectionNode } = this as unknown as Hemisphere;
		const weight = normalWorld.dot(lightDirectionNode).mul(0.5).add(0.5);
		const irradiance = mix(groundColorNode, colorNode, weight).mul(skyAmbient());
		(builder.context as unknown as { irradiance: N }).irradiance.addAssign(irradiance);
		return undefined;
	}
}

const registered = new WeakSet<object>();

/** Maps the sky's lights to their nodes on a renderer: before its first compile, once each. */
export function registerSkyLights(renderer: THREE.WebGPURenderer): void {
	const library = renderer.library;
	if (registered.has(library)) return;
	registered.add(library);
	library.addLight(SkyLightNode, SkyLight);
	library.addLight(SkyHemisphereNode, SkyHemisphere);
}
