// World objects in Bellweather: the things a character can walk up to and
// use, what state each is in, and how each state looks on the table. The
// data lives here; the story each verb advances lives in engine.ts.
//
// A state's look is ordinary scene data (a prop's asset or position, a door
// opening, a light switching on), so every client sees the change through the
// normal view sync, and hidden objects are filtered out of players' views
// like anything else they can't see.

import type { ObjectKind, ObjectState } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import type { AssetId } from '../../src/lib/game/props';
import type { Room } from '../rooms';
import { IDS } from './bellweather';

export interface Verb {
	id: string;
	label: string;
	/** States it can be done in. */
	from: readonly ObjectState[];
	/** The state it leaves the object in; unchanged if omitted. */
	to?: ObjectState;
}

/** How a state shows on the table. Unlisted states keep the object's scene look. */
export interface Look {
	assetId?: AssetId;
	/** Shift from the object's place in the scene, in cells. */
	offset?: GridPos;
	/** The object's light (torches) switched on or off. */
	lit?: boolean;
}

export interface ObjectDef {
	id: string;
	name: string;
	kind: ObjectKind;
	/** What it is in the scene: a token (people), a prop, or a door. */
	thing: { token: string } | { prop: string } | { door: string };
	/** A light that belongs to it (a torch's flame). */
	light?: string;
	initial: ObjectState;
	/** States the GM can put it in. */
	states: readonly ObjectState[];
	verbs: readonly Verb[];
	looks?: Partial<Record<ObjectState, Look>>;
	/** What the refusal says when it is disabled (doors). */
	disabledText?: string;
}

const any: readonly ObjectState[] = ['visible', 'interactable', 'used'];

export const OBJECTS: readonly ObjectDef[] = [
	{
		id: 'maren',
		name: 'Maren',
		kind: 'npc',
		thing: { token: IDS.maren },
		initial: 'interactable',
		states: ['interactable', 'visible'],
		verbs: [{ id: 'talk', label: 'Talk to Maren', from: ['interactable'] }]
	},
	{
		id: 'well',
		name: 'The old well',
		kind: 'landmark',
		thing: { prop: IDS.well },
		initial: 'interactable',
		states: ['interactable', 'visible', 'used'],
		verbs: [{ id: 'examine', label: 'Examine the well', from: ['interactable', 'used'] }]
	},
	{
		id: 'noticeboard',
		name: 'Notice board',
		kind: 'book',
		thing: { prop: IDS.noticeboard },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'read', label: 'Read the notice board', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'register',
		name: 'Parish register',
		kind: 'book',
		thing: { prop: IDS.shelf },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'read', label: 'Read the parish register', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'table',
		name: 'Inn table',
		kind: 'table',
		thing: { prop: IDS.innTable },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look over the table', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'shrine',
		name: 'Wayside shrine',
		kind: 'ritual',
		thing: { prop: IDS.shrine },
		initial: 'interactable',
		states: any,
		verbs: [{ id: 'pray', label: 'Pray at the shrine', from: ['interactable', 'used'], to: 'used' }]
	},
	{
		id: 'chest',
		name: 'Hale family chest',
		kind: 'chest',
		thing: { prop: IDS.chest },
		initial: 'closed',
		states: ['closed', 'opened', 'used', 'disabled', 'destroyed'],
		verbs: [
			{ id: 'open', label: 'Open the chest', from: ['closed'], to: 'opened' },
			{ id: 'search', label: 'Search the chest', from: ['opened', 'used'], to: 'used' }
		],
		looks: {
			opened: { assetId: 'chest-open' },
			used: { assetId: 'chest-open' },
			destroyed: { assetId: 'rubble' }
		},
		disabledText: 'The chest is locked.'
	},
	{
		id: 'rug',
		name: 'Hale house rug',
		kind: 'container',
		thing: { prop: IDS.rug },
		initial: 'interactable',
		states: ['interactable', 'moved'],
		verbs: [{ id: 'lift', label: 'Lift the rug', from: ['interactable'], to: 'moved' }],
		looks: { moved: { offset: { x: 2, y: 0 } } }
	},
	{
		id: 'hatch',
		name: 'Loose floorboard',
		kind: 'secret',
		thing: { prop: IDS.hatch },
		initial: 'hidden',
		states: ['hidden', 'closed', 'opened', 'used'],
		verbs: [
			{ id: 'open', label: 'Pry up the floorboard', from: ['closed'], to: 'opened' },
			{ id: 'search', label: 'Reach into the gap', from: ['opened', 'used'], to: 'used' }
		],
		looks: { opened: { assetId: 'hatch-open' }, used: { assetId: 'hatch-open' } }
	},
	{
		id: 'crate',
		name: 'Old crate',
		kind: 'container',
		thing: { prop: IDS.crate },
		initial: 'interactable',
		states: ['interactable', 'destroyed'],
		verbs: [
			{ id: 'break', label: 'Break open the crate', from: ['interactable'], to: 'destroyed' }
		],
		looks: { destroyed: { assetId: 'rubble' } }
	},
	{
		id: 'brazier',
		name: 'Brazier',
		kind: 'torch',
		thing: { prop: IDS.brazier },
		light: IDS.brazierLight,
		initial: 'unlit',
		states: ['unlit', 'lit', 'disabled'],
		verbs: [
			{ id: 'light', label: 'Light the brazier', from: ['unlit'], to: 'lit' },
			{ id: 'extinguish', label: 'Put out the brazier', from: ['lit'], to: 'unlit' }
		],
		looks: { lit: { lit: true }, unlit: { lit: false }, disabled: { lit: false } }
	},
	{
		id: 'remains',
		name: 'The Hound’s remains',
		kind: 'corpse',
		thing: { prop: IDS.remains },
		initial: 'hidden',
		states: ['hidden', 'interactable', 'used'],
		verbs: [
			{ id: 'search', label: 'Sift through the ashes', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'inn-door',
		name: 'Tolling Rest door',
		kind: 'door',
		thing: { door: IDS.innDoor },
		initial: 'closed',
		states: ['closed', 'opened', 'disabled'],
		verbs: [],
		disabledText: 'The door is barred from inside.'
	},
	{
		id: 'hale-door',
		name: 'Hale house door',
		kind: 'door',
		thing: { door: IDS.haleDoor },
		initial: 'closed',
		states: ['closed', 'opened', 'disabled'],
		verbs: [],
		disabledText: 'The door is locked.'
	},
	{
		id: 'gate',
		name: 'North gate',
		kind: 'door',
		thing: { door: IDS.gate },
		initial: 'disabled',
		states: ['disabled', 'closed', 'opened'],
		verbs: [],
		disabledText: 'The gate is chained shut.'
	}
];

export function objectDef(id: string): ObjectDef | undefined {
	return OBJECTS.find((o) => o.id === id);
}

export function objectForDoor(doorId: string): ObjectDef | undefined {
	return OBJECTS.find((o) => 'door' in o.thing && o.thing.door === doorId);
}

/** The prop a world object is, if it is a prop. */
export function propIdOf(def: ObjectDef): string | null {
	return 'prop' in def.thing ? def.thing.prop : null;
}

export function initialStates(): Map<string, ObjectState> {
	return new Map(OBJECTS.map((o) => [o.id, o.initial]));
}

/** Where each moved prop started, so a look's offset is always from the scene position. */
export type Origins = Map<string, { pos: GridPos; assetId: AssetId }>;

/** Remembers each object prop's scene position and asset, before any look changes them. */
export function recordOrigins(room: Room): Origins {
	const origins: Origins = new Map();
	for (const def of OBJECTS) {
		const id = propIdOf(def);
		const prop = id ? room.props.get(id) : undefined;
		if (prop) origins.set(def.id, { pos: { ...prop.pos }, assetId: prop.assetId });
	}
	return origins;
}

/** Makes the table show an object's state: its prop's asset and place, its door, its light. */
export function applyLook(room: Room, def: ObjectDef, state: ObjectState, origins: Origins): void {
	const look = def.looks?.[state] ?? {};
	const propId = propIdOf(def);
	const prop = propId ? room.props.get(propId) : undefined;
	const origin = origins.get(def.id);
	if (prop && origin) {
		prop.assetId = look.assetId ?? origin.assetId;
		const offset = look.offset ?? { x: 0, y: 0 };
		prop.pos = { x: origin.pos.x + offset.x, y: origin.pos.y + offset.y };
	}
	if ('door' in def.thing) {
		const door = room.objects.get(def.thing.door);
		if (door?.kind === 'door') door.open = state === 'opened';
	}
	if (def.light) {
		const light = room.lights.get(def.light);
		if (light && look.lit !== undefined) light.on = look.lit;
	}
}
