// 3D dice: tumble across the table and land showing the server's result.
// Presentation only: the numbers were decided on the server before this
// runs. No physics engine: a scripted, seeded arc with bounces and a decaying
// spin that settles into the orientation showing the rolled face, so every
// client sees the same throw. Since #275 they are resin with engraved numerals
// from one atlas (materials/dice.ts), drawn as one InstancedMesh per kind.

import * as THREE from 'three/webgpu';
import { buildDieModel, landingQuaternion, type DieModel } from './dice-geometry';
import { seededRandom } from './dice-faces';
import { gridToWorld, worldToGrid, type SquareGrid } from '$lib/game/grid';
import { VOID } from '$lib/game/floor';
import { WALL_HEIGHT, type Ground } from './ground';
import { MAX_THROWN_DICE, type DieKind, type ThrownDie } from './dice-throw';
import {
	createDiceMaterial,
	DIE_BODY_ATTRIBUTE,
	DIE_FADE_ATTRIBUTE,
	DIE_INK_ATTRIBUTE,
	setDiceTier
} from './materials/dice';
import { PIECE_MIN } from './materials/piece';
import { standIn } from './warmup';

export interface DiceThrow {
	/** Room log sequence number of the roll; seeds the throw. */
	seq: number;
	dice: ThrownDie[];
	/** Body colour, e.g. the roller's token colour. */
	color: string;
}

/** Die size relative to a grid cell. */
const DIE_SCALE = 0.9;
const FLIGHT_S = 1.3;
const REST_S = 3.2;
const FADE_S = 0.5;

/**
 * The height dice rest on at a world point, or null where they may not land (void, off the grid).
 * The renderer's is `diceSurface`, the drawn floors (#247).
 */
export type SurfaceY = (x: number, z: number) => number | null;

/** Where a throw lands and comes from (`throwFromView`), and the surface it lands on. */
export interface DiceAim {
	center: THREE.Vector3;
	from: THREE.Vector3;
	surface?: SurfaceY;
}

/** The drawn floor under a point: its cell's `floorY`, null off the grid or on a void cell. */
export function diceSurface(
	grid: SquareGrid,
	ground: Ground | null,
	floor: Uint8Array | null
): SurfaceY {
	return (x, z) => {
		const cell = worldToGrid(grid, { x, z });
		if (!cell || floor?.[cell.y * grid.width + cell.x] === VOID) return null;
		return ground ? ground.floorY(cell) : 0;
	};
}

/**
 * Where a die meant for `(x, z)` (`r` out from `center` along its spiral) lands: there if the surface
 * holds it, else pulled in along the radius a quarter cell at a time to the first spot that does
 * (deterministic: no random draws, so every client's throw is the same). Its height is the highest
 * surface under its centre and four points half a die out, so it never sinks into the face of raised
 * ground beside it; null if nothing on the way in holds it.
 */
export function landing(
	center: THREE.Vector3,
	r: number,
	a: number,
	surface: SurfaceY,
	cellSize: number,
	half: number
): { x: number; y: number; z: number } | null {
	const step = cellSize / 4;
	for (let k = r; ; k = Math.max(0, k - step)) {
		const x = center.x + Math.cos(a) * k;
		const z = center.z + Math.sin(a) * k;
		const y = surface(x, z);
		if (y !== null) {
			const around = [
				[half, 0],
				[-half, 0],
				[0, half],
				[0, -half]
			].map(([dx, dz]) => surface(x + dx, z + dz) ?? -Infinity);
			return { x, y: Math.max(y, ...around), z };
		}
		if (k === 0) return null;
	}
}

interface ActiveDie {
	kind: DieKind;
	/** Its instance in its kind's mesh. */
	slot: number;
	size: number;
	from: THREE.Vector3;
	to: THREE.Vector3;
	restY: number;
	startQ: THREE.Quaternion;
	endQ: THREE.Quaternion;
	spinAxis: THREE.Vector3;
	spin: number;
	delay: number;
	flight: number;
	/** When the throw started (ms, performance.now clock). */
	startedAt: number;
	/** Seconds since the throw started. */
	age: number;
}

/** 0→1 progress to a height multiplier: a drop, then two shrinking bounces. */
function bounce(t: number): number {
	if (t < 0.45) return 1 - (t / 0.45) ** 2;
	const hop = (from: number, to: number, h: number) => {
		const u = (t - from) / (to - from);
		return 4 * h * u * (1 - u);
	};
	if (t < 0.72) return hop(0.45, 0.72, 0.18);
	if (t < 0.88) return hop(0.72, 0.88, 0.06);
	return 0;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

const smoothstep = (a: number, b: number, t: number) => {
	const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
	return u * u * (3 - 2 * u);
};

/** Dark ink on light dice, light ink on dark ones. */
const INK = { light: new THREE.Color('#f4ecdc'), dark: new THREE.Color('#1b1612') };

/**
 * A kind's dice as one InstancedMesh (#275) with the per-instance body, ink and fade the dice
 * material reads. Its capacity is the kit pieces' `PIECE_MIN` (materials/piece.ts), though a throw
 * shows at most `MAX_THROWN_DICE`: r186 gives an InstancedMesh of 1,024 or fewer its own vertex
 * stage (the matrices a uniform array), so every kind's mesh would compile its own programs on its
 * first throw; past that the matrices are an attribute and all kinds are one program.
 */
function diceMesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
	const n = PIECE_MIN;
	const each = (size: number) =>
		new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
	geometry.setAttribute(DIE_BODY_ATTRIBUTE, each(3));
	geometry.setAttribute(DIE_INK_ATTRIBUTE, each(3));
	geometry.setAttribute(DIE_FADE_ATTRIBUTE, each(1));
	const mesh = new THREE.InstancedMesh(geometry, material, n);
	mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	mesh.castShadow = true;
	mesh.frustumCulled = false; // its instances fly far from where its bounds were worked out
	mesh.count = 0;
	return mesh;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class DiceLayer {
	readonly group = new THREE.Group();
	private models = new Map<DieKind, DieModel>();
	private meshes = new Map<DieKind, THREE.InstancedMesh>();
	private material: THREE.MeshPhysicalNodeMaterial | null = null;
	private active: ActiveDie[] = [];
	private standIn: THREE.InstancedMesh | null = null;

	/**
	 * Throws dice from `aim.from` towards `aim.center` (world units; `center.y` the floor there). Each
	 * lands on `aim.surface` where it falls (#247; flat at `center.y` without one). Returns how long
	 * until they have all landed, in ms.
	 */
	throw(t: DiceThrow, aim: DiceAim, cellSize: number, instant: boolean, now: number): number {
		const { center, from, surface = () => center.y } = aim;
		this.clear(); // a new throw sweeps the previous dice off the table
		const rand = seededRandom(t.seq * 2654435761);
		const size = cellSize * DIE_SCALE;
		const body = new THREE.Color(t.color);
		const ink = brightness(t.color) < 0.5 ? INK.light : INK.dark;
		let longest = 0;
		t.dice.slice(0, MAX_THROWN_DICE).forEach((die, i) => {
			const model = this.model(die.kind);
			const mesh = this.mesh(die.kind);
			const slot = mesh.count++;
			const attr = (name: string) => mesh.geometry.getAttribute(name) as THREE.BufferAttribute;
			attr(DIE_BODY_ATTRIBUTE).setXYZ(slot, body.r, body.g, body.b).needsUpdate = true;
			attr(DIE_INK_ATTRIBUTE).setXYZ(slot, ink.r, ink.g, ink.b).needsUpdate = true;
			// Golden-angle spiral so dice land near each other without overlapping.
			const r = cellSize * 1.1 * Math.sqrt(i + 0.3);
			const a = i * 2.39996 + rand() * 0.6;
			const spot = landing(center, r, a, surface, cellSize, size / 2);
			const to = spot ? new THREE.Vector3(spot.x, 0, spot.z) : center.clone().setY(0);
			const spread = new THREE.Vector3((rand() - 0.5) * cellSize, 0, (rand() - 0.5) * cellSize);
			const flight = instant ? 0 : FLIGHT_S + rand() * 0.25;
			const delay = instant ? 0 : i * 0.06;
			longest = Math.max(longest, delay + flight);
			const active: ActiveDie = {
				kind: die.kind,
				slot,
				size,
				from: from.clone().add(spread),
				to,
				restY: (spot?.y ?? center.y) + model.inradius * size,
				startQ: new THREE.Quaternion().setFromEuler(
					new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3)
				),
				endQ: landingQuaternion(model, die.face, rand() * Math.PI * 2),
				spinAxis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
				spin: 10 + rand() * 8,
				delay,
				flight,
				startedAt: now,
				age: 0
			};
			this.pose(active);
			this.active.push(active);
		});
		return longest * 1000;
	}

	/**
	 * Poses the dice for wall-clock time `now` (ms). Real time, not summed frame
	 * steps, so the dice land when the result card says they have even when
	 * frames are slow. Returns true while any die is on the table.
	 */
	tick(now: number): boolean {
		for (const d of this.active) {
			d.age = (now - d.startedAt) / 1000;
			this.pose(d);
		}
		if (this.active.every((d) => this.gone(d))) this.clear();
		return this.active.length > 0;
	}

	/** The dice on the table (faded ones gone), with their instance matrices: what tests read. */
	dice(): { kind: DieKind; matrix: THREE.Matrix4 }[] {
		return this.active
			.filter((d) => !this.gone(d))
			.map((d) => ({
				kind: d.kind,
				matrix: this.meshes.get(d.kind)!.getMatrixAt(d.slot, new THREE.Matrix4())
			}));
	}

	/** The low tier's resin has no clearcoat (a uniform). */
	setTier(tier: string): void {
		setDiceTier(tier);
	}

	/** A die for the warm-up to compile (#180): dice otherwise compile on the first roll. */
	gallery(): THREE.Object3D[] {
		if (!this.standIn) {
			const geometry = buildDieModel('d6', 1).geometry;
			this.standIn = diceMesh(geometry, this.diceMaterial());
			this.standIn.count = 1;
			this.standIn.setMatrixAt(0, new THREE.Matrix4());
			(geometry.getAttribute(DIE_FADE_ATTRIBUTE) as THREE.BufferAttribute).setX(0, 1);
		}
		return [standIn(this.standIn)];
	}

	dispose(): void {
		this.clear();
		this.material?.dispose();
		this.standIn?.geometry.dispose();
		for (const m of this.models.values()) m.geometry.dispose();
	}

	private gone(d: ActiveDie): boolean {
		return d.age > d.delay + d.flight + REST_S + FADE_S;
	}

	private clear(): void {
		this.active = [];
		for (const mesh of this.meshes.values()) mesh.count = 0;
	}

	private pose(d: ActiveDie): void {
		const mesh = this.meshes.get(d.kind)!;
		const fade = mesh.geometry.getAttribute(DIE_FADE_ATTRIBUTE) as THREE.BufferAttribute;
		const fading = d.age - (d.delay + d.flight + REST_S);
		fade.setX(d.slot, fading > 0 ? Math.max(0, 1 - fading / FADE_S) : 1).needsUpdate = true;
		mesh.instanceMatrix.needsUpdate = true;
		if (d.age < d.delay || this.gone(d)) {
			mesh.setMatrixAt(d.slot, ZERO);
			return;
		}
		const t = d.flight === 0 ? 1 : Math.min(Math.max((d.age - d.delay) / d.flight, 0), 1);
		const k = easeOut(t);
		const at = new THREE.Vector3(
			d.from.x + (d.to.x - d.from.x) * k,
			d.restY + (d.from.y - d.restY) * bounce(t),
			d.from.z + (d.to.z - d.from.z) * k
		);
		const spinning = d.startQ
			.clone()
			.premultiply(new THREE.Quaternion().setFromAxisAngle(d.spinAxis, d.spin * easeOut(t)));
		const q = spinning.slerp(d.endQ, smoothstep(0.5, 0.95, t));
		const s = new THREE.Vector3().setScalar(d.size);
		mesh.setMatrixAt(d.slot, new THREE.Matrix4().compose(at, q, s));
	}

	private model(kind: DieKind): DieModel {
		let model = this.models.get(kind);
		if (!model) this.models.set(kind, (model = buildDieModel(kind, 1)));
		return model;
	}

	private diceMaterial(): THREE.MeshPhysicalNodeMaterial {
		return (this.material ??= createDiceMaterial());
	}

	/** A kind's mesh, made on its first throw: the shared material, so it compiles nothing. */
	private mesh(kind: DieKind): THREE.InstancedMesh {
		let mesh = this.meshes.get(kind);
		if (!mesh) {
			mesh = diceMesh(this.model(kind).geometry, this.diceMaterial());
			this.meshes.set(kind, mesh);
			this.group.add(mesh);
		}
		return mesh;
	}
}

/** Perceived brightness (0–1) of a `#rrggbb` colour, for picking readable ink. */
function brightness(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Where dice land (around what the camera looks at, on the floor there, raised ground included) and
 * where they are thrown from (the viewer's side, above the walls standing on that floor). Where the
 * camera looks at void or past the grid, around the nearest cell they may land on.
 */
export function throwFromView(
	target: THREE.Vector3,
	cameraPosition: THREE.Vector3,
	grid: SquareGrid,
	ground: Ground | null,
	floor: Uint8Array | null
): Required<DiceAim> {
	const cellSize = grid.cellSize;
	const surface = diceSurface(grid, ground, floor); // the drawn floors, no void (#247)
	const center = new THREE.Vector3(target.x, surface(target.x, target.z) ?? NaN, target.z);
	if (Number.isNaN(center.y)) {
		// ponytail: a scan of every cell (10,000 at most), once per throw off the ground.
		let best = Infinity;
		center.y = 0;
		for (let y = 0; y < grid.height; y++)
			for (let x = 0; x < grid.width; x++) {
				const w = gridToWorld(grid, { x, y });
				const d = (w.x - target.x) ** 2 + (w.z - target.z) ** 2;
				const h = d < best ? surface(w.x, w.z) : null;
				if (h !== null) [best, center.x, center.y, center.z] = [d, w.x, h, w.z];
			}
	}
	const toward = new THREE.Vector3(cameraPosition.x - center.x, 0, cameraPosition.z - center.z);
	if (toward.lengthSq() < 1e-6) toward.set(0, 0, 1);
	toward.normalize().multiplyScalar(cellSize * 5);
	const from = center
		.clone()
		.add(toward)
		.setY(center.y + cellSize * (WALL_HEIGHT + 1)); // above the walls
	return { center, from, surface };
}
