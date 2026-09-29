// The asset turntable's pieces (#194) on the WebGL2 fallback: it lists every manifest model, and
// draws the loader's cooked fixture (tests/fixtures/assets/loader) at each of its levels, a
// figure on its base. The whole turntable is looked at by hand at /dev/assets.

import * as THREE from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadManifest } from '$lib/assets/load';
import type { Manifest, ModelEntry } from '$lib/assets/manifest';
import { initModels, loadModel, releaseModels } from './models';
import { modelGroup, modelList, sideFor, texturesOf, trianglesByLod } from './turntable';

const ID = 'loader-cube';
const FILE = 'models/loader-cube.0123abcd.glb';
let renderer: THREE.WebGPURenderer;

beforeAll(async () => {
	const fixture = await (await fetch('/tests/fixtures/assets/loader/cube.glb')).arrayBuffer();
	const real = fetch.bind(globalThis);
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input);
		if (url.endsWith(`/assets/${FILE}`)) return new Response(fixture.slice(0));
		if (!url.endsWith('/assets/manifest.json')) return real(input, init);
		const manifest = (await (await real(input, init)).json()) as Manifest;
		const entry: ModelEntry = {
			file: FILE,
			bytes: fixture.byteLength,
			sha256: `0123abcd${'0'.repeat(56)}`,
			kind: 'character',
			triangles: 36,
			bounds: { min: [-0.25, 0, -0.25], max: [0.25, 1.1, 0.25] },
			gpuBytes: 4096,
			lods: [{ triangles: 12, screenSize: 0.1 }],
			cooked: true,
			credit: { license: 'LicenseRef-thirdfold-original', author: 'thirdfold contributors' }
		};
		manifest.models[ID] = entry;
		return Response.json(manifest);
	});
	renderer = new THREE.WebGPURenderer({
		canvas: document.createElement('canvas'),
		forceWebGL: true
	});
	await renderer.init();
	initModels(renderer);
});

afterAll(() => {
	releaseModels();
	vi.restoreAllMocks();
	renderer.dispose();
});

describe('the asset turntable', () => {
	it('lists every manifest model by kind, and finds them by id or kind', async () => {
		const manifest = await loadManifest();
		const all = modelList(manifest).map(([id]) => id);
		expect(all.sort()).toEqual(Object.keys(manifest.models).sort());
		const kinds = modelList(manifest).map(([, e]) => e.kind);
		expect(kinds).toEqual([...kinds].sort());
		expect(modelList(manifest, 'great').map(([id]) => id)).toEqual(['great-bell']);
		expect(modelList(manifest, 'enemy').every(([, e]) => e.kind === 'enemy')).toBe(true);
	});

	it('draws a model at each of its levels, a figure on its base', async () => {
		const model = (await loadModel(ID))!;
		expect(trianglesByLod(model)).toEqual([36, 12]);
		expect(texturesOf(model)).toEqual([
			expect.objectContaining({ slot: 'albedo', compressed: true })
		]);
		const at = (lod: number) => {
			const { group, materials } = modelGroup(model, lod);
			const meshes = group.children as THREE.Mesh[];
			const drawn = meshes.slice(1).map((m) => m.geometry);
			expect(meshes[0].geometry).toBeInstanceOf(THREE.CylinderGeometry); // the base
			expect(materials.every((m) => m.kind === 'mini')).toBe(true);
			for (const m of materials) m.dispose();
			return drawn;
		};
		const full = model.parts.filter((p) => p.lod === 0).map((p) => p.geometry);
		expect(at(0)).toEqual(full);
		expect(at(1)).toEqual(model.parts.filter((p) => p.lod === 1).map((p) => p.geometry));
		expect(at(1)).not.toEqual(full);
	});

	it('gives a model a table wide enough, with its centre cell at the origin', () => {
		expect(sideFor({ min: [-0.3, 0, -0.3], max: [0.3, 1, 0.3] })).toBe(5);
		expect(sideFor({ min: [-1.5, 0, -1.5], max: [1.5, 4, 1.5] })).toBe(7);
		expect(sideFor({ min: [-2, 0, -0.5], max: [2, 0.1, 0.5] }) % 2).toBe(1);
	});
});
