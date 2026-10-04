// The warm-up gallery (#180): one tiny mesh for every shader kind and every variant the layers
// make of it, built from the kinds registry, so a new kind or variant joins by itself. The lobby
// compiles it (lobby.ts) before any table exists, so entering one compiles what only that table
// adds. It holds only the kinds' blanks and defaults: no texture, model or environment of any
// adventure, so compiling it fetches nothing that tells where a story goes (#111 G3). Only the
// paint maps load, when the first painted graph is built (#178), and they are the same for all.

import * as THREE from 'three/webgpu';
import {
	addInstanceTints,
	createMaterial,
	SHADER_KINDS,
	withBake,
	type MaterialOptions
} from './index';
import type { ShaderKind } from './kinds';

/** The variants each kind is made in besides plain and instanced (the layers' own, #172, #177, #181, #241). */
function variantsOf(kind: ShaderKind): MaterialOptions[] {
	const world = kind === 'surface' || kind === 'terrain' || kind === 'rock';
	const out: MaterialOptions[] = [{}];
	if (world) out.push({ antiTiled: true });
	if (kind === 'prop' || kind === 'mini') out.push({ vertexColors: true });
	const each = out.flatMap((v) => [v, { ...v, instanced: true }]);
	// The cliffs' and risers' faces (#241): rock with vertex colours, biplanar and triplanar.
	if (kind === 'rock') each.push({ vertexColors: true }, { vertexColors: true, antiTiled: true });
	return each;
}

/** A box with every attribute a kind may read: normals, uv, vertex colours and the bake. */
function geometryFor(options: MaterialOptions): THREE.BufferGeometry {
	const geometry = withBake(new THREE.BoxGeometry(0.01, 0.01, 0.01));
	if (options.vertexColors) {
		const count = geometry.getAttribute('position').count;
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
	}
	if (options.instanced) addInstanceTints(geometry, 1);
	return geometry;
}

/** A mesh of `kind` made with `options`, casting and taking shadows or not, never culled. */
function sample(kind: ShaderKind, options: MaterialOptions, shadows: boolean): THREE.Object3D {
	const geometry = geometryFor(options);
	const material = createMaterial(kind, options);
	const mesh = options.instanced
		? new THREE.InstancedMesh(geometry, material, 1)
		: new THREE.Mesh(geometry, material);
	if (mesh instanceof THREE.InstancedMesh) mesh.setMatrixAt(0, new THREE.Matrix4());
	mesh.castShadow = mesh.receiveShadow = shadows;
	mesh.frustumCulled = false;
	return mesh;
}

/**
 * The gallery: every kind in each of its variants, with and without shadows, plus the local
 * mapping (door panels, #177) and the overlay's lines. Kept, not disposed: disposing its
 * materials would release the programs the table is to reuse.
 */
export function kindGallery(): THREE.Object3D[] {
	const out: THREE.Object3D[] = [];
	for (const kind of SHADER_KINDS)
		for (const options of variantsOf(kind))
			for (const shadows of [false, true]) out.push(sample(kind, options, shadows));
	for (const kind of ['surface', 'terrain', 'rock'] as const)
		out.push(sample(kind, { local: true }, true));
	const points = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(),
		new THREE.Vector3(1)
	]);
	const lines = new THREE.LineSegments(points, createMaterial('overlay', { lines: true }));
	lines.frustumCulled = false;
	out.push(lines);
	return out;
}
