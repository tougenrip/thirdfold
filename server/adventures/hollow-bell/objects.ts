// World objects in The Hollow Bell: the things a character can walk up to
// and use at each location, what state each is in, and how each state looks
// on the table. What each verb does in the story is in verbs.ts. Object states are kept after the party moves on, so the story
// remembers every door opened and everything used.
//
// A state's look is ordinary scene data (a prop's asset or position, a door
// opening, a light switching on), so every client sees the change through the
// normal view sync, and hidden objects are filtered out of players' views
// like anything else they can't see.

import type { ObjectState } from '../../../src/lib/adventure/adventure';
import type { ObjectDef } from '../../adventure/define';
import { IDS } from './bellweather';
import { TEXT } from './content';
import { CLEFT_EDGE, HOLLOW_IDS } from './hollow';
import { MONASTERY_IDS, SECRET_EDGE } from './monastery';
import { NPC_IDS, NPCS } from './npcs';

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
		// The first thing a new player finds: it glows in the road, so they walk up and look.
		id: 'charm',
		name: 'Something glinting in the road',
		kind: 'item',
		location: 'bellweather',
		thing: { prop: IDS.charm },
		initial: 'interactable',
		states: ['interactable', 'hidden'],
		firstFind: 'tinbell',
		noticed: TEXT.glint,
		verbs: [{ id: 'examine', label: 'Look closer at the glint', from: ['interactable'] }]
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
