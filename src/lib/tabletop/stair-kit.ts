// A kit's stair pieces (#255 with #261's greybox kits): the `stair.riser`, `stair.side` and
// `railing` models of the environment's kit, drawn where `stairsOf` put them, one InstancedMesh
// per model part on the prop kind's model variant (vertex colours, instanced: the props' own
// program, so nothing new compiles). A role is handed to the stairs only once every variant of it
// has loaded (`ready`), so until then, and for a model that fails, the procedural steps draw:
// never nothing. Never picked; casts and receives the sun's shadow.

import * as THREE from 'three/webgpu';
import { PLAIN_KIT, type KitDef, type KitRole } from '$lib/assets/kit';
import { loadManifest } from '$lib/assets/load';
import { STEP_HEIGHT } from './ground';
import { addInstanceTints, createMaterial } from './materials';
import { loadModel, modelNow, partsOf } from './models';
import type { StairPiece } from './world/stairs';
import type { WorldShape } from './world/shape';

const ROLES: readonly KitRole[] = ['stair.riser', 'stair.side', 'railing'];
/** Directions by `DIRS` index (regions.ts): north, east, south, west, as (x, z) in the world. */
const DIRS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0]
] as const;

/** The group's name (the render spec finds it by it). */
export const STAIR_KIT = 'stair-kit';

export class StairKit {
	readonly group = Object.assign(new THREE.Group(), { name: STAIR_KIT });
	private kit: KitDef | null = null;
	private environment: string | null | undefined = undefined;
	private material = createMaterial('prop', { instanced: true, vertexColors: true });
	private meshes: THREE.InstancedMesh[] = [];

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

	/** Draws the kit pieces of a shape's stairs (all of them: a table has a few dozen). */
	sync(shape: WorldShape): void {
		this.clear();
		const pieces = (shape.stairs as { pieces?: StairPiece[] } | undefined)?.pieces ?? [];
		const byModel = new Map<string, THREE.Matrix4[]>();
		const { width: w, height: h, cellSize: cs } = shape.grid;
		const m = new THREE.Matrix4();
		for (const p of pieces) {
			if (!p.model) continue;
			const model = modelNow(p.model);
			if (!model) continue;
			const [x, y] = [p.cell % w, Math.floor(p.cell / w)];
			const [dx, dz] = DIRS[p.dir];
			const at = new THREE.Vector3(
				(x + 0.5 + dx / 2 - w / 2) * cs,
				shape.ground.floorY({ x, y }),
				(y + 0.5 + dz / 2 - h / 2) * cs
			);
			// A side repeats down its drop by its own height (#261's convention for pieces below a floor).
			const tall = -model.entry.bounds.min[1];
			const depth = p.role === 'stair.side' ? (p.drop ?? 0) * STEP_HEIGHT : 0;
			const copies = tall > 0 ? Math.max(1, Math.ceil(depth / tall - 1e-6)) : 1;
			const list = byModel.get(p.model) ?? [];
			for (let k = 0; k < copies; k++) {
				m.makeRotationY(Math.atan2(dx, dz)).scale(new THREE.Vector3(cs, cs, cs));
				m.setPosition(at.x, at.y - k * tall * cs, at.z);
				list.push(m.clone());
			}
			byModel.set(p.model, list);
		}
		for (const [id, matrices] of byModel) {
			const model = modelNow(id)!;
			for (const part of partsOf(model, 'body')) {
				const geometry = part.geometry.clone();
				addInstanceTints(geometry, matrices.length);
				const mesh = new THREE.InstancedMesh(geometry, this.material, matrices.length);
				matrices.forEach((mat, i) => mesh.setMatrixAt(i, mat));
				mesh.castShadow = mesh.receiveShadow = true;
				mesh.raycast = () => {};
				this.group.add(mesh);
				this.meshes.push(mesh);
			}
		}
	}

	dispose(): void {
		this.clear();
		this.material.dispose();
	}

	private clear(): void {
		for (const mesh of this.meshes) {
			mesh.geometry.dispose();
			mesh.removeFromParent();
		}
		this.meshes = [];
	}
}

const isLoaded = (id: string) => {
	const model = modelNow(id);
	return !!model && !model.preview;
};
