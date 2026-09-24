// The words of The Hollow Bell. Server-side only, so what the party hasn't
// discovered yet never reaches a client: dialogue, clues and narration go out
// as log entries and adventure state once they happen.

import type { ClueDef } from '../../adventure/define';
import type { EndingId } from './story';

export const TITLE = 'The Hollow Bell';

/** The evidence the party can come by. */
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
	tinbell: {
		id: 'tinbell',
		kind: 'object',
		title: 'A child’s tin bell',
		text: 'Pressed into the mud of the road, a little tin bell on a cord, the kind children wear at festivals. It is cold, and it glows faintly, and when you lift it, it hums the same low note over and over. Scratched on the side: T. H.'
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
	tally: {
		id: 'tally',
		kind: 'environment',
		title: 'Tally marks behind the crate',
		text: 'Where the crate stood, scratched low on the wall at a child’s height: row on row of tally marks, and a crooked T. Tobin waited here a long time, counting the tolls.'
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
	rule: {
		id: 'rule',
		kind: 'document',
		unlocks: 'learned_rule',
		title: 'The ringers’ rule',
		text: 'Cut into the wall above the rope, too shallow to read by candlelight: a bell with an eye inside it, and the ringers’ rule beneath. ONE PULL CALLS IT. THREE PULLS BIND IT. NEVER LET IT RING ITSELF. The last line has been scratched out, and under it, in a child’s hand: I’M SORRY.'
	},
	sleeper: {
		id: 'sleeper',
		kind: 'environment',
		// Knowing what sleeps below, the party needn't look into the pit again when it wakes.
		unlocks: 'saw_hollow',
		title: 'Not all asleep',
		text: 'Look long enough into the pit and you can make out the eyes. Nearly all of them are closed. One is not, and it follows the boy.'
	}
} satisfies Record<string, ClueDef>;

export type ClueId = keyof typeof CLUES;

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
	glint:
		'Something catches your eye a few steps up the road: a faint, cold glint of blue in the mud, where no lamp is.',
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
	chamberTorchLit:
		'The torch catches. The dark draws back to the walls, and on the north wall, above the rope, carvings you could not see by the candle stand out in the flame.',
	carvingsAgain: 'The bell with the eye, the ringers’ rule, and the child’s apology under it.',
	chamberTorchOut: 'The torch goes out, and the chamber is black again but for the candle stub.',
	hollowTorchOut:
		'You smother the cultists’ torch. The alcove drops into darkness, and the cleft in the rock to the north goes with it: without a flame on it, it is only more stone.',
	hollowTorchLit:
		'The torch flares, and the cleft in the rock north of the alcove shows again: a way through, round toward the pit.',
	bellFlash:
		'At your touch the Bell sounds, once, very low. Cold blue light floods the cavern from wall to wall, every shadow thrown flat, and then it is gone.',
	tollFlash: 'The note breaks over the cavern as a blaze of cold blue light, and dies.',
	chamberFlash:
		'For one heartbeat the chamber is as bright as noon: every corner, every chain, the grate thrown open, and what is climbing out of it. Then the dark comes back.',
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
		'The rope jerks in the still air, and far below your feet the Bell speaks. Not in the tower: under the floor. The iron grate bursts upward, and two pale shapes spill out of the stair. A robed figure climbs up after them, a sling already whirling.',
	chamberWon:
		'The last hound falls apart into chiming ash. With a shriek of iron the grate drops back over the stair and holds fast. Its chain runs up the wall and across the ceiling to a lever by the door.',
	leverPulled: 'The lever groans down in its slot.',
	chainRuns:
		'Chain runs rattling up through the wall. Somewhere above, a counterweight drops, and the whole chamber shudders.',
	grateLifts:
		'The grate grinds up and back on its hinges. Below it, a stair winds down into the rock, toward the sound of the Bell.',
	crateMoved: 'The crate scrapes across the flagstones.',
	crateBlocked: 'The crate won’t go that way.',
	handbellTaken: 'The hand bell is heavier than it looks. Its clapper is tied off with a rag.',
	handbellRung:
		'You shake the rag loose and ring. One thin, clean note walks out through the stone, and for a breath the hum beneath everything falls quiet. The ringers rang these to walk their brothers down. You all stand a little steadier.',
	handbellAgain: 'The hand bell rings out, clear and small, and fades.',
	chainsBroken:
		'The rusted links give with a crack. The chains fall away from the great doors, and they can be opened from inside.',
	downStair: 'The stair turns and turns. The air grows warm, then damp, then hums.',
	keeper:
		'Between you and the Bell stands a tall figure in an iron helm shaped like a bell, a great hammer in one hand and a small black bell in the other. Across the water the cultists’ lanterns swing round and come running. “No further,” says the Bell Keeper, and rings.',
	hollowWatch:
		'Two lanterns move slowly in the dark, carried by robed figures on their rounds: one among the ruins on the western shore, one on the eastern terraces. On the island, by the Bell, a tall shape in an iron helm stands watch over the boy and the causeway gate. Keep to the dark, or be seen.',
	keeperToll:
		'The Bell Keeper rings its little black bell. The note goes through you like cold water.',
	keeperFalls:
		'The Bell Keeper goes down on one knee, then onto its face. Its little bell rolls away across the stone and rings once. Under the great Bell, Tobin has not moved.',

	// The Hollow
	hollow:
		'The stair ends on a landing of wet stone, and the dark in front of you is not a cave. It is a world. Your lantern light falls a few yards and gives up.',
	hollowFlash:
		'Somewhere ahead, the Bell sounds, once, and the whole Hollow flares blue. For one heartbeat you see it all: a black lake wider than Bellweather, a causeway running out across it to an island walled in stone older than the monastery; on the island, among gears as tall as houses, the Hollow Bell hanging in its frame over a pit, and a boy standing under it with the rope in his hands. Ruins on the western shore. Terraces climbing the eastern wall to a shelf of statues. And beyond the island, nothing: a void with no far side. Then the dark comes back, and you have to remember.',
	tobinFound:
		'Tobin turns his head slowly. His eyes are wide and blank. “It told me to ring,” he whispers. “It said it was lonely.” In the pit, something shifts, and many eyes begin to open.',
	tobinAfter: 'Tobin clings to your sleeve and will not let go.',
	// The finale
	pitStirs:
		'Tobin’s eyes clear for a moment, and he looks past you, down into the pit. Something down there heard you say his name.',
	pitKnown:
		'You have seen that eye before, from the pit’s edge. Now it opens wide, and it knows you.',
	pitHollow:
		'You look down into the pit, and the pit is not a pit. It is an eye, as wide as the island, set in something vaster than the cavern, and it is opening. The Hollow is awake enough to see you.',
	waking:
		'The Hollow stirs. The island shudders, cracks run across the stone, and pale tendrils come up out of the pit, feeling for the warm things standing on it.',
	keeperJoins:
		'Across the island the Bell Keeper turns from its watch, lifts its little black bell high, and rings it for its master.',
	remembersTouch: 'It remembers the hand that touched the Bell. More of it comes up to find you.',
	cracks: 'Cracks spread through the stone underfoot. Get clear before the floor heaves again.',
	heave: 'The floor heaves.',
	ringing:
		'The Bell begins to swing on its own, slow as breathing, and rings itself. Each note brings more of the Hollow up to meet it. Someone has to take the rope.',
	ringingRule: 'Three pulls bind it. Never let it ring itself.',
	selfRings: 'The Bell rings itself.',
	strains: 'The Bell strains against the rope, and is still.',
	tobinPulls:
		'“Pell,” Tobin says, in his own voice, and throws his whole weight on the rope. The Bell checks in its swing.',
	pulled: 'The Bell’s swing shortens.',
	handbellAnswers:
		'You ring the little hand bell, and the great Bell answers it, and checks, as if listening.',
	held: 'The Bell hangs still, humming, held, and every tendril in the cavern goes slack and sinks back into the pit. Below, the great eye watches you, and waits.',
	chooseDestroy:
		'You set your weapons to the Bell. The eye below widens, and the whole Hollow rises to stop you.',
	wrath:
		'A hand the size of a cart comes up out of the pit, grey and many-jointed, and closes on the island’s edge.',
	chooseDescent:
		'You leave Tobin holding the rope and climb down into the pit, down a stair of roots, toward a light like a heart beating.',
	heart:
		'The Heart of the Hollow beats on its dais, and the walls breathe with it. Things uncurl from the stone around it.',
	heartWon:
		'The Heart shudders, slows, and stops. Around you the walls fall still, and the only sound is your own breath.',
	wrathWon:
		'The Hand falls back into the pit, and you bring the Bell down. It cracks with a sound like the end of the world.',
	bell: 'The Bell is black iron, older than the monastery, and cold as the bottom of a well. Every surface is cut with tiny, careful eyes.',
	pit: 'You look down. The dark looks back, with far too many eyes, and hums the Bell’s note.',
	bonesEmpty: 'Only bones now.',
	bellEmpty: 'Dust and a dead bird inside the bell. No clapper.'
};

/** How the story ends, by the choice made at the Bell. */
/** The three endings, by name. */
export const ENDINGS: Record<EndingId, { title: string }> = {
	silence: { title: 'Silence' },
	descent: { title: 'Descent' },
	communion: { title: 'Communion' }
};

/** The party's answers to the final choice. */
export type BellAnswer = 'destroy' | 'silence' | 'use' | 'descend';

/**
 * How the story ends, by the answer that ended it: what happened, what the
 * final scene on the table shows, and what came of it all.
 */
export const OUTCOMES: Record<
	BellAnswer,
	{
		/** The first words of the session's end screen. */
		headline: string;
		subtitle: string;
		text: string;
		scene: string;
		result: { label: string; value: string }[];
	}
> = {
	destroy: {
		headline: 'The Bell is broken',
		subtitle: 'The Bell Broken',
		text: 'The Bell lies in pieces on the island, and the humming has stopped. So has whatever held the thing below: it sinks back into the pit, wounded, and the dark closes over it. You carry Tobin up the stair into the dawn. Nothing binds the Hollow now but its wounds. Bellweather will need more than lamps.',
		scene:
			'The Bell lies split on the island floor among its fallen gears. The pit is dark, the lake is dark: every light in the Hollow has gone out but your own.',
		result: [
			{ label: 'The Bell', value: 'Broken' },
			{ label: 'The Hollow', value: 'Wounded, sinking back into sleep' },
			{ label: 'Tobin', value: 'Home' },
			{ label: 'Bellweather', value: 'Safe, for now' }
		]
	},
	silence: {
		headline: 'The Bell is silent',
		subtitle: 'The Bell Silenced',
		text: 'You cut the rope and bind the Bell’s lip in cloth and leather until it can make no sound. Silenced, it cannot call anything up; it cannot hold anything down, either. As you carry Tobin up the stair, the hum below changes, deepens, like something turning over in its sleep. It will wake. Not tonight, not this year. But it will.',
		scene:
			'The Bell hangs dark and muffled in its frame. Below it the pit glows red, and the eye in it does not close.',
		result: [
			{ label: 'The Bell', value: 'Silenced for good' },
			{ label: 'The Hollow', value: 'Beginning to wake' },
			{ label: 'Tobin', value: 'Home' },
			{ label: 'Bellweather', value: 'Living on borrowed time' }
		]
	},
	use: {
		headline: 'The Bell has spoken',
		subtitle: 'The Bell Spoken',
		text: 'You ring the Bell once, and listen. The Hollow answers, not in words, but you understand it: it has been alone under the mountain for longer than there have been mountains, and the Bell was the only voice that ever reached it. You carry Tobin up into the dawn. Someone will come down again, not to bind it, but to talk.',
		scene:
			'The Bell rings softly in its frame, and the whole Hollow is lit a calm blue: the lake, the ruins, the terraces, the Watch. The eye in the pit is closed.',
		result: [
			{ label: 'The Bell', value: 'Rung, and answered' },
			{ label: 'The Hollow', value: 'At peace, and listening' },
			{ label: 'Tobin', value: 'Home, and changed' },
			{ label: 'Bellweather', value: 'Keeps a new kind of vigil' }
		]
	},
	descend: {
		headline: 'The Hollow is still',
		subtitle: 'Into the Heart',
		text: 'In the heart of the Hollow you still what beat there for longer than there have been mountains. It does not die the way people die. It dies the way a mountain would: slowly, and all at once, and with a sound you feel rather than hear. You climb back up the roots to Tobin, and above you the Bell rings once more, by itself, for the last time.',
		scene:
			'The Heart lies still and grey on its dais, its glow gone out. Far above, faint as a star, is the light of the pit’s mouth.',
		result: [
			{ label: 'The Bell', value: 'Rang once more, for its master' },
			{ label: 'The Hollow', value: 'Dead' },
			{ label: 'Tobin', value: 'Home' },
			{ label: 'Bellweather', value: 'Free of it, forever' }
		]
	}
};

/** What the Hollow makes of the party when they speak to it, by what they know. */
export const SPOKEN_KNOWING = {
	rule: 'You ring as the ringers rang, three pulls and no more, and the Hollow knows the voice of its old keepers. It is quieter for it.',
	sleeper:
		'You look into the one eye that never closed, and it looks back at you, and at the boy, and for the first time in forty years it closes.',
	neither: 'It does not understand you, not all of it. But it lets you go.'
};

/** What becomes of Oswin's promise, told after the ending, by the answer that ended the story. */
export const PROMISE_KEPT: Record<string, Record<BellAnswer, string>> = {
	silence: {
		destroy: 'You promised Oswin silence, and you made it the loudest silence there has ever been.',
		silence:
			'You kept your promise to Oswin: the Bell is silent. He will spend what is left of his life listening for what it held down.',
		use: 'You promised Oswin silence, and rang it instead. He hears it from the gate, and understands, or tries to.',
		descend: 'You promised Oswin silence. What you found below is quieter than any bell.'
	},
	boy: {
		destroy:
			'Oswin weeps at the gate when he sees the boy alive, and then he looks past you, down the mountain.',
		silence: 'Oswin weeps at the gate when he sees the boy alive.',
		use: 'Oswin weeps at the gate when he sees the boy alive, and asks what the Bell said. Tobin answers before you can.',
		descend:
			'Oswin weeps at the gate when he sees the boy alive, and does not ask where you have been.'
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
