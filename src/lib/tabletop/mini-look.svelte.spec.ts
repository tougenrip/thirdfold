// The miniature kind's look (#267), on both backends: the wash darkens what the bake occludes and
// the drybrush lightens convex edges, a textured mini takes the tint only where ORM alpha masks it,
// the rim brightens a silhouette where the rules light its cell and adds nothing where they keep it
// dark or the fog hides it, and the figures draw with exactly two mini programs (vertex-coloured
// and textured) whatever their values, slots, tint, opacity, hover, the varnish, the rim's tuning,
// the hour or a baked model arriving.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { encodeMask, type FogView } from '$lib/game/visibility';
import { CellMaps } from './cell-maps';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import {
	BAKE_ATTRIBUTE,
	PAINT_ATTRIBUTE,
	SLOTS,
	TINT_ATTRIBUTE,
	addInstanceTints,
	createMaterial,
	miniLook,
	prepareSlotTexture,
	setParams,
	setSlot,
	withBake,
	type KindMaterial,
	type MaterialOptions
} from './materials';
import { shaderStages } from './perf';
import { registerSkyLights } from './sky-light';
import { BACKEND } from './testing';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 32;
const GRID: SquareGrid = { kind: 'square', cellSize: 1, width: 3, height: 1 };
const cellCount = GRID.width * GRID.height;
const mask = (list: number[]) => {
	const m = new Uint8Array(cellCount);
	for (const i of list) m[i] = 1;
	return encodeMask(m);
};

let renderer: THREE.WebGPURenderer | null = null;
let maps: CellMaps | null = null;
afterEach(() => {
	maps?.dispose();
	renderer?.dispose();
	[maps, renderer] = [null, null];
	for (const [k, v] of Object.entries(TUNING)) miniLook[k as keyof typeof TUNING].value = v;
});
const TUNING = {
	washDark: miniLook.washDark.value,
	edgeLight: miniLook.edgeLight.value,
	varnish: miniLook.varnish.value,
	rimDay: miniLook.rimDay.value,
	rimNight: miniLook.rimNight.value,
	hoverRim: miniLook.hoverRim.value
};

/** A figure geometry as #266's batches carry it: colours, the bake, a vec4 paint and the tint. */
function figure(geometry: THREE.BufferGeometry, bake?: [number, number]): THREE.BufferGeometry {
	const count = geometry.getAttribute('position').count;
	geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
	if (bake) {
		const values = new Float32Array(count * 2);
		for (let i = 0; i < count; i++) values.set(bake, i * 2);
		geometry.setAttribute(BAKE_ATTRIBUTE, new THREE.BufferAttribute(values, 2));
	}
	withBake(geometry);
	addInstanceTints(geometry, 1, 4);
	return geometry;
}

/** One instanced mini of `options` on `geometry`. */
function mini(geometry: THREE.BufferGeometry, options: MaterialOptions = {}): THREE.InstancedMesh {
	const material = createMaterial('mini', { instanced: true, ...options });
	const mesh = new THREE.InstancedMesh(geometry, material, 1);
	mesh.setMatrixAt(0, new THREE.Matrix4());
	mesh.frustumCulled = false;
	return mesh;
}

/** A flat square facing up, which the camera looks straight down on. */
const square = () => new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);

async function setup() {
	const canvas = document.createElement('canvas');
	const r = await createNodeRenderer(canvas, {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	registerSkyLights(r);
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 1));
	const sun = new THREE.DirectionalLight(0xffffff, 1.5);
	sun.position.set(0.3, 2, 0.4);
	scene.add(sun);
	const camera = new THREE.OrthographicCamera(-0.4, 0.4, 0.4, -0.4, 0.1, 10);
	camera.up.set(0, 0, -1);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	maps = new CellMaps();
	const m = maps;
	const stagesNamed = (name: string) =>
		[...shaderStages(r).values()].filter((s) => s.startsWith(`${name} fragment`)).length;
	return {
		maps: m,
		scene,
		miniPrograms: () => stagesNamed('mini'),
		/** Every pixel's rgb looking down on `cell`, with `object` standing on it. */
		async at(object: THREE.Object3D, cell: GridPos): Promise<number[][]> {
			const w = gridToWorld(GRID, cell);
			object.position.set(w.x, 0, w.z);
			camera.position.set(w.x, 5, w.z);
			camera.lookAt(w.x, 0, w.z);
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.setClearColor(0x000000, 1);
			r.render(scene, camera);
			r.setRenderTarget(null);
			const px = (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array;
			const row = px.length === SIZE * SIZE * 4 ? SIZE * 4 : Math.ceil((SIZE * 4) / 256) * 256;
			const out: number[][] = [];
			for (let y = 0; y < SIZE; y++)
				for (let x = 0; x < SIZE; x++) {
					const i = y * row + x * 4;
					out.push([px[i], px[i + 1], px[i + 2]]);
				}
			return out;
		}
	};
}

const centre = (px: number[][]) => px[(SIZE / 2) * SIZE + SIZE / 2];
const sum = (rgb: number[]) => rgb[0] + rgb[1] + rgb[2];
const total = (px: number[][]) => px.reduce((s, p) => s + sum(p), 0);

describe('the miniature kind (#267)', () => {
	it('washes the cavities darker and drybrushes the edges lighter', async () => {
		const t = await setup();
		t.maps.update(GRID, { fog: null, mode: 'player' }, 'day', null, null, null, null);
		const read = async (bake: [number, number]) => {
			const mesh = mini(figure(square(), bake), { vertexColors: true });
			t.scene.add(mesh);
			const px = centre(await t.at(mesh, { x: 1, y: 0 }));
			mesh.removeFromParent();
			return sum(px);
		};
		const [washed, plain, edged] = [
			await read([0.2, 0.5]),
			await read([1, 0.5]),
			await read([1, 1])
		];
		expect(washed).toBeLessThan(plain - 20);
		expect(edged).toBeGreaterThan(plain + 20);
		// Without the wash only the bake's ambient occlusion darkens the cavity; without the
		// drybrush the edge is as the flat.
		miniLook.washDark.value = 1;
		miniLook.edgeLight.value = 0;
		expect(plain - (await read([0.2, 0.5]))).toBeLessThan(plain - washed - 20);
		expect(Math.abs((await read([1, 1])) - plain)).toBeLessThan(4);
	});

	it('tints a textured mini only where ORM alpha masks it', async () => {
		const t = await setup();
		t.maps.update(GRID, { fog: null, mode: 'player' }, 'day', null, null, null, null);
		// A grey albedo; ORM masked on the left texel, not on the right.
		const grey = new Uint8Array([160, 160, 160, 255, 160, 160, 160, 255]);
		const albedo = prepareSlotTexture(new THREE.DataTexture(grey, 2, 1), SLOTS.albedo);
		const ormData = new Uint8Array([255, 255, 0, 255, 255, 255, 0, 0]);
		const orm = prepareSlotTexture(new THREE.DataTexture(ormData, 2, 1), SLOTS.orm);
		for (const map of [albedo, orm]) map.magFilter = THREE.NearestFilter;
		const geometry = figure(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2));
		const paint = geometry.getAttribute(PAINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		paint.setXYZW(0, 1, 0, 0, 1); // the token's colour: red
		const mesh = mini(geometry, { slots: { albedo, orm } });
		t.scene.add(mesh);
		const px = await t.at(mesh, { x: 1, y: 0 });
		const [left, right] = [px[(SIZE / 2) * SIZE + 4], px[(SIZE / 2) * SIZE + SIZE - 5]];
		expect(left[0]).toBeGreaterThan(left[1] + 40);
		expect(Math.abs(right[0] - right[1])).toBeLessThan(6);
	});

	it('rims a silhouette where the rules light its cell, never where they keep it dark', async () => {
		const t = await setup();
		const levels = new Float32Array(cellCount);
		levels[1] = 1; // (1, 0) lit by a torch; (0, 0) unlit
		const fog: FogView = {
			enabled: true,
			shared: false,
			visible: mask([0, 1]),
			explored: mask([0, 1])
		};
		t.maps.update(GRID, { fog, mode: 'player' }, 'dark', levels, null, null, null);
		const mesh = mini(figure(new THREE.SphereGeometry(0.3, 32, 16)), { vertexColors: true });
		t.scene.add(mesh);
		const rimmed = async (cell: GridPos, strength: number) => {
			miniLook.rimDay.value = miniLook.rimNight.value = strength;
			return total(await t.at(mesh, cell));
		};
		const lit = { x: 1, y: 0 };
		const dark = { x: 0, y: 0 };
		expect(await rimmed(lit, 1)).toBeGreaterThan((await rimmed(lit, 0)) + 500);
		expect(await rimmed(dark, 1)).toBe(await rimmed(dark, 0));
		// A hover lifts it, by the tint's strength.
		const tint = mesh.geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		const plain = await rimmed(lit, 0.3);
		tint.setW(0, 1);
		tint.needsUpdate = true;
		expect(await rimmed(lit, 0.3)).toBeGreaterThan(plain);
		// Unexplored: exactly black, rim and all.
		expect(total(await t.at(mesh, { x: 2, y: 0 }))).toBe(0);
	});

	it('draws every figure with exactly two mini programs, whatever changes', async () => {
		const t = await setup();
		t.maps.update(GRID, { fog: null, mode: 'player' }, 'day', null, null, null, null);
		const albedo = () =>
			prepareSlotTexture(new THREE.DataTexture(new Uint8Array(4).fill(200), 1, 1), SLOTS.albedo);
		// A figure of each kind. (r186 declares a lit graph's uniforms in another order for a further
		// material compiled after one of the other kind, vertex colours or not, as it always has for
		// the mini kind's plain and coloured materials: the warm-ups cover that, #180, and it is the
		// same with the textured branch taken out.)
		const part = mini(figure(square()), { vertexColors: true });
		const textured = mini(figure(square()), { slots: { albedo: albedo() } });
		t.scene.add(part, textured);
		await t.at(part, { x: 1, y: 0 });
		expect(t.miniPrograms()).toBe(2);
		// r186 gives every InstancedMesh a vertex stage of its own; fragment stages are the programs.
		const fragments = () =>
			[...shaderStages(renderer!).values()].filter((s) => s.endsWith(' fragment')).length;
		const before = fragments();
		const write = (name: string, values: [number, number, number, number]) => {
			const a = part.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
			a.setXYZW(0, ...values);
			a.needsUpdate = true;
		};
		const night = () =>
			t.maps.update(GRID, { fog: null, mode: 'player' }, 'dark', null, null, null, null);
		const changes: (() => void)[] = [
			// Other values and maps.
			() => setParams(part.material as KindMaterial, { color: 0x336699, roughness: 0.8 }),
			() => setSlot(textured.material as KindMaterial, 'albedo', albedo()),
			() => setParams(textured.material as KindMaterial, { clearcoat: 0 }),
			// A baked model arriving: the same attributes, real values.
			() => (part.geometry = figure(new THREE.SphereGeometry(0.3), [0.4, 0.8])),
			// Tint and opacity (the GM's hidden ghost), and hover, per instance.
			() => write(PAINT_ATTRIBUTE, [0.2, 0.9, 0.3, 0.35]),
			() => write(TINT_ATTRIBUTE, [1, 1, 1, 0.5]),
			// The low tier's varnish, the rim's tuning and the night.
			() => (miniLook.varnish.value = 0),
			() => (miniLook.rimNight.value = 2),
			night
		];
		for (const change of changes) {
			change();
			await t.at(part, { x: 1, y: 0 });
		}
		expect(fragments()).toBe(before);
		expect(t.miniPrograms()).toBe(2);
	});
});
