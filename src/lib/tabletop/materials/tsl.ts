// A loosely typed view of the TSL the kinds' graphs use (#169). @types/three's TSL typings don't
// follow the swizzles and operator chains these graphs use, so the material module builds with
// `N` and `tsl` instead of casting at every step; the graphs are checked by building them on both
// backends (materials.svelte.spec.ts), not by tsc. Named imports, so the bundle keeps only these.

import { MaterialReferenceNode } from 'three/webgpu';
import {
	attribute,
	cameraViewMatrix,
	max,
	mix,
	mx_fractal_noise_float,
	mx_noise_float,
	normalGeometry,
	normalLocal,
	normalView,
	normalWorldGeometry,
	output,
	positionGeometry,
	positionLocal,
	positionView,
	positionWorld,
	sin,
	smoothstep,
	texture,
	transformNormalToView,
	uniform,
	uv,
	vec2,
	vec3,
	vec4
} from 'three/tsl';

/** A TSL node whose methods and swizzles are all nodes. */
export type N = { [key: string]: N & ((...args: unknown[]) => N) };

type Loose = N & ((...args: unknown[]) => N);
const loose = (f: unknown) => f as Loose;

/**
 * A reference to a property of the drawn object's own material when it is a kind material (it has
 * `params`), else of the material drawing it. three's `materialReference` reads the latter, which
 * in a shadow or override pass is three's own material, with no `params` or slots, while it still
 * runs the kind's position and colour nodes (Renderer `_getShadowNodes`, #172).
 */
class OwnReferenceNode extends MaterialReferenceNode {
	updateReference(state: Parameters<MaterialReferenceNode['updateReference']>[0]) {
		const drawn = state as unknown as { object?: { material?: unknown } | null; material: unknown };
		const own = drawn.object?.material as { params?: unknown } | undefined;
		const self = this as unknown as { reference: unknown };
		self.reference = own?.params ? own : drawn.material;
		return self.reference;
	}
}

export const tsl = {
	attribute: loose(attribute),
	cameraViewMatrix: loose(cameraViewMatrix),
	/** `materialReference`, of the drawn object's own kind material (`OwnReferenceNode`). */
	materialReference: loose((name: string, type: string) => new OwnReferenceNode(name, type)),
	max: loose(max),
	mix: loose(mix),
	mx_fractal_noise_float: loose(mx_fractal_noise_float),
	mx_noise_float: loose(mx_noise_float),
	normalGeometry: loose(normalGeometry),
	normalLocal: loose(normalLocal),
	normalView: loose(normalView),
	normalWorldGeometry: loose(normalWorldGeometry),
	output: loose(output),
	positionGeometry: loose(positionGeometry),
	positionLocal: loose(positionLocal),
	positionView: loose(positionView),
	positionWorld: loose(positionWorld),
	sin: loose(sin),
	smoothstep: loose(smoothstep),
	texture: loose(texture),
	transformNormalToView: loose(transformNormalToView),
	uniform: loose(uniform),
	uv: loose(uv),
	vec2: loose(vec2),
	vec3: loose(vec3),
	vec4: loose(vec4)
};
