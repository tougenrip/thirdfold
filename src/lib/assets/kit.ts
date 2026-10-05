// Architecture kits (#250): one style's pieces by role, which the world's
// builders (#251, #252) map edges, corners and cells to. Plain data, built from
// assets/kits/<id>.json into the manifest's `kits`, named by environments.
//
// A piece is a manifest model of kind `kit` whose origin is its role's pivot:
// - an edge piece's at the unit edge's midpoint, on the higher floor beside it,
//   1 u long along x, its exterior face +z (toward the void, the table's edge or
//   the lower side), the interior -z;
// - a corner piece's at the grid corner, on the highest floor round it;
// - a cell piece's at the cell's centre, on its floor.
// Every piece's bounds (every vertex, through the node transforms) must lie in
// its role's envelope (ENVELOPES), so no piece reaches into a walkable cell's
// base disk below FIGURE_CLEAR. Checked by the pipeline and by parseManifest,
// with `parseKit`. Pure, relative imports only: the pipeline, the manifest's
// parser and world/shape.ts share it.

import type { FloorId } from '../game/floor';
import type { MaterialDef, ModelEntry } from './manifest';

// ponytail: copies of ground.ts's STEP_HEIGHT and WALL_HEIGHT, terrain.ts's MAX_LEVEL and
// floor.ts's ids, so the manifest's parser pulls no game rules into every page; kits.spec.ts
// fails when one drifts (a floor appended by #254 must be added here too).
export const STEP_HEIGHT = 0.4;
export const WALL_HEIGHT = 2;
const MAX_LEVEL = 40;
export const KIT_FLOOR_IDS: readonly FloorId[] = [
	'plain',
	'stone',
	'wood',
	'grass',
	'dirt',
	'sand',
	'water',
	'cobble',
	'flagstone',
	'rock',
	'mud',
	'snow',
	'gravel'
];

/** A token's footing: the radius (in cells) round a cell's centre that is flat at its floor. */
export const TOKEN_DISK = 0.43;
/** How far an edge piece may reach from the edge toward a walkable or unexplored cell. */
export const WALL_HALF_THIN = 0.07;
/** How far it may reach toward the void or off the table (prop-solid cells don't count: props move). */
export const WALL_HALF_THICK = 0.35;
/** How far a cap may overhang a wall's face, and only above FIGURE_CLEAR. */
export const CAP_OVERHANG = 0.03;
/** The height over a floor nothing but a cap's overhang may reach into a base disk below: 1.3 u figures and a margin. */
export const FIGURE_CLEAR = 1.45;
/** A corner post's side: 0.495 from the nearest cell centre. */
export const POST_SIZE = 0.3;
/** How far a post's finial may rise over WALL_HEIGHT; nothing else on an edge does. */
export const FINIAL = 0.15;

/** The deepest a piece may reach below its floor: the highest level down to 0. */
const DEPTH = MAX_LEVEL * STEP_HEIGHT;
/** The highest a roof may rise over its floor. */
const ROOF_TOP = 4 * WALL_HEIGHT;

type Span = readonly [number, number];

/** Where a role's pieces may lie, in units at a cell size of 1, about its pivot. */
export interface Envelope {
	pivot: 'edge' | 'corner' | 'cell';
	x: Span;
	y: Span;
	z: Span;
	/**
	 * A corner piece that rises over the floor below FIGURE_CLEAR keeps clear of the base disks of
	 * the four cells round the corner, or of three when it fills the +x+z quarter (the void).
	 */
	disks?: 4 | 3;
}

const T = WALL_HALF_THIN;
const K = WALL_HALF_THICK;
const O = WALL_HALF_THIN + CAP_OVERHANG;
const H = WALL_HEIGHT;
const S = STEP_HEIGHT;
const F = FIGURE_CLEAR;
const edge = (y: Span, z: Span): Envelope => ({ pivot: 'edge', x: [-0.5, 0.5], y, z });
const corner = (y: Span, disks?: 4 | 3, out = 0.5): Envelope => ({
	pivot: 'corner',
	x: [-0.5, out],
	y,
	z: [-0.5, out],
	...(disks ? { disks } : {})
});
const cell = (y: Span, reach = 0.5): Envelope => ({
	pivot: 'cell',
	x: [-reach, reach],
	y,
	z: [-reach, reach]
});

/** Every role a kit may fill, and where its pieces may lie. Closed: an unknown role is refused. */
export const ENVELOPES = {
	// Walls: a straight run between walkable cells, its outer face toward the void, the part below
	// the higher floor down a drop (-z buried in the higher ground), a boundary palisade, the top.
	'wall.straight': edge([0, H], [-T, T]),
	'wall.outer': edge([0, H], [-T, K]),
	'wall.retaining': edge([-H, 0], [-K, T]),
	'wall.boundary': edge([0, H], [-T, K]),
	cap: edge([F, H], [-O, O]),
	'cap.battlement': edge([F, H], [-O, K]),
	// Crenels are cut into the wall's top, never merlons above it, so the picture keeps the sight rule.
	crenellation: edge([F, H], [-O, K]),
	plinth: edge([0, S], [-T, T]),
	arch: edge([0, H], [-T, T]),
	// Corners.
	'post.end': corner([0, H + FINIAL], 4),
	'post.L': corner([0, H + FINIAL], 4),
	'post.T': corner([0, H + FINIAL], 4),
	'post.X': corner([0, H + FINIAL], 4),
	buttress: corner([0, H], 4),
	pinnacle: corner([F, H + FINIAL], 4),
	'tower.corner': corner([0, H + FINIAL], 3, 1),
	// Openings: a window's sill runs down to the lower floor between different floors; a door's
	// leaf is drawn shut (the renderer swings it).
	'window.frame': edge([0, H], [-T, T]),
	'window.sill': edge([-H, H], [-T, T]),
	'window.glass': edge([0, H], [-T, T]),
	'door.frame': edge([0, H], [-T, T]),
	'door.leaf': edge([0, H], [-T, T]),
	// Stairs, rails and bridges.
	'stair.riser': edge([-S, 0], [-K, T]),
	'stair.side': edge([-H, 0], [-K, T]),
	railing: edge([0, H], [-T, T]),
	'bridge.deck': cell([-S, 0]),
	'bridge.pier': cell([-DEPTH, 0]),
	// Roofs, over a cell and out past its walls by the eave, never below FIGURE_CLEAR.
	'roof.ridge': cell([F, ROOF_TOP], 1),
	'roof.hip': cell([F, ROOF_TOP], 1),
	'roof.eave': cell([F, ROOF_TOP], 1),
	'roof.corner': cell([F, ROOF_TOP], 1),
	'roof.chimney': cell([F, ROOF_TOP], 1),
	'roof.dormer': cell([F, ROOF_TOP], 1),
	// Cliff trim (#241), below the higher floor.
	'cliff.face': edge([-DEPTH, 0], [-K, T]),
	'cliff.corner': corner([-DEPTH, 0])
} as const satisfies Record<string, Envelope>;

export type KitRole = keyof typeof ENVELOPES;
export const KIT_ROLES = Object.keys(ENVELOPES) as KitRole[];

/** Floor pieces, at a cell's centre: tiles and broken tiles at or under the floor, the edge down a drop. */
export const FLOOR_ENVELOPES = {
	tiles: cell([-S, 0]),
	broken: cell([-S, 0]),
	edge: cell([-H, 0])
} as const satisfies Record<string, Envelope>;

/** Where an effect starts on a piece (#319's model sockets have the same shape). */
export interface KitSocket {
	kind: 'smoke' | 'flame';
	at: [number, number, number];
}

export interface KitPiece {
	/** A manifest model of kind `kit`. */
	model: string;
	/** How often it is picked among its role's variants (1 when absent). */
	weight?: number;
	sockets?: KitSocket[];
}

export interface KitFloor {
	tiles: KitPiece[];
	broken: KitPiece[];
	edge?: KitPiece;
}

export interface KitRoof {
	style: 'gable' | 'hip';
	/** Degrees. */
	pitch: number;
	/** How far it overhangs its walls, in units. */
	eave: number;
	/** A manifest material. */
	material: string;
}

export interface KitDef {
	name: string;
	roof: KitRoof | null;
	/** Roofs over walled rooms even where no roof was painted. */
	presumeRoofs: boolean;
	/** Variants per role; a role with none is drawn as a procedural box, slab or prism. */
	pieces: Partial<Record<KitRole, KitPiece[]>>;
	/** Tiles per floor (`plain` is the default ground); a floor without them is the blended ground. */
	floors: Partial<Record<FloorId, KitFloor>>;
}

/** The kit with no pieces: every role procedural. What an environment without a kit uses. */
export const PLAIN_KIT = 'plain';

export const MAX_VARIANTS = 8;

export type ParsedKit = { ok: true; kit: KitDef } | { ok: false; error: string };

class Invalid extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number): v is number =>
	typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Why `bounds` break `env`, or null: the axis, how far and the limit ("0.1 > 0.07 toward -z").
 * Bounds are the box round every vertex, so a piece that passes keeps clear of the disks along
 * its edges too.
 */
export function envelopeProblem(bounds: ModelEntry['bounds'], env: Envelope): string | null {
	const { min, max } = bounds;
	const axes = [
		['x', env.x, 0],
		['y', env.y, 1],
		['z', env.z, 2]
	] as const;
	for (const [axis, [lo, hi], k] of axes) {
		// How far it reaches from the pivot, or where it starts or ends when the envelope is off it.
		if (min[k] < lo - 1e-6)
			return lo <= 0
				? `${round(-min[k])} > ${round(-lo)} toward -${axis}`
				: `${axis} ${round(min[k])} < ${round(lo)}`;
		if (max[k] > hi + 1e-6)
			return hi >= 0
				? `${round(max[k])} > ${round(hi)} toward +${axis}`
				: `${axis} ${round(max[k])} > ${round(hi)}`;
	}
	if (env.disks && min[1] < FIGURE_CLEAR && max[1] > 0) {
		const centres = [
			[-0.5, -0.5],
			[0.5, -0.5],
			[-0.5, 0.5],
			...(env.disks === 4 ? [[0.5, 0.5]] : [])
		];
		for (const [cx, cz] of centres) {
			const dx = Math.max(min[0] - cx, 0, cx - max[0]);
			const dz = Math.max(min[2] - cz, 0, cz - max[2]);
			const d = Math.hypot(dx, dz);
			if (d < TOKEN_DISK - 1e-6) {
				return `${round(d)} < ${TOKEN_DISK} from the cell centre at ${cx},${cz}`;
			}
		}
	}
	return null;
}

function piece(
	v: unknown,
	env: Envelope,
	models: Record<string, ModelEntry>,
	what: string
): KitPiece {
	if (!isRecord(v) || typeof v.model !== 'string') throw new Invalid(`${what}: needs a model`);
	const model = models[v.model];
	if (!model) throw new Invalid(`${what}: unknown model "${v.model}"`);
	if (model.kind !== 'kit')
		throw new Invalid(`${what}: "${v.model}" is a ${model.kind}, not a kit piece`);
	const where = `${what} "${v.model}"`;
	const problem = envelopeProblem(model.bounds, env);
	if (problem) throw new Invalid(`${where}: ${problem}`);
	const p: KitPiece = { model: v.model };
	if (v.weight !== undefined) {
		if (!num(v.weight, 0.01, 100)) throw new Invalid(`${where}: bad weight`);
		p.weight = v.weight;
	}
	if (v.sockets !== undefined) {
		if (!Array.isArray(v.sockets) || v.sockets.length > 8)
			throw new Invalid(`${where}: bad sockets`);
		p.sockets = v.sockets.map((s: unknown) => {
			const at = isRecord(s) ? s.at : undefined;
			if (
				!isRecord(s) ||
				(s.kind !== 'smoke' && s.kind !== 'flame') ||
				!Array.isArray(at) ||
				at.length !== 3 ||
				!at.every((n) => num(n, -ROOF_TOP, ROOF_TOP))
			) {
				throw new Invalid(`${where}: bad socket`);
			}
			return { kind: s.kind, at: [at[0], at[1], at[2]] };
		});
	}
	return p;
}

function variants(
	v: unknown,
	env: Envelope,
	models: Record<string, ModelEntry>,
	what: string,
	min = 1
): KitPiece[] {
	if (!Array.isArray(v) || v.length < min || v.length > MAX_VARIANTS) {
		throw new Invalid(`${what}: ${min} to ${MAX_VARIANTS} pieces`);
	}
	return v.map((p) => piece(p, env, models, what));
}

/** A kit as written in assets/kits/<id>.json or sent in the manifest, checked against its models. */
export function parseKit(
	raw: unknown,
	models: Record<string, ModelEntry>,
	materials: Record<string, MaterialDef>
): ParsedKit {
	try {
		if (!isRecord(raw)) throw new Invalid('not an object');
		if (typeof raw.name !== 'string' || !raw.name || raw.name.length > 60) {
			throw new Invalid('bad name');
		}
		let roof: KitRoof | null = null;
		if (raw.roof !== null && raw.roof !== undefined) {
			const r = raw.roof;
			if (
				!isRecord(r) ||
				(r.style !== 'gable' && r.style !== 'hip') ||
				!num(r.pitch, 15, 60) ||
				!num(r.eave, 0, 0.5) ||
				typeof r.material !== 'string' ||
				!Object.hasOwn(materials, r.material)
			) {
				throw new Invalid('bad roof');
			}
			roof = { style: r.style, pitch: r.pitch, eave: r.eave, material: r.material };
		}
		if (typeof (raw.presumeRoofs ?? false) !== 'boolean') throw new Invalid('bad presumeRoofs');
		const pieces: KitDef['pieces'] = {};
		if (!isRecord(raw.pieces ?? {})) throw new Invalid('bad pieces');
		for (const [role, list] of Object.entries((raw.pieces ?? {}) as Record<string, unknown>)) {
			if (!Object.hasOwn(ENVELOPES, role)) throw new Invalid(`unknown role "${role}"`);
			const r = role as KitRole;
			pieces[r] = variants(list, ENVELOPES[r], models, r);
		}
		const floors: KitDef['floors'] = {};
		if (!isRecord(raw.floors ?? {})) throw new Invalid('bad floors');
		for (const [id, f] of Object.entries((raw.floors ?? {}) as Record<string, unknown>)) {
			const floor = KIT_FLOOR_IDS.find((x) => x === id);
			if (!floor || !isRecord(f)) throw new Invalid(`unknown floor "${id}"`);
			const what = `floor ${id}`;
			floors[floor] = {
				tiles: variants(f.tiles, FLOOR_ENVELOPES.tiles, models, `${what} tiles`),
				broken: variants(f.broken ?? [], FLOOR_ENVELOPES.broken, models, `${what} broken`, 0),
				...(f.edge !== undefined
					? { edge: piece(f.edge, FLOOR_ENVELOPES.edge, models, `${what} edge`) }
					: {})
			};
		}
		return {
			ok: true,
			kit: { name: raw.name, roof, presumeRoofs: raw.presumeRoofs === true, pieces, floors }
		};
	} catch (err) {
		if (err instanceof Invalid) return { ok: false, error: err.message };
		throw err;
	}
}
