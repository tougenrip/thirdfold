// Authoritative scene edits. Every function takes the acting player and
// checks permission and validity before touching the room.

import { randomUUID } from 'node:crypto';
import { inBounds, type GridPos } from '../src/lib/game/grid';
import {
	cutWall,
	edgeKey,
	isReachable,
	isUnitEdge,
	MAX_OBJECTS_PER_ROOM,
	orderCorners,
	segmentProblem,
	unitEdges,
	type Door,
	type Obstacles,
	type SceneObject
} from '../src/lib/game/objects';
import { canEditScene, canMoveToken, canUseDoor } from '../src/lib/game/permissions';
import {
	MAX_LIGHTS_PER_ROOM,
	lightSources,
	seenByLight,
	withDarkness,
	type Ambient,
	type Light
} from '../src/lib/game/lights';
import {
	isSolidCell,
	MAX_PROPS_PER_ROOM,
	obstaclesFor,
	placementProblem,
	type AssetId,
	type Prop,
	type Rotation
} from '../src/lib/game/props';
import {
	normalizeName,
	type LightPatch,
	type PropPatch,
	type TokenPatch
} from '../src/lib/game/protocol';
import { roomAround, roomBoundary } from '../src/lib/game/rooms';
import { withFloor, type FloorId } from '../src/lib/game/floor';
import { MAX_LEVEL, withLevel } from '../src/lib/game/terrain';
import { MAX_TOKENS_PER_ROOM, tokenAt, type Token } from '../src/lib/game/token';
import {
	DEFAULT_VISION,
	rectCells,
	SightCache,
	type CellMask,
	type VisionAdder
} from '../src/lib/game/visibility';
import { fail, type Player, type Result, type Room } from './rooms';

/** Walls, closed doors and blocking props, as movement and sight see them. */
export function obstacles(room: Room) {
	return obstaclesFor(
		room.grid,
		room.objects.values(),
		room.props.values(),
		room.terrain,
		room.floor
	);
}

export interface NewToken {
	name: string;
	color: string;
	pos: GridPos;
	ownerId: string | null;
}

const FORBIDDEN_EDIT = fail('forbidden', 'Only the GM can change tokens.');

/** Owners must be seated players; spectators and the GM (who moves everything anyway) are not. */
function checkOwner(room: Room, ownerId: string | null): Result<object> {
	if (ownerId === null) return { ok: true };
	return room.players.get(ownerId)?.role === 'player'
		? { ok: true }
		: fail('invalid_owner', 'Tokens can only be assigned to players in this room.');
}

function checkCell(room: Room, pos: GridPos, movingId?: string): Result<object> {
	if (!inBounds(room.grid, pos)) return fail('invalid_position', 'That cell is off the table.');
	const occupant = tokenAt(room.tokens.values(), pos);
	// No name here: under fog the occupant may be a token the mover cannot see.
	if (occupant && occupant.id !== movingId) return fail('cell_occupied', 'That cell is occupied.');
	if (isSolidCell(obstacles(room), pos))
		return fail('cell_occupied', 'Something is in the way there.');
	return { ok: true };
}

export function createToken(room: Room, actor: Player, input: NewToken): Result<{ token: Token }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	if (room.tokens.size >= MAX_TOKENS_PER_ROOM) {
		return fail('limit_reached', `A room can hold at most ${MAX_TOKENS_PER_ROOM} tokens.`);
	}
	const name = normalizeName(input.name);
	if (!name) return fail('invalid_name', 'Token name must be 1-32 characters.');
	const cell = checkCell(room, input.pos);
	if (!cell.ok) return cell;
	const owner = checkOwner(room, input.ownerId);
	if (!owner.ok) return owner;

	const token: Token = {
		id: randomUUID(),
		name,
		color: input.color,
		pos: { x: input.pos.x, y: input.pos.y },
		ownerId: input.ownerId,
		vision: DEFAULT_VISION,
		light: 0
	};
	room.tokens.set(token.id, token);
	return { ok: true, token };
}

export function moveToken(
	room: Room,
	actor: Player,
	tokenId: string,
	to: GridPos
): Result<{ token: Token; from: GridPos }> {
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');
	if (!canMoveToken(actor, token)) return fail('forbidden', 'You cannot move that token.');
	const cell = checkCell(room, to, token.id);
	if (!cell.ok) return cell;
	// Players walk: the destination must be reachable without crossing walls or
	// closed doors. The GM places freely.
	if (actor.role !== 'gm' && !isReachable(room.grid, obstacles(room), token.pos, to)) {
		return fail('no_path', "There's no way through to that cell.");
	}
	const from = token.pos;
	token.pos = { x: to.x, y: to.y };
	return { ok: true, token, from };
}

export function updateToken(
	room: Room,
	actor: Player,
	tokenId: string,
	patch: TokenPatch
): Result<{ token: Token; previousOwnerId: string | null }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');

	// Validate everything before applying anything, so a bad field leaves the token untouched.
	const name = patch.name === undefined ? token.name : normalizeName(patch.name);
	if (!name) return fail('invalid_name', 'Token name must be 1-32 characters.');
	if (patch.ownerId !== undefined) {
		const owner = checkOwner(room, patch.ownerId);
		if (!owner.ok) return owner;
	}

	const previousOwnerId = token.ownerId;
	token.name = name;
	if (patch.color !== undefined) token.color = patch.color;
	if (patch.ownerId !== undefined) token.ownerId = patch.ownerId;
	if (patch.vision !== undefined) token.vision = patch.vision;
	if (patch.light !== undefined) token.light = patch.light;
	if (patch.hidden === true) token.hidden = true;
	else if (patch.hidden === false) delete token.hidden;
	if (typeof patch.model === 'string') token.model = patch.model;
	else if (patch.model === null) delete token.model;
	return { ok: true, token, previousOwnerId };
}

export function deleteToken(room: Room, actor: Player, tokenId: string): Result<{ token: Token }> {
	if (!canEditScene(actor)) return FORBIDDEN_EDIT;
	const token = room.tokens.get(tokenId);
	if (!token) return fail('token_not_found', 'That token no longer exists.');
	room.tokens.delete(tokenId);
	return { ok: true, token };
}

export interface ObjectChanges {
	upserted: SceneObject[];
	removed: string[];
}

export function createObject(
	room: Room,
	actor: Player,
	kind: 'wall' | 'door',
	a: GridPos,
	b: GridPos
): Result<ObjectChanges> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can build walls and doors.');
	if (room.objects.size >= MAX_OBJECTS_PER_ROOM) {
		return fail(
			'limit_reached',
			`A room can hold at most ${MAX_OBJECTS_PER_ROOM} walls and doors.`
		);
	}
	const problem = segmentProblem(room.grid, a, b);
	if (problem) return fail('invalid_object', problem);
	if (kind === 'door' && !isUnitEdge(a, b)) {
		return fail('invalid_object', 'A door spans exactly one grid square.');
	}
	const ends = orderCorners({ x: a.x, y: a.y }, { x: b.x, y: b.y });

	// Nothing may overlap an existing door.
	const doorEdges = new Set<string>();
	for (const o of room.objects.values()) if (o.kind === 'door') doorEdges.add(edgeKey(o));
	if (unitEdges(ends.a, ends.b).some((e) => doorEdges.has(edgeKey(e)))) {
		return fail('edge_occupied', 'There is already a door there.');
	}

	if (kind === 'wall') {
		const wall: SceneObject = { id: randomUUID(), kind: 'wall', ...ends };
		room.objects.set(wall.id, wall);
		return { ok: true, upserted: [wall], removed: [] };
	}

	// A door placed in a wall cuts a doorway: split every wall covering that edge.
	const door: Door = { id: randomUUID(), kind: 'door', ...ends, open: false };
	const changes: ObjectChanges = { upserted: [], removed: [] };
	for (const o of [...room.objects.values()]) {
		if (o.kind !== 'wall') continue;
		const pieces = cutWall(o, door, randomUUID);
		if (pieces.length === 1 && pieces[0] === o) continue;
		room.objects.delete(o.id);
		for (const piece of pieces) room.objects.set(piece.id, piece);
		changes.upserted.push(...pieces);
		if (!pieces.some((p) => p.id === o.id)) changes.removed.push(o.id);
	}
	room.objects.set(door.id, door);
	changes.upserted.push(door);
	return { ok: true, ...changes };
}

export function deleteObject(
	room: Room,
	actor: Player,
	objectId: string
): Result<{ object: SceneObject }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can remove walls and doors.');
	const object = room.objects.get(objectId);
	if (!object) return fail('object_not_found', 'That wall or door no longer exists.');
	room.objects.delete(objectId);
	return { ok: true, object };
}

export function toggleDoor(room: Room, actor: Player, objectId: string): Result<{ door: Door }> {
	const door = room.objects.get(objectId);
	if (!door || door.kind !== 'door') return fail('object_not_found', 'That door no longer exists.');
	if (!canUseDoor(actor, door, room.tokens.values(), room.grid)) {
		return fail(
			'forbidden',
			actor.role === 'player'
				? 'Move one of your tokens next to the door first.'
				: 'You cannot open doors.'
		);
	}
	door.open = !door.open;
	return { ok: true, door };
}

export function setFog(room: Room, actor: Player, enabled: boolean): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM controls fog of war.');
	const changed = room.fog.enabled !== enabled;
	room.fog.enabled = enabled;
	return { ok: true, changed };
}

/**
 * Reveals the rectangle between two cells to everyone, or hides it again.
 * Hiding also makes players forget they explored it, so the area goes dark
 * until their tokens see it anew.
 */
export function fogArea(
	room: Room,
	actor: Player,
	from: GridPos,
	to: GridPos,
	reveal: boolean
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can reveal or hide the map.');
	if (!inBounds(room.grid, from) || !inBounds(room.grid, to)) {
		return fail('invalid_position', 'That area is off the table.');
	}
	const cells = rectCells(room.grid, from, to);
	for (const i of cells) {
		room.fog.revealed[i] = reveal ? 1 : 0;
		if (!reveal) for (const p of room.players.values()) p.explored[i] = 0;
	}
	return { ok: true, cells: cells.length };
}

/**
 * Reveals the whole room around a cell (the walled-in space it is part of,
 * see rooms.ts) to everyone, or hides it again, as `fogArea` does for a
 * rectangle. Open ground is not a room.
 */
export function fogRoom(
	room: Room,
	actor: Player,
	cell: GridPos,
	reveal: boolean
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM can reveal or hide the map.');
	if (!inBounds(room.grid, cell)) return fail('invalid_position', 'That cell is off the table.');
	const cells = roomAround(room.grid, roomBoundary(room.objects.values()), cell);
	if (!cells) {
		return fail('invalid_position', 'That is open ground, not a room with walls around it.');
	}
	for (const i of cells) {
		room.fog.revealed[i] = reveal ? 1 : 0;
		if (!reveal) for (const p of room.players.values()) p.explored[i] = 0;
	}
	return { ok: true, cells: cells.length };
}

/** GM: whether the party shares what it sees. */
export function setFogShared(
	room: Room,
	actor: Player,
	shared: boolean
): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM controls fog of war.');
	const changed = room.fog.shared !== shared;
	room.fog.shared = shared;
	return { ok: true, changed };
}

/** GM: sets the level of every cell in a rectangle (0 is the floor). */
export function setTerrain(
	room: Room,
	actor: Player,
	from: GridPos,
	to: GridPos,
	level: number
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM shapes the ground.');
	if (!inBounds(room.grid, from) || !inBounds(room.grid, to)) {
		return fail('invalid_position', 'That area is off the table.');
	}
	if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
		return fail('invalid_position', `Levels run from 0 to ${MAX_LEVEL}.`);
	}
	room.terrain = withLevel(room.terrain, room.grid, from, to, level);
	return { ok: true, cells: rectCells(room.grid, from, to).length };
}

/**
 * GM: paints every cell of a rectangle with a floor (stone, wood, water...),
 * or marks it off the map (`void`: nobody can stand there). Refused where a
 * token stands on cells it would put off the map.
 */
export function setFloor(
	room: Room,
	actor: Player,
	from: GridPos,
	to: GridPos,
	floor: FloorId
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM paints the floor.');
	if (!inBounds(room.grid, from) || !inBounds(room.grid, to)) {
		return fail('invalid_position', 'That area is off the table.');
	}
	const cells = rectCells(room.grid, from, to);
	if (floor === 'void') {
		const inside = new Set(cells);
		const stranded = [...room.tokens.values()].some((t) =>
			inside.has(t.pos.y * room.grid.width + t.pos.x)
		);
		if (stranded) return fail('cell_occupied', 'Move the tokens off that area first.');
	}
	room.floor = withFloor(room.floor, room.grid, from, to, floor);
	return { ok: true, cells: cells.length };
}

/** GM: makes an area dark (only light lets anyone see there) or not. */
export function setDarkness(
	room: Room,
	actor: Player,
	from: GridPos,
	to: GridPos,
	dark: boolean
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM controls lights.');
	if (!inBounds(room.grid, from) || !inBounds(room.grid, to)) {
		return fail('invalid_position', 'That area is off the table.');
	}
	room.darkness = withDarkness(room.darkness, room.grid, from, to, dark);
	return { ok: true, cells: rectCells(room.grid, from, to).length };
}

/** The table's sight cache, set to these obstacles (see SightCache). */
export function sightsFor(room: Room, blocked: Obstacles): SightCache {
	return (room.sights ??= new SightCache()).use(room.grid, blocked);
}

/** What light lets anyone see on the table now (see seenByLight); null while a flash lights it all. */
export function lightFor(
	room: Room,
	blocked: Obstacles,
	now = Date.now(),
	add: VisionAdder = sightsFor(room, blocked).add
): CellMask | null {
	if ((room.flashUntil ?? 0) > now) return null;
	const sources = lightSources(room.lights.values(), room.tokens.values());
	return seenByLight(room.grid, blocked, room.ambient, room.darkness, sources, add);
}

const FORBIDDEN_LIGHTS = fail('forbidden', 'Only the GM controls lights.');

export function createLight(
	room: Room,
	actor: Player,
	input: { pos: GridPos; radius: number; color: string }
): Result<{ light: Light }> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	if (room.lights.size >= MAX_LIGHTS_PER_ROOM) {
		return fail('limit_reached', `A room can hold at most ${MAX_LIGHTS_PER_ROOM} lights.`);
	}
	if (!inBounds(room.grid, input.pos))
		return fail('invalid_position', 'That cell is off the table.');
	if ([...room.lights.values()].some((l) => l.pos.x === input.pos.x && l.pos.y === input.pos.y)) {
		return fail('cell_occupied', 'There is already a light on that cell.');
	}
	const light: Light = {
		id: randomUUID(),
		pos: { x: input.pos.x, y: input.pos.y },
		radius: input.radius,
		color: input.color,
		on: true
	};
	room.lights.set(light.id, light);
	return { ok: true, light };
}

export function updateLight(
	room: Room,
	actor: Player,
	lightId: string,
	patch: LightPatch
): Result<{ light: Light }> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	const light = room.lights.get(lightId);
	if (!light) return fail('light_not_found', 'That light no longer exists.');
	if (patch.radius !== undefined) light.radius = patch.radius;
	if (patch.color !== undefined) light.color = patch.color;
	if (patch.on !== undefined) light.on = patch.on;
	return { ok: true, light };
}

export function deleteLight(room: Room, actor: Player, lightId: string): Result<object> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	if (!room.lights.delete(lightId)) return fail('light_not_found', 'That light no longer exists.');
	return { ok: true };
}

export function setAmbient(
	room: Room,
	actor: Player,
	ambient: Ambient
): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	const changed = room.ambient !== ambient;
	room.ambient = ambient;
	return { ok: true, changed };
}

/** GM: how the table looks (an environment asset's id; the client ignores ids it doesn't know). */
export function setEnvironment(
	room: Room,
	actor: Player,
	environment: string | null
): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM sets how the table looks.');
	const changed = room.environment !== environment;
	room.environment = environment;
	return { ok: true, changed };
}

const FORBIDDEN_PROPS = fail('forbidden', 'Only the GM can place and arrange props.');

function checkPlacement(
	room: Room,
	placement: Pick<Prop, 'assetId' | 'pos' | 'rotation'>,
	selfId?: string
): Result<object> {
	const problem = placementProblem(
		room.grid,
		placement,
		room.tokens.values(),
		room.props.values(),
		selfId
	);
	return problem ? fail(problem.code, problem.message) : { ok: true };
}

export function createProp(
	room: Room,
	actor: Player,
	input: { assetId: AssetId; pos: GridPos; rotation: Rotation }
): Result<{ prop: Prop }> {
	if (!canEditScene(actor)) return FORBIDDEN_PROPS;
	if (room.props.size >= MAX_PROPS_PER_ROOM) {
		return fail('limit_reached', `A room can hold at most ${MAX_PROPS_PER_ROOM} props.`);
	}
	const prop: Prop = {
		id: randomUUID(),
		assetId: input.assetId,
		pos: { x: input.pos.x, y: input.pos.y },
		rotation: input.rotation,
		scale: 1
	};
	const ok = checkPlacement(room, prop);
	if (!ok.ok) return ok;
	room.props.set(prop.id, prop);
	return { ok: true, prop };
}

/** Moves, rotates and/or scales a prop. The whole change applies or none of it does. */
export function updateProp(
	room: Room,
	actor: Player,
	propId: string,
	patch: PropPatch
): Result<{ prop: Prop }> {
	if (!canEditScene(actor)) return FORBIDDEN_PROPS;
	const prop = room.props.get(propId);
	if (!prop) return fail('prop_not_found', 'That prop no longer exists.');
	const { hidden: wasHidden, ...rest } = prop;
	const next: Prop = {
		...rest,
		pos: patch.pos ? { x: patch.pos.x, y: patch.pos.y } : prop.pos,
		rotation: patch.rotation ?? prop.rotation,
		scale: patch.scale ?? prop.scale,
		...((patch.hidden ?? wasHidden) ? { hidden: true as const } : {})
	};
	const ok = checkPlacement(room, next, prop.id);
	if (!ok.ok) return ok;
	Object.assign(prop, next);
	if (!next.hidden) delete prop.hidden;
	return { ok: true, prop };
}

export function deleteProp(room: Room, actor: Player, propId: string): Result<object> {
	if (!canEditScene(actor)) return FORBIDDEN_PROPS;
	if (!room.props.delete(propId)) return fail('prop_not_found', 'That prop no longer exists.');
	return { ok: true };
}
