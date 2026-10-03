# Homebrew packs

A homebrew pack adds your own weapons, armor, spells and monsters to the fifth edition rules (`dnd-5.5e`, the SRD 5.2.1) for one story. It extends the SRD catalog without changing it. Every SRD record keeps its id, its words, its source and its credit. A pack's records sit beside them under ids of their own.

The example is `content/homebrew/cold-hill-armory.json`, made for The Barrow on Cold Hill. It holds a blade, a coat, two spells and a monster.

## Using one

1. The GM starts a story under the fifth edition rules (The Barrow on Cold Hill, or a creator's adventure that uses them).
2. The GM opens the Adventure panel, then Homebrew, and picks **Add homebrew from a file…**.
3. The server checks every field. If anything is wrong, it says what and where (`records[2].mechanics.save.ability: one of str, dex, …`) and nothing is added.

Once a pack is added:

- Everyone at the table sees it listed: its name, version, creator, licence and what it holds.
- The character creator offers its weapons, armor and spells, each marked `Homebrew: <pack> <version>`.
- The GM's Direct panel finds its monsters, listed first, and the GM can give out its gear.
- None of it is offered at any other table.

A save of the story carries the pack as written. Loading the save checks the pack again before anything that uses it.

**Put away** takes a pack out of the story. It is refused while anything uses the pack: a character who carries or knows something from it, gear from it lying on the table, or its monsters brought into the story.

## Publishing one

A pack can also go in the library, where a collection can include it (see "Collections" in `docs/ADVENTURES.md`).

1. On the library page, open "Your homebrew and collections".
2. Pick **Publish homebrew from a file…**.

The server checks the pack in full, as it does at a table, and keeps it as read. Publishing it again makes a new version.

## The format

A pack is plain JSON. No field holds code:

- Dice are written `NdX` or `NdX + M`, with X one of 4, 6, 8, 10, 12 or 20.
- Numbers are whole and bounded.
- Words that look like markup, a template or code (`<…`, `${`, `{{`, `=>`, `javascript:`) are refused.
- A field the format doesn't name is refused.
- A pack is at most 128 KB with at most 64 records.

```json
{
	"format": "thirdfold-homebrew",
	"formatVersion": 1,
	"name": "The Cold Hill Armory",
	"version": "1.0",
	"rules": { "id": "dnd-5.5e", "version": 1 },
	"base": { "source": "srd-5.2.1", "version": "5.2.1", "sha256": "8974902d…" },
	"creator": "Your name",
	"about": "What it is for.",
	"license": "CC0-1.0",
	"records": []
}
```

`base` pins the SRD the pack extends, by its source file's hash (`content/srd/5.2.1/catalog/manifest.json`).

Each record has a `kind`, a `slug` (lowercase words joined by hyphens, unique among the pack's records of its kind), a `name` and an optional `text`. A record may not take the name of an SRD record of the same kind: a homebrew "Longsword" is refused. It can't pass for the SRD's.

### weapon

| Field        | Type                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| `category`   | `simple` or `martial`                                                                 |
| `type`       | `melee` or `ranged`                                                                   |
| `damage`     | Dice, or a flat number                                                                |
| `damageType` | `Slashing`, `Fire`, …                                                                 |
| `properties` | From Ammunition, Finesse, Heavy, Light, Loading, Reach, Thrown, Two-Handed, Versatile |
| `range`      | `{ normal, long }` in feet, for a ranged, Thrown or Ammunition weapon                 |
| `versatile`  | The two-handed dice, for a Versatile weapon                                           |
| `ammunition` | `Arrow`, `Bolt` or `Needle`, for an Ammunition weapon                                 |
| `mastery`    | One of the SRD's eight mastery properties                                             |
| `weight`     | Pounds                                                                                |
| `cost`       | Gold pieces                                                                           |

A class's weapon training covers a homebrew weapon by its category, as it does the SRD's.

### armor

| Field                 | Type                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ |
| `category`            | `light` (base 10–14), `medium` (11–16), `heavy` (13–20) or `shield` (a bonus of 1–3) |
| `base`                | The base Armor Class, by the ranges in `category`                                    |
| `strength`            | Heavy armor only, optional                                                           |
| `stealthDisadvantage` | `true` or `false`                                                                    |
| `weight`              | Pounds                                                                               |
| `cost`                | Gold pieces                                                                          |

Dexterity counts by category, as in the SRD: all of it for light armor, up to 2 for medium, none for heavy.

### spell

| Field           | Type                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `level`         | 0 for a cantrip, up to 9                                                       |
| `school`        | An SRD school                                                                  |
| `classes`       | SRD class names that may prepare it                                            |
| `castingTime`   | `Action` or `Bonus Action`                                                     |
| `range`         | `Self`, `Touch` or `60 feet`                                                   |
| `duration`      | `Instantaneous`, or `1 minute` (`up to 1 minute` when `concentration` is true) |
| `concentration` | `true` or `false`                                                              |
| `components`    | `{ verbal, somatic, material }`                                                |
| `mechanics`     | Optional; how the table casts it                                               |

A spell without `mechanics` is listed on the sheet and not cast. `mechanics` uses the terms the SRD's own spells are played by:

| `resolve` | Needs                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| `attack`  | `attack` (`melee` or `ranged`) and `damage`                                                                     |
| `save`    | `save` (`ability` and whether a success takes `half`), with `damage` or `onFail.conditions` (SRD condition ids) |
| `heal`    | `heal` (`dice`, `perSlot`); its targets are allies                                                              |
| `auto`    | `damage`, which always lands                                                                                    |

Every kind of mechanics also takes:

- `targets`: `count`, `perSlot` (more targets for each slot level above the spell's) and `side`.
- `damage.perSlot`: more dice for each slot level above the spell's.
- `cantrip: true`: a damage cantrip's dice grow at levels 5, 11 and 17.
- `area`: a `cone` or `cube` from a caster whose range is Self, or a `sphere` around a point in range.
- `push`: feet a target is pushed on a failed save.

### monster

| Field                            | Type                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `size`                           | `Tiny` … `Gargantuan`                                                                                                                            |
| `type`                           | The creature type                                                                                                                                |
| `alignment`                      | Optional                                                                                                                                         |
| `armorClass`                     | A number                                                                                                                                         |
| `hitPoints`                      | A number                                                                                                                                         |
| `speed`                          | Feet                                                                                                                                             |
| `abilities`                      | All six scores                                                                                                                                   |
| `saves`                          | Optional; proficient saves' bonuses, the rest are the modifiers                                                                                  |
| `challenge`                      | A rating the SRD has; the monster's XP and Proficiency Bonus come from the SRD                                                                   |
| `darkvision`                     | Optional                                                                                                                                         |
| `immune`, `resist`, `vulnerable` | Damage types                                                                                                                                     |
| `conditionImmune`                | Condition ids                                                                                                                                    |
| `traits`                         | Shown, and listed as not played                                                                                                                  |
| `attacks`                        | Each a name, `melee` with `reach` or `ranged` with `range`, `toHit`, `damage`, `damageType`, optional `plus` damage of another type, and `prone` |
| `multiattack`                    | Optional; `{ attack, times }`                                                                                                                    |

The pack's monster is written out as an SRD stat block and read by the same code as the SRD's monsters. Each one must have an attack the table can play.

## Ids and versions

A pack's id is `hb-` followed by the start of the SHA-256 of the pack as read. The same pack has the same id wherever it goes. Changing anything makes a new pack with a new id.

A record's id is `<pack id>:<kind>:<slug>`. A monster's kind at the table is `<pack id>-<slug>`.

A character built from a pack carries those ids, so it names exactly the pack it was made from. A save whose pack was edited no longer matches its characters, and is refused.

Only the GM who added a pack, at that table, shares it. The story records the GM's public creator id (never the key) and `visibility: "table"`. Milestones 53–55 build on that: collections, grants and versions.
