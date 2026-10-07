// The stone-halls pilot kit's pieces (#263): every role the greybox kit fills but the roofs and the
// plank and terracotta floors, modelled from chamfered primitives on the trim sheet's regions
// (trim.ts). Coursed walls are built from the sheet's own course layout, so each block's face
// shows the block painted for it. Each piece sits at its role's pivot inside its envelope
// (src/lib/assets/kit.ts); build.ts refuses one that doesn't. Ids describe looks.

import { pointed, rubble, type Part as GreyPart } from '../kits/parts';
import type { Part, Piece, V3 } from './build';
import { COURSES, JOINT, blocksIn, rng, type RegionId } from './trim';

const r3 = (v: number[]) => v.map((n) => Math.round(n * 10000) / 10000 || 0) as V3;
const box = (size: number[], at: number[], region: RegionId, more: Partial<Part> = {}): Part => ({
	shape: 'box',
	size: r3(size),
	at: r3(at),
	region,
	...more
});
const cyl = (size: number[], at: number[], region: RegionId, more: Partial<Part> = {}): Part => ({
	...box(size, at, region, more),
	shape: 'cylinder'
});
const cone = (size: number[], at: number[], region: RegionId, more: Partial<Part> = {}): Part => ({
	...box(size, at, region, more),
	shape: 'cone'
});
/** The greybox kit's shapes (scripts/kits/parts.ts) on a region; its second colour a shade darker. */
const regioned = (parts: GreyPart[], region: RegionId, dark = 'b'): Part[] =>
	parts.map((p) => ({
		shape: p.shape,
		size: p.size,
		at: p.at,
		...(p.turn ? { turn: p.turn } : {}),
		region,
		...(p.material === dark ? { tone: 0.82 } : {})
	}));

/** The highest a piece reaches toward a walkable side: kit.ts's 0.07, less a margin for quantising. */
const T = 0.066;

interface Courses {
	/** Where the piece's x = -0.5 falls on the 4 u strip. */
	u: number;
	/** Added to y to find the course (2 below the floor). */
	ys?: number;
	y0: number;
	y1: number;
	z0: number;
	z1: number;
	/** Spans of x left open (a niche, a window). */
	gaps?: [number, number][];
	x0?: number;
	x1?: number;
	seed: number;
}

/**
 * Blocks in the sheet's courses between y0 and y1 (piece y), each its painted block's length less a
 * joint, between z0 and z1 with a little play in depth. Slivers under 0.08 u join their neighbour.
 */
function courses(o: Courses): Part[] {
	const { u, ys = 0, x0 = -0.5, x1 = 0.5 } = o;
	const rand = rng(o.seed);
	const out: Part[] = [];
	let base = 0;
	for (let c = 0; c < COURSES.length; c++) {
		const lo = Math.max(base - ys, o.y0);
		const hi = Math.min(base + COURSES[c] - ys, o.y1);
		base += COURSES[c];
		if (hi - lo < 0.04) continue;
		// The course's blocks in piece x, cut by the gaps, slivers merged into the block beside.
		let spans = blocksIn(c, u + x0 + 0.5, u + x1 + 0.5).map(([a, b]) => [a - u - 0.5, b - u - 0.5]);
		for (const [ga, gb] of o.gaps ?? [])
			spans = spans.flatMap(([a, b]) =>
				[
					[a, Math.min(b, ga)],
					[Math.max(a, gb), b]
				].filter(([p, q]) => q - p > 1e-6)
			);
		const merged: number[][] = [];
		for (const s of spans) {
			const last = merged.at(-1);
			const touching = last && Math.abs(last[1] - s[0]) < 1e-6;
			if (touching && (s[1] - s[0] < 0.08 || last[1] - last[0] < 0.08)) last[1] = s[1];
			else merged.push([...s]);
		}
		for (const [a, b] of merged) {
			if (b - a < 0.03) continue;
			const shrink = rand() * 0.008;
			const d = o.z1 - o.z0 - shrink;
			out.push(
				box(
					[b - a - JOINT, hi - lo - JOINT, d],
					[(a + b) / 2, (lo + hi) / 2, (o.z0 + o.z1) / 2],
					'ashlar',
					{
						u,
						ys
					}
				)
			);
		}
	}
	return out;
}

/** What shows through the joints: the wall's core, dark. */
const core = (u: number, y0: number, y1: number, z0: number, z1: number, ys = 0) =>
	box([0.99, y1 - y0 - 0.01, z1 - z0], [0, (y0 + y1) / 2, (z0 + z1) / 2], 'ashlar', {
		u,
		ys,
		tone: 0.45
	});

// ---------------------------------------------------------------- walls

function wall(id: string, u: number, seed: number, weight?: number): Piece {
	return {
		id,
		role: 'wall.straight',
		parts: [core(u, 0, 2, -0.05, 0.05), ...courses({ u, y0: 0, y1: 2, z0: -T, z1: T, seed })],
		...(weight ? { weight } : {})
	};
}

/** A block split by a crack: the two halves lean apart a hair. */
function cracked(): Piece {
	const w = wall('ashlar-wall-cracked', 1, 52, 0.5);
	const at = w.parts.findIndex((p) => p.at[1] > 1.04 && p.at[1] < 1.36 && Math.abs(p.at[0]) < 0.25);
	if (at < 0) throw new Error('no block to crack');
	const b = w.parts[at];
	const [sx, sy, sz] = b.size;
	const halves = [-1, 1].map((side) =>
		box(
			[sx / 2 - 0.012, sy - 0.006, sz],
			[b.at[0] + (side * sx) / 4, b.at[1] - (side + 1) * 0.004, b.at[2]],
			'ashlar',
			{
				u: b.u,
				turn: [0, 0, side * 0.02]
			}
		)
	);
	w.parts.splice(at, 1, ...halves);
	return w;
}

/** A shallow niche cut into the wall's face, under a dressed head stone. */
function niche(): Piece {
	const u = 3;
	return {
		id: 'ashlar-wall-niche',
		role: 'wall.straight',
		weight: 0.3,
		parts: [
			core(u, 0, 2, -0.05, 0.05),
			...courses({ u, y0: 0, y1: 0.72, z0: -T, z1: T, seed: 53 }),
			...courses({ u, y0: 0.72, y1: 1.36, z0: -T, z1: T, gaps: [[-0.2, 0.2]], seed: 54 }),
			...courses({ u, y0: 1.36, y1: 1.68, z0: -T, z1: T, gaps: [[-0.25, 0.25]], seed: 55 }),
			...courses({ u, y0: 1.68, y1: 2, z0: -T, z1: T, seed: 56 }),
			box([0.486, 0.306, 0.132], [0, 1.52, 0], 'dressed'),
			box([0.39, 0.63, 0.05], [0, 1.04, -0.038], 'ashlar', { u, tone: 0.7 }),
			box([0.39, 0.03, 0.09], [0, 0.735, 0.016], 'dressed')
		]
	};
}

function outer(): Piece {
	const u = 0.5;
	return {
		id: 'ashlar-wall-outer',
		role: 'wall.outer',
		parts: [
			core(u, 0, 2, -0.05, 0.2),
			box([1, 0.4 - JOINT, 0.39], [0, 0.2, 0.13], 'ashlar', { u }),
			...courses({ u, y0: 0.4, y1: 2, z0: -T, z1: 0.23, seed: 61 }),
			// The footing's weathered top, sloping from the face down to its edge.
			box([1, 0.04, 0.13], [0, 0.42, 0.27], 'dressed', { turn: [0.5, 0, 0] })
		]
	};
}

function retaining(): Piece {
	const stones = rubble(-2, 0, -0.3, 0.064, ['a', 'b'], 71, 6);
	return {
		id: 'ashlar-retaining',
		role: 'wall.retaining',
		parts: [
			box([1, 1.99, 0.28], [0, -1, -0.19], 'rubble', { tone: 0.45 }),
			...regioned(stones, 'rubble'),
			box([1, 0.06, 0.13], [0, -0.03, 0], 'dressed')
		]
	};
}

function curtain(): Piece {
	const u = 2.5;
	return {
		id: 'ashlar-curtain',
		role: 'wall.boundary',
		parts: [
			core(u, 0, 1.68, -0.05, 0.28),
			...courses({ u, y0: 0, y1: 1.68, z0: -T, z1: 0.3, seed: 81 }),
			box([1, 0.08, 0.405], [0, 1.72, 0.137], 'dressed'),
			...[-1, 1].map((x) => box([0.34, 0.22, 0.24], [x * 0.27, 1.87, 0.205], 'ashlar', { u })),
			...[-1, 1].map((x) => box([0.36, 0.03, 0.26], [x * 0.27, 1.983, 0.205], 'dressed'))
		]
	};
}

// ---------------------------------------------------------------- tops and feet

const coping = (): Piece => ({
	id: 'ashlar-coping',
	role: 'cap',
	parts: [
		box([0.62, 0.07, 0.196], [-0.19, 1.962, 0], 'dressed'),
		box([0.38, 0.07, 0.196], [0.31, 1.962, 0], 'dressed'),
		box([1, 0.05, 0.16], [0, 1.905, 0], 'dressed', { tone: 0.85 })
	]
});

const battlement = (): Piece => ({
	id: 'ashlar-battlement',
	role: 'cap.battlement',
	parts: [
		...[-0.36, 0, 0.36].map((x) =>
			box([0.1, 0.12, 0.24], [x, 1.52, 0.2], 'dressed', { tone: 0.8 })
		),
		box([1, 0.06, 0.43], [0, 1.61, 0.12], 'dressed'),
		box([1, 0.22, 0.13], [0, 1.75, 0.27], 'ashlar', { u: 1.5 }),
		...[-1, 1].map((x) => box([0.34, 0.12, 0.13], [x * 0.3, 1.92, 0.27], 'ashlar', { u: 1.5 })),
		...[-1, 1].map((x) => box([0.36, 0.02, 0.15], [x * 0.3, 1.99, 0.27], 'dressed'))
	]
});

const crenels = (): Piece => ({
	id: 'ashlar-crenels',
	role: 'crenellation',
	parts: [-1, 1].flatMap((x) => [
		box([0.36, 0.3, 0.132], [x * 0.25, 1.83, 0], 'ashlar', { u: 0.25 }),
		box([0.38, 0.03, 0.15], [x * 0.25, 1.985, 0], 'dressed')
	])
});

const plinth = (): Piece => ({
	id: 'ashlar-plinth',
	role: 'plinth',
	parts: [
		box([0.55, 0.3, 0.132], [-0.225, 0.15, 0], 'dressed'),
		box([0.44, 0.3, 0.132], [0.28, 0.15, 0], 'dressed', { tone: 0.92 }),
		box([1, 0.08, 0.11], [0, 0.34, 0], 'dressed'),
		box([1, 0.02, 0.09], [0, 0.39, 0], 'dressed', { tone: 0.9 })
	]
});

// ---------------------------------------------------------------- openings

const arch = (): Piece => ({
	id: 'ashlar-arch',
	role: 'arch',
	parts: [
		...[-1, 1].flatMap((x) =>
			[0, 1, 2].map((k) =>
				box([0.15, 0.48, 0.132], [x * 0.415, 0.245 + k * 0.49, 0], 'dressed', {
					tone: k === 1 ? 0.92 : 1
				})
			)
		),
		...[-1, 1].map((x) => box([0.18, 0.07, 0.132], [x * 0.4, 1.5, 0], 'dressed')),
		...regioned(pointed(0.42, 1.6, 0.44, 0.7, 'a'), 'dressed'),
		...courses({ u: 3.5, y0: 1.75, y1: 2, z0: -T, z1: T, seed: 91 })
	]
});

function windowFrame(): Piece {
	const u = 2;
	return {
		id: 'ashlar-window',
		role: 'window.frame',
		parts: [
			...courses({ u, y0: 0, y1: 0.72, z0: -T, z1: T, seed: 101 }),
			box([0.99, 0.13, 0.132], [0, 0.785, 0], 'dressed'),
			...courses({ u, y0: 0.85, y1: 1.65, z0: -T, z1: T, gaps: [[-0.33, 0.33]], seed: 102 }),
			...courses({ u, y0: 1.65, y1: 1.77, z0: -T, z1: T, gaps: [[-0.43, 0.43]], seed: 103 }),
			box([0.86, 0.12, 0.132], [0, 1.71, 0], 'dressed'),
			...courses({ u, y0: 1.77, y1: 2, z0: -T, z1: T, seed: 104 }),
			...[-1, 1].map((x) =>
				box([0.05, 0.8, 0.132], [x * 0.325, 1.25, 0], 'dressed', { tone: 0.95 })
			),
			...regioned(pointed(0.3, 1.5, 0.4, 0.75, 'a'), 'dressed')
		]
	};
}

const windowSill = (): Piece => ({
	id: 'ashlar-window-sill',
	role: 'window.sill',
	parts: [
		box([0.84, 0.07, 0.132], [0, 0.815, 0], 'dressed'),
		core(1.25, -2, 0, -0.05, 0.05, 2),
		...courses({ u: 1.25, ys: 2, y0: -2, y1: 0, z0: -T, z1: T, seed: 111 })
	]
});

const glass = (): Piece => ({
	id: 'leaded-glass',
	role: 'window.glass',
	parts: [
		box([0.64, 0.78, 0.02], [0, 1.25, 0], 'glass'),
		...[-1, 1].map((y) => box([0.66, 0.025, 0.03], [0, 1.25 + y * 0.39, 0], 'iron')),
		...[-1, 1].map((x) => box([0.025, 0.8, 0.03], [x * 0.32, 1.25, 0], 'iron')),
		box([0.025, 0.78, 0.03], [0, 1.25, 0], 'iron'),
		box([0.64, 0.025, 0.03], [0, 1.25, 0], 'iron')
	]
});

const doorFrame = (): Piece => ({
	id: 'ashlar-door-frame',
	role: 'door.frame',
	parts: [
		...[-1, 1].flatMap((x) =>
			[0, 1, 2].map((k) =>
				box([0.1, 0.57, 0.132], [x * 0.45, 0.29 + k * 0.585, 0], 'dressed', {
					tone: k === 1 ? 0.92 : 1
				})
			)
		),
		box([0.34, 0.24, 0.132], [-0.33, 1.88, 0], 'dressed'),
		box([0.3, 0.24, 0.132], [0, 1.88, 0], 'dressed', { tone: 1.05 }),
		box([0.34, 0.24, 0.132], [0.33, 1.88, 0], 'dressed'),
		box([0.8, 0.04, 0.132], [0, 0.02, 0], 'flag')
	]
});

const doorLeaf = (): Piece => ({
	id: 'oak-door',
	role: 'door.leaf',
	parts: [
		...[-0.3, -0.1, 0.1, 0.3].map((x, i) =>
			box([0.19, 1.74, 0.06], [x, 0.87, 0], 'timber', { tone: i % 2 ? 1 : 0.88 })
		),
		...[0.4, 1.4].map((y) => box([0.76, 0.1, 0.03], [0, y, 0.045], 'timber', { tone: 0.92 })),
		...[0.4, 1.4].map((y) => box([0.5, 0.04, 0.012], [-0.12, y, 0.062], 'iron')),
		cyl([0.08, 0.036, 0.08], [0.28, 0.95, -0.048], 'iron', { turn: [Math.PI / 2, 0, 0] })
	]
});

// ---------------------------------------------------------------- stairs, rails, drops, bridges

const step = (): Piece => ({
	id: 'ashlar-step',
	role: 'stair.riser',
	parts: [
		box([0.6, 0.36, 0.29], [-0.2, -0.21, -0.09], 'dressed'),
		box([0.4, 0.36, 0.29], [0.3, -0.21, -0.09], 'dressed', { tone: 0.92 }),
		box([1, 0.06, 0.1], [0, -0.035, 0.015], 'dressed')
	]
});

const stairSide = (): Piece => ({
	id: 'ashlar-stair-side',
	role: 'stair.side',
	parts: [
		core(0.75, -0.8, 0, -0.05, 0.05, 0.8),
		...courses({ u: 0.75, ys: 0.8, y0: -0.8, y1: -0.06, z0: -T, z1: T, seed: 121 }),
		box([1, 0.06, 0.132], [0, -0.03, 0], 'dressed')
	]
});

const balustrade = (): Piece => ({
	id: 'stone-balustrade',
	role: 'railing',
	parts: [
		box([1, 0.08, 0.13], [0, 0.96, 0], 'dressed'),
		box([1, 0.08, 0.12], [0, 0.04, 0], 'dressed', { tone: 0.9 }),
		...[-0.375, -0.125, 0.125, 0.375].flatMap((x) => [
			box([0.066, 0.84, 0.066], [x, 0.5, 0], 'dressed', { turn: [0, Math.PI / 4, 0] }),
			box([0.092, 0.22, 0.092], [x, 0.42, 0], 'dressed', { turn: [0, Math.PI / 4, 0] })
		])
	]
});

const rubbleFace = (): Piece => ({
	id: 'rubble-face',
	role: 'cliff.face',
	parts: [
		box([1, 1.99, 0.26], [0, -1, -0.2], 'rubble', { tone: 0.45 }),
		...regioned(rubble(-2, 0, -0.32, 0.06, ['a', 'b'], 131, 5), 'rubble')
	]
});

const rubbleCorner = (): Piece => ({
	id: 'rubble-corner',
	role: 'cliff.corner',
	parts: [
		box([0.6, 2, 0.6], [0, -1, 0], 'rubble', { tone: 0.6 }),
		box([0.5, 0.9, 0.5], [0.04, -0.47, 0.04], 'rubble', { turn: [0, 0.4, 0] }),
		box([0.48, 0.7, 0.48], [-0.03, -1.3, 0.02], 'rubble', { turn: [0, -0.3, 0], tone: 0.85 }),
		box([0.44, 0.38, 0.44], [0.02, -1.8, -0.03], 'rubble', { turn: [0, 0.9, 0] })
	]
});

const deck = (): Piece => ({
	id: 'flag-deck',
	role: 'bridge.deck',
	parts: [
		box([0.99, 0.26, 0.99], [0, -0.17, 0], 'dressed', { tone: 0.8 }),
		...[-1, 1].map((x) => box([0.47, 0.04, 0.74], [x * 0.245, -0.022, 0], 'flag')),
		...[-1, 1].map((z) => box([1, 0.08, 0.11], [0, -0.042, z * 0.44], 'dressed'))
	]
});

const pier = (): Piece => ({
	id: 'ashlar-pier',
	role: 'bridge.pier',
	parts: [
		...COURSES.slice(0, 5).map((h, c) => {
			const y = -2 + COURSES.slice(0, c).reduce((a, b) => a + b, 0);
			return box(
				[0.6 - (c % 2) * 0.02, h - JOINT, 0.6 - (c % 2) * 0.02],
				[0, y + h / 2, 0],
				'ashlar',
				{
					u: 0.7 * c,
					ys: 2
				}
			);
		}),
		box([0.8, 0.2, 0.8], [0, -0.3, 0], 'dressed'),
		box([0.7, 0.12, 0.7], [0, -1.94, 0], 'dressed', { tone: 0.85 })
	]
});

// ---------------------------------------------------------------- corners

/** A post's shaft: a block per course, alternately a hair proud, on the sheet's courses. */
const shaft = (u: number) =>
	COURSES.map((h, c) => {
		const y = COURSES.slice(0, c).reduce((a, b) => a + b, 0);
		const s = c % 2 ? 0.296 : 0.288;
		return box([s, h - JOINT, s], [0, y + h / 2, 0], 'ashlar', { u: u + c * 0.37 });
	});
const footing = () => box([0.37, 0.3, 0.37], [0, 0.15, 0], 'dressed');
const finial = () => cone([0.3, 0.15, 0.3], [0, 2.075, 0], 'dressed');
const head = (y = 1.94) => box([0.33, 0.12, 0.33], [0, y, 0], 'dressed');

const posts = (): Piece[] => [
	{ id: 'ashlar-post-end', role: 'post.end', parts: [...shaft(0.1), footing(), finial()] },
	{ id: 'ashlar-post-l', role: 'post.L', parts: [...shaft(0.9), footing(), head(1.95)] },
	{ id: 'ashlar-post-t', role: 'post.T', parts: [...shaft(1.7), footing(), head()] },
	{ id: 'ashlar-post-x', role: 'post.X', parts: [...shaft(2.6), footing(), head(1.9), finial()] }
];

const buttress = (): Piece => ({
	id: 'ashlar-buttress',
	role: 'buttress',
	parts: [
		...[0, 1, 2].map((c) => {
			const y = COURSES.slice(0, c).reduce((a, b) => a + b, 0);
			return box([0.2, COURSES[c] - JOINT, 0.4], [0, y + COURSES[c] / 2, 0.1], 'ashlar', {
				u: 3.1 + c * 0.3
			});
		}),
		box([0.2, 0.05, 0.42], [0, 1.1, 0.1], 'dressed', { turn: [0.6, 0, 0] }),
		box([0.2, 0.6, 0.25], [0, 1.4, 0.025], 'ashlar', { u: 3.8 }),
		box([0.2, 0.05, 0.27], [0, 1.74, 0.03], 'dressed', { turn: [0.6, 0, 0] })
	]
});

const pinnacle = (): Piece => ({
	id: 'stone-pinnacle',
	role: 'pinnacle',
	parts: [
		box([0.3, 0.25, 0.3], [0, 1.625, 0], 'dressed'),
		box([0.32, 0.04, 0.32], [0, 1.77, 0], 'dressed', { tone: 0.9 }),
		cone([0.26, 0.36, 0.26], [0, 1.97, 0], 'dressed')
	]
});

const turret = (): Piece => {
	const drums: [number, number][] = [
		[0, 0.4],
		[0.4, 1.04],
		[1.04, 1.68],
		[1.68, 1.9]
	];
	return {
		id: 'ashlar-turret',
		role: 'tower.corner',
		parts: [
			...drums.map(([a, b], i) =>
				cyl(
					[0.86 - (i % 2) * 0.01, b - a - JOINT, 0.86 - (i % 2) * 0.01],
					[0.47, (a + b) / 2, 0.47],
					'ashlar',
					{
						u: 1.3 * i
					}
				)
			),
			cyl([0.92, 0.12, 0.92], [0.47, 0.06, 0.47], 'dressed'),
			cyl([0.9, 0.06, 0.9], [0.47, 1.7, 0.47], 'dressed'),
			cyl([0.94, 0.1, 0.94], [0.47, 1.95, 0.47], 'dressed')
		]
	};
};

// ---------------------------------------------------------------- floor flags

/** A cell's flags: slabs whose tops sit at y = 0, a grout gap between; broken ones sink and tilt. */
function flags(id: string, cells: number[][], seed: number, broken: number[] = []): Piece {
	const rand = rng(seed);
	return {
		id,
		role: broken.length ? 'floor.broken' : 'floor.tiles',
		parts: cells.map(([x0, z0, x1, z1], i) => {
			const down = broken.includes(i);
			const sink = down ? 0.05 + rand() * 0.04 : rand() * 0.006;
			const tilt = down ? (rand() - 0.5) * 0.12 : 0;
			const [w, l] = [x1 - x0 - 0.03, z1 - z0 - 0.03];
			const lift = (Math.abs(Math.sin(tilt)) * l) / 2;
			return box(
				[w, 0.1, l],
				[(x0 + x1) / 2, -0.05 - sink - lift, (z0 + z1) / 2],
				'flag',
				tilt ? { turn: [tilt, 0, 0], tone: 0.85 } : { tone: 0.9 + 0.1 * rand() }
			);
		})
	};
}
const QUADS = [
	[-0.5, -0.5, 0, 0],
	[0, -0.5, 0.5, 0],
	[-0.5, 0, 0, 0.5],
	[0, 0, 0.5, 0.5]
];
const LAYOUTS = [
	QUADS,
	[
		[-0.5, -0.5, 0.5, -0.05],
		[-0.5, -0.05, 0.15, 0.5],
		[0.15, -0.05, 0.5, 0.5]
	],
	[
		[-0.5, -0.5, 0.2, 0.2],
		[0.2, -0.5, 0.5, 0.2],
		[-0.5, 0.2, 0.5, 0.5]
	],
	[
		[-0.5, -0.5, -0.1, 0.5],
		[-0.1, -0.5, 0.5, 0.1],
		[-0.1, 0.1, 0.5, 0.5]
	]
];

const floorTiles = (): Piece[] => [
	...LAYOUTS.map((cells, i) => flags(`flagstone-${'abcd'[i]}`, cells, 141 + i)),
	// One flag gone, one sunk and tipped.
	(({ parts, ...rest }) => ({ ...rest, parts: parts.slice(0, 3) }))(
		flags('flagstone-broken-a', QUADS, 147, [0, 3])
	),
	flags('flagstone-broken-b', LAYOUTS[1], 148, [1])
];

/** Every pilot piece, by role (floor tiles as `floor.tiles` and `floor.broken`). */
export function pilotPieces(): Piece[] {
	return [
		wall('ashlar-wall-a', 0, 51),
		wall('ashlar-wall-b', 2, 57),
		cracked(),
		niche(),
		outer(),
		retaining(),
		curtain(),
		coping(),
		battlement(),
		crenels(),
		plinth(),
		arch(),
		windowFrame(),
		windowSill(),
		glass(),
		doorFrame(),
		doorLeaf(),
		step(),
		stairSide(),
		balustrade(),
		rubbleFace(),
		rubbleCorner(),
		deck(),
		pier(),
		...posts(),
		buttress(),
		pinnacle(),
		turret(),
		...floorTiles()
	];
}
