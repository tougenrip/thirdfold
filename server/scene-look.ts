// Lights, how the world looks and what is dark or roofed: the GM's edits, and
// `lookWorld`, the one writer of the rules band (#200; ambient-writer.spec.ts
// holds every other file to it). scene.ts re-exports these.

import { randomInt, randomUUID } from 'node:crypto';
import { inBounds, type GridPos } from '../src/lib/game/grid';
import {
	LIGHT_LOOK_KEYS,
	MAX_LIGHTS_PER_ROOM,
	withDarkness,
	type Ambient,
	type Light,
	type LightLook
} from '../src/lib/game/lights';
import type { LightPatch } from '../src/lib/game/protocol';
import { canEditScene } from '../src/lib/game/permissions';
import { rectCells } from '../src/lib/game/visibility';
import {
	ambientFor,
	applyWorldPatch,
	MAX_SEED,
	withBand,
	type WorldLook,
	type WorldPatch
} from '../src/lib/game/world';
import { fail, type Player, type Result, type Room } from './rooms';

const FORBIDDEN_LIGHTS = fail('forbidden', 'Only the GM controls lights.');

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
		return fail('invalid_position', 'That area is off the map.');
	}
	room.darkness = withDarkness(room.darkness, room.grid, from, to, dark);
	return { ok: true, cells: rectCells(room.grid, from, to).length };
}

/** GM: roofs an area or lifts its roof. Presentation only: sight, light and movement ignore it. */
export function setInterior(
	room: Room,
	actor: Player,
	from: GridPos,
	to: GridPos,
	roofed: boolean
): Result<{ cells: number }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM builds the map.');
	if (!inBounds(room.grid, from) || !inBounds(room.grid, to)) {
		return fail('invalid_position', 'That area is off the map.');
	}
	room.interior = withDarkness(room.interior, room.grid, from, to, roofed);
	return { ok: true, cells: rectCells(room.grid, from, to).length };
}

/**
 * The only writer of the rules band: sets the world's look and the band it
 * decides (`ambientFor`: the hour's with a sun, else `band`).
 */
export function lookWorld(
	room: Room,
	next: WorldLook,
	band: Ambient = room.ambient
): { bandChanged: boolean } {
	const before = room.ambient;
	room.world = next;
	room.ambient = ambientFor(next, band);
	return { bandChanged: room.ambient !== before };
}

/** The band set without a permission check (the engine, fixtures): with a sun the hour snaps into it. */
export function setBand(room: Room, band: Ambient): { changed: boolean } {
	const before = JSON.stringify(room.world);
	const { bandChanged } = lookWorld(room, withBand(room.world, band), band);
	return { changed: bandChanged || JSON.stringify(room.world) !== before };
}

export function setAmbient(
	room: Room,
	actor: Player,
	ambient: Ambient
): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	return { ok: true, ...setBand(room, ambient) };
}

/** GM: the time, sky, weather, haze, grade and backdrop; a new weather kind gets a seed if none is sent. */
export function setWorld(
	room: Room,
	actor: Player,
	patch: WorldPatch,
	now = Date.now()
): Result<{ changed: boolean; bandChanged: boolean }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM sets the time, sky and weather.');
	const kind = patch.weather?.kind;
	if (kind !== undefined && kind !== room.world.weather.kind && patch.weather?.seed === undefined) {
		patch = { ...patch, weather: { ...patch.weather, seed: randomInt(MAX_SEED + 1) } };
	}
	const next = applyWorldPatch(room.world, patch, now);
	const changed = JSON.stringify(next) !== JSON.stringify(room.world);
	if (!changed) return { ok: true, changed, bandChanged: false };
	return { ok: true, changed, ...lookWorld(room, next) };
}

/** GM: how the table looks (an environment asset's id; the client ignores ids it doesn't know). */
export function setEnvironment(
	room: Room,
	actor: Player,
	environment: string | null
): Result<{ changed: boolean }> {
	if (!canEditScene(actor)) return fail('forbidden', 'Only the GM sets how the world looks.');
	const changed = room.environment !== environment;
	room.environment = environment;
	return { ok: true, changed };
}

export function createLight(
	room: Room,
	actor: Player,
	input: { pos: GridPos; radius: number; color: string } & Partial<LightLook>
): Result<{ light: Light }> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	if (room.lights.size >= MAX_LIGHTS_PER_ROOM) {
		return fail('limit_reached', `A room can hold at most ${MAX_LIGHTS_PER_ROOM} lights.`);
	}
	if (!inBounds(room.grid, input.pos)) return fail('invalid_position', 'That cell is off the map.');
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
	for (const key of LIGHT_LOOK_KEYS) {
		if (input[key] !== undefined) Object.assign(light, { [key]: input[key] });
	}
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
	for (const key of LIGHT_LOOK_KEYS) {
		const value = patch[key];
		if (value === null) delete light[key];
		else if (value !== undefined) Object.assign(light, { [key]: value });
	}
	return { ok: true, light };
}

export function deleteLight(room: Room, actor: Player, lightId: string): Result<object> {
	if (!canEditScene(actor)) return FORBIDDEN_LIGHTS;
	if (!room.lights.delete(lightId)) return fail('light_not_found', 'That light no longer exists.');
	return { ok: true };
}
