# Assets

Everything thirdfold draws or plays that isn't rules: models of props and figures, textures,
materials, the look of each place, and sounds. Assets are authored in `assets/`. The asset pipeline
(`server/assets/`) builds them into `static/assets/`, along with a manifest the client reads. The
Hollow Bell is the reference: every prop, figure, place and bell it uses comes through here.

```bash
npm run assets          # build assets/ into static/assets/ (commit both)
npm run assets:check    # fail if static/assets/ isn't what assets/ builds (a test checks this too)
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
| Any model made elsewhere         | `assets/models/<kind>/<id>.glb` (`<id>.meta.json`: swing, set piece)                   | copied, after checking             |
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

## Rules the pipeline enforces

- **Nothing executable.**
  - A model (`checkGlb` in `server/assets/glb.ts`, the JSON in `gltf-check.ts`) is checked against
    an allowlist, first as JSON before anything is decoded, then decoded:
    - one GLB with its JSON chunk at most 256 kB and one embedded buffer (plus meshopt's empty
      fallbacks); no `uri` anywhere;
    - only the extensions `EXT_meshopt_compression`, `KHR_mesh_quantization`,
      `KHR_texture_basisu`, `KHR_texture_transform` and `KHR_materials_emissive_strength` (at most
      50), anywhere in the file; so no Draco, lights, instancing or other material extensions, and
      no `KHR_meshopt_compression` until the checker can decode it;
    - no skins, animations, cameras or morph targets; at most 256 nodes, 16 deep, as a tree;
    - meshes, and their nodes, named `body`, `swing` or `accent`, optionally `_lod1` or `_lod2`;
    - attributes POSITION, NORMAL, TANGENT, TEXCOORD_0/1, COLOR_0 and `_BAKE`, each in the formats
      its semantic allows (quantised integers only with `KHR_mesh_quantization`), in triangles,
      with unsigned indices;
    - every accessor inside its buffer view, every view inside its buffer, and what meshopt says it
      will decode to at most the class's GPU bytes, summed before anything is decoded;
    - images are KTX2 in the file, taken only through `KHR_texture_basisu` (no fallback);
      materials only the PBR metallic-roughness values, OPAQUE or MASK;
    - once decoded, every index below its vertex count; triangles counted per level of detail,
      bounds taken from every vertex through the node transforms, and each texture checked as a
      KTX2 file in the colour space of the slot it fills.
  - A KTX2 texture, in a model or on its own (`checkKtx2` in `server/assets/ktx2.ts`), is Basis
    Universal: ETC1S with BasisLZ, or UASTC with Zstd or none; sides multiples of 4 up to the
    class's pixels, no more mip levels than the size has, every block and level inside the file,
    what Zstd would inflate to within the class's GPU bytes, sRGB or linear as its usage needs, one
    face (six for a sky) and one layer (up to 32 on its own, for arrays).
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
