# Thirdfold: post-MVP product roadmap

> Milestones 11–40 are GitHub issues under the post-MVP tracking issue [#24](https://github.com/tougenrip/thirdfold/issues/24); see [Tracking](#tracking) for the list. The rules track (milestones 41–60) is tracked in [#85](https://github.com/tougenrip/thirdfold/issues/85). The rendering track (milestones 61–78) is at the end of this file, tracked in [#107](https://github.com/tougenrip/thirdfold/issues/107). The issues show the current status; this file is the source text they were written from.

## Purpose

Thirdfold's initial 10 development milestones have already been completed.

This document defines the next definitive development roadmap.

The project is no longer in the infrastructure/prototype phase. From this point forward, development should focus on turning Thirdfold into a complete, playable, production-grade 3D tabletop RPG product, beginning with the built-in adventure **The Hollow Bell**.

Do not treat this document as a list of optional ideas. The milestones are the intended development sequence.

## Core product direction

### Product

**Thirdfold**: a 3D virtual tabletop designed around physical, interactive RPG worlds.

### First built-in game

**The Hollow Bell**: a 60–90 minute fantasy RPG adventure designed specifically to demonstrate why a 3D VTT is useful.

The first goal is not to build a generic VTT with endless configuration. The first goal is:

> Build one genuinely excellent RPG experience inside Thirdfold.

Once that experience works, extract the reusable systems and turn Thirdfold into a creation platform.

## Development principles

### 1. Build the game before the platform

Do not spend months building generalized editors and frameworks before there is a compelling game to play.

The Hollow Bell is the reference implementation. Build systems because the game needs them. Later, generalize those systems when their real requirements are understood.

### 2. Playability is the primary definition of done

A milestone is not complete because:

- the code compiles
- the UI exists
- an API exists
- a data model exists
- a component renders
- a feature works in isolation

A milestone is complete when its functionality can be used inside an actual multiplayer session.

### 3. Prefer production-grade UX

Thirdfold should feel like a real product, not a developer tool.

- Avoid unnecessary configuration.
- Avoid exposing implementation details.
- Avoid forcing the GM to manually manage game state whenever the game can manage it automatically.

### 4. 3D must provide gameplay value

3D should not simply mean "a normal VTT, but with 3D graphics." Use 3D for:

- verticality
- physical objects
- spatial exploration
- lighting
- visibility
- environmental storytelling
- scale
- atmosphere
- physical interaction
- dramatic reveals

### 5. Do not over-generalize early

When implementing a feature for The Hollow Bell, first solve the actual game requirement. Only generalize it when there is evidence that the abstraction is useful.

---

## Milestone 11: The Hollow Bell vertical slice

**Objective:** create one complete 15–20 minute section of The Hollow Bell that is genuinely playable from beginning to end.

**Build:**

- Bellweather Village starting area
- Player spawn points
- Character selection
- Character tokens
- NPC interaction
- Interactive doors
- Interactive objects
- Basic investigation
- First environmental clue
- First enemy encounter
- Basic combat/action loop
- Dice resolution
- GM narration tools
- Fog/reveal behavior
- Adventure state progression
- End-of-section transition

**Definition of done:** a GM can:

1. Create a game.
2. Invite players.
3. Start The Hollow Bell.
4. Players select characters.
5. Players explore the opening area.
6. Players interact with the environment.
7. Players discover a clue.
8. Players encounter an enemy.
9. Players resolve the encounter.
10. The adventure advances.
11. The section ends naturally.

No developer tools or manual database manipulation should be required.

## Milestone 12: Character gameplay

Turn the four characters into complete playable RPG characters.

| Character  | HP  | Armor | Speed |
| ---------- | --- | ----- | ----- |
| The Warden | 30  | 3     | 5     |
| The Veil   | 20  | 1     | 6     |
| The Ember  | 18  | 1     | 5     |
| The Saint  | 22  | 2     | 5     |

**Build:**

- Character selection
- Character introduction
- Character token
- HP
- Armor
- Speed
- Stats
- Abilities
- Action selection
- Target selection
- Ability feedback
- Damage
- Healing
- Status effects
- Downed/death state
- Character ownership
- GM override

Do not build a generalized character-sheet system. Build the character functionality required by The Hollow Bell.

## Milestone 13: Interaction system

Make the world physically interactive.

**Interactable objects:** support objects such as:

- Doors
- Chests
- Bell mechanisms
- Torches
- Levers
- Books
- Tables
- Windows
- Ladders
- Stairs
- Ritual objects
- Corpses
- NPCs
- Secret objects

**Interaction states:** objects should be able to have states such as:

- Hidden
- Visible
- Interactable
- Used
- Disabled
- Destroyed
- Moved
- Opened
- Closed

The GM must be able to inspect and manipulate these states.

The important principle is:

> Player actions should visibly change the world.

## Milestone 14: Adventure state machine

Turn The Hollow Bell into an actual game rather than a collection of maps.

**Track:**

- Current chapter
- Current location
- Objectives
- Discovered clues
- Triggered events
- Defeated enemies
- Opened doors
- Used objects
- NPC states
- Player decisions
- Encounter states
- Ending state

**Example flow:**

```
VILLAGE
   ↓
DISCOVER_BELL
   ↓
INVESTIGATE_MONASTERY
   ↓
ENTER_MONASTERY
   ↓
DISCOVER_HIDDEN_CHAMBER
   ↓
BELL_RINGS
   ↓
DESCEND
   ↓
THE_HOLLOW
   ↓
FINAL_DECISION
```

Adventure progression must be persisted and synchronized.

## Milestone 15: Bellweather Village

Complete the first major environment.

**Environment:** build:

- Village layout
- Main square
- Inn
- Houses
- Chapel
- Well
- Cemetery
- Mountain path
- Monastery entrance
- Environmental storytelling
- Lighting
- Ambient effects

**NPCs:** implement approximately 10 NPCs with:

- Dialogue
- Interaction
- State
- Location
- Basic behavior
- Clues
- Reactions to player actions

The village should feel like a place that can be investigated, not merely walked through.

## Milestone 16: Investigation system

Create physical investigation gameplay.

**Investigation actions:** players should be able to:

- Examine
- Inspect
- Search
- Listen
- Observe
- Interact

**Evidence** can include:

- Clues
- Documents
- Objects
- Environmental evidence
- NPC information

**Example:**

```
Player examines the well
        ↓
Hidden scratch marks discovered
        ↓
New clue
        ↓
Adventure state changes
        ↓
Monastery objective unlocked
```

Investigation should be integrated with the adventure state system.

## Milestone 17: The Monastery

Build the major 3D showcase environment.

**Requirements:**

- Multiple floors
- Stairs
- Balconies
- Vertical sightlines
- Bell tower
- Interior rooms
- Hidden rooms
- Exterior ledges
- Elevation changes
- Windows
- Hanging bell
- Chains
- Environmental objects

Players should be able to physically look between different elevations and see other players.

**Signature moment:**

- The party enters the monastery.
- The bell rings.
- The environment reacts.
- Dust falls.
- The bell moves.
- The structure subtly reacts.
- Something moves far below.

This should demonstrate why Thirdfold is a 3D VTT.

## Milestone 18: Advanced 3D interaction

Expand physical interaction. Support interactions such as:

- Push
- Pull
- Open
- Close
- Pick up
- Drop
- Rotate
- Activate
- Destroy
- Move
- Trigger

Do not attempt to build a universal physics simulator. Use controlled gameplay-oriented physicality.

**Example:**

```
Player pulls lever
        ↓
Lever moves
        ↓
Chain moves
        ↓
Bell mechanism activates
        ↓
Audio changes
        ↓
Adventure state changes
```

## Milestone 19: Combat 1.0

Create a complete production-ready combat loop.

**Flow:**

```
Encounter
   ↓
Initiative
   ↓
Player Turn
   ↓
Action
   ↓
Target
   ↓
Roll
   ↓
Resolution
   ↓
Feedback
   ↓
Enemy Turn
   ↓
Repeat
```

**Build:**

- Initiative
- Turn indicator
- Movement
- Attacks
- Abilities
- Targeting
- Damage
- Healing
- Death
- Enemy behavior
- Combat end
- Encounter state

**Enemies:** implement:

- Bell Cultist
- Hollow Hound
- Bell Keeper

Do not build a large bestiary. Three strong enemy types are sufficient.

## Milestone 20: Enemy AI

Implement reliable enemy behavior.

- **Bell Cultist:** patrol, detect, approach, attack, retreat.
- **Hollow Hound:** detect, chase, attack, switch target.
- **Bell Keeper:** guard location, protect bell, use special attack, react to bell state.

Prefer simple, predictable gameplay behavior over an unnecessarily complex AI framework.

## Milestone 21: Visibility 2.0

Upgrade the existing fog/visibility system into a gameplay system.

**Build:**

- Player-specific visibility
- Shared visibility
- Room reveal
- Exploration reveal
- Hidden enemies
- Hidden objects
- Darkness
- Light sources
- Torch radius
- Approximate line of sight
- GM reveal
- GM hide
- Persistent discovery

The system should support situations where players do not necessarily see exactly the same information.

## Milestone 22: Lighting as gameplay

Lighting must affect gameplay, not only visuals. Examples:

- Torch reveals an enemy
- Darkness hides an enemy
- Bell chamber is almost completely dark
- Lighting a torch reveals symbols
- Extinguishing a torch hides a passage
- Bell ring temporarily illuminates the cavern

The principle is:

> Light → visibility → gameplay.

## Milestone 23: The Hollow

Build the final environment. Create:

- Massive underground cavern
- Ancient structures
- Underground lake/void
- Giant bell mechanism
- Ruins
- Bridges
- Vertical platforms
- Large central chamber

The visual scale should communicate that the players have entered something much larger than the monastery.

## Milestone 24: The Hollow final boss

Implement The Hollow as a multi-stage encounter. Do not make it simply a large enemy with high HP.

- **Phase 1:** players discover The Hollow.
- **Phase 2:** the environment becomes dangerous.
- **Phase 3:** bell mechanics become part of the encounter.
- **Phase 4:** players choose how to resolve the situation.

**Potential outcomes:**

```
Destroy the bell  →  The Hollow attacks
Silence the bell  →  The Hollow begins to awaken
Use the bell      →  Communicate with The Hollow
```

The final encounter should react to previous player actions.

## Milestone 25: Ending system

Implement multiple endings. At minimum:

- **Ending A: Silence.** The bell is destroyed or permanently silenced.
- **Ending B: Descent.** The players descend and confront The Hollow.
- **Ending C: Communion.** The players use the bell to communicate with The Hollow.

Each ending should have:

- Different environment state
- Different narration
- Different final scene
- Different result
- Session completion state

## Milestone 26: GM experience 2.0

Make the GM workflow production-grade. The GM should be able to:

- Reveal area
- Hide area
- Move NPC
- Spawn enemy
- Remove enemy
- Move objects
- Trigger events
- Change environment
- Control lighting
- Start encounter
- End encounter
- Roll dice
- Send narration
- Pause game
- Skip scene

The GM should direct the adventure rather than construct it.

## Milestone 27: Player UX

Make the player experience production-grade.

**First session:**

```
Join Game
   ↓
Enter Name
   ↓
Choose Character
   ↓
Welcome to Bellweather
   ↓
Interactive tutorial
   ↓
Start
```

Avoid unnecessary configuration. The player should understand what to do without reading documentation.

## Milestone 28: Onboarding

Create interactive onboarding rather than relying on documentation.

**Example:**

```
Move your miniature
        ↓
Look around
        ↓
Something is glowing nearby
        ↓
Inspect it
        ↓
You've discovered something
```

The onboarding should teach the player the core Thirdfold interaction model by actually using it.

## Milestone 29: Audio

Create the complete audio foundation:

- Ambient sound
- Footsteps
- Doors
- Bell
- Combat
- Dice
- UI
- Environment
- Dynamic music
- Music transitions

The bell should become a major audio identity for The Hollow Bell.

## Milestone 30: Cinematic moments

Add controlled cinematic presentation only where it improves the experience. Examples:

- **First Bell:** camera directs attention toward the monastery.
- **Bell Ring:** camera briefly shifts toward the tower.
- **Discovery:** camera emphasizes an important discovery.
- **The Hollow:** camera reveals the scale of the cavern.
- **Final Encounter:** camera reveals The Hollow.

Avoid turning the game into a sequence of cutscenes.

## Milestone 31: Session recovery

Make multiplayer resilient. Build:

- Reconnection
- Player disconnect handling
- GM disconnect handling
- Session recovery
- State synchronization
- Late joining
- Browser refresh recovery
- Connection status
- Reconnecting state
- GM disconnected state
- Safe state recovery

Normal network problems should not destroy a session.

## Milestone 32: Save / resume

Turn persistence into a complete session feature. The GM should see something similar to:

```
The Hollow Bell

Last played:
Yesterday 21:43

[Continue]
```

Continue should restore the adventure to the correct state.

## Milestone 33: Session end

Create a complete adventure conclusion. Example:

```
THE BELL IS SILENT

The party survived.

────────────────

Adventure Complete

Players
• Warden
• Veil
• Ember
• Saint

Time Played
01:17:32

Ending
Communion

[Return to Table]
```

Support:

- Replay
- Continue exploring
- Return to lobby

## Milestone 34: Performance pass

Perform serious optimization based on real measurements. Measure:

- Initial load
- Scene loading
- Frame rate
- GPU usage
- Memory
- Network traffic
- Multiplayer synchronization
- Asset sizes

Optimize actual bottlenecks. Do not optimize hypothetical problems before measuring them.

## Milestone 35: Asset pipeline

Establish a repeatable content pipeline. Support:

- Environment assets
- Characters
- NPCs
- Enemies
- Props
- Materials
- Textures
- Audio
- Scenes

The Hollow Bell should become the reference implementation for future Thirdfold content.

## Milestone 36: Content authoring

Now extract reusable content systems from the actual game. A future adventure should conceptually be able to contain:

```
Adventure
 ├── Scenes
 ├── Characters
 ├── NPCs
 ├── Enemies
 ├── Objects
 ├── Encounters
 ├── Events
 ├── Dialogues
 ├── Objectives
 └── Endings
```

Do not implement unnecessary abstractions. Only expose systems that were proven useful while building The Hollow Bell.

## Milestone 37: Custom table

Thirdfold can now begin transitioning from a game into a platform. Build:

- Empty 3D table
- Scene creation
- Object placement
- Terrain placement
- Token placement
- Grid configuration
- Lighting
- Fog
- Scene saving
- Scene sharing

This is the beginning of user-created worlds.

## Milestone 38: Adventure builder

Allow creators to build their own adventures. Support:

- Scenes
- Encounters
- NPCs
- Dialogue
- Triggers
- Objectives
- Branches
- Rewards
- Endings
- Adventure flow

The long-term goal is to allow someone to build something comparable to The Hollow Bell without writing application code.

## Milestone 39: Second adventure

Create a second complete adventure. It should be substantially different from The Hollow Bell.

Example: **The Last Train to Blackwater**, a supernatural western mystery taking place aboard a moving train.

The purpose is not merely to add content. The purpose is to test whether Thirdfold's systems genuinely generalize beyond the first adventure.

## Milestone 40: Productization

Only after two genuinely playable adventures should Thirdfold become a broader platform. Potential systems:

- Public game discovery
- Adventure library
- Private games
- Game sharing
- Creator profiles
- Adventure publishing
- Versioning
- Content management
- Ratings/reviews where appropriate

Do not prioritize marketplace economics before the core creation and playing experience is proven.

---

## Definitive execution queue

| #   | Milestone                  |
| --- | -------------------------- |
| 11  | Hollow Bell vertical slice |
| 12  | Character gameplay         |
| 13  | Interaction system         |
| 14  | Adventure state machine    |
| 15  | Bellweather Village        |
| 16  | Investigation system       |
| 17  | The Monastery              |
| 18  | Advanced 3D interaction    |
| 19  | Combat 1.0                 |
| 20  | Enemy AI                   |
| 21  | Visibility 2.0             |
| 22  | Lighting as gameplay       |
| 23  | The Hollow                 |
| 24  | The Hollow final boss      |
| 25  | Ending system              |
| 26  | GM experience 2.0          |
| 27  | Player UX                  |
| 28  | Onboarding                 |
| 29  | Audio                      |
| 30  | Cinematic moments          |
| 31  | Session recovery           |
| 32  | Save / resume              |
| 33  | Session end                |
| 34  | Performance pass           |
| 35  | Asset pipeline             |
| 36  | Content authoring          |
| 37  | Custom table               |
| 38  | Adventure builder          |
| 39  | Second adventure           |
| 40  | Productization             |

## Final product progression

The overall development philosophy is:

```
Completed Infrastructure
        ↓
Playable Game
        ↓
Complete Adventure
        ↓
Polished Product
        ↓
Reusable Content Systems
        ↓
Creation Platform
```

Thirdfold should not attempt to become an enormous generic VTT immediately.

First make someone say:

> "I want to play The Hollow Bell again."

Then make someone say:

> "I want to make my own adventure."

That is the transition from game to product to platform.

## Completion standard

Before considering Thirdfold ready for public release, a completely new GM and group of players should be able to:

1. Open Thirdfold.
2. Create a game.
3. Select The Hollow Bell.
4. Invite their friends.
5. Choose characters.
6. Start the adventure.
7. Understand the controls without external help.
8. Explore the 3D environments.
9. Investigate objects and NPCs.
10. Participate in encounters.
11. Fight enemies.
12. Experience the monastery.
13. Descend into The Hollow.
14. Complete the final encounter.
15. Reach an ending.
16. Finish the session.
17. Return later and replay or start another game.

## Tracking

Status lives in the issues. The tracking issue is [#24](https://github.com/tougenrip/thirdfold/issues/24), under the overall roadmap [#4](https://github.com/tougenrip/thirdfold/issues/4).

| Milestone                          | Issue                                                   |
| ---------------------------------- | ------------------------------------------------------- |
| 11. The Hollow Bell vertical slice | [#25](https://github.com/tougenrip/thirdfold/issues/25) |
| 12. Character gameplay             | [#26](https://github.com/tougenrip/thirdfold/issues/26) |
| 13. Interaction system             | [#27](https://github.com/tougenrip/thirdfold/issues/27) |
| 14. Adventure state machine        | [#28](https://github.com/tougenrip/thirdfold/issues/28) |
| 15. Bellweather Village            | [#29](https://github.com/tougenrip/thirdfold/issues/29) |
| 16. Investigation system           | [#30](https://github.com/tougenrip/thirdfold/issues/30) |
| 17. The Monastery                  | [#31](https://github.com/tougenrip/thirdfold/issues/31) |
| 18. Advanced 3D interaction        | [#32](https://github.com/tougenrip/thirdfold/issues/32) |
| 19. Combat 1.0                     | [#33](https://github.com/tougenrip/thirdfold/issues/33) |
| 20. Enemy AI                       | [#34](https://github.com/tougenrip/thirdfold/issues/34) |
| 21. Visibility 2.0                 | [#35](https://github.com/tougenrip/thirdfold/issues/35) |
| 22. Lighting as gameplay           | [#36](https://github.com/tougenrip/thirdfold/issues/36) |
| 23. The Hollow                     | [#37](https://github.com/tougenrip/thirdfold/issues/37) |
| 24. The Hollow final boss          | [#38](https://github.com/tougenrip/thirdfold/issues/38) |
| 25. Ending system                  | [#39](https://github.com/tougenrip/thirdfold/issues/39) |
| 26. GM experience 2.0              | [#40](https://github.com/tougenrip/thirdfold/issues/40) |
| 27. Player UX                      | [#41](https://github.com/tougenrip/thirdfold/issues/41) |
| 28. Onboarding                     | [#42](https://github.com/tougenrip/thirdfold/issues/42) |
| 29. Audio                          | [#43](https://github.com/tougenrip/thirdfold/issues/43) |
| 30. Cinematic moments              | [#44](https://github.com/tougenrip/thirdfold/issues/44) |
| 31. Session recovery               | [#45](https://github.com/tougenrip/thirdfold/issues/45) |
| 32. Save / resume                  | [#46](https://github.com/tougenrip/thirdfold/issues/46) |
| 33. Session end                    | [#47](https://github.com/tougenrip/thirdfold/issues/47) |
| 34. Performance pass               | [#48](https://github.com/tougenrip/thirdfold/issues/48) |
| 35. Asset pipeline                 | [#49](https://github.com/tougenrip/thirdfold/issues/49) |
| 36. Content authoring              | [#50](https://github.com/tougenrip/thirdfold/issues/50) |
| 37. Custom table                   | [#51](https://github.com/tougenrip/thirdfold/issues/51) |
| 38. Adventure builder              | [#52](https://github.com/tougenrip/thirdfold/issues/52) |
| 39. Second adventure               | [#53](https://github.com/tougenrip/thirdfold/issues/53) |
| 40. Productization                 | [#54](https://github.com/tougenrip/thirdfold/issues/54) |

## Rules-system roadmap: D&D and campaigns (milestones 41–60)

The focused Claude implementation guide is [ROADMAP-RP-SYSTEM.md](ROADMAP-RP-SYSTEM.md).

The next roadmap extends the product after milestone 40. Its tracker is [#85](https://github.com/tougenrip/thirdfold/issues/85), under the overall roadmap [#4](https://github.com/tougenrip/thirdfold/issues/4). The milestone issues contain the problem statements, implementation plans, and completion criteria. Preserve the server-authoritative model and keep The Hollow Bell, The Last Train to Blackwater, and their existing saves working under their original rules.

| Milestone                                            | Problem addressed and planned outcome                                                                                             | Issue                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 41. Rules Engine Abstraction                         | Existing fixed character/action/status logic couples rules to adventures; put it behind a versioned server-side ruleset contract. | [#86](https://github.com/tougenrip/thirdfold/issues/86)   |
| 42. D&D 5.5e Ruleset                                 | The custom rules cannot resolve D&D checks, proficiency, advantage, and turns; implement the initial versioned ruleset.           | [#87](https://github.com/tougenrip/thirdfold/issues/87)   |
| 43. D&D SRD 5.2.1 Content Import                     | There is no traceable D&D catalog; deterministically import versioned SRD records with required attribution and provenance.       | [#88](https://github.com/tougenrip/thirdfold/issues/88)   |
| 44. D&D Character Model                              | Fixed adventure characters cannot store D&D choices and derived values; add versioned server-validated character instances.       | [#89](https://github.com/tougenrip/thirdfold/issues/89)   |
| 45. D&D Character Creator                            | Players can only choose four pregenerated characters; guide them through legal SRD character choices.                             | [#90](https://github.com/tougenrip/thirdfold/issues/90)   |
| 46. D&D Character Sheet                              | The current sheet only presents custom stats/actions; show D&D choices, calculated values, features, and live state.              | [#91](https://github.com/tougenrip/thirdfold/issues/91)   |
| 47. D&D Inventory & Equipment                        | Scene props are not character inventory and do not affect rules; add owned items and server-derived equipment effects.            | [#92](https://github.com/tougenrip/thirdfold/issues/92)   |
| 48. D&D Spell System                                 | Custom actions lack spell catalogs, slots, casting, saves, and concentration; implement SRD spell resolution.                     | [#93](https://github.com/tougenrip/thirdfold/issues/93)   |
| 49. D&D Conditions & Effects                         | Three custom statuses cannot represent timed, sourced D&D effects; add a reusable server-side lifecycle.                          | [#94](https://github.com/tougenrip/thirdfold/issues/94)   |
| 50. D&D Combat Integration                           | The current one-action turn loop is not D&D combat; integrate its action economy and resolution with the 3D table.                | [#95](https://github.com/tougenrip/thirdfold/issues/95)   |
| 51. D&D Monsters & Encounter System                  | Existing enemies are adventure-specific; import SRD monsters and enable GM encounter assembly.                                    | [#96](https://github.com/tougenrip/thirdfold/issues/96)   |
| 52. D&D Homebrew Engine                              | Creators cannot define D&D-compatible options; support versioned, typed, non-executable extensions to SRD content.                | [#97](https://github.com/tougenrip/thirdfold/issues/97)   |
| 53. Campaign Content Collections                     | The library publishes one adventure at a time; bundle compatible, version-referenced campaign content.                            | [#98](https://github.com/tougenrip/thirdfold/issues/98)   |
| 54. Content Permissions & Entitlements               | Public/unlisted library controls do not cover private, shared, or licensed content; enforce grants on the server.                 | [#99](https://github.com/tougenrip/thirdfold/issues/99)   |
| 55. Content Versioning                               | Adventure snapshots exist but rules/content dependencies are not all pinned; version packs and keep active saves immutable.       | [#100](https://github.com/tougenrip/thirdfold/issues/100) |
| 56. Rules/Data Validation                            | Existing validation misses cross-pack, license, and ruleset compatibility; unify creator and server diagnostics.                  | [#101](https://github.com/tougenrip/thirdfold/issues/101) |
| 57. D&D Adventure Authoring                          | The builder lacks rule-aware checks, rests, rewards, and encounters; add a validated D&D authoring path.                          | [#102](https://github.com/tougenrip/thirdfold/issues/102) |
| 58. D&D Campaign System                              | Recoverable rooms do not preserve a party across adventures; add campaign roster, history, and progression.                       | [#103](https://github.com/tougenrip/thirdfold/issues/103) |
| 59. External Content / Licensed Content Architecture | Different publishers have different access and attribution terms; add source adapters and enforce terms at use/export boundaries. | [#104](https://github.com/tougenrip/thirdfold/issues/104) |
| 60. Second Rules System                              | D&D alone does not prove multi-system support; implement a meaningfully different ruleset through shared play paths.              | [#105](https://github.com/tougenrip/thirdfold/issues/105) |

SRD scope note: use the official [SRD 5.2.1](https://www.dndbeyond.com/srd) source for D&D rules content, preserve its attribution, and exclude D&D Beyond Basic Rules and non-SRD book material.

---

## 3D rendering and visual fidelity (milestones 61–78)

The status of this track lives in its issues: the tracking issue is
[#107](https://github.com/tougenrip/thirdfold/issues/107), each milestone has an issue, and each
milestone's tasks are its sub-issues. This section is the source text, shortened from those issues.

### Direction

The owner's direction: massively improve the 3D render pipeline and the visuals, with skies,
day/night integrated into rendering, shaders and an advanced lighting system. The play area is no
longer a table in a void: the 3D space is a world of its own. The goal is to get as close as
possible to TaleSpire's look, HUD aside.

TaleSpire's look does not come from exotic rendering. It runs on Unity's built-in deferred pipeline,
and its look comes from four things:

- sculpted, hand-painted PBR art
- warm, cheap, unshadowed lights over a cool ambient
- one good cached sun or moon shadow
- a small fixed post stack: filmic tone mapping, ambient-only AO, bloom, a LUT grade, a tinted
  vignette, a little chromatic aberration, and depth of field in shots

So about half of the gap is art, not rendering, and the roadmap budgets for both.

### Principles and invariants

- **The server is authoritative.** Rules and fog secrecy stay on the server. Every layer builds only
  from what the viewer was sent, and passes the unexplored-is-black test.
- **The picture never contradicts the rules.** Rendered light matches `litMask` and `seenByLight`;
  the three-band ambient stays the rules input, derived from the time of day.
- **Render on demand.** The only non-idle frames are bounded converge frames and capped ambient
  frames.
- **No shader recompiles from runtime state.**
- **Instancing and lazy loading** for repeated geometry, three.js and assets.
- **Accessibility.** Reduced motion is honoured; a separate Reduce flashing setting caps every flash
  (WCAG 2.3.1); every colour cue has a shape or pattern twin.
- **WebGL2 always works.**

Every milestone is a runnable vertical slice: check, lint, test and build pass, and The Hollow Bell
and The Last Train to Blackwater both play start to finish.

### Tracks

- **Engine:** 62–64, 67–68, and the rendering work in 69–75.
- **World and Art:** 65 and 69–77. The art bible and surface library land in 65; commissions run as
  their own track from then on.
- **Data and GM:** 66, which can start right after 61.
- **Test, perf and platform:** through every milestone.

The rules track ([#85](https://github.com/tougenrip/thirdfold/issues/85), milestones 41–60) runs in
parallel. The two share the scene-file version (v10 in 66, against content versioning in
[#100](https://github.com/tougenrip/thirdfold/issues/100)), `Token.scale` against creature sizes
([#96](https://github.com/tougenrip/thirdfold/issues/96)), status effects' visuals
([#94](https://github.com/tougenrip/thirdfold/issues/94)), the Credits page
([#88](https://github.com/tougenrip/thirdfold/issues/88)) and the table and prop limits raised in 77.

### Work pipeline

- **Definition of done.** Check, lint, test and build pass; goldens change only on purpose; perf and
  bundle gates are green; the issue states its cost per tier and its WebGL2 behaviour; secrecy and
  unexplored-is-black tests cover anything new a viewer receives; both adventures still play; docs
  are updated. The closing PR adds the milestone's sentence to CLAUDE.md's "What this is".
- **Closer-shot gate.** Fixture tables recreate the reference shots, and a script measures the
  distance between our renders and the references. Each milestone must reduce it, or record why not,
  and the owner signs off. See `docs/LOOK.md`.
- **Golden images and perf gates.** Goldens in GM, player and spectator views; CI gates on draw
  calls, shader programs, memory, idle frames, leaks and bundle size. See `docs/RENDERING.md` and
  `docs/PERFORMANCE.md`.
- **Budgets and quality tiers.** Low, medium, high and ultra (WebGPU only), chosen from
  capabilities and a short warm-up, overridable per viewer. A tier switch is the only thing that
  rebuilds the pipeline.
- **Feature flags.** Per-layer switches in the tier table; `?backend=webgl` is the kill switch.
- **Scene-file policy.** One forward-only bump (v10, in 66), tested from every older version, with a
  backup before each deploy.

### Milestone 61: Render guardrails, baselines and look-dev lab

Issue [#108](https://github.com/tougenrip/thirdfold/issues/108). Depends on: nothing.

Make the current renderer measurable and protected before any pixel changes. Add deterministic render hooks, committed fixture tables with five reference compositions and per-viewer views, golden images in GM, player and spectator views, and CI gates on counters, idle frames, leaks and bundle size. Record real-GPU baselines and numeric look metrics against the references, write the reference board and the renderer ADR, split renderer.ts into modules, and fix the regressions the audits found.

**Why now.** No test creates the tabletop, and performance is only measured by hand. A regression has already slipped through: rolldown merged three.js core into a chunk the room page imports eagerly (163 kB gz instead of 36). The closer-shot gate is subjective with nothing to measure against. Every later milestone changes pixels and cost, so it needs a baseline and a number to move.

**Scope:**

- Tracking issue, label creation, milestone-to-issue table, ROADMAP.md section
- Bundle regression fix and a CI bundle-closure gate
- Injectable clock and test options for createTabletop
- Fixture tables with named poses, including the ref-1, ref-3, ref-6, ref-7 and ref-8 compositions
- Per-viewer fixture views generated in the server project
- Client-project smoke test and baseline-v0 goldens in GM, player and spectator views
- CI gates on counters, idle frames, leaks (table reloads and Tabletop remounts); real-GPU baselines
- Look metrics against the references
- docs/LOOK.md reference board and docs/RENDERING.md ADR
- Splitting renderer.ts into modules under 500 lines
- Version pinning
- Audit bug fixes (frozen mist, duplicated FLASH_MS)

**Done when:**

- CI fails if three.js is in the room page's static import closure, and the room page is back near 36 kB gz
- Goldens pass in the verify job on WebGL2 (SwiftShader) for every fixture, named pose and ambient band, in GM, player and spectator views
- Committed per-viewer fixture views fail CI when stale
- A CI perf job fails on draw calls above baseline +10%, a higher program count, memory above +10%, any frame drawn in 3 s idle, or leaks after three table reloads or three Tabletop remounts
- docs/PERFORMANCE.md records dGPU and iGPU numbers for the current renderer, and docs/look-metrics.json records the baseline distance to each reference with target palettes in LOOK.md
- renderer.ts is split into modules under 500 lines with goldens unchanged
- Under reduced motion the mist is hidden, and changing the OS setting takes effect without a reload
- Both adventures play start to finish, and the mist fix is the only golden change

### Milestone 62: Renderer foundation: WebGPURenderer, quality tiers, render scheduler and world scale

Issue [#109](https://github.com/tougenrip/thirdfold/issues/109). Depends on: 61.

Move every layer to three/webgpu at visual parity on both backends, behind a go/no-go spike and a forceWebGL kill switch. In the same milestone, build the plumbing every later feature relies on:

- capability detection and quality tiers with per-layer switches
- an IDLE, AMBIENT, ACTIVE and CONVERGE render scheduler
- pipeline precompiles
- recovery from context and device loss
- WebGPU-aware perf tooling
- a Graphics menu
  Also fix the world scale, so every later look is judged at its final proportions.

**Why now.** The post stack, TSL materials, DynamicLighting, SkyMesh and every other target feature exist only for WebGPURenderer. thirdfold has no custom GLSL, so porting is cheapest now. Budgets and the scheduler must exist before the first effect that spends them or animates. The scale decision changes fixtures, shots and goldens, so doing it once, here, avoids re-baselining every later look-dev strip.

**Scope:**

- Platform spike and go/no-go
- Per-light shadow caching
- three/webgpu port with async init and ?backend=webgl
- Clipping and point-size replacements
- WebGPU Info and timestamp perf API
- quality.ts tiers with per-layer booleans and ?off=, software/compat detection, pixel caps
- Render scheduler with live reduced-motion
- compileAsync warm-up
- Context and device loss recovery
- WebGPU golden job on lavapipe
- World scale decision (STEP_HEIGHT)
- Retune and single golden re-baseline
- Graphics menu, including the mobile sheet
- Per-tier budgets and accessibility requirements in RENDERING.md

**Done when:**

- Chrome renders through the WebGPU backend. ?backend=webgl, the Compatibility setting and Firefox Linux render through the WebGL2 backend
- Goldens on WebGL2 (SwiftShader) and WebGPU (lavapipe) match baseline v0 within tolerance, apart from the deliberate scale change
- STEP_HEIGHT is about 0.4, so walls are 2.0 u. Minis fit under walls, and eye and wall heights still match the sight rule in levels
- Orbiting the camera draws no shadow pass and idle draws 0 frames. Animated layers draw at most 20-30 fps in AMBIENT mode, pausing when the tab is hidden
- A test that loses the context rebuilds the same table with no errors
- A fresh browser picks a tier with no user input. SwiftShader and llvmpipe pick low. ?off=<layer> disables a layer
- The renderer chunk is within budget, the room page closure contains no three.js, and dice3d, dice-throw and shots specs still run in Node
- Both adventures play start to finish on both backends, and the device matrix passes

### Milestone 63: HDR colour pipeline and post-processing

Issue [#110](https://github.com/tougenrip/thirdfold/issues/110). Depends on: 62.

Give every frame the camera look of the references through one RenderPipeline:

- HDR MRT
- ambient-only AO
- bloom from emissives and HDR highlights
- a chosen tone mapper
- per-environment LUT grading tuned toward measured reference palettes
- a tinted vignette, subtle chromatic aberration, and grain and dither that keep true black
- per-tier AA
- depth of field for cinematic shots and an opt-in miniature mode
  Game-state visuals stay crisp in a post-exempt overlay pass, and every effect is a uniform.

**Why now.** This is the largest visible step per line of code, and it runs on both backends. Every later feature depends on bloom and grading being in place: flames, lava, neon, the Bell's flash, ring glow, torchlit walls. LUTs must be authored against a tone mapper that has already been chosen. Refs 3, 4 and 7 show visible depth of field, so the closer-shot gates from here on need it.

**Scope:**

- post.ts RenderPipeline with MRT prepass
- Post-exempt overlay pass
- Tone-mapper decision
- SSAO/GTAO via builtinAOContext
- Bloom from emissive plus HDR highlights
- Uber pass keeping true black
- LUT PNG strips per environment
- Per-tier AA with converge frames
- DOF and tilt-shift for shots and a Miniature toggle
- Graphics toggles
- Per-pass timings
- Interim grid and night look improvement
- Goldens per tier

**Done when:**

- In the torch room, AO darkens the wall-floor crease and the ground under crates, and torchlit faces stay bright
- Lanterns, fixtures and braziers bloom, and so does the torch-lit brick near the flame. Sunlit grass and plaster do not
- Each environment has its own grade, and look metrics move toward the target palettes. Labels, floats, highlights, previews and the beacon are never tinted, blurred or fringed
- Hidden fog-of-war cells still render exactly true black for players, with grain and dither on
- Cinematic shots show a focused depth of field. Play shows none unless the Miniature toggle is on
- After movement stops, TRAA on high converges within 32 frames and then no more frames are drawn
- Toggling CA, grain, vignette or DOF recompiles nothing, and changing tier rebuilds the pipeline without a reload
- Per-pass GPU ms per tier is recorded, and both adventures are playable

### Milestone 64: Material system and world-space visibility

Issue [#111](https://github.com/tougenrip/thirdfold/issues/111). Depends on: 62.

Build one closed set of TSL shader kinds with stable node graphs, sharing a worldModify node. Fog of war and darkness move from flat floor overlays into every material, including emissive output, and the node also carries the cut-plane uniform.

Add:

- soft, animated fog-of-war presentation
- a test that unexplored cells render black on every layer
- world-aligned mapping, anisotropic filtering, painted-mini surface detail and warm-up
- a test that fails if runtime state changes the program count

**Why now.** Terrain, kits, minis, water, vegetation and weather are all material work. The flat overlays already fail on walls, props and raised ground, and would fail everywhere once the world gains height. Sharing the kinds, the no-recompile rule and worldModify from the start avoids shading fog, darkness and weather twice.

**Scope:**

- materials/ factories per shader kind
- Program-count regression test across environments, slots and travel
- Cell maps + worldModify (fog, darkness, perception fill, cut, emissive dimming)
- Porting every layer onto the kinds
- Deleting overlay planes and shadeTerrain tints
- Soft fog edges, reveal fades, fog cloud
- Raw-frame secrecy test and the unexplored-is-black test
- Box/triplanar mapping, anisotropic filtering, paint noise, micro-offsets, anti-tiling
- Warm-up gallery built only from public data
- Docs

**Done when:**

- For players, walls, props, fixtures, minis, raised ground and their emissive glow render true black in unexplored cells, and dim and desaturated in explored-but-unseen cells. No overlay planes are left
- A client test reads back unexplored cell centres in each fixture's player view and finds exactly 0 on every tier
- In dark areas, walls and minis darken like the floor, and a cell the rules make visible never renders black
- The GM sees the party-sight tint on every surface
- A CI test cycles environments, ambients, floors, fog, darkness, light counts and table travel, and the program count stays constant
- Part-list minis and props show a painted-plastic sheen. Wall and raised-ground textures continue across instances and stay crisp at grazing angles
- All existing views and fog-secrecy tests pass unchanged, and both adventures are playable

### Milestone 65: Asset pipeline v2, art bible and surface library

Issue [#112](https://github.com/tougenrip/thirdfold/issues/112). Depends on: 62, 64.

Open the asset boundary to authored art safely and cheaply, and fix art direction before any art is commissioned. This covers:

- manifest v2 with per-kind budgets and provenance
- a structured GLB and KTX2 validator
- an offline cook step (gltf-transform, meshopt, LODs, pinned KTX2)
- a renderer-aware loader with a proper lifecycle
- licences, backfilled provenance and credits
- baked bevels and AO
- hardened content-hashed storage outside git
- packs with prefetch
- a base library of stylised PBR surfaces for every floor and wall
- a turntable, the catalogue as data with aliases, and one pilot asset shown in game

**Why now.** Roughly half the gap to TaleSpire is art, and checkGlb forbids every texture today. Art takes the longest, so the contract and licensing rules have to exist before commissions start. The terrain and kit milestones need tileable surface sets before environment art arrives, or they ship flat colours. This is also risky work: a security boundary, deterministic builds, repo size and legal exposure.

**Scope:**

- Art bible with sources, licences and briefs
- Manifest v2
- checkGlb rewrite plus standalone KTX2 checks
- Cook step
- KTX2/meshopt loader with lifecycle
- Provenance backfill and credits (shared with the rules track)
- Bevel/AO bake
- Hardened hosting
- Packs and prefetch from public data only
- Per-table budgets including the builder example
- Base stylised PBR surface library
- Turntable
- Catalogue as data with aliases
- Great bell pilot

**Done when:**

- A textured, normal-mapped great bell (KTX2, meshopt, 2 LODs) renders in the Hollow on both backends, with the part model shown until it loads
- pipeline.spec refuses malicious fixtures: uri, unknown extension, 16k texture, lying accessor, decode bomb, skins or animations, and a malformed standalone KTX2
- npm run assets builds identical bytes twice, and drift is still caught
- Every manifest entry carries an allowlisted licence, including backfilled existing assets. A Credits page lists asset authors, shipped code and fonts
- Every floor type and wall surface has a stylised 1K/2K KTX2 texture set with provenance
- Part-list models show bevels and baked AO
- Built binaries are served from immutable hashed storage and verified by hash on the client. Git keeps only the manifest and a hash lock. Native shells load a KTX2 model offline from the bundled core pack
- A v9 save and a story save that use an aliased prop id still load

### Milestone 66: World look data model, protocol and GM controls

Issue [#113](https://github.com/tougenrip/thirdfold/issues/113). Depends on: 61.

Define the world's look once as authoritative, versioned, validated data:

- WorldLook: continuous time, sky and grade as asset ids, weather, haze, backdrop, clock rate
- an interior cell mask
- each player's last-seen light states
- presentation fields on lights (including fire, neon and panel kinds), tokens and props

All of it ships in one forward-only scene-file v10 bump, with the world_set protocol, adventure effects, per-location looks for all three adventures, and GM panels. The three-band Ambient stays the rules input, derived from time through one helper.

**Why now.** Sky, lighting, roofs, weather and minis all read this data. Defining it once, early, and alongside the engine work avoids several scene-file bumps and protocol churn. Closing the explored-light leak needs persistence, which only v10 provides. It is playable on its own: the old presets blend by time until the sky lands.

**Scope:**

- world.ts
- Scene file v10 with discovery lights, migration and fixture regeneration
- world_set/world_update
- Ambient band derived on the server, ambient_set kept
- Visual fields on lights, tokens, props
- Interior mask with roof tool, bounds and secrecy
- Last-seen light state persisted per seat
- {world} effect, TableParts.world, builder
- Looks for The Hollow Bell, Blackwater and The Miller's Key
- Time and atmosphere panel
- Preset blending
- Light inspector
- Wording with wire aliases
- Forward-only deploy backup

**Done when:**

- The GM drags time to 21:00. Fog rules switch to dark exactly at the band edge for every player, with one public notice
- Underground tables keep their ambient when time changes, and ambient_set from an older bundle still works
- Every saved version v1-v9, live rooms, library adventure files and builder drafts load and migrate to v10. The {ambient} effect and Shot frame 'table' still work
- The interior mask never reaches a player for unexplored cells (raw-frame test)
- A player no longer sees a remembered torch change state out of sight, even after a server restart or a rejoin (raw-frame test)
- Backup and restore of saves, live rooms and the library are scripted and documented
- All three adventures set their per-location looks and play start to finish, and Communion no longer abuses ambient

### Milestone 67: Sky, day/night and leaving the table

Issue [#114](https://github.com/tougenrip/thirdfold/issues/114). Depends on: 63, 64, 66.

Replace the wooden slab floating in a void with a world under a sky. This covers:

- a pure atmosphere evaluator and sky presets tuned from measured targets
- a sky dome with sun, moon, stars and clouds
- a sun/moon light driven by time, and sky-derived IBL
- sky-tinted, capped height and distance fog
- a ground running to the horizon, and enclosed skies underground
- a sky-visibility mask that keeps dark areas dark at noon while roofed rooms stay lit indoors
- a Reduce flashing setting

**Why now.** This is the owner's headline request: skyboxes, day/night in the pipeline, no tabletop. It is now low-risk because the data (66), world-space visibility (64) and tone mapping (63) are in place. It needs only manifest v2 from 65, not all of 65. Lighting (68), the backdrop (69) and water (73) need sky IBL and fog colour to look right.

**Scope:**

- atmosphere-curve.ts
- Sky presets in the manifest from look-metric targets
- Sky dome
- Sun/moon light with threshold shadow redraws
- Throttled PMREM IBL
- scene.fogNode height/distance fog with a play-area cap
- Continuous curves replacing PRESETS and the lamp
- Sky-visibility mask with indoor ambient fill for roofed rooms
- Slab/rim/void removal and horizon ground
- Underground skies
- Flash coupling
- Reduce flashing setting
- GM selectors
- Software-GL floor and goldens

**Done when:**

- Dragging the time slider sweeps the sun across the sky, lengthens shadows, warms dusk, and turns night moonlit blue instead of brown. Sky and fog metrics move toward the target palettes
- From any camera angle there is no slab, rim or void, and the edge of the map fades into horizon haze. Haze never hides cells the rules show
- Metals and glossy surfaces respond to sky IBL, which is re-baked at most every 2-5 s
- A roofed village house at noon reads lit indoors. The sealed ringing chamber stays as dark as night on every wall and mini, and the Bell's flash lifts it for the server's flash window
- With Reduce flashing on, every flash becomes a fade of 500 ms or more carrying the same information
- The cavern and the Heart show no sky
- A full 24-hour sweep leaves the program count unchanged, and shadows redraw only when the sun moves at least 0.5 degrees
- Software GL shows a flat sky and stays usable. Goldens exist for dawn, noon, dusk and night, and both adventures are playable

### Milestone 68: Lighting, shadows and indirect light

Issue [#115](https://github.com/tougenrip/thirdfold/issues/115). Depends on: 64, 66, 67.

Make light the hero, as in TaleSpire.

- Many warm, unshadowed lights with a hot core and raking wall-mounted placement. They never shine through walls and always agree with the rules' lit mask.
- A crisp cached sun/moon shadow and a few hero point shadows.
- Shader flicker, fixture models with emissive flames, and coloured carried light.
- Neon and panel strips, and fake translucency.
- Exposure from game state, grid-derived bounce, and a probe grid on the high tier.

**Why now.** The fixed 8-light pool is already exceeded on the village and train tables, and the references need dozens of torches. Sky, IBL, materials and worldModify are in place, so lighting is built once on its final foundations.

**Scope:**

- Falloff helper with hot core and consistency spec
- Many-light spike then shipping it from the rule origin
- Fitted cached sun shadow
- Hero shadow slots
- Shader flicker
- Fixture models
- Neon and panel kinds
- Fake translucency
- Exposure
- Bounce and cavity
- LightProbeGrid
- Look tuning from metric targets

**Done when:**

- In the 40-torch dungeon, every torch lights a bright pool with a hot core, and sconces rake light across brick relief. No light passes through a wall, and adding or removing torches recompiles nothing
- A spec proves rendered falloff is above epsilon exactly on litMask cells, including elevation and windows
- A brazier near the camera focus casts mini shadows, and its cube redraws only when something within its radius changes
- Cultist lanterns and PC torches show their own colours. Neon strips and panels light their surroundings
- Tent canvas, candles and crystals glow when lit from behind
- The night courtyard shows warm brazier pools with specular on the cobbles against blue moonlight, moves toward the look-metric targets and passes the art review
- Both adventures are playable, and budgets hold on the iGPU

### Milestone 69: From the grid to a world: terrain, floors, void and backdrop

Issue [#116](https://github.com/tougenrip/thirdfold/issues/116). Depends on: 64, 65, 67.

Derive an organic 3D world from the grid data through a pure, tested world-shape contract:

- dual-grid ground in chunks
- stepped cliffs and risers
- per-pixel floor blending from the surface library
- void chasms whose look follows the backdrop
- a landscape beyond the grid per environment
- a shader grid with display modes
- logical DDA picking
- dice on real ground
- more floor types and drop-in animation
  The picture must never contradict movement or sight, and must never draw edges toward unexplored cells.

**Why now.** The table is gone (67). Boxes per raised cell, one flat colour per floor cell and 1px grid lines are now the most '2D VTT' elements left. Kits, camera cutaways, water and vegetation all build on this ground and its world-shape module.

**Scope:**

- world/shape.ts with invariant tests including unexplored continuation
- Dual-grid ground chunks
- Cliffs and risers
- Floor splat
- Void chasms following the backdrop
- Backdrop per environment
- Shader grid
- DDA picking
- Dice and previews on ground
- New floor types
- Drop-in animation

**Done when:**

- The monastery terraces and the Hollow's shore, island and steps render as rock or masonry cliffs, and one-level steps read as walkable
- Invariant tests pass:
- every token disk is flat at floorY
- diagonal saddles match canStep
- cliff tops sit at the higher floorY
- no decoration goes more than 0.08 cell into a walkable disk
- no cliff, kerb or rim is drawn toward an unexplored cell
- Floors blend with height-based transitions from the stylised surface library, with hard kerbs between man-made floors. Void cells are drops into mist, or the sea or moving ground where the backdrop says so
- The play area continues into an environment backdrop that fades into the sky, built only from scene-level data
- The grid shows fully in build mode, near the cursor or selection while exploring, and faint or off otherwise
- Picks return the same cells as before, including on raised ground. Clicks beyond the grid return no cell, and dice land on balconies
- Painting floors or terrain rebuilds only the touched 16x16 chunks within 3 ms each, and both adventures are playable

### Milestone 70: Architecture kits: walls, floor tiles, doors, windows, stairs, bridges and roofs

Issue [#117](https://github.com/tougenrip/thirdfold/issues/117). Depends on: 65, 66, 67, 69.

Turn edge walls, floors, level runs and rooms into built architecture:

- a kit schema with gothic and fortified roles, and wall thickness that clears bases
- pure edge autotiling and BatchedMesh walls with posts, caps and plinths
- man-made floors drawn as real tiles at their own scale (the grid is an overlay, never the seams)
- framed windows and doors
- stairs, bridges and railings
- gable, hip and cross-gable roofs from the interior mask that hide for occupants and for visible cells
- windows that glow after dusk
  Greybox kits cover every built-in environment, a CC0 bridge swaps placeholder props now, and the first commissioned kit (monastery) starts.

**Why now.** The world shape, the textured pipeline and the surface library exist. Walls, tile floors and roofs are most of the pixels in refs 1, 3, 6, 7 and 8. The camera cutaways (72) and content (76-77) need final wall, floor and roof geometry to work against.

**Scope:**

- Kit schema with roles and thickness rule
- Autotile
- BatchedMesh walls
- Windows and doors
- Kit floor tiles
- Stairs
- Bridges and railings
- Gable, hip and cross-gable roofs
- Roof hiding
- Glowing windows
- Greybox kits
- CC0 bridge
- Pilot commission
- Budget check

**Done when:**

- Walls show corner posts, T and X joints, caps and plinths on drops. Windows show frames with an open gap. No wall piece enters a walkable cell's base disk (invariant test)
- Stone, flagstone, cobble, plank and tile floors are chunky kit tiles with bevelled edges, grout gaps and broken pieces near drops at their own scale; the grid is drawn by the overlay, never by their seams
- A sealed secret door looks exactly like plain wall until found (test)
- Monastery and Hollow stairs read as stairs. The causeway and high bridge read as bridges with railings, with arches only over void
- Village houses have gable or hip roofs with ridge caps and chimneys. A roof fades when a viewer's token or the camera pivot is inside, or while any of its cells are visible to the viewer. Roofs over unexplored interiors stay
- After dusk, most windows glow and bloom without casting light beyond their own cell
- Every built-in environment has a complete greybox kit, and the most-seen props are textured CC0 bridge assets in one palette
- Draw calls and triangles stay within tier budgets on the village, the Hollow, ref-8 and the 64x64 fixture, and both adventures are playable

### Milestone 71: Miniatures, bases and dice

Issue [#118](https://github.com/tougenrip/thirdfold/issues/118). Depends on: 63, 64, 65, 66.

Make tokens read as painted miniatures, TaleSpire's signature look.

- Bases: thick, glossy, instanced and bevelled, with an owner-coloured emissive inset ring and a notched rim for enemies.
- Figures: batched, using the mini shader kind (wash, drybrush, varnish, rim).
- Names shown only on demand, with contrast; a lit turn indicator; visual base sizes that never cover other minis.
- Contact shadows, wall-clock motion, static poses, LOD selection and PBR dice.
  It also starts the character-mini commissions and an AI-assisted pilot.

**Why now.** Minis are the focus of every reference and the weakest element of the baseline: pawns on thin discs with floating labels. Batching them now removes WebGPU's per-object overhead before x-ray, drag and combat VFX build on the token layer.

**Scope:**

- Instanced ringed bases with CVD-safe cues
- Batched figures
- Mini shader kind
- Labels on demand with contrast
- Turn indicator
- Visual scale with overlap shrink
- Contact shadows
- Motion
- Poses
- LOD selection
- PBR dice
- Character commissions
- AI pilot
- Goldens

**Done when:**

- Every token stands on a thick glossy base whose inset ring glows in its owner's colour. Enemies are red with a notched rim. The ring brightens on hover and selection and pulses on its turn, and the owner palette passes colour-vision simulation
- No floating labels by default. Names appear on hover, selection, the active turn, while a held key is down, or always if the Graphics option is set. They stay crisp at DPR 2 with 4.5:1 contrast
- The Keeper, the Hand and the Heart stand on larger bases, which shrink when another mini stands in a covered cell
- Minis stay grounded by contact shadows under torchlight
- Dice land on the rolled face (tests)
- Token draw calls no longer grow per token
- The four characters use commissioned sculpts. The grass-minis fixture passes art review and moves toward ref 7's metrics. Both adventures are playable

### Milestone 72: Camera, occlusion and interaction feedback

Issue [#119](https://github.com/tougenrip/thirdfold/issues/119). Depends on: 69, 70, 71.

Give the world a TaleSpire camera and make play readable in 3D:

- TaleSpire's control scheme
- a pure camera rig with a diorama FOV and pitch per mode
- a storey-snapped cut plane and Sims-style wall cutaway
- dithered occluders and x-ray silhouettes
- colour-vision-safe reach, range, path and area overlays on known ground
- move previews, drag-to-move and touch gestures
- camera modes including eye level, and a spring arm
- picking that respects every cut

**Why now.** The world, kits, roofs and batched minis exist, so every occlusion technique can target its final geometry once. Walls, terraces, trees and roofs now hide minis, so play needs this before content fills the tables. Moving the build hotkeys off WASD early, before GMs learn them, avoids a second re-learning later.

**Scope:**

- Controls remap, hotkey move, held grid key
- camera-rig.ts with FOV and pitch per mode
- Cut plane
- Wall cutaway
- Dither capsule
- X-ray
- CVD-safe overlay texture on known ground
- Path preview
- Drag-to-move
- Touch
- Camera modes and view migration
- Spring arm
- Picking predicates

**Done when:**

- Left mouse selects and drags minis, right mouse pans, and middle mouse or Alt rotates. WASD, Q/E and PageUp/PageDown move the camera, and holding G shows the full grid. GM build tools no longer collide with these keys, and the tutorial is updated
- The first framing sits close to the viewer's party at a 25-35 degree pitch. The pivot follows floor heights, and the camera never enters terrain
- The cut plane reveals the monastery's gallery and belfry storeys. Walls between the camera and the focus lower to stubs
- Minis behind walls, trees or roofs stay visible through dithering or x-ray silhouettes. Clicks pass through cut, lowered and dithered geometry
- A selected mini shows its reach and range as blue/orange contours with solid, dashed and hatched patterns, only over explored ground. Hovering shows the path, a step count and a ghost mini
- Touch pan, pinch and twist work in Capacitor Android. Idle still draws 0 frames, and both adventures are playable

### Milestone 73: Water and liquids

Issue [#120](https://github.com/tougenrip/thirdfold/issues/120). Depends on: 67, 68, 69.

Replace flat blue squares and dark water sheets with stylised water like ref 5:

- shore distance fields and water bodies with banks
- depth colour and see-through shallows
- foam, ripples and sky reflection
- a clear look difference between blocking and walkable water

The Hollow's lake becomes one surface without changing its rules. Add waterfalls and rivers, a sea to the horizon for coastal backdrops, and lava as short-radius server light with glowing cracks and a lava chasm style. On the high tier, add refraction, depth foam and caustics, with no extra full-scene renders.

**Why now.** The world shape, sky IBL, fog and the many-light path now exist, and water and lava need all of them. The Hollow's black lake and coastal custom tables need water before content is dressed.

**Scope:**

- Shore SDF with unknown-as-water
- WaterLayer with see-through shallows and passable/blocking looks
- Hollow lake via water props
- Waterfalls and flow
- Sea surround
- Lava as server light, lava materials and chasm style
- High-tier refraction and caustics
- Coast look-dev

**Done when:**

- Water shows a shallow-to-deep gradient with the bed visible through the shallows, white foam at shores and around rocks, and gentle ripples reflecting the sky, frozen under reduced motion
- Blocking water renders deep and opaque. Walkable water renders shallow with a visible bed and wading ripples (a test drives this from obstaclesFor)
- No foam line forms at the explored boundary
- The Hollow's lake is one black-teal surface whose rim brightens on the flash. Its routes and blocking are unchanged (hollow.spec, story.spec)
- Level drops between water cells show waterfalls. Coastal backdrops show a sea swelling to the horizon
- Lava cells glow and bloom and light nearby cells, consistently with the rules. Lava chasms show a molten sea. The ref-3 fixture gains lava
- Water adds no full-scene renders on low or medium, and animates only while visible
- The coast golden passes art review against ref 5, and both adventures are playable

### Milestone 74: Vegetation, scatter, jitter and decals

Issue [#121](https://github.com/tougenrip/thirdfold/issues/121). Depends on: 62, 64, 65, 68, 69.

Make outdoor tables dense and alive with no extra authoring and no network traffic.

- A shared wind field drives GPU grass grown from the floor map, which parts around minis and never hides them.
- Trees and bushes become leafy clump canopies with translucency.
- Deterministic scatter follows floor type, and decor props jitter within their footprints.
- An instanced decal layer adds grime and scorch.
- Density scales per tier.

**Why now.** The world, the scheduler, the materials and translucency are ready. The village, the churchyard and any outdoor custom table still read as diagrams until the ground is dressed and props stop looking snapped to the grid (refs 1, 3, 5, 6, 7). The content milestones rely on this automatic dressing.

**Scope:**

- Wind field
- Pipeline wind/foliage support
- GPU grass with a height cap and parting
- Leafy clump trees and bushes
- Scatter rules
- Decor prop jitter
- Decal layer
- Tier policy
- Vegetation art sets
- Goldens

**Done when:**

- Grass cells grow opaque, wind-swept blades no taller than 0.15 cell that part around minis and fade with distance. Plain village cells count as grass through the environment's default ground
- Trees and bushes read as leafy painted clumps that glow when backlit
- Wall bases, cliff feet and shores get deterministic tufts, pebbles, moss and reeds, identical on every client and never taller than 0.15 cell on walkable cells
- Crates, barrels, rubble and rocks sit at slightly free angles within their cells, identically on every client, with no rules or wire change
- Swaying never redraws the sun shadow, and idle stays at 0 frames when nothing animated is visible
- On the 64x64 outdoor fixture the low tier holds its budget on the iGPU, and both adventures are playable

### Milestone 75: VFX, particles and weather

Issue [#122](https://github.com/tougenrip/thirdfold/issues/122). Depends on: 63, 66, 67, 68, 71, 74.

Add the living, emissive effects of the references as presentation derived from synced state, log entries and placed effect props:

- a stateless GPU particle layer and stylised fire
- combat and ability VFX computed like the audio cues, with attacker ids redacted per viewer
- data-driven status visuals on bases
- the toll and flash rebuilt
- GM-placeable fire, smoke, steam, magic and lightning, with chimney sockets
- ambient motes
- a shared server clock
- GM weather: rain and snow that stop at roofs and never fall over black cells, wet surfaces and snow cover, photosensitivity-safe lightning, cloud shadows, an optional running clock that survives restarts, and weather audio

There is no VFX network traffic. Positions only ever come from what the viewer can see.

**Why now.** Bloom, the sky, WorldLook weather, the interior mask, fire lights, wind, decals and batched bases all exist. Fire is the main light source in refs 1, 3, 4 and 6, and refs 3, 4 and 8 show fires, lightning and chimney smoke placed by hand. Combat feedback is the last visual gap in play.

**Scope:**

- Particle layer
- Fire
- vfxFor and redacted attacker fields
- Combat effects
- Status VFX from status data
- Toll and flash
- Motes
- GM-placeable effect props and fx sockets
- Rain/snow respecting fog
- Wet and snow materials with base wetness
- Server clock offset
- Lightning and cloud shadows
- Running clock with restart
- Weather audio
- Soft particles and haze

**Done when:**

- Every lit fixture, brazier, fire-kind light and carried torch shows a stylised flame that breathes with its light
- Hits, misses, heals, guards and burns show effects on the right tokens when the damage floats appear. A hidden attacker's id never reaches players (raw-frame test)
- Statuses from any adventure show on bases from their data and survive a reconnect
- The toll raises lit dust and a shockwave around the Bell, and the 420 CPU dust points are gone
- A GM places a floor fire (which also lights cells) or a smoke column, and chimneys smoke
- The GM sets rain: every client sees the same storm at the same moment with no extra traffic. Rain stops at roofs and interiors and never falls over black cells, cobbles darken and gloss, and lightning has at least 4 s between strikes and respects Reduce flashing
- A running clock survives a server restart and keeps flipping bands on time
- Particles cost almost no CPU, idle returns to 0 frames when effects end, and both adventures are playable

### Milestone 76: The Hollow Bell in full art

Issue [#123](https://github.com/tougenrip/thirdfold/issues/123). Depends on: 68, 70, 71, 72, 73, 74, 75.

Replace The Hollow Bell's placeholders with authored art that follows the art bible:

- village, monastery, Hollow and Heart kits
- dedicated NPC figures and enemy minis
- hero and catalogue props
- static dressing batched per chunk
- dressed tables and finale VFX
- retuned shots and chapter looks
  Each table is reviewed against the references and look metrics, and the whole story is verified on every tier and backend.

**Why now.** Every engine system and the pipeline are now final, so the art is authored once for the final shading. Commissions ran in parallel from milestone 65, and this milestone integrates them. Dressed tables are the first real density test, so chunk batching lands here.

**Scope:**

- Village kit
- Monastery kit completion
- Hollow and Heart kit
- NPC minis
- Enemy minis
- Hero props
- Remaining catalogue props
- Chunk batching and shadow proxies
- Table dressing
- Finale VFX
- Shots
- Chapter looks
- Art review
- Playthrough gate

**Done when:**

- Bellweather, the monastery, the Hollow and the Heart are dressed with authored or licensed kits, tile floors, roofs, lights, looks and scatter. No part-list placeholder is visible in a normal playthrough
- Every NPC and every enemy (Hound, Cultist, Keeper, tendrils, the Hand, the Heart) is a painted mini within budget
- Static dressing is batched per chunk with shadow proxies, and draw calls hold per tier on every Hollow Bell table
- Every asset has an allowlisted licence and credit, and the per-table budgets pass
- The art review signs off each table against its paired reference, and look metrics improve
- Story, village, monastery, hollow, finale and endings specs pass with the rules unchanged. The full story plays on low, medium and high on both backends, with a golden for each chapter

### Milestone 77: Blackwater, starter kits, generic minis and creator-facing assets

Issue [#124](https://github.com/tougenrip/thirdfold/issues/124). Depends on: 76.

Bring The Last Train to Blackwater to the same standard: railcar and locomotive, ghost town and desert, passengers and the dead, and a prairie moving past the windows.

Give GMs and creators the new world:

- fantasy starter kits for custom tables, including a town and a gothic set
- a generic miniature library with a figure picker
- a categorised prop palette with thumbnails
- raised table and prop limits for dense worlds
- environments, looks and backdrops in the builder
- asset validation for library adventures

**Why now.** Both built-in adventures must reach the goal. Custom tables and the library are the platform, so the new visuals must be usable by GMs and creators, not only by the built-in stories. The density of refs 4 and 8 is impossible within today's 64-cell and 500-prop limits.

**Scope:**

- Railcar/locomotive kit and props
- Ghost town and desert kit
- Blackwater minis
- Prairie backdrop (void stays void)
- Blackwater dressing
- Starter kits including town and gothic
- Generic mini library and figure picker
- Prop palette
- Builder environments and looks
- Raised table and prop limits
- Library validation
- Playthrough gate

**Done when:**

- The train's four cars, the locomotive and the ghost town are dressed. The prairie scrolls past at night, and midnight's lamps-out shows moonlight through the windows
- Every passenger, the vanished man, the dead and the engineer are painted minis
- A GM can build a torch-lit dungeon, a forest clearing, a palisade outpost, a gothic hall or a walled town with tiled roofs on a new table from starter kits, and it passes art review against refs 1, 4, 5, 6 and 8
- A GM can pick from 40 or more generic painted figures by thumbnail and search
- Tables up to 100x100 with 3000 props hold the medium tier's budget
- The Build panel shows categorised props with thumbnails, and the builder sets environments, world looks and backdrops per scene
- Publishing a library adventure checks asset references and budgets
- blackwater.spec passes unchanged, and the adventure plays on every tier with a golden per chapter

### Milestone 78: Photo mode, ultra tier and platform hardening

Issue [#125](https://github.com/tougenrip/thirdfold/issues/125). Depends on: 72, 75, 77.

Finish the overhaul.

- Add photo mode, a GM-pushed camera shot and adaptive resolution.
- Add WebGPU ultra extras: clustered lights, SSGI, water SSR, light shafts.
- Set mobile memory budgets and harden the native shells.
- Audit reduced motion, flash safety and colour-vision legibility, and run the device matrix.
- Remove dead table-era code, lock the CI gates, and finish the docs.
- Record the final comparison with the references.

**Why now.** All content and systems are in place. What remains is polish, and proof that the result runs everywhere the bundle ships without decaying one PR at a time.

**Scope:**

- Photo mode
- GM camera shot with bounds
- Adaptive resolution
- Ultra extras
- Mobile budgets
- Shell hardening
- Motion, flash and colour-vision audit
- Device matrix
- Dead-code removal and final gates
- Docs
- Final comparison

**Done when:**

- Photo mode captures a PNG with free-fly or top-down view, focused DOF and a local-only atmosphere, and syncs nothing
- The GM can push a rate-limited, bounded shot to players, optionally locked
- The medium tier holds 60 fps on an Iris Xe or M1-class iGPU in the village and Hollow playthroughs, and the low tier holds 30 on a mid-range Android phone. Dynamic resolution holds these budgets without visible popping
- The ultra tier on WebGPU adds clustered lights, SSGI, water SSR and light shafts. Lower tiers are unchanged
- Every animated effect passes the reduced-motion, Reduce flashing and colour-vision audits
- The device matrix passes and its results are recorded
- CI gates are locked to the final budgets, and dead table-era code is gone
- Docs describe the new renderer, and the final side-by-side and look metrics are in LOOK.md. Both adventures play on every backend and tier

### Rendering execution queue

| #   | Milestone                                                                            | Depends on                 | Issue                                                     |
| --- | ------------------------------------------------------------------------------------ | -------------------------- | --------------------------------------------------------- |
| 61  | Render guardrails, baselines and look-dev lab                                        | –                          | [#108](https://github.com/tougenrip/thirdfold/issues/108) |
| 62  | Renderer foundation: WebGPURenderer, quality tiers, render scheduler and world scale | 61                         | [#109](https://github.com/tougenrip/thirdfold/issues/109) |
| 63  | HDR colour pipeline and post-processing                                              | 62                         | [#110](https://github.com/tougenrip/thirdfold/issues/110) |
| 64  | Material system and world-space visibility                                           | 62                         | [#111](https://github.com/tougenrip/thirdfold/issues/111) |
| 65  | Asset pipeline v2, art bible and surface library                                     | 62, 64                     | [#112](https://github.com/tougenrip/thirdfold/issues/112) |
| 66  | World look data model, protocol and GM controls                                      | 61                         | [#113](https://github.com/tougenrip/thirdfold/issues/113) |
| 67  | Sky, day/night and leaving the table                                                 | 63, 64, 66                 | [#114](https://github.com/tougenrip/thirdfold/issues/114) |
| 68  | Lighting, shadows and indirect light                                                 | 64, 66, 67                 | [#115](https://github.com/tougenrip/thirdfold/issues/115) |
| 69  | From the grid to a world: terrain, floors, void and backdrop                         | 64, 65, 67                 | [#116](https://github.com/tougenrip/thirdfold/issues/116) |
| 70  | Architecture kits: walls, floor tiles, doors, windows, stairs, bridges and roofs     | 65, 66, 67, 69             | [#117](https://github.com/tougenrip/thirdfold/issues/117) |
| 71  | Miniatures, bases and dice                                                           | 63, 64, 65, 66             | [#118](https://github.com/tougenrip/thirdfold/issues/118) |
| 72  | Camera, occlusion and interaction feedback                                           | 69, 70, 71                 | [#119](https://github.com/tougenrip/thirdfold/issues/119) |
| 73  | Water and liquids                                                                    | 67, 68, 69                 | [#120](https://github.com/tougenrip/thirdfold/issues/120) |
| 74  | Vegetation, scatter, jitter and decals                                               | 62, 64, 65, 68, 69         | [#121](https://github.com/tougenrip/thirdfold/issues/121) |
| 75  | VFX, particles and weather                                                           | 63, 66, 67, 68, 71, 74     | [#122](https://github.com/tougenrip/thirdfold/issues/122) |
| 76  | The Hollow Bell in full art                                                          | 68, 70, 71, 72, 73, 74, 75 | [#123](https://github.com/tougenrip/thirdfold/issues/123) |
| 77  | Blackwater, starter kits, generic minis and creator-facing assets                    | 76                         | [#124](https://github.com/tougenrip/thirdfold/issues/124) |
| 78  | Photo mode, ultra tier and platform hardening                                        | 72, 75, 77                 | [#125](https://github.com/tougenrip/thirdfold/issues/125) |
