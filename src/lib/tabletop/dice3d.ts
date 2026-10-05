// 3D dice: tumble across the table and land showing the server's result.
// Presentation only: the numbers were decided on the server before this
// runs. No physics engine: a scripted, seeded arc with bounces and a decaying
// spin that settles into the orientation showing the rolled face, so every
// client sees the same throw.

import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { interleavedGradientNoise, mrt, output, screenCoordinate, uniform, vec4 } from 'three/tsl';
import { labelFont } from './label-font';
import { buildDieModel, landingQuaternion, type DieModel } from './dice-geometry';
import { DIE_LABELS, seededRandom } from './dice-faces';
import { gridToWorld, worldToGrid, type SquareGrid } from '$lib/game/grid';
import { VOID } from '$lib/game/floor';
import { WALL_HEIGHT, type Ground } from './ground';
import type { DieKind, ThrownDie } from './dice-throw';
import { worldTexture } from './materials/texture-quality';
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
	root: THREE.Group;
	materials: THREE.MeshStandardNodeMaterial[];
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

/**
 * Dice are not the world: they write "shown" into the scene pass's `hidden` attachment (post.ts),
 * so the output stage never blacks them out where they fly over a cell the fog hides (#173).
 * One node for every die, so they share their programs.
 */
const SHOWN = mrt({ output, hidden: vec4(0, 0, 0, output.a) });

/** How much of a die still shows as it fades (`userData.fade` on each of its meshes, 1 unless fading). */
const fade = uniform(1).onObjectUpdate(
	({ object }: { object: THREE.Object3D | null }) => (object?.userData.fade as number) ?? 1
);
const Fn = TSL.Fn as unknown as (body: () => THREE.Node) => () => THREE.Node;
const { Discard, If } = TSL as unknown as Record<'Discard' | 'If', (...args: unknown[]) => void>;
/**
 * Fades by a screen-door dither against `fade`, as a GM-hidden mini does (materials/hooks.ts):
 * turning `transparent` on to fade would be a program of its own on the first roll's last frames
 * (#180).
 */
const FADING = Fn(() => {
	If(interleavedGradientNoise(screenCoordinate.xy).greaterThanEqual(fade), () => Discard());
	return output;
})();

/**
 * A die's material. Not a kind (#169): a roll is public and may land over black cells, which the
 * kinds' `worldModify` would black out with no strength to set per material, and dice are flat
 * shaded. Warmed up by the tabletop's gallery (`DiceLayer.gallery`, #180) instead.
 */
export function dieMaterial(parameters: THREE.MeshStandardMaterialParameters) {
	const material = new THREE.MeshStandardNodeMaterial(parameters);
	material.mrtNode = SHOWN;
	material.outputNode = FADING;
	return material;
}
const smoothstep = (a: number, b: number, t: number) => {
	const u = Math.min(Math.max((t - a) / (b - a), 0), 1);
	return u * u * (3 - 2 * u);
};

export class DiceLayer {
	readonly group = new THREE.Group();
	private models = new Map<DieKind, DieModel>();
	private labels = new Map<string, THREE.CanvasTexture>();
	private decal = new THREE.PlaneGeometry(1, 1);
	private active: ActiveDie[] = [];
	private standIn: { root: THREE.Group; materials: THREE.Material[] } | null = null;

	/**
	 * Throws dice from `aim.from` towards `aim.center` (world units; `center.y` the floor there). Each
	 * lands on `aim.surface` where it falls (#247; flat at `center.y` without one). Returns how long
	 * until they have all landed, in ms.
	 */
	throw(t: DiceThrow, aim: DiceAim, cellSize: number, instant: boolean, now: number): number {
		const { center, from, surface = () => center.y } = aim;
		// A new throw sweeps the previous dice off the table.
		for (const d of this.active) this.remove(d);
		this.active = [];
		const rand = seededRandom(t.seq * 2654435761);
		const size = cellSize * DIE_SCALE;
		let longest = 0;
		t.dice.forEach((die, i) => {
			const model = this.model(die.kind);
			const { root, materials } = this.buildDie(die.kind, model, t.color);
			root.scale.setScalar(size);
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
				root,
				materials,
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
			this.group.add(root);
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
		const gone = this.active.filter((d) => d.age > d.delay + d.flight + REST_S + FADE_S);
		for (const d of gone) this.remove(d);
		this.active = this.active.filter((d) => !gone.includes(d));
		return this.active.length > 0;
	}

	/** Forgets the drawn face labels, so the next throw draws them in the label font. */
	clearLabels(): void {
		if (this.active.length) return;
		for (const tex of this.labels.values()) tex.dispose();
		this.labels.clear();
	}

	/** A die for the warm-up to compile (#180): dice otherwise compile on the first roll. */
	gallery(): THREE.Object3D[] {
		this.standIn ??= this.buildDie('d6', this.model('d6'), '#ffffff');
		return [standIn(this.standIn.root)];
	}

	dispose(): void {
		for (const d of this.active) this.remove(d);
		this.active = [];
		for (const m of this.standIn?.materials ?? []) m.dispose();
		for (const m of this.models.values()) m.geometry.dispose();
		for (const tex of this.labels.values()) tex.dispose();
		this.decal.dispose();
	}

	private pose(d: ActiveDie): void {
		const t = d.flight === 0 ? 1 : Math.min(Math.max((d.age - d.delay) / d.flight, 0), 1);
		d.root.visible = d.age >= d.delay;
		const k = easeOut(t);
		d.root.position.set(
			d.from.x + (d.to.x - d.from.x) * k,
			d.restY + (d.from.y - d.restY) * bounce(t),
			d.from.z + (d.to.z - d.from.z) * k
		);
		const spinning = d.startQ
			.clone()
			.premultiply(new THREE.Quaternion().setFromAxisAngle(d.spinAxis, d.spin * easeOut(t)));
		d.root.quaternion.copy(spinning.slerp(d.endQ, smoothstep(0.5, 0.95, t)));
		const fading = d.age - (d.delay + d.flight + REST_S);
		const shown = fading > 0 ? Math.max(0, 1 - fading / FADE_S) : 1;
		for (const mesh of d.root.children) mesh.userData.fade = shown;
	}

	private model(kind: DieKind): DieModel {
		let model = this.models.get(kind);
		if (!model) this.models.set(kind, (model = buildDieModel(kind, 1)));
		return model;
	}

	private buildDie(
		kind: DieKind,
		model: DieModel,
		color: string
	): { root: THREE.Group; materials: THREE.MeshStandardNodeMaterial[] } {
		const body = dieMaterial({
			color,
			roughness: 0.35,
			metalness: 0.05,
			flatShading: true
		});
		const root = new THREE.Group();
		const mesh = new THREE.Mesh(model.geometry, body);
		mesh.castShadow = true;
		root.add(mesh);
		const materials = [body];
		const labels = DIE_LABELS[kind];
		// Dark ink on light dice, light ink on dark ones.
		const ink = brightness(color) < 0.5 ? '#f4ecdc' : '#1b1612';
		const decal = (
			text: string,
			at: THREE.Vector3,
			normal: THREE.Vector3,
			up: THREE.Vector3,
			size: number
		) => {
			const material = dieMaterial({
				map: this.label(text, kind, ink),
				transparent: true,
				depthWrite: false,
				roughness: 0.6
			});
			materials.push(material);
			const plane = new THREE.Mesh(this.decal, material);
			const y = up
				.clone()
				.sub(normal.clone().multiplyScalar(up.dot(normal)))
				.normalize();
			const x = new THREE.Vector3().crossVectors(y, normal);
			plane.matrix.makeBasis(x, y, normal).scale(new THREE.Vector3(size, size, 1));
			plane.matrix.setPosition(at.clone().addScaledVector(normal, 0.004));
			plane.matrixAutoUpdate = false;
			root.add(plane);
		};

		model.faces.forEach((face, i) => {
			const reach = Math.min(...face.corners.map((c) => c.distanceTo(face.centroid)));
			if (model.readsAtVertex && model.apexes) {
				// d4: at each corner of each face, the label of the vertex at that corner.
				for (const corner of face.corners) {
					const j = model.apexes.findIndex((v) => v.distanceTo(corner) < 1e-4);
					const toward = corner.clone().sub(face.centroid);
					decal(
						labels[j],
						face.centroid.clone().addScaledVector(toward, 0.55),
						face.normal,
						toward,
						reach * 0.75
					);
				}
				return;
			}
			decal(labels[i], face.centroid, face.normal, this.faceUp(kind, face), reach * 1.15);
		});
		return { root, materials };
	}

	/** Which way is "up" for a face's number: towards its sharpest corner, or axis-aligned on a cube. */
	private faceUp(kind: DieKind, face: DieModel['faces'][number]): THREE.Vector3 {
		if (kind === 'd6') {
			return Math.abs(face.normal.y) > 0.9
				? new THREE.Vector3(0, 0, -1)
				: new THREE.Vector3(0, 1, 0);
		}
		const far = face.corners.reduce((a, b) =>
			b.distanceTo(face.centroid) > a.distanceTo(face.centroid) ? b : a
		);
		return far.clone().sub(face.centroid);
	}

	private label(text: string, kind: DieKind, ink: string): THREE.CanvasTexture {
		// 6 and 9 get a dot on dice where they could be confused upside down.
		const shown =
			(text === '6' || text === '9') && kind !== 'd6' && kind !== 'd4' ? `${text}.` : text;
		const key = `${ink}|${kind === 'd6' ? `pips:${text}` : shown}`;
		let tex = this.labels.get(key);
		if (tex) return tex;
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = 128;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = ink;
		if (kind === 'd6') {
			// Pips, like a real d6: readable from any side of the table.
			drawPips(ctx, Number(text));
			tex = worldTexture(new THREE.CanvasTexture(canvas));
			tex.colorSpace = THREE.SRGBColorSpace;
			this.labels.set(key, tex);
			return tex;
		}
		ctx.font = labelFont(700, shown.length > 2 ? 56 : shown.length > 1 ? 66 : 80);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(shown, 64, 68);
		tex = worldTexture(new THREE.CanvasTexture(canvas)); // the tier's anisotropy (#179)
		tex.colorSpace = THREE.SRGBColorSpace;
		this.labels.set(key, tex);
		return tex;
	}

	private remove(d: ActiveDie): void {
		this.group.remove(d.root);
		for (const m of d.materials) m.dispose();
	}
}

/** Standard pip layouts on a 3×3 grid, for faces 1–6. */
function drawPips(ctx: CanvasRenderingContext2D, value: number): void {
	const at = {
		tl: [34, 34],
		tr: [94, 34],
		ml: [34, 64],
		c: [64, 64],
		mr: [94, 64],
		bl: [34, 94],
		br: [94, 94]
	};
	const layouts: Record<number, (keyof typeof at)[]> = {
		1: ['c'],
		2: ['tl', 'br'],
		3: ['tl', 'c', 'br'],
		4: ['tl', 'tr', 'bl', 'br'],
		5: ['tl', 'tr', 'c', 'bl', 'br'],
		6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br']
	};
	for (const spot of layouts[value] ?? []) {
		const [x, y] = at[spot];
		ctx.beginPath();
		ctx.arc(x, y, value === 1 ? 17 : 12, 0, Math.PI * 2);
		ctx.fill();
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
