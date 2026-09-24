// The people of The Hollow Bell: who they are, where they live, the states
// they move through, where they go as the story changes (their behavior), and
// what they say. Server-side only, like all story text.
//
// Talking to someone says the first of their lines whose conditions hold
// (lines marked `once` are skipped after they have been said). A line can
// hand the party a clue, change the speaker's state, raise a story event or
// tend the party's wounds, so talking feeds the adventure state like any
// other interaction. Reactions are short lines people call out when the
// party does something near them, or when something happens in the story.

import type { LocationId, ObjectState } from '../../src/lib/adventure/adventure';
import type { GridPos } from '../../src/lib/game/grid';
import type { SavedToken } from '../../src/lib/game/scene-file';
import { TEXT, type ClueId } from './content';
import type { DecisionId, EventId } from './story';

export type NpcId =
	| 'maren'
	| 'bertram'
	| 'edda'
	| 'pell'
	| 'rosa'
	| 'aldric'
	| 'wynn'
	| 'nell'
	| 'gregor'
	| 'crane'
	| 'oswin'
	| 'tobin';

/** When a line may be said. Every listed condition must hold. */
export interface When {
	/** The speaker is in one of these states. */
	state?: readonly string[];
	/** The party has found all of these clues. */
	clues?: readonly ClueId[];
	/** All of these have happened. */
	events?: readonly EventId[];
	/** None of these has happened. */
	not?: readonly EventId[];
	/** This choice is waiting on the party. */
	pending?: DecisionId;
	/** World objects are in one of these states. */
	objects?: Readonly<Record<string, readonly ObjectState[]>>;
}

export interface Line {
	id: string;
	text: string;
	if?: When;
	/** Said only once. */
	once?: boolean;
	/** Told by the narrator rather than spoken. */
	narrated?: boolean;
	clue?: ClueId;
	/** The speaker's new state. */
	becomes?: string;
	event?: EventId;
	/** Hit points restored to every standing character. */
	heals?: number;
}

/** Where someone stands: normally, while the Hound is loose in the village, and after it is dead. */
export interface Places {
	calm: GridPos;
	hiding?: GridPos;
	after?: GridPos;
}

export interface NpcDef {
	id: NpcId;
	name: string;
	/** Who they are, for the GM. */
	role: string;
	/** Speaker label in the log. */
	speaker: string;
	token: string;
	color: string;
	/** The figure they are drawn as (a model in assets/models/npc), tinted with `color`. */
	model: string;
	location: LocationId;
	/** Where they are found, for the GM. */
	home: string;
	places: Places;
	/** The first is where they start. */
	states: readonly string[];
	/** In order of priority: the first that applies is said. The last should always apply. */
	lines: readonly Line[];
}

export const NPCS: Record<NpcId, NpcDef> = {
	maren: {
		id: 'maren',
		model: 'villager',
		name: 'Maren',
		role: 'Innkeeper of the Tolling Rest',
		speaker: 'Maren',
		token: 'hb-maren',
		color: '#a04a2c',
		location: 'bellweather',
		home: 'The Tolling Rest',
		places: { calm: { x: 6, y: 9 } },
		states: ['worried', 'hopeful'],
		lines: [
			{
				id: 'arrival',
				text: TEXT.marenArrival,
				if: { not: ['talked_maren'] },
				event: 'talked_maren'
			},
			{ id: 'complete', text: TEXT.marenComplete, if: { events: ['left_village'] } },
			{ id: 'aftermath', text: TEXT.marenAftermath, if: { events: ['won_well'] } },
			{
				id: 'drawing',
				text: '“That’s his hand, all right. The monastery tower, and that… thing under it. He drew it on my tables too, in spilled ale. I thought it was a boy’s nightmare.”',
				if: { clues: ['drawing'] },
				once: true
			},
			{ id: 'investigate', text: TEXT.marenInvestigate }
		]
	},
	bertram: {
		id: 'bertram',
		model: 'elder',
		name: 'Old Bertram',
		role: 'The oldest man in Bellweather',
		speaker: 'Bertram',
		token: 'hb-bertram',
		color: '#7d6b58',
		location: 'bellweather',
		home: 'A corner table at the Tolling Rest',
		places: { calm: { x: 4, y: 9 } },
		states: ['drinking', 'sober'],
		lines: [
			{
				id: 'legend',
				text: '“Forty years. Always forty. When I was a lad the Bell rang, and the brothers sent three ringers down under the mountain to quiet it. Nobody ever saw those three again. Now it’s rung and there’s no brothers left to send.”',
				clue: 'legend',
				once: true
			},
			{
				id: 'after',
				text: '“So it was a hound. Thought it might be worse.” He pushes his mug away, untouched. “Go on, then. Somebody has to.”',
				if: { events: ['won_well'] },
				becomes: 'sober'
			},
			{
				id: 'again',
				text: '“I told you what I know. Three went down. None came up.” He stares into his ale.'
			}
		]
	},
	edda: {
		id: 'edda',
		model: 'villager',
		name: 'Edda Hale',
		role: 'Tobin’s mother',
		speaker: 'Edda',
		token: 'hb-edda',
		color: '#b5838d',
		location: 'bellweather',
		home: 'The Hale house',
		places: { calm: { x: 19, y: 10 } },
		states: ['grieving', 'hopeful'],
		lines: [
			{
				id: 'bread',
				text: '“You’re looking for him? Thank God.” She wipes her eyes. “Every Sunday he took a loaf up the mountain path. Said he was feeding an old monk who lives up there all alone. I thought he was making it up.”',
				clue: 'bread',
				becomes: 'hopeful',
				once: true
			},
			{
				id: 'glove',
				text: '“His glove. He had that on when he left.” She presses it to her face. “Bring him home. Please.”',
				if: { clues: ['rope'] },
				once: true
			},
			{
				id: 'after',
				text: '“The gate’s open? Then he’s up there. Go. I’ll keep his supper warm.”',
				if: { events: ['won_well'] }
			},
			{ id: 'again', text: '“He’s a good boy. He only ever wanted to know things.”' }
		]
	},
	pell: {
		id: 'pell',
		model: 'child',
		name: 'Pell',
		role: 'Tobin’s best friend, ten years old',
		speaker: 'Pell',
		token: 'hb-pell',
		color: '#e0a458',
		location: 'bellweather',
		home: 'By the well in the square',
		places: { calm: { x: 9, y: 13 }, hiding: { x: 7, y: 12 }, after: { x: 10, y: 15 } },
		states: ['scared', 'talking'],
		lines: [
			{
				id: 'secret',
				text: '“You found his drawing.” Pell’s lip wobbles. “He made me promise not to tell. He said the Bell was lonely down there, and he was going to make it sing one more time, so it wouldn’t be sad. Then he went up the path with a coil of rope.”',
				if: { clues: ['drawing'] },
				clue: 'promise',
				becomes: 'talking',
				once: true
			},
			{
				id: 'brave',
				text: '“You killed it! You really did!” Pell swallows. “He said the Bell was lonely. He said he’d make it sing. I promised not to tell, but… that’s what he said.”',
				if: { events: ['won_well'], state: ['scared'] },
				clue: 'promise',
				becomes: 'talking',
				once: true
			},
			{
				id: 'mum',
				text: 'Pell shakes his head hard and looks at his shoes. “I’m not supposed to say. I promised.”',
				if: { state: ['scared'] }
			},
			{ id: 'again', text: '“Find him. Please. He’s my best friend.”' }
		]
	},
	rosa: {
		id: 'rosa',
		model: 'villager',
		name: 'Rosa',
		role: 'Herbalist with a stall in the square',
		speaker: 'Rosa',
		token: 'hb-rosa',
		color: '#6a994e',
		location: 'bellweather',
		home: 'Her stall in the square',
		places: { calm: { x: 16, y: 13 }, hiding: { x: 3, y: 12 } },
		states: ['wary', 'grateful'],
		lines: [
			{
				id: 'salve',
				text: '“You fought that thing for us.” Rosa presses a jar of bitter-smelling salve into your hands and doesn’t take no for an answer. Cuts close, bruises fade.',
				if: { events: ['won_well'] },
				becomes: 'grateful',
				heals: 8,
				once: true
			},
			{
				id: 'gossip',
				text: '“Strangers, on a night like this? If it’s old stories you want, ask Father Wynn at the chapel, or Bertram, if he’s still sober enough to talk. Nell knows who’s buried where.”',
				once: true
			},
			{
				id: 'again',
				text: '“Chamomile for sleep, yarrow for cuts. Nothing for bells, I’m afraid.”'
			}
		]
	},
	aldric: {
		id: 'aldric',
		model: 'watchman',
		name: 'Aldric',
		role: 'The village watchman',
		speaker: 'Aldric',
		token: 'hb-aldric',
		color: '#5c6f7b',
		location: 'bellweather',
		home: 'The north gate',
		places: { calm: { x: 12, y: 6 }, after: { x: 15, y: 6 } },
		states: ['on-watch', 'relieved'],
		lines: [
			{
				id: 'tracks',
				text: '“Keep your voice down.” Aldric leans on his spear. “Found tracks by the well at dawn. Long toes, like a hound’s, but they walk round and round the well and go nowhere. As if the thing went back down.”',
				clue: 'tracks',
				once: true
			},
			{
				id: 'after',
				text: '“That thing climbed out of the well, just like the tracks said. Maren’s cut the chain. The path’s yours.”',
				if: { events: ['won_well'] },
				becomes: 'relieved'
			},
			{
				id: 'gate',
				text: '“Gate stays chained till Maren says otherwise. Nobody goes up the mountain at night.”'
			}
		]
	},
	wynn: {
		id: 'wynn',
		model: 'priest',
		name: 'Father Wynn',
		role: 'Priest of the chapel of Saint Agna',
		speaker: 'Father Wynn',
		token: 'hb-wynn',
		color: '#3d405b',
		location: 'bellweather',
		home: 'The chapel of Saint Agna',
		places: { calm: { x: 28, y: 8 } },
		states: ['wary', 'helpful'],
		lines: [
			{
				id: 'saint',
				text: '“You’ve heard it too, then.” Wynn looks up at the window, where Saint Agna holds a small bell to her heart. “The brothers carved her all over the monastery. The old books say she holds the key to the ringers’ way in her hands. I always took it for poetry.”',
				clue: 'saint',
				becomes: 'helpful',
				once: true
			},
			{
				id: 'clapper',
				text: 'Wynn turns the little iron clapper over and goes pale. “This is from the brothers’ hand bells. They rang them to walk the ringers down. Where did you find it? No, don’t tell me.”',
				if: { clues: ['clapper'] },
				once: true
			},
			{
				id: 'again',
				text: '“Saint Agna watch over you. Whatever the Bell wants, don’t give it.”'
			}
		]
	},
	nell: {
		id: 'nell',
		model: 'gravedigger',
		name: 'Nell',
		role: 'Gravedigger',
		speaker: 'Nell',
		token: 'hb-nell',
		color: '#6c584c',
		location: 'bellweather',
		home: 'The churchyard',
		places: { calm: { x: 33, y: 21 } },
		states: ['digging', 'uneasy'],
		lines: [
			{
				id: 'graves',
				text: '“See those three with the bells cut in? The ringers. Folk put up stones for them, but there’s nobody under them. I know. I’ve dug round there.” She spits. “Never came back to be buried.”',
				clue: 'empty-graves',
				becomes: 'uneasy',
				once: true
			},
			{
				id: 'legend',
				text: '“Bertram told you, did he? Forty years and three ringers. Well, now you know why I won’t dig near those stones.”',
				if: { clues: ['legend'] },
				once: true
			},
			{ id: 'again', text: '“Digging one for nobody tonight, hopefully.”' }
		]
	},
	gregor: {
		id: 'gregor',
		model: 'smith',
		name: 'Gregor',
		role: 'Blacksmith',
		speaker: 'Gregor',
		token: 'hb-gregor',
		color: '#9c6644',
		location: 'bellweather',
		home: 'The smithy',
		places: { calm: { x: 17, y: 22 } },
		states: ['working', 'angry'],
		lines: [
			{
				id: 'crate',
				text: '“That was my crate you smashed in the square.” Gregor glares, then sighs. “Fine. Strange night.”',
				if: { objects: { crate: ['destroyed'] }, state: ['working'] },
				becomes: 'angry',
				once: true
			},
			{
				id: 'shears',
				text: '“The Hale boy? He borrowed my rope shears a week back, and a coil of new hemp rope. Said it was for a swing. Never brought the shears back.”',
				clue: 'shears',
				once: true
			},
			{
				id: 'again',
				text: 'Gregor bangs a horseshoe flat. “I made the chain on that gate. Stronger than whatever’s up there, I hope.”'
			}
		]
	},
	crane: {
		id: 'crane',
		model: 'villager',
		name: 'Widow Crane',
		role: 'Weaver, who watches from her window',
		speaker: 'Widow Crane',
		token: 'hb-crane',
		color: '#8d99ae',
		location: 'bellweather',
		home: 'Her cottage on the south road',
		places: { calm: { x: 6, y: 21 } },
		states: ['watching', 'frightened'],
		lines: [
			{
				id: 'lights',
				text: '“I don’t sleep. I watch.” She taps the window. “Last night a little light went up the mountain path, all alone. Then, at the monastery, a great many lights came on. They moved like eyes, blinking.”',
				clue: 'lights',
				becomes: 'frightened',
				once: true
			},
			{
				id: 'shroud',
				text: '“Don’t mind the loom. Everyone in Bellweather gets a shroud from me in the end. I started one tonight. I don’t know who for yet.”',
				once: true
			},
			{ id: 'again', text: '“The lights are still up there. Watching back.”' }
		]
	},
	oswin: {
		id: 'oswin',
		model: 'monk',
		name: 'Brother Oswin',
		role: 'The last brother of the monastery',
		speaker: 'Oswin',
		token: 'mn-oswin',
		color: '#6b5b3e',
		location: 'monastery',
		home: 'The gatehouse',
		places: { calm: { x: 3, y: 15 } },
		states: ['wary', 'trusting'],
		lines: [
			{ id: 'first', text: TEXT.oswinFirst, if: { not: ['talked_oswin'] }, event: 'talked_oswin' },
			{ id: 'waiting', text: TEXT.oswinWaiting, if: { pending: 'promise' } },
			{
				id: 'bread',
				text: '“Bread.” Oswin’s hands shake. “Every Sunday. He was the only one who ever came up. I told him about the Bell because he asked, and nobody had asked in forty years.”',
				if: { clues: ['bread'], events: ['promised'] },
				once: true
			},
			{ id: 'after', text: TEXT.oswinAfter }
		]
	},
	tobin: {
		id: 'tobin',
		model: 'child',
		name: 'Tobin Hale',
		role: 'The missing boy',
		speaker: 'Tobin',
		token: 'ho-tobin',
		color: '#d9a441',
		location: 'hollow',
		home: 'Under the Bell',
		// TOBIN_AT in hollow.ts, beneath the Bell.
		places: { calm: { x: 24, y: 11 } },
		states: ['missing', 'entranced', 'safe'],
		lines: [
			{ id: 'found', text: TEXT.tobinFound, if: { not: ['found_tobin'] }, event: 'found_tobin' },
			{
				id: 'pell',
				text: 'You tell him Pell is waiting for him. Something moves behind Tobin’s eyes. “Pell,” he says, in his own voice, and grips your hand.',
				if: { clues: ['promise'] },
				narrated: true,
				once: true
			},
			{ id: 'after', text: TEXT.tobinAfter, narrated: true }
		]
	}
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function isNpcId(id: string): id is NpcId {
	return (NPC_IDS as string[]).includes(id);
}

/** The people who start at a location, as scene tokens. */
export function npcTokens(location: LocationId): SavedToken[] {
	return NPC_IDS.filter((id) => NPCS[id].location === location).map((id) => {
		const npc = NPCS[id];
		return {
			id: npc.token,
			name: npc.name,
			color: npc.color,
			pos: { ...npc.places.calm },
			vision: 6,
			light: 0,
			model: npc.model,
			owner: null
		};
	});
}

/** A short line someone calls out when something happens near them, once. */
export interface Reaction {
	id: string;
	npc: NpcId;
	/** `object:verb` for an interaction, or `event:<id>` for a story event. */
	on: string;
	text: string;
	/** For interactions: only if the speaker stands within this many cells of the character. */
	within?: number;
}

export const REACTIONS: readonly Reaction[] = [
	{
		id: 'rosa-crate',
		npc: 'rosa',
		on: 'crate:break',
		text: '“Oi! That’s Gregor’s crate!”',
		within: 10
	},
	{
		id: 'edda-chest',
		npc: 'edda',
		on: 'chest:search',
		text: '“That’s his glove. He was wearing it the night he left.”',
		within: 6
	},
	{
		id: 'bertram-register',
		npc: 'bertram',
		on: 'register:read',
		text: '“Forty years, near enough, since that last page was written.”',
		within: 6
	},
	{
		id: 'aldric-brazier',
		npc: 'aldric',
		on: 'brazier:light',
		text: '“Good. Keep it burning. I don’t like how dark it is up there.”',
		within: 6
	},
	{
		id: 'nell-ringers',
		npc: 'nell',
		on: 'ringers:examine',
		text: '“Careful where you stand. Nobody’s in those, but still.”',
		within: 8
	},
	{
		id: 'wynn-rope',
		npc: 'wynn',
		on: 'chapel-rope:examine',
		text: '“We gave our bell to the brothers when I was a boy. They said the monastery needed it more.”',
		within: 8
	},
	{
		id: 'rosa-hound',
		npc: 'rosa',
		on: 'event:well_clue',
		text: '“Saints! Something’s coming out of the well!”'
	},
	{ id: 'pell-hound', npc: 'pell', on: 'event:well_clue', text: '“Mum! MUM!”' },
	{
		id: 'aldric-won',
		npc: 'aldric',
		on: 'event:won_well',
		text: '“Is it dead? It’s dead. Saints, it’s dead.”'
	}
];

/** Which of an NPC's places applies now, given where the village's fight stands. */
export function placeFor(npc: NpcDef, phase: 'calm' | 'hiding' | 'after'): GridPos {
	if (phase === 'hiding') return npc.places.hiding ?? npc.places.calm;
	if (phase === 'after') return npc.places.after ?? npc.places.calm;
	return npc.places.calm;
}
