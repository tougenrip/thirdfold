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

## Milestone 63: bloom (#160)

`docs/look/m63-bloom/` against `m63-ao`: the braziers of refs 3 and 6, the ringing lamp of ref 1
and the Cultist's lamp glow in a tight halo; the noon minis of ref 7 do not change.

| Reference | distance before | after | bloom proxy (reference) | before | after  |
| --------- | --------------- | ----- | ----------------------- | ------ | ------ |
| 1         | 0.173           | 0.170 | 0.0190                  | 0.0131 | 0.0159 |
| 3         | 0.140           | 0.139 | 0.0060                  | 0.0013 | 0.0016 |
| 4         | 0.164           | 0.148 | 0.0000                  | 0.0013 | 0.0015 |
| 6         | 0.247           | 0.261 | 0.0004                  | 0.0058 | 0.0071 |
| 7         | 0.128           | 0.128 | 0.0094                  | 0.0007 | 0.0007 |

Ref 1 moves toward its reference and ref 7 holds. Ref 6 moves away: its reference fire is orange
and never reaches 95% in any channel, while our brazier cores already clip toward white under
ACES, and the glow adds to them. The fire's own colour (#115, #312) and the grade (#162) are what
bring it back, not a weaker bloom.

## Milestone 63: the lens (#161)

`docs/look/m63-lens/` against `m63-bloom`: a dark-purple vignette at the corners, colour fringes
toward the edges, grain (off in the strips, which draw with reduced motion) and dither.

| Reference | distance before | after | vignette (reference) | before | after |
| --------- | --------------- | ----- | -------------------- | ------ | ----- |
| 1         | 0.170           | 0.175 | 0.611                | 0.581  | 0.522 |
| 2         | 0.286           | 0.298 | 0.926                | 0.740  | 0.666 |
| 3         | 0.139           | 0.138 | 0.497                | 0.752  | 0.672 |
| 4         | 0.148           | 0.144 | 0.575                | 0.978  | 0.874 |
| 6         | 0.261           | 0.259 | 0.906                | 0.454  | 0.409 |
| 7         | 0.128           | 0.131 | 0.840                | 1.024  | 0.924 |
| 8         | 0.195           | 0.203 | 0.952                | 0.678  | 0.610 |

The vignette metric (the outer ring's luminance over the centre's) moves toward refs 3, 4 and 7
and away from 1, 2, 6 and 8. In those four our light already sits in the middle of the frame (a
lamp at the centre, dark walls round it), so our edges are darker than the references' before any
vignette; theirs are lit by ambient and sky light we do not have yet (#114, #115). The vignette's
strength is the owner's call in review; each of the three lens effects is its own Graphics
option.

## Milestone 63: the colour grades (#162)

`docs/look/m63-grade/` against `m63-lens`, under ACES. The paired fixtures are stone-halls (refs 1,
3 and 4 at night, 2 at dusk) and village (7 by day, 8 at dusk, 6 at night).

| Reference | distance before | after |
| --------- | --------------- | ----- |
| 1         | 0.175           | 0.176 |
| 2         | 0.298           | 0.297 |
| 3         | 0.138           | 0.144 |
| 4         | 0.144           | 0.138 |
| 6         | 0.259           | 0.238 |
| 7         | 0.131           | 0.112 |
| 8         | 0.203           | 0.210 |
| mean      | 0.193           | 0.188 |

Ref 7's warm yellow-green day, ref 6's cooler, less orange night and ref 4 move toward their
references. The references' shadows are blue-violet (hue 275–290 at night); ours are the darks
warmed by lamp spill, so a grade pulls them only part of the way (refs 3 and 8 move away a
little). The night's blue fill (#167) and the sky light (#114) supply the cool darks a grade then
shapes. The grades are restrained on purpose: each is a few numbers in `assets/grades/`.

## Milestone 63: depth of field (#165)

`docs/look/m63-dof/` against `m63-grade`: every pose drawn with depth of field on, focused on the
pose's pivot, as the Miniature option draws play and every cinematic shot draws its hold
(`node scripts/look-metrics.mjs --milestone m63-dof --ours-only --dof`). Shots blur whatever the
option says; in play it is off unless the viewer turns it on.

| Reference | distance before | after |
| --------- | --------------- | ----- |
| 1         | 0.176           | 0.178 |
| 2         | 0.297           | 0.303 |
| 3         | 0.144           | 0.145 |
| 4         | 0.138           | 0.119 |
| 6         | 0.238           | 0.237 |
| 7         | 0.112           | 0.113 |
| 8         | 0.210           | 0.217 |

The metrics barely see blur (they measure colour, light and contrast over the whole frame): ref
4's long dungeon moves toward its reference, whose far end is soft, and the rest hold within
noise. In the strip the foreground minis of ref 7 and the far rim of the overviews soften while
the pivot stays sharp, and the labels and markers, drawn over the finished image, stay sharp
(#157). How much blur reads as a miniature, not a smear, is the owner's call in review:
`FOCAL_SHARE` and the per-tier bokeh in `focus.ts` are the knobs.

## Milestone 63: the grid at rest, night and dusk (#167)

`docs/look/m63-night/` against `m63-grade` (both without depth of field, as the metrics draw):
the grid lines are gone at rest (the tiles' seams are the grid; they show while the GM builds,
while placing and while aiming a move, or always with the Graphics menu's Always show grid), and
each ambient band has its own hemisphere and darkness hue in `PRESETS` (`lighting.ts`): day keeps
its warm pair, dusk a peach sky over a slate-blue ground, night a moon-blue sky over a deep blue
ground with a navy darkness and background.

| Reference | band | distance before | after |
| --------- | ---- | --------------- | ----- |
| 1         | dark | 0.176           | 0.161 |
| 2         | dusk | 0.297           | 0.307 |
| 3         | dark | 0.144           | 0.123 |
| 4         | dark | 0.138           | 0.121 |
| 6         | dark | 0.238           | 0.221 |
| 7         | day  | 0.112           | 0.112 |
| 8         | dusk | 0.210           | 0.207 |

Every night pairing moves toward its reference: the dark around the pools of light is blue, as in
refs 1, 4 and 6, not brown. Dusk is mixed: ref 8's town block moves a little closer, ref 2's
monastery a little away (its reference dusk is warmer and brighter than ours, which the sky of
#114 supplies). The darkness overlay's alpha still comes from `lightLevels` and the fog still
draws over it, so unexplored cells stay black and dark cells as dark as the rules say: only their
hue changed. These colours are interim: #208 blends them by the hour and #218 and the art bible
(#183) own the final palette.

## Milestone 63 closed (#168)

`docs/look/m63/`: the whole M63 chain as the metrics draw it (the medium tier, GM view without
fog, reduced motion, so no grain and no depth of field), against the close of M62.

| Reference | band | m62   | m63   |
| --------- | ---- | ----- | ----- |
| 1         | dark | 0.169 | 0.161 |
| 2         | dusk | 0.284 | 0.307 |
| 3         | dark | 0.137 | 0.123 |
| 4         | dark | 0.160 | 0.121 |
| 6         | dark | 0.245 | 0.221 |
| 7         | day  | 0.115 | 0.112 |
| 8         | dusk | 0.193 | 0.207 |
| mean      |      | 0.186 | 0.179 |

Of the paired fixtures named for this milestone (refs 1, 3, 6, 7 and 8) four move toward their
references: the nights most (blue darks and warm pools, the grade, AO under things), day a
little. Ref 8 moves away, as ref 2 does: both are dusk, and both references' dusk is warmer and
brighter than ours, lit by a sky we do not have; the grade and the dusk hemisphere shape a light
that #114's sky and #208's hours supply. The per-effect strips above record each step.

Still missing, for the milestones that own them: the material system (M64, #111) and the surface
library and art bible (M65, #112), the sky and atmosphere (M67, #114, #218), lighting by the hour
(#208), shadowed torches near the camera (#230), baked vertex AO (#190), and fog and darkness
inside every material instead of planes on the floor (#171). The owner's sign-off of the look (G2) is pending, and so is a decision
on the highlight colours under colour-vision simulation (#157: blocked and place nearly match for
deuteranopes).

## Milestone 64: the material system (#111)

What changed in the look (the strip is `docs/look/m64/`; the metrics are below):

- **Every surface is a shader kind** (#169, #172): the table, walls, raised ground, props and
  minis draw through the kinds with the environment's textures in their slots, so the picture is
  the same family of materials everywhere rather than the classic materials plus overlays.
- **Fog and darkness are in the materials** (#171, #173): no planes on the floor any more. Walls,
  props and minis in an explored room are dimmed, desaturated and cooled as its floor is, and the
  dark shades raised ground's sides and props, not only what lies under a plane; a player's
  unexplored cells stay exactly black, now also after bloom and the lens (the re-mask).
- **The fog is atmosphere** (#174): soft, slightly irregular edges instead of the cell grid's
  steps, and newly seen ground fades in (instant under reduced motion). The fog cloud over hidden
  cells is built but its layer stays off until the owner approves it on ref-1 and the Hollow.
- **Textures sit on the world, not on each piece** (#177): walls, raised ground and the table
  share one box projection, so stone runs on across wall segments and step heights without
  seams; rock is triplanar; props and minis in object space.
- **Painted miniatures** (#178): props and minis have paint noise in their normal and gloss
  (off on the low tier), the TaleSpire recipe the references show.
- **Crisper ground at grazing angles** (#179): anisotropic filtering by tier and a mip bias with
  TRAA on high and ultra.
- **Less repetition and no flicker** (#181): gentle macro variation of tint and roughness on the
  tiled kinds, two-fetch anti-tiling on medium and up, and a stable per-instance lift that ends
  z-fighting between coplanar props, decals and water.

Against M63's close (the same pairings and conditions; reduced motion, the GM without fog):

| Reference | band | m63   | m64   |
| --------- | ---- | ----- | ----- |
| 1         | dark | 0.161 | 0.193 |
| 2         | dusk | 0.307 | 0.324 |
| 3         | dark | 0.123 | 0.127 |
| 4         | dark | 0.121 | 0.097 |
| 6         | dark | 0.221 | 0.205 |
| 7         | day  | 0.112 | 0.113 |
| 8         | dusk | 0.207 | 0.219 |

The first run of this strip scored every night further away (ref 1 0.227, ref 4 0.172): moving
darkness from the overlay into the materials had dropped the band's dark tint (#167), so the dark
went to neutral black and the shadow hue was lost. `worldModify` now takes each band's tint for
the darkened part of a surface (`DARK_TINT` in `cell-maps.ts`), as the overlay did. With it the
long dungeon (4) and the night palisade (6) move toward their references: G2's shadow distance on
ref 6 drops. The torch room (ref 1) moves away: its explored walls and props now darken with the
floor, so the room reads darker than the reference, whose walls catch more bounce light than we
have, and its shadows come out a little bluer (hue 269 against the reference's 291). The two dusk
pairings move a little away, as in M63, for want of a sky. Whether explored rooms read well
darker is the owner's call (G2).

The M63 note's "fog and darkness inside every material instead of planes on the floor (#171)" is
done; the surface library and art bible (M65, #112), the sky (M67, #114, #218) and lighting by
the hour (#208) are still missing.

## Milestone 65: the asset pipeline and surface library (#112)

What changed in the look:

- **Bevels and baked AO on part-list models** (#190): chamfered edges catch light, and creases
  between parts darken in the indirect light.
- **The surface library on floors and walls** (#187): twenty-three stylised CC0 sets (ambientCG,
  Poly Haven) replace the recipe textures on painted floors and on walls. The living cave has
  cave-rock walls. The cavern keeps ashlar for its download budget.
- **Recipe textures at a 512 base** (texture detail): 1K and 2K come from the asset store when the
  Graphics option asks for them. The metrics and goldens draw the 512 bases.
- **The great bell** (#196): an in-house textured pilot until the commissioned bell arrives.

Against M64 (the same pairings and conditions):

| Reference | band | m64   | m65   |
| --------- | ---- | ----- | ----- |
| 1         | dark | 0.193 | 0.166 |
| 2         | dusk | 0.324 | 0.308 |
| 3         | dark | 0.127 | 0.135 |
| 4         | dark | 0.097 | 0.097 |
| 6         | dark | 0.205 | 0.193 |
| 7         | day  | 0.113 | 0.125 |
| 8         | dusk | 0.219 | 0.215 |

Five of seven move toward their references or hold. The torch room (1) gains most, from bevels
and the crease AO on its crates and table, and the stone walls. Two move away:

- ref 3 (a close, dark shot) and ref 7 (a close day shot) are dominated by painted ground;
- the stylised photo-sourced sets still carry more fine detail than the references' hand-painted
  ground, and grass and plaster were flagged in review as reading photographic.

Tuning the stylise step per surface (detail and ramp in each set's `meta.json`) is the lever, and
the owner's surface review (G2) decides it.

## Milestone 66: the world look as data (#113)

What changed in the look:

- **The world look** (#198-#200, #205, #206): the hour, sun, sky, grade, weather, haze, exposure and
  backdrop are authoritative data (`WorldLook`), set by the GM and by the adventures per location.
- **The presets blend by the hour** (#208): between the canonical hours the day, dusk and night
  lighting mix, until the sky (#114) lands. At each band's canonical hour the blend is exactly the
  old preset.
- **Light, token and prop looks** (#201, #202): lights have kinds, intensity, flicker and fixtures
  (a glow draws no fixture), tokens scale, lift and carry coloured light, and props take a tint.
- **Roofs** (#203) over the GM's painted interiors, shown to players only over explored ground.

Against M65 (the same pairings and conditions):

| Reference | band | m65   | m66   |
| --------- | ---- | ----- | ----- |
| 1         | dark | 0.166 | 0.166 |
| 2         | dusk | 0.308 | 0.308 |
| 3         | dark | 0.135 | 0.135 |
| 4         | dark | 0.097 | 0.097 |
| 6         | dark | 0.193 | 0.192 |
| 7         | day  | 0.125 | 0.125 |
| 8         | dusk | 0.215 | 0.215 |

No pairing moves by more than 0.001. The pairings draw each fixture at its band, and the fixture
views now carry that band's canonical hour, where the blend reproduces the old preset. None of the
reference fixtures has roofs, tinted props or recoloured tokens. What moves (hues by a fraction of
a degree, L by a thousandth) is the refrozen fixtures' light looks. M66 gives the look its data;
the look itself moves with the sky (#114) and the weather that fill that data in.

## Milestone 67: the sky (#114)

What changed in the look:

- **A sky dome** (#214) on medium and above: zenith, horizon and ground gradients, the sun's disc,
  the moon and stars, clouds by the weather. The low tier keeps a flat horizon colour.
- **Light from the sky** (#215, #218): the sun or moon is the key light at the hour's angle
  (shadows redrawn per half degree), the hemisphere follows the sky, and the lamp is gone. The
  sky's reach per cell (#219) keeps sun, sky and IBL out of dark areas and dims them under roofs.
- **Image-based light from the sky** (#216): the dome captured into a cube every 2-5 s and
  filtered by PMREM lights every material's indirect term.
- **Sky-matched fog** (#217): range and height fog in the horizon's colour, warmed toward the sun.
- **Ground to the horizon** (#220): the table's slab and rim are gone; a ring of the environment's
  ground runs from the play area out to the haze.
- **Enclosed skies** (#221) for the Hollow, the Heart and the train, and the flash lighting the
  exposure, bloom and sky (#222, #223).

Against M66 (the same pairings and conditions, the 512 bases):

| Reference | band | m66   | m67   |
| --------- | ---- | ----- | ----- |
| 1         | dark | 0.166 | 0.167 |
| 2         | dusk | 0.308 | 0.259 |
| 3         | dark | 0.135 | 0.144 |
| 4         | dark | 0.097 | 0.087 |
| 6         | dark | 0.192 | 0.193 |
| 7         | day  | 0.125 | 0.109 |
| 8         | dusk | 0.215 | 0.237 |

Three pairings move toward their references, two hold and two move away:

- ref 2 (the monastery's dusk overview) gains most, 0.049: the warm haze and sky-lit ground around
  the table replace the dark void, closer to the reference's warm, low-contrast frame. ref 4 (a
  dark overview) and ref 7 (a close day shot) gain from the sky's key and indirect light.
- ref 8 (a dusk overview) moves away by 0.022: where M66 drew a dark blue void round a wooden
  slab, the ground now runs to a brown haze, so the overview is hazier and flatter than the
  reference. The owner accepted the hazier overview for now; #377 (M68) tunes the haze and the
  overview's contrast.
- ref 3 (a close, dark shot) moves away by 0.009: at night the moon's key and the sky's indirect
  light replace the lamp's warm fill.
- refs 1 and 6 (close, dark rooms) hold within 0.001: their frames are the rooms, not the sky.

## Sky targets (#213)

The skies' colours (`assets/skies/`, docs/ASSETS.md) and where each comes from. The references'
colours are their zenith and horizon measures (`docs/look-metrics.json`) as sRGB; "ours" has no
reference yet. Their lights (sun, hemisphere, flames) at 12:00, 19:30 and 23:00 are the old day,
dusk and dark presets (`lighting.ts` before #218), and each band's fog colour the old background.
Tuning goes on in #221, #225 and #338.

| Sky          | Hour  | Colour  | Value     | From                                                   |
| ------------ | ----- | ------- | --------- | ------------------------------------------------------ |
| temperate    | night | zenith  | `#070717` | ref 6 (moonlit palisade gate), zenith                  |
| temperate    | night | horizon | `#1e223f` | ref 6, horizon                                         |
| temperate    | dusk  | horizon | `#866c54` | ref 2 (monastery at dusk), horizon                     |
| temperate    | dusk  | zenith  | `#2d3350` | ours: cool over the warm horizon                       |
| temperate    | dawn  | horizon | `#c89a70` | ours: ref 2's hue, lighter                             |
| temperate    | day   | horizon | `#c8b98f` | ref 7 (daylight), horizon hue at a day sky's lightness |
| temperate    | day   | zenith  | `#4a78b0` | ours                                                   |
| desert-night | night | zenith  | `#020208` | ref 1 (torch-lit camp under a night sky), zenith       |
| desert-night | night | horizon | `#262750` | ref 1, horizon                                         |
| desert-night | day   | horizon | `#d9c29a` | ref 7's warm haze, sandier                             |
| desert-night | dusk  | horizon | `#c0703e` | ours                                                   |
| overcast     | day   | horizon | `#a8acb0` | ours                                                   |
| blood-moon   | night | horizon | `#3a0d12` | ref 3's crimson push                                   |
| abyss        | all   | horizon | `#080103` | ref 3 (crushed blacks), a crimson black (#221)         |
| abyss        | dark  | fill    | `#6e1614` | ref 3's crimson push, low                              |
| underground  | all   | horizon | `#060914` | ref 4 (deep navy low key), near-black navy (#221)      |
| underground  | dark  | fill    | `#34426e` | ref 4, desaturated navy: silhouettes legible           |
| lamplit      | dusk  | fill    | `#ffc890` | ours: the train's lamplit wood (#221)                  |

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
