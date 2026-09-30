// Saved scenes: plain, versioned JSON describing a tabletop (grid, tokens,
// walls and doors, fog reveals). Never renderer objects, never session
// state like who is connected or what each player explored.
//
// Everything read back (from disk or an uploaded file) goes through
// parseSceneFile, which migrates old versions forward and validates every
// field as strictly as live actions are validated. A scene file is data, so
// a tampered one can at worst be rejected, never smuggle in bad state.

import { decodeFloor, encodeFloor, type FloorMap } from './floor';
import { cornerInBounds, inBounds, type SquareGrid } from './grid';
import { AMBIENTS, MAX_LIGHT_RADIUS, parseLightList, type Ambient, type Light } from './lights';
import {
	edgeKey,
	isUnitEdge,
	MAX_OBJECTS_PER_ROOM,
	orderCorners,
	segmentProblem,
	unitEdges,
	type SceneObject
} from './objects';
import { normalizeName } from './names';
import {
	footprintCells,
	footprintInBounds,
	parsePropLook,
	resolveAssetId,
	MAX_PROPS_PER_ROOM,
	PROP_SCALE,
	propBlocks,
	type Prop
} from './props';
import { MAX_TOKENS_PER_ROOM, parseTokenLook, TOKEN_COLOR_PATTERN, type Token } from './token';
import { decodeLevels, encodeLevels, type LevelMap } from './terrain';
import {
	decodeMask,
	decodeMaskExact,
	emptyMask,
	encodeMask,
	MAX_VISION,
	type CellMask
} from './visibility';
import {
	ambientFor,
	DEFAULT_WORLD,
	defaultWorldFor,
	parseWorldLook,
	withBand,
	type WorldLook
} from './world';
import {
	migrate,
	parseDiscovery,
	parseSavedStory,
	SCENE_FILE_VERSION,
	type Discovered,
	type SavedStory,
	type SavedToken,
	type SceneFile
} from './scene-versions';
import { ASSET_ID_PATTERN } from '../assets/manifest';
import { normalizeSceneName } from './file-limits';

export {
	SCENE_FILE_VERSION,
	type Discovered,
	type SavedStory,
	type SavedToken,
	type SceneFile,
	type SceneFileV10
} from './scene-versions';

export { normalizeSceneName, SCENE_FILE_MAX_BYTES, SCENE_NAME_MAX_LENGTH } from './file-limits';
export const GRID_LIMITS = { minCells: 1, maxCells: 100, minCellSize: 0.25, maxCellSize: 5 };

export type SceneParse = { ok: true; scene: SceneFile } | { ok: false; error: string };

export interface SceneSource {
	grid: SquareGrid;
	tokens: Iterable<Token>;
	objects: Iterable<SceneObject>;
	props: Iterable<Prop>;
	lights: Iterable<Light>;
	ambient: Ambient;
	fog: { enabled: boolean; revealed: Uint8Array; shared: boolean };
	/** How the world looks; absent for the default at the ambient's hour. */
	world?: WorldLook;
	/** Roofed cells, or null for none. */
	interior?: CellMask | null;
	/** What each player has discovered, by player name: cells, and the lights they remember. */
	discovery?: Iterable<[string, { explored: CellMask; lights?: Iterable<Light> }]>;
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
	/** What each cell is made of, or null when nothing is painted. */
	floor?: FloorMap | null;
}

export function serializeScene(name: string, source: SceneSource, now = new Date()): SceneFile {
	// The look's hour always agrees with the band that is saved.
	const world = withBand(source.world ?? defaultWorldFor(source.ambient), source.ambient);
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
		ambient: ambientFor(world, source.ambient),
		world: structuredClone(world),
		interior: source.interior?.some((v) => v) ? encodeMask(source.interior) : null,
		fog: {
			enabled: source.fog.enabled,
			revealed: encodeMask(source.fog.revealed),
			shared: source.fog.shared
		},
		adventure: source.adventure ? structuredClone(source.adventure) : null,
		terrain: source.terrain ? encodeLevels(source.terrain) : null,
		darkness: source.darkness?.some((v) => v) ? encodeMask(source.darkness) : null,
		environment: source.environment ?? null,
		floor: source.floor?.some((v) => v !== 0) ? encodeFloor(source.floor) : null,
		discovery: Object.fromEntries(
			[...(source.discovery ?? [])].flatMap(([name, d]): [string, Discovered][] => {
				const lights = d.lights && [...d.lights].map((l) => structuredClone(l));
				if (!d.explored.some((v) => v) && !lights?.length) return [];
				return [[name, { explored: encodeMask(d.explored), ...(lights ? { lights } : {}) }]];
			})
		)
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function int(value: unknown, min: number, max: number): number | null {
	return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
		? (value as number)
		: null;
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
			return bad(`${tokenName} is off the map.`);
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
		const look = parseTokenLook(raw);
		if (!look) return bad(`${tokenName} has an invalid look.`);
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
			...look,
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
		const assetId = resolveAssetId(raw.assetId);
		if (!assetId) return bad('A prop uses an unknown asset.');
		const rotation = int(raw.rotation, 0, 3) as Prop['rotation'] | null;
		if (rotation === null) return bad('A prop has an invalid rotation.');
		const scale = raw.scale;
		if (typeof scale !== 'number' || !(scale >= PROP_SCALE.min && scale <= PROP_SCALE.max)) {
			return bad('A prop has an invalid scale.');
		}
		const pos = isRecord(raw.pos) ? { x: raw.pos.x as number, y: raw.pos.y as number } : null;
		if (!pos || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) {
			return bad('A prop is off the map.');
		}
		if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') {
			return bad('A prop is neither hidden nor shown.');
		}
		const look = parsePropLook(raw);
		if (!look) return bad('A prop has an invalid look.');
		const prop: Prop = {
			id: raw.id,
			assetId,
			pos,
			rotation,
			scale,
			...(raw.hidden === true ? { hidden: true as const } : {}),
			...look
		};
		if (!footprintInBounds(grid, prop)) return bad('A prop is off the map.');
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
	const lights = parseLightList(data.lights, grid, ids);
	if (typeof lights === 'string') return bad(lights);
	if (!AMBIENTS.includes(data.ambient as Ambient)) return bad('Unknown ambient light level.');

	// How the world looks; a sunlit hour decides the band, so the file holds one truth.
	const world = parseWorldLook(data.world);
	if (!world) return bad('The world look is not valid.');
	const ambient = ambientFor(world, data.ambient as Ambient);

	// Roofs
	let interior: string | null = null;
	if (data.interior !== null && data.interior !== undefined) {
		const roofs =
			typeof data.interior === 'string' ? decodeMaskExact(data.interior, width * height) : null;
		if (!roofs) return bad('The roofed cells do not fit the grid.');
		interior = roofs.some((v) => v) ? encodeMask(roofs) : null;
	}

	// Fog
	if (!isRecord(data.fog) || typeof data.fog.enabled !== 'boolean')
		return bad('Invalid fog settings.');
	const revealed = typeof data.fog.revealed === 'string' ? data.fog.revealed : '';
	const mask = decodeMask(revealed, grid.width * grid.height);
	if (typeof data.fog.shared !== 'boolean') return bad('Invalid fog settings.');
	const shared = data.fog.shared;

	// Discovery: what each player (by name) had seen, and the lights they remember.
	const discovery = parseDiscovery(data.discovery, grid);
	if (typeof discovery === 'string') return bad(discovery);

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

	// Floors
	let floor: string | null = null;
	if (data.floor !== null && data.floor !== undefined) {
		const map = typeof data.floor === 'string' ? decodeFloor(data.floor, width * height) : null;
		if (!map) return bad('The floors are not valid.');
		floor = map.some((v) => v !== 0) ? encodeFloor(map) : null;
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
	const adventure = parseSavedStory(data.adventure ?? null);
	if (adventure === undefined) return bad('The saved story is not valid.');

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
			ambient,
			world,
			interior,
			fog: { enabled: data.fog.enabled, revealed: encodeMask(mask), shared },
			adventure,
			terrain,
			darkness,
			environment,
			floor,
			discovery
		}
	};
}

/**
 * A new, empty table: `width` × `height` cells, in the plain look or an
 * environment's, in daylight unless `world`'s sunlit hour says otherwise.
 */
export function blankScene(
	name: string,
	width: number,
	height: number,
	environment: string | null,
	now = new Date(),
	world: WorldLook = DEFAULT_WORLD
): SceneFile {
	const grid: SquareGrid = { kind: 'square', cellSize: 1, width, height };
	return serializeScene(
		name,
		{
			grid,
			tokens: [],
			objects: [],
			props: [],
			lights: [],
			ambient: ambientFor(world, 'day'),
			world,
			fog: { enabled: false, revealed: emptyMask(grid), shared: false },
			playerName: () => undefined,
			environment
		},
		now
	);
}

/**
 * A table as it is shared with other GMs: the world only, with its look and
 * roofs. The story played on it, what each player discovered (and the lights
 * they remember) and who played which token stay behind.
 */
export function sharedScene(scene: SceneFile): SceneFile {
	return {
		...structuredClone(scene),
		tokens: scene.tokens.map((t) => ({ ...structuredClone(t), owner: null })),
		adventure: null,
		discovery: {}
	};
}
