// The greybox kits' styles (#261), one per built-in environment, and the pieces every kit has.
// scripts/make-kits.ts writes them. Colours follow docs/ART.md's surface ramps; a name that isn't
// `#rrggbb` is a manifest material (assets/materials.json), whose colour is baked in.

import {
	box,
	cone,
	cyl,
	courses,
	opening,
	rng,
	rubble,
	slabs,
	slope,
	terraces,
	type Part
} from './parts';

export interface Piece {
	id: string;
	parts: Part[];
	weight?: number;
	sockets?: { kind: 'smoke' | 'flame'; at: [number, number, number] }[];
}

export interface Kit {
	pieces: Record<string, Piece[]>;
	floors: Record<string, { tiles: Piece[]; broken: Piece[] }>;
}

export interface Style {
	id: string;
	name: string;
	/** The kit's file, when it isn't the style's id (stone halls: the pilot's fallback, #263). */
	kit?: string;
	/** The wall's face, its darker stone or board, frames and timbers, footings and copings. */
	wall: string;
	dark: string;
	trim: string;
	base: string;
	door: string;
	iron: string;
	glass: string;
	/** Pointed window and arch heads (stone halls). */
	gothic?: boolean;
	roof?: { style: 'gable' | 'hip'; pitch: number; eave: number; material: string };
	/**
	 * Roofs presumed over rooms a player knows the walls of (#257), and a building context from the
	 * first frame: kits of the open air only (not stone halls, whose dungeons have no roofs).
	 */
	presumeRoofs?: boolean;
	/** The roof's ridge and the chimney's stone. */
	ridge?: string;
	walls: (s: Style) => Piece[];
	boundary: (s: Style) => Part[];
	deck: (s: Style) => Part[];
	floors?: (s: Style) => Kit['floors'];
	more?: (s: Style) => Record<string, Piece[]>;
}

const one = (id: string, parts: Part[], extra: Partial<Piece> = {}): Piece[] => [
	{ id, parts, ...extra }
];

// ---- Shared pieces, in the style's colours. ----

function posts(s: Style): Record<string, Piece[]> {
	const finial = s.gothic
		? [cone([0.3, 0.15, 0.3], [0, 2.075, 0], s.base)]
		: [box([0.34, 0.08, 0.34], [0, 2.04, 0], s.trim)];
	const footing = box([0.38, 0.3, 0.38], [0, 0.15, 0], s.base);
	return {
		'post.end': one('post-end', [box([0.3, 2, 0.3], [0, 1, 0], s.trim), footing, ...finial]),
		'post.L': one('post-l', [box([0.3, 2, 0.3], [0, 1, 0], s.trim), footing]),
		'post.T': one('post-t', [
			box([0.3, 2, 0.3], [0, 1, 0], s.trim),
			footing,
			box([0.36, 0.12, 0.36], [0, 1.94, 0], s.base)
		]),
		'post.X': one('post-x', [
			box([0.3, 2, 0.3], [0, 1, 0], s.trim),
			footing,
			box([0.36, 0.12, 0.36], [0, 1.94, 0], s.base),
			...finial
		])
	};
}

function edges(s: Style): Record<string, Piece[]> {
	const seed = s.id.length * 97;
	return {
		'wall.straight': s.walls(s),
		'wall.outer': one('wall-outer', [
			box([1, 2, 0.4], [0, 1, 0.14], s.wall),
			box([1, 0.45, 0.42], [0, 0.225, 0.14], s.base),
			box([1, 0.08, 0.42], [0, 1.2, 0.14], s.dark)
		]),
		'wall.retaining': one('wall-retaining', [
			...courses(-2, 0, 4, 0.3, s.base, seed + 1).map((p) => ({
				...p,
				at: [p.at[0], p.at[1], -0.12] as [number, number, number]
			})),
			box([1, 2, 0.26], [0, -1, -0.14], s.dark)
		]),
		'wall.boundary': one('wall-boundary', s.boundary(s)),
		cap: one('cap', [box([1, 0.12, 0.2], [0, 1.94, 0], s.base)]),
		plinth: one('plinth', [
			box([1, 0.32, 0.14], [0, 0.16, 0], s.base),
			box([1, 0.06, 0.13], [0, 0.35, 0], s.dark)
		]),
		'window.frame': one('window-frame', opening(s, 0.85, 1.65, 0.33)),
		'window.sill': one('window-sill', [
			box([0.8, 0.06, 0.14], [0, 0.82, 0], s.base),
			box([1, 2, 0.12], [0, -1, 0], s.wall)
		]),
		'window.glass': one('window-glass', [
			box([0.66, 0.8, 0.02], [0, 1.25, 0], s.glass),
			box([0.03, 0.8, 0.04], [0, 1.25, 0], s.iron),
			box([0.66, 0.03, 0.04], [0, 1.25, 0], s.iron)
		]),
		'door.frame': one('door-frame', [
			box([0.1, 2, 0.14], [-0.45, 1, 0], s.trim),
			box([0.1, 2, 0.14], [0.45, 1, 0], s.trim),
			box([1, 0.24, 0.14], [0, 1.88, 0], s.trim),
			box([0.8, 0.04, 0.14], [0, 0.02, 0], s.base)
		]),
		'door.leaf': one('door-leaf', [
			...[-0.3, -0.1, 0.1, 0.3].map((x, i) =>
				box([0.19, 1.74, 0.06], [x, 0.87, 0], i % 2 ? s.door : s.dark)
			),
			box([0.76, 0.1, 0.03], [0, 0.4, 0.045], s.door),
			box([0.76, 0.1, 0.03], [0, 1.4, 0.045], s.door),
			box([0.5, 0.04, 0.02], [-0.12, 0.4, 0.06], s.iron),
			box([0.5, 0.04, 0.02], [-0.12, 1.4, 0.06], s.iron),
			cyl([0.08, 0.04, 0.08], [0.28, 0.95, -0.05], s.iron, [Math.PI / 2, 0, 0])
		]),
		'stair.riser': one('stair-riser', [
			box([1, 0.38, 0.3], [0, -0.2, -0.08], s.base),
			box([1, 0.06, 0.1], [0, -0.03, 0.02], s.dark)
		]),
		'stair.side': one('stair-side', [
			box([1, 0.8, 0.14], [0, -0.4, 0], s.base),
			box([1, 0.06, 0.14], [0, -0.03, 0], s.dark)
		]),
		railing: one('railing', [
			box([1, 0.08, 0.12], [0, 0.96, 0], s.trim),
			box([1, 0.06, 0.1], [0, 0.12, 0], s.trim),
			...[-0.375, -0.125, 0.125, 0.375].map((x) => cyl([0.07, 0.8, 0.07], [x, 0.52, 0], s.trim))
		]),
		'cliff.face': one('cliff-face', rubble(-2, 0, -0.32, 0.06, [s.base, s.dark], seed + 2)),
		'cliff.corner': one('cliff-corner', [
			box([0.6, 2, 0.6], [0, -1, 0], s.dark),
			box([0.5, 1.2, 0.5], [0.05, -0.65, 0.05], s.base, [0, 0.4, 0])
		]),
		'bridge.deck': one('bridge-deck', s.deck(s)),
		'bridge.pier': one('bridge-pier', [
			box([0.6, 1.8, 0.6], [0, -1.1, 0], s.base),
			box([0.8, 0.2, 0.8], [0, -0.3, 0], s.dark),
			box([0.7, 0.12, 0.7], [0, -1.94, 0], s.dark)
		])
	};
}

function roofs(s: Style): Record<string, Piece[]> {
	if (!s.roof) return {};
	const e = s.roof.eave;
	const m = s.roof.material;
	const ridge = s.ridge ?? s.dark;
	const p = (s.roof.pitch * Math.PI) / 180;
	const top = 2 + 0.5 * Math.tan(p);
	const cap = box([1, 0.1, 0.16], [0, 2.02, 0], ridge);
	return {
		'roof.eave': one('roof-eave', [slope(s, -0.5, 0.5 + e, 0.5, m)]),
		'roof.ridge': one(
			'roof-ridge',
			[slope(s, 0, 0.5 + e, 0, m), slope(s, 0, -0.5 - e, 0, m), cap].map(raise(top - 2))
		),
		'roof.hip': one('roof-hip', [
			...terraces(s, m, true),
			box([0.16, 0.1, 0.16], [0, top + 0.02, 0], ridge)
		]),
		'roof.corner': one('roof-corner', terraces(s, m, false)),
		'roof.chimney': one(
			'roof-chimney',
			[box([0.3, 1.6, 0.3], [0.2, 2.6, 0], ridge), box([0.36, 0.08, 0.36], [0.2, 3.44, 0], s.dark)],
			{ sockets: [{ kind: 'smoke', at: [0.2, 3.5, 0] }] }
		),
		'roof.dormer': one('roof-dormer', [
			box([0.5, 0.5, 0.45], [0, 2.3, 0.2], s.wall),
			box([0.3, 0.26, 0.02], [0, 2.3, 0.43], s.glass),
			box([0.62, 0.06, 0.55], [-0.15, 2.66, 0.2], m, [0, 0, 0.6]),
			box([0.62, 0.06, 0.55], [0.15, 2.66, 0.2], m, [0, 0, -0.6])
		])
	};
}

/** Lifts a part by dy: the ridge and hip meet over the cell's centre, half a cell above the eave. */
const raise =
	(dy: number) =>
	(p: Part): Part => ({ ...p, at: [p.at[0], p.at[1] + dy, p.at[2]] });
export function buildKit(s: Style): Kit {
	return {
		pieces: { ...edges(s), ...posts(s), ...roofs(s), ...(s.more?.(s) ?? {}) },
		floors: s.floors?.(s) ?? {}
	};
}

// ---- Floor tiles. ----

const quads = [
	[-0.5, -0.5, 0, 0],
	[0, -0.5, 0.5, 0],
	[-0.5, 0, 0, 0.5],
	[0, 0, 0.5, 0.5]
];
const flagLayouts = [
	quads,
	[
		[-0.5, -0.5, 0.5, -0.05],
		[-0.5, -0.05, 0.15, 0.5],
		[0.15, -0.05, 0.5, 0.5]
	],
	[
		[-0.5, -0.5, 0.2, 0.2],
		[0.2, -0.5, 0.5, 0.2],
		[-0.5, 0.2, 0.5, 0.5]
	]
];

export function flagTiles(prefix: string, colors: string[]) {
	const tiles = flagLayouts.map((cells, i) => ({
		id: `${prefix}-${'abc'[i]}`,
		parts: slabs(cells, 0.1, colors, 11 + i)
	}));
	const broken = [
		{ id: `${prefix}-broken`, parts: slabs(quads, 0.1, colors, 17, true).filter((_, i) => i !== 3) }
	];
	return { tiles, broken };
}

export function plankTiles(prefix: string, colors: string[]) {
	const rows = (seed: number) => {
		const rand = rng(seed);
		const cells: number[][] = [];
		for (let i = 0; i < 4; i++) {
			const z0 = -0.5 + i * 0.25;
			const cut = rand() < 0.5 ? null : -0.3 + rand() * 0.6;
			if (cut === null) cells.push([-0.5, z0, 0.5, z0 + 0.25]);
			else cells.push([-0.5, z0, cut, z0 + 0.25], [cut, z0, 0.5, z0 + 0.25]);
		}
		return cells;
	};
	const tiles = [21, 22, 23].map((seed, i) => ({
		id: `${prefix}-${'abc'[i]}`,
		parts: slabs(rows(seed), 0.07, colors, seed)
	}));
	const broken = [
		{
			id: `${prefix}-broken`,
			parts: slabs(rows(24), 0.07, colors, 24, true).filter((_, i) => i !== 1)
		}
	];
	return { tiles, broken };
}

export function cobbleTiles(prefix: string, colors: string[]) {
	const grid = (seed: number) => {
		const rand = rng(seed);
		const cells: number[][] = [];
		for (let i = 0; i < 3; i++)
			for (let j = 0; j < 3; j++) {
				const o = (rand() - 0.5) * 0.04;
				cells.push(
					[-0.5 + j / 3 + o, -0.5 + i / 3, -0.5 + (j + 1) / 3 + o, -0.5 + (i + 1) / 3].map((v) =>
						Math.max(-0.5, Math.min(0.5, v))
					)
				);
			}
		return cells;
	};
	const tiles = [31, 32, 33].map((seed, i) => ({
		id: `${prefix}-${'abc'[i]}`,
		parts: slabs(grid(seed), 0.12, colors, seed)
	}));
	const broken = [
		{
			id: `${prefix}-broken`,
			parts: slabs(grid(34), 0.12, colors, 34, true).filter((_, i) => i !== 4)
		}
	];
	return { tiles, broken };
}

/** An iron grating (#254's `grating` floor): a frame and bars over a dark pit. */
export function gratingTile(id: string, iron: string, frame: string): Piece {
	return {
		id,
		parts: [
			box([0.97, 0.06, 0.97], [0, -0.3, 0], '#262a35'),
			...[-1, 1].map((z) => box([0.97, 0.06, 0.08], [0, -0.03, z * 0.445], frame)),
			...[-1, 1].map((x) => box([0.08, 0.06, 0.81], [x * 0.445, -0.03, 0], frame)),
			...[-0.27, -0.09, 0.09, 0.27].map((x) => box([0.04, 0.05, 0.81], [x, -0.03, 0], iron)),
			box([0.81, 0.03, 0.04], [0, -0.035, 0], iron)
		]
	};
}
