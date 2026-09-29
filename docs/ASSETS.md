# Assets

Everything thirdfold draws or plays that isn't rules: models of props and figures, textures,
materials, the look of each place, and sounds. Assets are authored in `assets/`. The asset pipeline
(`server/assets/`) builds them into `static/assets/`, along with a manifest the client reads. The
Hollow Bell is the reference: every prop, figure, place and bell it uses comes through here.

```bash
npm run assets          # build assets/ into static/assets/ (commit both)
npm run assets:check    # fail if static/assets/ or the lock isn't what assets/ builds (a test checks this too)
npm run assets:cook     # cook art/ into assets/ (see Cooking art); -- --check only compares hashes
npm run assets:publish  # upload new built files to the asset store (see "The asset store")
npm run assets:pull     # download built files missing here from the asset store
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

The pipeline merges the parts into at most three meshes: `body`, `swing` and `accent`. Colours are
baked in as vertex colours. The client draws each prop model with one instanced draw call however
many parts it has, plus one more if it swings.

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
  PNG can be provided instead.
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
- **An environment** is `{ "name", "surface", "ground", "walls", "table" }`. Each field names a
  material, used for the floor, raised ground, walls and the table's rim. `table` is optional:
  without it the rim wears the floor's look (#220 takes the rim away).
  - A scene refers to its environment by id (scene file v8).
  - The GM can change it in the Build panel ("Looks like").

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

| Art source                                                  | Cooked into                                            |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| `art/<kind>/<id>/<id>.glb` + `meta.json` (a Blender export) | `assets/models/<kind>/<id>.glb` + `<id>.meta.json`     |
| `art/texture/<id>/<id>.png` + `meta.json`                   | `assets/textures/<id>.ktx2` + `<id>.meta.json` (usage) |

`meta.json` holds the `provenance` (required, docs/ART.md section 13, copied into the cooked
meta), and optionally `swing`, `setPiece`, `textureSize` (the largest side; bigger maps are halved
until they fit), `lods` (per level `{ ratio, error, screenSize }` over the defaults), `lockBorder`
(kit pieces, so simplified seams stay closed) and, for a texture, `usage`. The export follows
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
   and ORM UASTC with RDO (λ 0.5) and Zstd, linear. PNGs are 8-bit grey, grey and alpha, RGB or
   RGBA, or 16-bit grey (`decodePng`, `png.ts`).
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
would (`body`, `swing` with its pivot in `meta.json`, UVs, one material with painted albedo, normal,
ORM and emissive PNGs; the same bytes on every run under Node 22), and its old part list is
`great-bell.preview.json`, shown until the cooked bell arrives. Its numbers are in
PERFORMANCE.md ("The great bell").

Where `art/` and the cooked binaries are kept, and the upload, is #191; 1K variants for the mobile
tier are #358.

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
  cooked, the Basis transcoder counts once. Over `TABLE_BUDGETS` (desktop 15 MB download and
  160 MB GPU, mobile 6 MB and 80 MB with textures held to 1024 px) the build fails, naming the
  adventure, the table and the number. `npm run assets` prints the report: a row per environment
  alone, in brackets, then a row per table, with its download, its GPU bytes on desktop, and its
  GPU bytes on mobile. The budgets and today's totals are in
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
materials a kit piece or decor wears), a kit piece's `pivot` and `footprint`, a `preview` model
and a `thumbnail`; `credit`, required on every file (`{ license, author, source?, modified?, ai? }`, #189);
`pack` on every file and the `packs` they add up to (#192); `surfaces` (#187) and an
environment's `surfaces`; and the KTX2 transcoder's folder under `decoders` (#188). Part lists get
no LODs.

It changes by one rule: a new optional field needs no version bump, and a field the client
doesn't know is dropped; a kind, format, usage or class it doesn't know is refused. Only version 2
is read, since the manifest ships with the client that parses it. The parse is all or nothing: one
bad field and the client draws placeholders, never a half-trusted load. The pipeline parses its
own output, so such a manifest never builds.

## The turntable and thumbnails

`/dev/assets` (#194) shows any manifest model as the game draws it: the real renderer
(`tabletop/turntable.ts` through `createTabletop`'s dev-only `devScene` hook), the prop or mini
kind, a figure on its base, on a small plain table or any environment, under four lights: day,
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
