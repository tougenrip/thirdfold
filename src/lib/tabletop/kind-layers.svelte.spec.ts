// The layers on the shader kinds (#172): every surface the table, walls and doors, raised
// ground, props and minis draw is a material from the factory (so it composes `worldModify`),
// the number of tokens changes neither the materials nor the programs and hiding one compiles
// nothing, a hover tint adds to a textured albedo instead of multiplying it, and the terrain kind
// draws the painted floors from the ground map.

import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeLevels } from '$lib/game/terrain';
import { CellMaps } from './cell-maps';
import { groundFor } from './ground';
import { advanceNodeFrame, createNodeRenderer } from './loop';
import {
	addInstanceTints,
	createMaterial,
	prepareSlotTexture,
	SLOTS,
	TINT_ATTRIBUTE,
	withBake
} from './materials';
import { OverlayLayer } from './overlay';
import { PropLayer } from './props';
import { WorldGround } from './landscape';
import { TerrainLayer } from './terrain';
import { TokenLayer } from './tokens';
import { WallLayer } from './walls';
import { PerfRecorder } from './perf';
import { loadWorld, WorldLayer } from './world-layer';
import { worldExtents } from './world-ground';
import {
	BACKEND,
	loadSidecar,
	loadView,
	manualClock,
	mountFixture,
	settle,
	type Mounted
} from './testing';

vi.setConfig({ testTimeout: 120_000 });

let renderer: THREE.WebGPURenderer | null = null;
let mounted: Mounted | null = null;
afterEach(async () => {
	renderer?.dispose();
	renderer = null;
	await mounted?.unmount();
	mounted = null;
	vi.restoreAllMocks();
});

/** Every mesh's materials under `root`. */
function materialsOf(root: THREE.Object3D): THREE.Material[] {
	const out: THREE.Material[] = [];
	root.traverse((o) => {
		if (o instanceof THREE.Mesh) out.push(...[o.material].flat());
	});
	return out;
}

describe('the layers on the shader kinds', () => {
	it('draw every surface with a material from the factory', async () => {
		const sidecar = await loadSidecar('test-world');
		const view = await loadView('test-world', sidecar.ambient, 'gm');
		const build = await loadWorld(); // first: no model arrives between the layers and the look
		const size = view.grid.width * view.grid.height;
		const ground = groundFor(view.grid, view.terrain ? decodeLevels(view.terrain, size) : null);
		const table = new WorldGround(new THREE.Group(), build);
		table.build(worldExtents(view.grid));
		const walls = new WallLayer();
		walls.sync(view.objects, view.grid, ground);
		const terrain = new TerrainLayer();
		terrain.sync(view.grid, ground);
		const props = new PropLayer();
		props.sync(view.props, view.grid, ground);
		const overlay = new OverlayLayer();
		const tokens = new TokenLayer(overlay);
		tokens.sync(view.tokens, view.grid, ground);
		const world = new WorldLayer(new PerfRecorder(), table, build, props.drops);
		world.update(view.grid, ground.levels, null, null, 'gm');
		const layers = [table, walls, terrain, props, tokens, world];
		const drawn = layers.flatMap((l) => materialsOf(l.group));
		// Doors, raised cells, props and minis are all on the fixture.
		expect(drawn.length).toBeGreaterThan(20);
		const kinds = new Set(drawn.map((m) => (m as { kind?: string }).kind));
		// Rock: the world layer's cliffs and risers (#241).
		expect(kinds).toEqual(new Set(['surface', 'terrain', 'rock', 'prop', 'mini']));
		for (const l of layers) l.dispose();
		overlay.dispose();
	});

	it('keep materials and programs whatever the number of tokens, and hiding one compiles nothing', async () => {
		const sidecar = await loadSidecar('test-world');
		const view = await loadView('test-world', sidecar.ambient, 'gm');
		const compile = vi.spyOn(THREE.WebGPURenderer.prototype, 'compileAsync');
		const clock = manualClock();
		const m = await mountFixture(view, sidecar.poses.overview, { clock });
		mounted = m;
		const scene = () => compile.mock.calls[0][2] as THREE.Scene;
		/** Draws what a step changed and waits for the table to rest (post passes compile late). */
		const drawn = async () => {
			clock.set(clock.now() + 30_000);
			await settle(m.tabletop, 400, 30_000);
		};
		await drawn();
		const counts = () => {
			const { programs, pipelines } = m.tabletop.stats();
			return { programs, pipelines, materials: new Set(materialsOf(scene())).size };
		};
		const [first] = view.tokens;
		const many = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				...first,
				id: `mini-${i}`,
				pos: { x: i % view.grid.width, y: Math.floor(i / view.grid.width) }
			}));
		m.tabletop.setTokens(many(1));
		await drawn();
		const one = counts();
		m.tabletop.setTokens(many(30));
		await drawn();
		expect(counts()).toEqual(one);
		const hidden = many(30).map((t, i) => (i === 3 ? { ...t, hidden: true as const } : t));
		m.tabletop.setTokens(hidden);
		await drawn();
		expect(counts()).toEqual(one);
		m.tabletop.setTokens(many(30));
		await drawn();
		expect(counts()).toEqual(one);
	});
});

const SIZE = 32;

/** An orthographic view straight down onto a 4×1 strip, drawn into a small target. */
async function strip(light = 3) {
	const r = await createNodeRenderer(document.createElement('canvas'), {
		pixelRatio: 1,
		antialias: false,
		backend: BACKEND === 'webgpu' ? 'webgpu' : 'webgl'
	});
	renderer = r;
	r.setSize(SIZE * 4, SIZE, false);
	const scene = new THREE.Scene();
	scene.add(new THREE.AmbientLight(0xffffff, light));
	const camera = new THREE.OrthographicCamera(-2, 2, 0.5, -0.5, 0.1, 20);
	camera.position.set(0, 5, 0);
	camera.up.set(0, 0, -1);
	camera.lookAt(0, 0, 0);
	const target = new THREE.RenderTarget(SIZE * 4, SIZE);
	return {
		scene,
		/** The middle row's colour at the centre of each of the four cells. */
		async draw(): Promise<number[][]> {
			advanceNodeFrame(r);
			r.setRenderTarget(target);
			r.render(scene, camera);
			r.setRenderTarget(null);
			const px = (await r.readRenderTargetPixelsAsync(target, 0, 0, SIZE * 4, SIZE)) as Uint8Array;
			return [0, 1, 2, 3].map((c) => {
				const i = ((SIZE / 2) * SIZE * 4 + c * SIZE + SIZE / 2) * 4;
				return [px[i], px[i + 1], px[i + 2]];
			});
		},
		programs: () => r.info.memory.programs
	};
}

describe('the ported kinds drawn', () => {
	it('add a hover tint to a textured prop, never multiplying its albedo', async () => {
		// Dim enough that the bright texel is nowhere near white, so nothing clips.
		const { scene, draw, programs } = await strip(1);
		// Dark and bright texels side by side.
		const data = new Uint8Array([40, 40, 40, 255, 200, 200, 200, 255]);
		const albedo = prepareSlotTexture(new THREE.DataTexture(data, 2, 1), SLOTS.albedo);
		albedo.magFilter = THREE.NearestFilter;
		const material = createMaterial('prop', { instanced: true, slots: { albedo } });
		// The mesh's uvs (#188): one repeat across the 4 units, so cells 0-1 dark and 2-3 bright.
		material.params.repeat.set(1, 1);
		const geometry = withBake(
			new THREE.PlaneGeometry(4, 1).rotateX(-Math.PI / 2).translate(2, 0, 0)
		);
		addInstanceTints(geometry, 1);
		const mesh = new THREE.InstancedMesh(geometry, material, 1);
		mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0, 0));
		scene.add(mesh);
		const plain = await draw();
		const p0 = programs();
		const tints = geometry.getAttribute(TINT_ATTRIBUTE) as THREE.InstancedBufferAttribute;
		tints.setXYZW(0, 1, 0.5, 0, 0.3);
		tints.needsUpdate = true;
		const hovered = await draw();
		expect(programs()).toBe(p0);
		const lift = hovered.map((c, i) => c.map((v, k) => v - plain[i][k]));
		// Dark and bright cells differ, and the tint lifts both by the same amount.
		expect(plain[3][0] - plain[0][0]).toBeGreaterThan(30);
		expect(lift[0][0]).toBeGreaterThan(20);
		for (let k = 0; k < 3; k++) expect(Math.abs(lift[0][k] - lift[3][k])).toBeLessThanOrEqual(3);
	});

	it('draw painted floors on the terrain kind from the ground map, compiling nothing', async () => {
		const { scene, draw, programs } = await strip();
		const plane = new THREE.Mesh(
			new THREE.PlaneGeometry(4, 1).rotateX(-Math.PI / 2),
			createMaterial('terrain', { params: { macroTint: 0 } })
		);
		scene.add(plane);
		const maps = new CellMaps();
		const floors = (ids: number[]) =>
			maps.update(
				{ kind: 'square', width: 4, height: 1, cellSize: 1 },
				{ fog: null, mode: 'gm' },
				'day',
				null,
				null,
				new Uint8Array(ids),
				null
			);
		floors([0, 3, 4, 7]); // plain, grass, dirt, void
		const [plain, grass, dirt, voided] = await draw();
		const p0 = programs();
		expect(plain.every((v) => v > 200)).toBe(true);
		expect(grass[1]).toBeGreaterThan(grass[0] + 10);
		expect(dirt[0]).toBeGreaterThan(dirt[2] + 10);
		expect(Math.max(...voided)).toBeLessThan(12);
		// Painting again changes the data, not the program.
		floors([7, 0, 0, 3]);
		const [v, p, , g] = await draw();
		expect(Math.max(...v)).toBeLessThan(12);
		expect(p.every((c) => c > 200)).toBe(true);
		expect(g[1]).toBeGreaterThan(g[0] + 10);
		expect(programs()).toBe(p0);
		maps.dispose();
	});
});
