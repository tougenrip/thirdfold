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
	edgeKey,
	isUnitEdge,
	MAX_OBJECTS_PER_ROOM,
	orderCorners,
	segmentProblem,
	unitEdges,
	type SceneObject
} from './objects';
import { normalizeName } from './protocol';
import { MAX_TOKENS_PER_ROOM, TOKEN_COLOR_PATTERN, type Token } from './token';
import { decodeMask, encodeMask, MAX_VISION } from './visibility';

export const SCENE_FILE_VERSION = 1;
export const SCENE_NAME_MAX_LENGTH = 48;
/** Serialized size cap, applied before parsing uploads and when saving. */
export const SCENE_FILE_MAX_BYTES = 1024 * 1024;
export const GRID_LIMITS = { minCells: 1, maxCells: 100, minCellSize: 0.25, maxCellSize: 5 };

/** A token as saved. The owner is kept by id and name so it can be re-matched in another session. */
export interface SavedToken extends Omit<Token, 'ownerId'> {
	owner: { id: string; name: string } | null;
}

export interface SceneFileV1 {
	format: 'thirdfold-scene';
	version: 1;
	name: string;
	/** ISO timestamp. */
	savedAt: string;
	grid: SquareGrid;
	tokens: SavedToken[];
	objects: SceneObject[];
	fog: { enabled: boolean; revealed: string };
}

export type SceneFile = SceneFileV1;

export type SceneParse = { ok: true; scene: SceneFile } | { ok: false; error: string };

export interface SceneSource {
	grid: SquareGrid;
	tokens: Iterable<Token>;
	objects: Iterable<SceneObject>;
	fog: { enabled: boolean; revealed: Uint8Array };
	/** Resolves an owner id to a display name, so ownership survives into other sessions. */
	playerName(id: string): string | undefined;
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
		fog: { enabled: source.fog.enabled, revealed: encodeMask(source.fog.revealed) }
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
	return data;
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

	// Fog
	if (!isRecord(data.fog) || typeof data.fog.enabled !== 'boolean')
		return bad('Invalid fog settings.');
	const revealed = typeof data.fog.revealed === 'string' ? data.fog.revealed : '';
	const mask = decodeMask(revealed, grid.width * grid.height);

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
			fog: { enabled: data.fog.enabled, revealed: encodeMask(mask) }
		}
	};
}
