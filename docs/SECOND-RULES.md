# The second rules system (milestone 60)

Milestone 60 ([#105](https://github.com/tougenrip/thirdfold/issues/105)) proves the ruleset contract is multi-system by running a second, meaningfully different system through the same session, character, encounter, save and authoring paths as the fifth edition rules. This page records the selection and the mechanics comparison made before implementation, and then which concepts are shared and which belong to a system.

## Selection

**Fate Condensed**, as ruleset `fate-condensed` v1.

| Question               | Answer                                                                                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                 | The _Fate Condensed_ System Reference Document, ©2020 Evil Hat Productions, LLC                                                                                                                                                                                             |
| Licence                | Creative Commons Attribution 3.0 Unported (CC-BY 3.0)                                                                                                                                                                                                                       |
| Source kind (M59 gate) | `open`: a licence anyone may use with credit, like the SRD 5.2.1 (CC-BY 4.0). Not `licensed`: no grant, no withdrawal, no export or reference limits                                                                                                                        |
| Credit                 | The SRD's required attribution, verbatim, as the ruleset's `attribution`: shown at the table, kept in every save and export of a story played by these rules (`state.credits`), like the SRD 5.2.1's                                                                        |
| Trademarks             | None used beyond the attribution. The ruleset is named for the document it implements, as the attribution itself does; no Evil Hat logo or "Powered by Fate" mark is shown                                                                                                  |
| What is taken          | Mechanics only: the adjective ladder, four Fate dice, skill ratings, outcomes, actions, stress and consequences, taken out, elective turn order, the default skill list's names. Every rules sentence the table shows is our own wording; no art and no example text copied |
| What is not            | Any other Fate product, setting or book; nothing behind a paywall                                                                                                                                                                                                           |

Why Fate rather than another open system:

- It differs from the d20 family where the contract is most likely to have leaked: **resolution** (a bell curve of four dice around zero added to a rating, read against a ladder, with four outcomes rather than pass or fail), **who rolls** (the defender rolls against every attack: there is no static Armor Class), **harm** (shifts of a hit are absorbed by one-point stress boxes and consequences; there are no hit points, no healing spells and no dying), and **turn order** (no initiative roll: whoever acts picks who goes next).
- It is complete and small enough to play from a short reference, and its SRD is under an open licence with a clear attribution requirement.
- Blades in the Dark (CC-BY 3.0) and Cairn (CC-BY-SA 4.0) were considered. Blades' resolution is very different but it has no tactical turn structure for the grid to exercise; Cairn is close to the d20 family (attacks auto-hit, damage to hit points) and its share-alike terms would bind the content set.

## Mechanics comparison

| Concern       | `thirdfold-classic` v1                    | `dnd-5.5e` v1 (SRD 5.2.1)                          | `fate-condensed` v1                                                                                                                                |
| ------------- | ----------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ratings       | four stats (might, agility, wits, spirit) | six ability scores, proficiency, skills, saves     | nineteen skills rated on the ladder, Mediocre (+0) to Great (+4) in a pyramid; no abilities, no saves, no levels                                   |
| Dice          | d20 + stat                                | d20 + modifiers, advantage as 2d20                 | four Fate dice (`4dF`, each −1, 0 or +1) + skill                                                                                                   |
| Checks        | ≥ DC succeeds                             | ≥ DC succeeds; criticals on attacks                | effort against a difficulty on the ladder: fail, tie (success at a minor cost), succeed, succeed with style (3+ shifts)                            |
| Attacks       | d20 + stat against 10 + armor             | d20 + bonus against Armor Class (cover, advantage) | Fight or Shoot against the defender's own roll of Athletics; a tie gives a boost, not a hit                                                        |
| Damage        | dice                                      | dice by type, Resistance, criticals double dice    | the hit is the shifts the attack beat the defence by (plus a weapon rating where a story gives one)                                                |
| Taking harm   | hit points                                | hit points, temporary hit points                   | one-point stress boxes (3, more with Physique), then consequences (mild 2, moderate 4, severe 6) that stay after the fight                         |
| Falling       | down, bleeds out in three turns           | 0 HP: death saving throws, massive damage          | taken out: out of the conflict, never dying by the rules; the story decides what follows                                                           |
| After a fight | the downed stand at 1 HP                  | the downed stand at 1 HP; rests recover            | every stress box clears; consequences remain until treated                                                                                         |
| Turn order    | d20 + agility initiative, highest first   | d20 + Dexterity initiative                         | elective: one side goes first; each actor picks who goes next among those who haven't acted; the last to act picks who starts the next exchange    |
| A turn        | move, one action                          | move, action, bonus action, reaction               | move, one action (overcome, create an advantage, attack); defending is free and never uses the turn                                                |
| Setting up    | —                                         | Help, Dodge                                        | Create an Advantage (an aspect with a free invoke: +2 on the next attack against that foe), Full Defense (+2 to every defence until the next turn) |
| Characters    | four library characters                   | built from catalog choices, derived on the server  | built from choices (aspects, a skill pyramid, bonus-granting stunts), checked on the server                                                        |
| Content       | adventure files                           | the SRD catalog, homebrew, licensed sources        | the adventure file's own characters and foes; no catalog                                                                                           |

## What the table plays, and what it doesn't

Played: the ladder, `4dF`, the four outcomes on checks and attacks, active defence, shifts as hits, stress and consequences chosen by the server (the fewest marked: stress if it is enough, else the smallest consequence that covers the rest), taken out, stress clearing after a conflict, consequences kept until a player or the GM clears them on the sheet, bonus-granting stunts (+2 to a named skill for an action), Create an Advantage and Full Defense, elective turn order.

Simplified, where the table has no judge of the fiction: a stunt's +2 applies to every use of its skill for its action (the server can't tell its circumstance); Create an Advantage is Notice against a Fair (+2) difficulty rather than the foe's defend roll, and its aspect is "an opening" whose free invoke is spent on the next attack against that foe; a tie on an overcome succeeds with its minor cost left to the GM; enemies are minor NPCs (stress boxes, no consequences).

Not played, and said so here: fate points, invoking and compelling aspects (aspects are shown, not spent), the player choosing how to absorb a hit, conceding, mental conflicts and the mental track, boosts, challenges and contests, teamwork, rule-changing stunts, recovery rolls and milestones (advancement).

## Shared concepts and system-owned behaviour

The contract (`server/rules/ruleset.ts`) keeps every rules decision on the server, and the shared models carry only what every system needs, in rules-neutral words. Milestone 60 removed what had leaked:

- `CharacterDef.stats` (the classic four) is the classic rules' own and optional; `Action.stat` is any stat id its rules accept. The fifth edition characters no longer fill them with zeros and `might`.
- Initiative is the rules': a ruleset either rolls it (`initiative`) or takes turns electively (`turnOrder: 'elective'`); the engine no longer rolls `1d20` itself.
- Defence may be worked out from the defender (`defense(armor, statuses, character)`), so a rules system that defends with a skill reads it from the sheet.
- Harm is the rules' to absorb (`absorb`), what a conflict's end restores (`conflictEnds`), how health is named and counted (`health`: "Stress boxes clear") and what being down means (`downedWords`: taken out, not dying).
- A card may carry `traits` (aspects, stunts) in the rules' words.
- Fate dice (`dF`) are a core dice type: any table can `/roll 4dF`.

Shared, unchanged: the grid, movement, sight, light, fog, elevation; the session, rooms and reconnects; the story engine (chapters, events, objects, clues, fights as the engine runs them); characters as a `CharacterDef` with a rules-owned `sheet`, built and restored through the rules' `builder`; the character card (`CharacterCard`: a defence, stats, actions, resources); adventure files naming their rules and a party built from choices; saves and their lock (`RulesetRef` + content pins); diagnostics.

System-owned: everything about numbers. A story is pinned to its ruleset's exact id and version when it starts, saves carry it, and a save naming rules this server lacks, or another rules system than its adventure's, is refused; characters built under one ruleset are restored only by it.

## The content set and the tests

_The Drowned Lantern_ (`src/lib/adventure/fate-example.ts`) is an adventure file under `fate-condensed` v1: a party of three built from choices, an overcome with Investigate, a conflict against two bog wights and a final choice. It is built in (`server/adventures/drowned-lantern`, loaded through the same checks as a creator's file) and is the builder's Fate template; the builder's Rules section offers Fate Condensed with its ready-made characters and its skills for checks.

Tests: the rules (`server/rules/fate/fate.spec.ts`), the story played to its ending through a save, taken out and stood up, characters and saves bound to their rules (`server/adventure/fate.spec.ts`), Fate dice (`src/lib/game/dice.spec.ts`), the hand-off message (`src/lib/game/protocol.spec.ts`) and a two-player session over the wire beside a fifth edition table ("a second rules system over the wire (milestone 60)" in `server/game-server.spec.ts`). Every classic and fifth edition test runs unchanged.
