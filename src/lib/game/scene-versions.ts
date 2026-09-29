// The scene file's versions, and `migrate`, which brings any older file up
// to the current one before scene-file.ts validates it; and the check on a
// saved story, which the core only knows as bounded plain JSON.

import type { SquareGrid } from './grid';
import { AMBIENTS, parseLightList, type Ambient, type Light } from './lights';
import { normalizeName } from './protocol';
import { decodeMask, encodeMask } from './visibility';
import type { SceneObject } from './objects';
import type { Prop } from './props';
import type { Token } from './token';
import { DEFAULT_WORLD, defaultWorldFor, type WorldLook } from './world';

/**
 * v2 added lights, the ambient level and token-carried light; v3 added props;
 * v4 added the state of a story being played at the table; v5 added
 * elevation (each cell's level) and windows; v6 added shared party vision,
 * hidden tokens and props, and what each player has discovered; v7 added
 * dark areas; v8 added the table's environment (how it looks: an asset id)
 * and each token's model (an asset id, optional); v9 added floors (what each
 * cell is made of, or off the map); v10 added the world's look (the hour,
 * sky, weather, haze, grade, backdrop), roofed cells, each player's
 * remembered lights, and optional looks on lights, tokens and props.
 */
export const SCENE_FILE_VERSION = 10;

/** A token as saved. The owner is kept by id and name so it can be re-matched in another session. */
export interface SavedToken extends Omit<Token, 'ownerId'> {
	owner: { id: string; name: string } | null;
}

export interface SceneFileV3 {
	format: 'thirdfold-scene';
	version: 3;
	name: string;
	/** ISO timestamp. */
	savedAt: string;
	grid: SquareGrid;
	tokens: SavedToken[];
	objects: SceneObject[];
	props: Prop[];
	lights: Light[];
	ambient: Ambient;
	fog: { enabled: boolean; revealed: string };
}

/**
 * The state of a story (an adventure module) played at the table, saved with
 * it. The core only checks that it is plain JSON within limits; the module
 * that wrote it validates the contents when it is loaded back.
 */
export interface SavedStory {
	/** The module, e.g. 'hollow-bell'. */
	id: string;
	/** The module's own save format version. */
	version: number;
	state: Record<string, unknown>;
	/** A creator's adventure: the adventure file it was played from (checked again when loaded). */
	content?: Record<string, unknown>;
}

export interface SceneFileV4 extends Omit<SceneFileV3, 'version'> {
	version: 4;
	/** The story being played here, or null for a free table. */
	adventure: SavedStory | null;
}

export interface SceneFileV5 extends Omit<SceneFileV4, 'version'> {
	version: 5;
	/** Each cell's level, base64, one byte per cell (see terrain.ts); null for a flat table. */
	terrain: string | null;
}

export interface SceneFileV6 extends Omit<SceneFileV5, 'version' | 'fog'> {
	version: 6;
	fog: { enabled: boolean; revealed: string; shared: boolean };
	/** The cells each player has discovered, by player name (base64 masks), so it survives a reload. */
	discovery: Record<string, string>;
}

export interface SceneFileV7 extends Omit<SceneFileV6, 'version'> {
	version: 7;
	/** The dark areas, where only light lets anyone see (a base64 CellMask); null for none. */
	darkness: string | null;
}

export interface SceneFileV8 extends Omit<SceneFileV7, 'version'> {
	version: 8;
	/** How the table looks: an environment asset's id, or null for the plain table. */
	environment: string | null;
}

export interface SceneFileV9 extends Omit<SceneFileV8, 'version'> {
	version: 9;
	/** What each cell is made of (a base64 FloorMap, see floor.ts); null when nothing is painted. */
	floor: string | null;
}

/** What one player discovered: the cells, and every light they know, as they last saw it. */
export interface Discovered {
	/** A base64 CellMask. */
	explored: string;
	/** Absent: not learned yet. */
	lights?: Light[];
}

export interface SceneFileV10 extends Omit<SceneFileV9, 'version' | 'discovery'> {
	version: 10;
	/** How the world looks; `ambient` always agrees with it (see world.ts `ambientFor`). */
	world: WorldLook;
	/** Roofed cells (a base64 CellMask), or null for none. */
	interior: string | null;
	/** By player name. */
	discovery: Record<string, Discovered>;
}

/** The current format. Older versions only exist as input to `migrate`. */
export type SceneFile = SceneFileV10;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Upgrades older file versions to the current one. Each future version adds
 * one step here (v1 → v2 → …), so any old save keeps loading.
 */
export function migrate(data: Record<string, unknown>): Record<string, unknown> | string {
	const version = data.version;
	if (!Number.isInteger(version) || (version as number) < 1)
		return 'This is not a valid scene file.';
	if ((version as number) > SCENE_FILE_VERSION) {
		return 'This scene was saved by a newer version of thirdfold.';
	}
	let upgraded = data;
	if (upgraded.version === 1) {
		// v1 → v2: no lights yet, full daylight, and tokens carried no light.
		upgraded = {
			...upgraded,
			version: 2,
			lights: [],
			ambient: 'day',
			tokens: Array.isArray(upgraded.tokens)
				? upgraded.tokens.map((t) => (isRecord(t) ? { ...t, light: 0 } : t))
				: upgraded.tokens
		};
	}
	if (upgraded.version === 2) {
		// v2 → v3: no props yet.
		upgraded = { ...upgraded, version: 3, props: [] };
	}
	if (upgraded.version === 3) {
		// v3 → v4: no story saved with the table.
		upgraded = { ...upgraded, version: 4, adventure: null };
	}
	if (upgraded.version === 4) {
		// v4 → v5: a flat table, and no windows yet.
		upgraded = { ...upgraded, version: 5, terrain: null };
	}
	if (upgraded.version === 5) {
		// v6: the party's sight was always each player's own; nobody's discoveries were kept.
		const fog = isRecord(upgraded.fog) ? { ...upgraded.fog, shared: false } : upgraded.fog;
		upgraded = { ...upgraded, version: 6, fog, discovery: {} };
	}
	if (upgraded.version === 6) {
		// v6 → v7: no dark areas.
		upgraded = { ...upgraded, version: 7, darkness: null };
	}
	if (upgraded.version === 7) {
		// v7 → v8: the plain table, and plain miniatures.
		upgraded = { ...upgraded, version: 8, environment: null };
	}
	if (upgraded.version === 8) {
		// v8 → v9: nothing painted.
		upgraded = { ...upgraded, version: 9, floor: null };
	}
	if (upgraded.version === 9) {
		// v9 → v10: the default look at the band's hour, under a sun (even underground: the band
		// buttons move the hour there as anywhere); no roofs; no lights remembered yet.
		const ambient = upgraded.ambient as Ambient;
		const discovery = isRecord(upgraded.discovery)
			? Object.fromEntries(
					Object.entries(upgraded.discovery).map(([name, explored]) => [name, { explored }])
				)
			: upgraded.discovery;
		upgraded = {
			...upgraded,
			version: 10,
			world: AMBIENTS.includes(ambient) ? defaultWorldFor(ambient) : structuredClone(DEFAULT_WORLD),
			interior: null,
			discovery
		};
	}
	return upgraded;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const JSON_LIMITS = { depth: 12, nodes: 20000 };
/** An adventure file carried by a save: bigger (it holds its tables), still bounded. */
const CONTENT_LIMITS = { depth: 24, nodes: 400000 };

/** Whether a value is plain JSON data (no functions, no cycles), within depth and size limits. */
function isPlainJson(
	value: unknown,
	depth: number,
	count: { nodes: number },
	limits = JSON_LIMITS
): boolean {
	if (++count.nodes > limits.nodes || depth > limits.depth) return false;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every((v) => isPlainJson(v, depth + 1, count, limits));
	if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
	return Object.values(value).every((v) => isPlainJson(v, depth + 1, count, limits));
}

/** A saved story, copied; null for none, undefined when it is not valid. */
export function parseSavedStory(raw: unknown): SavedStory | null | undefined {
	if (raw === null) return null;
	if (
		!isRecord(raw) ||
		typeof raw.id !== 'string' ||
		!ID.test(raw.id) ||
		!Number.isInteger(raw.version) ||
		(raw.version as number) < 1 ||
		(raw.version as number) > 1000 ||
		!isRecord(raw.state) ||
		!isPlainJson(raw.state, 0, { nodes: 0 }) ||
		(raw.content !== undefined &&
			(!isRecord(raw.content) || !isPlainJson(raw.content, 0, { nodes: 0 }, CONTENT_LIMITS)))
	) {
		return undefined;
	}
	return {
		id: raw.id,
		version: raw.version as number,
		state: JSON.parse(JSON.stringify(raw.state)),
		...(raw.content === undefined ? {} : { content: JSON.parse(JSON.stringify(raw.content)) })
	};
}

/** At most this many players' discoveries in one scene. */
const MAX_DISCOVERERS = 64;

/** Each player's discoveries, checked (remembered lights like a scene's), or what is wrong. */
export function parseDiscovery(
	raw: unknown,
	grid: SquareGrid
): Record<string, Discovered> | string {
	if (!isRecord(raw) || Object.keys(raw).length > MAX_DISCOVERERS) return 'Invalid discovery.';
	const discovery: Record<string, Discovered> = {};
	for (const [who, d] of Object.entries(raw)) {
		const player = normalizeName(who);
		if (!player || player !== who || !isRecord(d) || typeof d.explored !== 'string') {
			return 'Invalid discovery.';
		}
		const explored = encodeMask(decodeMask(d.explored, grid.width * grid.height));
		if (d.lights === undefined) {
			discovery[player] = { explored };
			continue;
		}
		const lights = parseLightList(d.lights, grid);
		if (typeof lights === 'string') return `${player}'s remembered lights: ${lights}`;
		discovery[player] = { explored, lights };
	}
	return discovery;
}
