// Editor feedback drawn on the table: wall and door outlines, corner markers,
// areas about to be revealed or hidden, the beacon a new player is shown to,
// and the highlighted cell. Each sits on the ground it marks (#247): an area
// is a tile per patch of cells at one floor, a corner on the highest floor
// round it, a segment a box per run of edges from the lower floor beside it.
// They are drawn from a pool of instanced meshes, one per geometry and
// material, so a hover only rewrites instance matrices and counts.

import * as THREE from 'three/webgpu';
import { cornerToWorld, gridToWorld, type GridPos, type SquareGrid } from '$lib/game/grid';
import { unitEdges } from '$lib/game/objects';
import { groundFor, WALL_HEIGHT, type Ground } from './ground';
import type { HighlightKind, PreviewItem } from './types';
import { standIn } from './warmup';

/** The colours that mean move, blocked and place (G6: colour-vision.spec.ts). */
export const HIGHLIGHT = { move: 0xe0a458, blocked: 0xe27a6b, place: 0x7fc47a } satisfies Record<
	HighlightKind,
	number
>;

/** The pooled meshes: the box in five tones, the corner marker, the beacon's column and ring. */
export const BUCKETS = [
	'valid',
	'invalid',
	'door',
	'reveal',
	'hide',
	'corner',
	'beacon',
	'beaconRing'
] as const;
export type Bucket = (typeof BUCKETS)[number];

/** One instance: its centre, its scale and its turn about the vertical (world units, radians). */
export interface Placement {
	x: number;
	y: number;
	z: number;
	sx: number;
	sy: number;
	sz: number;
	ry: number;
}

/**
 * Where every preview item's instances go, by bucket (pure, #247). Heights come from `ground`'s
 * `floorY`, the drawn floors: an area is a tile per patch of cells at one floor (rows of equal
 * floors merged, then equal rows), so one across levels steps with the ground; a corner sits on the
 * highest floor round it; a segment is a box per run of unit edges with the same floors beside
 * them, from the lower floor to the preview's height above the higher, like a wall.
 */
export function previewPlacements(
	items: readonly PreviewItem[],
	grid: SquareGrid,
	ground: Ground | null
): Record<Bucket, Placement[]> {
	const g = ground ?? groundFor(grid, null);
	const size = grid.cellSize;
	const out = Object.fromEntries(BUCKETS.map((b) => [b, []])) as unknown as Record<
		Bucket,
		Placement[]
	>;
	const put = (b: Bucket, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0) =>
		out[b].push({ x, y, z, sx, sy, sz, ry });
	for (const item of items) {
		if (item.kind === 'area') {
			for (const r of patches(g, item.from, item.to)) {
				const [p, q] = [cornerToWorld(grid, r.from), cornerToWorld(grid, r.to)];
				const [sx, sz] = [q.x - p.x, q.z - p.z];
				put(item.tone, p.x + sx / 2, r.floor + 0.02 * size, p.z + sz / 2, sx, 0.04 * size, sz);
			}
		} else if (item.kind === 'beacon') {
			const w = gridToWorld(grid, item.at);
			const floor = g.floorY(item.at);
			put('beacon', w.x, floor + 1.1 * size, w.z, size, 2.2 * size, size);
			put('beaconRing', w.x, floor + 0.03 * size, w.z, size);
		} else if (item.kind === 'corner') {
			const w = cornerToWorld(grid, item.at);
			put('corner', w.x, cornerFloor(g, item.at) + 0.15 * size, w.z, size);
		} else {
			const height = WALL_HEIGHT * size * (item.tone === 'door' ? 0.9 : 0.5);
			const edges = unitEdges(item.a, item.b);
			const runs: { from: number; to: number; low: number; high: number }[] = [];
			edges.forEach((e, i) => {
				const { low, high } = g.edgeFloors(e);
				const last = runs.at(-1);
				if (last && last.low === low && last.high === high) last.to = i + 1;
				else runs.push({ from: i, to: i + 1, low, high });
			});
			// The segment's ends reach past its corners, as a wall's do; its runs only meet.
			const reach = 0.06 * size;
			for (const run of runs) {
				const p = cornerToWorld(grid, edges[run.from].a);
				const q = cornerToWorld(grid, edges[run.to - 1].b);
				const length = Math.hypot(q.x - p.x, q.z - p.z);
				const [ux, uz] = [(q.x - p.x) / length, (q.z - p.z) / length];
				const before = run.from === 0 ? reach : 0;
				const after = run.to === edges.length ? reach : 0;
				const shift = (after - before) / 2;
				const top = run.high + height;
				put(
					item.tone,
					(p.x + q.x) / 2 + ux * shift,
					(run.low + top) / 2,
					(p.z + q.z) / 2 + uz * shift,
					length + before + after,
					top - run.low,
					0.18 * size,
					Math.atan2(-(q.z - p.z), q.x - p.x)
				);
			}
		}
	}
	return out;
}

/** A rectangle of cells at one floor: corners `from` (its least) and `to` (past its greatest). */
interface Patch {
	from: GridPos;
	to: GridPos;
	floor: number;
}

/**
 * The cells from `a` to `b` (either way round) as rectangles of one floor each: each row's runs of
 * equal floors, each joined to the one above it when that has the same span and floor. A flat area
 * is one patch, however large.
 */
export function patches(ground: Ground, a: GridPos, b: GridPos): Patch[] {
	const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
	const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
	const done: Patch[] = [];
	let open: Patch[] = [];
	for (let y = y0; y <= y1; y++) {
		const row: Patch[] = [];
		for (let x = x0; x <= x1; x++) {
			const floor = ground.floorY({ x, y });
			const last = row.at(-1);
			if (last && last.floor === floor) last.to.x = x + 1;
			else row.push({ from: { x, y }, to: { x: x + 1, y: y + 1 }, floor });
		}
		const next: Patch[] = [];
		for (const run of row) {
			const above = open.find(
				(p) => p.from.x === run.from.x && p.to.x === run.to.x && p.floor === run.floor
			);
			if (above) {
				above.to.y = y + 1;
				next.push(above);
			} else next.push(run);
		}
		done.push(...open.filter((p) => !next.includes(p)));
		open = next;
	}
	return [...done, ...open];
}

/** The highest floor of the (up to four) cells round a corner. */
function cornerFloor(ground: Ground, c: GridPos): number {
	return Math.max(
		ground.floorY({ x: c.x - 1, y: c.y - 1 }),
		ground.floorY({ x: c.x, y: c.y - 1 }),
		ground.floorY({ x: c.x - 1, y: c.y }),
		ground.floorY(c)
	);
}

/**
 * Instances each pooled mesh holds, made once: r186 gives every InstancedMesh a vertex stage of its
 * own (materials.svelte.spec.ts), so a mesh grown mid-game would compile. Patches and runs keep the
 * counts far below it (a flat area is one); past it the rest is left out.
 * ponytail: a fixed pool; an area over a checkerboard of levels wider than this shows in part.
 */
export const PREVIEW_CAPACITY = 1024;

export class PreviewLayer {
	readonly group = new THREE.Group();
	readonly highlight: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
	private box = new THREE.BoxGeometry(1, 1, 1);
	private corner = new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16);
	private beaconColumn = new THREE.CylinderGeometry(0.32, 0.42, 1, 24, 1, true);
	private beaconRing = new THREE.RingGeometry(0.36, 0.48, 32).rotateX(-Math.PI / 2);
	private materials = {
		valid: new THREE.MeshBasicMaterial({ color: 0x7fc47a, transparent: true, opacity: 0.55 }),
		invalid: new THREE.MeshBasicMaterial({ color: 0xe27a6b, transparent: true, opacity: 0.55 }),
		door: new THREE.MeshBasicMaterial({ color: 0xe0a458, transparent: true, opacity: 0.7 }),
		reveal: new THREE.MeshBasicMaterial({ color: 0xf2e6d0, transparent: true, opacity: 0.25 }),
		hide: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
		beacon: new THREE.MeshBasicMaterial({
			color: 0x9fd7ff,
			transparent: true,
			opacity: 0.22,
			side: THREE.DoubleSide,
			depthWrite: false
		}),
		beaconRing: new THREE.MeshBasicMaterial({
			color: 0xbfe6ff,
			transparent: true,
			opacity: 0.8,
			side: THREE.DoubleSide,
			depthWrite: false
		})
	};
	/**
	 * One instanced mesh per bucket, made once with `PREVIEW_CAPACITY` instances. Always visible,
	 * drawing nothing while its count is 0, so the warm-up and the first frames compile them.
	 */
	readonly pool: ReadonlyMap<Bucket, THREE.InstancedMesh>;
	private stands: THREE.Object3D[] | null = null;
	private matrix = new THREE.Matrix4();
	private turn = new THREE.Quaternion();
	private at = new THREE.Vector3();
	private scale = new THREE.Vector3();
	private up = new THREE.Vector3(0, 1, 0);

	constructor() {
		this.group.renderOrder = 2;
		this.highlight = new THREE.Mesh(
			new THREE.PlaneGeometry(0.94, 0.94),
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false })
		);
		this.highlight.rotation.x = -Math.PI / 2;
		this.highlight.visible = false;
		this.highlight.renderOrder = 2; // above the fog overlay
		const shapes = { corner: this.corner, beacon: this.beaconColumn, beaconRing: this.beaconRing };
		this.pool = new Map(
			BUCKETS.map((b) => {
				const geometry = shapes[b as keyof typeof shapes] ?? this.box;
				const material = this.materials[b === 'corner' ? 'valid' : b];
				const mesh = new THREE.InstancedMesh(geometry, material, PREVIEW_CAPACITY);
				mesh.frustumCulled = false; // its instances move on every call
				mesh.count = 0;
				this.group.add(mesh);
				return [b, mesh];
			})
		);
	}

	/**
	 * A stand-in for the warm-up (warmup.ts `Gallery`): the highlight is hidden until hovered, so a
	 * compile never sees it, and on WebGPU its first draw would make a pipeline (its blending and
	 * depth state) mid-game. The pool needs none: it is always there, drawing nothing.
	 */
	gallery(): THREE.Object3D[] {
		// Never culled, far below the table.
		this.stands ??= [standIn(new THREE.Mesh(this.box, this.highlight.material))];
		return this.stands;
	}

	/** Shows these previews: only instance matrices and counts change (#247). */
	set(items: readonly PreviewItem[], grid: SquareGrid | null, ground: Ground | null): void {
		const placed = grid ? previewPlacements(items, grid, ground) : null;
		for (const [b, mesh] of this.pool) {
			const list = (placed?.[b] ?? []).slice(0, PREVIEW_CAPACITY);
			list.forEach((p, i) => {
				this.turn.setFromAxisAngle(this.up, p.ry);
				this.at.set(p.x, p.y, p.z);
				this.matrix.compose(this.at, this.turn, this.scale.set(p.sx, p.sy, p.sz));
				mesh.setMatrixAt(i, this.matrix);
			});
			if (list.length) mesh.instanceMatrix.needsUpdate = true;
			mesh.count = list.length;
		}
	}

	setHighlight(
		cell: GridPos | null,
		kind: HighlightKind,
		grid: SquareGrid | null,
		ground: Ground | null
	): void {
		const { highlight } = this;
		if (cell && grid) {
			const w = gridToWorld(grid, cell);
			highlight.position.set(w.x, (ground?.floorY(cell) ?? 0) + 0.04, w.z);
			highlight.scale.setScalar(grid.cellSize);
			highlight.material.color.setHex(HIGHLIGHT[kind]);
		}
		highlight.visible = !!(cell && grid);
	}

	dispose(): void {
		for (const mesh of this.pool.values()) mesh.dispose(); // their instance buffers
		this.group.clear();
		for (const g of [this.box, this.corner, this.beaconColumn, this.beaconRing]) g.dispose();
		Object.values(this.materials).forEach((m) => m.dispose());
		this.highlight.geometry.dispose();
		this.highlight.material.dispose();
	}
}
