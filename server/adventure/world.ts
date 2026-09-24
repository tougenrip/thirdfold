// World objects at the table: looking one up, the state it starts in, and
// making the table show the state it is in (its prop's asset and place, its
// door, its light). A state's look is ordinary scene data, so every client
// sees the change through the normal view sync, and hidden objects are
// filtered out of players' views like anything else they can't see.

import type { InvestigationAction, ObjectState } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import type { AssetId, Rotation } from '../../src/lib/game/props';
import type { Room } from '../rooms';
import type { AdventureDef, ObjectDef, Verb } from './define';

const ACTION_BY_VERB: Record<string, InvestigationAction> = {
	examine: 'examine',
	read: 'inspect',
	search: 'search'
};

/** How a verb counts as investigating: examining, reading (inspecting), searching, or anything else. */
export function actionOfVerb(verb: Verb): InvestigationAction {
	return verb.action ?? ACTION_BY_VERB[verb.id] ?? 'interact';
}

export function objectDef(content: AdventureDef, id: string): ObjectDef | undefined {
	return content.objects.find((o) => o.id === id);
}

export function objectForDoor(content: AdventureDef, doorId: string): ObjectDef | undefined {
	return content.objects.find((o) => 'door' in o.thing && o.thing.door === doorId);
}

/** The prop a world object is, if it is a prop. */
export function propIdOf(def: ObjectDef): string | null {
	return 'prop' in def.thing ? def.thing.prop : null;
}

export function initialStates(content: AdventureDef): Map<string, ObjectState> {
	return new Map(content.objects.map((o) => [o.id, o.initial]));
}

/** Where each moved prop started, so a look's offset is always from the scene position. */
export type Origins = Map<string, Origin>;

/** Where an object's prop stands and how it looks before its state's look; moved by pushing, pulling, turning and dropping. */
export interface Origin {
	pos: GridPos;
	assetId: AssetId;
	rotation: Rotation;
}

/** The world objects at a location. */
export function objectsAt(content: AdventureDef, location: string): ObjectDef[] {
	return content.objects.filter((o) => o.location === location);
}

/** Remembers each object prop's scene position and asset, before any look changes them. */
export function recordOrigins(content: AdventureDef, room: Room): Origins {
	const origins: Origins = new Map();
	for (const def of content.objects) {
		const id = propIdOf(def);
		const prop = id ? room.props.get(id) : undefined;
		if (prop)
			origins.set(def.id, { pos: { ...prop.pos }, assetId: prop.assetId, rotation: prop.rotation });
	}
	return origins;
}

/** Makes the table show an object's state: its prop's asset and place, its door, its light. */
export function applyLook(room: Room, def: ObjectDef, state: ObjectState, origins: Origins): void {
	const look = def.looks?.[state] ?? {};
	const propId = propIdOf(def);
	const origin = origins.get(def.id);
	// An item in someone's hands is off the table; put down, it is back where it was left.
	if (propId && def.carry) {
		if (state === 'carried') room.props.delete(propId);
		else if (origin && !room.props.has(propId)) {
			room.props.set(propId, {
				id: propId,
				assetId: origin.assetId,
				pos: { ...origin.pos },
				rotation: origin.rotation,
				scale: 1
			});
		}
	}
	const prop = propId ? room.props.get(propId) : undefined;
	if (prop && origin) {
		prop.assetId = look.assetId ?? origin.assetId;
		const offset = look.offset ?? { x: 0, y: 0 };
		prop.pos = { x: origin.pos.x + offset.x, y: origin.pos.y + offset.y };
		prop.rotation = origin.rotation;
	}
	if ('door' in def.thing) {
		if (def.secret) revealDoor(room, def.thing.door, def.secret, state !== 'hidden');
		const door = room.objects.get(def.thing.door);
		if (door?.kind === 'door') door.open = state === 'opened';
	}
	if (def.light) {
		const light = room.lights.get(def.light);
		if (light && look.lit !== undefined) light.on = look.lit;
	}
}

/** A secret door is a wall until it is found, then a (closed) door on the same edge. */
function revealDoor(
	room: Room,
	doorId: string,
	edge: { a: GridPos; b: GridPos },
	found: boolean
): void {
	const sealed = `${doorId}-sealed`;
	if (found && !room.objects.has(doorId)) {
		room.objects.delete(sealed);
		room.objects.set(doorId, {
			id: doorId,
			kind: 'door',
			a: { ...edge.a },
			b: { ...edge.b },
			open: false
		});
	} else if (!found && !room.objects.has(sealed)) {
		room.objects.delete(doorId);
		room.objects.set(sealed, { id: sealed, kind: 'wall', a: { ...edge.a }, b: { ...edge.b } });
	}
}
