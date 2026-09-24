// The Hollow Bell, as an adventure: every table, character, person, enemy,
// object, fight, event, line, objective and ending, as data the engine runs
// (server/adventure/define.ts says what each part is). The reference for
// every adventure after it.

import { CHARACTERS } from '../../../src/lib/adventure/characters';
import type { AdventureDef } from '../../adventure/define';
import { CLUES, CUES, TITLE } from './content';
import { ENEMIES } from './enemies';
import { AREAS, LOCATIONS } from './locations';
import { MECHANISMS, TRIGGERS } from './mechanisms';
import { NPCS, REACTIONS } from './npcs';
import { OBJECTS } from './objects';
import {
	ARRIVAL,
	CHOICES,
	ENCOUNTERS,
	ENDINGS_DEF,
	EVENT_EFFECTS,
	OPENINGS,
	PEOPLE_PLACES,
	RENAMED,
	VOICE
} from './rules';
import { SIGNS } from './signs';
import { CHAPTERS, DECISIONS, EVENT_IDS, EVENT_LABELS } from './story';
import { VERB_STORY } from './verbs';

const map = <T, U>(record: Readonly<Record<string, T>>, f: (value: T, id: string) => U) =>
	Object.fromEntries(Object.entries(record).map(([id, v]) => [id, f(v, id)]));

export const HOLLOW_BELL: AdventureDef = {
	id: 'hollow-bell',
	title: TITLE,
	about:
		'A bell that hasn’t rung in forty years rings at dusk. A fantasy adventure for 1–4 players, from the village of Bellweather to the monastery above it, and what lies beneath.',
	version: 1,
	characters: CHARACTERS,
	start: { location: 'bellweather', chapter: 'village', arrival: ARRIVAL },
	locations: LOCATIONS,
	areas: AREAS,
	chapters: map(CHAPTERS, (c, id) => ({
		...c,
		...(OPENINGS[id] ? { opening: OPENINGS[id] } : {})
	})),
	events: Object.fromEntries(
		EVENT_IDS.map((id) => [
			id,
			{ label: EVENT_LABELS[id], ...(EVENT_EFFECTS[id] ? { does: EVENT_EFFECTS[id] } : {}) }
		])
	),
	decisions: map(DECISIONS, (d) => ({
		...d,
		options: d.options.map((o) => ({ ...o, ...CHOICES[d.id][o.id] }))
	})),
	endings: ENDINGS_DEF,
	npcs: NPCS,
	peoplePlaces: PEOPLE_PLACES,
	reactions: REACTIONS,
	objects: OBJECTS.map((o) => ({
		...o,
		verbs: o.verbs.map((v) => {
			const key = `${o.id}:${v.id}`;
			return {
				...v,
				...(VERB_STORY[key] ? { does: VERB_STORY[key] } : {}),
				...(TRIGGERS[key] ? { triggers: TRIGGERS[key] } : {})
			};
		})
	})),
	signs: SIGNS,
	clues: CLUES,
	mechanisms: MECHANISMS,
	enemies: ENEMIES,
	encounters: ENCOUNTERS,
	ward: { object: 'bell', touched: 'used' },
	cues: CUES,
	voice: VOICE,
	renamed: RENAMED
};
