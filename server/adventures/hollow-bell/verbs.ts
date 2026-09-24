// What doing something to a world object does in the story, by `object:verb`:
// the first rule whose conditions hold (`state` is the object's state before
// the verb). Talking to someone is their dialogue (npcs.ts); a verb with no
// rules only changes the object's state.

import type { Effect, Rule } from '../../adventure/define';
import { CLUES, TEXT } from './content';
import { SHOTS } from './shots';

const say = (text: string): Effect => ({ say: text });
/** Once searched, there is nothing more: `empty`; the first time, the clue. */
const findOnce = (empty: string, clue: string): Rule[] => [
	{ if: { state: ['used'] }, do: [say(empty)] },
	{ do: [{ clue }] }
];
const told = (text: string): Rule[] => [{ do: [say(text)] }];
const clue = (id: string): Rule[] => [{ do: [{ clue: id }] }];

export const VERB_STORY: Readonly<Record<string, readonly Rule[]>> = {
	'well:examine': [
		{ if: { events: ['well_clue'] }, do: [say(CLUES.scratches.text)] },
		{ if: { not: ['talked_maren'] }, do: [say(TEXT.wellEarly)] },
		// Everyone sees what climbs out, so everyone knows.
		{ do: [say(TEXT.wellClue), { tell: 'scratches' }, { event: 'well_clue' }] }
	],
	'noticeboard:read': clue('notice'),
	'register:read': clue('register'),
	'table:examine': [{ if: { state: ['used'] }, do: [say(TEXT.tableAgain)] }, ...told(TEXT.table)],
	'shrine:pray': told(TEXT.shrine),
	'chest:open': told(TEXT.chestOpen),
	'chest:search': findOnce(TEXT.chestEmpty, 'rope'),
	'rug:lift': [{ do: [{ set: 'hatch', to: 'closed', if: 'hidden' }, say(TEXT.rug)] }],
	'hatch:search': findOnce(TEXT.hatchEmpty, 'drawing'),
	'crate:break': told(TEXT.crate),
	'brazier:light': told(TEXT.brazierLit),
	'brazier:extinguish': told(TEXT.brazierOut),
	'charm:examine': clue('tinbell'),
	'remains:search': findOnce(TEXT.remainsEmpty, 'clapper'),
	'graves:read': told(TEXT.graves),
	'altar:read': clue('chronicle'),
	'agna:turn': [
		{
			do: [
				{ set: 'secret-door', to: 'closed', if: 'hidden' },
				{ say: TEXT.agna, shot: SHOTS.hiddenDoor },
				{ event: 'found_hidden_door' }
			]
		}
	],
	'rope:examine': clue('splice'),
	'bell:examine': [
		// The first touch: the Bell's note lights the cavern, and whoever watches sees who is there.
		{
			if: { state: ['interactable'] },
			do: [say(TEXT.bell), { say: TEXT.bellFlash, cue: 'flash' }, { detect: true }]
		},
		...told(TEXT.bell)
	],
	'chamber-torch:light': told(TEXT.chamberTorchLit),
	'chamber-torch:extinguish': told(TEXT.chamberTorchOut),
	'carvings:read': [{ if: { found: ['rule'] }, do: [say(TEXT.carvingsAgain)] }, ...clue('rule')],
	'hollow-torch:extinguish': told(TEXT.hollowTorchOut),
	'hollow-torch:light': told(TEXT.hollowTorchLit),
	'pit:examine': [
		{ if: { chapter: ['the_pit'] }, do: [say(TEXT.pitHollow), { event: 'saw_hollow' }] },
		...told(TEXT.pit)
	],
	'bell-rope:pull': [{ do: [{ count: TEXT.pulled, else: TEXT.strains }] }],
	'chapel-rope:examine': told(TEXT.chapelRope),
	'chapel-agna:examine': told(TEXT.chapelAgna),
	'ringers:examine': [
		{ if: { state: ['used'] }, do: [say(TEXT.ringers)] },
		{ do: [say(TEXT.ringers), { clue: 'empty-graves' }] }
	],
	'anvil:examine': told(TEXT.anvil),
	'loom:examine': told(TEXT.loom),
	'stall:examine': told(TEXT.stall),
	'waystone:read': told(TEXT.waystone),
	'ledgers:read': clue('tollings'),
	'belfry-bell:search': findOnce(TEXT.bellEmpty, 'clapperless'),
	// Moving the crate the first time shows what it hid.
	'chamber-crate:push': [
		{ if: { found: ['tally'] }, do: [say(TEXT.crateMoved)] },
		...clue('tally')
	],
	'chamber-crate:pull': [
		{ if: { found: ['tally'] }, do: [say(TEXT.crateMoved)] },
		...clue('tally')
	],
	'handbell:take': [{ do: [{ say: TEXT.handbellTaken, private: true }] }],
	'handbell:ring': [
		// While the Bell rings itself, the hand bell answers it from anywhere: as good as a pull.
		{ if: { phase: 'ringing' }, do: [{ count: TEXT.handbellAnswers }] },
		{ if: { said: ['handbell:rung'] }, do: [say(TEXT.handbellAgain)] },
		{ do: [{ remember: 'handbell:rung' }, say(TEXT.handbellRung), { heal: 2 }] }
	],
	'door-chains:break': [
		{ do: [{ set: 'great-door', to: 'closed', if: 'disabled' }, say(TEXT.chainsBroken)] }
	],
	'bones:search': findOnce(TEXT.bonesEmpty, 'badges')
};
