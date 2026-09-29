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

## 5. Stylised PBR rules

- **Roughness** mostly 0.5-0.9. Below 0.4 only for wet, glazed, polished or oily things.
- **Metalness** 1 only on bare metal, 0 everywhere else, never in between except on worn edges.
- **Emissive** only for flames, embers, runes, glowing windows and lava.
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
minis (white where the player's colour goes, replacing today's `accent` mesh; _target_).

Surfaces cook to one KTX2 file per surface and map, assembled into arrays on the client. The
issue's two-map packing (albedo + height; normal.xy, roughness, AO) is the alternative; the owner
chooses (#187).

## 7. Minis

- Static poses, no animation. No base: the engine draws it.
- Origin at the centre of the base's top face, facing +Z.
- Stay inside the base's circle, except weapons and cloaks by at most 0.1 u.
- LOD0 3,000-6,000 triangles for a 1-cell mini; the figure class allows more for hero figures.
- Painted like a miniature: strong value separation between skin, cloth and metal, highlights on
  every upward edge, and an owner-tint zone (a sash, a cloak, a shield face) at least 10% of the
  visible surface.

## 8. Kits

_Targets_ that #250 enforces:

- 1 u per cell edge; walls 2.0 u tall; pivot at the midpoint of the cell edge, on the lower floor.
- Snapping at 0.5 u.
- One 2048 trim sheet per kit, and 3-4 variants per piece so a long wall doesn't repeat.
- **Thickness.** At most 0.07 u each side of the edge beside a walkable cell, so a 0.86 u base
  still fits the cell; up to 0.35 u on a side facing solid, void or off-grid cells.
- **Chunkiness** from detail, not thickness: 0.03 u overhangs on caps, 0.3 u corner posts,
  plinths and relief.

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
- **Textures.** 1024² albedo, normal and ORM, plus an emissive mask for a faint rim glow on the
  lip; 2048² albedo only if review asks for it.
- **Deliver** as `art/prop/great-bell/`: `great-bell.glb` (textures embedded as 8-bit PNG),
  `meta.json` (provenance, the swing's pivot height and throw), the `.blend`, the painter files
  and the high-poly.
- **Review** on the turntable under the four lights, then in its table at the close and
  overview camera, by the reviewer. Two rounds of changes are included.

Until it is commissioned, the pilot is made in house (`LicenseRef-thirdfold-original`) by
`scripts/make-bell-art.ts`: the same meshes, pivot, maps and export shape, procedural rather than
sculpted, with a 512² ORM (its occlusion, roughness and metal change slowly) to spare the download.

### Brief B: a stone-halls wall (the first kit piece, #263)

A straight monastery wall of dressed stone, one cell edge long, the first piece of a kit.

- **Look.** Ashlar blocks of uneven size with chipped corners, a per-block hue shift and recessed
  mortar, a plinth course at the bottom and a projecting cap at the top. Grey-ochre stone, cool in
  the joints, warm on the top edges, per the `ashlar` ramp. Moss only in the lowest joints.
- **Scale.** 1.0 u long, 2.0 u tall above the floor. Thickness 0.07 u each side of the cell edge
  (the plinth and cap may overhang by 0.03 u); corner posts 0.3 u square come later in the kit.
  Pivot at the midpoint of the cell edge on the floor, facing +Z.
- **Pieces.** Three variants of the straight wall, each its own asset: `stone-wall` (plain),
  `stone-wall-cracked` (a cracked block) and `stone-wall-niche` (a small niche), sharing one trim
  sheet.
- **Budget.** Kit: LOD0 500-1,500 triangles each; LOD1 at about 50%.
- **Textures.** One 2048² trim sheet (albedo, normal, ORM) shared by the whole kit, 512 px per
  cell. It ships once, as standalone textures referenced by one manifest material (`map`,
  `normal`, `orm`) that each variant lists in `ModelEntry.materials`; the GLBs embed no textures.
- **Deliver** as `art/kit/<id>/` for each variant: `<id>.glb` with meshes `body` and `body_lod1`
  only, and its `meta.json`; plus the trim sheet's PNGs and `meta.json` in
  `art/kit/stone-halls-trim/`, the `.blend` and the trim sheet's painter file.
- **Review** as brief A, plus a run of eight walls in a row to check the variants don't repeat.

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
