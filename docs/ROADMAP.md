# Thirdfold: post-MVP product roadmap

> Each milestone below is a GitHub issue under the post-MVP tracking issue [#24](https://github.com/tougenrip/thirdfold/issues/24); see [Tracking](#tracking) at the end for the full list. The issues show the current status. This file is the source text they were written from.

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
