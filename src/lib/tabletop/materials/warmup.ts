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
	withDrops,
	type MaterialOptions
} from './index';
import type { ShaderKind } from './kinds';
import { ROOF_CELL_ATTRIBUTE } from './world-modify';
import { ROOF_KEY_ATTRIBUTE } from './roof-fade';

/** The variants each kind is made in besides plain and instanced (the layers' own, #172, #177, #181, #241, #249). */
function variantsOf(kind: ShaderKind): MaterialOptions[] {
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

/** A box with every attribute a kind may read: normals, uv, vertex colours and the bake. */
function geometryFor(options: MaterialOptions): THREE.BufferGeometry {
	const geometry = withBake(new THREE.BoxGeometry(0.01, 0.01, 0.01));
	if (options.vertexColors) {
		const count = geometry.getAttribute('position').count;
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
	}
	if (options.instanced) addInstanceTints(geometry, 1);
	if (options.dropped) withDrops(geometry);
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
	// The walls' batches (#252): positions, normals and triangles only, colours from the start.
	for (const antiTiled of [false, true])
		for (const vertexColors of [false, true]) {
			const box = new THREE.BoxGeometry(0.01, 0.01, 0.01).deleteAttribute('uv');
			const count = box.getAttribute('position').count;
			const color = new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
			if (vertexColors) box.setAttribute('color', color);
			const material = createMaterial('surface', { batched: true, antiTiled, vertexColors });
			const batch = new THREE.BatchedMesh(1, 24, 36, material);
			(batch as unknown as { _initColorsTexture(): void })._initColorsTexture();
			batch.addInstance(batch.addGeometry(box));
			batch.castShadow = batch.receiveShadow = true;
			batch.frustumCulled = false;
			out.push(batch);
		}
	// A kit's trim sheet (M70): the same batch with colours and UVs, on the `sheet` graph.
	const sheeted = new THREE.BoxGeometry(0.01, 0.01, 0.01);
	const vertices = sheeted.getAttribute('position').count;
	sheeted.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
	const sheet = new THREE.BatchedMesh(
		1,
		24,
		36,
		createMaterial('surface', { batched: true, sheet: true })
	);
	(sheet as unknown as { _initColorsTexture(): void })._initColorsTexture();
	sheet.addInstance(sheet.addGeometry(sheeted));
	sheet.castShadow = sheet.receiveShadow = true;
	sheet.frustumCulled = false;
	out.push(sheet);
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
