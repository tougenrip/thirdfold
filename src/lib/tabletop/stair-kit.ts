// A kit's stair pieces (#255 with #261's greybox kits): the `stair.riser`, `stair.side` and
// `railing` models of the environment's kit, placed where `stairsOf` put them and baked into the
// world's chunks with the faces (the rock kind with vertex colours: each piece's own colours over
// the face's look), so they add no mesh, draw call or program (r186 gives every InstancedMesh a
// vertex stage of its own) and are rebuilt with their chunk. A role is handed to the stairs only
// once every variant of it has loaded (`ready`), so until then, and for a model that fails, the
// procedural steps draw: never nothing. Each vertex is owned by its piece's cell (fog, drop-in).

import * as THREE from 'three/webgpu';
import { PLAIN_KIT, type KitDef, type KitRole } from '$lib/assets/kit';
import { loadManifest } from '$lib/assets/load';
import { STEP_HEIGHT } from './ground';
import { loadModel, modelNow, partsOf } from './models';
import type { CliffMesh } from './world/cliffs';
import type { WorldShape } from './world/shape';
import type { StairPiece } from './world/stairs';

const ROLES: readonly KitRole[] = ['stair.riser', 'stair.side', 'railing'];
/** Directions by `DIRS` index (regions.ts): north, east, south, west, as (x, z) in the world. */
const DIRS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
] as const;

/** Cells x0 to x1 and y0 to y1 (exclusive): a chunk's. */
export type CellBox = readonly [x0: number, y0: number, x1: number, y1: number];

export class StairKit {
	private kit: KitDef | null = null;
	private environment: string | null | undefined = undefined;

	/** `onReady` is told when more of the kit's stair pieces have loaded (the stairs change). */
	constructor(private readonly onReady: () => void) {}

	/** The environment whose kit's stair pieces to draw. */
	setEnvironment(environment: string | null): void {
		if (environment === this.environment) return;
		this.environment = environment;
		void loadManifest()
			.then((m) => {
				if (environment !== this.environment) return;
				const id = (environment && m.environments[environment]?.kit) || PLAIN_KIT;
				this.kit = m.kits[id] ?? null;
				const models = ROLES.flatMap((r) => this.kit?.pieces[r]?.map((p) => p.model) ?? []);
				for (const model of models)
					void loadModel(model).then(() => environment === this.environment && this.onReady());
				this.onReady();
			})
			.catch(() => {}); // no manifest: the procedural stairs stay
	}

	/** The kit with only the stair roles whose every model has loaded, for `withStairs`. */
	ready(): KitDef | null {
		const kit = this.kit;
		if (!kit) return null;
		const pieces: KitDef['pieces'] = {};
		for (const role of ROLES) {
			const list = kit.pieces[role];
			if (list?.length && list.every((p) => isLoaded(p.model))) pieces[role] = list;
		}
		return Object.keys(pieces).length ? { ...kit, pieces } : null;
	}

	/**
	 * The kit pieces of the cells in `box` as meshes by `CLIFF_STYLES` index (`styleOf` a cell's
	 * floor), for the faces' meshes: each piece's body at its edge pivot on the higher floor, turned
	 * so +z looks down the stair or out over the side; a side repeats down its drop by its own
	 * height (#261's convention for pieces below a floor).
	 */
	chunkPieces(shape: WorldShape, box: CellBox, styleOf: (floor: number) => number): CliffMesh[] {
		const { width: w, height: h, cellSize: cs } = shape.grid;
		const out = [new Baked(), new Baked()];
		const m = new THREE.Matrix4();
		const turn = new THREE.Matrix3();
		const scale = new THREE.Vector3(cs, cs, cs);
		for (const p of (shape.stairs as { pieces?: StairPiece[] } | undefined)?.pieces ?? []) {
			if (!p.model) continue;
			const [x, y] = [p.cell % w, Math.floor(p.cell / w)];
			if (x < box[0] || y < box[1] || x >= box[2] || y >= box[3]) continue;
			const model = modelNow(p.model);
			if (!model) continue;
			const [dx, dz] = DIRS[p.dir];
			const tall = -model.entry.bounds.min[1];
			const depth = p.role === 'stair.side' ? (p.drop ?? 0) * STEP_HEIGHT : 0;
			const copies = tall > 0 ? Math.max(1, Math.ceil(depth / tall - 1e-6)) : 1;
			const floorY = shape.ground.floorY({ x, y });
			const style = styleOf(shape.floor[p.cell]);
			for (let k = 0; k < copies; k++) {
				m.makeRotationY(Math.atan2(dx, dz)).scale(scale);
				m.setPosition(
					(x + 0.5 + dx / 2 - w / 2) * cs,
					floorY - k * tall * cs,
					(y + 0.5 + dz / 2 - h / 2) * cs
				);
				turn.getNormalMatrix(m);
				for (const part of partsOf(model, 'body')) out[style].add(part.geometry, m, turn, p.cell);
			}
		}
		return out.map((b) => b.done());
	}
}

const shade = (c: number) => Math.min(c * 2, 1.3);

const isLoaded = (id: string) => {
	const model = modelNow(id);
	return !!model && !model.preview;
};

/** Geometry placed into one mesh: positions, normals, vertex colours, owners and triangles. */
class Baked {
	private pos: number[] = [];
	private nor: number[] = [];
	private col: number[] = [];
	private own: number[] = [];
	private idx: number[] = [];
	private readonly v = new THREE.Vector3();

	add(g: THREE.BufferGeometry, m: THREE.Matrix4, turn: THREE.Matrix3, owner: number): void {
		const position = g.getAttribute('position');
		const normal = g.getAttribute('normal');
		const color = g.getAttribute('color');
		const base = this.own.length;
		for (let i = 0; i < position.count; i++) {
			this.v.fromBufferAttribute(position, i).applyMatrix4(m);
			this.pos.push(this.v.x, this.v.y, this.v.z);
			if (normal) this.v.fromBufferAttribute(normal, i).applyMatrix3(turn).normalize();
			else this.v.set(0, 1, 0);
			this.nor.push(this.v.x, this.v.y, this.v.z);
			// The faces' material already wears the environment's look: a piece's colour (its surface's,
			// until #252's surface layer) shades it, doubled so a mid stone reads near 1 as a face does.
			// ponytail: a guessed gain; the kit material (#252) replaces it.
			if (color) this.col.push(...[color.getX(i), color.getY(i), color.getZ(i)].map(shade));
			else this.col.push(1, 1, 1);
			this.own.push(owner);
		}
		const index = g.getIndex();
		if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i));
		else for (let i = 0; i < position.count; i++) this.idx.push(base + i);
	}

	done(): CliffMesh {
		return {
			positions: new Float32Array(this.pos),
			normals: new Float32Array(this.nor),
			colors: new Float32Array(this.col),
			indices: new Uint32Array(this.idx),
			owners: new Int32Array(this.own)
		};
	}
}
