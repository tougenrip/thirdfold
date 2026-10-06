// Kit textures (M70): the stone halls' pilot pieces (#263) wear the ashlar trim sheet by their UVs
// in piece meshes of their own (the surface kind's `sheet` graph), so the monastery's walls differ from
// their vertex colours and follow what the albedo slot holds (a texture-detail refill too), with no
// new program after the warm-up's stand-ins; the greybox kits draw exactly as before.

import * as THREE from 'three/webgpu';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SquareGrid } from '$lib/game/grid';
import type { SceneObject } from '$lib/game/objects';
import { loadManifest } from '$lib/assets/load';
import { loadEnvironment, loadTexture } from './environment';
import { groundFor } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { setSlot, type KindMaterial } from './materials';
import { initModels, releaseModels } from './models';
import { shaderStages } from './perf';
import { BACKEND } from './testing';
import { refill } from './texture-detail';
import { WallLayer, type WallKit } from './walls';
import { loadWorld } from './world-layer';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 64;
const grid: SquareGrid = { kind: 'square', cellSize: 1, width: 12, height: 8 };
const at = (x: number, y: number) => [x - grid.width / 2, y - grid.height / 2] as const;
/** A room whose north wall the camera faces from inside. */
const ROOM: SceneObject[] = [
	{ id: 'n', kind: 'wall', a: { x: 2, y: 2 }, b: { x: 8, y: 2 } },
	{ id: 'e', kind: 'wall', a: { x: 8, y: 2 }, b: { x: 8, y: 6 } },
	{ id: 's', kind: 'wall', a: { x: 2, y: 6 }, b: { x: 8, y: 6 } },
	{ id: 'w', kind: 'wall', a: { x: 2, y: 2 }, b: { x: 2, y: 6 } }
];

let renderer: THREE.WebGPURenderer;
beforeAll(async () => {
	renderer = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer.setSize(SIZE, SIZE, false);
	initModels(renderer); // the pilot's pieces are cooked: meshopt needs the decoders
});
afterAll(() => {
	releaseModels();
	renderer.dispose();
});

async function setUp() {
	const build = await loadWorld();
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 2));
	// From inside the room, level with the north wall's middle, looking at its face.
	const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 20);
	const [x, z] = at(5, 2);
	camera.position.set(x, 1, z + 3);
	camera.lookAt(x, 1, z);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	const layer = new WallLayer(build);
	const shape = build.worldShape({ grid, levels: null, floor: null, objects: [], known: null });
	scene.add(layer.group, ...layer.gallery());
	return {
		layer,
		sync: () => layer.sync(ROOM, shape, groundFor(grid, null)),
		async draw(): Promise<Uint8Array> {
			advanceNodeFrame(renderer);
			renderer.setRenderTarget(target);
			renderer.render(scene, camera);
			renderer.setRenderTarget(null);
			return (await renderer.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
		},
		stages: () => new Set(shaderStages(renderer).keys()),
		/** The piece meshes drawing something. */
		batches: () =>
			layer.group.children.filter(
				(o): o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh && o.visible
			)
	};
}

/** How many pixels differ by more than a little in any channel. */
function differing(a: Uint8Array, b: Uint8Array): number {
	let n = 0;
	for (let i = 0; i < a.length; i += 4)
		if (Math.max(...[0, 1, 2].map((c) => Math.abs(a[i + c] - b[i + c]))) > 6) n++;
	return n;
}

/** The kit as it drew before M70: every piece in its vertex colours, no sheet, no UVs. */
function coloursOnly(kit: WallKit): WallKit {
	return Object.fromEntries(
		Object.entries(kit).map(([role, list]) => [
			role,
			list.map(({ mesh, weight }) => ({ mesh: { ...mesh, uvs: undefined }, weight }))
		])
	);
}

describe('kit textures', () => {
	it('draw the stone halls’ walls on the ashlar trim sheet by UV, following the albedo slot, compiling nothing', async () => {
		const t = await setUp();
		const halls = await loadEnvironment('stone-halls');
		const kit = halls!.kit!;
		const sheet = kit['wall.straight']![0].sheet;
		expect(sheet?.map, 'the trim sheet').toBeTruthy();
		expect(kit['wall.straight']![0].mesh.uvs?.length).toBeGreaterThan(0);

		// Its colours alone first (the stand-ins compile every graph), then the sheet.
		t.layer.setLook(halls!.walls, coloursOnly(kit));
		t.sync();
		const colours = await t.draw();
		const before = t.stages();
		const fresh = () => [...t.stages()].filter((code) => !before.has(code));
		t.layer.setLook(halls!.walls, kit);
		const drawn = await t.draw();
		expect(fresh()).toEqual([]);
		// The room's pieces are in sheet meshes: UVs, the `sheet` graph, the sheet in its slot.
		const sheeted = t.batches().filter((b) => (b.material as KindMaterial).options.sheet);
		expect(sheeted.length).toBeGreaterThan(0);
		expect(sheeted[0].geometry.getAttribute('uv')).toBeDefined();
		const material = sheeted[0].material as KindMaterial;
		expect(material.albedoSlot).toBe(sheet!.map);
		expect(differing(drawn, colours), 'the sheet against its colours').toBeGreaterThan(200);

		// Another texture in the albedo slot changes the picture, and compiles nothing.
		const red = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
		red.colorSpace = THREE.SRGBColorSpace;
		red.needsUpdate = true;
		setSlot(material, 'albedo', red);
		const swapped = await t.draw();
		expect(differing(swapped, drawn), 'a swapped albedo').toBeGreaterThan(200);
		setSlot(material, 'albedo', sheet!.map);
		expect(differing(await t.draw(), drawn)).toBe(0);
		expect(fresh()).toEqual([]);
		t.layer.dispose();
	});

	it('swap the trim sheet’s texture detail in place: the slot’s own texture, refilled', async () => {
		const t = await setUp();
		const halls = await loadEnvironment('stone-halls');
		const sheet = halls!.kit!['wall.straight']![0].sheet!;
		// The slot holds the texture loadTexture tracks for texture detail (texture-detail.ts
		// `trackTexture` refills that same object at 1K or 2K), and the entry has those variants.
		const { textures } = await loadManifest();
		const entry = textures['ashlar-trim-albedo'];
		expect(entry.variants?.map((v) => v.size)).toEqual([1024, 2048]);
		expect(await loadTexture('ashlar-trim-albedo', entry)).toBe(sheet.map);
		t.layer.setLook(halls!.walls, halls!.kit);
		t.sync();
		const drawn = await t.draw();
		const before = t.stages();
		// A refill as a swap does it: new pixels in the same texture object, no program.
		const pixels = new Uint8Array(4 * 16).fill(255);
		const other = new THREE.DataTexture(pixels, 4, 4);
		const target = sheet.map!;
		const { image, mipmaps, format, type } = target;
		const kept = { image, mipmaps, format, type };
		refill(target, other);
		const swapped = await t.draw();
		expect(differing(swapped, drawn), 'the refilled sheet').toBeGreaterThan(200);
		expect([...t.stages()].filter((code) => !before.has(code))).toEqual([]);
		Object.assign(target, kept, { needsUpdate: true }); // the cached texture as it was
		t.layer.dispose();
	});

	it('leave the greybox kits as they were: vertex colours, no sheet, no UVs', async () => {
		const t = await setUp();
		for (const id of ['village', 'cavern']) {
			const look = await loadEnvironment(id);
			for (const list of Object.values(look!.kit ?? {}))
				for (const v of list) {
					expect(v.sheet, id).toBeUndefined();
					expect(v.mesh.uvs, id).toBeUndefined();
				}
		}
		// The village's room draws in the kit's colours' material alone, exactly as the same kit
		// given without sheets (what it drew before M70).
		const village = (await loadEnvironment('village'))!;
		t.layer.setLook(village.walls, village.kit);
		t.sync();
		const drawn = await t.draw();
		for (const b of t.batches()) {
			const m = b.material as KindMaterial;
			expect(m.options.sheet).toBeFalsy();
			expect(b.geometry.getAttribute('uv')).toBeUndefined();
		}
		t.layer.setLook(village.walls, coloursOnly(village.kit!));
		expect(differing(await t.draw(), drawn)).toBe(0);
		t.layer.dispose();
	});
});
