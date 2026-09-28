// A loosely typed view of the TSL the kinds' graphs use (#169). @types/three's TSL typings don't
// follow the swizzles and operator chains these graphs use, so the material module builds with
// `N` and `tsl` instead of casting at every step; the graphs are checked by building them on both
// backends (materials.svelte.spec.ts), not by tsc. Named imports, so the bundle keeps only these.

import {
	attribute,
	cameraViewMatrix,
	materialReference,
	max,
	normalGeometry,
	normalView,
	normalWorldGeometry,
	output,
	positionGeometry,
	positionLocal,
	positionView,
	positionWorld,
	sin,
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

export const tsl = {
	attribute: loose(attribute),
	cameraViewMatrix: loose(cameraViewMatrix),
	materialReference: loose(materialReference),
	max: loose(max),
	normalGeometry: loose(normalGeometry),
	normalView: loose(normalView),
	normalWorldGeometry: loose(normalWorldGeometry),
	output: loose(output),
	positionGeometry: loose(positionGeometry),
	positionLocal: loose(positionLocal),
	positionView: loose(positionView),
	positionWorld: loose(positionWorld),
	sin: loose(sin),
	texture: loose(texture),
	transformNormalToView: loose(transformNormalToView),
	uniform: loose(uniform),
	uv: loose(uv),
	vec2: loose(vec2),
	vec3: loose(vec3),
	vec4: loose(vec4)
};
