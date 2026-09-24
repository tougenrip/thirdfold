// Saved scenes: plain, versioned JSON describing a tabletop (grid, tokens,
// walls and doors, fog reveals). Never renderer objects, never session
// state like who is connected or what each player explored.
//
// Everything read back (from disk or an uploaded file) goes through
// parseSceneFile, which migrates old versions forward and validates every
// field as strictly as live actions are validated. A scene file is data, so
// a tampered one can at worst be rejected, never smuggle in bad state.

import { cornerInBounds, inBounds, type SquareGrid } from './grid';
import {
	AMBIENTS,
	MAX_LIGHT_RADIUS,
	MAX_LIGHTS_PER_ROOM,
	type Ambient,
	type Light
} from './lights';
import {
	edgeKey,
	isUnitEdge,
	MAX_OBJECTS_PER_ROOM,
	orderCorners,
	segmentProblem,
	unitEdges,
	type SceneObject
} from './objects';
import { normalizeName } from './protocol';
import {
	footprintCells,
	footprintInBounds,
	isAssetId,
	MAX_PROPS_PER_ROOM,
	PROP_SCALE,
	propBlocks,
	type Prop
} from './props';
import { MAX_TOKENS_PER_ROOM, TOKEN_COLOR_PATTERN, type Token } from './token';
import { decodeLevels, encodeLevels, type LevelMap } from './terrain';
import { decodeMask, encodeMask, MAX_VISION } from './visibility';
import { ASSET_ID_PATTERN } from '../assets/manifest';

/**
 * v2 added lights, the ambient level and token-carried light; v3 added props;
 * v4 added the state of a story being played at the table; v5 added
 * elevation (each cell's level) and windows; v6 added shared party vision,
 * hidden tokens and props, and what each player has discovered; v7 added
 * dark areas; v8 added the table's environment (how it looks: an asset id)
 * and each token's model (an asset id, optional).
 */
export const SCENE_FILE_VERSION = 8;
export const SCENE_NAME_MAX_LENGTH = 48;
/** Serialized size cap, applied before parsing uploads and when saving. */
export const SCENE_FILE_MAX_BYTES = 1024 * 1024;
export const GRID_LIMITS = { minCells: 1, maxCells: 100, minCellSize: 0.25, maxCellSize: 5 };

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

/** The current format. Older versions only exist as input to `migrate`. */
export type SceneFile = SceneFileV8;

export type SceneParse = { ok: true; scene: SceneFile } | { ok: false; error: string };

export interface SceneSource {
	grid: SquareGrid;
	tokens: Iterable<Token>;
	objects: Iterable<SceneObject>;
	props: Iterable<Prop>;
	lights: Iterable<Light>;
	ambient: Ambient;
	fog: { enabled: boolean; revealed: Uint8Array; shared: boolean };
	/** What each player has discovered, by player name. */
	discovery?: Iterable<[string, Uint8Array]>;
	/** Resolves an owner id to a display name, so ownership survives into other sessions. */
	playerName(id: string): string | undefined;
	/** The story played at the table, if any. */
	adventure?: SavedStory | null;
	/** Each cell's level, or null for a flat table. */
	terrain?: LevelMap | null;
	/** The dark areas, or null for none. */
	darkness?: Uint8Array | null;
	/** How the table looks (an environment asset's id), or null. */
	environment?: string | null;
}

export function normalizeSceneName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
	return name.length > 0 && name.length <= SCENE_NAME_MAX_LENGTH ? name : null;
}

export function serializeScene(name: string, source: SceneSource, now = new Date()): SceneFile {
	return {
		format: 'thirdfold-scene',
		version: SCENE_FILE_VERSION,
		name,
		savedAt: now.toISOString(),
		grid: { ...source.grid },
		tokens: [...source.tokens].map(({ ownerId, ...t }) => ({
			...structuredClone(t),
			owner: ownerId ? { id: ownerId, name: source.playerName(ownerId) ?? '' } : null
		})),
		objects: [...source.objects].map((o) => structuredClone(o)),
		props: [...source.props].map((p) => structuredClone(p)),
		lights: [...source.lights].map((l) => structuredClone(l)),
		ambient: source.ambient,
		fog: {
			enabled: source.fog.enabled,
			revealed: encodeMask(source.fog.revealed),
			shared: source.fog.shared
		},
		adventure: source.adventure ? structuredClone(source.adventure) : null,
		terrain: source.terrain ? encodeLevels(source.terrain) : null,
		darkness: source.darkness?.some((v) => v) ? encodeMask(source.darkness) : null,
		environment: source.environment ?? null,
		discovery: Object.fromEntries(
			[...(source.discovery ?? [])]
				.filter(([, mask]) => mask.some((v) => v))
				.map(([name, mask]) => [name, encodeMask(mask)])
		)
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** At most this many players' discoveries in one scene. */
const MAX_DISCOVERERS = 64;

function int(value: unknown, min: number, max: number): number | null {
	return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
		? (value as number)
		: null;
}

/**
 * Upgrades older file versions to the current one. Each future version adds
 * one step here (v1 → v2 → …), so any old save keeps loading.
 */
function migrate(data: Record<string, unknown>): Record<string, unknown> | string {
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
	return upgraded;
}

/** Validates and normalises anything claiming to be a scene file. */
export function parseSceneFile(input: unknown): SceneParse {
	const bad = (error: string): SceneParse => ({ ok: false, error });
	if (!isRecord(input) || input.format !== 'thirdfold-scene') {
		return bad('This is not a thirdfold scene file.');
	}
	const migrated = migrate(input);
	if (typeof migrated === 'string') return bad(migrated);
	const data = migrated;

	const name = normalizeSceneName(data.name);
	if (!name) return bad('The scene needs a name of 1-48 characters.');
	const savedAt =
		typeof data.savedAt === 'string' && !Number.isNaN(Date.parse(data.savedAt))
			? new Date(data.savedAt).toISOString()
			: new Date(0).toISOString();

	// Grid
	if (!isRecord(data.grid) || data.grid.kind !== 'square') return bad('Unsupported grid.');
	const width = int(data.grid.width, GRID_LIMITS.minCells, GRID_LIMITS.maxCells);
	const height = int(data.grid.height, GRID_LIMITS.minCells, GRID_LIMITS.maxCells);
	const cellSize = data.grid.cellSize;
	if (
		width === null ||
		height === null ||
		typeof cellSize !== 'number' ||
		!(cellSize >= GRID_LIMITS.minCellSize && cellSize <= GRID_LIMITS.maxCellSize)
	) {
		return bad('The grid size is out of range.');
	}
	const grid: SquareGrid = { kind: 'square', width, height, cellSize };

	// Tokens
	if (!Array.isArray(data.tokens) || data.tokens.length > MAX_TOKENS_PER_ROOM) {
		return bad(`A scene holds at most ${MAX_TOKENS_PER_ROOM} tokens.`);
	}
	const tokens: SavedToken[] = [];
	const ids = new Set<string>();
	const cells = new Set<string>();
	for (const raw of data.tokens as unknown[]) {
		if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) {
			return bad('A token has a missing or duplicate id.');
		}
		const tokenName = normalizeName(raw.name);
		if (!tokenName) return bad('A token has an invalid name.');
		if (typeof raw.color !== 'string' || !TOKEN_COLOR_PATTERN.test(raw.color)) {
			return bad(`${tokenName} has an invalid colour.`);
		}
		const pos = isRecord(raw.pos) ? { x: raw.pos.x, y: raw.pos.y } : null;
		if (!pos || !inBounds(grid, pos as { x: number; y: number })) {
			return bad(`${tokenName} is off the table.`);
		}
		const cell = `${pos.x},${pos.y}`;
		if (cells.has(cell)) return bad(`Two tokens share the cell ${cell}.`);
		const vision = int(raw.vision, 0, MAX_VISION);
		if (vision === null) return bad(`${tokenName} has an invalid vision range.`);
		const light = int(raw.light, 0, MAX_LIGHT_RADIUS);
		if (light === null) return bad(`${tokenName} has an invalid light radius.`);
		if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
			return bad(`${tokenName} is neither hidden nor shown.`);
		}
		if (
			raw.model !== undefined &&
			(typeof raw.model !== 'string' || !ASSET_ID_PATTERN.test(raw.model))
		) {
			return bad(`${tokenName} has an invalid model.`);
		}
		let owner: SavedToken['owner'] = null;
		if (raw.owner !== null && raw.owner !== undefined) {
			if (!isRecord(raw.owner) || typeof raw.owner.id !== 'string' || !ID.test(raw.owner.id)) {
				return bad(`${tokenName} has an invalid owner.`);
			}
			owner = { id: raw.owner.id, name: normalizeName(raw.owner.name) ?? '' };
		}
		ids.add(raw.id);
		cells.add(cell);
		tokens.push({
			id: raw.id,
			name: tokenName,
			color: raw.color,
			pos: pos as { x: number; y: number },
			vision,
			light,
			...(raw.hidden === true ? { hidden: true as const } : {}),
			...(typeof raw.model === 'string' ? { model: raw.model } : {}),
			owner
		});
	}

	// Walls and doors
	if (!Array.isArray(data.objects) || data.objects.length > MAX_OBJECTS_PER_ROOM) {
		return bad(`A scene holds at most ${MAX_OBJECTS_PER_ROOM} walls and doors.`);
	}
	const objects: SceneObject[] = [];
	for (const raw of data.objects as unknown[]) {
		if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) {
			return bad('A wall or door has a missing or duplicate id.');
		}
		if (raw.kind !== 'wall' && raw.kind !== 'door') return bad('Unknown scene object.');
		const a = isRecord(raw.a) ? { x: raw.a.x as number, y: raw.a.y as number } : null;
		const b = isRecord(raw.b) ? { x: raw.b.x as number, y: raw.b.y as number } : null;
		if (
			!a ||
			!b ||
			!cornerInBounds(grid, a) ||
			!cornerInBounds(grid, b) ||
			segmentProblem(grid, a, b)
		) {
			return bad('A wall or door is not on the grid lines.');
		}
		const ends = orderCorners(a, b);
		ids.add(raw.id);
		if (raw.kind === 'door') {
			if (!isUnitEdge(a, b) || typeof raw.open !== 'boolean') return bad('A door is invalid.');
			objects.push({ id: raw.id, kind: 'door', ...ends, open: raw.open });
		} else if (raw.window !== undefined && raw.window !== false) {
			if (raw.window !== true) return bad('A window is invalid.');
			objects.push({ id: raw.id, kind: 'wall', ...ends, window: true });
		} else {
			objects.push({ id: raw.id, kind: 'wall', ...ends });
		}
	}

	// Same rule as live building: nothing may overlap a door.
	const doorEdges = new Set(objects.filter((o) => o.kind === 'door').map((o) => edgeKey(o)));
	if (doorEdges.size !== objects.filter((o) => o.kind === 'door').length) {
		return bad('Two doors share an edge.');
	}
	for (const o of objects) {
		if (o.kind === 'wall' && unitEdges(o.a, o.b).some((e) => doorEdges.has(edgeKey(e)))) {
			return bad('A wall runs through a door.');
		}
	}

	// Props: same placement rules as live editing.
	if (!Array.isArray(data.props) || data.props.length > MAX_PROPS_PER_ROOM) {
		return bad(`A scene holds at most ${MAX_PROPS_PER_ROOM} props.`);
	}
	const props: Prop[] = [];
	const solidCells = new Set<string>();
	for (const t of tokens) solidCells.add(`${t.pos.x},${t.pos.y}`);
	for (const raw of data.props as unknown[]) {
		if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) {
			return bad('A prop has a missing or duplicate id.');
		}
		if (!isAssetId(raw.assetId)) return bad('A prop uses an unknown asset.');
		const rotation = int(raw.rotation, 0, 3) as Prop['rotation'] | null;
		if (rotation === null) return bad('A prop has an invalid rotation.');
		const scale = raw.scale;
		if (typeof scale !== 'number' || !(scale >= PROP_SCALE.min && scale <= PROP_SCALE.max)) {
			return bad('A prop has an invalid scale.');
		}
		const pos = isRecord(raw.pos) ? { x: raw.pos.x as number, y: raw.pos.y as number } : null;
		if (!pos || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) {
			return bad('A prop is off the table.');
		}
		if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
			return bad('A prop is neither hidden nor shown.');
		}
		const prop: Prop = {
			id: raw.id,
			assetId: raw.assetId,
			pos,
			rotation,
			scale,
			...(raw.hidden === true ? { hidden: true as const } : {})
		};
		if (!footprintInBounds(grid, prop)) return bad('A prop is off the table.');
		if (propBlocks(prop) !== 'none') {
			for (const c of footprintCells(prop)) {
				const key = `${c.x},${c.y}`;
				if (solidCells.has(key)) return bad(`A prop overlaps a token or another prop at ${key}.`);
				solidCells.add(key);
			}
		}
		ids.add(raw.id);
		props.push(prop);
	}

	// Lights
	if (!Array.isArray(data.lights) || data.lights.length > MAX_LIGHTS_PER_ROOM) {
		return bad(`A scene holds at most ${MAX_LIGHTS_PER_ROOM} lights.`);
	}
	const lights: Light[] = [];
	for (const raw of data.lights as unknown[]) {
		if (!isRecord(raw) || typeof raw.id !== 'string' || !ID.test(raw.id) || ids.has(raw.id)) {
			return bad('A light has a missing or duplicate id.');
		}
		const pos = isRecord(raw.pos) ? { x: raw.pos.x as number, y: raw.pos.y as number } : null;
		if (!pos || !inBounds(grid, pos)) return bad('A light is off the table.');
		const radius = int(raw.radius, 1, MAX_LIGHT_RADIUS);
		if (radius === null) return bad('A light has an invalid radius.');
		if (typeof raw.color !== 'string' || !TOKEN_COLOR_PATTERN.test(raw.color)) {
			return bad('A light has an invalid colour.');
		}
		if (typeof raw.on !== 'boolean') return bad('A light is neither on nor off.');
		ids.add(raw.id);
		lights.push({ id: raw.id, pos, radius, color: raw.color, on: raw.on });
	}
	if (!AMBIENTS.includes(data.ambient as Ambient)) return bad('Unknown ambient light level.');

	// Fog
	if (!isRecord(data.fog) || typeof data.fog.enabled !== 'boolean')
		return bad('Invalid fog settings.');
	const revealed = typeof data.fog.revealed === 'string' ? data.fog.revealed : '';
	const mask = decodeMask(revealed, grid.width * grid.height);
	if (typeof data.fog.shared !== 'boolean') return bad('Invalid fog settings.');
	const shared = data.fog.shared;

	// Discovery: what each player (by name) had seen.
	if (!isRecord(data.discovery) || Object.keys(data.discovery).length > MAX_DISCOVERERS) {
		return bad('Invalid discovery.');
	}
	const discovery: Record<string, string> = {};
	for (const [who, raw] of Object.entries(data.discovery)) {
		const player = normalizeName(who);
		if (!player || player !== who || typeof raw !== 'string') return bad('Invalid discovery.');
		discovery[player] = encodeMask(decodeMask(raw, grid.width * grid.height));
	}

	// Elevation
	let terrain: string | null = null;
	if (data.terrain !== null && data.terrain !== undefined) {
		const levels =
			typeof data.terrain === 'string' ? decodeLevels(data.terrain, width * height) : null;
		if (!levels) return bad('The elevation map is not valid.');
		terrain = levels.some((l) => l !== 0) ? encodeLevels(levels) : null;
	}

	// Dark areas
	let darkness: string | null = null;
	if (data.darkness !== null && data.darkness !== undefined) {
		if (typeof data.darkness !== 'string') return bad('The dark areas are not valid.');
		const dark = decodeMask(data.darkness, width * height);
		darkness = dark.some((v) => v) ? encodeMask(dark) : null;
	}

	// How it looks: only an asset's id.
	const environment = data.environment ?? null;
	if (
		environment !== null &&
		(typeof environment !== 'string' || !ASSET_ID_PATTERN.test(environment))
	) {
		return bad('The environment is not valid.');
	}

	// The story: plain JSON here; its module checks the rest when it loads it.
	let adventure: SavedStory | null = null;
	if (data.adventure !== null && data.adventure !== undefined) {
		const raw = data.adventure;
		if (
			!isRecord(raw) ||
			typeof raw.id !== 'string' ||
			!ID.test(raw.id) ||
			int(raw.version, 1, 1000) === null ||
			!isRecord(raw.state) ||
			!isPlainJson(raw.state, 0, { nodes: 0 })
		) {
			return bad('The saved story is not valid.');
		}
		adventure = {
			id: raw.id,
			version: raw.version as number,
			state: JSON.parse(JSON.stringify(raw.state))
		};
	}

	return {
		ok: true,
		scene: {
			format: 'thirdfold-scene',
			version: SCENE_FILE_VERSION,
			name,
			savedAt,
			grid,
			tokens,
			objects,
			props,
			lights,
			ambient: data.ambient as Ambient,
			fog: { enabled: data.fog.enabled, revealed: encodeMask(mask), shared },
			adventure,
			terrain,
			darkness,
			environment,
			discovery
		}
	};
}

const JSON_LIMITS = { depth: 12, nodes: 20000 };

/** Whether a value is plain JSON data (no functions, no cycles), within depth and size limits. */
function isPlainJson(value: unknown, depth: number, count: { nodes: number }): boolean {
	if (++count.nodes > JSON_LIMITS.nodes || depth > JSON_LIMITS.depth) return false;
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every((v) => isPlainJson(v, depth + 1, count));
	if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
	return Object.values(value).every((v) => isPlainJson(v, depth + 1, count));
}
