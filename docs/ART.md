# The art bible

Every model, texture and surface thirdfold ships is judged against this page, whether we made it,
downloaded it, generated it or commissioned it. It fixes the style, the numbers, where art may
come from and on what terms, and how it is reviewed. It ends with two briefs ready to send. How the
pipeline builds assets is in `docs/ASSETS.md`; what the world should look like, measured, is in
`docs/LOOK.md`. Milestone 65 ([#112](https://github.com/tougenrip/thirdfold/issues/112)) wrote it
([#183](https://github.com/tougenrip/thirdfold/issues/183)).

Where a number here is also in code, the code is the authority and this page names the constant.
Numbers marked _target_ belong to issues that haven't landed yet.

## 1. The style

**Hand-painted stylised PBR**, toward TaleSpire's look: sculpted shapes with chunky, readable
silhouettes, painted colour with hue-shifted darks and warm edge highlights, and standard PBR maps
underneath so torches and the sun catch real relief. Not photoreal, and not flat low-poly either.

The references are `docs/LOOK.md`'s, in words only (no TaleSpire image is ever committed): ref
1's bricks with a hue shift per brick, chipped corners, recessed mortar and rounded cobbles; ref
6's painted palisade and cracked mud with glossy pockets; ref 8's plaster, timber and red roof
tiles; ref 3's broken flagstones and cliff strata; painted minis on dark bevelled bases (refs 4
and 7).

The biggest risk is incoherence: a CC0 kit, a photo scan, a generated mini and a commissioned hero
prop side by side look worse than one consistent plain style. Everything below exists to pull
every asset toward the one look.

## 2. Scale

1 cell = 1 unit = 5 ft, +Y up, and the rules count in levels, never units (`docs/ASSETS.md`,
"Scale").

| What                      | Units       | From                                                 |
| ------------------------- | ----------- | ---------------------------------------------------- |
| One level of raised floor | 0.4         | `STEP_HEIGHT` (`src/lib/tabletop/ground.ts`)         |
| A wall above its floor    | 2.0         | `WALL_LEVELS` 5 × 0.4 (`src/lib/game/visibility.ts`) |
| Eye height                | 1.2         | `EYE_LEVELS` 3 × 0.4                                 |
| A humanoid mini           | 1.15-1.3    | this page                                            |
| Small folk                | 0.8-0.9     | this page                                            |
| Token base today          | r 0.44      | `CylinderGeometry(0.42, 0.44, 0.08)` in `tokens.ts`  |
| Selection ring today      | r 0.47-0.56 | `RingGeometry(0.47, 0.56)` in `tokens.ts`            |

Large and bigger creatures wait on the rules track (#96). Engine-drawn bases of 0.86, 1.9, 2.9
and 3.9 u across for 1-4 cells are a _target_ (#265, #270).

## 3. Texel density

- **Environments:** 512 px per cell. A 2048² trim sheet covers a 4×4-cell repeat: four cells of
  wall run, two walls high.
- **Minis:** about 400 px per unit: 512² for most, 1024² for the four characters and hero enemies.
- **Props:** 512² for small ones, 1024² for hero props.
- **Surfaces:** 512 px per cell, so 2048² per 4×4-cell repeat (`tile` in the surface's
  `meta.json`).

Stay within a factor of two of these, so nothing looks sharper or blurrier than its neighbours.

These are the densities at **high** texture detail (the Graphics menu, docs/ASSETS.md "Texture
detail"): deliver every map at the size above, and the cook makes the 512 px base and the 1K
from it. Each lower setting halves the density where a map is larger than it:

| Texture detail | Largest side | A surface (2 cells a repeat) | A 2048² trim sheet (4×4 cells) | A 1024² hero mini (≈2.5 u) |
| -------------- | ------------ | ---------------------------- | ------------------------------ | -------------------------- |
| High           | 2048         | 1024 px per cell             | 512 px per cell                | about 400 px per unit      |
| Medium         | 1024         | 512 px per cell              | 256 px per cell                | about 400 px per unit      |
| Low (the base) | 512          | 256 px per cell              | 128 px per cell                | about 200 px per unit      |

A map no larger than a setting's side is drawn at its own size at every setting above it, so
small props (512²) look the same at low and high; only large maps gain. Paint for high, and check
the look at low, which phones and the low tier start on.

## 4. Palette and values

- **Albedo values** stay within 30-240 sRGB on every channel. Nothing is pure black or white.
- **Darks are hue-shifted** toward blue and violet, lights toward warm yellow. Never darken by
  adding grey or black.
- **No lighting in the albedo**: no cast shadows, no directional light. Only light cavity AO
  (at most 20% darker) and painted edge highlights.
- **Targets** are `docs/LOOK.md`'s "Target palettes" (indigo night, warm day haze, crimson push).
  Assets are checked against them on the turntable under all four lights, not in isolation.

Per material family, in sRGB value (the brightest channel) and OkLCh chroma:

| Family            | Value   | Max chroma | Notes                                |
| ----------------- | ------- | ---------- | ------------------------------------ |
| Stone, rock       | 45-190  | 0.04       | cool darks, warm tops                |
| Plaster, adobe    | 110-225 | 0.05       | never white                          |
| Wood, timber      | 45-180  | 0.09       | warm; end grain darker               |
| Earth, mud, sand  | 40-220  | 0.08       | sand is the brightest ground         |
| Foliage, grass    | 35-170  | 0.12       | yellow-green tops, blue-green shade  |
| Metal (bare)      | 60-220  | 0.05       | brass and bronze up to 0.10          |
| Cloth, paint      | 35-200  | 0.14       | the only family allowed to be bright |
| Skin              | 80-210  | 0.08       |                                      |
| Emissive (flames) | any     | any        | only in the emissive map             |

A swatch strip rendered from our own assets on the turntable goes in `docs/look/m65/` once #194
can render it.

**Red never flashes** (#223, WCAG 2.3.1's red flash threshold). A red grade or sky (`abyss`,
`blood-moon`, the crimson push) may hold a saturated red, where R / (R + G + B) is 0.8 or more,
but nothing may pulse into or out of one: no emissive, light, VFX or grade that flickers,
strobes or flashes in saturated red, at any speed. A flash over a red grade lifts toward a cool
white instead (`flashPolicy().neutralRed` in `src/lib/tabletop/flash.ts`), and every flashing
effect goes through `flashPolicy`, stays at 3 or fewer flashes in any second, and becomes a fade
of 500 ms or more under the viewer's Reduce flashing setting (`countFlashes` checks captured
frames).

### Surface ramps

The stylise step (#187, section 11) maps each surface's luminance through its ramp, dark to light.
These are the source of truth for #187; changing one changes the surface.

| Surface      | Ramp (dark → light)                                        |
| ------------ | ---------------------------------------------------------- |
| stone        | `#3b3f4a #5e6068 #858276 #aba594`                          |
| wood         | `#3a2a2a #5e4332 #86623f #aa8656`                          |
| grass        | `#243a33 #3d5a35 #62803e #93a55a`                          |
| dirt         | `#3a2c2c #5c4535 #806247 #a2855f`                          |
| sand         | `#6b5a55 #9a8468 #c2a97f #dcc79c`                          |
| riverbed     | `#2e3438 #4d5550 #737566 #97947d`                          |
| cobble       | `#363843 #585a5f #7e7b72 #a39d8a`                          |
| flagstone    | `#3a3d48 #5f5f63 #86826f #aca58d`                          |
| rock         | `#30323d #52535a #7a766c #a19a86`                          |
| mud          | `#2c2527 #4a3a33 #6b5541 #8b7250`                          |
| snow         | `#8a93a8 #b3bccb #d6dbe2 #eeeeef`                          |
| gravel       | `#3b3c44 #5f5e61 #85817a #aaa393`                          |
| plaster      | `#7d7a80 #a39a8c #c0b49f #d9ccb4`                          |
| timber-frame | `#2f2629 #4f3b30 #6f5540 #c9bca4` (the last is the infill) |
| ashlar       | `#4a4a52 #6f6c6a #948d7f #b8ae98`                          |
| brick        | `#3a2629 #6a3a30 #8f5238 #b0714c`                          |
| planks       | `#3a2b2b #5f4533 #856342 #a7855a`                          |
| cave-rock    | `#25252f #3f3e46 #5f5a55 #827a6c`                          |
| adobe        | `#5a4040 #8a5f48 #b0835d #cfa77c`                          |
| palisade     | `#2e2527 #4d3a30 #6d5441 #8e7355`                          |
| roof-tile    | `#3d2428 #6b3330 #93493a #b56a4e`                          |
| thatch       | `#3c3530 #6a5a3d #93804f #b8a46a`                          |
| slate        | `#262a35 #3d4250 #5a5f6b #7d808a`                          |

### Light presets (#238)

Tuned against the torch room (reference 1, fixture `ref-1`, stone-halls) and the night gate
(reference 6, `ref-6`, village) with `scripts/look-metrics.mjs`, at their fixed close poses. Every
value is a constant, a sky key or a grade: nothing compiles, on any tier or backend. The swatches
(`LIGHT_COLORS`) are unchanged; a torch's colour is the light's own, and the flame kinds' warmth
(about 1800-2000 K) is in their swatches, not in the kind.

| What                                                   | Was                               | Now                                                        | Why                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Torch intensity (`LIGHT_KIND_DEFAULTS`)                | 1                                 | 0.7                                                        | Two torch-strength braziers burned the gate's walls and cobbles orange-white (p95 L 0.75 against the reference's 0.40). The focus-cell exposure lift (#233) gives back some of the drop, so the torch room keeps its hot wall (p95 0.59).                              |
| Brazier and fire intensity                             | 1.5                               | 1.05                                                       | The same 1.5 times a torch as before, so a GM's brazier keeps its place against a torch.                                                                                                                                                                               |
| `CORE_MAX` (`lights.ts`)                               | 4                                 | 2.5                                                        | A softer hot core: less of the sconce's wall clips and blooms, and the top of the frame keeps the night's colour, 0.008 closer on the torch room; the gate is unchanged. Within `FALLOFF_RANGES` (1-8).                                                                |
| Temperate night moon (`assets/skies`, 04:30 and 22:00) | 0.15                              | 0.3                                                        | The moonlit cobbles away from the pools read blue, not black (the gate's reference is lit to its edges, vignette 0.91); 0.15 → 0.3 moved the gate 0.004 closer, the torch room not at all. The hemisphere stays 0.1 (doubling it moved neither by more than 0.002).    |
| Village night grade (`assets/grades/village.json`)     | sat 0.9, highlights 1, 0.96, 1.02 | sat 0.6, gain 0.78, 0.78, 0.84, highlights 0.96, 0.9, 1.08 | The gate's reference is a low-chroma night (mean chroma 0.035) whose highlights lean lavender, not orange (hue 341 at chroma 0.05): the grade cools and quiets the village after dark, so fire stays the only warm thing and the pools separate by brightness.         |
| Stone-halls night grade                                | contrast 1.05                     | 1.15, gain 1.1, 1.07, 1.02                                 | The torch room's reference is brighter in its mids and darker in its darks than ours. Contrast and a warm gain lift the torch's pool without the lift a gamma gives the darks (a gamma of 1.25-1.35 measured 0.005 better on ref 1 but lifted ref 3's crushed blacks). |
| Bloom, `READABLE_EDGE`, `LIGHT_DECAY`, flicker         | unchanged                         |                                                            | Bloom's proxy is within 0.009 of both references. A decay of 1.3 tightened the gate's pools (0.007 closer) but cost the torch room 0.008. Flicker is off in the measured renders (reduced motion), so there is nothing to tune it against.                             |

Distances (0 is identical; M67 is the closing strip of the sky milestone, "M68 before" the branch
before this pass):

| Reference     | M67   | M68 before | M68   |
| ------------- | ----- | ---------- | ----- |
| 1, torch room | 0.167 | 0.128      | 0.123 |
| 6, night gate | 0.193 | 0.237      | 0.119 |

The gate's warm pools stay brighter than the moonlit cobbles by about 20 times in relative
luminance as seen and under Machado's protanopia, deuteranopia and tritanopia simulations, so
they separate by brightness, not hue alone.

**Still missing** for the references, none of it light: local contrast (half theirs: normal maps,
roughness pockets and painted cavities, art), the torch room's mids (p50 0.13 against 0.32: its
foreground is open ground outside the room, where the reference is all lit camp), the gate's
lavender highlights (ours are the flames' yellow-white; theirs are pale stone under the moon) and
both skies' indigo at the horizon rows, which our close poses fill with lit wall.

## 5. Stylised PBR rules

- **Roughness** mostly 0.5-0.9. Below 0.4 only for wet, glazed, polished or oily things.
- **Metalness** 1 only on bare metal, 0 everywhere else, never in between except on worn edges.
- **Emissive** only for flames, embers, runes, glowing windows and lava.
- **Translucency** (0 to 1, a part list's `translucency`; docs/RENDERING.md "Translucency") only
  for thin or waxy things that glow with a light behind them: canvas and cloth 0.8, crystal and ice
  0.9, wax 0.5, leaves 0.4. Never a substitute for emissive: in the dark with no light behind, it
  adds nothing.
- **Normals** are MikkTSpace tangent-space, OpenGL convention (+Y up, as glTF). A DirectX-style
  normal map (ambientCG's `NormalDX`) is refused.
- **Bevel everything a light can catch.** Hard 90° edges read as CG; a 0.01-0.03 u bevel or a
  baked bevel normal reads as sculpted.

## 6. Texture sets

A model carries three maps, as glTF's standard slots. A surface carries the same three, with
height in the albedo's alpha.

| Usage      | Space  | glTF slot                         | Holds                               |
| ---------- | ------ | --------------------------------- | ----------------------------------- |
| `albedo`   | sRGB   | `baseColorTexture`                | colour; height in alpha on surfaces |
| `normal`   | linear | `normalTexture`                   | tangent-space normal, OpenGL        |
| `orm`      | linear | `occlusion` + `metallicRoughness` | R occlusion, G rough, B metal       |
| `emissive` | sRGB   | `emissiveTexture`                 | only where something glows          |
| `height`   | linear | none: a surface source            | 16-bit grey accepted                |
| `mask`     | linear | none                              | paint gloss, lens dirt              |
| `lut`      | sRGB   | none                              | colour grade strips                 |
| `sky`      | sRGB   | none                              | reserved for #213                   |

The usage names and colour spaces are `TextureEntry.usage` and `colorSpace` in manifest v2 (#184),
which refuses a mismatch. ORM's alpha is free: emissive strength on props, the owner-tint mask on
minis (white where the player's colour goes, replacing today's `accent` mesh; drawn since #267).

Surfaces cook to one KTX2 file per surface and map, assembled into arrays on the client. The
issue's two-map packing (albedo + height; normal.xy, roughness, AO) is the alternative; the owner
chooses (#187).

## 7. Minis

- Static poses, no animation. No base: the engine draws it.
- **Pose variants** (#273): besides the standing `body`, up to three whole sculpts named
  `body_pose1` to `body_pose3` (underscores, not dots), each its own pose on the same origin and
  base, within the same triangle budget. Commissions deliver a **downed** pose (lying or slumped on
  the base, inside its circle), optionally an **active** one (a readied stance for its turn); the
  art folder's `meta.json` says which is which: `"poses": { "downed": 1, "active": 2 }`. A posed
  mini has no `accent` mesh: it tints through the mask below. Details in docs/ASSETS.md, "Static
  poses for minis".
- Origin at the centre of the base's top face, facing +Z.
- Stay inside the base's circle, except weapons and cloaks by at most 0.1 u.
- LOD0 3,000-6,000 triangles for a 1-cell mini; the figure class allows more for hero figures.
- Painted like a miniature: strong value separation between skin, cloth and metal, highlights on
  every upward edge, and an owner-tint zone (a sash, a cloak, a shield face) at least 10% of the
  visible surface.
- **Tint mask** (#267): ORM alpha, 1 (white) where the owner's colour goes, 0 elsewhere. Paint the
  masked zone in light, low-saturation values: the shader keeps each texel's luminance and replaces
  its hue with the token's. An ORM without a mask (alpha 255 everywhere) tints the whole figure.
- **Edge highlights** are painted into a textured mini's albedo: the engine drybrushes only
  part-list figures, from their baked convexity.
- **The engine's paint** (`miniLook` in `src/lib/tabletop/materials/mini.ts`, global until the
  owner asks for per-environment values): wash `washDark` 0.55 (the albedo at full occlusion),
  drybrush `edgeLight` 0.35 (the most convex edges 35% lighter), varnish clearcoat 0.25 at roughness
  0.35 (off on the low tier), rim power 3, strength 0.04 by day in warm white (1, 0.92, 0.8) and
  0.35 at night or in the dark in moon blue (0.45, 0.6, 1), doubled on hover and selection.

## 8. Kits

What #250 enforces (`src/lib/assets/kit.ts`; the roles and their envelopes in docs/ASSETS.md,
"Architecture kits"):

- 1 u per cell edge; a straight wall exactly 2.0 u (`WALL_HEIGHT`) tall, a plinth one step
  (0.4 u); exterior face +Z.
- **Pivots.** The model's origin is its role's pivot: an edge piece's at the midpoint of the cell
  edge **on the higher floor** beside it (what lies below that floor down a drop is its own piece,
  `wall.retaining`); a corner piece's at the grid corner on the highest floor round it; a floor
  tile's at the cell's centre on its floor.
- Snapping at 0.5 u.
- One 2048 trim sheet per kit, and 3-4 variants per piece so a long wall doesn't repeat.
- **Thickness.** At most 0.07 u each side of the edge toward a walkable or unexplored cell, so a
  0.86 u base still fits the cell. Up to 0.35 u only toward the void or off the grid, and only on
  the roles made for it (`wall.outer`, `wall.boundary`, battlements; a solid prop's cell doesn't
  count, since props move). The build measures every piece and names the one that is too thick.
- **Chunkiness** from detail, not thickness: 0.3 u square corner posts (0.495 u from any cell's
  centre), caps that may overhang 0.03 u but only above 1.45 u (`FIGURE_CLEAR`, over the minis'
  heads), plinths and relief within the 0.07 u. Nothing on an edge rises over the wall's 2.0 u
  but a post's finial (0.15 u); crenels are cut into the wall's top, never merlons added above it.

**Greybox kits** (#261) are every built-in environment's kit until authored art replaces it, role
by role: part lists made by `scripts/make-kits.ts`, in the environment's colours from the surface
ramps (section 4), within every envelope above and at most 1,500 triangles a piece (docs/ASSETS.md,
"Greybox kits"). Chunkiness comes from courses, boards, frames and footings within 0.07 u, never
from thickness; a brief for an authored kit (section 16) starts from the greybox kit's roles. The
stone halls' pilot (#263, brief B) is the first authored kit: one trim sheet, a manifest material
every piece lists in `materials`, and pieces that embed no texture.

## 9. Naming

- **Ids describe looks, never story roles.** The manifest, credits and thumbnails are public, so
  `robed-figure`, not a character's name; `great-bell`, not what it does in a story. The four
  playable characters may be named: players pick them in the open.
- **Ids** are lowercase letters, digits and dashes (`ASSET_ID_PATTERN`), and are the file names.
- **Mesh roles** inside a model: `body`, `swing` (the part that swings about the manifest's
  pivot), `accent` (tinted by the token colour, until the ORM tint mask replaces it).
- **LODs** are `<role>_lod<n>`: `body_lod1`, `swing_lod2`. GLTFLoader strips `.`, `:`, `/`, `[` and
  `]` from node names and turns spaces into `_` (`PropertyBinding.sanitizeNodeName`), so
  `body.lod1` would arrive as `bodylod1` and match nothing. `models.ts` matches names exactly.

## 10. Budgets

`LIMITS` in `src/lib/assets/manifest.ts` is the authority; both `buildAssets` and the client's
`parseManifest` refuse anything over it. Manifest v2's classes (#184):

| Class                           | LOD0 triangles | Texture px                    | File bytes | GPU bytes |
| ------------------------------- | -------------- | ----------------------------- | ---------- | --------- |
| kit (trim sheets are materials) | 1,500          | 2048                          | 256 kB     | 2 MB      |
| prop, decor                     | 20,000         | 2048                          | 4 MB       | 16 MB     |
| foliage                         | 6,000          | 2048                          | 2 MB       | 8 MB      |
| fx                              | 2,000          | 1024                          | 1 MB       | 4 MB      |
| figure (character, npc, enemy)  | 40,000         | 2048                          | 4 MB       | 16 MB     |
| set piece (`setPiece`)          | 60,000         | 2048                          | 8 MB       | 32 MB     |
| standalone texture              | n/a            | 2048 (sky: 4096 only as KTX2) | 4 MB       | 32 MB     |

These are ceilings per asset. What a whole table may load is #193's per-table budget. Aim well
under the ceiling: a 1-cell mini at 6,000 triangles, a kit piece at 500-1,500.

## 11. Surfaces from CC0 sets

The floor and wall surfaces (#187) start from CC0 scans, repainted so they read as painted:

1. **Pick a set** on [ambientCG](https://ambientcg.com/) or [Poly Haven](https://polyhaven.com/)
   that tiles and has colour, OpenGL normal, roughness, AO and height maps at 2K. Prefer sets with
   strong, chunky relief: the relief survives, the photo colour doesn't.
2. **Record it** in `art/surfaces/<id>/meta.json`: the download URL and the sha256 of the file
   downloaded, its provenance (section 13, `CC0-1.0`, `modified: true`), and the stylise settings.
   `scripts/fetch-surfaces.mjs` fetches and checks each set by that hash.
3. **Stylise** (`server/assets/stylise.ts`, deterministic, run by the cook):
   - luminance through the surface's ramp (section 4), mixed with the source's own hue detail at
     `detail` (default 0.25);
   - values compressed into 30-240;
   - cavities darkened and shifted cool, edges lightened, from a difference of Gaussians on the
     height;
   - roughness remapped into 0.5-0.9, cavities rougher;
   - the normal's relief boosted by `normalBoost` (default 1.5);
   - an optional hand-painted `touchup.png` composited last.
4. **Check** that it still tiles (opposite edges compared) and that the values are in range.
5. **Review** it on the turntable (section 14). A set that still reads as a photograph is refused,
   and another set or a stronger recipe is tried.

The sets picked (2K PNG, ambientCG unless named; each surface's `meta.json` has the URL and hash;
a Poly Haven set is one file per map, its `maps` beside the colour map's `source`), awaiting the
owner's review:

| Surface      | Set                               | Why                                                          |
| ------------ | --------------------------------- | ------------------------------------------------------------ |
| stone        | PavingStones131                   | old medieval paving, deep joints                             |
| wood         | Planks039                         | large rough medieval planks                                  |
| grass        | Grass004                          | dense short grass                                            |
| dirt         | Ground103                         | old brown earth with stones                                  |
| sand         | Ground080                         | beach sand, soft ripples                                     |
| plaster      | Plaster003                        | rough wall plaster                                           |
| ashlar       | Bricks100                         | old beige stone blocks, recessed mortar                      |
| planks       | Planks021                         | raw rough wall planks                                        |
| riverbed     | Rocks022                          | rounded river pebbles                                        |
| cobble       | PavingStones141                   | old rounded medieval cobbles                                 |
| flagstone    | PavingStones149                   | large broken slabs, cracked                                  |
| rock         | Rock030                           | grey cliff rock, walkable relief                             |
| mud          | Poly Haven mud_cracked_dry_03     | cracked mud (ref 6)                                          |
| snow         | Snow006                           | stomped snow with footsteps                                  |
| gravel       | Gravel022                         | grey pebble gravel                                           |
| timber-frame | Poly Haven wood_inlaid_stone_wall | no CC0 half-timbered set: stone with a timber band, stand-in |
| brick        | Bricks076A                        | old medieval bricks                                          |
| cave-rock    | Rock035                           | dark cave rock                                               |
| adobe        | Poly Haven clay_block_wall        | cracked clay blocks                                          |
| palisade     | Poly Haven wood_trunk_wall        | a wall of upright logs                                       |
| roof-tile    | RoofingTiles014A                  | clay roof tiles                                              |
| thatch       | ThatchedRoof001A                  | straw thatch                                                 |
| slate        | RoofingTiles001                   | old slate roof                                               |

## 12. Sources and licences

The allowlist, as SPDX ids. `LICENSES` in `src/lib/assets/manifest.ts` is exactly this list;
change both together. Every file's manifest entry carries a credit from it (#189; the checks are in
`server/assets/licence.ts`, the rules in docs/ASSETS.md, "Licences and provenance").

| Licence                             | Conditions                                                   |
| ----------------------------------- | ------------------------------------------------------------ |
| `CC0-1.0`                           | source URL and hash recorded (#189's provenance check)       |
| `CC-BY-4.0`                         | author, source and "modified" credited on `/credits`         |
| `LicenseRef-thirdfold-commissioned` | a signed assignment on section 16's terms, kept by the owner |
| `LicenseRef-thirdfold-original`     | made by a contributor for thirdfold, or by our recipes       |

Good CC0 sources: Poly Haven, ambientCG, KayKit, Quaternius and Kenney. Use one source family per
kit, recoloured to the palette; don't mix two kits' pieces in one wall.

**The CC0 bridge (#262)** takes from Poly Haven and ambientCG only (the owner's decision): models
from Poly Haven, textures and surfaces from ambientCG or Poly Haven, each fetched by a pinned URL
and SHA-256. Every bridge prop is recoloured through one of the surface ramps (section 4, "Surface
ramps": wood for wooden things, stone for stone), so one palette holds whatever the scan's photo
colours were; the cook does it (docs/ASSETS.md, "CC0 bridge props"), and `stylise.spec.ts` fails a
prop whose ramp isn't one of them. A bridge prop is one family per environment by construction
(all Poly Haven), and carries one albedo map (the scan's occlusion baked in at most 20% darker, no
normal or ORM map) to keep each table within its budget.

**Refused, whatever the price:**

- **Store licences that forbid web-extractable redistribution**: Synty, Fab, the Sketchfab Store
  (Standard and Editorial) and Unity Asset Store packs. A browser can always extract what it
  downloads, and shared tables and published adventures pass assets on to third parties, which
  these terms forbid. The only exception is a seller's written grant of those rights.
- **Non-commercial or no-derivatives licences** (any `-NC` or `-ND`).
- **Free-plan AI output.** Meshy's help centre says free-plan generations belong to Meshy and are
  licensed back under CC BY 4.0; other tools' free tiers are similar or unclear.
- **Unrepainted AI output** (section 12a).
- **Anything without provenance**: no source, no author, no licence text, "found on Pinterest".
- **Photographic-looking surfaces**, whatever their licence (section 11).

### 12a. AI policy

- Paid or self-hosted plans only, whose terms give us the output. Record the tool, version, plan
  and date in the provenance.
- Every generated asset is cleaned up, rebaked and repainted by a person before it ships
  (`modified: true`). The US Copyright Office's
  [Part 2 report](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf)
  holds wholly generated output uncopyrightable; the human work is what we own.
- No Hunyuan3D weights without legal review: their
  [licence](https://github.com/Tencent-Hunyuan/Hunyuan3D-2/blob/main/LICENSE) excludes the EU, the
  UK and South Korea and caps monthly users. #189 denies the tool by name.
- No store-licensed or unknown inputs (reference images, meshes) fed to a generator.
- Minis and small props only. Never kit pieces that snap or tile, never surfaces, never hero props
  such as the great bell.

Licence terms change; re-check the linked pages before relying on them.

## 13. Provenance

Every asset carries a provenance record, and the build refuses one without it (#189):

```json
{
	"provenance": {
		"license": "CC0-1.0",
		"author": "ambientCG",
		"source": { "url": "https://ambientcg.com/view?id=…", "sha256": "<64 hex of the download>" },
		"modified": true,
		"ai": { "tool": "…", "version": "…", "plan": "paid", "date": "2026-10-01" }
	}
}
```

- `license` from the allowlist; `author` a person, studio or site; `source` required for CC0 and
  CC-BY, https only (#189's provenance check enforces the URL and hash, not the manifest);
  `modified` whether we changed it; `ai` only when a generator was used, which also requires
  `modified: true`.
- A binary source (a GLB, PNG, WAV or Ogg) carries its own `<id>.meta.json` or `meta.json`. Only
  text sources (part lists, recipes) may fall back on a folder's `_provenance.json`, and that
  default may only grant `LicenseRef-thirdfold-original`.
- The manifest carries a compact `credit` on every file (`license`, `author`, `source`,
  `modified`, `ai`), and `/credits` lists them. A credit never names a story's people or places.
- Commissioned work also keeps the signed assignment and the invoice, outside git, with the owner.

## 14. Review

Nothing ships unreviewed. The reviewer (section 18) looks at every new or changed asset on the
turntable, `/dev/assets` (#194, a dev-only page: `npm run dev`, then open it; docs/ASSETS.md, "The
turntable and thumbnails"):

1. under all four lights: **day, dusk, torch and moon**;
2. at the tactical and close camera, beside a 1.2 u reference mini and a 2.0 u wall;
3. with its triangle count, LODs, texture sizes, measured GPU memory and licence shown.

The reviewer checks it against this page: scale, values and hue-shifted darks, no light in the
albedo, readable silhouette at tactical distance, naming, and that it looks painted, not
photographed. The verdict (accepted, or what to change) goes in `docs/LOOK.md` under the
milestone, with the asset id. A refused asset doesn't merge.

## 15. Hosting

Asset binaries are hosted in **Supabase Storage**, a public bucket, by content hash (#191):

- Objects are named as the manifest names them (`models/<id>.<first 8 hex of sha256>.glb`), and
  the manifest carries each file's full sha256. The client checks the digest of every file it
  fetches from the bucket and falls back to the placeholder on a mismatch.
- Objects are immutable by naming: a changed file gets a new name, so CI writes each once and
  never overwrites it. Uploads set `cacheControl: '31536000'`, which Supabase serves as
  `Cache-Control: max-age=31536000`. Nobody but the service key can write.
- Source binaries (2K surface maps, Blender exports) are stored the same way, recorded by sha256
  in a lock, so git keeps only text: JSON sources, `meta.json` files, the manifest and the lock.
- The core pack (what the first table and the native shells need) is still served same-origin.

## 16. Commissions

Terms every commission must carry, in a written assignment signed before work starts:

- perpetual, worldwide, irrevocable rights to distribute the work as files a browser can
  extract, in a user-generated-content VTT;
- the right to modify it and to sublicense it to users, whose tables and adventures carry it on;
- credit as the artist wishes, or none;
- delivered: the `.blend`, the painter files (Substance or equivalent) with bakes, the high-poly
  sculpt, the exported GLB and the texture PNGs.

The licence is then `LicenseRef-thirdfold-commissioned`. The owner approves the terms and the
budget before any brief is sent.

### Brief A: the great bell (the pilot, #196)

A giant bronze church bell hanging in a heavy timber-and-iron frame over a pit, for a cavern
lit by torches and by a cold blue glow from below. It is the centrepiece of a whole table and is
seen from far off and close up.

- **Look.** Old, massive bronze, dark green-brown patina in the recesses, warm bronze worn bright
  on the lip and raised bands. Three raised bands of worn, illegible lettering (no real script).
  A crack running up from the lip. The frame: two A-shaped timber trestles, black iron straps and
  bolts, a thick yoke beam the bell hangs from, a few chains running down into the dark.
  Hand-painted stylised PBR per this page; readable from the tactical camera as one shape.
- **Scale.** Footprint 3×3 cells (3 × 3 u); the bell's lip about 2.4 u across; the whole about
  4.5 u tall. Frame it against a 1.2 u mini.
- **Meshes.** `body` (the frame and anything that stays still), `swing` (the bell and its clapper,
  pivoting about the yoke's axis), each with `_lod1` and `_lod2`.
- **Budget.** Set piece: LOD0 at most 30,000 triangles (ceiling 60,000), LOD1 about 50%, LOD2
  about 15%.
- **Textures.** 2048² albedo, normal and ORM (the cook makes the 512 base and the 1K), plus an
  emissive mask for a faint rim glow on the lip.
- **Deliver** as `art/prop/great-bell/`: `great-bell.glb` (textures embedded as 8-bit PNG),
  `meta.json` (provenance, the swing's pivot height and throw), the `.blend`, the painter files
  and the high-poly.
- **Review** on the turntable under the four lights, then in its table at the close and
  overview camera, by the reviewer. Two rounds of changes are included.

Until it is commissioned, the pilot is made in house (`LicenseRef-thirdfold-original`) by
`scripts/make-bell-art.ts`: the same meshes, pivot, maps and export shape, procedural rather than
sculpted, every map at 2048² (the emissive rim at 512²), so it has all three texture details.

### Brief B: a stone-halls wall (the first kit piece, #263)

A straight monastery wall of dressed stone, one cell edge long, the first piece of a kit.

- **Look.** Ashlar blocks of uneven size with chipped corners, a per-block hue shift and recessed
  mortar, a plinth course at the bottom and a projecting cap at the top. Grey-ochre stone, cool in
  the joints, warm on the top edges, per the `ashlar` ramp. Moss only in the lowest joints.
- **Scale.** 1.0 u long, 2.0 u tall above the floor. Thickness 0.07 u each side of the cell edge,
  plinth course included; the cap course is its own piece (`cap`, which may overhang 0.03 u only
  above 1.45 u); corner posts 0.3 u square come later in the kit. Pivot at the midpoint of the
  cell edge on the higher floor, exterior facing +Z.
- **Pieces.** Three variants of the straight wall (`wall.straight`), each its own asset:
  `stone-wall` (plain), `stone-wall-cracked` (a cracked block) and `stone-wall-niche` (a small
  niche, cut into the 0.14 u, never standing proud of it), and the cap course (`cap`,
  `stone-wall-cap`), sharing one trim sheet.
- **Budget.** Kit: LOD0 500-1,500 triangles each; LOD1 at about 50%.
- **Textures.** One 2048² trim sheet (albedo, normal, ORM) shared by the whole kit, 512 px per
  cell. It ships once, as standalone textures referenced by one manifest material (`map`,
  `normal`, `orm`) that each variant lists in `ModelEntry.materials`; the GLBs embed no textures.
- **Deliver** as `art/kit/<id>/` for each variant: `<id>.glb` with meshes `body` and `body_lod1`
  only, its `meta.json` listing the trim sheet's material in `materials`; plus each of the trim
  sheet's PNGs with its `meta.json` (`usage`) in `art/texture/<id>/`, where the cook reads
  textures; the `.blend` and the trim sheet's painter file.
- **Review** as brief A, plus a run of eight walls in a row to check the variants don't repeat.

Until it is commissioned, the pilot kit is made in house (`LicenseRef-thirdfold-original`) by
`scripts/make-stone-halls-art.ts` (docs/ASSETS.md, "The stone-halls pilot kit"): the trim sheet
(`ashlar-trim`: albedo, normal and ORM painted at 2048², strips of coursed ashlar, dressed stone,
rubble, paving, oak, iron and leaded glass in the ashlar, stone, flagstone, planks and slate ramps)
and 37 pieces in every role the greybox kit fills but the roofs and the plank and terracotta floors,
procedural rather than sculpted, delivered the way this brief asks. The three wall variants here
are `ashlar-wall-a`/`-b`, `-cracked` and `-niche`, and the cap `ashlar-coping`. A commission
replaces it role by role; `stone-halls-greybox` stays the fallback.

The four characters' minis (#276) get their brief once these two are accepted.

## 17. Blender export checklist

Matches what the cook (#186) expects:

- [ ] Scene units metres, 1 unit = 1 cell; the model at the scale in section 2.
- [ ] +Y up in the export (Blender's glTF exporter's default); the model faces +Z.
- [ ] All transforms applied (location, rotation, scale); origin as section 7 or 8 says.
- [ ] Meshes named by role: `body`, `swing`, `accent`, `<role>_lod<n>`; nothing else.
- [ ] Tangents exported (MikkTSpace); normals OpenGL.
- [ ] One material per mesh at most, Principled BSDF with the texture sets of section 6.
- [ ] Textures embedded as 8-bit PNG (a kit's trim sheet ships apart, as brief B), power-of-two
      sizes, at or under the budget.
- [ ] No cameras, lights, animations, shape keys or extra UV sets.
- [ ] Export as `.glb` into `art/<kind>/<id>/<id>.glb` beside its `meta.json`, then
      `npm run assets:cook` and `npm run assets`.

## 18. Sign-off

The owner signs off, on #183:

- [ ] hand-painted stylised PBR as the target style;
- [ ] who reviews art (the name that goes on every verdict);
- [ ] the licence allowlist, the refused list and the AI policy;
- [ ] the commission terms, and when to send the two briefs;
- [ ] the surface ramps in section 4.
