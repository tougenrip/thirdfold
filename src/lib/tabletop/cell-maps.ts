// The shared cell maps (#171): the one-texel-per-cell data every material reads through
// `worldModify` (materials/world-modify.ts), in grid row order (texel row y is grid row y, no
// flip: `TextureNode.setupUV` flips only render targets and flipped bitmaps on WebGL2, so data
// rows read the same on both backends). Two textures, since only 16 sampled textures a stage are
// guaranteed:
//
// - `visibility`, RGBA8, linear, no mipmaps: R visible and G explored (the viewer's fog), B the
//   rules' light level, A sky visibility (255 open, 0 in a dark area; #219 adds roofs).
// - `ground`, RG8, nearest: R the floor (`FLOOR_IDS` index), G the level. The terrain kind reads
//   it for floor colours and height (#172, materials/hooks.ts `groundColour`).
//
// Each channel is written only by its own update, and only when its input changed. The textures
// are replaced when the grid's size changes, the nodes that read them keep their graph: the
// values and the uniforms below are all that vary, so nothing here ever compiles a program.
// Everything is built from what the viewer was sent; there is no wire change.

import * as THREE from 'three/webgpu';
import {
	clamp,
	float,
	floor,
	ivec2,
	normalWorldGeometry,
	positionWorld,
	texture,
	textureLoad,
	uniform
} from 'three/tsl';
import type { SquareGrid } from '$lib/game/grid';
import type { Ambient } from '$lib/game/lights';
import { decodeMask, type FogView } from '$lib/game/visibility';
import type { FogMode } from './fog';

/** Night's darkness, which a dark area has at any hour (lighting.ts, `PRESETS.dark.dark`). */
export const NIGHT_DARK = 0.82;
/** How dark each ambient leaves an unlit cell (lighting.ts's presets). */
export const AMBIENT_DARK: Record<Ambient, number> = { day: 0, dusk: 0.35, dark: NIGHT_DARK };
/** The light a player's visible cells have at least, so a cell the rules show is never black. */
export const PERCEPTION_FILL = 0.55;
/** How much the flash thins the dark at its height (the old overlay's `1 - 0.85k`). */
export const FLASH_THINS = 0.85;
/** Where the cut sits when nothing is cut: high, but finite (WGSL may assume no infinities). */
export const NO_CUT = 1e6;

/**
 * How much of a surface each fog state lets through: today's overlay alphas (fog.ts) as
 * `1 - alpha / 255`, so floors keep their look. A player's hidden cells are exactly 0.
 */
export const FOG_LEVELS: Record<FogMode, { visible: 1; explored: number; hidden: number }> = {
	player: { visible: 1, explored: 1 - 173 / 255, hidden: 0 },
	gm: { visible: 1, explored: 1 - 69 / 255, hidden: 1 - 128 / 255 }
};

/**
 * The texel a world point falls in, as the shader finds it (`cellUV x size`, floored), as an
 * index in grid row order; -1 outside the grid, where `worldModify` is neutral.
 */
export function texelAt(grid: SquareGrid, x: number, z: number): number {
	const u = (x / grid.cellSize + grid.width / 2) / grid.width;
	const v = (z / grid.cellSize + grid.height / 2) / grid.height;
	if (u < 0 || u >= 1 || v < 0 || v >= 1) return -1;
	return Math.floor(v * grid.height) * grid.width + Math.floor(u * grid.width);
}

const byte = (k: number) => Math.round(255 * Math.min(1, Math.max(0, k)));

/** Writes the fog into R (visible) and G (explored); without fog both are 255. */
export function packFog(
	data: Uint8Array,
	visible: ArrayLike<number> | null,
	explored: ArrayLike<number> | null
) {
	for (let i = 0, o = 0; o < data.length; i++, o += 4) {
		data[o] = !visible || visible[i] ? 255 : 0;
		data[o + 1] = !explored || explored[i] ? 255 : 0;
	}
}

/** Writes the rules' light level (0-1) into B; without levels (by day) everything is lit. */
export function packLight(data: Uint8Array, levels: ArrayLike<number> | null) {
	for (let i = 0, o = 2; o < data.length; i++, o += 4) data[o] = levels ? byte(levels[i]) : 255;
}

/** Writes sky visibility into A: 0 in a dark area, 255 under the open sky. */
export function packSky(data: Uint8Array, dark: ArrayLike<number> | null) {
	for (let i = 0, o = 3; o < data.length; i++, o += 4) data[o] = dark?.[i] ? 0 : 255;
}

/** Writes the ground: R the floor's index, G the level. */
export function packGround(
	data: Uint8Array,
	floorIds: ArrayLike<number> | null,
	levels: ArrayLike<number> | null
) {
	for (let i = 0, o = 0; o < data.length; i++, o += 2) {
		data[o] = floorIds?.[i] ?? 0;
		data[o + 1] = levels?.[i] ?? 0;
	}
}

/** What `worldModify` darkens a cell to, the mirror of its graph (1 lit, 0 black). */
export function cellBrightness(c: {
	ambientDark: number;
	/** 0-1, as packed. */
	level: number;
	/** 1 under the open sky, 0 in a dark area. */
	sky: number;
	/** The perception fill if the cell is visible to a fogged player, else 0. */
	fill: number;
	flash: number;
}): number {
	const level = Math.max(c.level, c.fill);
	const deep = Math.max(c.ambientDark, NIGHT_DARK);
	const shade = deep + (c.ambientDark - deep) * c.sky;
	const b = 1 - shade * (1 - level);
	return b + (1 - b) * FLASH_THINS * c.flash;
}

/** How much of a surface the fog lets through for a cell, the mirror of the graph. */
export function fogFactor(fogOn: boolean, mode: FogMode, visible: boolean, explored: boolean) {
	if (!fogOn) return 1;
	const levels = FOG_LEVELS[mode];
	return visible ? levels.visible : explored ? levels.explored : levels.hidden;
}

/** A data texture of the cell maps' kind: linear data, no mipmaps, rows as given. */
function dataTexture(
	width: number,
	height: number,
	format: THREE.PixelFormat,
	filter: typeof THREE.LinearFilter | typeof THREE.NearestFilter,
	fill: number
): THREE.DataTexture {
	const channels = format === THREE.RGFormat ? 2 : 4;
	const data = new Uint8Array(width * height * channels).fill(fill);
	const t = new THREE.DataTexture(data, width, height, format, THREE.UnsignedByteType);
	t.magFilter = filter;
	t.minFilter = filter;
	t.generateMipmaps = false;
	t.needsUpdate = true;
	return t;
}

const visibilityTexture = (w: number, h: number) =>
	dataTexture(w, h, THREE.RGBAFormat, THREE.LinearFilter, 255);
const groundTexture = (w: number, h: number) =>
	dataTexture(w, h, THREE.RGFormat, THREE.NearestFilter, 0);

/**
 * The uniforms `worldModify` reads. Module-wide, like `worldTime`: one tabletop draws at a time,
 * and its `CellMaps` sets them. Their starting values are neutral (`on` 0: the identity).
 */
export const cellUniforms = {
	gridSize: uniform(new THREE.Vector2(1, 1)),
	cellSize: uniform(1),
	/** The #171 switch until #173: 0 keeps `worldModify` the identity (the tier's `fogshade`). */
	on: uniform(0),
	fogOn: uniform(0),
	/** 0 player (and spectator), 1 GM. */
	fogMode: uniform(0),
	ambientDark: uniform(0),
	nightDark: uniform(NIGHT_DARK),
	perceptionFill: uniform(PERCEPTION_FILL),
	exploredLevel: uniform(FOG_LEVELS.player.explored),
	/** How far explored cells lose their colour, and the cool cast they take. */
	exploredDesaturate: uniform(0.5),
	exploredTint: uniform(new THREE.Color(0.86, 0.93, 1)),
	gmExploredLevel: uniform(FOG_LEVELS.gm.explored),
	gmHiddenLevel: uniform(FOG_LEVELS.gm.hidden),
	/** The GM's light tint where the party can't see. */
	gmTint: uniform(new THREE.Color(0.9, 0.94, 1)),
	flash: uniform(0),
	/** Fragments above this world height are cut (#72's cutaway). */
	cutY: uniform(NO_CUT),
	/** The highest level on the table (at least 1), which the terrain kind pales toward (#172). */
	maxLevel: uniform(1)
};

const u = cellUniforms;
/** Where a world point lies on the grid, 0-1 across it (rows in grid order). */
const uvOf = (p: typeof positionWorld) =>
	p.xz.div(u.cellSize).add(u.gridSize.mul(0.5)).div(u.gridSize);
/** Where a fragment lies on the grid, 0-1 across it (rows in grid order). */
export const cellUV = uvOf(positionWorld);
const size = ivec2(u.gridSize);
/** The texel of the cell a grid position (0-1) falls in, clamped to the grid. */
// Loosely typed: @types/three has clamp for floats only.
const cellAt = (at: typeof cellUV) =>
	(clamp as unknown as (...args: unknown[]) => typeof size)(
		ivec2(floor(at.mul(u.gridSize))),
		ivec2(0, 0),
		size.sub(1)
	);
const cell = cellAt(cellUV);
/** Whether the fragment is over the grid: 1 or 0. Outside, `worldModify` is neutral. */
export const onGrid = float(cellUV.x.greaterThanEqual(0))
	.mul(float(cellUV.y.greaterThanEqual(0)))
	.mul(float(cellUV.x.lessThan(1)))
	.mul(float(cellUV.y.lessThan(1)));

// The blanks the nodes hold before a grid comes and after a tabletop goes: neutral (visible,
// explored, lit, open sky; plain, level ground). Never disposed.
const BLANK_VISIBILITY = visibilityTexture(1, 1);
const BLANK_GROUND = groundTexture(1, 1);
/** The fragment's cell's `visibility` texel, exact (R and G are 0 or 1). */
export const visibilityTexel = textureLoad(BLANK_VISIBILITY, cell);
/** The `visibility` map sampled linearly: B and A fall off smoothly between cells. */
export const visibilitySmooth = texture(BLANK_VISIBILITY, cellUV);
/**
 * The `ground` texel of the cell a fragment belongs to: R the floor's index / 255, G the level /
 * 255. Looked up a hundredth of a cell inside the surface, so a raised cell's sides (which lie on
 * the line between two cells) read their own cell, not the neighbour's.
 */
export const groundTexel = textureLoad(
	BLANK_GROUND,
	cellAt(uvOf(positionWorld.sub(normalWorldGeometry.mul(u.cellSize.mul(0.01)))))
);

type Channel = 'fog' | 'light' | 'sky' | 'ground';

/** The renderer's side: feeds the maps and the uniforms from the layers' state. */
export class CellMaps {
	private visibility: THREE.DataTexture | null = null;
	private ground: THREE.DataTexture | null = null;
	private grid: SquareGrid | null = null;
	/** Each channel's inputs when it was last written, compared by identity. */
	private last = new Map<Channel, unknown[]>();

	/** Sizes the maps for a grid; a new size replaces the textures, and every channel follows. */
	setGrid(grid: SquareGrid): void {
		u.cellSize.value = grid.cellSize;
		const same = this.grid?.width === grid.width && this.grid.height === grid.height;
		this.grid = { ...grid };
		if (same) return;
		u.gridSize.value.set(grid.width, grid.height);
		this.release();
		this.visibility = visibilityTexture(grid.width, grid.height);
		this.ground = groundTexture(grid.width, grid.height);
		visibilityTexel.value = visibilitySmooth.value = this.visibility;
		groundTexel.value = this.ground;
		this.last.clear();
	}

	/**
	 * Everything the renderer works out light from, at once (renderer.ts `relight`): each channel
	 * is rewritten only if its own input changed.
	 */
	update(
		grid: SquareGrid,
		{ fog, mode }: { fog: FogView | null; mode: FogMode },
		ambient: Ambient,
		light: Float32Array | null,
		dark: Uint8Array | null,
		floorIds: Uint8Array | null,
		levels: Uint8Array | null
	): void {
		this.setGrid(grid);
		this.setFog(fog, mode);
		this.setLight(ambient, light, dark);
		this.setGround(floorIds, levels);
	}

	/** The switch (#171 until #173): off keeps `worldModify` the identity. */
	setOn(on: boolean): void {
		u.on.value = on ? 1 : 0;
	}

	/** R and G from the viewer's fog, and the fog's uniforms. */
	setFog(fog: FogView | null, mode: FogMode): void {
		u.fogOn.value = fog?.enabled ? 1 : 0;
		u.fogMode.value = mode === 'gm' ? 1 : 0;
		const on = fog?.enabled ? fog : null;
		const t = this.visibility;
		if (!this.grid || !t || !this.changed('fog', on?.visible, on?.explored)) return;
		const size = this.grid.width * this.grid.height;
		const mask = (encoded: string | undefined) => (encoded ? decodeMask(encoded, size) : null);
		packFog(t.image.data as Uint8Array, mask(on?.visible), mask(on?.explored));
		t.needsUpdate = true;
	}

	/** B from the rules' light levels (null: all lit), A from the dark areas, and the ambient. */
	setLight(ambient: Ambient, levels: Float32Array | null, dark: Uint8Array | null): void {
		u.ambientDark.value = AMBIENT_DARK[ambient];
		const t = this.visibility;
		if (!t) return;
		if (this.changed('light', levels)) {
			packLight(t.image.data as Uint8Array, levels);
			t.needsUpdate = true;
		}
		if (this.changed('sky', dark)) {
			packSky(t.image.data as Uint8Array, dark);
			t.needsUpdate = true;
		}
	}

	/** The ground map from the floor and the levels, and the highest level. */
	setGround(floorIds: Uint8Array | null, levels: Uint8Array | null): void {
		const t = this.ground;
		if (!t || !this.grid || !this.changed('ground', floorIds, levels)) return;
		// A map of another size (the last table's, until its own arrives) paints nothing.
		const n = this.grid.width * this.grid.height;
		const fit = (a: Uint8Array | null) => (a?.length === n ? a : null);
		packGround(t.image.data as Uint8Array, fit(floorIds), fit(levels));
		u.maxLevel.value = Math.max(1, ...(fit(levels) ?? []));
		t.needsUpdate = true;
	}

	/** The flash (0 none, 1 full): the dark thins as the old overlay did. */
	setFlash(k: number): void {
		u.flash.value = k;
	}

	/** Cuts away everything above world height `y`; null cuts nothing. */
	setCut(y: number | null): void {
		u.cutY.value = y ?? NO_CUT;
	}

	/** Gives the nodes their blanks back and frees the maps. */
	dispose(): void {
		this.release();
		this.grid = null;
		u.gridSize.value.set(1, 1); // the blanks' size, so a lone material reads them in bounds
		u.on.value = u.fogOn.value = u.flash.value = 0;
		u.cutY.value = NO_CUT;
	}

	private release(): void {
		visibilityTexel.value = visibilitySmooth.value = BLANK_VISIBILITY;
		groundTexel.value = BLANK_GROUND;
		this.visibility?.dispose();
		this.ground?.dispose();
		this.visibility = this.ground = null;
	}

	/** Whether a channel's inputs differ from the ones last written; notes them if so. */
	private changed(channel: Channel, ...inputs: unknown[]): boolean {
		const last = this.last.get(channel);
		if (last && inputs.every((v, i) => v === last[i])) return false;
		this.last.set(channel, inputs);
		return true;
	}
}
