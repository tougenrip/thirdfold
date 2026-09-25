// Fixture tables for rendering tests and look metrics (milestone 61): small
// compositions that recreate the reference shots in docs/LOOK.md, and stress
// tables for the perf gates. Each is an ordinary scene file built with the
// same helpers as the adventures' tables, with readable, stable ids, and a
// sidecar of named camera poses in grid terms (src/lib/tabletop/poses.ts).
// Everything here is deterministic: building twice gives the same bytes.

import type { FloorId } from '../../src/lib/game/floor';
import type { GridPos, SquareGrid } from '../../src/lib/game/grid';
import type { Ambient, Light } from '../../src/lib/game/lights';
import type { SceneObject } from '../../src/lib/game/objects';
import type { Prop } from '../../src/lib/game/props';
import type { SavedToken, SceneFile } from '../../src/lib/game/scene-file';
import { door, light, prop, table, wall, type TableParts } from '../adventure/tables';

/** Every fixture is saved at this moment, so its bytes never change. */
export const FIXTURE_DATE = new Date('2026-01-01T00:00:00.000Z');

/** A camera pose in grid terms; the same shape as `GridPose` in src/lib/tabletop/poses.ts. */
export interface GridPose {
	target: GridPos;
	/** Cells from the target. */
	distance: number;
	/** Degrees round the target: 0 looks north from the south. */
	azimuth: number;
	/** Degrees above the horizontal. */
	elevation: number;
}

type Floors = { from: GridPos; to: GridPos; floor: FloorId }[];

export interface FixtureSidecar {
	/** The ambient band the fixture is shown in by default. */
	ambient: Ambient;
	/** The token the fogged player owns in the per-viewer views. */
	player: { tokenId: string };
	/** Cells the player's token walks through before the views are taken (explored ground). */
	explore?: GridPos[];
	poses: {
		overview: GridPose;
		close: GridPose;
		low: GridPose;
		dark: GridPose & { ambient: 'dark' };
	};
}

export interface Fixture {
	scene: SceneFile;
	sidecar: FixtureSidecar;
}

const CHARACTERS = ['warden', 'saint', 'ember', 'veil'];
const NPCS = ['villager', 'smith', 'elder', 'monk', 'priest', 'watchman', 'child', 'gravedigger'];
const ENEMIES = ['hound', 'robed-figure', 'hatted-shade', 'armored-brute'];
const COLORS = ['#c0392b', '#2e86c1', '#27ae60', '#d4ac0d', '#8e44ad', '#e67e22'];

export function mini(
	id: string,
	name: string,
	x: number,
	y: number,
	model: string,
	i = 0
): SavedToken {
	return {
		id,
		name,
		color: COLORS[i % COLORS.length],
		pos: { x, y },
		owner: null,
		vision: 8,
		light: 0,
		model
	};
}

/** A deterministic 0..1 value for a cell and a salt. */
function hash(x: number, y: number, salt: number): number {
	let h = (x * 374761393 + y * 668265263 + salt * 2147483647) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The four walls of a room over cells from..to (inclusive), with optional door edges cut in. */
function room(
	id: string,
	from: GridPos,
	to: GridPos,
	doors: { a: GridPos; b: GridPos }[] = []
): SceneObject[] {
	const [x0, y0, x1, y1] = [from.x, from.y, to.x + 1, to.y + 1];
	const sides: [string, GridPos, GridPos][] = [
		['n', { x: x0, y: y0 }, { x: x1, y: y0 }],
		['s', { x: x0, y: y1 }, { x: x1, y: y1 }],
		['w', { x: x0, y: y0 }, { x: x0, y: y1 }],
		['e', { x: x1, y: y0 }, { x: x1, y: y1 }]
	];
	const out: SceneObject[] = [];
	for (const [side, a, b] of sides) {
		// Split a side around any door on it, one wall per remaining run.
		const along = a.x === b.x ? 'y' : 'x';
		const fixed = along === 'x' ? 'y' : 'x';
		const cuts = doors
			.filter((d) => d.a[fixed] === a[fixed] && d.b[fixed] === a[fixed])
			.map((d) => [Math.min(d.a[along], d.b[along]), Math.max(d.a[along], d.b[along])])
			.sort((p, q) => p[0] - q[0]);
		let start = a[along];
		let n = 0;
		for (const [c0, c1] of [...cuts, [b[along], b[along]]]) {
			if (c0 > start) {
				const p = { ...a, [along]: start } as GridPos;
				const q = { ...a, [along]: c0 } as GridPos;
				out.push(wall(`${id}-wall-${side}${n++ || ''}`, p, q));
			}
			start = Math.max(start, c1);
		}
	}
	doors.forEach((d, i) => out.push(door(`${id}-door${i || ''}`, d.a, d.b)));
	return out;
}

function sidecar(
	grid: SquareGrid,
	ambient: Ambient,
	tokenId: string,
	focus: GridPos,
	explore?: GridPos[]
): FixtureSidecar {
	const centre = { x: Math.floor(grid.width / 2), y: Math.floor(grid.height / 2) };
	const close = { target: focus, distance: 7, azimuth: 35, elevation: 38 };
	return {
		ambient,
		player: { tokenId },
		...(explore ? { explore } : {}),
		poses: {
			overview: {
				target: centre,
				distance: Math.max(grid.width, grid.height) * 1.1,
				azimuth: 20,
				elevation: 55
			},
			close,
			low: { target: focus, distance: 6, azimuth: 30, elevation: 14 },
			dark: { ...close, ambient: 'dark' }
		}
	};
}

function build(parts: Omit<TableParts, 'arrival'>, side: FixtureSidecar): Fixture {
	const g = parts.grid;
	return {
		scene: table(
			{ ...parts, arrival: { from: { x: 0, y: 0 }, to: { x: g.width - 1, y: g.height - 1 } } },
			FIXTURE_DATE
		),
		sidecar: side
	};
}

const grid = (width: number, height: number): SquareGrid => ({
	kind: 'square',
	cellSize: 1,
	width,
	height
});

/** Ref 1: a torch-lit stone room with a few minis, crates and a barrel. */
function ref1(): Fixture {
	const g = grid(6, 6);
	return build(
		{
			name: 'Fixture: torch room',
			grid: g,
			environment: 'stone-halls',
			ambient: 'dark',
			objects: room('ref1', { x: 1, y: 1 }, { x: 4, y: 4 }),
			props: [
				prop('ref1-sconce', 'sconce', 1, 1),
				prop('ref1-crate-a', 'crate', 4, 1),
				prop('ref1-crate-b', 'crate', 4, 2),
				prop('ref1-barrel', 'barrel', 1, 4)
			],
			lights: [light('ref1-torch', 1, 1, 4, '#ff9a3c')],
			tokens: [
				mini('ref1-mini-hero', 'Warden', 2, 3, 'warden', 1),
				mini('ref1-mini-a', 'Goblin', 3, 2, 'hatted-shade', 0),
				mini('ref1-mini-b', 'Goblin', 2, 2, 'hound', 0)
			],
			floors: [{ from: { x: 1, y: 1 }, to: { x: 4, y: 4 }, floor: 'stone' }]
		},
		sidecar(g, 'dark', 'ref1-mini-hero', { x: 2, y: 2 })
	);
}

/** Ref 3: a red-lit ruined floor with a chasm, cracks, two fires and foes. */
function ref3(): Fixture {
	const g = grid(12, 10);
	const chasm: GridPos[] = [];
	for (let y = 0; y < g.height; y++)
		for (const d of [7, 8]) if (d - y >= 0 && d - y < g.width) chasm.push({ x: d - y + 3, y });
	return build(
		{
			name: 'Fixture: red ruined floor',
			grid: g,
			environment: 'stone-halls',
			ambient: 'dark',
			objects: [],
			props: [
				prop('ref3-crack-a', 'crack', 3, 6),
				prop('ref3-crack-b', 'crack', 5, 7),
				prop('ref3-rubble-a', 'rubble', 2, 2),
				prop('ref3-rubble-b', 'rubble', 8, 8),
				prop('ref3-fire-a', 'ashes', 4, 4),
				prop('ref3-fire-b', 'ashes', 9, 6)
			],
			lights: [
				light('ref3-fire-a-light', 4, 4, 3, '#ff3b1f'),
				light('ref3-fire-b-light', 9, 6, 3, '#ff3b1f')
			],
			tokens: [
				mini('ref3-mini-hero', 'Warden', 2, 7, 'warden', 1),
				mini('ref3-foe-a', 'Brute', 5, 4, 'armored-brute', 0),
				mini('ref3-foe-b', 'Cultist', 3, 3, 'robed-figure', 0),
				mini('ref3-foe-c', 'Shade', 10, 7, 'hatted-shade', 0),
				mini('ref3-foe-d', 'Hound', 8, 5, 'hound', 0)
			],
			floors: [
				{ from: { x: 0, y: 0 }, to: { x: 11, y: 9 }, floor: 'stone' },
				...chasm.map((c) => ({ from: c, to: c, floor: 'void' as const }))
			]
		},
		sidecar(g, 'dark', 'ref3-mini-hero', { x: 4, y: 5 })
	);
}

/** Ref 6: a palisade gate at night, braziers on the cobbles, a brute in the gateway. */
function ref6(): Fixture {
	const g = grid(12, 10);
	return build(
		{
			name: 'Fixture: night gate',
			grid: g,
			environment: 'village',
			ambient: 'dark',
			objects: [
				wall('ref6-wall-w', { x: 0, y: 4 }, { x: 5, y: 4 }),
				wall('ref6-wall-e', { x: 7, y: 4 }, { x: 12, y: 4 }),
				door('ref6-gate-w', { x: 5, y: 4 }, { x: 6, y: 4 }),
				door('ref6-gate-e', { x: 6, y: 4 }, { x: 7, y: 4 })
			],
			props: [prop('ref6-brazier-w', 'brazier', 4, 5), prop('ref6-brazier-e', 'brazier', 7, 5)],
			lights: [
				light('ref6-brazier-w-light', 4, 5, 4, '#ff8a30'),
				light('ref6-brazier-e-light', 7, 5, 4, '#ff8a30')
			],
			tokens: [
				mini('ref6-mini-hero', 'Warden', 5, 7, 'warden', 1),
				mini('ref6-brute', 'Brute', 6, 3, 'armored-brute', 0)
			],
			floors: [
				{ from: { x: 0, y: 0 }, to: { x: 11, y: 3 }, floor: 'grass' },
				{ from: { x: 0, y: 4 }, to: { x: 11, y: 9 }, floor: 'stone' }
			]
		},
		sidecar(g, 'dark', 'ref6-mini-hero', { x: 5, y: 5 })
	);
}

/** Ref 7: twenty minis in loose ranks on grass, at noon. */
function ref7(): Fixture {
	const g = grid(12, 8);
	const models = [...CHARACTERS, ...NPCS, ...ENEMIES];
	const tokens: SavedToken[] = [];
	for (let i = 0; i < 20; i++) {
		const [x, y] = [3 + (i % 5) + (Math.floor(i / 5) % 2), 2 + Math.floor(i / 5)];
		tokens.push(
			mini(
				`ref7-mini-${String(i + 1).padStart(2, '0')}`,
				`Mini ${i + 1}`,
				x,
				y,
				models[i % models.length],
				i
			)
		);
	}
	return build(
		{
			name: 'Fixture: minis on grass',
			grid: g,
			environment: 'village',
			ambient: 'day',
			objects: [],
			props: [],
			lights: [],
			tokens,
			floors: [{ from: { x: 0, y: 0 }, to: { x: 11, y: 7 }, floor: 'grass' }]
		},
		sidecar(g, 'day', 'ref7-mini-01', { x: 5, y: 3 })
	);
}

/** Ref 8: a walled town block at dusk: eight houses, stone streets, yards, trees and lanterns. */
function ref8(): Fixture {
	const g = grid(32, 32);
	const objects: SceneObject[] = room('ref8-town', { x: 1, y: 1 }, { x: 30, y: 30 }, [
		{ a: { x: 15, y: 31 }, b: { x: 16, y: 31 } },
		{ a: { x: 16, y: 31 }, b: { x: 17, y: 31 } }
	]);
	const floors: Floors = [
		{ from: { x: 0, y: 0 }, to: { x: 31, y: 31 }, floor: 'grass' },
		{ from: { x: 15, y: 1 }, to: { x: 16, y: 30 }, floor: 'stone' },
		{ from: { x: 1, y: 15 }, to: { x: 30, y: 16 }, floor: 'stone' }
	];
	const props: Prop[] = [];
	const lights: Light[] = [];
	const houses: { from: GridPos; to: GridPos }[] = [];
	let n = 0;
	for (const [qx, qy] of [
		[3, 3],
		[9, 3],
		[19, 3],
		[25, 3],
		[3, 19],
		[9, 19],
		[19, 19],
		[25, 19]
	]) {
		const id = `ref8-house-${++n}`;
		// Houses north of the street face south onto it, those south of it face north.
		const north = qy < 15;
		const from = { x: qx, y: north ? qy + 1 : qy };
		const to = { x: qx + 4, y: north ? qy + 4 : qy + 3 };
		const doorY = north ? to.y + 1 : from.y;
		objects.push(
			...room(id, from, to, [{ a: { x: qx + 2, y: doorY }, b: { x: qx + 3, y: doorY } }])
		);
		houses.push({ from, to });
		floors.push({ from, to, floor: 'wood' });
		// A dirt yard between the house and the street.
		floors.push({
			from: { x: qx - 1, y: north ? qy + 6 : qy - 3 },
			to: { x: qx + 5, y: north ? qy + 8 : qy - 1 },
			floor: 'dirt'
		});
	}
	for (let i = 0; i < 12; i++) {
		const x = 2 + Math.floor(hash(i, 8, 1) * 28);
		const y = 2 + Math.floor(hash(i, 8, 2) * 28);
		if (x === 15 || x === 16 || y === 15 || y === 16) continue;
		if (
			houses.some(
				(h) => x >= h.from.x - 1 && x <= h.to.x + 1 && y >= h.from.y - 1 && y <= h.to.y + 1
			)
		)
			continue;
		props.push(prop(`ref8-tree-${i + 1}`, 'tree', x, y));
	}
	for (const [i, [x, y]] of [
		[14, 6],
		[17, 12],
		[14, 20],
		[17, 26],
		[6, 14],
		[24, 17]
	].entries()) {
		lights.push(light(`ref8-lantern-${i + 1}`, x, y, 4, '#ffa04d'));
	}
	return build(
		{
			name: 'Fixture: walled town block',
			grid: g,
			environment: 'village',
			ambient: 'dusk',
			objects,
			props,
			lights,
			tokens: [
				mini('ref8-mini-hero', 'Warden', 15, 28, 'warden', 1),
				mini('ref8-mini-b', 'Smith', 16, 22, 'smith', 3)
			],
			floors
		},
		sidecar(g, 'dusk', 'ref8-mini-hero', { x: 15, y: 24 }, [
			{ x: 15, y: 24 },
			{ x: 15, y: 18 },
			{ x: 15, y: 16 }
		])
	);
}

/** Stress: rooms and corridors lit by 40 torches, in the dark. */
function dungeon40(): Fixture {
	const g = grid(40, 30);
	const objects: SceneObject[] = [];
	const props: Prop[] = [];
	const lights: Light[] = [];
	let torch = 0;
	for (let ry = 0; ry < 4; ry++) {
		for (let rx = 0; rx < 5; rx++) {
			const x0 = 1 + rx * 8;
			const y0 = 1 + ry * 7;
			const id = `dungeon-room-${rx}-${ry}`;
			objects.push(
				...room(id, { x: x0, y: y0 }, { x: x0 + 5, y: y0 + 4 }, [
					{ a: { x: x0 + 6, y: y0 + 2 }, b: { x: x0 + 6, y: y0 + 3 } },
					{ a: { x: x0 + 2, y: y0 + 5 }, b: { x: x0 + 3, y: y0 + 5 } }
				])
			);
			for (const [tx, ty] of [
				[x0, y0],
				[x0 + 5, y0 + 4]
			]) {
				const tid = `dungeon-torch-${String(++torch).padStart(2, '0')}`;
				props.push(prop(tid, 'sconce', tx, ty));
				lights.push(light(`${tid}-light`, tx, ty, 4, '#ff9a3c'));
			}
		}
	}
	return build(
		{
			name: 'Fixture: dungeon of 40 torches',
			grid: g,
			environment: 'stone-halls',
			ambient: 'dark',
			objects,
			props,
			lights,
			tokens: [mini('dungeon-mini-hero', 'Warden', 3, 3, 'warden', 1)],
			floors: [{ from: { x: 0, y: 0 }, to: { x: 39, y: 29 }, floor: 'stone' }]
		},
		sidecar(g, 'dark', 'dungeon-mini-hero', { x: 3, y: 3 })
	);
}

/** Stress: 64 by 64 cells outdoors: grass, dirt paths, a pond and trees. */
function outdoor64(): Fixture {
	const g = grid(64, 64);
	const props: Prop[] = [];
	let n = 0;
	for (let y = 1; y < 63; y += 3) {
		for (let x = 1; x < 63; x += 3) {
			const inPond = (x - 44) ** 2 + (y - 20) ** 2 < 64;
			const onPath = Math.abs(x - 32) < 2 || Math.abs(y - 40) < 2;
			if (inPond || onPath || hash(x, y, 7) > 0.35) continue;
			props.push(prop(`outdoor-tree-${String(++n).padStart(3, '0')}`, 'tree', x, y));
		}
	}
	const pond: Floors = [];
	for (let y = 12; y <= 28; y++) {
		const half = Math.floor(Math.sqrt(Math.max(0, 64 - (y - 20) ** 2)));
		if (half > 0) pond.push({ from: { x: 44 - half, y }, to: { x: 44 + half, y }, floor: 'water' });
	}
	return build(
		{
			name: 'Fixture: outdoors, 64 by 64',
			grid: g,
			environment: 'village',
			ambient: 'day',
			objects: [],
			props,
			lights: [],
			tokens: [mini('outdoor-mini-hero', 'Warden', 32, 44, 'warden', 1)],
			floors: [
				{ from: { x: 0, y: 0 }, to: { x: 63, y: 63 }, floor: 'grass' },
				{ from: { x: 31, y: 0 }, to: { x: 33, y: 63 }, floor: 'dirt' },
				{ from: { x: 0, y: 39 }, to: { x: 63, y: 41 }, floor: 'dirt' },
				...pond
			]
		},
		sidecar(g, 'day', 'outdoor-mini-hero', { x: 32, y: 40 })
	);
}

/** Stress: a crowd of 60 minis. */
function crowd60(): Fixture {
	const g = grid(16, 16);
	const models = [...CHARACTERS, ...NPCS, ...ENEMIES];
	const tokens: SavedToken[] = [];
	for (let i = 0; i < 60; i++) {
		tokens.push(
			mini(
				`crowd-mini-${String(i + 1).padStart(2, '0')}`,
				`Mini ${i + 1}`,
				3 + (i % 10),
				3 + Math.floor(i / 10),
				models[i % models.length],
				i
			)
		);
	}
	return build(
		{
			name: 'Fixture: crowd of 60',
			grid: g,
			environment: 'village',
			ambient: 'day',
			objects: [],
			props: [],
			lights: [],
			tokens,
			floors: [{ from: { x: 0, y: 0 }, to: { x: 15, y: 15 }, floor: 'grass' }]
		},
		sidecar(g, 'day', 'crowd-mini-01', { x: 7, y: 5 })
	);
}

/** The compositions and stress tables, by fixture name. */
export function compositions(): Record<string, Fixture> {
	return {
		'ref-1': ref1(),
		'ref-3': ref3(),
		'ref-6': ref6(),
		'ref-7': ref7(),
		'ref-8': ref8(),
		'dungeon-40': dungeon40(),
		'outdoor-64': outdoor64(),
		'crowd-60': crowd60()
	};
}

/** A sidecar for a frozen adventure table. */
export function adventureSidecar(
	grid: SquareGrid,
	ambient: Ambient,
	tokenId: string,
	focus: GridPos
): FixtureSidecar {
	return sidecar(grid, ambient, tokenId, focus);
}
