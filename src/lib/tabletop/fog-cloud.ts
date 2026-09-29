// The fog cloud (#174): a dark, slowly drifting mass over the cells a player has never seen. One
// mesh over the grid, a few vertices a cell (`cloudDivisions`, under `CLOUD_VERTEX_CAP`), whose
// height is how hidden the ground is under each vertex (`cloudMask`, from the viewer's own explored
// mask, so it holds nothing the viewer wasn't sent) times low fractal noise, capped at a quarter
// of a cell so it never covers a mini. It is the overlay kind with `worldModify` last, so over
// hidden cells it is exactly black like everything else there (#176), and what reads is its
// billowing edge where it meets explored ground. Players and spectators only (the GM keeps the
// tint), and only with the `fogcloud` layer on (off until the owner's review, `?off=fogcloud`).
//
// It drifts on `cloudTime`, which only moves in the scheduler's ambient frames and is held still
// on the low tier, under reduced motion and in power saver. Nothing about it is a literal that
// runtime state picks: showing it, its shape and its time are visibility, an attribute and a
// uniform, and `warm` (the same geometry and material, always visible) is the warm-up gallery's
// stand-in for it (`gallery`, warmup.ts), so turning it on compiles nothing.

import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import type { SquareGrid } from '$lib/game/grid';
import { decodeMask, type FogView } from '$lib/game/visibility';
import { cellUniforms } from './cell-maps';
import type { FogMode } from './fog';
import { cloudDivisions, cloudMask } from './fog-soft';
import { createMaterial, type KindMaterial } from './materials';
import type { N } from './materials/tsl';

/** Highest the cloud rises, in cells: under a mini's knees. */
export const CLOUD_HEIGHT = 0.25;
/** How far under the table it sinks where nothing is hidden, in cells (inside the slab). */
const SINK = 0.05;
/** The noise's frequency per cell, and how far it drifts per second (cells, both ways). */
const SCALE = 0.45;
const DRIFT = [0.05, 0.03] as const;
/** Near black, and a touch cool: what shows of it over explored ground is dimmed there too. */
const COLOUR = 0x0a0c12;
export const HIDDEN_ATTRIBUTE = 'aHidden';

/** The cloud's clock, in seconds: moved only while it drifts. */
export const cloudTime = T.uniform(0);

type Loose = (...args: unknown[]) => N;
const { attribute, clamp, float, mx_fractal_noise_float, vec2, vec3 } = T as unknown as Record<
	'attribute' | 'clamp' | 'float' | 'mx_fractal_noise_float' | 'vec2' | 'vec3',
	Loose
>;

/** The cloud's vertices: its height from the hidden mask and the drifting noise. */
function cloudPosition(): N {
	const cell = cellUniforms.cellSize as unknown as N;
	const time = cloudTime as unknown as N;
	const p = T.positionLocal as unknown as N;
	const drift = vec2(time.mul(DRIFT[0]), time.mul(DRIFT[1]));
	const at = vec3(p.xz.div(cell).mul(SCALE).add(drift), time.mul(0.02));
	const n = mx_fractal_noise_float(at, 3, 2, 0.5);
	const height = clamp(n.mul(0.6).add(0.65), float(0.2), float(1)).mul(cell.mul(CLOUD_HEIGHT));
	const sink = cell.mul(SINK);
	const hidden = attribute(HIDDEN_ATTRIBUTE, 'float');
	return vec3(p.x, hidden.mul(height.add(sink)).sub(sink), p.z);
}

export class FogCloudLayer {
	readonly group = new THREE.Group();
	/** The same mesh, never hidden and never in the scene: the warm-up's stand-in (`gallery`). */
	readonly warm: THREE.Mesh;
	private material: KindMaterial;
	private mesh: THREE.Mesh;
	private geometry = new THREE.BufferGeometry();
	private grid: SquareGrid | null = null;
	private divisions = 1;
	/** The explored mask last shaped from, by identity. */
	private explored: string | null | undefined;
	private on = false;
	/** Held still: the low tier, reduced motion, power saver. */
	private still = { tier: false, reduced: false, saver: false };
	/** Where the clock stood when the cloud last drifted, so a pause picks up where it left. */
	private last: number | null = null;

	constructor() {
		this.material = createMaterial('overlay', { params: { color: COLOUR } });
		// Opaque in effect: it hides the floor where it rises (fixed here, never toggled).
		this.material.depthWrite = true;
		(this.material as unknown as { positionNode: N }).positionNode = cloudPosition();
		this.material.name = 'fog cloud';
		this.mesh = new THREE.Mesh(this.geometry, this.material);
		this.warm = new THREE.Mesh(this.geometry, this.material);
		for (const m of [this.mesh, this.warm]) {
			m.raycast = () => {};
			m.frustumCulled = false; // its vertices rise in the shader
			m.renderOrder = 0.7; // under the mist
		}
		this.group.add(this.mesh);
		this.group.visible = false;
		// A placeholder with every attribute, so the warm-up compiles it before any grid comes.
		this.build({ kind: 'square', cellSize: 1, width: 1, height: 1 });
		this.grid = null;
	}

	/** The cloud compiled while it is hidden (warmup.ts's `Gallery`). */
	gallery(): THREE.Object3D[] {
		return [this.warm];
	}

	/** The layer switch (`layers.fogcloud`), and whether the tier holds it still (low). */
	setLayer(on: boolean, still: boolean): void {
		this.on = on;
		this.still.tier = still;
	}

	setReducedMotion(reduced: boolean): void {
		this.still.reduced = reduced;
	}

	setPowerSaver(on: boolean): void {
		this.still.saver = on;
	}

	/** Shapes the cloud for a grid and the viewer's fog: shown to a fogged player only. */
	update(grid: SquareGrid, fog: FogView | null, mode: FogMode): void {
		const shown = this.on && !!fog?.enabled && mode === 'player';
		this.group.visible = shown;
		if (!shown || !fog) return;
		const size = this.grid?.width !== grid.width || this.grid.height !== grid.height;
		if (size || this.grid?.cellSize !== grid.cellSize) this.build(grid);
		if (!size && fog.explored === this.explored) return;
		this.explored = fog.explored;
		const n = grid.width * grid.height;
		const explored = decodeMask(fog.explored, n);
		const attr = this.geometry.getAttribute(HIDDEN_ATTRIBUTE) as THREE.BufferAttribute;
		const k = this.divisions;
		cloudMask(grid.width, grid.height, k, explored, attr.array as Float32Array<ArrayBuffer>);
		attr.needsUpdate = true;
	}

	/** Moves the cloud to time `now` (ms); returns whether it drifts (an ambient frame is due). */
	tick(now: number): boolean {
		const drifting =
			this.group.visible && !this.still.tier && !this.still.reduced && !this.still.saver;
		if (drifting && this.last !== null) cloudTime.value += Math.min(0.5, (now - this.last) / 1000);
		this.last = drifting ? now : null;
		return drifting;
	}

	/** A plane over the grid, `cloudDivisions` vertices a cell, just inside its edges. */
	private build(grid: SquareGrid): void {
		this.grid = { ...grid };
		this.explored = undefined;
		const k = (this.divisions = cloudDivisions(grid.width, grid.height));
		const [cols, rows] = [grid.width * k + 1, grid.height * k + 1];
		const [w, d] = [grid.width * grid.cellSize, grid.height * grid.cellSize];
		// A hair inside the table, so no vertex lies where the cell maps count as off the grid.
		const inset = grid.cellSize * 1e-3;
		const position = new Float32Array(cols * rows * 3);
		const uv = new Float32Array(cols * rows * 2);
		for (let y = 0, i = 0; y < rows; y++)
			for (let x = 0; x < cols; x++, i++) {
				const [u, v] = [x / (cols - 1), y / (rows - 1)];
				position[i * 3] = -w / 2 + inset + u * (w - 2 * inset);
				position[i * 3 + 2] = -d / 2 + inset + v * (d - 2 * inset);
				uv[i * 2] = u;
				uv[i * 2 + 1] = v;
			}
		const index: number[] = [];
		for (let y = 0; y < rows - 1; y++)
			for (let x = 0; x < cols - 1; x++) {
				const a = y * cols + x;
				// Counter-clockwise seen from above (+y), so the front faces up.
				index.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
			}
		const old = this.geometry;
		this.geometry = new THREE.BufferGeometry();
		this.geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
		this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		this.geometry.setAttribute(
			HIDDEN_ATTRIBUTE,
			new THREE.BufferAttribute(new Float32Array(cols * rows), 1)
		);
		this.geometry.setIndex(index);
		this.mesh.geometry = this.warm.geometry = this.geometry;
		old.dispose();
	}

	dispose(): void {
		this.geometry.dispose();
		this.material.dispose();
	}
}
