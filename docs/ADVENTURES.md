# Writing an adventure

An adventure is data. The engine (`server/adventure/`) runs whichever
adventure a table is playing, and knows none of them. There are two ways to
write one: as TypeScript data in `server/adventures/` (built in, like The
Hollow Bell), or as an **adventure file**, plain JSON, in the builder at
`/builder`, with no code at all (see the end of this page). The adventures live in
`server/adventures/`, one folder each, and are listed in
`server/adventures/index.ts` (the first is the one a GM's "Start" sets up).
The Hollow Bell (`server/adventures/hollow-bell/`) is the reference: every
part of the structure below exists because it needed it.

```
Adventure (AdventureDef, server/adventure/define.ts)
 ├── Scenes      locations: the tables, where the party appears, a welcome; areas that raise events
 ├── Characters  the ones players choose (CharacterDef: stats, actions)
 ├── NPCs        npcs: who, where they stand, their states and lines; reactions; peoplePlaces
 ├── Enemies     enemies: stat blocks and a behaviour (rush, skirmish, guardian, grasp)
 ├── Objects     objects: things with states, looks and verbs; mechanisms; signs; clues
 ├── Encounters  encounters: foes, sentries, phases, what winning does
 ├── Events      events: what each does to the table
 ├── Dialogues   npcs[].lines: conditions and effects
 ├── Objectives  chapters: objectives, and the event that moves the story on
 └── Endings     decisions and endings
```

Content stays on the server. Nothing in `server/adventures/` is bundled for
the browser; players learn a story only as it happens to them (log entries
and their view of the adventure). Keep story words out of `src/` and out of
public asset names.

## Effects and rules

Things happen through **effects**, a small closed list (`Effect` in
`define.ts`): say something, find a clue (the character acting finds it, and
shares it when they choose) or tell the party one, raise an event, set an
object's state, change someone's state, offer a choice, start a fight, move
to a chapter, post sentries, send people to their places, reveal or explore
an area, play a motion, heal, let the watch look about, remember a moment,
count toward a phase's counter, change phase, open a hazard, change a light,
a prop or the time of day, hurt those near something, bring up an enemy, or
apply the first of some rules.

**Rules** choose effects: `{ if?: When, do: Effect[] }`, and the first rule
whose conditions hold applies. Conditions (`When`) are the ones people's
lines always used: the state (of the speaker, or of the object before the
verb), clues the acting character knows, evidence anyone found or nobody
has, events that have or haven't happened, a pending choice, objects'
states, the chapter, lines said or moments remembered, choices made, the
fight's phase, and fights' states.

Where rules and effects appear:

| Where                                                  | What                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `start.arrival`                                        | what the GM beginning the story does                             |
| `chapters[id].opening`                                 | what entering the chapter does                                   |
| `events[id].does`                                      | what the event does to the table when it first happens           |
| `objects[].verbs[].does`                               | what doing the verb does (rules; `state` is the object's before) |
| `decisions[id].options[].does`                         | what choosing the answer does                                    |
| `npcs[id].lines`                                       | the first line that applies is said, with its effects            |
| `encounters[id].won.does`, `calledOff`                 | what winning, or the GM calling it off, does                     |
| `phases[id].counter.reached`, `unanswered`, `answered` | a phase's round and counter                                      |
| `endings.byAnswer[a].lines`, `does`                    | every line whose conditions hold; the final scene's changes      |

## The story

`chapters` run in the order they are written (their number in the UI).
Each has objectives (done by an event, shown `after` one) and `next`: the
event that ends it and the chapter it leads to (`null` ends the story). A
chapter at another location travels there: the new table replaces the old,
and the party arrives at the location's `spawn` with everything they carry.
An `enter` effect jumps to a chapter off the main line (The Hollow Bell's
Descent).

The story ends when the last chapter's event happens: the answer to
`endings.decision` picks the ending (`byAnswer`), which is said, changes the
table (`does`), and shows it whole with its cue. Several answers may share an
ending id; `names` titles them.

`areas` raise an event when a character walks in during a chapter (and only
`after` an event, if given, which also catches someone already standing
there when it happens). `clues[id].unlocks` raises an event once the whole
party knows the clue.

## Fights

An encounter's `foes` appear on its `ring` (or at the spawn), `more` adds
foes when conditions hold, and `sentries` stand on the table beforehand,
walking their `route` until one spots a character. Winning says `won.text`,
does `won.does` and raises `won.event`. `remains` leave a world object where
the first foe fell.

A fight with `phases` has rules of its own each round (The Hollow Bell's
waking and ringing): a `hazard` opens under the party and strikes whoever
stays on it, `until` moves on after some rounds, `cleared` says what the foes
all falling means (an event, or nothing: the fight goes on), and a `counter`
counts `count` effects to its target, with `unanswered`/`answered` effects
at each new round. The UI shows the counter by its `label`.

Enemy behaviours are code (`server/adventure/ai.ts`), chosen by name:

- `rush`: chases what it sees with its first attack, turning on whoever hurt it or someone much closer.
- `skirmish`: its second attack from range, its first up close; falls back when badly hurt.
- `guardian`: keeps to its post by the adventure's `ward`, first for anyone near it; tolls (`toll`) when crowded.
- `grasp`: rooted, seizes whoever is in reach, weakest first.

## Checking and testing

`validateAdventure` (`server/adventure/validate.ts`) names every reference
that goes nowhere (an event, chapter, object, clue, fight, enemy, choice,
phase) and every dice expression that doesn't parse. `server/adventure/content.spec.ts`
checks The Hollow Bell with it, keeps the engine free of any adventure's
imports, and plays a second, tiny adventure (The Mill) start to finish on the
same engine. `npm run assets:check` checks every adventure's tables and
figures against the asset manifest (docs/ASSETS.md).

Saves carry the adventure's `id` and `version`; `persist.ts` reads a save
back against that adventure's own ids. `renamed` maps answers and endings an
older version used to the current ones.

## Adventure files and the builder

An adventure file (`src/lib/adventure/file.ts`, format `thirdfold-adventure`,
version 1) is `AdventureDef` written as JSON:

- **Tables are scene files.** Build one at a table (Scene panel: New table,
  floors, walls, doors, props, lights, raised ground), export it with Export
  file, and bring it into a place in the builder.
- **An enemy's hit points** are `{ base, perCharacter }`.
- **Characters** are picked from the character library by id.
- **People** stand on their table by themselves. Their token is `npc-<id>`
  unless the file names one, and each can be talked to, unless the file
  defines an object with the same id.
- **Ids** come from the record keys: chapters, choices, clues, mechanisms,
  enemies.
- **The rules' own words** (`voice`) default to plain ones.

`parseAdventureFile` checks every field and drops what it doesn't know.
`compileAdventure` makes the `AdventureDef`. `loadAdventureFile` does both
and adds `validateAdventure`'s problems, plus the file's own: no characters,
spawn cells off the table, or an object whose prop isn't on its table.

The builder (`/builder`, `src/lib/builder/`) keeps its draft in the browser.
It opens and saves adventure files, and starts from an example, _The
Miller's Key_ (`src/lib/adventure/example.ts`). Each part has a section:

- **Overview:** title, characters, where it starts, the arrival, read-aloud
  passages.
- **Scenes:** places and their tables.
- **Flow:** chapters in order, their objectives, what moves each on and what
  its opening does, plus events and what they do. A summary shows the
  chapter-to-chapter flow and the branches choices take.
- **People:** dialogue lines with conditions and effects, and reactions.
- **Fights:** enemies and encounters.
- **Things & triggers:** objects, their verbs and rules, trigger areas, and
  clues.
- **Choices & endings:** choices (branches), and each answer's ending.
- **Check:** every problem, and the rewards the party can earn.
- **File:** the raw JSON, for what the forms don't cover (mechanisms, signs,
  phases of a fight, the rules' own words).

Effects are edited in lists: say, find or tell a clue, make an event happen,
give a reward, set an object's state, change someone's state, offer a choice,
start a fight, go to a chapter, heal, time of day, reveal, people to their
places, remember, and "if…" rules. Conditions are lists of events, clues,
chapters, states and choices.

**Play it** opens a new table as its GM and starts the adventure
(`adventure_start` with the file). The server checks the file in full
(`server/adventure/custom.ts`). The adventure's id is `custom-` plus a hash
of the checked file, so the same file is the same adventure. A save of the
story carries the file (`SavedStory.content`), so it loads on any server.
A save whose content doesn't match its id is refused.

**Rewards** (`{ reward: 'The silver key' }`) are what the party earns. They
are kept with the story, listed in the Adventure panel, and shown on the
end screen.
