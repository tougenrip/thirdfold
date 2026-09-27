# The look

What thirdfold's world should look like, measured. The rendering roadmap (milestones 61–78,
[#107](https://github.com/tougenrip/thirdfold/issues/107)) aims at TaleSpire's look, HUD aside. This
page describes the eight reference shots in words, ranks the gaps between them and our renders,
pairs each reference with a fixture table, and sets the rule every milestone is judged by. How the
renderer works is in `docs/RENDERING.md`; how it is measured for cost is in `docs/PERFORMANCE.md`.

## The look in four ingredients

TaleSpire runs on Unity's built-in render pipeline with deferred shading, not HDRP or URP
([dev log 299](http://techsnuffle.com/2021/11/15/talespire-dev-log-299),
[dev log 248](http://techsnuffle.com/2020/12/15/talespire-dev-log-248)). Its look comes from:

1. **Sculpted, hand-painted PBR art.** Miniatures use a painted-plastic material: standard PBR with
   an object-space "paint noise" detail and a packed map for metal, AO, emissive and smoothness
   ([TaleWeaver](https://github.com/Bouncyrock/com.bouncyrock.taleweaver)).
2. **Warm, cheap, unshadowed lights over a cool ambient.** Tiles and props carry thousands of
   deferred point lights; none of them casts shadows.
3. **One good cached sun or moon shadow**, cascaded, redrawn when the board changes.
4. **A small fixed post stack.** TaleWeaver's shipped profile: ACES tone mapping with a warm grade,
   ambient-only AO, bloom from a threshold of 1, chromatic aberration at 0.13, a tinted vignette,
   and depth of field in shots.

None of this is exotic, and all of it can be done in three.js r186. About half of the gap is art.

## The references

The eight screenshots are private (see the last section). They are described here in words only.

1. **A torch-lit goblin camp at night.** A warm key light of about 2000 K from a caged torch
   against an indigo sky fill. AO in the mortar and under the crates, a blooming flame, depth of
   field and chromatic aberration at the edges, a filmic curve. Painted minis on dark bases, one
   with a green ownership ring. No grid is drawn: the cobbles are just cobbles.
2. **A top-down, multi-level undercity at golden hour.** Long soft shadows, neon signs that bloom,
   a heavy warm grade with lifted blacks, tilt-shift and strong chromatic aberration. Stairs,
   balconies and rooftops: height is everywhere.
3. **A red-lit ruined floor over a cliff.** A saturated red key, lava in the cracks, layered flame
   meshes, strata on the cliff face, glossy black bases, crushed blacks and strong depth of field.
4. **A vast gothic battlefield at night.** Deep navy rather than black, pools of red, blue and
   orange light, a lightning effect, dozens of minis on terraces, a heavy vignette.
5. **A daylight coast.** Haze to a horizon with no line, depth-coloured water with foam at the
   shore, stylised clump-canopy trees, layered rock shelves, a warm and slightly desaturated grade.
6. **A night palisade gate.** A navy sky, braziers throwing pools of light with glints on cracked
   flagstones, bushes and logs, a giant's silhouette in the open gate.
7. **Twenty painted minis on grass at noon.** Ringed bases with AO halos, crisp sun shadows, grass
   tiles; no grid lines on screen.
8. **A walled city in the late afternoon.** Long shadows, lanterns glowing by day, red tile roofs,
   timber houses, a ground plane that dissolves into haze.

## The gaps, ranked

Each gap is tagged RENDERING (engine), ART (models and textures) or WORLD (content density and
level-building), with the milestones that close it.

| Rank | Gap                                                                      | Tag               | Closed by                                                                                                                                                                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Surface detail (normal, AO and roughness maps, painted albedo)           | ART + RENDERING   | [#112](https://github.com/tougenrip/thirdfold/issues/112), [#111](https://github.com/tougenrip/thirdfold/issues/111), [#117](https://github.com/tougenrip/thirdfold/issues/117), art in [#123](https://github.com/tougenrip/thirdfold/issues/123) and [#124](https://github.com/tougenrip/thirdfold/issues/124) |
| 2    | Many coloured lights, warm over cool                                     | RENDERING         | [#115](https://github.com/tougenrip/thirdfold/issues/115)                                                                                                                                                                                                                                                       |
| 3    | A sky and a world instead of a table in a void                           | RENDERING + WORLD | [#114](https://github.com/tougenrip/thirdfold/issues/114), [#116](https://github.com/tougenrip/thirdfold/issues/116)                                                                                                                                                                                            |
| 4    | AO and contact shadows                                                   | RENDERING         | [#110](https://github.com/tougenrip/thirdfold/issues/110), [#112](https://github.com/tougenrip/thirdfold/issues/112), [#118](https://github.com/tougenrip/thirdfold/issues/118)                                                                                                                                 |
| 5    | Kit geometry and floors as tiles                                         | ART + WORLD       | [#117](https://github.com/tougenrip/thirdfold/issues/117)                                                                                                                                                                                                                                                       |
| 6    | Painted miniatures on ringed bases                                       | ART + RENDERING   | [#118](https://github.com/tougenrip/thirdfold/issues/118), [#123](https://github.com/tougenrip/thirdfold/issues/123), [#124](https://github.com/tougenrip/thirdfold/issues/124)                                                                                                                                 |
| 7    | HDR post stack: bloom, tone map, grade, vignette, AA                     | RENDERING         | [#110](https://github.com/tougenrip/thirdfold/issues/110)                                                                                                                                                                                                                                                       |
| 8    | Sky-driven ambient (IBL)                                                 | RENDERING         | [#114](https://github.com/tougenrip/thirdfold/issues/114)                                                                                                                                                                                                                                                       |
| 9    | Density, set dressing and decals                                         | WORLD             | [#121](https://github.com/tougenrip/thirdfold/issues/121), [#123](https://github.com/tougenrip/thirdfold/issues/123), [#124](https://github.com/tougenrip/thirdfold/issues/124)                                                                                                                                 |
| 10   | Darkness and fog as shading, not floor overlays                          | RENDERING         | [#111](https://github.com/tougenrip/thirdfold/issues/111)                                                                                                                                                                                                                                                       |
| 11   | Continuous day and night                                                 | RENDERING + WORLD | [#113](https://github.com/tougenrip/thirdfold/issues/113), [#114](https://github.com/tougenrip/thirdfold/issues/114)                                                                                                                                                                                            |
| 12   | Grid as an overlay only when needed, independent of the world's geometry | RENDERING         | [#110](https://github.com/tougenrip/thirdfold/issues/110), [#116](https://github.com/tougenrip/thirdfold/issues/116)                                                                                                                                                                                            |
| 13   | Lens: depth of field, chromatic aberration, grain                        | RENDERING         | [#110](https://github.com/tougenrip/thirdfold/issues/110)                                                                                                                                                                                                                                                       |
| 14   | Shadow quality                                                           | RENDERING         | [#115](https://github.com/tougenrip/thirdfold/issues/115)                                                                                                                                                                                                                                                       |
| 15   | Emissive VFX                                                             | RENDERING + ART   | [#122](https://github.com/tougenrip/thirdfold/issues/122), [#115](https://github.com/tougenrip/thirdfold/issues/115)                                                                                                                                                                                            |
| 16   | Vegetation                                                               | ART + RENDERING   | [#121](https://github.com/tougenrip/thirdfold/issues/121)                                                                                                                                                                                                                                                       |
| 17   | Water                                                                    | RENDERING         | [#120](https://github.com/tougenrip/thirdfold/issues/120)                                                                                                                                                                                                                                                       |

## Pairings

Each reference is paired with a fixture table (`tests/fixtures/scenes`) at one of its named poses,
drawn as the GM sees it with the fog overlay off (the references show no fog of war). The horizon
band is the rows, as fractions of the height from the top, whose colour counts as the horizon.

| Reference | Fixture                                                                                          | Pose     | Band | Horizon band |
| --------- | ------------------------------------------------------------------------------------------------ | -------- | ---- | ------------ |
| 1         | `ref-1`                                                                                          | close    | dark | 0.02–0.10    |
| 2         | `monastery`                                                                                      | overview | dusk | 0.02–0.10    |
| 3         | `ref-3`                                                                                          | close    | dark | 0.02–0.10    |
| 4         | `dungeon-40`                                                                                     | overview | dark | 0.02–0.10    |
| 5         | the coast fixture, from milestone 73 ([#120](https://github.com/tougenrip/thirdfold/issues/120)) |          |      |              |
| 6         | `ref-6`                                                                                          | close    | dark | 0.05–0.20    |
| 7         | `ref-7`                                                                                          | close    | day  | 0.02–0.10    |
| 8         | `ref-8`                                                                                          | overview | dusk | 0.10–0.22    |

The pairings live in `PAIRINGS` in `src/lib/tabletop/look-metrics.svelte.spec.ts`.

## Look metrics

`src/lib/tabletop/look-metrics.ts` turns an image into numbers. Both images are centre-cropped to
16:10, downsampled to 480×300 and converted to Oklab, then summarised:

- **Luminance:** Oklab L at the 5th, 50th and 95th percentiles.
- **Warm and cool:** the chroma-weighted mean hue and the mean chroma of the shadows (L at or below
  the 25th percentile) and of the highlights (at or above the 75th).
- **Saturation:** mean chroma.
- **Local contrast:** the standard deviation of L minus its 9×9 box blur.
- **Vignette:** mean L of the outer 10% ring over mean L of the central quarter.
- **Bloom proxy:** the fraction of pixels with any channel at 95% or more.
- **Sky:** OkLCh of the top 4% of rows (zenith) and of the pairing's horizon band.

`distance(ours, reference)` is a weighted mean of normalised differences, 0 when identical. Hue
differences count only as far as both sides are colourful (the hue of grey means nothing). Weights,
versioned with the JSON (`WEIGHTS_VERSION` 1): luminance 3, shadow and highlight chroma 2 each,
saturation 2, local contrast 2, shadow and highlight hue 1 each, vignette 1, bloom 1, zenith 1,
horizon 1.

Run it with the private references:

```bash
LOOK_REFS=/path/to/references node scripts/look-metrics.mjs --milestone m61
```

or, without them, against the reference numbers already committed:

```bash
node scripts/look-metrics.mjs --milestone m63 --ours-only
```

Results go to `docs/look-metrics.json`: per pairing, the reference's numbers and ours by milestone.

### Milestone 61 baseline

| Reference | Distance                                                     |
| --------- | ------------------------------------------------------------ |
| 1         | 0.171 (0.249 before the owner's review reframed the pairing) |
| 2         | 0.293                                                        |
| 3         | 0.130                                                        |
| 4         | 0.148                                                        |
| 6         | 0.214                                                        |
| 7         | 0.136                                                        |
| 8         | 0.199                                                        |

What the numbers say about today's renders, against every reference:

- **Shadows are warm; theirs are cool.** Our shadow hue sits at 0–30° (brown and red) on every
  night and dusk table; the references' shadows sit at 274–291° (indigo) on refs 1, 3, 4 and 6, and
  at 234° on ref 8. This is the single clearest difference.
- **Half the local contrast.** Ours 0.026–0.039 at night and at dusk against their 0.042–0.095:
  no surface detail, no AO.
- **Dim highlights, little colour.** Our 95th-percentile L is 0.14–0.38 at night and dusk (0.63
  under ref-6's braziers) against their 0.29–0.83, and on refs 1–4 our mean chroma is about half
  theirs.
- **No sky.** Our zenith and horizon are the flat void colour (chroma 0.01); theirs carry the sky's
  hue and are much brighter at the horizon (L 0.5 on refs 2, 7 and 8).

## Milestone 61 review

The owner's review of the baseline (gate G2), in their words where it matters, is the starting point
every later milestone is judged from. The owner is not a lighting artist: this is how the renders
read to them, which is what players will see too.

- **Reference 1, torch room:** majorly underlit, and the camera angle and zoom were wrong. The
  pairing's pose is now low and close, facing the torch wall (distance 4.5, azimuth 10°,
  elevation 26°), and the room keeps only its back walls, open toward the camera, as in the reference. The numbers differ across the whole spectrum.
- **Reference 2, undercity:** not lit enough, no sky, and the table is still the play area: the
  play area must be the world itself.
- **Reference 3, red ruined floor:** the lighting is not close; only vignette and highlight hue and
  chroma come near.
- **Reference 4, gothic battlefield:** not close at all.
- **Reference 7, minis on grass:** mostly right, but without the warm sunlight and a slight bloom
  it looks too sharp and unfinished.
- **The 17 gaps:** all agreed, with one change to gap 12 (below). Nothing is missing.
- **Gap 12, the grid:** the grid is a gameplay overlay independent of the world's geometry. Floors
  and tiles never encode it: thirdfold will support several grid systems and rules systems, which
  need different cell sizes. The grid is drawn by a shader overlay only when needed; the rules that
  live on the grid (walls on edges, movement, sight, levels) are unchanged.
- **Target palettes:** the owner deferred judgement on colour. The palettes below stand as derived
  from the metrics, to be checked by eye when the tone mapper is chosen (#158).
- **Flagged golden images:** twelve, in two groups, both today's design rather than bugs:
  - hard, cell-shaped dark patches (`ref-7`, `ref-8`, `outdoor-64`, `dungeon-40`): the GM's shading
    of what the party cannot see, one cell at a time. Soft fog edges replace it in #174.
  - near-black nights with no light on the table (`ref-7` at night, `ghost-town`): the night is a
    brown near-black with no moon or sky. A moonlit night and a sky replace it in #114.

## Milestone 62

The port to the node renderer, the world scale (#152) and the retune (#153) in one strip,
`docs/look/m62/` (written by the look-metrics run itself from the render it measures). The retune
aimed at baseline v0's look, not at the references: at the old scale it brings the port back to
within 0.009 of v0 (see `docs/RENDERING.md`), so what moved below is the scale.

| Reference | m61   | m62   |
| --------- | ----- | ----- |
| 1         | 0.171 | 0.169 |
| 2         | 0.293 | 0.284 |
| 3         | 0.130 | 0.137 |
| 4         | 0.148 | 0.160 |
| 6         | 0.214 | 0.245 |
| 7         | 0.136 | 0.115 |
| 8         | 0.199 | 0.193 |

- **Ref 1's pose pulled back** from distance 4.5 to 6 (owner, milestone 62): at human height the
  minis and their labels overflowed the frame.
- **Lights seated on their props (#367).** A light on a sconce or brazier draws only its flame, on
  the prop's top, and hangs its pool light there, so ref 6's braziers are lit from inside again and
  ref 1's torch stand carries its flame. Until #232 gives every light a fixture of its kind.
- **Closer on refs 1, 2, 7 and 8.** Walls and minis at human height fill more of the frame the
  way the references do.
- **Further on refs 3 and 4, by 0.007–0.012.** Lamps elsewhere hang 1.6 u up instead of 1 u, so
  the floor right under them is dimmer, against references that are brighter there. The lighting
  milestone (#115) moves these, not the scale.
- **Further on ref 6, by 0.031, though its braziers read as in m61.** The taller walls, lit orange
  by the braziers, now fill more of the frame: median L 0.258 and chroma 0.075 against the
  reference's 0.200 and 0.035 (m61: 0.192 and 0.057). Cooler, dimmer night light (#115, #238)
  moves it.
- **Seen in the strip, left for later:** the monastery's low golden looks at the wall of Oswin's
  cell, since a low camera can't see over 2 u walls; dithering occluders between the camera and
  the minis (#283) fixes it.

## Milestone 63: the tone mapper (#158)

The three tone mappers of r186 on the paired fixtures, with no grade, AO or bloom yet
(`node scripts/look-metrics.mjs --ours-only --milestone m63-tonemap-<name> --tonemap <name>`;
strips in `docs/look/m63-tonemap-<name>/`, side by side in `docs/look/m63-tonemap.png`: ACES,
AgX, Neutral from left to right):

| Reference | ACES  | AgX   | Neutral |
| --------- | ----- | ----- | ------- |
| 1         | 0.172 | 0.168 | 0.158   |
| 2         | 0.287 | 0.250 | 0.283   |
| 3         | 0.140 | 0.128 | 0.140   |
| 4         | 0.162 | 0.150 | 0.123   |
| 6         | 0.247 | 0.218 | 0.262   |
| 7         | 0.127 | 0.143 | 0.125   |
| 8         | 0.194 | 0.187 | 0.235   |
| mean      | 0.190 | 0.178 | 0.189   |

- **ACES** pushes fire toward yellow-white and measures farthest on average; it is what #153's
  retune solved its colours for (backgrounds, the fog's hidden shade, the darkness colour).
- **AgX** is closest on five of seven: hues hold in the highlights, but shadows and backgrounds
  lift toward a cool grey and paint desaturates (ref 7 moves away, 0.127 → 0.143).
- **Neutral** keeps base colours truest and warmest (best on 1, 4 and 7) but clips bright fire
  (worst on 6 and 8).
- All three cost the same, about 1 ms a frame on the RTX 4060 at 1080p (`scripts/perf-gpu.mjs`
  with `PERF_EXTRA=tonemap=<name>`), and all map black to exactly 0.

**Decision (owner, 27 September 2026):** all three stay, as the viewer's choice in the Graphics
menu (Colour: Filmic, Soft, True colour). The default is ACES, `GRADE_TONE_MAPPER`, the one the
grades of #162 are authored after.

## Milestone 63: ambient occlusion (#159)

SSAO on the indirect light only (`docs/look/m63-ao/`, against `m63-tonemap-aces` without it): the
foot of a crate under a sky light loses about 11% of its luminance and a lamp-lit face nothing
(`post.svelte.spec.ts`), but on the paired fixtures the metrics barely move (distances within
0.002, local contrast within 0.001), even at a radius of a cell and 2.5× the intensity. Two
reasons, both for later milestones to lift:

- **Painted floors cover it.** Every paired fixture but the monastery paints its floors, and the
  painted floor is a translucent plane (alpha 220–235) over the table surface: it is not in the
  prepass and takes no AO, and hides most of the AO on the surface below. The ground becomes opaque
  in #240 and #242.
- **Little indirect light.** Today's light is nearly all direct: the sun and its shadows by day,
  torches and lamps at night, where the hemisphere, the only indirect light, is 0.1. The sky light
  (#114) and the lighting of #115 raise the indirect share.

Its reach and depth stay three's defaults (half a cell, 1) until then. Where there is hemisphere light to take, it shows: the railcar's narrow cars
darken between their walls at dusk (its golden re-baselined). SSAO's false occlusion of flat ground
is small: a plain floor under a sky light loses 0.2% of its luminance at 3 units, 0.7% at 10 and 2.9%
at 30.

## Target palettes

From the references' numbers, as OkLCh (L, chroma, hue in degrees) and luminance percentiles:

- **Indigo night (refs 1 and 6).** Zenith about L 0.09–0.14, C 0.023–0.035, h 278°; horizon about
  L 0.26–0.30, C 0.054–0.072, h 276–280°. Shadows h 277–291° at C 0.023; highlights warm, h 41° at
  C 0.09 (the torch). Luminance p5/p50/p95 about 0.05 / 0.20–0.32 / 0.40–0.71.
- **Warm day haze (refs 7 and 8; ref 5 joins with the coast fixture).** Horizon L 0.49–0.53,
  C 0.03–0.08, h 14–94° (a pale warm band); highlights h 44–90°; luminance p50 0.29–0.49, p95
  0.67–0.68; vignette 0.84–0.95 (gentle).
- **Crimson push with crushed blacks (refs 3 and 4).** p5 at 0–0.06; highlights h 24° at C 0.079
  (ref 3) and h 326° (ref 4); shadows cool, h 274–282°; vignette 0.50–0.58 (heavy).

## The closer-shot rule

Every rendering milestone:

1. adds a strip to `docs/look/<milestone>/`: one image per paired fixture, 800×500 or smaller, our
   render at the pairing's pose (`docs/look/m61/` is the baseline: today's renders only);
2. runs the look metrics and commits `docs/look-metrics.json` with its results;
3. must lower the distance on the pairings it touches, or record in its PR why not.

A milestone closes only when the owner's art review agrees the strip moved toward the references,
and records what is still missing. The metrics guide the review; they never replace it.

## Private references

The reference screenshots are someone else's work. They live in a private folder outside git and
are referred to by file name (`1.jpg` … `8.jpg`) and through the `LOOK_REFS` environment variable.
`scripts/look-metrics.mjs` copies them into `.look-refs/`, which is gitignored, for the length of a
run. They are never committed, never uploaded as CI artifacts and never quoted as crops. Only
numbers derived from them are committed.
