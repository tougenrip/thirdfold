# Assets

Everything thirdfold draws or plays that isn't rules: models of props and figures, textures,
materials, the look of each place, and sounds. Assets are authored in `assets/`. The asset pipeline
(`server/assets/`) builds them into `static/assets/`, along with a manifest the client reads. The
Hollow Bell is the reference: every prop, figure, place and bell it uses comes through here.

```bash
npm run assets          # build assets/ into static/assets/ (commit both)
npm run assets:check    # fail if static/assets/ or the lock isn't what assets/ builds (a test checks this too)
npm run assets:cook     # cook art/ into assets/ (see Cooking art); -- --check only compares hashes
npm run assets:publish  # upload new built files and texture detail's variants to the asset store
npm run assets:pull     # download built files and variants missing here from the asset store
```

Build with Node 22, as CI does (`npx -y node@22 node_modules/tsx/dist/cli.mjs server/assets/build.ts`
when your Node is newer): Node 26 bundles zlib-ng, whose deflate writes different PNG bytes, so
the built files would not match CI's.

## Sources

| Kind                             | Source                                                                                 | Built into                         |
| -------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- |
| The prop catalogue               | `assets/catalog.json` (see Catalogue)                                                  | `src/lib/game/catalog.ts`          |
| Props                            | `assets/models/prop/<id>.json`                                                         | `models/<id>.<hash>.glb`           |
| Characters                       | `assets/models/character/<id>.json`                                                    | `models/<id>.<hash>.glb`           |
| NPCs                             | `assets/models/npc/<id>.json`                                                          | `models/<id>.<hash>.glb`           |
| Enemies                          | `assets/models/enemy/<id>.json`                                                        | `models/<id>.<hash>.glb`           |
| Kit, foliage, decor, effects     | `assets/models/{kit,foliage,decor,fx}/<id>.json`                                       | `models/<id>.<hash>.glb`           |
| Any model made elsewhere         | `assets/models/<kind>/<id>.glb` (`<id>.meta.json`: swing, set piece, pack)             | copied, after checking             |
| A model's preview                | `assets/models/<kind>/<id>.preview.json` (a part list)                                 | `previews/<id>.<hash>.glb`         |
| Materials                        | `assets/materials.json`                                                                | the manifest                       |
| Textures                         | `assets/textures/<id>.json` (a recipe) or `<id>.png`/`.ktx2` (`<id>.meta.json`: usage) | `textures/<id>.<hash>.png`/`.ktx2` |
| Environments (how a place looks) | `assets/environments/<id>.json`                                                        | the manifest                       |
| Architecture kits (#250)         | `assets/kits/<id>.json`                                                                | the manifest (inline)              |
| Skies (#213)                     | `assets/skies/<id>.json` (with its own `provenance`)                                   | the manifest (inline)              |
| Colour grades                    | `assets/grades/<environment>.json`                                                     | `textures/grade-….png` (54)        |
| Audio                            | `assets/audio/<id>.json` (a bell) or `<id>.wav` / `<id>.ogg`                           | `audio/<id>.<hash>.wav\|ogg`       |

Ids are lowercase letters, digits and dashes, and they are the file names. Name an asset by how
it looks (`robed-figure`, `giant-hand`, `cavern`), not by its part in a story. The manifest is
public, so a story's name for something would give it away.

What art must look like, where it may come from and on what terms is in `docs/ART.md`, the art bible.

### Scale

thirdfold's world scale is fixed (milestone 62, #152): **1 cell = 1 unit = 5 ft**. A level of
raised ground is 0.4 units (2 ft, `STEP_HEIGHT` in `src/lib/tabletop/ground.ts`), a wall stands
2.0 units (10 ft) above the higher floor beside it, and the sight rule's eye is 1.2 units (6 ft)
up. The rules count in levels, never in units, so the picture and the rules always agree.

Model everything at that scale:

| What                         | Height, units | Feet     |
| ---------------------------- | ------------- | -------- |
| A person (a figure as drawn) | 1.15-1.3      | 5.75-6.5 |
| A door, a wall               | 2.0           | 10       |
| A table, a crate             | 0.6-0.8       | 3-4      |
| A bookshelf                  | 1.8           | 9        |
| A lamp on a post             | 1.5           | 7.5      |
| One level of raised ground   | 0.4           | 2        |

Figures made before this (0.7-1.24 tall) are drawn 1.3 times larger (`FIGURE_SCALE` in
`tokens.ts`) until they are remade at their real heights (#118). A Large creature covers 2×2 cells
and stands about 10 ft tall.

### Models from parts

A model is primitive parts, the same boxes, cylinders, spheres and cones the table has always
been made of:

```json
{
	"parts": [
		{ "shape": "cylinder", "size": [0.34, 0.5, 0.3], "at": [0, 0.25, 0], "accent": true },
		{ "shape": "sphere", "size": [0.3, 0.32, 0.3], "at": [0, 0.72, 0], "color": "#d8a47f" },
		{ "shape": "box", "size": [0.06, 0.46, 0.4], "at": [-0.24, 0.36, 0], "material": "oak" }
	],
	"swing": { "pivot": 2.55, "throw": 0.5 }
}
```

- **Units are cells.**
  - For a prop, the origin is the centre of its unrotated footprint on the floor.
  - For a figure, the origin is the top of its base. Today's figures are about 0.9 tall and are
    drawn 1.3 times larger; new ones are made at their real height (see Scale).
- **`turn`** (radians about x, y, z) tilts a part.
- **Colour:** each part has a `color` or a `material`, except an **accent**. An accent takes the
  token's colour, so one villager model dresses the whole village.
- **Swinging parts:** mark them `"swings": true`, and give the model a `swing`: the height it turns
  about and how far a swing throws it. These are used by the tower bell and the lever.
- **Glowing parts** (#232): mark a light fixture's flame, lamp or crystal `"emissive": true`, with
  no colour or material. It is baked white into the `flame` mesh, which the light fixtures tint
  with their light's colour and draw emissive, so it blooms; it never swings or takes an accent.

The pipeline merges the parts into at most four meshes: `body`, `swing`, `accent` and `flame`.
Colours are baked in as vertex colours. The client draws each prop model with one instanced draw
call however many parts it has, plus one more if it swings.

### Light fixtures

A light is drawn with a fixture model that fits its kind (#232): `fixtureFor(light, mount)` in
`src/lib/tabletop/light-model.ts` (`FIXTURES`) picks it, and none for a glow or a light whose look
says `fixture: false`. They are part lists in `assets/models/prop` like any prop, but not in the
catalogue (nobody places them; the light is the thing placed), and any of them can be replaced by
a cooked or commissioned model under the same id, with its glow in a mesh named `flame`, with no
code change.

| Kind    | On a wall        | On the floor     |
| ------- | ---------------- | ---------------- |
| torch   | `wall-sconce`    | `standing-torch` |
| lantern | `wall-lantern`   | `post-lantern`   |
| candle  | `candle-cluster` | `candle-cluster` |
| brazier | `brazier`        | `brazier`        |
| magic   | `glow-crystal`   | `glow-crystal`   |
| fire    | `ground-flame`   | `ground-flame`   |
| neon    | `neon-bar`       | `neon-bar`       |
| panel   | `light-panel`    | `light-panel`    |
| glow    | none             | none             |

- Only torches and lanterns hang on a wall (`mountOf`, the same rule as `lightMount`). A wall
  fixture is modelled on its cell's north wall (the wall's face at z = -0.43) with its flame where
  `lightMount` puts the light, 0.35 cells north of the centre and 1.4 up; it is turned a quarter
  per side. A floor fixture stands at the cell centre with its flame at its kind's default height
  (`LIGHT_KIND_DEFAULTS`, 0.4 cells a level).
- `checkScenes` fails a table with a light whose fixture, on a wall or on the floor, has no prop
  model, and counts the fixtures in the table's budget.
- A light on the same cell as a prop that is its fixture (a `sconce`, a `brazier`) sets
  `fixture: false` (`IN_PROP` in `server/adventure/tables.ts`), so nothing is drawn twice. Such a
  prop carries its own `flame` parts: the prop layer draws them, glowing in the colour of a light
  that is on in its cell and dark otherwise, and the light's point light sits in their middle
  (`flameSeats` in `src/lib/tabletop/light-fixtures.ts`).
- At the table (`src/lib/tabletop/light-fixtures.ts`) each fixture model is one instanced draw
  for its body (the prop kind) and one for its `flame` (the emissive kind, tinted per instance by
  the light's colour above 1 so it blooms, the wick's dark when off); picking maps an instance to
  its light, and a light without a fixture keeps the GM's handle. A token carrying light shows a
  small flame at its hand, in its light colour, only while it is in the viewer's view.

Each part is built at its own size, so its edges catch the light (#190, `models.ts`, `bake.ts`):

- **Bevels.** Boxes, cylinders and cones get chamfered edges 8% of their least side wide, 0.004
  to 0.04 cells and never over a quarter of it, built after sizing so a long part's chamfer is
  as wide as a short one's. A box is 44 triangles, a cylinder 144, a cone 72; spheres are as
  before. A point on a chamfer takes the normal of the face it lies on, so faces stay flat and
  the chamfers shade smoothly between them. The normals are written into the GLB.
- **Baked occlusion.** Every vertex casts 32 rays (cosine-weighted, the same for every vertex,
  from a fixed seed) up to half a cell, against the model's own parts and the floor at y = 0.
  The share that meet nothing is its occlusion: dark in the corners where parts meet and where
  the model touches the floor.
- **Convexity** per vertex: 0.5 flat, above it an edge, below it a hollow, for the painted
  minis' drybrush (#267).
- Both are written as `_BAKE` (VEC2, normalised unsigned bytes, in a 4-byte stride). The client
  reads it as `aBake`, and the prop and mini kinds multiply their ambient occlusion by its
  occlusion, times the `bake` param (1): indirect light only, so a torch is never darkened. A
  model without `_BAKE` (a cooked or provided GLB) and the placeholders get a constant, open and
  flat (`withBake`), so every prop and mini draws with the same program.
- The whole library builds in about 9 s (6.5 s before), and part-list triangles went from
  25,848 to 37,660 in all (see PERFORMANCE.md). Two builds give the same bytes; changing a ray
  count, reach or the seed changes them, so `npm run assets -- --check` asks for a rebuild.

A `.glb` made in a modelling tool, or cooked (#186), works too. Its meshes, and the nodes that carry
them, are named `body`, `swing` or `accent`, with `_lod1` or `_lod2` for coarser levels of detail;
it may have materials with KTX2 textures and meshopt-compressed geometry, and nothing else (see
Rules). If it swings, put its swing in `<id>.meta.json`. `tests/fixtures/assets/cube-meshopt.glb`
and `checker.ktx2` are small valid examples (`scripts/make-asset-fixtures.ts` makes them).

Every prop in the catalogue (see Catalogue) must have a model. The catalogue says what a prop is
(footprint, what it blocks); the model only says how it looks.

### Catalogue

`assets/catalog.json` lists the props there are. Adding a prop is an entry there plus a model with
the same id in `assets/models/prop`, then `npm run assets`; no code changes.

```json
{
	"props": {
		"crate": { "name": "Crate", "category": "storage", "w": 1, "h": 1, "blocks": "movement" }
	},
	"aliases": { "old-crate": "crate" }
}
```

- `name` is at most 40 characters of plain text. `category` is one of `PROP_CATEGORIES` in
  `src/lib/game/props.ts` (furniture, storage, fixtures, religious, machinery, nature, water, ruins,
  items, set-pieces), the Build panel's groups. `w` and `h` are the footprint unrotated, 1 to 8
  cells. `blocks` is `none`, `movement` or `sight`. `jitter`, optional, is 0 to 0.4 of a cell.
- The build (`server/assets/catalog.ts`) checks it and generates `src/lib/game/catalog.ts`, which is
  committed and must not be edited by hand; `assets:check` and `catalog.spec.ts` fail when it is out
  of date. It is a literal, so `AssetId` stays a union of the ids and the built-in adventures'
  prop ids are type-checked.
- **Ids are never removed.** `assets/catalog.shipped.json` lists every id ever shipped; the build
  adds new ones to it (commit it with the prop) and refuses a catalogue that drops one. To rename a
  prop, give it its new id and alias the old one to it: an alias names a prop, is not itself a prop
  id, and never names another alias. Every place a prop id comes in (`prop_create`, scene files,
  saved stories' origins, adventure files) reads it through `resolveAssetId` and keeps the new id,
  so old saves and published adventures load and nothing past the parse sees an alias. Aliases
  cover prop ids only; model and environment ids are pattern-checked, and an unknown one draws the
  placeholder.

### Textures, materials, environments

- **A texture recipe** is `{ "recipe": "noise" | "flagstones" | "planks", "size": 16..512 (a power
of two), "colors": [...], "seed": n, "scale": n }`. It builds the same tiling PNG every time. A
  PNG can be provided instead. `size` is the size it is drawn at: the build renders it at the
  512 px base and the cook at 1K and 2K (see Texture detail), where only its detail sharpens.
- **A paint recipe** (#178) is `{ "recipe": "paint", "output": "normal" | "gloss", "size", "seed",
"scale" }`, no colours: two octaves of tiling value noise as a height field, turned into a
  tangent-space normal map by a Sobel filter whose neighbours wrap (`normal`), or kept as grey
  (`gloss`, 0.5 neutral). Both are data, loaded linear: `paint-normal` and `paint-gloss` are the
  paint detail props and minis sample in object space (`docs/RENDERING.md`, "Materials and world
  visibility").
- **A texture's usage** (`usage` in its recipe, or in `<id>.meta.json` beside a PNG): `albedo`
  (the default), `normal`, `orm`, `height`, `emissive`, `mask`, `lut` or `sky`. The usage fixes
  its colour space (`USAGE_SPACE`: colour is sRGB, data linear), and the manifest refuses a
  texture whose colour space disagrees. The paint maps are `normal` and `mask`, the lens dirt
  `mask`, the grade strips `lut`.
- **A material** is `{ "color", "roughness", "metalness", "map": <texture>, "cells": n }`, and
  optionally `"normal"` and `"orm"` textures. `cells` is how many cells one repeat of the texture
  covers. Each map must be a texture of its usage (`map` albedo).
- **An environment** is `{ "name", "surface", "ground", "walls", "sky" }`. The first three name
  materials, used for the floor, raised ground and walls (the ground past the grid, out to the
  horizon, wears `ground`, #220; there is no rim any more); `sky` names a sky (below), and an optional `world` is a world look
  (a `parseWorldPatch` patch, docs/RENDERING.md "World look") a table there starts from.
  `"surfaces": { "floors", "walls" }` lists its surfaces of the library (#187, below): the floors
  in layer order, and the walls' (the walls wear the first). `kit` names its architecture kit
  (#250, below), required of every built-in environment: its own greybox kit since #261.
  - A scene refers to its environment by id (scene file v8).
  - The GM can change it in the Build panel ("Looks like").
  - What lies beyond the grid (the skirt to the horizon and the far silhouettes, #244) is a
    procedural recipe keyed by the environment's id in `src/lib/tabletop/world/recipes.ts`, not
    manifest data; it wears the environment's own materials (docs/RENDERING.md "Beyond the grid").

- **A sky** (#213) is `assets/skies/<id>.json`, procedural (no textures: the `sky` texture class
  stays unused), built into the manifest's `skies` inline and checked by `sky-parse.ts` both when
  built and when fetched (`SkyDef` in `manifest.ts`):
  - `name`, `kind` (`open`, or `enclosed` for a roof of rock), and its own `provenance`, which
    may only be ours (a text source; the manifest carries its `credit`).
  - `keys`: 2-16 moments, minutes strictly rising (the curves blend round the clock, #212). Each
    has `sun` and `moon` (their light), `hemiSky`, `hemiGround` and `hemi` (the hemisphere light),
    `ibl` (the sky's light through its environment map), `zenith`, `horizon` and `ground` (the
    dome), `fog` `{ color, density, height }`, `exposure` (EV, added to the look's), `stars`,
    `clouds` and `nightGlow` (how strongly flames light the table). An open sky's key gives the
    sun's colour as `sunKelvin` (1000-40000) or `sunColor`; an enclosed sky's gives neither, no
    sun or moon, and a `fill` `{ color, intensity }`. Colours are `#rrggbb` sRGB; every number is
    bounded.
  - `path` (open skies only): `latitude`, `declination`, `north`, `noon` (minutes; 780 keeps the
    bands), `moonCycle` (days) and `moonPhase` (0-1).
  - Seven ship: `temperate` (the village and the monastery), `desert-night` (the ghost town),
    `underground` (the cavern), `abyss` (the living cave), `lamplit` (the railcar), and
    `overcast` and `blood-moon` for the GM to pick. Their lights at 12:00, 19:30 and 23:00 are
    the day, dusk and dark presets the renderer drew before, so the look doesn't jump; their
    colours are seeded from the references (docs/LOOK.md, "Sky targets"), and the owner approved
    the look at M67's checkpoint. The renderer draws them as docs/RENDERING.md says ("The dome
    and its capture", "Enclosed skies"); the dome's horizon is always the fog's colour, so a
    preset's `horizon` shows a few degrees up, not at the line.
  - Which sky a table shows is `resolveSky(world, environment, manifest)`: the look's sky if the
    manifest has it, else its environment's, else `temperate`; a sunless look ("Underground")
    shows `underground` instead of an open sky. Unknown ids fall back without a word.
  - `checkScenes` fails an environment, a table or a `world` effect naming a sky the manifest
    lacks, and `checkCredits` a sky's id or name that names the story.

- **A colour grade** (#162) is `assets/grades/<environment>.json`: `{ "day", "dusk", "dark" }`,
  each a grade on the tone-mapped (display) colour, any field left out being neutral:
  - `contrast` (a curve round `pivot` that keeps 0 and 1), `lift` (a toe per channel that lifts
    the darks without moving black), `gamma`, `gain` (per channel), `saturation`, and `shadows` /
    `highlights` (multipliers the darks and the lights are tinted by);
  - optionally `"agx": {…}` and `"neutral": {…}` to change it for those tone mappers. Without them
    the pipeline gives AgX 0.15 more saturation and 0.08 more contrast (AgX desaturates and
    flattens) and Neutral 0.05 less saturation (it runs warm and saturated).
  - Each band is rendered for each tone mapper (a grade is tied to the curve it follows) into a
    1024×32 lookup-table strip, `grade-<environment>-<band>-<tone mapper>`: 32 slices of 32×32
    side by side, blue choosing the slice, red across and green down, saved with PNG's sub filter
    (8–17 kB each). The pipeline refuses a strip that moves black, and the environment's `lut`
    in the manifest names its nine strips. The client loads the three for the viewer's tone
    mapper with the environment, another tone mapper's three when the viewer picks it (once
    each, `Grades` in `environment.ts`), and blends the one for the band into the picture
    (`grade.ts`).

### Architecture kits (#250)

A kit is one style's architecture as data: `assets/kits/<id>.json` lists its pieces by role, and
the world's builders (#251, #252) map each wall, corner, opening, step, drop and roofed cell to a
role and draw one of its variants. The rules never change with the kit. Every environment names
one (`"kit"`); a table whose environment has none, or names `plain`, draws every role as a
procedural box, slab or prism. `src/lib/assets/kit.ts` holds the schema, the roles, the clearance
constants and `parseKit`, shared by the pipeline, `parseManifest` and `world/shape.ts`.

```json
{
	"name": "Stone halls",
	"roof": { "style": "gable", "pitch": 40, "eave": 0.2, "material": "monastery-stone" },
	"presumeRoofs": false,
	"pieces": {
		"wall.straight": [{ "model": "stone-wall" }, { "model": "stone-wall-cracked", "weight": 0.5 }],
		"cap": [{ "model": "stone-wall-cap" }]
	},
	"floors": { "flagstone": { "tiles": [{ "model": "flag-tile" }], "broken": [] } }
}
```

- **Pieces** are manifest models of kind `kit` (`assets/models/kit/`, held to the kit class's
  limits: 1,500 triangles at LOD0, no texture of their own), 1-8 variants a role, each with an
  optional `weight` (how often it is picked, 1 when absent) and `sockets` (`{ kind: smoke | flame,
at: [x, y, z] }`, the shape of #319's model sockets). `roof` (`gable` or `hip`, a pitch of
  15-60°, an eave of 0-0.5 u, a manifest material) or null; `presumeRoofs` lets a player see a roof
  over a room closed by walls they know but have not explored (#257; docs/RENDERING.md, "Roofs";
  the kits of the open air set it, and it gives the walls a building context from the first
  frame). `floors` gives tiles, broken tiles (near drops) and an optional edge piece
  per floor id (`plain` is the default ground; not the void; `KIT_FLOOR_IDS`, which lists `tile`
  and `grating` since #254); a floor without tiles is the blended ground. A tile piece is one tile
  at its own scale, centred on its pivot with its top at the floor: the lattice it is laid on has
  its footprint (the first variant's bounds) plus a 0.025 u joint as its pitch, independent of the
  cell (docs/RENDERING.md, "Kit floor tiles"); broken variants are drawn at cliff and void edges.
  The edge piece is not drawn yet. Kit and piece ids describe looks (`ashlar-wall-a`), never story roles: the manifest is
  public, and no sealed door or secret room gets its own piece.
- **Metrics.** 1 u per cell edge; `wall.straight` exactly `WALL_HEIGHT` (2.0 u) tall over its
  floor, a `plinth` one `STEP_HEIGHT` (0.4 u); the exterior face is +Z.
- **Pivots.** A piece's origin is its role's pivot, so the manifest carries no pivot of its own:
  - an **edge** piece's is the unit edge's midpoint **on the higher floor** beside it, 1 u long
    along X, +Z toward the void, the table's edge or the lower side;
  - a **corner** piece's is the grid corner, on the highest floor round it;
  - a **cell** piece's (tiles, bridge decks and piers, roofs) is the cell's centre on its floor.
- **Clearance**, the constants in `kit.ts`: a token stands on a disk of `TOKEN_DISK` 0.43 round
  its cell's centre (one constant for walls and ground; `world/shape.ts` re-exports it), and no
  kit piece enters a walkable cell's disk below `FIGURE_CLEAR` (1.45 u: 1.3 u figures and a
  margin). So an edge piece reaches at most `WALL_HALF_THIN` 0.07 toward a walkable or unexplored
  cell, and up to `WALL_HALF_THICK` 0.35 only toward the void or off the grid (a prop's solid cell
  doesn't count: props are pushed and pulled); a cap overhangs at most `CAP_OVERHANG` 0.03, only
  above `FIGURE_CLEAR`; posts are `POST_SIZE` 0.3 square, 0.495 from the nearest cell centre (a
  0.2 wide buttress projecting 0.3 is 0.447 away); nothing on an edge rises above `WALL_HEIGHT`
  over the higher floor but a post's finial (`FINIAL` 0.15), and crenels are cut into the wall's
  top, never merlons above it, so the picture keeps the see-over-walls rule. Thickness is these
  constants, a kit parameter to retune once the bases are sized (#270).
- **Roles** (`KIT_ROLES`, closed; an unknown role is refused by name) and where each may lie
  (`ENVELOPES`, in units about the pivot; T = 0.07, K = 0.35, O = T + 0.03, H = 2.0, S = 0.4,
  F = 1.45, D = the deepest drop, 40 levels):

  | Role                                                                                | Pivot  | Y             | Z (−interior, +exterior)                          |
  | ----------------------------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------- |
  | `wall.straight`, `arch`, `railing`                                                  | edge   | 0 to H        | ±T                                                |
  | `wall.outer` (toward the void), `wall.boundary` (palisade)                          | edge   | 0 to H        | −T to K                                           |
  | `wall.retaining` (below the higher floor)                                           | edge   | −H to 0       | −K (buried) to T                                  |
  | `cap`                                                                               | edge   | F to H        | ±O                                                |
  | `cap.battlement`, `crenellation`                                                    | edge   | F to H        | −O to K                                           |
  | `plinth`                                                                            | edge   | 0 to S        | ±T                                                |
  | `window.frame`, `window.glass`, `door.frame`, `door.leaf`                           | edge   | 0 to H        | ±T (a leaf drawn shut)                            |
  | `window.sill` (between different floors)                                            | edge   | −H to H       | ±T                                                |
  | `stair.riser`                                                                       | edge   | −S to 0       | −K to T                                           |
  | `stair.side`                                                                        | edge   | −H to 0       | −K to T                                           |
  | `cliff.face` (trim for #241)                                                        | edge   | −D to 0       | −K to T                                           |
  | `post.end`, `post.L`, `post.T`, `post.X`                                            | corner | 0 to H + 0.15 | clear of the four cells' disks                    |
  | `buttress`                                                                          | corner | 0 to H        | clear of the four cells' disks                    |
  | `pinnacle`                                                                          | corner | F to H + 0.15 | clear of the four cells' disks                    |
  | `tower.corner`                                                                      | corner | 0 to H + 0.15 | clear of three; fills the +X+Z quarter (the void) |
  | `cliff.corner`                                                                      | corner | −D to 0       | within ±0.5                                       |
  | `bridge.deck`                                                                       | cell   | −S to 0       | within ±0.5                                       |
  | `bridge.pier`                                                                       | cell   | −D to 0       | within ±0.5                                       |
  | `roof.ridge`, `roof.hip`, `roof.eave`, `roof.corner`, `roof.chimney`, `roof.dormer` | cell   | F to 4H       | within ±1 (the eave)                              |
  | floor `tiles`, `broken`                                                             | cell   | −S to 0       | within ±0.5                                       |
  | floor `edge`                                                                        | cell   | −H to 0       | within ±0.5                                       |

  Edge pieces lie within ±0.5 along X, corner pieces within ±0.5 (to 1 toward the void for a
  tower). A piece is checked by its bounds, the box round every vertex through the node
  transforms (`envelopeProblem`), which is stricter than vertex by vertex and covers the edges
  between them; a corner piece's box keeps `TOKEN_DISK` from each cell centre round it while it
  stands between the floor and `FIGURE_CLEAR`. A 0.2-thick `wall.straight` fails the build with
  `kits/<id>.json: wall.straight "<model>": 0.1 > 0.07 toward -z`.

- **Checked** by `parseKit` in the pipeline (`buildKits`: every piece a known model of kind `kit`
  inside its role's envelope; a `plain` kit must exist; every environment must name a kit) and
  again by `parseManifest` (`kits`, read as {} when absent; `EnvironmentDef.kit` optional on the
  wire, but it must name a kit the manifest has).
- **Coverage.** `rolesNeeded(scene)` (`src/lib/assets/kit-needs.ts`, pure; #352 reuses it) reads
  the roles a table asks for from its scene file: a wall's `wall.straight` and `cap`, `wall.outer`
  toward the void or the table's edge, `plinth` and `wall.retaining` down a drop; a window's frame
  and glass (and sill between floors); a door's frame and leaf; a post by how built edges meet at
  each corner (end, L, T, X); a bare one-level step's `stair.riser`, a higher drop's `cliff.face`;
  roofed cells' ridge, eaves and corners; a stair run's (#255) `stair.side` where a step has a
  lower side and `railing` where a built stair drops two levels or more, on a bridge's open long
  sides and at a built floor's open drop (#256; a bridge's body is procedural, so `bridge.deck` and
  `bridge.pier` aren't asked for yet). Chimneys join it with #257; the roofs draw `roof.ridge`,
  `roof.hip`, `roof.chimney` and `roof.dormer` (#258, docs/RENDERING.md "Hips, caps, chimneys and
  dormers": a cap's and a chimney's pivot is a one-cell roof's ridge, a dormer's its wall's eave
  line). `checkScenes` fails a table whose kit lacks one (`hollow-bell: monastery: the kit "halls"
has no cap piece`).
- **Phasing in.** `KIT_PENDING` in `server/assets/scenes.ts` listed the environments still on
  `plain` while #261 built their kits; it is empty now, so every built-in environment must have a
  kit of its own covering every role its tables need. `checkScenes` still fails an environment on
  the list that names a kit ("take it off KIT_PENDING") and one back on `plain` ("it needs a kit
  of its own").
- **The clearance invariant.** `src/lib/tabletop/world/kit-clearance.spec.ts` fills every role's
  envelope to the brim where a kit would put it (walls, outer faces, caps, retaining walls and
  sills, risers, posts) and runs the world's harness (`checkEmitter` with no `INTRUSION`
  allowance, up to `FIGURE_CLEAR`) on every fixture scene and view, all 16 ways walls meet at a
  corner, walkable against void, and drops of 1 and 5. It covers the medium base; large bases
  (#270) exceed a cell by design.
- The walls draw from kits since #252 (docs/RENDERING.md, "Kit walls"): `loadEnvironment` loads
  the wall roles of the environment's kit (`loadKit`: every `body` part of each variant's model as
  one mesh with its vertex colours, `pieceOf`), and a role the kit lacks, or whose models fail to
  load, draws its built-in procedural piece, never nothing.

#### Greybox kits (#261)

Every built-in environment has a greybox kit of the same id (stone halls' is `stone-halls-greybox`,
the fallback under the pilot kit, below), built from part lists: procedural,
thirdfold-original (`assets/models/kit/_provenance.json`), and the permanent fallback that authored
kits replace role by role (the stone-halls pilot, #263; CC0 pieces, #262). `plain` stays empty:
every role procedural, for tables with no environment.

- **Made by a script.** `npx tsx scripts/make-kits.ts` writes `assets/models/kit/<kit>-<piece>.json`
  and `assets/kits/<kit>.json` (prettier-formatted, the same bytes every run), from
  `scripts/kits/parts.ts` (boxes, cylinders, cones and spheres; courses of blocks, boards, rubble,
  openings, pointed heads, floor slabs, roof slopes and terraces), `pieces.ts` (the pieces every
  kit has, in its colours) and `looks.ts` (each kit's colours, walls, boundary, deck, tiles and own
  roles). Edit those, run it, then `npm run assets`. Colours follow docs/ART.md's surface ramps;
  a part may name a manifest material instead (`plaster`, `monastery-stone`, `ancient-stone`,
  `cave-rock`, `sinew`, `railcar-wall`, `weathered-wood`, and the roofs' `thatch`, `slate`,
  `tin-roof`, `roof-boards`), whose colour is baked in.
- **Roles.** Every kit fills every wall, cap, plinth, post (end, L, T, X), window (frame, sill,
  glass), door (frame, leaf), stair (riser, side), railing, bridge (deck, pier) and cliff (face,
  corner) role, so a GM's own table finds pieces too; kits with a roof add all six roof roles;
  stone halls add `cap.battlement`, `crenellation`, `buttress`, `pinnacle`, `tower.corner` and
  `arch`, the cavern `arch`. `wall.straight` has two weighted variants.

  | Kit                   | Walls                                    | Boundary            | Roof              | Floor tiles                                          |
  | --------------------- | ---------------------------------------- | ------------------- | ----------------- | ---------------------------------------------------- |
  | `village`             | plaster on a stone footing; timber frame | palisade of logs    | thatch, gable 45° | cobble, wood (planks)                                |
  | `stone-halls-greybox` | coursed ashlar; with a string course     | crenellated curtain | slate, gable 40°  | plain, flagstone, stone (flags); wood (planks); tile |
  | `cavern`              | rough rubble; ancient coursed stone      | heaped rocks        | none              | stone (hewn flags)                                   |
  | `living-cave`         | sinew with ribs; swollen sinew           | sinew posts         | none              | none                                                 |
  | `railcar`             | panelled planks; boarded                 | iron rail           | tin, gable 15°    | plain, wood (planks); grating                        |
  | `ghost-town`          | adobe; weathered boards                  | picket fence        | boards, gable 22° | wood (boardwalk)                                     |

  Each floor has three tiles and one broken tile, but the railcar's `grating` (one tile, no broken
  one); stone halls also tile `tile` (terracotta slabs) and the railcar `grating`, the floor ids
  #254 added.

- **Conventions.** A wall piece's core spans the whole edge (x ±0.5), even where its blocks or
  boards stop short: a core 0.98 long left a crack at every joint through which the far side of
  the wall, and its lights, showed. Vertical pieces below a floor (retaining walls, sills, cliff faces, piers) are
  one wall's height (2 u) and repeat down a deeper drop. Roof pieces are one cell from the wall's
  top: `eave` a slope across the cell falling toward +z, `ridge` both slopes meeting over its
  centre, `corner` and `hip` stepped terraces (boxes make no triangles) falling toward +x and +z,
  or all round; `chimney` carries a `smoke` socket for #319.
- **Budgets.** Pieces are 132 to 1,168 triangles (the palisade); a kit is 23 to 43 pieces, 190 to
  290 kB to download and 160 to 235 kB on the GPU. `tableBudget` counts the environment's kit with
  every table, so each built-in table still fits `TABLE_BUDGETS` (the Hollow, the tightest, is
  14.4 MB of 15 at medium). The manifest grew by 201 entries (220 → 337 kB, 33 → 48 kB gzipped).
- **Review.** Search `kit` on the turntable (`/dev/assets`, dev only) to view a piece; floor tiles
  lie below the turntable's floor, so view them through a table once #252 and #254 draw kits.
  `node scripts/thumbnails.mjs <dev url> --only <id,…> --out <dir>` renders pieces to PNGs.
- **Not yet:** the per-vertex surface-layer attribute (each part's surface, sampled from the
  environment's arrays in world space) needs the validator, the GLB writer and the kit material
  (#252) together; until then pieces carry their surface's colour as vertex colour.

#### The stone-halls pilot kit (#263)

`assets/kits/stone-halls.json` is the first textured kit: an in-house pilot
(`LicenseRef-thirdfold-original`), made by script the way the great bell's was (#196), until
docs/ART.md's brief B is commissioned. It covers every role the greybox kit fills but the six roof
roles and the `wood` and `tile` floors, which stay the greybox's (`stone-halls-greybox.json`, the
fallback, with the same roles and floors).

- **Made by a script**, the same bytes every run under Node 22:

  ```bash
  npx tsx scripts/make-kits.ts                                                   # the greybox kits
  npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-stone-halls-art.ts   # art/ + the kit
  npm run assets:cook && npx -y node@22 node_modules/tsx/dist/cli.mjs server/assets/build.ts
  ```

  `scripts/stone-halls/trim.ts` paints the trim sheet, `pieces.ts` models the pieces, `build.ts`
  UVs, colours and checks them. The script writes `art/texture/ashlar-trim-{albedo,normal,orm}/`
  (2048² PNG and `meta.json` with its `usage`) and `art/kit/<id>/` (`<id>.glb` as a Blender export
  would be: one `body` mesh, positions, normals, UVs and vertex colours, a material named
  `ashlar-trim` with no textures; `meta.json` with `materials: ["ashlar-trim"]` and `lockBorder`),
  then the kit: the greybox kit's JSON with the pilot's pieces in every role they fill. The PNGs
  and GLBs are gitignored (`/art/kit/*/*`, `/art/texture/*/*`); only the `meta.json` files are
  committed, so re-cooking needs the script run first.

- **The trim sheet** is one texture set at 512 px per unit (a 4 × 4 u repeat), shared by every
  piece, in strips that tile along u: ashlar (2 u of coursed blocks, a wall's height), dressed stone
  (copings, frames, mouldings, voussoirs), rubble, paving, oak boards, and iron beside leaded glass.
  It cooks to `ashlar-trim-albedo` (ETC1S, sRGB), `-normal` and `-orm` (UASTC, linear) at the 512 px
  base, with 1K and 2K variants in `variants/` and the asset store, worn through the manifest
  material `ashlar-trim` (`assets/materials.json`, `cells` 4). A kit piece embeds no texture: its
  cooked `meta.json` carries `materials`, which `pipeline-models.ts` checks against `materials.json`
  and puts in `ModelEntry.materials`, so `tableBudget` counts the sheet once per table and the
  textures go in the `core` pack.
- **Pieces** (37), each a role's variant within its envelope (`envelopeProblem` in the script,
  then `parseKit` in the build) and under the kit's 1,500 triangles, cooked with LODs where a piece
  has 300 or more:
  - walls: `ashlar-wall-a` and `-b` (two windows on the sheet's courses), `-cracked` (weight 0.5),
    `-niche` (0.3); `ashlar-wall-outer`, `ashlar-retaining` (rubble below the floor),
    `ashlar-curtain` (the crenellated boundary);
  - tops and feet: `ashlar-coping` (`cap`), `ashlar-battlement`, `ashlar-crenels`, `ashlar-plinth`;
  - openings: `ashlar-arch`, `ashlar-window` (a pointed head), `ashlar-window-sill`,
    `leaded-glass`, `ashlar-door-frame`, `oak-door`;
  - stairs, drops and bridges: `ashlar-step`, `ashlar-stair-side`, `stone-balustrade`,
    `rubble-face`, `rubble-corner`, `flag-deck`, `ashlar-pier`;
  - corners: `ashlar-post-end`, `-l`, `-t`, `-x`, `ashlar-buttress`, `stone-pinnacle`,
    `ashlar-turret`;
  - floors `plain`, `flagstone` and `stone`: `flagstone-a` to `-d`, `flagstone-broken-a` and `-b`.

  Coursed walls are built from the sheet's own course layout (`COURSES`, `CUTS`): an ashlar face
  maps by where it stands on the wall, so each block's face shows the block painted for it and the
  joints fall on the gaps; other faces map planar per part at the sheet's density. Each vertex also
  carries the sheet's mean colour over its face times the occlusion part lists bake (`bake.ts`):
  since M70 the walls, door leaves and floor tiles wear the sheet itself by UV (docs/RENDERING.md,
  "Kit textures"), and the colours stay what the stairs, bridges and cliffs draw (baked into the
  chunks' faces) and what a piece falls back to. The cook keeps a piece's UVs when its `meta.json`
  names `materials` (`prune({ keepAttributes })`: with no texture of its own a plain prune drops
  them), so `TEXCOORD_0` is in its GLB; the GLBs carry no tangents (the normal map is mapped in the
  derivative frame, mapping.ts).

- **A commission replaces it** role by role through the same paths: deliver `art/kit/<id>/<id>.glb`
  and `meta.json` (provenance `LicenseRef-thirdfold-commissioned`, `materials`) per piece and the
  trim sheet's PNGs in `art/texture/<id>/`, cook, then point the role in
  `assets/kits/stone-halls.json` at the new ids (and stop running the pilot script, which rewrites
  that file). The greybox kit stays the fallback.
- **Budgets.** The sheet is 314 kB at the base (albedo 37, normal 195, ORM 82), 1,012 kB more at
  1K and 3,015 kB at 2K; the 37 cooked pieces are 132 to 1,012 triangles and 421 kB together (323 kB
  before M70 kept their UVs). Per
  stone-halls table, from `npm run assets` (desktop held at medium, mobile at low):

  | Table                         | Download low | Download medium | GPU medium | Mobile GPU |
  | ----------------------------- | ------------ | --------------- | ---------- | ---------- |
  | hollow-bell/monastery         | 5,120 kB     | 15,092 kB       | 47,780 kB  | 48,306 kB  |
  | example/cellar                | 4,151 kB     | 14,122 kB       | 45,310 kB  | 39,798 kB  |
  | (stone-halls), an empty table | 3,845 kB     | 13,817 kB       | 44,691 kB  | 37,796 kB  |

  The monastery was 13,595 kB at medium with the greybox kit; it fits 15 MB with 268 kB to spare
  (357 before M70's UVs added 89 kB to the pieces), so a commissioned sheet must not be heavier at
  1K (its normal map, 671 kB, is most of it).

### Audio

- **A bell recipe** is `{ "bell": "great" | "flash" | "hand" | "chime" | "motif", "rate": 8000..48000
}`. It renders that bell of the family in `src/lib/audio/bell.ts`, from the same partials the
  engine synthesizes, to WAV.
- **Sound files** can be WAV (PCM) or Ogg (Vorbis or Opus).
- The engine plays The Hollow Bell's great bell (and its flash, an octave up) and the hand bell
  from these samples once they have loaded, and synthesizes them until then.

### Cooking art

Textured art needs encoders too slow for every build, so it goes through an offline step first.
`npm run assets:cook` (`server/assets/cook.ts`, textures in `cook-textures.ts`) turns an artist's
export into cooked files in `assets/`, and `npm run assets` then only checks and hashes them like
any other GLB or KTX2 source. Nothing cooks per pull request.

| Art source                                                  | Cooked into                                             |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| `art/<kind>/<id>/<id>.glb` + `meta.json` (a Blender export) | `assets/models/<kind>/<id>.glb` + `<id>.meta.json`      |
| `art/texture/<id>/<id>.png` + `meta.json`                   | `assets/textures/<id>.ktx2` + `<id>.meta.json` (usage)  |
| `art/surfaces/<id>/meta.json` (a CC0 set, fetched)          | `assets/textures/surface-<id>-{albedo,normal,orm}.ktx2` |

`meta.json` holds the `provenance` (required, docs/ART.md section 13, copied into the cooked
meta), and optionally `swing`, `setPiece`, `textureSize` (the largest side; bigger maps are halved
until they fit), `lods` (per level `{ ratio, error, screenSize }` over the defaults), `lockBorder`
(kit pieces, so simplified seams stay closed), `ramp` and `detail` (a CC0 bridge prop's colour
maps recoloured to the palette before encoding, see "CC0 bridge props"), `materials` (a kit
piece's manifest materials, its trim sheet, copied into the cooked meta; #263) and, for a texture,
`usage`. The export follows
docs/ART.md section 17. A model is cooked in this order:

1. Checked: only the allowed extensions, no skins, animations, cameras or shape keys, objects
   named `body`, `swing`, `accent` (or `<role>_lod1`/`_lod2` made by hand), triangles, the allowed
   attributes, indices inside the vertices. The mesh takes its object's name; extras, copyright
   and the exporter's name are dropped (provenance lives in the manifest).
2. `dedup`, `prune`; MikkTSpace tangents (three's vendored `mikktspace`) where a material has a
   normal map; `weld`.
3. LODs (meshoptimizer's simplifier): `<role>_lod1` at half the triangles and `<role>_lod2` at
   15%, for roles of 300 triangles or more without levels of their own, each only if coarser than
   the last. Their screen sizes (0.25 and 0.1 by default) go in the cooked meta as `screenSizes`,
   which the build puts in the manifest's `lods`.
4. `meshopt` at level `medium` (quantised, `EXT_meshopt_compression`).
5. Textures to KTX2 by the slots they fill, always with every mip level and power-of-two sides
   (the Khronos artist guide): albedo and emissive ETC1S (BasisLZ) with the sRGB transfer; normal
   and ORM UASTC with RDO (λ 0.5) and Zstd, linear. PNGs are grey, grey and alpha, RGB or RGBA,
   8 or 16 bits a channel (a 16-bit sample's high byte kept; `decodePng`, `png.ts`).
6. The result must pass `checkGlb` at its class's limits.

The encoder is `ktx2-encoder` (Basis Universal as WASM, single-threaded, no native binary): the
same input gives the same bytes on Node 22 and 26 on Linux, which `cook.spec.ts` checks on a
fixture (`tests/fixtures/art`, written by `scripts/make-art-fixture.ts`) and the `Cook` workflow checks on macOS.
Its cook tests encode KTX2 for about 10 s, so they stay out of `npm test` and run by hand and in
the `Cook` workflow: `THIRDFOLD_COOK=1 npx vitest run --project server server/assets/cook.spec.ts`
(CI's `verify` still checks the lock with `assets:cook -- --check`).
KTX-Software's `ktx create` is not needed. `meshoptimizer` is pinned to 1.1.1, the version whose
decoder three r186 vendors.

`assets/cook.lock.json` records the tools' versions, the cook's settings, and per entry its source
files' and outputs' SHA-256. An entry whose sources, tools and settings are unchanged and whose
outputs are intact is skipped (`-- --force` cooks all again); entries whose art isn't in this
checkout stay in the lock as they were. `npm run assets:cook -- --check` (run by CI's `verify`,
seconds) encodes nothing: it fails when a source here changed since its cook, when a tool or
setting changed, or when an output is not what the cook wrote. `.github/workflows/cook.yml`, run
by hand, cooks everything again on Linux and macOS and fails on any byte of difference.

The first cooked model is the Hollow's great bell (#196), an in-house pilot until brief A (ART.md)
is commissioned: `scripts/make-bell-art.ts` builds `art/prop/great-bell/` the way a Blender export
would (`body`, `swing` with its pivot in `meta.json`, UVs, one material with painted albedo, normal
and ORM PNGs at 2048² and a 512² emissive rim; the same bytes on every run under Node 22), which the
cook turns into the 512 px base GLB and a 1K and a 2K variant, and its old part list is
`great-bell.preview.json`, shown until the cooked bell arrives. The script's `great-bell.glb` is
generated, so it is gitignored and only `meta.json` is committed; the cook and `--check` pass over a
model folder without its GLB as art kept elsewhere. To cook the bell again, make its art first:

```bash
npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/make-bell-art.ts   # art/prop/great-bell/
npm run assets:cook && npx -y node@22 node_modules/tsx/dist/cli.mjs server/assets/build.ts
```

Its geometry uses `Math.sin`/`cos`, which V8 need not keep bit for bit across versions: if a
regenerated GLB's hash differs from the lock's, the cook re-cooks it and the lock changes with it.
Its numbers are in PERFORMANCE.md ("The great bell").

Where `art/` and the cooked binaries are kept, and the upload, is #191. Every cooked texture is
cooked at the 512 px base and its 1K and 2K variants (see Texture detail).

### The surface library (#187)

Every floor a GM can paint with a look of its own (stone, wood, grass, dirt, sand: `SURFACE_FLOORS`
in `scenes.ts`, a surface's id being its floor's, required of every environment with surfaces; plain is
the table's own, water is drawn as water, the void is nothing; #248's cobble, flagstone, rock, mud, snow
and gravel are optional, listed where the table budgets allow: cobble in the village, flagstone in the
stone halls, the rest drawn in their `FLOOR_LOOKS` tint), every wall surface the environments wear
(plaster, ashlar, planks, cave-rock) and the rest of #187's library (the walls and roofs kits will
wear) is a painted surface, repainted from a CC0 scan (docs/ART.md section 11):

1. `art/surfaces/<id>/meta.json` holds the set's `provenance` (`CC0-1.0`, the download's URL and
   SHA-256 as its `source`, `modified: true`), its `ramp` (docs/ART.md "Surface ramps", which
   `stylise.spec.ts` checks it against), `detail` and `normalBoost` (the cook makes the 512 base and the 1K and 2K variants). Git keeps
   only it (and an optional hand-painted `touchup.png`).
2. `node scripts/fetch-surfaces.mjs [id...]` fetches each set from ambientCG (one zip) or Poly
   Haven (a PNG per map: the colour map is the `source`, the others are listed in `maps`, each
   with its URL and SHA-256) and no other host,
   refuses one whose SHA-256 differs, and unzips its maps beside the meta (`--record` writes the
   hash of a new set whose meta has all zeros). By hand only: CI never downloads.
3. `npm run assets:cook` stylises it (`server/assets/stylise.ts`, deterministic: integer maths and
   IEEE-exact floats only): colour softened, luminance stretched and half posterised through the
   ramp with `detail` of the scan's own hue, cavities darker and cooler and edges lighter from a
   difference of box blurs of the height, albedo in 30-240 with the height in alpha, roughness in
   0.5-0.9 (cavities rougher) with the scan's occlusion, the normal softened and scaled by
   `normalBoost` (from the height where a set has none), a 2:1 set stacked square, an optional
   `touchup.png` laid over, and the albedo's seams compared (`seamError`: a set that no longer
   tiles fails). It encodes three KTX2 textures, one repeat per two cells: the albedo ETC1S sRGB,
   the normal UASTC with RDO λ 3 and Zstd, the ORM ETC1S linear (`surfaceNormal`, `surfaceOrm` in
   `KTX2_SETTINGS`), each at the 512 px base (about 350 kB a surface) and from the 2K stylised set
   at 1K and 2K as variants (see Texture detail). The lock pins a set by its meta.json,
   so `--check` passes where the scans aren't.
4. `npm run assets` groups each surface's three textures into the manifest's `surfaces`
   (`buildSurfaces` in `pipeline-textures.ts`: all three maps, square, one size, the usage their
   name says) and checks every environment's lists name them; `checkScenes` fails an environment
   with surfaces that lacks one for a paintable floor.

At the table, `tabletop/surfaces.ts` (its own chunk, loaded only for an environment with surfaces)
transcodes each floor surface's maps (the base, then whichever size texture detail wants, every
layer at the same size, the array rebuilt and swapped in place) for the device and lays them layer by layer into one
`CompressedArrayTexture` per map (a set whose formats differ is refused whole; a device the
transcoder gives RGBA gets a `DataArrayTexture` whose mips the GPU makes, since three's compressed
upload refuses RGBA), and the terrain
kind samples them (`materials/floors.ts`): global array nodes whose textures `wearFloors` swaps, a
blank array standing in until they load, and each floor's layer from the ground map's floor byte,
so every floor of a table is still one draw and nothing compiles when a table, a floor or its
surfaces change. A floor with no layer keeps its `FLOOR_LOOKS` colour. Since #242 the floors round
each fragment are blended from the same arrays, by the height in the albedo's alpha (docs/RENDERING.md,
"Floors blended per pixel"): no new art and no new texture, the height the stylise step already writes. The walls wear their
surface's three maps in the wall material's slots.

### CC0 bridge props (#262)

The most-placed props on the built-in tables are textured CC0 models from
[Poly Haven](https://polyhaven.com/models) (the owner's sources for #262: Poly Haven and ambientCG
only, and ambientCG has no models), recoloured to the one palette, until authored art replaces them
(#123, #124). Their ids are unchanged, so saves, adventures and library files load as before; each
old part list is now the model's preview (`<id>.preview.json`).

1. `art/prop/<id>/meta.json` pins the source: `provenance` (`CC0-1.0`, the artist and "(Poly
   Haven)", the 1K glTF's URL and SHA-256 as its `source`, `modified: true`) and `maps` (the glTF's
   buffer, the colour map and the ARM map as 1K PNGs, each URL and SHA-256), with how it is put
   together (`fit`: the size in cells along x, y and z, a null axis scaled like the smallest given;
   `turn`: quarter turns about y so its back faces −z like the part lists; `triangles` and `error`:
   the simplifier's target and error limit; `roughness`), how it is recoloured (`ramp`, `detail`)
   and cooked (`textureSize` 512, `lods`). Git keeps only the meta (`.gitignore`: `/art/prop/*/*`).
2. `npx -y node@22 node_modules/tsx/dist/cli.mjs scripts/fetch-models.ts [id...]` fetches each
   file from Poly Haven or ambientCG and no other host, refuses one whose SHA-256 differs
   (`--record` writes the hash of a new file whose meta has all zeros), and writes the export the
   cook expects, `<id>.glb`: one `body` mesh (flattened and joined; one material only), only
   positions, normals and UVs, simplified, turned, scaled to `fit` with its base at 0 and its
   footprint centred; its colour map darkened by the scan's occlusion (the ARM map's red, at most
   20%, docs/ART.md section 4) as its only texture, no metal, the meta's roughness. The same bytes
   every run under Node 22. By hand only: CI never downloads.
3. `npm run assets:cook` cooks it like any model, first recolouring its colour maps through the
   meta's `ramp` (`recolour` in `stylise.ts`: softened, luminance stretched and half posterised
   through the ramp, `detail` of the scan's own hue, every value in 30-240), so a photo-scan reads
   as painted in the palette. `stylise.spec.ts` checks every fetched prop's ramp is one of
   docs/ART.md's surface ramps. `textureSize` 512 means no 1K or 2K variant: one albedo map only
   (no normal or ORM), to keep each table within `TABLE_BUDGETS`.

| Prop        | Poly Haven model                                                           | Artist           | Triangles (LODs)     | File   | Ramp  |
| ----------- | -------------------------------------------------------------------------- | ---------------- | -------------------- | ------ | ----- |
| `pew`       | [painted_wooden_bench](https://polyhaven.com/a/painted_wooden_bench)       | Kirill Sannikov  | 630 (314, 134)       | 56 kB  | wood  |
| `table`     | [wooden_table_02](https://polyhaven.com/a/wooden_table_02)                 | Serhii Khromov   | 196                  | 51 kB  | wood  |
| `statue`    | [gothic_statue](https://polyhaven.com/a/gothic_statue)                     | Benny Weimer     | 2,998 (1,907)        | 120 kB | stone |
| `barrel`    | [wine_barrel_01](https://polyhaven.com/a/wine_barrel_01)                   | James Ray Cock   | 1,736 (1,660, 1,656) | 114 kB | wood  |
| `bed`       | [GothicBed_01](https://polyhaven.com/a/GothicBed_01)                       | Kirill Sannikov  | 2,500 (1,482, 1,473) | 104 kB | wood  |
| `chair`     | [painted_wooden_chair_01](https://polyhaven.com/a/painted_wooden_chair_01) | Kuutti Siitonen  | 724 (362, 296)       | 58 kB  | wood  |
| `ashes`     | [stone_fire_pit](https://polyhaven.com/a/stone_fire_pit)                   | Sebastian Platen | 1,500 (746, 224)     | 70 kB  | stone |
| `bookshelf` | [wooden_bookshelf_worn](https://polyhaven.com/a/wooden_bookshelf_worn)     | Ulan Cabanilla   | 2,000 (1,000, 300)   | 79 kB  | wood  |

The rest of the most-placed props stay part lists: Poly Haven has no CC0 model that fits a
gravestone, pillar, rubble pile, cube crate, coffin (and its open look), rope, chains, noticeboard,
altar, brazier, gear or well, and the chest stays with its open look (`chest-open`) rather than
swap families when it opens; the lever, the great bell and the heart are story pieces (#332). The
bed and the table are scaled to their footprints along each axis, so the bed (a double) is narrower
than modelled. Poly Haven has no modular family that fits the kit roles (#250), so no kit piece is
bridged: the greybox kits stay. The thumbnails in `assets/thumbnails/` still show the part lists
until `scripts/thumbnails.mjs` renders them again.

## Texture detail

Every texture (recipes, PNGs, cooked KTX2, the surface library) and every cooked model's
textures exist in up to three sizes: a **base** of at most 512 px, always, and **variants** at
1K and 2K where the source is that large. The grade strips (`lut`) and skies have no variants.

- **Where they live.** The bases are committed in `static/assets/` and served with the page, so
  CI, tests, offline play and the native shells always have them. Variants are never committed:
  `npm run assets:cook` writes them into `variants/` (gitignored) by their hashed names
  (`textures/<id>-1k.<hash>.<ext>`, `models/<id>-2k.<hash>.glb`) and records each, with its SHA-256,
  bytes and GPU bytes, in `assets/variants.lock.json` (`server/assets/variants.ts`,
  `cook-variants.ts`). `npm run assets:publish` uploads them to the asset store beside the bases
  (a variant cooked elsewhere need only be in the bucket), and `assets:pull` brings them back.
- **The manifest.** A texture's or model's `variants` (`Variant`: `size` 1024 or 2048, `file`,
  `bytes`, `sha256`, `gpuBytes`, the base's `credit`), smallest first. The build reads them from the
  lock alone, so the manifest is the same bytes whether or not the files are here (as the cook
  treats art kept elsewhere); `npm run assets -- --check` and `assets:cook -- --check` fail on a
  variant file that is here and differs from the lock. The parser refuses a size other than 1024
  or 2048, one not above its base (a model's base is 512) or out of order, a name other than its
  entry's, and anything over its class's limits. The pipeline refuses a base over 512 px.
- **Sizes a source makes.** A cooked texture or model gets each variant its source reaches (a
  2048² set: 1K and 2K; a 1024² one: 1K only), a recipe both unless a size's PNG is over the
  texture limits (the paint normal map has no 2K). A cooked model's variant is the whole GLB with
  larger textures; its geometry is the base's.
- **The setting.** The Graphics menu's **Texture detail** (`textureDetail` in `quality.ts`: low,
  medium, high = at most 512, 1K, 2K; low on the low tier, medium on medium, high on high and
  ultra; `?texture=` for tests) picks, per texture, the largest size it has up to the setting,
  else its base (`sizeFor` in `src/lib/assets/detail.ts`).
- **At the table.** Everything loads at its base first. With an asset host (`VITE_ASSET_BASE_URL`,
  `remoteAssets()`) whatever has variants is handed to `tabletop/texture-detail.ts`, its own chunk,
  which fetches the size wanted through `fetchAsset` (checked by its SHA-256) and swaps it in: the
  same texture object, disposed and given the new pixels, so the renderer uploads it afresh and no
  material, slot or program changes (floor arrays are rebuilt at that size and swapped the same
  way; a model's variant gives its textures to the loaded model, part by part). Changing the
  setting swaps again; a size that fails to load falls back to the base (`Retargeter`). Without an
  asset host (CI, tests, native shells) only bases are drawn, so golden images stay the same.
- **The turntable** has a Texture detail picker and shows the size each map is drawn at.
- **Budgets** are counted per detail (see "Every table fits its budget").

## Rules the pipeline enforces

- **Nothing executable.**
  - A model (`checkGlb` in `server/assets/glb.ts`, the JSON in `gltf-check.ts`) is checked against
    an allowlist, first as JSON before anything is decoded, then decoded:
    - one GLB with its JSON chunk at most 256 kB and one embedded buffer (plus meshopt's empty
      fallbacks); no `uri` anywhere;
    - only the extensions `EXT_meshopt_compression`, `KHR_mesh_quantization`,
      `KHR_texture_basisu` and `KHR_materials_emissive_strength` (at most 50), anywhere in the file;
      so no Draco, lights, instancing or other material extensions, no `KHR_meshopt_compression`
      until the checker can decode it, and no `KHR_texture_transform` until the client honours it;
    - no skins, animations, cameras or morph targets; at most 256 nodes, 16 deep, as a tree;
    - meshes, and their nodes, named `body`, `swing` or `accent`, optionally `_lod1` or `_lod2`;
    - attributes POSITION, NORMAL, TANGENT, TEXCOORD_0 (the only uv set), COLOR_0 and `_BAKE`
      (VEC2 normalised unsigned bytes, see Models from parts), each in the formats its semantic allows (quantised integers only with `KHR_mesh_quantization`), in triangles,
      with unsigned indices;
    - every accessor inside its buffer view, every view inside its buffer, and all the accessors
      together, and what meshopt says it will decode to, each at most the class's GPU bytes, summed
      before anything is decoded;
    - images are KTX2 in the file, taken only through `KHR_texture_basisu` (no fallback);
      materials only the PBR metallic-roughness values, OPAQUE (not MASK until the client
      alpha-tests), with texCoord 0;
    - once decoded, every index below its vertex count; triangles counted per level of detail and
      each level within the class's triangles, the GPU bytes with textures within the class's,
      bounds taken from every vertex through the node transforms, and each texture checked as a
      KTX2 file in the colour space of the slot it fills.
  - A KTX2 texture, in a model or on its own (`checkKtx2` in `server/assets/ktx2.ts`), is Basis
    Universal: ETC1S with BasisLZ, or UASTC with Zstd or none; sides multiples of 4 up to the
    class's pixels, no more mip levels than the size has, every block and level inside the file,
    what Zstd would inflate to within the class's GPU bytes, sRGB or linear as its usage needs, one
    face (six square ones for a sky) and one layer (up to 32 on its own, for arrays).
  - PNG images and sounds are checked by their headers.
  - The manifest is validated again by the client (`parseManifest`). Its file paths can only point
    into `/assets/`.
- **Limits by class** (`LIMITS` in `src/lib/assets/manifest.ts`, `limitClass`), enforced by the
  pipeline and again by the client's parser. A figure is a character, NPC or enemy; decor is held
  to props' limits; a set piece is a prop whose source sets `"setPiece": true` (in its part list
  or its `<id>.meta.json`).

  | Class     | LOD0 triangles | Texture px | File bytes | GPU bytes |
  | --------- | -------------- | ---------- | ---------- | --------- |
  | kit       | 1,500          | 2048       | 256 kB     | 2 MB      |
  | prop      | 20,000         | 2048       | 4 MB       | 16 MB     |
  | foliage   | 6,000          | 2048       | 2 MB       | 8 MB      |
  | fx        | 2,000          | 1024       | 1 MB       | 4 MB      |
  | figure    | 40,000         | 2048       | 4 MB       | 16 MB     |
  | set piece | 60,000         | 2048       | 8 MB       | 32 MB     |
  | texture   | n/a            | 2048       | 4 MB       | 32 MB     |
  | sky       | n/a            | 4096       | 4 MB       | 32 MB     |

  Sounds: 2 MB and 30 s (`AUDIO_LIMITS`). GPU bytes are what a file takes once decoded: a model's
  vertex and index arrays (a part list's binary chunk), and a texture's pixels with a third more
  for mips, at 32 bits a pixel for PNG and 8 for KTX2, the worst of what KTX2 transcodes to. The
  limits are a ceiling per asset; what a whole table may add up to is #193's. So a sky at 4096 px is
  KTX2 only (as a PNG it would take about 85 MB), and a kit piece embeds no texture: kit
  textures come through the materials it wears (trim sheets are materials).

- **Only ids in saves.** Scene files and the room refer to assets by id (`Token.model`, the scene's
  `environment`), never by content. An id the client doesn't know draws as the placeholder.
- **Repeatable.** The same sources build the same bytes. Files are named by the first 8 hex
  digits of their SHA-256, so browsers can cache them for good, and the manifest lists each
  file's whole `sha256`, which a client checks a download from another host by (#191).
  `server/assets/pipeline.spec.ts` fails when `static/assets/` is out of date.
- **Every table checks.** `checkScenes` (`server/assets/scenes.ts`) builds each of The Hollow Bell's
  tables and checks every prop, figure and environment it uses against the manifest. That covers
  the people on its tables and the characters and enemies the story places. Scenes themselves stay
  on the server: a table holds the story's secrets.
- **Every table fits its budget** (#193). `checkScenes` also loads the builder's example (The
  Miller's Key) through `loadAdventureFile` and checks it the same way, and `tableBudget` adds up
  what each table of every adventure makes a viewer download and hold on the GPU. A file counts
  once however often it is used: the environment's materials' maps, its surfaces, its grades for
  the tone mapper in use, and the models of the table's props and people, what its objects and
  fights turn props into, every character and every enemy of the adventure (the GM can bring any
  kind anywhere), with each model's preview and the materials it wears. When any of it is KTX2 or
  cooked, the Basis transcoder counts once. Each is counted at each texture detail: a variant's
  download after its base (which always loads first) and its GPU bytes instead of the base's.
  Over `TABLE_BUDGETS` (desktop at medium, the reference tier's: 15 MB download and 160 MB GPU, high reported only; mobile at low, where
  phones start: 6 MB and 80 MB, KTX2 at RGBA8) the build fails, naming the adventure, the table
  and the number. `npm run assets` prints the report: a row per environment alone, in brackets,
  then a row per table, with its download and GPU bytes at low, medium and high, and its GPU bytes
  on mobile. The budgets and today's totals are in
  [PERFORMANCE.md](PERFORMANCE.md#asset-budgets).
- **Licences and provenance** (#189, `server/assets/licence.ts`, tests in `licence.spec.ts`).
  Every source says on what terms we have it, and the build refuses anything else:
  - The licence is one of `LICENSES` (CC0-1.0, CC-BY-4.0, `LicenseRef-thirdfold-commissioned`,
    `LicenseRef-thirdfold-original`); store licences, NC and ND variants and any other
    `LicenseRef-*` are refused. CC0 and CC-BY need a source (an https URL and the SHA-256 of the
    download); every record needs an author and `modified`.
  - AI output needs `modified: true` (repainted by a person), a `paid` or `self-hosted` plan and
    the date; Hunyuan3D is refused by name (`AI_DENYLIST`).
  - A binary source (`.glb`, `.png`, `.ktx2`, `.wav`, `.ogg`) carries its own
    `<id>.meta.json` with a `provenance` record. A text source (a part list, a recipe,
    `materials.json`, an environment, a grade) falls back on its folder's `_provenance.json`,
    which may only grant `LicenseRef-thirdfold-original`. Every folder in `assets/` has one
    today, crediting "thirdfold contributors". Files starting with `_` are never sources.
  - Each file's manifest entry carries a compact `credit` (`license`, `author`, the source's URL,
    `modified` when it was, the AI tool), required by `parseManifest`. `/credits`
    (`src/routes/credits/+page.svelte`) lists them by licence and author, the AI-assisted ones,
    and the shipped code and fonts from `src/lib/credits.ts` (its npm entries' licences are
    checked against their `package.json` in `credits.spec.ts`; the decoders three.js vendors are
    listed by hand).
  - `checkCredits` (run by `npm run assets`) fails when an id, a pack name or a credit names a
    story's people, foes, places or chapters (whole names, from every built-in adventure): the
    manifest is public.

## The manifest (version 2)

`src/lib/assets/manifest.ts` declares it and `manifest-parse.ts` checks it (tests in
`server/assets/manifest.spec.ts`). Besides the fields above, it holds what later work fills in,
each optional until then: a model's `lods` (levels after LOD0, coarsest last, each with its
triangles and the `screenSize` below which it is drawn; their meshes are `<role>_lod<n>` in the
same GLB, since three's GLTFLoader strips `.` from names), `cooked`, `materials` (manifest
materials a kit piece or decor wears), a `preview` model
and a `thumbnail`; `credit`, required on every file (`{ license, author, source?, modified?, ai? }`, #189);
`pack` on every file and the `packs` they add up to (#192); `surfaces` (#187) and an
environment's `surfaces`; `skies` (#213) and an environment's `sky` and `world`; `kits` (#250)
and an environment's `kit` (a kit piece's pivot is its role's, so it has none of its own); and the KTX2
transcoder's folder under `decoders` (#188). Part lists get
no LODs.

It changes by one rule: a new optional field needs no version bump, and a field the client
doesn't know is dropped; a kind, format, usage or class it doesn't know is refused. Only version 2
is read, since the manifest ships with the client that parses it. The parse is all or nothing: one
bad field and the client draws placeholders, never a half-trusted load. The pipeline parses its
own output, so such a manifest never builds.

## The turntable and thumbnails

`/dev/assets` (#194) shows any manifest model as the game draws it: the real renderer
(`tabletop/turntable.ts` through `createTabletop`'s dev-only `devScene` hook), the prop or mini
kind, a figure on its base, on a small plain table or any environment, or a surface of the library
(#187) on a 3×3-cell floor and a 2.0 u wall, its table painted with it when it is a floor's (so an
environment shows it through the terrain kind as the game does), under four lights: day,
dusk, torch (the night with a torch a cell off the model) and moon (the night with a Moonlight
light). Beside it: triangles per LOD with a level picker, the preview (#192) if there is one, its
textures (KTX2 or RGBA), the texture memory its first load added, its licence, and the backend,
tier and GPU (`?backend=webgl`, `?tier=`). Drag orbits, the wheel zooms, the arrow keys turn the
model, and Spin turns it slowly, never under reduced motion. `npm run dev` serves it; a production
build answers 404 there and carries none of it (`scripts/check-bundle.mjs` fails if it does).

Thumbnails: with the dev server up, `node scripts/thumbnails.mjs [http://localhost:1420]
[--only id,id] [--size 256]` opens `/dev/assets?thumb=<id>` for each model (the day light, the
three-quarter pose, a small model drawn larger to fill the frame) and writes
`assets/thumbnails/<id>.png` with its `<id>.meta.json` (a thirdfold original). `npm run assets`
emits each as `thumbs/<id>.<hash>.png` and sets the model's `thumbnail`; a thumbnail with no
model, no provenance or over `THUMBNAIL_BYTES` (64 kB) is refused. The GPU and driver change the
pixels, so they are made by hand after a model changes, never in CI.

## At the table

- **The manifest:** the client fetches `/assets/manifest.json` once (`src/lib/assets/load.ts`),
  always from the page's own origin.
- **Files:** every built file comes through `fetchAsset(file, sha256, priority)` in `load.ts`
  (#191): at most six downloads at once, what a table needs now (`high`) ahead of what it may need
  later (`low`: sounds, lens dirt). With `VITE_ASSET_BASE_URL` set, files come from that asset
  host and are checked against the manifest's whole SHA-256 before anything decodes them; bytes
  that differ are refused (the placeholder stays, and the console says why). Checking needs a
  secure context (`crypto.subtle`); without one (plain http on a LAN) files come from the page's
  own origin, which needs no check. Images are decoded from the checked bytes
  (`tabletop/image-texture.ts`: `createImageBitmap`, flipped as it decodes, colours unconverted).
- **Models:** each loads the first time something uses it (`tabletop/models.ts`, #188), and is
  shared by every prop and token that uses it.
  - Until then a prop shows as a plain box on its footprint, and a token as the plain miniature.
    When the model arrives it replaces them, without waiting on anything else.
  - A model is parts: meshes named `body`, `swing` or `accent`, `<role>_lod<n>` for coarser levels
    (`roleOf`; GLTFLoader's `_<n>` suffixes are allowed), with their node transforms applied and
    pieces of one role, level and material merged. Every part gets the same attributes
    (position, normal, uv, colour, as floats; an accent without colour), so textured and part-list
    models draw with the same programs. Layers draw level 0; `lodFor` picks a level by screen
    share for #274.
  - A cooked model's glTF maps go into the prop and mini kinds' slots (base colour → albedo,
    normal, metallic-roughness → ORM, emissive), on a material of the same variant, so nothing
    compiles. Its textures are uploaded (`initTexture`) before it is drawn.
  - Cooked files (meshopt geometry, KTX2 textures) need the decoders, `tabletop/decoders.ts`: a
    chunk of its own (about 31 kB gz, `scripts/check-bundle.mjs` keeps KTX2Loader out of the
    renderer's), imported the first time a cooked file loads. One KTX2Loader at a time, made for
    the table's renderer (`detectSupport` picks ASTC, BC7, BC1/3 or ETC, else plain RGBA, on
    WebGPU and the WebGL2 fallback alike). Its transcoder is three's own, copied by the pipeline
    into `decoders/basis-<hash>/` and named in the manifest's `decoders`; it is code, so it is
    always served same-origin.
  - Lifecycle: every tabletop calls `initModels(renderer)`; when the last one is disposed
    (leaving the room, a lost device, a new pipeline shape) `releaseModels` frees every model's
    geometry and textures, stops the transcoder's workers and forgets the models, and a load still
    under way is thrown away when it lands. The next table loads them again (from the HTTP cache).
    `models.svelte.spec.ts` loads a cooked fixture (`tests/fixtures/assets/loader/cube.glb`, made
    by `server/fixtures/loader-fixture.ts`) on the WebGL2 fallback and checks its parts, its slots,
    that it is freed and that renderer memory holds steady over reloads.
- **Environments:** load their textures once each, shared by every material that uses them (a
  KTX2 one transcoded by the models' decoders). Changing environments never changes a shader: a
  shader kind's slots always hold a texture, their slot's blank (same type, colour space, wrap and
  filters) when they have none (`defaults.ts`; `docs/RENDERING.md`, "Materials and world
  visibility").
- **Sounds:** load when audio starts (the first click).

### Packs, prefetch and previews (#192)

- **Packs** group files by look, never by a story's places or roles (the manifest is public: a
  pack named for a chapter would tell where the story goes). `server/assets/pipeline-packs.ts`
  puts a texture only one environment wears (its materials, grade strips, surfaces) in that
  environment's pack and everything shared in `core`; a model is in `core` unless its
  `<id>.meta.json` names a `pack` (an asset id); sounds are `core`. The manifest's `packs` lists
  each pack's bytes (with previews) and GPU bytes, and `npm run assets` prints them. It stays one
  file until it passes about 100 kB gzipped.
- **Prefetch:** `src/lib/assets/prefetch.ts` `plan(view, manifest, focus)` orders a table's loads:
  the KTX2 transcoder when anything planned is cooked or KTX2, the environment, every preview
  (`high`), then the models (`low`), tokens' before props', each nearest the camera's cell first.
  The renderer runs it (`prefetch` in `tabletop/models.ts`) whenever its tokens or props change,
  before the layers ask, so the plan's order is the queue's; each file still loads once. A camera
  that moves later changes nothing already queued.
- **Secrecy:** the plan's only inputs are what this viewer was sent (the environment, its tokens'
  models, its props' assets), the public manifest and the camera's cell: never the story, the
  next table or server content. A prop the GM hides, or one under fog, is never sent to a player
  and so never planned for them. `prefetch.spec.ts` checks this on every fixture view (and a
  GM-hidden prop on the test world), and that the planner reads nothing else of the snapshot.
- **Previews:** an `<id>.preview.json` part list beside a model is built as its preview (held to
  the model's class, and lighter than the model). A model with one fetches both at once, the
  preview ahead; the preview shows in place of the placeholder (the loader's `onStage`, which
  `PropLayer` and `TokenLayer` redraw on), then the full model replaces it and the preview is
  freed: one redraw each, no idle frames. The cook step (#186) may emit previews for cooked models
  the same way.

## The asset store

Built files can be served from a public Supabase Storage bucket instead of with the page (#191),
by their content-hashed names, so a file never changes under its name and a browser caches it for
good. The manifest and the decoders always ship with the page: the manifest is what the client
checks everything else against, and the decoders are code.

- **The bucket:** `assets`, made by `supabase/migrations/20260929124252_asset_bucket.sql` (and by
  `[storage.buckets.assets]` in `supabase/config.toml` locally). Public to read, at
  `<project>/storage/v1/object/public/assets/<file>`; no insert, update or delete policy, so only
  the service key writes. Only the asset types (`.glb`, `.png`, `.ktx2`, `.wav`, `.ogg`), up to
  16 MB each.
- **The lock:** `assets/assets.lock.json` maps every hosted file (`ASSET_FILE_PATTERN`) to its
  SHA-256. `npm run assets` writes it; `assets:check` and `pipeline.spec.ts` fail when it isn't
  what the sources build.
- **Publishing:** `npm run assets:publish` (`server/assets/store.ts`, with `SUPABASE_URL` and
  `SUPABASE_SERVICE_KEY`) checks every file in `static/assets/` against the lock, then uploads the
  ones the bucket lacks with `Cache-Control: max-age=31536000`, never replacing one. Run it after
  `npm run assets` on `main`, before deploying a build that points at the bucket.
- **Pulling:** `npm run assets:pull` (with `ASSET_STORE_URL`, the bucket's public URL) downloads
  every locked file missing from `static/assets/`, checked against the lock before it is written,
  and fails on a local file that differs. It restores a checkout without the binaries.
- **The client:** `VITE_ASSET_BASE_URL=<project>/storage/v1/object/public/assets` at build time.
  `fetchAsset` checks every file from there against the manifest's SHA-256 (see "At the table").
- **Native shells:** the Tauri and Capacitor apps always load assets from their own origin
  (`isNativeShell` in `src/lib/api.ts`), whatever `VITE_ASSET_BASE_URL` says. They bundle `build/`,
  so every file ships with them and a KTX2 model loads offline. Every file is the core pack for
  now (about 2.5 MB). Pruning the bundle to a smaller core pack waits for a textured library big
  enough to need it.
- **Tests:** `store.spec.ts` checks the lock, publishing and pulling against a fake Storage API,
  and, with `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SUPABASE_ANON_KEY` set, against a local
  Supabase: a publish once, the year-long cache header, a pull, and the browser key refused a
  write. The CI `supabase` job starts storage and runs it.

### Moving binaries out of git

`static/assets/` is still committed until the hosted project exists. Every source is text today,
so `npm run assets` rebuilds every binary. The switch is one commit:

1. `.gitignore`: add `/static/assets/*` and `!/static/assets/manifest.json`, then
   `git rm -r --cached static/assets` and `git add static/assets/manifest.json`.
2. `package.json`: add `"predev"`, `"pretest"` and `"prebuild"`, each `npm run assets` (or
   `npm run assets:pull` once some binary source lives only in the bucket). CI's `npm test` and
   `npm run build` then rebuild the files before `pipeline.spec.ts` compares them.
3. A workflow on pushes to `main` with the hosted `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` as
   secrets of that job only: `npm ci`, `npm run assets`, `npm run assets:publish`.
4. The web deploy builds with `VITE_ASSET_BASE_URL` set to the bucket's public URL. The shells
   need nothing.
