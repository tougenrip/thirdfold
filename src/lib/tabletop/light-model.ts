// The light model's pure parts (M68): where lights are drawn and, as later tasks add them, how
// they flicker, which cast shadows and how the sun's shadow is fitted. No three.js, so the server
// test project checks it; the rules' falloff itself lives in $lib/game/lights.ts. Keep it in
// sections, one per task.

import { gridToWorld, type GridPos, type SquareGrid, type WorldPos } from '../game/grid';
import { lightLook, type LightKind, type LightLook, type LightSource } from '../game/lights';
import { edgeKey } from '../game/objects';
import { STEP_HEIGHT, WALL_HEIGHT, type Ground } from './ground';

// ---------------------------------------------------------------------------------------------
// Mounting (#226): a light's visual position. Its rule origin (the cell centre) never moves:
// reach, occlusion and which cells it lights come from there.

/** How far a wall-mounted light stands off its wall, in cells. */
export const MOUNT_OFFSET = 0.15;
/** A wall-mounted light's height, as a share of WALL_HEIGHT. */
export const MOUNT_HEIGHT = 0.7;

/** The kinds that hang on a wall when their cell has one. */
const WALL_KINDS = new Set(['torch', 'lantern']);

/** A cell's four edges in the fixed order a mount tries them: north, east, south, west. */
const SIDES = [
	{ edge: (c: GridPos) => ({ a: c, b: { x: c.x + 1, y: c.y } }), dx: 0, dz: -1 },
	{
		edge: (c: GridPos) => ({ a: { x: c.x + 1, y: c.y }, b: { x: c.x + 1, y: c.y + 1 } }),
		dx: 1,
		dz: 0
	},
	{
		edge: (c: GridPos) => ({ a: { x: c.x, y: c.y + 1 }, b: { x: c.x + 1, y: c.y + 1 } }),
		dx: 0,
		dz: 1
	},
	{ edge: (c: GridPos) => ({ a: c, b: { x: c.x, y: c.y + 1 } }), dx: -1, dz: 0 }
] as const;

/** The wall a light hangs on: a torch's or lantern's first walled edge in SIDES' order, if any. */
function wallSide(light: Pick<LightSource, 'pos' | 'kind'>, walled: ReadonlySet<string>) {
	if (!WALL_KINDS.has(lightLook(light).kind)) return undefined;
	return SIDES.find((s) => walled.has(edgeKey(s.edge(light.pos))));
}

/** Whether a light hangs on a wall (as `lightMount` puts it) or stands on its floor. */
export type Mount = 'wall' | 'floor';

/** How `lightMount` mounts a light, for `fixtureFor`. */
export const mountOf = (
	light: Pick<LightSource, 'pos' | 'kind'>,
	walled: ReadonlySet<string>
): Mount => (wallSide(light, walled) ? 'wall' : 'floor');

/**
 * Where a light is drawn, in world units. A torch or lantern (no kind counts as a torch) whose
 * cell has a walled edge (`walled`: edge keys, `edgeKey`) sits MOUNT_OFFSET off the first one in
 * SIDES' order, at MOUNT_HEIGHT of a wall, so its light rakes across the wall's normals; any other
 * light stands at its cell centre at its look's height (levels above the floor).
 */
export function lightMount(
	grid: SquareGrid,
	light: Pick<LightSource, 'pos' | 'kind' | 'height'>,
	walled: ReadonlySet<string>,
	ground: Ground | null
): WorldPos {
	const centre = gridToWorld(grid, light.pos);
	const floor = ground?.floorY(light.pos) ?? 0;
	const look = lightLook(light);
	const side = wallSide(light, walled);
	if (side) {
		const off = (0.5 - MOUNT_OFFSET) * grid.cellSize;
		return {
			x: centre.x + side.dx * off,
			y: floor + MOUNT_HEIGHT * WALL_HEIGHT * grid.cellSize,
			z: centre.z + side.dz * off
		};
	}
	return { x: centre.x, y: floor + look.height * STEP_HEIGHT * grid.cellSize, z: centre.z };
}

// ---------------------------------------------------------------------------------------------
// Fixtures (#232): the model a light is drawn with. Part lists in assets/models/prop (each glow a
// `flame` mesh, white, for the light's colour to tint), replaceable by cooked or commissioned art
// under the same ids. A wall fixture hangs on its cell's north wall with its flame where
// `lightMount` puts it (turned a quarter per side, SIDES' order); a floor one stands at the cell
// centre with its flame at its kind's default height. Ids describe looks, never story roles.

/** Each kind's fixture on a wall and on the floor; null draws none (a glow is light alone). */
export const FIXTURES: Readonly<Record<LightKind, Readonly<Record<Mount, string | null>>>> = {
	torch: { wall: 'wall-sconce', floor: 'standing-torch' },
	candle: { wall: 'candle-cluster', floor: 'candle-cluster' },
	brazier: { wall: 'brazier', floor: 'brazier' },
	lantern: { wall: 'wall-lantern', floor: 'post-lantern' },
	glow: { wall: null, floor: null },
	magic: { wall: 'glow-crystal', floor: 'glow-crystal' },
	fire: { wall: 'ground-flame', floor: 'ground-flame' },
	neon: { wall: 'neon-bar', floor: 'neon-bar' },
	panel: { wall: 'light-panel', floor: 'light-panel' }
};

/**
 * The fixture model a light is drawn with, or null: none when its look says `fixture: false` (a
 * prop on its cell is the fixture, or it is a glow). Only torches and lanterns hang on walls
 * (`mountOf`); every other kind stands on its floor whatever `mount` says.
 */
export function fixtureFor(light: Partial<LightLook>, mount: Mount): string | null {
	const look = lightLook(light);
	return look.fixture ? FIXTURES[look.kind][mount] : null;
}

// ---------------------------------------------------------------------------------------------
// The sun and moon's shadow box (#229)
// ---------------------------------------------------------------------------------------------

type V3 = readonly [number, number, number];

/** The world box that casts and takes the key light's shadow: the grid up to its top. */
export interface ShadowBounds {
	min: V3;
	max: V3;
}

/** The shadow camera's orthographic box, in the light's own space (three's camera fields). */
export interface ShadowFrustum {
	left: number;
	right: number;
	top: number;
	bottom: number;
	near: number;
	far: number;
}

/** The box's size steps by this share of a cell, so a light turning a little keeps its texels. */
const SIZE_STEP = 0.5;
/** Texels of room round the box, so the soft filter's taps at its edge stay on the map. */
const EDGE_TEXELS = 4;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const unit = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return [a[0] / l, a[1] / l, a[2] / l];
};

/** The light camera's axes as three's `Matrix4.lookAt` makes them (up +y), so the box matches. */
export function lightBasis(eye: V3, target: V3): { x: V3; y: V3; z: V3 } {
	let z = sub(eye, target);
	if (dot(z, z) === 0) z = [0, 0, 1];
	z = unit(z);
	const up: V3 = [0, 1, 0];
	let x = cross(up, z);
	if (dot(x, x) === 0) {
		z = unit([z[0], z[1], z[2] + 0.0001]);
		x = cross(up, z);
	}
	x = unit(x);
	return { x, y: cross(z, x), z };
}

/**
 * The key light's shadow box for `bounds`, seen from `eye` toward `target` (the light stands off
 * the play area's centre): the bounds' corners in light space, with the edge's room, sized in
 * steps of half a cell and centred on a whole texel of a `mapSize` map, so a light that turns a
 * little or not at all keeps the same texels (no shimmer). Reaches toward the light by the box's
 * height again, for anything taller than it. Fitted to the grid, never the camera or the world
 * past it, whose ground reads as unshadowed.
 */
export function fitShadowFrustum(
	bounds: ShadowBounds,
	eye: V3,
	target: V3,
	mapSize: number,
	cellSize = 1
): ShadowFrustum {
	const { x, y, z } = lightBasis(eye, target);
	const lo = [Infinity, Infinity, Infinity];
	const hi = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < 8; i++) {
		const p: V3 = [
			i & 1 ? bounds.max[0] : bounds.min[0],
			i & 2 ? bounds.max[1] : bounds.min[1],
			i & 4 ? bounds.max[2] : bounds.min[2]
		];
		const d = sub(p, eye);
		// Distance in front of the light: the camera looks down its -z.
		const c = [dot(d, x), dot(d, y), -dot(d, z)];
		for (let k = 0; k < 3; k++) {
			lo[k] = Math.min(lo[k], c[k]);
			hi[k] = Math.max(hi[k], c[k]);
		}
	}
	const step = SIZE_STEP * cellSize;
	const side = (a: number, b: number) => {
		const half = (b - a) / 2;
		const room = ((2 * half) / mapSize) * EDGE_TEXELS;
		return Math.ceil((half + room) / step) * step;
	};
	const [hx, hy] = [side(lo[0], hi[0]), side(lo[1], hi[1])];
	const snap = (v: number, texel: number) => Math.round(v / texel) * texel;
	const cx = snap((lo[0] + hi[0]) / 2, (2 * hx) / mapSize);
	const cy = snap((lo[1] + hi[1]) / 2, (2 * hy) / mapSize);
	const height = bounds.max[1] - bounds.min[1];
	return {
		left: cx - hx,
		right: cx + hx,
		bottom: cy - hy,
		top: cy + hy,
		near: Math.max(0.01, lo[2] - height),
		far: hi[2] + step
	};
}
