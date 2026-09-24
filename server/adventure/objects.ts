// World objects in The Hollow Bell: the things a character can walk up to
// and use at each location, what state each is in, and how each state looks
// on the table. The data lives here; the story each verb advances lives in
// engine.ts. Object states are kept after the party moves on, so the story
// remembers every door opened and everything used.
//
// A state's look is ordinary scene data (a prop's asset or position, a door
// opening, a light switching on), so every client sees the change through the
// normal view sync, and hidden objects are filtered out of players' views
// like anything else they can't see.

import type {
	Check,
	InvestigationAction,
	LocationId,
	ObjectKind,
	ObjectState,
	Physical
} from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import type { Sound } from '../../src/lib/game/motion';
import type { AssetId, Rotation } from '../../src/lib/game/props';
import type { Room } from '../rooms';
import { IDS } from './bellweather';
import { CLEFT_EDGE, HOLLOW_IDS } from './hollow';
import { MONASTERY_IDS, SECRET_EDGE } from './monastery';
import { NPC_IDS, NPCS } from './npcs';

export interface Verb {
	id: string;
	label: string;
	/** States it can be done in. */
	from: readonly ObjectState[];
	/** The state it leaves the object in; unchanged if omitted. */
	to?: ObjectState;
	/** What kind of investigating it is; see `actionOfVerb` for the default. */
	action?: InvestigationAction;
	/** A check the character must pass first; one try per character. */
	check?: Check;
	/** What it physically does (see `Physical`); a change of state if omitted. */
	physical?: Physical;
	/** A carried item (world object id) the character must be holding. */
	needs?: string;
	/** The sound it makes, if not the usual one for what it does. */
	sound?: Sound;
	/** It can be done in a fight too, on the character's turn, as its action. */
	inFight?: true;
}

const ACTION_BY_VERB: Record<string, InvestigationAction> = {
	examine: 'examine',
	read: 'inspect',
	search: 'search'
};

/** How a verb counts as investigating: examining, reading (inspecting), searching, or anything else. */
export function actionOfVerb(verb: Verb): InvestigationAction {
	return verb.action ?? ACTION_BY_VERB[verb.id] ?? 'interact';
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
	location: LocationId;
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
	/** A secret door's edge: while hidden it is a plain wall (`<door id>-sealed`) there. */
	secret?: { a: GridPos; b: GridPos };
	/** An item: it can be picked up, carried from table to table, and put down anywhere. */
	carry?: true;
	/**
	 * Only there while this light (a world object) is lit: carvings that show in
	 * torchlight, a cleft the flame picks out of the rock. While the light is out
	 * the object counts as hidden, whatever state it is in (see `shownState`).
	 */
	litBy?: string;
}

const any: readonly ObjectState[] = ['visible', 'interactable', 'used'];

export const OBJECTS: readonly ObjectDef[] = [
	{
		id: 'well',
		name: 'The old well',
		kind: 'landmark',
		location: 'bellweather',
		thing: { prop: IDS.well },
		initial: 'interactable',
		states: ['interactable', 'visible', 'used'],
		verbs: [{ id: 'examine', label: 'Examine the well', from: ['interactable', 'used'] }]
	},
	{
		id: 'noticeboard',
		name: 'Notice board',
		kind: 'book',
		location: 'bellweather',
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
		location: 'bellweather',
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
		location: 'bellweather',
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
		location: 'bellweather',
		thing: { prop: IDS.shrine },
		initial: 'interactable',
		states: any,
		verbs: [{ id: 'pray', label: 'Pray at the shrine', from: ['interactable', 'used'], to: 'used' }]
	},
	{
		id: 'chest',
		name: 'Hale family chest',
		kind: 'chest',
		location: 'bellweather',
		thing: { prop: IDS.chest },
		initial: 'closed',
		states: ['closed', 'opened', 'used', 'disabled', 'destroyed'],
		verbs: [
			{ id: 'open', label: 'Open the chest', from: ['closed'], to: 'opened', physical: 'open' },
			{
				id: 'search',
				label: 'Search the chest',
				from: ['opened', 'used'],
				to: 'used',
				check: { stat: 'wits', dc: 8 }
			},
			{ id: 'close', label: 'Close the chest', from: ['opened'], to: 'closed', physical: 'close' }
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
		location: 'bellweather',
		thing: { prop: IDS.rug },
		initial: 'interactable',
		states: ['interactable', 'moved'],
		verbs: [
			{ id: 'lift', label: 'Lift the rug', from: ['interactable'], to: 'moved', physical: 'move' }
		],
		looks: { moved: { offset: { x: 2, y: 0 } } }
	},
	{
		id: 'hatch',
		name: 'Loose floorboard',
		kind: 'secret',
		location: 'bellweather',
		thing: { prop: IDS.hatch },
		initial: 'hidden',
		states: ['hidden', 'closed', 'opened', 'used'],
		verbs: [
			{
				id: 'open',
				label: 'Pry up the floorboard',
				from: ['closed'],
				to: 'opened',
				physical: 'open'
			},
			{ id: 'search', label: 'Reach into the gap', from: ['opened', 'used'], to: 'used' }
		],
		looks: { opened: { assetId: 'hatch-open' }, used: { assetId: 'hatch-open' } }
	},
	{
		id: 'crate',
		name: 'Old crate',
		kind: 'container',
		location: 'bellweather',
		thing: { prop: IDS.crate },
		initial: 'interactable',
		states: ['interactable', 'destroyed'],
		verbs: [
			{
				id: 'break',
				label: 'Break open the crate',
				from: ['interactable'],
				to: 'destroyed',
				physical: 'destroy'
			}
		],
		looks: { destroyed: { assetId: 'rubble' } }
	},
	{
		id: 'brazier',
		name: 'Brazier',
		kind: 'torch',
		location: 'bellweather',
		thing: { prop: IDS.brazier },
		light: IDS.brazierLight,
		initial: 'unlit',
		states: ['unlit', 'lit', 'disabled'],
		verbs: [
			{
				id: 'light',
				label: 'Light the brazier',
				from: ['unlit'],
				to: 'lit',
				physical: 'activate',
				inFight: true
			},
			{ id: 'extinguish', label: 'Put out the brazier', from: ['lit'], to: 'unlit', inFight: true }
		],
		looks: { lit: { lit: true }, unlit: { lit: false }, disabled: { lit: false } }
	},
	{
		id: 'remains',
		name: 'The Hound’s remains',
		kind: 'corpse',
		location: 'bellweather',
		thing: { prop: IDS.remains },
		initial: 'hidden',
		states: ['hidden', 'interactable', 'used'],
		verbs: [
			{
				id: 'search',
				label: 'Sift through the ashes',
				from: ['interactable', 'used'],
				to: 'used',
				check: { stat: 'wits', dc: 10 }
			}
		]
	},
	{
		id: 'inn-door',
		name: 'Tolling Rest door',
		kind: 'door',
		location: 'bellweather',
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
		location: 'bellweather',
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
		location: 'bellweather',
		thing: { door: IDS.gate },
		initial: 'disabled',
		states: ['disabled', 'closed', 'opened'],
		verbs: [],
		disabledText: 'The gate is chained shut.'
	},
	{
		id: 'chapel-rope',
		name: 'Chapel bell rope',
		kind: 'landmark',
		location: 'bellweather',
		thing: { prop: IDS.chapelRope },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look up the bell tower', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'chapel-agna',
		name: 'Saint Agna window',
		kind: 'ritual',
		location: 'bellweather',
		thing: { prop: IDS.chapelAgna },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look at Saint Agna', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'ringers',
		name: 'The ringers’ graves',
		kind: 'landmark',
		location: 'bellweather',
		thing: { prop: IDS.ringers },
		initial: 'interactable',
		states: any,
		verbs: [
			{
				id: 'examine',
				label: 'Read the ringers’ graves',
				from: ['interactable', 'used'],
				to: 'used'
			}
		]
	},
	{
		id: 'anvil',
		name: 'Gregor’s anvil',
		kind: 'landmark',
		location: 'bellweather',
		thing: { prop: IDS.anvil },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look over the anvil', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'loom',
		name: 'Widow Crane’s loom',
		kind: 'table',
		location: 'bellweather',
		thing: { prop: IDS.loom },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look at the loom', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'stall',
		name: 'Rosa’s stall',
		kind: 'table',
		location: 'bellweather',
		thing: { prop: IDS.stall },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look over the stall', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'waystone',
		name: 'Waystone',
		kind: 'book',
		location: 'bellweather',
		thing: { prop: IDS.waystone },
		initial: 'interactable',
		states: any,
		verbs: [{ id: 'read', label: 'Read the waystone', from: ['interactable', 'used'], to: 'used' }]
	},
	{
		id: 'chapel-door',
		name: 'Chapel door',
		kind: 'door',
		location: 'bellweather',
		thing: { door: IDS.chapelDoor },
		initial: 'closed',
		states: ['closed', 'opened', 'disabled'],
		verbs: [],
		disabledText: 'The chapel door is barred.'
	},
	{
		id: 'crane-door',
		name: 'Widow Crane’s door',
		kind: 'door',
		location: 'bellweather',
		thing: { door: IDS.craneDoor },
		initial: 'closed',
		states: ['closed', 'opened', 'disabled'],
		verbs: [],
		disabledText: 'The door is locked.'
	},
	// The monastery
	{
		id: 'graves',
		name: 'The brothers’ graves',
		kind: 'landmark',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.grave },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'read', label: 'Read the gravestones', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'altar',
		name: 'The altar',
		kind: 'book',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.altar },
		initial: 'interactable',
		states: any,
		verbs: [
			{
				id: 'read',
				label: 'Read the chronicle on the altar',
				from: ['interactable', 'used'],
				to: 'used'
			}
		]
	},
	{
		id: 'agna',
		name: 'Statue of Saint Agna',
		kind: 'ritual',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.agna },
		initial: 'interactable',
		states: ['interactable', 'used'],
		verbs: [
			{
				id: 'turn',
				label: 'Turn the bell in her hands',
				from: ['interactable'],
				to: 'used',
				physical: 'rotate'
			}
		]
	},
	{
		id: 'rope',
		name: 'The bell rope',
		kind: 'landmark',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.rope },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Examine the bell rope', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'grate',
		name: 'Iron grate',
		kind: 'secret',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.grate },
		initial: 'disabled',
		states: ['disabled', 'opened'],
		verbs: [],
		looks: { opened: { assetId: 'stairs' } },
		disabledText: 'The grate won’t lift by hand. Its chain runs up into the wall.'
	},
	{
		id: 'gatehouse-door',
		name: 'Gatehouse door',
		kind: 'door',
		location: 'monastery',
		thing: { door: MONASTERY_IDS.gatehouseDoor },
		initial: 'closed',
		states: ['closed', 'opened', 'disabled'],
		verbs: [],
		disabledText: 'The door is barred.'
	},
	{
		id: 'great-door',
		name: 'The great doors',
		kind: 'door',
		location: 'monastery',
		thing: { door: MONASTERY_IDS.greatDoor },
		initial: 'disabled',
		states: ['disabled', 'closed', 'opened'],
		verbs: [],
		disabledText: 'The great doors are barred from within.'
	},
	{
		id: 'side-door',
		name: 'The ringers’ door',
		kind: 'door',
		location: 'monastery',
		thing: { door: MONASTERY_IDS.sideDoor },
		initial: 'disabled',
		states: ['disabled', 'closed', 'opened'],
		verbs: [],
		disabledText: 'The ringers’ door is locked. The lock is old, but sound.'
	},
	{
		id: 'secret-door',
		name: 'The hidden door',
		kind: 'secret',
		location: 'monastery',
		thing: { door: MONASTERY_IDS.secretDoor },
		initial: 'hidden',
		states: ['hidden', 'closed', 'opened'],
		verbs: [],
		secret: SECRET_EDGE
	},
	{
		id: 'chamber-torch',
		name: 'Torch stand',
		kind: 'torch',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.torch },
		light: MONASTERY_IDS.torchLight,
		initial: 'unlit',
		states: ['unlit', 'lit'],
		verbs: [
			{
				id: 'light',
				label: 'Light the torch',
				from: ['unlit'],
				to: 'lit',
				physical: 'activate',
				inFight: true
			},
			{ id: 'extinguish', label: 'Put out the torch', from: ['lit'], to: 'unlit', inFight: true }
		],
		looks: { lit: { lit: true }, unlit: { lit: false } }
	},
	{
		// Cut too shallow to see by the candle: only a flame held close picks them out.
		id: 'carvings',
		name: 'The ringers’ carvings',
		kind: 'book',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.carvings },
		initial: 'interactable',
		states: any,
		litBy: 'chamber-torch',
		verbs: [{ id: 'read', label: 'Read the carvings', from: ['interactable', 'used'], to: 'used' }]
	},
	{
		id: 'ledgers',
		name: 'The brothers’ ledgers',
		kind: 'book',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.ledgers },
		initial: 'interactable',
		states: any,
		verbs: [{ id: 'read', label: 'Read the ledgers', from: ['interactable', 'used'], to: 'used' }]
	},
	{
		id: 'belfry-bell',
		name: 'The tower bell',
		kind: 'landmark',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.bell },
		initial: 'interactable',
		states: any,
		verbs: [
			{
				id: 'search',
				label: 'Look inside the bell',
				from: ['interactable', 'used'],
				to: 'used',
				check: { stat: 'wits', dc: 9 }
			}
		]
	},
	{
		id: 'lever',
		name: 'The lever',
		kind: 'mechanism',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.lever },
		initial: 'interactable',
		states: ['interactable', 'used', 'disabled'],
		verbs: [
			{
				id: 'pull',
				label: 'Pull the lever',
				from: ['interactable'],
				to: 'used',
				physical: 'trigger'
			}
		],
		looks: { used: { assetId: 'lever-down' } },
		disabledText: 'The lever is rusted fast.'
	},
	{
		id: 'chamber-crate',
		name: 'Heavy crate',
		kind: 'container',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.crate },
		initial: 'interactable',
		states: ['interactable', 'moved'],
		verbs: [
			{
				id: 'push',
				label: 'Push the crate',
				from: ['interactable', 'moved'],
				to: 'moved',
				physical: 'push'
			},
			{
				id: 'pull',
				label: 'Drag the crate',
				from: ['interactable', 'moved'],
				to: 'moved',
				physical: 'pull'
			}
		]
	},
	{
		id: 'handbell',
		name: 'Hand bell',
		kind: 'item',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.handbell },
		carry: true,
		initial: 'interactable',
		states: ['interactable', 'hidden'],
		verbs: [
			{
				id: 'take',
				label: 'Take the hand bell',
				from: ['interactable'],
				to: 'carried',
				physical: 'pick_up'
			},
			{
				id: 'ring',
				label: 'Ring the hand bell',
				from: ['carried'],
				physical: 'activate',
				sound: 'chime',
				inFight: true
			},
			{
				id: 'drop',
				label: 'Put down the hand bell',
				from: ['carried'],
				to: 'interactable',
				physical: 'drop'
			}
		]
	},
	{
		id: 'door-chains',
		name: 'Chains on the great doors',
		kind: 'landmark',
		location: 'monastery',
		thing: { prop: MONASTERY_IDS.doorChains },
		initial: 'interactable',
		states: ['interactable', 'destroyed'],
		verbs: [
			{
				id: 'break',
				label: 'Break the chains',
				from: ['interactable'],
				to: 'destroyed',
				physical: 'destroy',
				check: { stat: 'might', dc: 10 }
			}
		],
		looks: { destroyed: { assetId: 'rubble' } }
	},
	// The Hollow
	{
		id: 'bell',
		name: 'The Hollow Bell',
		kind: 'landmark',
		location: 'hollow',
		thing: { prop: HOLLOW_IDS.bell },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look at the Bell', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		// Tobin's rope: it only matters once the Bell starts ringing itself (the finale's third phase).
		id: 'bell-rope',
		name: 'The Bell’s rope',
		kind: 'mechanism',
		location: 'hollow',
		thing: { prop: HOLLOW_IDS.rope },
		initial: 'disabled',
		states: ['disabled', 'interactable', 'used'],
		verbs: [
			{
				id: 'pull',
				label: 'Pull the Bell’s rope',
				from: ['interactable'],
				sound: 'clank',
				inFight: true
			}
		],
		disabledText: 'Tobin won’t let go of the rope, and the Bell hangs still.'
	},
	{
		id: 'hollow-torch',
		name: 'The cultists’ torch',
		kind: 'torch',
		location: 'hollow',
		thing: { prop: HOLLOW_IDS.torch },
		light: HOLLOW_IDS.torchLight,
		initial: 'lit',
		states: ['lit', 'unlit'],
		verbs: [
			{ id: 'extinguish', label: 'Put out the torch', from: ['lit'], to: 'unlit', inFight: true },
			{
				id: 'light',
				label: 'Light the torch',
				from: ['unlit'],
				to: 'lit',
				physical: 'activate',
				inFight: true
			}
		],
		looks: { lit: { lit: true }, unlit: { lit: false } }
	},
	{
		// A way round to the pit, only there while the torch picks it out of the rock.
		id: 'cleft',
		name: 'A cleft in the rock',
		kind: 'secret',
		location: 'hollow',
		thing: { door: HOLLOW_IDS.cleft },
		initial: 'opened',
		states: ['opened', 'closed', 'hidden'],
		verbs: [],
		secret: CLEFT_EDGE,
		litBy: 'hollow-torch'
	},
	{
		id: 'pit',
		name: 'The pit',
		kind: 'landmark',
		location: 'hollow',
		thing: { prop: HOLLOW_IDS.pit },
		initial: 'interactable',
		states: any,
		verbs: [
			{ id: 'examine', label: 'Look down into the pit', from: ['interactable', 'used'], to: 'used' }
		]
	},
	{
		id: 'bones',
		name: 'Old bones',
		kind: 'corpse',
		location: 'hollow',
		thing: { prop: HOLLOW_IDS.bones },
		initial: 'interactable',
		states: any,
		verbs: [
			{
				id: 'search',
				label: 'Search the bones',
				from: ['interactable', 'used'],
				to: 'used',
				check: { stat: 'wits', dc: 12 }
			}
		]
	},
	// Everyone the party can talk to (see npcs.ts).
	...NPC_IDS.map((id): ObjectDef => ({
		id,
		name: NPCS[id].name,
		kind: 'npc',
		location: NPCS[id].location,
		thing: { token: NPCS[id].token },
		initial: 'interactable',
		states: ['interactable', 'visible'],
		verbs: [{ id: 'talk', label: `Talk to ${NPCS[id].name}`, from: ['interactable'] }]
	}))
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
export type Origins = Map<string, Origin>;

/** Where an object's prop stands and how it looks before its state's look; moved by pushing, pulling, turning and dropping. */
export interface Origin {
	pos: GridPos;
	assetId: AssetId;
	rotation: Rotation;
}

/** The world objects at a location. */
export function objectsAt(location: LocationId): ObjectDef[] {
	return OBJECTS.filter((o) => o.location === location);
}

/** Remembers each object prop's scene position and asset, before any look changes them. */
export function recordOrigins(room: Room): Origins {
	const origins: Origins = new Map();
	for (const def of OBJECTS) {
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
