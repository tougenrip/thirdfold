# Assets

Everything thirdfold draws or plays that isn't rules: models of props and figures, textures,
materials, the look of each place, and sounds. Assets are authored in `assets/`. The asset pipeline
(`server/assets/`) builds them into `static/assets/`, along with a manifest the client reads. The
Hollow Bell is the reference: every prop, figure, place and bell it uses comes through here.

```bash
npm run assets          # build assets/ into static/assets/ (commit both)
npm run assets:check    # fail if static/assets/ isn't what assets/ builds (a test checks this too)
```

## Sources

| Kind                             | Source                                                       | Built into                   |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Props                            | `assets/models/prop/<id>.json`                               | `models/<id>.<hash>.glb`     |
| Characters                       | `assets/models/character/<id>.json`                          | `models/<id>.<hash>.glb`     |
| NPCs                             | `assets/models/npc/<id>.json`                                | `models/<id>.<hash>.glb`     |
| Enemies                          | `assets/models/enemy/<id>.json`                              | `models/<id>.<hash>.glb`     |
| Any model made elsewhere         | `assets/models/<kind>/<id>.glb`                              | copied, after checking       |
| Materials                        | `assets/materials.json`                                      | the manifest                 |
| Textures                         | `assets/textures/<id>.json` (a recipe) or `<id>.png`         | `textures/<id>.<hash>.png`   |
| Environments (how a place looks) | `assets/environments/<id>.json`                              | the manifest                 |
| Audio                            | `assets/audio/<id>.json` (a bell) or `<id>.wav` / `<id>.ogg` | `audio/<id>.<hash>.wav\|ogg` |

Ids are lowercase letters, digits and dashes, and they are the file names. Name an asset by how
it looks (`robed-figure`, `giant-hand`, `cavern`), not by its part in a story. The manifest is
public, so a story's name for something would give it away.

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
  - For a figure, the origin is the top of its base. A figure is about 0.9 tall.
- **`turn`** (radians about x, y, z) tilts a part.
- **Colour:** each part has a `color` or a `material`, except an **accent**. An accent takes the
  token's colour, so one villager model dresses the whole village.
- **Swinging parts:** mark them `"swings": true`, and give the model a `swing`: the height it turns
  about and how far a swing throws it. These are used by the tower bell and the lever.

The pipeline merges the parts into at most three meshes: `body`, `swing` and `accent`. Colours are
baked in as vertex colours. The client draws each prop model with one instanced draw call however
many parts it has, plus one more if it swings.

A `.glb` made in a modelling tool works too. It must hold only meshes named `body`, `swing` or
`accent`, with vertex colours, and nothing else (see Rules). If it swings, put its swing in
`<id>.meta.json`.

Every prop in the catalogue (`ASSETS` in `src/lib/game/props.ts`) must have a model. The catalogue
says what a prop is (footprint, what it blocks); the model only says how it looks.

### Textures, materials, environments

- **A texture recipe** is `{ "recipe": "noise" | "flagstones" | "planks", "size": 16..512 (a power
of two), "colors": [...], "seed": n, "scale": n }`. It builds the same tiling PNG every time. A
  PNG can be provided instead.
- **A material** is `{ "color", "roughness", "metalness", "map": <texture>, "cells": n }`. `cells`
  is how many cells one repeat of the texture covers.
- **An environment** is `{ "name", "surface", "ground", "walls", "table" }`. Each field names a
  material, used for the floor, raised ground, walls and the table's rim.
  - A scene refers to its environment by id (scene file v8).
  - The GM can change it in the Build panel ("Looks like").

### Audio

- **A bell recipe** is `{ "bell": "great" | "flash" | "hand" | "chime" | "motif", "rate": 8000..48000
}`. It renders that bell of the family in `src/lib/audio/bell.ts`, from the same partials the
  engine synthesizes, to WAV.
- **Sound files** can be WAV (PCM) or Ogg (Vorbis or Opus).
- The engine plays The Hollow Bell's great bell (and its flash, an octave up) and the hand bell
  from these samples once they have loaded, and synthesizes them until then.

## Rules the pipeline enforces

- **Nothing executable.**
  - A model is only meshes: no extensions, no linked or data URIs, no images or textures, cameras,
    skins or animations, and only position, normal, colour and UV attributes.
  - Images and sounds are checked by their headers.
  - The manifest is validated again by the client (`parseManifest`). Its file paths can only point
    into `/assets/`.
- **Limits** (`LIMITS` in `src/lib/assets/manifest.ts`):
  - models: 512 kB and 20,000 triangles;
  - textures: 512 kB and 1024 px;
  - sounds: 2 MB and 30 s.
- **Only ids in saves.** Scene files and the room refer to assets by id (`Token.model`, the scene's
  `environment`), never by content. An id the client doesn't know draws as the placeholder.
- **Repeatable.** The same sources build the same bytes. Files are named by a hash of their
  content, so browsers can cache them for good. `server/assets/pipeline.spec.ts` fails when
  `static/assets/` is out of date.
- **Every table checks.** `checkScenes` (`server/assets/scenes.ts`) builds each of The Hollow Bell's
  tables and checks every prop, figure and environment it uses against the manifest. That covers
  the people on its tables and the characters and enemies the story places. Scenes themselves stay
  on the server: a table holds the story's secrets.

## At the table

- **The manifest:** the client fetches `/assets/manifest.json` once (`src/lib/assets/load.ts`).
- **Models:** each loads the first time something uses it (`tabletop/models.ts`, three.js's
  `GLTFLoader`), and is then shared.
  - Until then a prop shows as a plain box on its footprint, and a token as the plain miniature.
  - When the model arrives it replaces them, without waiting on anything else.
- **Environments:** load their textures once each, shared by every material that uses them.
  Changing environments never changes a shader: materials always carry a texture, a blank one when
  they have none.
- **Sounds:** load when audio starts (the first click).
