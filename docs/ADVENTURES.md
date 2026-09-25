# Writing an adventure

An adventure is data. The engine (`server/adventure/`) runs whichever
adventure a table is playing, and knows none of them. There are two ways to
write one: as TypeScript data in `server/adventures/` (built in, like The
Hollow Bell), or as an **adventure file**, plain JSON, in the builder at
`/builder`, with no code at all (see the end of this page). The adventures live in
`server/adventures/`, one folder each, and are listed in
`server/adventures/index.ts`, which is the catalog a GM chooses from in
the Adventure panel (each with its `about` line; the first is the default
when a start names none). The Hollow Bell (`server/adventures/hollow-bell/`)
is the reference: every part of the structure below exists because it
needed it. _The Last Train to Blackwater_ (`server/adventures/blackwater/`)
is the proof that the structure is general: a supernatural western aboard a
night train, written as an adventure file (see the end of this page) and
built in with `loadAdventureFile`, so it uses nothing The Hollow Bell's
TypeScript can that a creator can't.

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

## Rules

An adventure plays by one ruleset, named by exact id and version in
`AdventureDef.rules`; without it, thirdfold's classic rules
(`thirdfold-classic` v1: four stats, d20 + stat, 10 + armor). A story is
pinned to its rules when it starts and its saves carry them. The server has
the rules in code (`server/rules/`); an adventure only names them, and they
check it before it can start (`rulesProblems`).

The fifth edition rules of the SRD 5.2.1 are `dnd-5.5e` v1. Under them:

- a character's `armor` is its Armor Class, and its `sheet` holds the rest:
  `level`, `abilities` (`str`, `dex`, `con`, `int`, `wis`, `cha`, scores 1–30),
  `saves` and `skills` it is proficient in, `attacks` (the ability each attack
  action uses) and `bonusActions` (actions that take a bonus action);
- a check's `stat` is an ability (`"str"`) or a skill (`"perception"`), and
  `save: true` makes it a saving throw (abilities only);
- an enemy's `armor` is its Armor Class and an attack's `toHit` its full
  bonus; an attack with `save: { stat, dc, half }` makes its target save
  instead of being rolled against;
- the `hurt` effect can carry the same `save`, for a trap or a hazard.

Checks in the dark that need sight fail; attacks get advantage or
disadvantage from the table (unseen, a foe beside an archer, a target taking
cover); a natural 20 is a critical hit. Every roll's log entry explains how it
was resolved. The Barrow on Cold Hill (`server/adventures/barrow/`) is written
for these rules. Adventure files and the builder still use the classic rules
and character library.

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

## Built in as a file: The Last Train to Blackwater

`server/adventures/blackwater/` is an adventure file written in TypeScript
only so its tables can be built with the same helpers (`tables.ts`: the
train, four cars end to end with the prairie off the map as `void` floor;
the locomotive; the ghost town) and its text kept readable (`story.ts`,
`blackwaterFile()`); `index.ts` passes it through `loadAdventureFile`
exactly as a GM's upload is, and refuses to start the server if it has any
problem. Seven chapters: a passenger vanishes, a frost trail to the locked
baggage car (a key the conductor hands over, carried to the door and the
strongbox), the coffins' dead, midnight (the lamps go out and the dead
passengers walk the aisles as sentries), the dead engineer at the throttle,
and the bridge: throw the brake (_Stopped Short_), make the conductor face
the dead (_Laid to Rest_; a different option once he has confessed), or
ride on (a branch chapter at Blackwater, a last fight, _End of the Line_).
Its characters' introductions come from the file's `intros`. Tests are in
`server/adventures/blackwater/blackwater.spec.ts` (every ending, the first
find, a save at the bridge).

A trigger area never fires mid-fight: walking into one only counts once
the fight at hand is over.

## Publishing to the library

The builder's **Publish** section puts the adventure in the library
(`/library`), under a creator name, by this browser's GM key (the server
issues one on a first publish if the browser has none). The server checks the
file exactly as it would to play it (`loadAdventureFile`), so only playable
adventures are published. Publishing again, as a version of one of the
creator's adventures, adds a version: tables that start it later get the
latest, and a table already playing keeps the file it started with (its saves
carry that file, as any creator's adventure's do). A creator can take an
adventure out of the library (it stays theirs to run) or remove it with every
version.

The library (`server/library-store.ts`) keeps each adventure's versions,
plays and ratings: files in `data/library` (`LIBRARY_DIR`), or Supabase
tables `library_adventures`, `library_versions` and `library_ratings` with the
functions `library_publish`, `library_play` and `library_rate`, all reachable
only with the server's secret key. A creator is shown by a public id derived
from their key's hash (`creatorIdOf`), never the key or the hash; their page is
`/library?creator=<id>`. The library lists the latest versions, searched by
title, description and creator, ordered by rating (a few ratings count for
less), plays or date.

A GM runs a library adventure from the library page, or from the Adventure
panel at a table (`adventure_start` with `libraryId`); the story remembers
where it came from (`AdventureState.library`, saved), and the panel credits its
creator. When the story is over, everyone who played it (players with a
character, and the GM unless it is their own) can give it 1-5 stars
(`adventure_rate`), once each; rating again replaces their stars.
