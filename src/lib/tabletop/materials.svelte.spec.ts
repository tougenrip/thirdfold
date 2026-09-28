// The material module's shader kinds (#169): every kind builds without a node-builder error, and
// what varies at runtime (a second material of a kind, other values, a real texture in a slot or
// its blank back, the mini's clearcoat leaving 0) adds no program, and a slot swap no node state.
// #170 sweeps a whole table; this proves the kinds on a small scene, on both backends.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import { BACKEND } from './testing';
import {
	KINDS,
	SHADER_KINDS,
	SLOTS,
	SLOT_NAMES,
	addInstanceTints,
	blankTexture,
	createMaterial,
	prepareSlotTexture,
	setParams,
	setSlot,
	slotDefault,
	type KindMaterial,
	type ShaderKind,
	type SlotName
} from './materials';

vi.setConfig({ testTimeout: 120_000 });

const SIZE = 32;
let renderer: THREE.WebGPURenderer | null = null;
afterEach(() => {
	renderer?.dispose();
	renderer = null;
	vi.restoreAllMocks();
});

interface Internals {
	_nodes: { nodeBuilderCache: Map<number, unknown> };
	_pipelines: { programs: { fragment: Map<string, unknown> } };
}

/** A lit scene drawn into a small target, with the program and node-state counts. */
async function setup() {
	const canvas = document.createElement('canvas');
	const r = await createNodeRenderer(canvas, {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, 2));
	const sun = new THREE.DirectionalLight(0xffffff, 2);
	sun.position.set(1, 2, 3);
	scene.add(sun);
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
	camera.position.set(0, 0, 4);
	const target = new THREE.RenderTarget(SIZE, SIZE);
	return {
		scene,
		draw() {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
		},
		read: async () => (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE, SIZE)) as Uint8Array,
		programs: () => r.info.memory.programs,
		states: () => (r as unknown as Internals)._nodes.nodeBuilderCache.size,
		fragments: () => (r as unknown as Internals)._pipelines.programs.fragment.size
	};
}

/** A 2x2 texture filling `slot` as a loader would: its own texels, the slot's sampling. */
function real(slot: SlotName): THREE.Texture {
	const data = new Uint8Array(16).map((_, i) => (i % 4 === 3 ? 255 : 60 + ((i * 53) % 190)));
	return prepareSlotTexture(new THREE.DataTexture(data, 2, 2), SLOTS[slot]);
}

const slotsOf = (kind: ShaderKind) => KINDS[kind].slots;

/** A mesh for a kind's material; instanced ones carry the per-instance tint. */
function meshFor(kind: ShaderKind, material: KindMaterial, instanced = false): THREE.Object3D {
	const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
	if (!instanced) return new THREE.Mesh(geometry, material);
	addInstanceTints(geometry, 2);
	const mesh = new THREE.InstancedMesh(geometry, material, 2);
	mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0.8, 0, 0));
	return mesh;
}

describe('slot defaults', () => {
	it('bind a blank of each slot’s type, colour space, wrap and filters', () => {
		for (const slot of SLOT_NAMES) {
			const spec = SLOTS[slot];
			const blank = slotDefault(slot);
			expect(blank).toBe(slotDefault(slot));
			expect(blank.colorSpace).toBe(spec.colorSpace);
			expect([blank.wrapS, blank.wrapT]).toEqual([spec.wrap, spec.wrap]);
			expect([blank.magFilter, blank.minFilter]).toEqual([spec.magFilter, spec.minFilter]);
			expect(blank.mapping).toBe(THREE.UVMapping);
			expect([...(blank.image as { data: Uint8Array }).data]).toEqual([...spec.texel]);
			// A real texture in the slot is sampled the same way, so neither backend keys it apart.
			const loaded = real(slot);
			for (const key of ['colorSpace', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'mapping'])
				expect(loaded[key as keyof THREE.Texture]).toBe(blank[key as keyof THREE.Texture]);
		}
	});

	it('keep array and 3D slots their own type', () => {
		const spec = SLOTS.albedo;
		expect(blankTexture({ ...spec, type: 'array' })).toBeInstanceOf(THREE.DataArrayTexture);
		expect(blankTexture({ ...spec, type: '3d' })).toBeInstanceOf(THREE.Data3DTexture);
		expect(blankTexture(spec)).toBeInstanceOf(THREE.DataTexture);
	});
});

describe('shader kinds', () => {
	it.each(SHADER_KINDS)('%s builds and varies at runtime without a new program', async (kind) => {
		const errors = vi.spyOn(console, 'error');
		const warnings = vi.spyOn(console, 'warn');
		const { scene, draw, programs, states, fragments } = await setup();
		const a = createMaterial(kind);
		const aMesh = meshFor(kind, a);
		const instanced = createMaterial(kind, { instanced: true });
		scene.add(aMesh, meshFor(kind, instanced, true));
		if (kind === 'overlay') {
			const lines = new THREE.BufferGeometry().setFromPoints([
				new THREE.Vector3(-1, -1, 0),
				new THREE.Vector3(1, 1, 0)
			]);
			scene.add(new THREE.LineSegments(lines, createMaterial(kind, { lines: true })));
		}
		draw();
		const [p0, s0] = [programs(), states()];
		expect(p0).toBeGreaterThan(0);

		// A second material of the kind, other values, a real texture in every slot.
		const b = createMaterial(kind, {
			params: { color: 0x33aa55, roughness: 0.2, metalness: 0.4, opacity: 0.5, tint: 0x220000 },
			slots: Object.fromEntries(slotsOf(kind).map((s) => [s, real(s)]))
		});
		const bMesh = meshFor(kind, b);
		bMesh.position.x = -1;
		scene.add(bMesh);
		draw();
		expect(programs()).toBe(p0);
		expect(states()).toBe(s0);

		// Swapping slots between blank and real, both ways, and changing values.
		for (const slot of slotsOf(kind)) {
			setSlot(a, slot, real(slot));
			setSlot(b, slot, null);
		}
		setParams(a, { color: 0x4060ff, emissive: 0xffffff, emissiveIntensity: 0, sway: 0.1 });
		setParams(b, { roughness: 0, metalness: 0, opacity: 0, cutoff: 0.9 });
		draw();
		for (const slot of slotsOf(kind)) setSlot(a, slot, null);
		draw();
		expect(programs()).toBe(p0);
		expect(states()).toBe(s0);

		// Another instanced mesh with its own values. r186 keys an instanced mesh's node state
		// by the object and names its instance-matrix buffer by id, so any InstancedMesh (a
		// built-in material's too) brings a vertex stage of its own; the kind adds nothing to it.
		const f0 = fragments();
		const other = createMaterial(kind, { instanced: true, params: { color: 0xff0000 } });
		scene.add(meshFor(kind, other, true));
		draw();
		expect(fragments()).toBe(f0);
		expect(programs()).toBe(p0 + 1);

		if (kind === 'mini') {
			const s1 = states();
			setParams(a, { clearcoat: 0.25 });
			draw();
			expect(programs()).toBe(p0 + 1);
			expect(states()).toBe(s1);
		}
		expect(errors).not.toHaveBeenCalled();
		expect(warnings.mock.calls.flat().join(' ')).not.toMatch(/attribute|NodeMaterial/);
	});

	it('gives each material its own values through the shared graph', async () => {
		const { scene, draw, read, programs } = await setup();
		const left = createMaterial('surface', { params: { color: 0xff0000 } });
		const right = createMaterial('surface', { params: { color: 0x00ff00 } });
		for (const [material, x] of [
			[left, -0.9],
			[right, 0.9]
		] as const) {
			const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 3), material);
			mesh.position.x = x;
			scene.add(mesh);
		}
		const at = (px: Uint8Array, x: number) => {
			const i = ((SIZE / 2) * SIZE + x) * 4;
			return [px[i], px[i + 1], px[i + 2]];
		};
		draw();
		const programsBefore = programs();
		let px = await read();
		const [l, r] = [at(px, 4), at(px, SIZE - 5)];
		expect(l[0]).toBeGreaterThan(l[1] + 40);
		expect(r[1]).toBeGreaterThan(r[0] + 40);

		// A value changed at runtime reaches the draw, compiling nothing.
		setParams(left, { color: 0x0000ff });
		draw();
		px = await read();
		const blue = at(px, 4);
		expect(blue[2]).toBeGreaterThan(blue[0] + 40);

		// So does a texture: the right one's albedo turns red, the left keeps its blank.
		const red = new Uint8Array(16).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
		setParams(right, { color: 0xffffff });
		setSlot(right, 'albedo', prepareSlotTexture(new THREE.DataTexture(red, 2, 2), SLOTS.albedo));
		draw();
		px = await read();
		const [still, reddened] = [at(px, 4), at(px, SIZE - 5)];
		expect(still[2]).toBeGreaterThan(still[0] + 40);
		expect(reddened[0]).toBeGreaterThan(reddened[1] + 40);
		expect(programs()).toBe(programsBefore);
	});
});
