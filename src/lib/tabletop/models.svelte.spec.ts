// The model loader (#188) on the WebGL2 fallback: a cooked file (meshopt geometry, a KTX2
// texture; tests/fixtures/assets/loader, made by server/fixtures/loader-fixture.ts) loads into
// parts by role and level, with its node transforms, its texture in the mini kind's albedo slot,
// and is freed with the transcoder's workers when the last table goes, round after round. A
// model with a preview (#192) shows it before the full model, and a table's prefetch fetches
// only what it was sent.

import * as THREE from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadManifest } from '$lib/assets/load';
import type { Manifest, ModelEntry } from '$lib/assets/manifest';
import type { SquareGrid } from '$lib/game/grid';
import {
	initModels,
	loadModel,
	lodFor,
	modelNow,
	partsOf,
	prefetch,
	releaseModels,
	roleOf,
	type LoadedModel
} from './models';
import { OverlayLayer } from './overlay';
import { TokenLayer } from './tokens';

const ID = 'loader-cube';
const FILE = 'models/loader-cube.0123abcd.glb';
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 3, height: 3 };
/** A model with a preview, each file held back until its gate opens. */
const STAGED = 'staged-cube';
const STAGED_FILES = {
	full: 'models/staged-cube.1111aaaa.glb',
	preview: 'previews/staged-cube.2222bbbb.glb'
};
const gates = new Map<keyof typeof STAGED_FILES, () => void>();
const token = { id: 't', name: 'T', color: '#ff0000', pos: { x: 1, y: 1 }, ownerId: null };

let renderer: THREE.WebGPURenderer;
const warn = vi.spyOn(console, 'warn');

beforeAll(async () => {
	const fixture = await (await fetch('/tests/fixtures/assets/loader/cube.glb')).arrayBuffer();
	const real = fetch.bind(globalThis);
	// The page's manifest with the fixture in it, and the fixture where its entry says.
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = String(input);
		if (url.endsWith(`/assets/${FILE}`)) return new Response(fixture.slice(0));
		for (const [stage, file] of Object.entries(STAGED_FILES) as [
			keyof typeof STAGED_FILES,
			string
		][])
			if (url.endsWith(`/assets/${file}`))
				return new Promise((resolve) =>
					gates.set(stage, () => resolve(new Response(fixture.slice(0))))
				);
		if (!url.split('?')[0].endsWith('/assets/manifest.json')) return real(input, init);
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
		const sha = (file: string) => file.split('.').at(-2) + '0'.repeat(56);
		const { full, preview } = STAGED_FILES;
		manifest.models[STAGED] = {
			...entry,
			file: full,
			sha256: sha(full),
			preview: {
				file: preview,
				bytes: fixture.byteLength,
				sha256: sha(preview),
				credit: entry.credit
			}
		};
		return Response.json(manifest);
	});
	renderer = new THREE.WebGPURenderer({
		canvas: document.createElement('canvas'),
		forceWebGL: true
	});
	await renderer.init();
});

afterAll(() => {
	vi.restoreAllMocks();
	renderer.dispose();
});

/** Loads the fixture as a table would, draws it on a mini, then lets the table go. */
async function round(): Promise<{ model: LoadedModel; drawn: THREE.Mesh[]; freed: string[] }> {
	initModels(renderer);
	const model = (await loadModel(ID))!;
	const layer = new TokenLayer(new OverlayLayer());
	layer.sync([{ ...token, vision: 0, light: 0, model: ID }], grid, null, true);
	const drawn: THREE.Mesh[] = [];
	layer.group.traverse(
		// A figure batch draws a copy of the part (figures.ts, #266).
		(o) =>
			o instanceof THREE.Mesh &&
			o.userData.source === model.parts[0]?.geometry &&
			(o as THREE.InstancedMesh).count === 1 &&
			drawn.push(o)
	);
	const scene = new THREE.Scene().add(layer.group);
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
	camera.position.set(1, 3, 4);
	camera.lookAt(1, 0, 1);
	renderer.render(scene, camera);
	const freed: string[] = [];
	for (const p of model.parts) p.geometry.addEventListener('dispose', () => freed.push(p.role));
	model.parts[0].maps?.albedo?.addEventListener('dispose', () => freed.push('albedo'));
	layer.dispose();
	releaseModels();
	renderer.render(new THREE.Scene(), camera);
	return { model, drawn, freed };
}

describe('the model loader', () => {
	it('reads roles and levels from mesh names as GLTFLoader makes them', () => {
		expect(roleOf('body')).toEqual({ role: 'body', lod: 0 });
		expect(roleOf('body_1')).toEqual({ role: 'body', lod: 0 });
		expect(roleOf('swing_lod2')).toEqual({ role: 'swing', lod: 2 });
		expect(roleOf('accent_lod1_3')).toEqual({ role: 'accent', lod: 1 });
		expect(roleOf('body001')).toBeNull();
		expect(roleOf('handle')).toBeNull();
		const lods = [
			{ triangles: 100, screenSize: 0.3 },
			{ triangles: 20, screenSize: 0.1 }
		];
		expect([0.5, 0.2, 0.05].map((s) => lodFor(lods, s))).toEqual([0, 1, 2]);
		expect(lodFor(undefined, 0.01)).toBe(0);
	});

	it("keeps a part list's baked occlusion (#190)", async () => {
		initModels(renderer);
		const [body] = partsOf((await loadModel('crate'))!, 'body');
		const bake = body.geometry.getAttribute('aBake');
		const ao = Array.from({ length: bake.count }, (_, i) => bake.getX(i));
		expect(Math.max(...ao)).toBe(1);
		// Where the crate meets the floor, and under its band.
		expect(Math.min(...ao)).toBeLessThan(0.7);
		releaseModels();
	});

	it('loads a cooked model into parts with its transforms and texture, and frees it', async () => {
		const { model, drawn, freed } = await round();
		expect(model.parts.map((p) => `${p.role}${p.lod}`).sort()).toEqual([
			'body0',
			'body1',
			'swing0'
		]);
		const [body] = partsOf(model, 'body');
		// One attribute set for every part, textured or not: the same program as a part list.
		for (const p of model.parts) {
			expect(Object.keys(p.geometry.attributes).sort()).toEqual([
				'aBake',
				'color',
				'normal',
				'position',
				'uv'
			]);
			// No `_BAKE` in the file: open to the sky and flat (#190).
			const bake = p.geometry.getAttribute('aBake');
			expect([bake.getX(0), bake.getY(0)]).toEqual([1, 0.5]);
		}
		// Its two pieces in one material, merged; the body's node lifts it 0.25 off the floor.
		expect(body.geometry.getAttribute('position').count).toBe(48);
		body.geometry.computeBoundingBox();
		expect(body.geometry.boundingBox!.min.y).toBeCloseTo(0.25, 2);
		expect(body.geometry.boundingBox!.max.y).toBeCloseTo(0.75, 2);
		// Transcoded for this device: a compressed format, or plain RGBA without one (SwiftShader).
		const albedo = body.maps!.albedo!;
		expect((albedo as THREE.CompressedTexture).isCompressedTexture).toBe(true);
		expect(albedo.mipmaps!.length).toBeGreaterThan(1);
		expect(albedo.generateMipmaps).toBe(false);
		expect(albedo.colorSpace).toBe(THREE.SRGBColorSpace);
		expect(partsOf(model, 'swing')[0].maps).toBeNull();
		// Drawn on the mini with a material of its own, the texture in its albedo slot.
		expect(drawn).toHaveLength(1);
		const material = drawn[0].material as THREE.Material & { albedoSlot: THREE.Texture };
		expect(material.albedoSlot).toBe(albedo);
		// Freed when the table went.
		expect(freed.sort()).toEqual(['albedo', 'body', 'body', 'swing']);
		expect(modelNow(ID)).toBeUndefined();
	});

	it('leaves nothing behind across reloads, with one KTX2 loader at a time', async () => {
		await round();
		const after = { ...renderer.info.memory };
		await round();
		await round();
		expect(renderer.info.memory.geometries).toBe(after.geometries);
		expect(renderer.info.memory.textures).toBe(after.textures);
		const multiple = warn.mock.calls.filter((c) => String(c[0]).includes('Multiple active KTX2'));
		expect(multiple).toEqual([]);
	});

	it('shows a preview in place of the placeholder, then the full model, one redraw each', async () => {
		initModels(renderer);
		const onModel = vi.fn();
		const layer = new TokenLayer(new OverlayLayer(), onModel);
		layer.sync([{ ...token, vision: 0, light: 0, model: STAGED }], grid, null, true);
		const drawn = () => {
			const out: THREE.BufferGeometry[] = [];
			layer.group.traverse(
				(o) => o instanceof THREE.Mesh && out.push(o.userData.source ?? o.geometry)
			);
			return out;
		};
		const body = (m: LoadedModel) => partsOf(m, 'body')[0].geometry;
		expect(modelNow(STAGED)).toBeUndefined(); // the plain miniature
		await vi.waitFor(() => expect([...gates.keys()].sort()).toEqual(['full', 'preview']));
		gates.get('preview')!();
		await vi.waitFor(() => expect(onModel).toHaveBeenCalledTimes(1));
		const preview = modelNow(STAGED)!;
		expect(preview.preview).toBe(true);
		expect(drawn()).toContain(body(preview));
		let freed = false;
		body(preview).addEventListener('dispose', () => (freed = true));
		gates.get('full')!();
		const full = (await loadModel(STAGED))!;
		await vi.waitFor(() => expect(onModel).toHaveBeenCalledTimes(2));
		expect(full.preview).toBeUndefined();
		expect(modelNow(STAGED)).toBe(full);
		expect(drawn()).toContain(body(full));
		expect(drawn()).not.toContain(body(preview));
		expect(freed).toBe(true);
		await new Promise((r) => setTimeout(r, 50));
		expect(onModel).toHaveBeenCalledTimes(2);
		layer.dispose();
		releaseModels();
		gates.clear();
	});

	it('prefetches only what the table was sent', async () => {
		const manifest = await loadManifest();
		initModels(renderer);
		const fetches = vi.mocked(fetch);
		const before = fetches.mock.calls.length;
		const view = {
			environment: null,
			tokens: [{ model: ID, pos: { x: 0, y: 0 } }],
			props: [{ assetId: 'crate', pos: { x: 2, y: 2 } }]
		};
		prefetch(view, grid, new THREE.Vector3(), 'aces');
		await Promise.all([loadModel(ID), loadModel('crate')]);
		const files = fetches.mock.calls
			.slice(before)
			.map(([input]) => /\/assets\/((?:models|previews|textures)\/.+)$/.exec(String(input))?.[1])
			.filter(Boolean);
		expect(files.sort()).toEqual([FILE, manifest.models.crate.file].sort());
		releaseModels();
	});
});
