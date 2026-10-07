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
	pieceMesh,
	PIECE_MIN,
	SHADER_KINDS,
	withBake,
	withDrops,
	type MaterialOptions
} from './index';
import type { ShaderKind } from './kinds';
import { ROOF_CELL_ATTRIBUTE } from './world-modify';
import { ROOF_KEY_ATTRIBUTE } from './roof-fade';

/** The variants each kind is made in besides plain and instanced (the layers' own, #172, #177, #181, #241, #249). */
function variantsOf(kind: ShaderKind): MaterialOptions[] {
	if (kind === 'base') return [{ instanced: true }]; // token bases (#265): only ever instanced
	const world = kind === 'surface' || kind === 'terrain' || kind === 'rock';
	const out: MaterialOptions[] = [{}];
	if (world) out.push({ antiTiled: true });
	if (kind === 'prop' || kind === 'mini') out.push({ vertexColors: true });
	const each = out.flatMap((v) => [v, { ...v, instanced: true }]);
	// The cliffs' and risers' faces (#241): rock with vertex colours, biplanar and triplanar.
	if (kind === 'rock') each.push({ vertexColors: true }, { vertexColors: true, antiTiled: true });
	// The world's chunks drop in (#249): their tops and faces, both anti-tilings.
	if (kind === 'terrain') each.push({ dropped: true }, { dropped: true, antiTiled: true });
	if (kind === 'rock')
		each.push(
			{ vertexColors: true, dropped: true },
			{ vertexColors: true, antiTiled: true, dropped: true }
		);
	return each;
}

/** A box with every attribute `kind` may read: normals, uv, vertex colours and the bake. */
function geometryFor(kind: ShaderKind, options: MaterialOptions): THREE.BufferGeometry {
	const geometry = withBake(new THREE.BoxGeometry(0.01, 0.01, 0.01));
	if (options.vertexColors) {
		const count = geometry.getAttribute('position').count;
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
	}
	// An instanced mini's paint is a vec4 (tint and opacity, #266), a prop's a vec3.
	if (options.instanced) addInstanceTints(geometry, 1, kind === 'mini' ? 4 : 3);
	if (options.dropped) withDrops(geometry);
	return geometry;
}

/** A mesh of `kind` made with `options`, casting and taking shadows or not, never culled. */
function sample(kind: ShaderKind, options: MaterialOptions, shadows: boolean): THREE.Object3D {
	const geometry = geometryFor(kind, options);
	const material = createMaterial(kind, options);
	// Token bases are one pool-sized mesh (#265, base-layer.ts): its matrices an attribute.
	const n = kind === 'base' ? PIECE_MIN : 1;
	if (n > 1) addInstanceTints(geometry, n);
	const mesh = options.instanced
		? new THREE.InstancedMesh(geometry, material, n)
		: new THREE.Mesh(geometry, material);
	if (mesh instanceof THREE.InstancedMesh) {
		mesh.setMatrixAt(0, new THREE.Matrix4());
		mesh.count = 1;
	}
	mesh.castShadow = mesh.receiveShadow = shadows;
	mesh.frustumCulled = false;
	return mesh;
}

/**
 * The gallery: every kind in each of its variants, with and without shadows, plus the local
 * mapping (door panels, #177), the walls' batches (#252) and trim sheets (M70), roofs (#257) and the overlay's lines. Kept, not disposed: disposing its
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
	// Kit pieces (#252, M70): pool-shaped meshes (piece.ts), with colours or not, and a trim sheet's
	// with UVs on the `sheet` graph.
	const pieces: MaterialOptions[] = [
		{ antiTiled: false },
		{ antiTiled: false, vertexColors: true },
		{ antiTiled: true },
		{ antiTiled: true, vertexColors: true },
		{ sheet: true }
	];
	for (const options of pieces) {
		const box = new THREE.BoxGeometry(0.01, 0.01, 0.01);
		if (!options.sheet) box.deleteAttribute('uv');
		const count = box.getAttribute('position').count;
		const color = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
		if (options.vertexColors) box.setAttribute('color', color);
		const mesh = pieceMesh(box, createMaterial('surface', { piece: true, ...options }));
		mesh.setMatrixAt(0, new THREE.Matrix4());
		mesh.count = 1;
		mesh.frustumCulled = false;
		out.push(mesh);
	}
	// Roofs (#257): positions, normals, triangles, the roof cell, the pieces' colours (#258) and the fade's key (#259);
	// casting and taking shadows.
	const roof = new THREE.BoxGeometry(0.01, 0.01, 0.01).deleteAttribute('uv');
	const corners = roof.getAttribute('position').count;
	roof.setAttribute(
		ROOF_CELL_ATTRIBUTE,
		new THREE.BufferAttribute(new Float32Array(corners * 2), 2)
	);
	roof.setAttribute(
		ROOF_KEY_ATTRIBUTE,
		new THREE.BufferAttribute(new Float32Array(corners * 2), 2)
	);
	roof.setAttribute('color', new THREE.BufferAttribute(new Float32Array(corners * 3).fill(1), 3));
	const roofed = new THREE.Mesh(
		roof,
		createMaterial('surface', { roof: true, vertexColors: true })
	);
	roofed.castShadow = roofed.receiveShadow = true;
	roofed.frustumCulled = false;
	out.push(roofed);
	const lines = new THREE.LineSegments(points, createMaterial('overlay', { lines: true }));
	lines.frustumCulled = false;
	out.push(lines);
	return out;
}
