// The words of The Hollow Bell. Server-side only, so what the party hasn't
// discovered yet never reaches a client: dialogue, clues and narration go out
// as log entries and adventure state once they happen.

import type { EvidenceKind } from '../../src/lib/adventure/adventure';
import type { Attack } from '../../src/lib/adventure/characters';
import type { EndingId, EventId } from './story';

/** A piece of evidence the party can come by. */
export interface ClueDef {
	id: string;
	title: string;
	text: string;
	kind: EvidenceKind;
	/** The story event it raises once the whole party knows it (it unlocks objectives). */
	unlocks?: EventId;
}

export const TITLE = 'The Hollow Bell';

export const CLUES = {
	notice: {
		id: 'notice',
		kind: 'document',
		title: 'A missing boy',
		text: 'MISSING: Tobin Hale, twelve, apprentice to the old bell-ringer. Last seen by the well in the square at dusk.'
	},
	rope: {
		id: 'rope',
		kind: 'object',
		title: 'A cut bell rope',
		text: "In the Hale house chest: a length of bell rope, cut clean through, and a boy's glove stitched with the name TOBIN."
	},
	register: {
		id: 'register',
		kind: 'document',
		title: 'The last bell-ringer',
		text: 'The parish register lists every bell-ringer of the monastery. The last entry, forty years old, is not a name but a line: “We have stopped the Bell. May no one ring it again.”'
	},
	drawing: {
		id: 'drawing',
		kind: 'document',
		title: "Tobin's drawing",
		text: 'Hidden under the floorboard: a child’s drawing of the monastery tower, a bell inside it, and beneath the tower a huge dark shape with far too many eyes.'
	},
	clapper: {
		id: 'clapper',
		kind: 'object',
		title: 'A bell clapper in the ashes',
		text: 'In the Hound’s ashes lies a small iron clapper, like one from a hand bell, still warm. It hums when you hold it.'
	},
	scratches: {
		id: 'scratches',
		kind: 'environment',
		title: 'Scratches in the well',
		text: 'Deep claw marks run up the inside of the well, as if something climbed out. Pressed into the stone lip: the shape of a bell.'
	},
	chronicle: {
		id: 'chronicle',
		kind: 'document',
		unlocks: 'learned_agna',
		title: 'The brothers’ chronicle',
		text: 'The last page of the chronicle: “The Bell does not hang in the tower. It hangs in the Hollow, over the thing that sleeps there, and its ringing keeps it sleeping. The ringers go down by Saint Agna’s door. Turn the bell in her hands.”'
	},
	splice: {
		id: 'splice',
		kind: 'object',
		title: 'A mended rope',
		text: 'The old bell rope was cut long ago. Someone has spliced it back together with new rope, the same rope as the length in the Hale chest. Tobin mended it, and Tobin rang it.'
	},
	bread: {
		id: 'bread',
		kind: 'testimony',
		unlocks: 'learned_tobin',
		title: 'Bread for the mountain',
		text: 'Every Sunday Tobin carried a loaf up the mountain path. He told his mother he was feeding an old monk who lives at the monastery all alone.'
	},
	legend: {
		id: 'legend',
		kind: 'testimony',
		title: 'Forty years',
		text: 'Old Bertram remembers the last time the Bell rang, forty years ago. The brothers sent three ringers down under the mountain to quiet it, and they were never seen again.'
	},
	'empty-graves': {
		id: 'empty-graves',
		kind: 'environment',
		title: 'The ringers’ graves',
		text: 'Three gravestones in the churchyard are carved with bells, for the last ringers. Nell the gravedigger swears there is nobody buried under them.'
	},
	lights: {
		id: 'lights',
		kind: 'testimony',
		unlocks: 'learned_tobin',
		title: 'Lights on the mountain',
		text: 'Widow Crane saw a small light climb the mountain path last night. Later, a great many lights came on at the monastery, blinking like eyes.'
	},
	shears: {
		id: 'shears',
		kind: 'testimony',
		unlocks: 'learned_tobin',
		title: 'Borrowed shears',
		text: 'A week ago Tobin borrowed Gregor’s rope shears and a coil of new hemp rope. He said it was for a swing.'
	},
	saint: {
		id: 'saint',
		kind: 'testimony',
		unlocks: 'learned_agna',
		title: 'Saint Agna’s key',
		text: 'Father Wynn says the brothers carved Saint Agna all over the monastery, and the old books say she “holds the key to the ringers’ way in her hands”.'
	},
	promise: {
		id: 'promise',
		kind: 'testimony',
		unlocks: 'learned_tobin',
		title: 'Tobin’s secret',
		text: 'Tobin told Pell the Bell was lonely under the mountain, and that he was going to make it sing one more time. He went up the path with a coil of rope.'
	},
	tracks: {
		id: 'tracks',
		kind: 'testimony',
		title: 'Tracks round the well',
		text: 'At dawn Aldric found long-toed tracks circling the well. They went round and round and led nowhere, as if whatever made them went back down.'
	},
	badges: {
		id: 'badges',
		kind: 'object',
		title: 'The last ringers',
		text: 'Among the bones: three tin badges stamped with a bell. The last ringers never climbed back up. They stayed to keep the Bell quiet.'
	},
	tollings: {
		id: 'tollings',
		kind: 'document',
		unlocks: 'learned_agna',
		title: 'The book of tollings',
		text: 'The brothers’ ledgers record every tolling of the Bell: once in forty years, each time three ringers “sent down by Saint Agna’s door”. The last entry is forty years old, and the ink is shaky.'
	},
	clapperless: {
		id: 'clapperless',
		kind: 'object',
		title: 'A bell without a voice',
		text: 'The tower bell has no clapper: it was cut out long ago, the stump filed smooth. This bell has never rung in living memory. Whatever has been ringing, it isn’t this one.'
	},
	hum: {
		id: 'hum',
		kind: 'environment',
		title: 'The well hums',
		text: 'With an ear to the well’s stone lip you hear it: a low hum, the same note as the bell, rising and falling like something breathing.'
	},
	footprints: {
		id: 'footprints',
		kind: 'environment',
		unlocks: 'learned_tobin',
		title: 'Small footprints at the gate',
		text: 'Where the ground dips under the north gate: a child’s boot prints, two days old, and the scrape of someone small wriggling through. Tobin went up the mountain path.'
	},
	vigil: {
		id: 'vigil',
		kind: 'environment',
		title: 'A vigil for the ringers',
		text: 'The wax at the shrine is fresh, and scratched into it are three names, the same names as on the bell-marked graves. Someone prays for the lost ringers every night.'
	},
	prints: {
		id: 'prints',
		kind: 'environment',
		unlocks: 'learned_agna',
		title: 'A trail in the dust',
		text: 'A line of small footprints crosses the nave, straight to the statue of Saint Agna, and stops there. They don’t come back.'
	},
	'hollow-wall': {
		id: 'hollow-wall',
		kind: 'environment',
		unlocks: 'learned_agna',
		title: 'A hollow wall',
		text: 'Knock on the west wall of the nave beside Saint Agna and it rings hollow. There is a room behind it.'
	},
	breath: {
		id: 'breath',
		kind: 'environment',
		title: 'Warm air from below',
		text: 'Warm air breathes up through the iron grate, and with it, very faintly, the Bell’s note.'
	},
	sleeper: {
		id: 'sleeper',
		kind: 'environment',
		title: 'Not all asleep',
		text: 'Look long enough into the pit and you can make out the eyes. Nearly all of them are closed. One is not, and it follows the boy.'
	}
} satisfies Record<string, ClueDef>;

export type ClueId = keyof typeof CLUES;

export const HOUND = {
	name: 'Hollow Hound',
	color: '#c9d1d6',
	armor: 1,
	speed: 6,
	vision: 8,
	attack: { name: 'Bite', range: 1, toHit: 4, damage: '1d6+2' } satisfies Attack,
	/** Tougher with a bigger party. */
	hpFor: (characters: number) => 10 + 6 * Math.max(1, characters),
	/** The two that come up the stair when the bell rings are younger and weaker. */
	pupHpFor: (characters: number) => 6 + 3 * Math.max(1, characters)
};

/** Narration, spoken lines and prepared read-aloud text. */
export const TEXT = {
	started: `${TITLE}. Choose your characters.`,
	arrival:
		'Dusk settles over Bellweather. The valley road brings you into the village square, where the lamps are already lit and every shutter is closed. High on the mountain, the old monastery is a black shape against the last of the light. An hour ago its bell rang, for the first time in forty years.',
	marenArrival:
		"You came up the valley road? Then you heard it too. The monastery bell rang at sundown, and nobody has rung it since the brothers left. And the Hale boy, Tobin… he went to the old well at dusk and hasn't come back. Please. Look at the well.",
	marenInvestigate: "The well's in the middle of the square, past the lamps. Mind yourselves.",
	marenAftermath:
		"You've seen it now. Whatever woke down there, the bell called it. I've cut the chain on the gate. The mountain path is open, if you mean to go up.",
	marenComplete: 'Go carefully. Bring the boy home if you can.',
	wellEarly:
		'An old stone well. A cold draught breathes up from the shaft, carrying a faint metallic hum. Someone in the village might know its story.',
	wellClue:
		'You lean over the stone lip. Claw marks score the inside of the shaft, and something has pressed the shape of a bell into the stone. Then, far below, a sound like a cracked bell, rising.',
	houndEmerges:
		'Something pale and long-limbed drags itself over the lip of the well: a Hollow Hound, its ribs ringing faintly as it breathes. It turns toward the nearest light.',
	houndFalls:
		'The Hollow Hound collapses into grey ash that chimes as it settles. Somewhere up the mountain, the bell answers, once.',
	gateOpens:
		'Maren hurries out of the inn with a pair of shears. The chain on the north gate falls away, and the path up the mountain lies open.',
	gateLocked: 'The gate is chained shut.',
	notNow: "There's no time for that. The Hound is here.",
	leaveVillage:
		'The lamps of Bellweather fall away behind you as the path climbs into the dark. At the top, the monastery gate stands open on a courtyard of graves, and one lamp still burns in the gatehouse.',
	defeat:
		'The last of you falls. The dark closes over the lamplight, and the mountain is quiet again. The GM can start the story over.',
	revive: 'Those who fell struggle back to their feet, bruised but alive.',
	chestOpen: 'The lid creaks up. Folded blankets, a boy’s spare boots, and something underneath.',
	chestEmpty: 'Nothing else in the chest but blankets.',
	table:
		'Half-drunk mugs, a dropped pipe, a game of dice abandoned mid-throw. Everyone left in a hurry when the bell rang.',
	tableAgain: 'The dice still show two ones.',
	shrine:
		'A weathered saint holds a bell to her chest. Fresh wax pools at her feet; someone has been praying here every night.',
	rug: 'The rug slides aside. One floorboard beneath it sits a little proud of the others.',
	hatchEmpty: 'The gap under the floorboard is empty now.',
	crate: 'The old crate splinters apart. Inside: straw and a dozen candles, all unlit.',
	brazierLit:
		'The brazier catches, and warm light spills across the gate and the first stretch of path.',
	brazierOut: 'The brazier gutters out.',
	remainsEmpty: 'Only ash now.',
	nothingFound: 'You look, but whatever is here, you don’t find it.',
	cantMakeOut: 'There is something here, but you can’t make it out.',
	hearNothing: 'You stop and listen. Nothing but the wind and your own breathing.',
	seeNothing: 'You take a long look around. Nothing new catches your eye.',
	chapelRope:
		'A bell rope hangs in the chapel tower, cut off short. There is no bell above it, only an empty frame thick with pigeon feathers.',
	chapelAgna:
		'Saint Agna in coloured glass, a small bronze bell held to her heart. Her eyes are painted shut.',
	ringers:
		'Three stones side by side, each carved with a bell and a name worn almost smooth. The earth in front of them has never settled.',
	anvil:
		'A half-made lantern hook on the anvil, and beside it a length of heavy chain, the twin of the one on the north gate.',
	loom: 'A shroud, half woven, stretched on the loom. The pattern along its edge is a row of small bells.',
	stall:
		'Bundles of herbs, jars of salve, and a basket of bread rolls going stale. Nobody has bought anything since the bell rang.',
	waystone:
		'A worn waystone at the foot of the mountain path. Under the moss: THE MONASTERY OF THE HOLLOW BELL. PILGRIMS WELCOME. And below, cut much later and much deeper: RING NOT.',

	// The monastery
	oswinFirst:
		'A stooped old man in a patched habit lifts his lamp to your faces. “Visitors. Forty years, and tonight of all nights. I am Oswin, the last of the brothers, the one who would not leave. You heard the Bell. So did I. Tell me, then: what have you come up here to do?”',
	oswinWaiting: '“Well?” Oswin waits, the lamp trembling in his hand.',
	oswinSilence:
		'“Silence it.” Oswin closes his eyes. “Yes. That is what we swore, too.” He presses a heavy iron key into your hand. “The ringers’ door, on the east side. I have unlocked nothing in forty years. Go on.”',
	oswinBoy:
		'“The boy.” Oswin’s face crumples. “Tobin brought me bread every week. He asked about the Bell, and I told him. God forgive me, I told him.” He presses a heavy iron key into your hand. “The ringers’ door, on the east side. Bring him back.”',
	oswinAfter: '“The ringers’ door, on the east side. Saint Agna keeps the way down.”',
	oswinEnd: '“Whatever you did down there, I heard it. Go carefully.”',
	graves:
		'Forty-one graves, forty-one brothers. The newest stone is blank. Oswin must have cut it for himself.',
	nave: 'The nave is cold and very still. Dust lies thick on the pews, except for one line of small footprints running to the statue by the west wall.',
	firstToll:
		'High in the tower, the bell begins to swing on its chains, though no one is near it. It makes no sound. The sound comes from below: one deep note that rolls up through the stone. Dust sifts down from the rafters, the pews creak, and far beneath your feet something vast turns over in its sleep.',
	agna: 'You turn the little bronze bell in Saint Agna’s hands. Something clanks behind the west wall, and a section of stone swings inward on old hinges.',
	agnaAgain: 'The bronze bell in her hands will not turn back.',
	chamber:
		'Behind the wall, a narrow ringing chamber. A bell rope hangs through a hole in the ceiling, and a single candle burns on a crate.',
	bellRings:
		'The rope jerks in the still air, and far below your feet the Bell speaks. Not in the tower: under the floor. The iron grate bursts upward, and two pale shapes spill out of the stair.',
	chamberWon:
		'The last hound falls apart into chiming ash. The broken grate hangs open, and a stair winds down into the rock, toward the sound of the Bell.',
	downStair: 'The stair turns and turns. The air grows warm, then damp, then hums.',

	// The Hollow
	hollow:
		'The stair opens into a cavern. At its far end, the Hollow Bell hangs from the rock over a black pit, its rope running up into the dark. A boy stands under it, holding the rope, perfectly still.',
	tobinFound:
		'Tobin turns his head slowly. His eyes are wide and blank. “It told me to ring,” he whispers. “It said it was lonely.” In the pit, something shifts, and many eyes begin to open.',
	tobinAfter: 'Tobin clings to your sleeve and will not let go.',
	bell: 'The Bell is black iron, older than the monastery, and cold as the bottom of a well. Every surface is cut with tiny, careful eyes.',
	pit: 'You look down. The dark looks back, with far too many eyes, and hums the Bell’s note.',
	bonesEmpty: 'Only bones now.',
	bellEmpty: 'Dust and a dead bird inside the bell. No clapper.'
};

/** How the story ends, by the choice made at the Bell. */
export const ENDINGS: Record<EndingId, { title: string; text: string }> = {
	kept: {
		title: 'The Bell Kept',
		text: 'You take the rope from Tobin and ring, as the brothers rang. Once, twice, three times. The eyes in the pit close one by one, and the humming stops. You carry Tobin up into the dawn. Forty years from now, someone will have to ring it again.'
	},
	broken: {
		title: 'The Bell Broken',
		text: 'You bring the Bell down. It cracks with a sound like the end of the world, and the humming stops. So does whatever held the thing below. You run with Tobin up the stair as the Hollow wakes behind you. Bellweather will need more than lamps now.'
	},
	silent: {
		title: 'The Long Silence',
		text: 'You cut Tobin free of the rope and carry him up and out, and leave the Bell hanging over the pit, silent. Nobody rings it. Nobody should. In the dark below, the eyes stay open, waiting.'
	}
};

/** What becomes of Oswin's promise, told after the ending. */
export const PROMISE_KEPT: Record<string, Record<EndingId, string>> = {
	silence: {
		kept: 'The Bell is quiet again, as you promised Oswin.',
		broken: 'You promised Oswin silence, and you made it the loudest silence there has ever been.',
		silent:
			'You promised Oswin silence. He will spend what is left of his life listening for it to break.'
	},
	boy: {
		kept: 'Oswin weeps at the gate when he sees the boy alive.',
		broken:
			'Oswin weeps at the gate when he sees the boy alive, and then he looks past you, down the mountain.',
		silent: 'Oswin weeps at the gate when he sees the boy alive.'
	}
};

export const CUES = [
	{
		id: 'village',
		title: 'The quiet village',
		text: 'No dogs bark. No children call. Behind the shutters, candles gutter, and more than one face watches you pass from the dark behind the glass.'
	},
	{
		id: 'bell',
		title: 'The bell hums',
		text: 'For a moment you feel it more than hear it: a low hum in your teeth, as if the bell far above were still ringing, too deep for ears.'
	},
	{
		id: 'hale-house',
		title: 'The Hale house',
		text: "The Hale house is unlocked. Inside, supper sits cold on the table, and a boy's coat still hangs by the door."
	},
	{
		id: 'monastery',
		title: 'The monastery at night',
		text: 'Wind moans through the broken tower. Up close, the monastery is bigger than it looked from the village, and every window is dark but one.'
	},
	{
		id: 'hollow',
		title: 'The eyes in the dark',
		text: 'At the edge of your lamplight, the pit breathes. Every time the Bell hums, something down there hums back.'
	}
] as const;
