# Rendering

How thirdfold draws its world, the decisions behind it, and the rules every renderer change keeps.
The rendering roadmap is tracked in [#107](https://github.com/tougenrip/thirdfold/issues/107),
milestones 61–78.

## Decision: WebGPURenderer with TSL, WebGL2 through its fallback

**Status:** accepted in milestone 61; confirmed by the go/no-go spike (#142, below) on 26 September
2026, with one condition on first-frame compile.

**Decision.** The renderer moves from `THREE.WebGLRenderer` to `three/webgpu`'s `WebGPURenderer`
with TSL node materials and one `RenderPipeline` for post-processing. WebGL2 comes through
`WebGPURenderer`'s built-in fallback backend. That backend is tier 1, not a degraded mode.
`forceWebGL` is the kill switch (`?backend=webgl`), both per viewer and per platform. **There is no
parallel `WebGLRenderer` path.** It would mean two material systems, two post stacks and two golden
sets. Must-have effects use fragment passes only. Compute-only features are optional WebGPU extras.

### Context

In r186 most new rendering work exists only on the node renderer:

- the post stack: `RenderPipeline`, GTAO injected as ambient-only AO through `builtinAOContext`,
  bloom from MRT, `TRAANode`, `Lut3DNode`, depth of field
- `DynamicLighting`: changing light counts without shader recompiles
- `SkyMesh`, `CSMShadowNode`, `WaterMesh` and `ClusteredLighting`

`LightProbeGrid` and `SunLight` ship for both renderers. Building effects twice would waste the
roadmap. Choosing the node renderer without a fallback would lose the roughly one player in five who
has no WebGPU.

Today `src/lib/tabletop/renderer.ts` creates `new THREE.WebGLRenderer({ canvas, antialias: true })`.
No tabletop file uses `ShaderMaterial`, `RawShaderMaterial` or `onBeforeCompile`. The layers use
standard, basic, sprite, line-basic and points materials, all of which r186's `StandardNodeLibrary`
maps to node materials, so the port is mostly mechanical.

### Cost

Measured with esbuild on the installed r186, gzipped. #142 re-measures these in the real build:

| Surface                                                                  | gz      |
| ------------------------------------------------------------------------ | ------- |
| Today's `WebGLRenderer` surface                                          | ~160 kB |
| The same on `WebGPURenderer`                                             | ~270 kB |
| Plus `RenderPipeline`                                                    | ~301 kB |
| Plus GTAO, bloom, TRAA, `SkyMesh`, `SunLight`, clustered lighting        | ~313 kB |
| Fuller stack: plus SMAA, `Lut3DNode`, `CSMShadowNode`, `DynamicLighting` | ~349 kB |

All of it stays lazy, in the renderer chunk. The bundle gate
([#127](https://github.com/tougenrip/thirdfold/issues/127)) holds what the renderer adds at 360 kB gz
or less, and keeps three.js out of every route's static imports.

### Alternatives rejected

- **Babylon.js 9.** The strongest built-ins (clustered lights, SSR, volumetrics, a node material
  editor), but a rewrite of every tabletop module and test, while the server's asset baking stays on
  three.js. The whole package is about 1.78 MB gz.
  ([announcement](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/),
  [size](https://bundlephobia.com/package/@babylonjs/core))
- **PlayCanvas.** Clustered, shadowed lights on WebGL2, but editor-centric and also a rewrite; about
  615 kB gz. ([size](https://bundlephobia.com/package/playcanvas))
- **Needle Engine.** three.js with baked lightmaps, which do not fit tables that GMs build at
  runtime. ([features](https://engine.needle.tools/docs/explanation/core-concepts/features-overview))
- **Staying on `WebGLRenderer`** with pmndrs `postprocessing`. It works today, but every r186
  addition above is node-only, so each effect would be built outside three.js and redone later.

### Platforms

Rows marked † must be confirmed on devices by #142 and the G4 device matrix.

| Backend         | Where                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WebGPU          | Chrome and Edge on Windows, macOS, ChromeOS; Chrome Android on Android 12+; Safari 26; Firefox on Windows and Apple-silicon macOS; WebView2 (Tauri on Windows x64); Android System WebView† (follows Chrome Android) |
| WebGL2 fallback | WebKitGTK† (Tauri on Linux, possibly software-rendered with no error); WKWebView† before macOS/iOS 26; Firefox on Linux and Android; Chrome on Linux, except Intel Gen12+ and NVIDIA on Wayland                      |

WebGL2 reaches about 97% of visitors, WebGPU about 82% (about 17% on Linux).
Sources: [implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status),
[WebGPU in webviews](https://caniwebview.com/features/web-feature-webgpu/),
[web3dsurvey](https://web3dsurvey.com/).

**Backend-dependent features.** Only the WebGPU backend gets clustered lighting, VXGI, OIT with MSAA,
and storage-texture or indirect-draw effects; `BundleGroup` brings no gain on WebGL2. SSGI, water SSR
and TAAU are ultra-tier by choice, not by API. Compatibility-mode WebGPU turns MSAA off and caps
textures at 4096 px.

### The port (milestone 62, #144)

Every tabletop module imports `three/webgpu`; the addons (`OrbitControls`, `GLTFLoader`) keep
`three`, whose classes are the same objects. `createTabletop` is async: `createNodeRenderer`
(`loop.ts`) builds `WebGPURenderer` (WebGPU where the browser has it, else its WebGL2 backend),
awaits `init()`, and stops r186's internal per-vsync loop; each frame the tabletop draws resets
`renderer.info` and advances the node frame itself. `?backend=webgl`, or `compatibility: true` in
`thirdfold:graphics`, forces WebGL2 (a reload switches). Tests that read pixels back force WebGL2 too
and hand the renderer a context made with `preserveDrawingBuffer`. The sun's shadow is cached on the
light (`sun.shadow.autoUpdate = false`, `needsUpdate` when the table changed, #143). The bundle gate
fails if the classic `WebGLRenderer` is bundled again; the renderer adds 257 kB gz.

The port moved 37 of the 113 goldens past tolerance, all in the same two ways: the background
clears to black instead of the dark brown (the node renderer tone-maps the clear colour, and ACES
crushes that brown), and the line grid draws brighter. #153 retunes them and #157 takes overlays out
of tone mapping; the sky (#114) replaces the background altogether.

### World scale (#152) and the retune for the node renderer (#153)

The world's scale is 1 cell = 1 unit = 5 ft: a level is 0.4 u (2 ft, `STEP_HEIGHT`), a wall 2.0 u
(10 ft), the sight rule's eye 1.2 u (6 ft). The rules count in levels, so only the picture moved.
Placeholder figures are drawn at 1.3× (`FIGURE_SCALE`) so they stand at human height under the walls
until #118 authors real heights; lamp fixtures stand 1.5 u tall; dice are thrown from above the
walls standing on the floor under the camera's target, and land on that floor (raised ground too).
`server/adventures/camera-clearance.spec.ts` checks that no cinematic shot of either adventure, and
no change between the tactical and tabletop views, puts the camera inside a wall or under the
ground, on any of their tables.

The node renderer tone-maps the whole frame at the end (`needsFrameBufferTarget`), background and
overlays included, and blends before it, in linear light; the classic renderer tone-mapped each lit
material and blended the unlit overlays after, in sRGB. The retune undoes that difference with
numbers rather than by eye:

- **Colours that must come out exact** are the ones ACES turns into the old sRGB: the backgrounds
  (day `292421`, dusk `252022`, dark `18171c` for the old `16120f`, `120e10`, `07060a`), the fog's
  hidden shade (`1d1b19` for `0b0908`: unexplored cells are still the same near-black) and the
  darkness colour (`13111a` for `040308`), found by inverting three's ACES curve per channel.
- **Alphas** that match the old ones over floors of middling brightness: the fog's explored dim 150
  → 173 and the GM's tints 110 → 128 and 55 → 69 (a black overlay blended in linear light lets more
  of a lit floor through), grid lines 0.35 → 0.17 and mist 0.2/0.14 → 0.11/0.1 (a light colour
  blended in linear light lifts a dark floor), and label plates 0.78 → 0.9. #157 takes grid lines
  and labels out of tone mapping, where the old values are right again.
- **Roughness** of the table surface and floors 0.95 → 1: r181's energy-conserving specular made
  them read brighter.
- **Unchanged:** light intensities, `PRESETS` strengths and the sun's shadow bias. With the retune the
  metrics already match, and the close poses show no acne and no minis or posts detached from their
  shadows at `bias -0.0005`, so no `normalBias` was added. Raised lamps keep their intensity: the
  floor a cell or two away gets about the same light (it lands less slanted), only the spot right
  under a lamp is dimmer, and compensating by the height's square blew out the walls beside it.

Measured on the WebGL2 backend at the old scale against the baseline v0 goldens (pixelmatch 0.1,
0.5%): the port alone failed 37 of 113; after the retune 109 of 113 pass, and the look-metric
distance to v0 averages 0.009 (from 0.054). The four left are one image, `ref-1`'s close shot, where
the sconce's flame (emissive 2, well above 1 before tone mapping) glows through the label in front of
it, 1.1% of pixels; #157 fixes it. The goldens were then re-baselined once at the new scale, and
`docs/look/m62/` is the strip.

### Shader warm-up (#149)

The node renderer compiles 60–75 pipelines for a table where the classic renderer compiled a dozen,
and compiling them on the first visible frame stalled it for 300–680 ms. When a table, an
environment's look or a model is new, the next frame is spent on a warm-up instead (`warmup.ts`):
the frame loop is held (the canvas keeps its last frame) while each layer is compiled with
`compileAsync`, one at a time, from one reused camera over the whole table; then the frame is drawn,
with the sun's shadow. A warm-up never holds longer than 1.5 s; what it didn't reach compiles on
draw.

Since #180 it also compiles what shows only later, from stand-ins each layer gives (`gallery`: the
selection ring and turn marker in the overlay's pass, a die, the toll's dust and shadow, the fog
cloud), never the real objects, and the first frame after it draws the stand-ins once, a millionth of their size far
below the table (`Gallery` in `warmup.ts`): a compile can't make a die's shadow-pass material, nor
a material in the AO's context, which only the scene pass itself sets, and r186 declares a shadowed
material's uniforms in another order compiled than drawn. A tier switch that keeps the pipeline
(no AO: low, or medium with Advanced options off; a new AO kind is a new renderer) swaps the
table's, walls' and raised ground's materials for their twins in the other anti-tiling variant
(`twinOf`, kept both ways): the first switch compiles their vertex stages (every InstancedMesh has
its own) in the hold it starts, and switching back and again compiles nothing.

**The lobby's warm-up** (`lobby.ts`): the landing page, the join form and the library make the
table's renderer when idle (`prefetchRenderer` → `warmRenderer` in `load.ts`), on a canvas of its
own, for the tier the table will start on (`startingSettings`, `shape.ts`), and compile a gallery
of every shader kind in every variant the layers make, instanced or not, casting shadows or not
(`materials/warmup.ts`, built from `SHADER_KINDS`, so a new kind joins by itself), plus the layers'
stand-ins, through the same pipeline (MSAA, the half-float target and its outputs), one item at a
time, then draw it twice on that unseen canvas. The first table adopts the renderer and its canvas
(`TabletopOptions.warm`, `takeWarmRenderer` in `Tabletop.svelte`, which waits for a warm-up under
way) and finds the pipeline's passes, the overlay's marks and what is unlit or unshadowed made (its
lit kinds it still builds: see the lobby's test below), unless its pipeline's shape differs or
`?perf` asks for GPU timestamps; its warm-up time is
the `lobby` timing in the tabletop's stats. Only public data goes in (the kinds' blanks and
defaults; the paint maps load with the first painted graph): no model, environment or adventure,
so nothing fetched there tells where a story goes (#111 G3; `lobby.svelte.spec.ts` checks the
requests). Software rasterisers skip it (the table's own warm-up still runs).

Measured on the RTX 4060 (Chromium 153), loading the village, monastery and Hollow into a running
table: the worst visible frame afterwards is 5–46 ms on the WebGL2 backend and 6–28 ms on WebGPU
(the classic renderer's first frame was 26–57 ms), after a held warm-up of 0.5–0.9 s. That meets the
go/no-go's condition.

### What the port breaks (r186)

The port is [#144](https://github.com/tougenrip/thirdfold/issues/144).

| Change                                                                                                                                                                                                  | Affects                                                      | Handled in                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| `render()` throws before `await renderer.init()`, so `createTabletop` becomes async                                                                                                                     | `renderer.ts`, `Tabletop.svelte`, `load.ts`                  | [#144](https://github.com/tougenrip/thirdfold/issues/144) |
| `Renderer.shadowMap` is only `{ enabled, transmitted, type }`; shadow caching moves to per-light `shadow.autoUpdate` / `needsUpdate`                                                                    | `renderer.ts` (`shadowsDirty`)                               | [#143](https://github.com/tougenrip/thirdfold/issues/143) |
| `material.clippingPlanes` and `localClippingEnabled` are ignored (clip through `ClippingGroup`); WebGPU points are 1 px                                                                                 | `effects.ts` (dust)                                          | [#145](https://github.com/tougenrip/thirdfold/issues/145) |
| In `Info`, `render.calls` counts render calls since start; draws are `render.drawCalls` and programs `memory.programs`; `gl.readPixels` timing gives way to `trackTimestamp` / `resolveTimestampsAsync` | `perf.ts`, `renderer.ts` (`benchmark`), `scripts/perf-*.mjs` | [#146](https://github.com/tougenrip/thirdfold/issues/146) |
| `PCFSoftShadowMap` warns and falls back to `PCFShadowMap` (PCF is soft since r182); `PostProcessing` is now `RenderPipeline` (r183); `TRAAPassNode` is now `TRAANode` (r179)                            | `renderer.ts`                                                | [#144](https://github.com/tougenrip/thirdfold/issues/144) |

### Known risks

- three.js [#34632](https://github.com/mrdoob/three.js/issues/34632): `compileAsync` on many textured
  materials while frames are being drawn fails with "Binding doesn't exist". Precompile in small
  batches while frames are held.
- three.js [#30560](https://github.com/mrdoob/three.js/issues/30560): per-object uniform buffer cost on
  WebGPU. Keep instancing and batching.

### Go/no-go spike (#142), 26 September 2026

A throwaway branch ported only the renderer's construction to `three/webgpu` (imports, async
`init()`, `forceWebGL`, minimal stats; no visual fixes) and switched between three renderers by URL:
A, `WebGPURenderer` on WebGPU; B, `WebGPURenderer` on its WebGL2 backend; C, today's `WebGLRenderer`.
Measured with `scripts/perf-gpu.mjs` on the frozen village, monastery and Hollow fixtures, GM and a
fogged player, three poses, 1920×1080, Chromium 153 (Playwright 1.63), Linux, ANGLE Vulkan. GPU ms
are the median of 16 frames by timer queries (B, C) or WebGPU timestamp queries (A); each cell is the
median over the three poses.

| GPU                         | Table     | Viewer | C: WebGLRenderer | B: WebGL2 backend | A: WebGPU backend |
| --------------------------- | --------- | ------ | ---------------- | ----------------- | ----------------- |
| Intel Raptor Lake UHD (low) | village   | GM     | 12.90            | 12.67 (98%)       | 10.92 (85%)       |
|                             | village   | player | 11.16            | 10.14 (91%)       | 8.31 (74%)        |
|                             | monastery | GM     | 18.26            | 13.83 (76%)       | 11.40 (62%)       |
|                             | monastery | player | 16.87            | 11.87 (70%)       | 10.13 (60%)       |
|                             | hollow    | GM     | 33.85            | 25.98 (77%)       | 24.28 (72%)       |
|                             | hollow    | player | 33.93            | 27.79 (82%)       | 24.24 (71%)       |
| RTX 4060 Laptop (medium)    | village   | GM     | 2.39             | 0.79 (33%)        | 1.01 (42%)        |
|                             | village   | player | 1.27             | 0.66 (52%)        | 0.85 (67%)        |
|                             | monastery | GM     | 1.00             | 0.93 (93%)        | 1.08 (108%)       |
|                             | monastery | player | 0.94             | 0.82 (87%)        | 0.83 (88%)        |
|                             | hollow    | GM     | 1.75             | 2.06 (118%)       | 1.51 (86%)        |
|                             | hollow    | player | 2.04             | 1.57 (77%)        | 1.42 (70%)        |

| Setup (RTX 4060)  | First frame of a loaded table | Shader programs | `init()`  |
| ----------------- | ----------------------------- | --------------- | --------- |
| C: WebGLRenderer  | 26–57 ms                      | 12–16           | –         |
| B: WebGL2 backend | 302–380 ms                    | 58–70           | 16–32 ms  |
| A: WebGPU backend | 545–678 ms                    | 60–72           | 32–137 ms |

- **Bundle:** the lazy renderer closure with both renderers in it was 342.5 kB gz, inside the 360 kB
  budget; the port removes `WebGLRenderer`'s own code from it.
- **Draw calls** roughly double (median 33 → 74 on the RTX): the node renderer counts the sun's
  shadow pass, which the spike drew every frame. The port restores caching (#143).
- **Browsers:** Chromium on the RTX and on the iGPU gets the WebGPU backend. Chromium with no WebGPU
  adapter (SwiftShader) and Firefox on Linux (no `navigator.gpu`) fell back to the WebGL2 backend on
  their own and drew the table. WebKit (the stand-in for Tauri's WebKitGTK) did not launch here for
  missing system libraries.
- **Visual deltas seen, for #153:** the line grid is much brighter and whiter; `scene.background`
  shows as pure black instead of the dark brown; floors read slightly lighter and cooler. Objects,
  lights, minis and labels are all there.
- **The internal animation loop:** r186 `Renderer.init()` starts an `Animation` loop that requests a
  frame on every vsync forever (it resets `info` and advances `nodeFrame`), which breaks render on
  demand. The scheduler (#148) stops it right after `init()` (`renderer._animation.stop()`), sets
  `info.autoReset = false`, and on each frame it draws resets `info` and calls
  `nodeFrame.update()` itself, so time-based nodes and `ShadowNode`'s once-per-frame guard still work.
  The spike ran this way.
- **Node:** `three/webgpu` loads under Node, and `Mesh`, `Texture` and `MeshStandardMaterial` are the
  same objects as in `three`, so the asset pipeline and the server-project tests are unaffected.

**Decision: go.** The WebGL2 backend is not 20% slower than `WebGLRenderer` on any table on the iGPU:
it is 2–30% faster, and the WebGPU backend 15–40% faster. One condition: first-frame compile is 6–12×
today's (the rule allows 1.5×), so the port does not merge until #149's precompile brings the first
frame of a loaded table under 1.5× of today's (about 85 ms). If it can't, the owner decides again.

**Shells, 27 September 2026** (the ported renderer, the test world, on the Dell G15: RTX 4060 Laptop
on NVIDIA 595.91 and an Intel UHD iGPU on Mesa, Ubuntu with GNOME 50 on Wayland). A probe page opened
the app in the shell, created a room, imported the test world and read `thirdfoldPerf`:

| Shell                                       | `navigator.gpu` | Secure | Backend | Draws                           | GPU ms (sync)   |
| ------------------------------------------- | --------------- | ------ | ------- | ------------------------------- | --------------- |
| Chromium 153, RTX 4060 (reference)          | yes, adapter    | yes    | WebGPU  | yes                             | 1.8 (timestamp) |
| Tauri on Linux, WebKitGTK 2.52, Intel/Mesa  | no              | yes    | WebGL2  | yes                             | 12.5            |
| Tauri on Linux, WebKitGTK 2.52, NVIDIA 595  | no              | yes    | –       | **no: the web process crashes** | –               |
| Capacitor, Android 13 emulator, WebView 109 | no              | yes    | WebGL2  | yes                             | 7.6             |
| Capacitor, Android 16 emulator, WebView 134 | yes, no adapter | yes    | WebGL2  | yes                             | 12.2            |

- **WebKitGTK on the NVIDIA driver** segfaults in `libnvidia-eglcore.so` (called from WebKit's own
  compositing, not from JavaScript) as soon as a room page's table starts; the landing page and a
  bare WebGPURenderer cube draw. `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `GDK_BACKEND=x11`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` and `__NV_DISABLE_EXPLICIT_SYNC=1` don't help. It is not the
  port: main, still on `WebGLRenderer`, crashes the same way. On a hybrid laptop Tauri draws on the
  iGPU with `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json` (with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` WebKit ignores that and crashes on NVIDIA again). Setting the Mesa vendor in the Linux desktop build when an Intel or AMD GPU is present
  is a follow-up; a WebKitGTK or driver update should be checked again.
- WebKitGTK names every GPU "Apple GPU" (and "WebKit WebGL" as the renderer), so the shell, not the
  adapter, sets Tauri on Linux's starting tier (`tauri-linux`: medium).
- `http://localhost` is a secure context in both Capacitor WebViews. Android 16's WebView has
  `navigator.gpu`, but the emulator gives it no adapter, and the renderer fell back to WebGL2 by
  itself. A phone's own GPU (Vulkan) is what decides WebGPU there.
- The emulators draw through the host's RTX 4060 (gfxstream), so their GPU times say nothing about a
  phone.

**Not yet verified, on the owner's machines to come:** WebView2 (Tauri on Windows), WKWebView (Tauri
on macOS 15 and 26, iOS 26), an M-series Mac, and a real Android phone.

**Owner sign-off:** approved by the owner on #142, 26 September 2026.

## Invariants

Every renderer change keeps these:

- **The server is authoritative.** The renderer draws only what the viewer was sent. Fog secrecy is
  enforced by the server; every layer composes the shared fog-of-war term, and unexplored cells render
  black on every layer for players.
- **The picture never contradicts the rules.** Rendered light agrees with `litMask` and
  `seenByLight` (`src/lib/game/lights.ts`). Levels, cliffs and water look like what the movement
  rules do.
- **Render on demand.** An idle table draws no frames. The only other frames are bounded converge
  frames and capped ambient frames.
- **No recompiles from runtime state.** Time of day, lights coming and going, weather and fog change
  uniforms, never shaders. Only a quality-tier switch rebuilds the pipeline.
- **Instancing and lazy loading.** Repeated geometry is instanced or batched. three.js and assets load
  lazily.
- **Accessibility.** `prefers-reduced-motion` is honoured, read live. A separate Reduce flashing
  setting caps every flash (WCAG 2.3.1). Every colour cue has a shape or pattern twin.
- **WebGL2 always works.**

## Scene-file policy

This roadmap bumps the scene file once: v10, in
[#113](https://github.com/tougenrip/thirdfold/issues/113). It is a single forward-only `migrate` step,
tested from every older version, with a backup of saves, live rooms and the library before each deploy.
The rules track shares the version sequence ([#100](https://github.com/tougenrip/thirdfold/issues/100)).
Published wire values are accepted forever: the `{ambient}` effect, `ambient_set`, Shot frame
`table` and the stored `tabletop` camera view.

v10 (`src/lib/game/scene-versions.ts`) adds `world` (the world look, below), `interior` (roofed cells,
a base64 mask checked to the grid's exact length by `decodeMaskExact`), each player's remembered
lights in `discovery[name].lights` (checked like scene lights by `parseLightList`), and optional looks
on lights (`LightLook`), tokens (`TokenLook`) and props (`PropLook`); absent means the default, so
older content needs no new fields. A v9 file comes forward with `defaultWorldFor(ambient)` (under a
sun, even underground), no roofs and no remembered lights. M66 takes v10; #100 takes v11.

Each bump is forward-only. `migrate` in `src/lib/game/scene-file.ts` refuses a newer version, so once
a v10 server has written saves, autosaves, live rooms or library versions, a v9 server can't read
them: it skips the stored rooms (and leaves them in the store) and refuses those saves. Nothing is
deleted, but games can't go on until the newer build is back or the data is restored. So:

- **Back up before deploying a bump**: `npm run data:backup` (`server/data-backup.ts`), with the
  server's env. It copies `SCENES_DIR`, `ROOMS_DIR` and `LIBRARY_DIR` into
  `backups/<time>/files/` and, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, pages `scenes`,
  `live_rooms`, `library_adventures`, `library_versions` and `library_ratings` into
  `backups/<time>/tables/<table>.ndjson`. `manifest.json` records the counts, the scene-file versions
  seen in saves and rooms, and the app version. Any error exits non-zero. `backups/` is gitignored;
  a backup holds session tokens and GM key hashes, so keep it like the database.
- **Rolling back**: stop the game server, `npm run data:restore -- <backup dir> --yes`
  (`server/data-restore.ts`, which refuses without `--yes` and checks the files against the
  manifest), then deploy the previous build. Files are copied back over same-named ones; rows are
  upserted by primary key, parents first. What was saved after the backup is lost where the backup
  holds the same id; what is new stays, unreadable until the newer build returns.
- **Tried**: `server/data-backup.spec.ts` round-trips the file stores byte for byte and the tables
  through a fake client, and, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, round-trips a live
  Supabase unchanged. By hand on 30 September 2026, against local Supabase: seeded a save, a live
  room and a rated library adventure, backed up, rewrote them as v10 and changed the rating and
  plays, restored, and a second backup's tables were identical to the first.
- The closing PR of a milestone that bumps the version ticks "backup taken before deploy".

## World look

`src/lib/game/world.ts` is the world's look as data (`WorldLook`): the hour (`time`, whole minutes
0-1439), the clock's `rate` (stopped until #324), `sun`, a `sky` and grade `preset` (asset ids, null
for the environment's), `weather` (kind, intensity, seed and the server-stamped `since`), `haze`,
`exposure` and the `backdrop`. Only the hour is a rule, and only with a sun: `bandOf` gives the band
(day 07:00-18:59, dusk 05:00-06:59 and 19:00-20:59, dark otherwise), and the room's `ambient` is
always `ambientFor(world, ambient)`. A sunless table (underground) keeps its band whatever the hour.
`canonicalTime` is each band's hour (12:00, 19:30, 23:00) and `withBand` moves a look into a band,
snapping the hour only when it is outside it. Rules read `room.ambient`, never `world.time`; the rest
is presentation. `world.spec.ts` pins every band edge, so moving a threshold is a deliberate change.

The GM changes it with one message, `world_set { patch }` (`setWorld` in `server/scene-look.ts`, GM
only, `lookLimiter`: a burst of 10, then two a second; a new weather kind without a seed gets one from
the server), and every viewer gets the whole look as `world_update`, the same for everyone (views,
snapshots, saves and live rooms carry it; the raw-frame test allows only `WorldLook`'s keys in it).
With a sun, the band follows the hour; only `ambientFor` decides it. One writer, `lookWorld` in
`server/scene-look.ts`, sets `room.world` and `room.ambient` together, and everything goes through it:
`setWorld`, `setBand` (the engine's `{ ambient }` effect, fixtures; with a sun it snaps the hour into
the band), `setAmbient` (`ambient_set`, kept for older bundles, which now also sends `world_update`)
and `applyScene`. `server/ambient-writer.spec.ts` fails if anything else under `server/` or `scripts/`
assigns `.ambient` or `.world`. A band change posts one notice ("X changed the lighting to
darkness."); moving the hour within a band posts none.

The renderer shows the hour through the atmosphere curve (below): `AtmosphereLayer` in
`tabletop/atmosphere.ts` (#215, #217, #218) resolves the table's sky (`resolveSky(world, environment,
manifest)`, then `presetOf`), evaluates `atmosphereAt` at the look's hour (a sunless table, or one
without a look, at its band's canonical hour; an enclosed sky takes its band's key until #221) and
applies it. What the rules darken (the light levels, the cell maps, the colour grade) stays keyed on
`ambient`, so between 19:30 and 21:00 the scene darkens while the dark itself waits for 21:00.

**Scene-level nodes.** `createScene` sets three module singletons on every scene, the lobby's and
each table's, before anything compiles, so their program keys match and no hour, sky, haze or weather
compiles anything: `skyFogNode` (`fog(colour, min(max(rangeFogFactor, exponentialHeightFogFactor),
cap))`, the colour the curve's haze warmed toward the key light by `pow(max(dot(view, sunDir), 0), 8)`
times the sun's glow, the cap `PLAY_FOG_CAP` over the play area's circle lifting to 1 over
`PLAY_FOG_BLEND` beyond it, the range `fogRange(extent)`; scene fog runs before `worldModify`, so
unexplored cells stay 0), `skyEnvNode` (the PMREM of `SKY_CUBE` in `sky.ts`, the sky capture's
target (#216), times `state.ibl` and `skyAmbient`, the sky's reach per cell (#219)) and the background
colour (the haze's at the horizon, which the dome covers; on low the dome is hidden and it shows).
`bindSkyEnv` gives the environment node a prefilter of each new renderer's, and `registerSkyLights`
maps `SkyLight` and `SkyHemisphere` to their masked nodes, both from `setUpRenderer` (loop.ts), so the
lobby's renderer and a lost device's rebuild are covered. `AtmosphereLayer` owns the table's
`SkyLayer` (`sky`): `apply` feeds it every state; `frame(now)`, on drawn frames only, sets its clock
and captures the sky into the cube when `CaptureThrottle` (`CAPTURE_INTERVAL_MS` by tier, reset per
table) says the `environmentKey` changed, timed as `pmrem`, with one timer for a trailing capture (set
once per wait, so a held clock never asks for frames forever); the first capture runs in the warm-up
hold, so no frame draws with an empty cube; `setTier` shows the dome or not, sets the interval and
picks the cube (below, "The low tier"). `THREE.Fog`, `FOG`, the mist planes (`ambience.ts`), the
presets, their blend (`time-blend.ts`) and the lamp are gone.

**Applying a state.** The key light stands two play radii from the play area's centre toward the
body, raised to `MIN_SHADOW_ELEVATION_DEG` (the dome keeps the true position), with the state's colour
and strength (0 under an enclosed sky); its shadow box is fitted to the grid each time the map is
drawn (#229, "The key light's shadow" below).
The hemisphere takes `hemi` (an enclosed sky's `fill` blended in as light from nowhere), the fog its
colour, density and height (the world's haze thickens it, `HAZE_DENSITY` per unit, and tints it to its
colour), post's exposure `2^(state.exposure + grade.exposure)` in EV, and the point lights the sky's
`nightGlow` (0.5 by day, 1 at night: `LightingLayer.setGlow`; flames ask for frames to flicker past
0.5 or in a dark area, "Flicker (#231)" below). Every write is into existing objects. A new hour tweens the short way round the clock
over `TWEEN_MS` (3 s, ease-out), re-evaluating the curve each frame (`tick`, part of `drawFrame`'s
moving flag); it snaps under reduced motion and on a new table (`fit`). The sky, weather and haze snap.

**Shadows.** `AtmosphereLayer.shadowFrame` sets the key light's `shadow.needsUpdate` when the table
changed (`shadowsDirty`, while the light shines), when `shadowNeedsRedraw` says the light turned
`SHADOW_STEP_DEG` or switched body since it was last drawn, or when forced (the first frame, the
gallery). `setLighting` no longer marks the table changed unless its lights did (their fixtures cast
shadows), so an hour redraws by the rule alone: a day's sweep a minute at a time draws 481 maps (two
body switches), noon to 13:00 21, noon to 18:30 131 (`atmosphere.svelte.spec.ts` checks the count
against the rule and that nothing compiles).

### The key light's shadow (#229)

`fitShadowFrustum` (`light-model.ts`, pure, tested in `light-model.spec.ts`) fits the shadow camera's
orthographic box to the grid's box from the floor to a wall above the highest floor (`fitToTable` sets
`AtmosphereLayer.shadowBox`), in the light's own axes as three's `lookAt` makes them: the box's corners
in light space, four texels of room for the soft filter, sized in half-cell steps and centred on a
whole texel, reaching toward the light by the box's height again for anything taller. It is refitted
only when the map is drawn (`shadowFrame`), so a camera move never touches it and a light turning
less than `SHADOW_STEP_DEG` keeps its texels; the world past the grid lies outside and reads as
unshadowed. A 64×64 table gets at least 20 texels a cell at 2048 from any direction (the old sphere
box spent them on the backdrop). The map's size is the tier's `sunShadowSize` (1024, 2048, 2048, 4096) and PCF's `radius` its `sunShadowRadius` (1, 2, 3, 3: low has no TRAA to hide the noise);
`normalBias` is 0.02 of a cell and `bias` stays -0.0005. Radius, `normalBias` and `intensity` are
uniforms in r186's `ShadowNode`, so none compiles. The moon casts with the same light at its curve
intensity, its shadows at `MOON_SHADOW` (0.5) darkness; an enclosed sky's key light is 0, so it never
redraws (the first frame's forced draw aside, which the warm-up needs).

**Deferred.** PCSS (contact hardening on high): the blocker search must read raw depth, and the
WebGL2 backend's `sampler2DShadow` can't be `texelFetch`ed (GLSL ES 3.0), so it could only be
WebGPU's; a per-tier `filterNode` must also exist from the lobby's warm-up on and rebuild the renderer
on a tier change (the pipeline-shape rule in `Tabletop.svelte`), and its look needs WebGPU goldens.
High keeps PCF at radius 3 everywhere until then. r186's `SunLight` cascades for vista shots (the
Hollow's pull-back, photo mode) are left to #125: they fit slices of the view frustum, so they redraw
on every camera move, which is the cost #143 removed.

### The atmosphere curve (#212)

`tabletop/atmosphere-curve.ts` is pure and three-free (relative imports only, tested in the server
project by `atmosphere-curve.spec.ts`, so the asset pipeline runs it too): `atmosphereAt(preset,
time, weather, out?)` turns a `SkyPreset`, the hour and the weather into an `AtmosphereState`, every
number the sky, key light, hemisphere, IBL, fog and grade need. It is the one place that decides what
19:30 in rain looks like; the renderer applies its result and nothing else. `out` is filled in place,
so a tween frame allocates nothing, and the same inputs always give the same state. The maths it
builds on (`kelvinToLinear`, `sunDirection`, `moonDirection`, `moonIllumination`, `elevationOf`) is
in `tabletop/sky-maths.ts` and re-exported. Skies are the manifest's `SkyDef` (#213, built from
`assets/skies`); `presetOf(def)` maps one to the `SkyPreset` the curve reads (the path's moon onto
the preset, its phase from a share of the cycle into days). The default open sky, `temperate`, is
tuned so 12:00, 19:30 and 23:00 give exactly the old lighting presets' hemisphere, sun and haze (its
dome, IBL, moon, stars, clouds and night glow are a first guess for the M67 look review).

**Axes and units.** Y up, grid north along -Z, east along +X, all turned about Y by the path's
`north` (degrees). Directions are unit vectors from the table toward the body; elevations are in
degrees. Colours are linear sRGB, written in presets as `#rrggbb` and linearised as three's
`Color.setHex` does; the sun's may instead be a temperature (`sunKelvin`, Tanner Helland's fit,
1000-40000 K). Colours stay in 0-1 (the HDR is in the strengths: the key light up to 2, exposure in
EV within ±1), which the spec checks every minute in every weather.

**A preset.** `kind` open or enclosed; an open sky's `path` (`latitude`, `declination`, `north`,
`noon`, `DEFAULT_PATH` when absent), `moonCycle` and `moonPhase` (days; half the cycle is full) and
`moonColor`; 2-16 `keys` in rising minutes, each with the sun's colour, `sun` and `moon` (the key
light's strength by body), `hemiSky`, `hemiGround`, `hemi`, `ibl`, the dome's `zenith`, `horizon`
and `ground`, `fog` (`color`, three's `density` per metre, the layer's `height` in metres),
`exposure`, `stars`, `clouds` and `nightGlow` (how much windows and fixtures glow); an enclosed sky's
keys add `fill` (colour and strength), one key per rules band at its canonical hour, and it never
has a key light (#221, "Enclosed skies" below).

**The sun and moon.** Hour angle `H = (minute - noon) / 1440 · 2π`, elevation `asin(sin φ sin δ +
cos φ cos δ cos H)`. Solar noon is 13:00 (780), because the bands are symmetric about it: a path
symmetric about 12:00 cannot have the sun up at 18:59 and 6° down at 04:59. The moon runs the same
path a `phase` of a turn behind (`phase = ((day + moonPhase) mod moonCycle) / moonCycle`, whole days
of the absolute time; `WorldLook.time` is a minute of day, so today the phase is the preset's own).
The one directional light, `key`, is the sun down to `HANDOVER_DEG` (-4°), fading to 0 there from
0°, then the moon, fading in to -8°, its strength times its lit share with `MOON_FLOOR` (a moonless
night still reads) and its colour moon-blue (the Purkinje shift). The body switches only at key light
0, so `shadowNeedsRedraw` counts the switch without a visible pop.

**Keys and weather.** Keys blend by smoothstep between neighbours, round midnight too (23:59 and
00:00 agree). Weather (`none`, `rain`, `storm`, `fog`, `snow`, `ash`, `dust`, by `intensity` 0-1)
only dims the sun and hemisphere, only raises clouds (hiding stars), fog density and height, only
lowers exposure, and tints the haze (rain grey-blue, ash grey, dust ochre; snow also whitens the
horizon and ground), so every field is monotonic in intensity. Overcast is a preset, not a weather.
`lut` weighs the grade by the sun's height (day above 0°, dark below -10°), for #162; the grade stays
keyed by band for now.

**Continuity.** Over any minute no number moves more than 0.05 (the key light as colour times
strength; its direction and colour jump only at strength 0), and the sun and moon less than 0.3°.

**The band contract.** `checkBandContract(preset)` names every way an open preset contradicts the
rules' bands (`bandOf`, the only source of the edges), minute by minute with no weather: by day the
sun is above the horizon and no stars show; in the dark the sun is at `DARK_SUN_DEG` (-6°) or lower
and the moon is the key; and every day minute's hemisphere is brighter than every dark minute's. It
also checks the keys' count and order. `temperate` (latitude 45°, declination 10°, noon 13:00)
passes; noon at 12:00 fails. The pipeline refuses a sky that fails (`pipeline-skies.ts`, #213).

**Shadows.** `shadowDirection` raises the key light to at least `MIN_SHADOW_ELEVATION_DEG` (12°)
for the shadow map, keeping its bearing. `shadowNeedsRedraw(drawn, next)` is true when the light as
last drawn turned `SHADOW_STEP_DEG` (0.5°) or more, or switched body, and never for a light of
strength 0: a day's sweep redraws about once per half degree.

**The captured sky.** `environmentKey(state)` quantises what the captured environment sees (the dome's
colours in square-root steps, so night's dim colours count; the sun's direction by about 5° while its
glow shows; glow, clouds and stars by tenths). The environment is captured again only when it changes
(#216): about 160 times over a day with no weather, never under an enclosed sky.

**Fog.** `fogFactorAt(fog, range, viewZ, y, fromPlay)` is what the scene's fog node works out (#217):
the larger of range fog (three's `rangeFogFactor`, `fogRange(extent)`: from 1.5 to 3.5 table
extents, never nearer than 40-90 m, so it starts about at the far edge of the play area as the
default poses see it, #221) and height fog (`exponentialHeightFogFactor`), held to `PLAY_FOG_CAP`
(0.3) over the play area and lifting to 1 over `PLAY_FOG_BLEND` (6 m) beyond it, so the world past
the grid fades out while the play area always reads. The spec checks the cap from both default poses
on every grid from 4×4 to 64×64 in thick fog, and that at noon with no weather every open sky leaves
the play area's far corner under 8% fog.

**The skies' haze (#221).** Height fog is `(height - y) · viewZ · density` squared, so at the default
poses' 30-100 m a density of 0.012 over 30 m (the first presets) put every play cell at the cap in
the old brown background. The haze is now thin and the colour of the sky's horizon: at noon 0.0004-
0.0006 per metre under a 4-5 m layer (under 2% at the village's far corner), dawn and dusk about
0.001 in the horizon's warm hue (5-10%), night 0.0008-0.0012 in moonlit blue. Past the play area the
cap lifts and range fog closes the world into the horizon. IBL is 0.4 by day, 0.3 at dawn and dusk and
0.2 at night on open skies, 0.1-0.15 under enclosed ones; moonlight 0.06-0.18.

### The dome and its capture (#214, #216)

`tabletop/sky.ts` `SkyLayer` is the sky: a unit sphere round the camera pinned to the far plane (as
three's `SkyMesh`), whose colour is a zenith, horizon and ground gradient, the sun's disc (HDR, which
bloom catches) and two glows, the moon as a sphere impostor lit from the sun (its phase for free),
fbm clouds drifting on the wall clock (SkyMesh's sinless noise, so every GPU agrees), and an
enclosed sky's rock (`shell`); apart from it, one instanced draw of seeded stars (`starField`,
`STAR_COUNTS` per tier, turning with the hour, twinkling unless motion is reduced). Everything that
varies is a uniform fed by `apply(state, haze, inscatter)`, so no hour, sky or weather compiles. It
is not the world: it reads no cell map, fog is off on it, and it writes 0 to the scene pass's
`hidden` attachment (as dice do), so the re-mask never stamps unexplored ground on the sky.

**The horizon.** The fog paints the far ground in its colour (warming toward the sun by the
inscatter), so the dome's horizon is that colour too: at the line the dome is exactly the haze (the
world's haze tint included), rising into the preset's own `horizon` over `HAZE_BAND` (0.12, about 7°)
and into the zenith above; below the line it is the haze into `ground`. The sun, moon and an enclosed
sky's rock fade into the haze at the line. The fogged ground and the sky meet with no step for every
sky and hour: the horizon test (`renderer.svelte.spec.ts`) measures 2 of 255 across the seam (it
allows 8) at noon and dusk.

**The capture.** `capture` renders `envScene` (a second dome sharing the material, and nothing
else, so no geometry of the table ever shows in a reflection; no sun disc, which sparkles in rough
surfaces) into `SKY_CUBE` (64 px, half float, module-level, never disposed), linear with no tone
mapping or MRT; three's PMREM filters it again on the next frame, and `skyEnvNode` samples that.
`CaptureThrottle` (sky-maths.ts) captures when `environmentKey` changed, at most every 2 s on high
and ultra and 5 s on medium, with one trailing capture so the last state is the one captured.

### Sky visibility (#219)

How much of the sky each cell sees is the `visibility` map's A channel (`skyVisibilityMap` in
`cell-maps.ts`, from the `darkness` and `interior` masks the viewer was sent, nothing else): 1 under
the open sky, `INDOOR_FILL` (0.6) under a roof, 0 in a dark area, then a one-cell blur on the lit
side only, so a dark cell never gets sky light. `worldModify`'s `skySun` (the sun's share: 0 below
the fill) and `skyAmbient` scale the sky's lights: `SkyLight` (the key light) multiplies its direct
light and shadows by `skySun`, `SkyHemisphere` its irradiance by `skyAmbient`, and `skyEnvNode` the
IBL by `skyAmbient` too, so a dark area is as dark at noon as at midnight (the ringing chamber,
`sky-light.svelte.spec.ts`, which also checks IBL alone, four times over, never reaches it) and a
roofed room keeps an indoor fill without the sun. Point lights are untouched. `setInterior` on the
tabletop carries `room.interior`; `flashLift` raises the sky's reach during a flash.

### The ground to the horizon (#220)

The table's slab and rim are gone. `tabletop/world-ground.ts` (pure) gives a table's extents:
`worldExtents` has the play extent (the grid's box up to a wall above its highest floor: picking,
views, shots, the warm-up camera, the effects' bounds, the shadow box and how far the
camera may pull back) and the world extent (the land out to the horizon, the haze from `fogRange`,
the far plane). `tabletop/landscape.ts` `WorldGround` draws the play plane (the terrain kind, painted
floors from the ground map; only under `?off=terrain` since #240) and, since #244, what lies beyond
the grid: the skirt to the horizon and the environment's silhouettes ("Beyond the grid (#244)"
below). Off the grid `worldModify` is neutral. The camera tilts to 85° and `CameraRig.keepAbove`
holds it `GROUND_CLEARANCE` over the ground under it (the skirt's height off the grid).

### The low tier and software GL (#225)

Software rasterisers and compat WebGPU start on low (`qualityFor`); SwiftShader in the client tests
is detected as software (`stability.svelte.spec.ts`), though the tests pin their own tier (medium
unless asked). On low the atmosphere costs next to nothing: the dome and stars are hidden (the
objects stay, so a tier switch is visibility only) and the background, a clear colour, is the haze at
the horizon; the sky is captured once per table (`CAPTURE_INTERVAL_MS.low` is infinite, the throttle
reset per table) into `SKY_CUBE_LOW`, 16 px, inside the warm-up hold (`setTier` swaps the PMREM
node's texture, whose sizes are uniforms, so nothing compiles); and the fog's height density is 0,
range fog only. The key light, hemisphere, sky visibility and flash are the same on every tier: they
are the rules' picture. The gradient background the issue left open was not taken: the flat haze
colour matches the fogged ground, and a gradient would cost a draw for no reading.

### Enclosed skies (#221)

The cavern (the Hollow) wears `underground`, the living cave (the Heart) `abyss` and the railcar (the
train and the locomotive) `lamplit`; "Underground (no sun)" on any table resolves to `underground`
(`resolveSky`). None shows a sun, moon, stars or clouds, and none follows the hour or the weather,
but each keeps the rules band: its three keys sit at 12:00, 19:30 and 23:00 and `presetFor`
(atmosphere.ts) uses the band's whole, so a sunless table keeps its band's light (the GM's band
radios underground, Communion's dusk in the Hollow, and the train, whose look has a sun switch on:
its band follows the hour, and at Blackwater's midnight the dark key all but puts out its warm fill as
the lamps go out). A key's hemisphere is the old preset's for its band; the `fill` is the look: the
Hollow a dim desaturated navy (ref 4, silhouettes legible) over a near-black navy shell and lake mist
below the shore (0.8 m); the Heart a low crimson over a black shell, crushed (ref 3); the train
lamplit wood. `skies.spec.ts` checks that the train's band follows the hour and the Hollow's and the
Heart's do not.

### The flash (#222, #223)

A `flash` cue lights the whole table for `FLASH_MS` (`src/lib/game/chat.ts`, the server's window).
`EffectsLayer` keeps the envelope with `flashAt` (flash.ts): full in 5% of the window, held to 30%,
then a linear fall to 0 at `FLASH_MS`; a cue while one plays (`retrigger`) holds it on from where it
is, so the Keeper's tolls back to back never dip into the dark and rise again. The renderer hands the
strength `k` and the policy to `AtmosphereLayer.setFlash(k, policy)` and to `CellMaps.setFlash(k)`:

- exposure up `min(FLASH_EV · k, policy.maxEV)` EV (`FLASH_EV` 1);
- bloom up `FLASH_BLOOM · k · policy.bloom` (0.4) over the tier's own, only where the tier blooms
  (`Post.bloomBase` above 0), so the bloom passes' gate never opens for a flash;
- the hemisphere up `FLASH_HEMI · k · policy.hemisphere` (1.5), in a cool white;
- the sky's reach (`flashLift`) and the dark's thinning to `k`, never capped, so a reduced flash shows
  exactly as much for exactly as long; fog of war is untouched and unexplored cells stay black.

All uniforms: no program changes (`flash.svelte.spec.ts` counts them across both policies).

**Reduce flashing** (the Graphics menu, `GraphicsPrefs.reduceFlashing`: `auto` follows
`prefers-reduced-motion` live, `on` and `off` override it; per viewer, never sent) is separate from
reduced motion, which keeps the flash as the one sign of what the server shows. `flashPolicy(true)`
rises over 500 ms (`REDUCED_RISE_MS`, 20% of the window), holds to 40%, caps exposure at +0.5 EV,
bloom at 30% and the hemisphere lift at half, and `neutralRed`: over a red grade's light (the
hemisphere's red share 0.6 or more: `abyss`, `blood-moon`) the exposure lift is dropped and the
hemisphere, doubled, carries the flash in white, so saturated red never pulses. Every flashing effect
goes through `flashPolicy` (lightning #323 and the finale's effects #336 too). `countFlashes` is WCAG
2.3.1's rule over sampled frames; `flash.svelte.spec.ts` feeds it frames of the chamber's flash, of
tolls 2.5 s apart and of a cue inside the hold, in both modes: 3 or fewer flashes a second, no red
flash, and with Reduce flashing no swing quicker than the 500 ms fade.

## Light falloff (#226)

One pure definition of how far and how brightly a light renders, in `src/lib/game/lights.ts`, shared
by the renderer and the tests. The contract every lighting change keeps:

- **Zero where the rules are dark.** A light renders above zero only on the cells `litMask` lights
  for it. Reach is `renderedReach(radius)` = `floor(radius) + 0.5` cells, measured horizontally from
  the rule origin (the light's cell centre): lit cell centres have `d² ≤ r² + r < (r + 0.5)²`, the
  rest `d² ≥ r² + r + 1`, so the window ends exactly between them. Occlusion comes from the same
  origin and the same line of sight (`hasLineOfSight`: walls, windows, levels).
- **Readable where lit.** `lightFalloff(radius, dxz, d3)` is the rules window
  `saturate(1 - (dxz / reach)^4)^2` on the horizontal distance, times a body `1 / max(d3,
CORE_RADIUS)^LIGHT_DECAY` on the 3D distance from the visual position, times a hot core inside
  `CORE_RADIUS` (inverse-square, never past `CORE_MAX`). The window is tiny at the rim of a large
  radius (about `1e-6` at radius 20, black in float32), so the shader tops a lit cell's point light
  up to `READABLE_EDGE` in the source's colour: `readableFill(lightLevels)`, which is `READABLE_EDGE`
  exactly on lit cells (`lightLevels` floors them at 0.2) and 0 elsewhere.
- **The visual position is look only.** `lightMount` (`tabletop/light-model.ts`, pure) hangs a torch
  or lantern `MOUNT_OFFSET` off the first walled edge of its cell (north, east, south, west) at
  `MOUNT_HEIGHT` of a wall, so its light rakes across the wall's normals, and stands any other light
  at its cell centre at its look's height. The rule origin never moves.

`lightLevels` (the cell maps' light level) fades through the same window, floored at 0.2 where lit.
`renderedLevels` is what the shader computes at cell centres, for the spec. `LIGHT_DECAY`,
`CORE_RADIUS`, `CORE_MAX` and `READABLE_EDGE` are tuned in #238 within `FALLOFF_RANGES`
(decay 0.5-2, core radius 1-2 cells so the body never passes 1, core cap 1-8, readable edge
0.02-0.2); `lights.spec.ts` proves the contract on a 24×24 grid for radii 1-20, flat, behind a wall,
over raised ground, from a balcony behind its railing and through a window, at every corner of those
ranges. GridLights (#228, "Many lights" below) compute exactly this in the shader (`falloffNode`).
M67's fixed pool of 8 point lights, kept behind `?off=manylights` until M68 closed, was removed at
the close: GridLights are the only point lights on every tier.

### Exposure from the focus cell (#233)

Exposure follows what the camera looks at. `exposureFor({ band, focusDark, focusLight, focusVisible })`
(`tabletop/exposure.ts`, pure, tested in `exposure.spec.ts`) gives an EV lift: 0 in the open by day
or at dusk; in the dark band or a dark area at any hour, `LIFT_CAP · (1 − LIGHT_DAMPING · light)`,
where `light` is the rules' level at the focus (0.6 of the lift goes at full light). `LIFT_CAP` is
`MAX_LIFT` (1.5 EV) or less, so an unlit night cell (`1 − NIGHT_DARK`) never shows above
`DARK_CEILING` (0.5): about 1.47 EV. It is 0 whenever the viewer can't see the focus cell (a fogged
player's explored or hidden cell), so the lift never probes the dark beyond what the rules show. The
focus is the cell under the camera's target, read from the visibility map as packed
(`CellMaps.focusAt`: A 0 a dark area, B the light, R visible, or the GM, or no fog), so it is a
function of what the viewer was sent and the local camera, with no readback.

`AtmosphereLayer.tick` eases the lift over `LIFT_MS` (800 ms, ease-out, on the wall clock; ACTIVE
frames until it lands, then none) and snaps it under reduced motion and on a new table. Exposure is
`2^(clamp(sky + look) + lift + flash)`. Remembered cells must not brighten with it: `worldModify`
multiplies the unseen (a player's explored cells, the GM's unseen ones) by `cellUniforms.memoryGain`
(`2^−lift`), and since exposure multiplies before the tone mapper the compensation is exact;
unexplored cells stay exactly 0. `exposure.svelte.spec.ts` holds both: explored pixels within 2
levels whatever the lift, black stays black. All uniforms: no program changes.

## Many lights (milestone 68)

### Decision (#227, spike 1 October 2026): GridLights

Point lights are drawn by **GridLights**: one custom light per scene (`GridLight`, its node
registered on the renderer's node library before the first compile, as `SkyLight` is), which every
lit fragment runs as a fixed `Loop(K)` over its cell's light list, read with `textureLoad` only, so
one graph runs on the WebGL2 and WebGPU backends with no compute and no storage buffers. Each entry
reads its light's data and three taps of its polar occlusion row and adds three's `directPointLight`
through the lighting model (`LightsNode.setupDirectLight`), as `ClusteredLightsNode` does per
cluster. The set of light objects never changes, so lights coming and going change texture data,
never a program. Three's `DynamicLighting` (option (a)) is rejected: it shines through walls, costs
50-60% more GPU time than today's pool on the dGPU and about twice the pool on the iGPU at 40 lights,
and needs a `constructor.name` lookup (`'PointLight'`) that a minifier may break.

**Data** (pure builders in `src/lib/tabletop/grid-lights.ts`, tested in `grid-lights.spec.ts`):

| What           | Built by                                                                                                                                                                                                                                                               | Texture                                                            | Size                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------- |
| Light lists    | `buildLists(grid, sightCache, sources, K)`: each light's `SightCache` sight, the same `addVision` the rules' `litMask` uses, so a cell lists a light exactly where the rules light it; strongest first (`lightFalloff` at the cell centre), the weakest dropped past K | RGBA8, nearest, K/4 texels per cell, sized for the 100 × 100 limit | 80 KB at K = 8          |
| Light data     | `packLightData(entries)`: visual position and reach; colour × intensity and flags (hero, bake-excluded, no-core); the rule origin's centre, flicker profile and phase                                                                                                  | RGBA32F                                                            | 3 texels a light        |
| Occlusion rows | `buildRows(grid, sight, origin, levels)`: 256 angles marched from the light's own sight mask to the exact edge into the first cell out of it; cells below the light's floor it can't see (the drop under a balcony's edge) are marched over                            | the same RGBA32F texture, 64 texels a light after its 3 of data    | 255 × 67 texels, 268 KB |

Capacity 255 lights (indices are bytes, 0 empty). Data and rows share one texture: with three
textures the largest fragment stage reached 16 sampled textures, WebGPU's default
`maxSampledTexturesPerShaderStage`; with two it is 15 (13 with the pool), counted from every
fragment shader the page compiled, WGSL and GLSL. #228 must keep that budget: the plan's `light`
cell map (fill, bounce, cavity) goes into an existing map's channels or this texture, not a 16th
binding. `packLightData`'s layout (a texel row per field) is transposed into a row per light on
upload in the spike; #228 should pack straight into the row-per-light layout.

**Gating rule.** A light reaches a fragment only if it is in the fragment's cell list (cell looked up
at `positionWorld + normalWorld × 0.3 cell`, so each wall face reads its own side), and only as far
as its occlusion row allows at the fragment's angle from the rule origin (3 taps on medium; a tap is
lit when the distance is within the row plus 0.02 cell). Membership comes from the rules' sight, so
"rendered light only on rule-lit cells" holds by construction; the rows only shape light inside lit
cells (shadow wedges behind corners and jambs) and can only darken.

**Per-tier caps.** K = 4 (low), 8 (medium, high), 16 (ultra). No fixture overlaps more than 3 lights on
a cell (dungeon-40 2, the village 3, the monastery and the Hollow 2), so K = 4 drops nothing on any
shipped table; K only bounds the loop.

### Measurements

`scripts/spike-lights.mjs` (spike branch only) on dungeon-40 (40 torches in 20 walled rooms) at
1920 × 1080, medium tier, fog off, GM view, reduced motion; GPU ms per frame by timestamp queries,
median of 32 frames. _Leak_: on a 14 × 8 table split by a wall, torch A half a cell from it, torch B
lighting the far room; the largest brightness change (8-bit luma, 5 × 5 patches) on the far side's
cells beside the wall when A is switched on. _Lit_: the smallest change on A's own side.
_Coverage_: torches whose neighbouring cell brightens by over half the brightest. _Programs_: before,
with every light removed, and with all 40 back.

| Path                | Backend, GPU                            | GPU ms overview / close | Leak (far side) | Lit (near side) | Coverage (of 40) | Programs, 40 lights out and back | Textures per fragment (max) |
| ------------------- | --------------------------------------- | ----------------------- | --------------- | --------------- | ---------------- | -------------------------------- | --------------------------- |
| Pool of 8 (M67)     | WebGPU, RTX 4060                        | 2.22 / 2.78             | 8.3             | 6.7             | 8¹               | no change²                       | 13                          |
| GridLights K = 8    | WebGPU, RTX 4060                        | **2.07 / 2.61**         | **0.1**         | 6.6             | **40**           | no change                        | 15                          |
| DynamicLighting, 40 | WebGPU, RTX 4060                        | 3.50 / 4.35             | 8.6             | 6.7             | 40               | no change                        | 12                          |
| Pool of 8 (M67)     | WebGL2 (ANGLE Vulkan), RTX 4060         | 2.71 / 3.32             | 8.6             | 6.7             | 8                | no change                        | 13                          |
| GridLights K = 8    | WebGL2 (ANGLE Vulkan), RTX 4060         | **2.49 / 3.09**         | **0.1**         | 6.7             | **40**           | no change                        | 15                          |
| DynamicLighting, 40 | WebGL2 (ANGLE Vulkan), RTX 4060         | 4.34 / 5.00             | 8.4             | 6.5             | 40               | no change                        | 12                          |
| Pool of 8 (M67)     | WebGL2 (ANGLE Vulkan), Intel RPL-S iGPU | 56.4 / 69.2             | 8.2             | 6.6             | 8                | no change                        | 13                          |
| GridLights K = 8    | WebGL2 (ANGLE Vulkan), Intel RPL-S iGPU | **41.6 / 54.8**         | **0.1**         | 6.7             | **40**           | no change                        | 15                          |
| DynamicLighting, 40 | WebGL2 (ANGLE Vulkan), Intel RPL-S iGPU | 105.1 / 131.2           | 8.3             | 6.6             | 40               | no change                        | 12                          |
| Pool of 8 (M67)     | WebGPU, Intel RPL-S iGPU                | 81.2 / 77.1             | 8.3             | 6.6             | 8                | no change                        | 13                          |
| GridLights K = 8    | WebGPU, Intel RPL-S iGPU                | **54.4 / 70.1**         | **0.1**         | 6.6             | **40**           | no change                        | 15                          |
| DynamicLighting, 40 | WebGPU, Intel RPL-S iGPU                | 116.6 / 139.9           | 8.4             | 6.7             | 40               | no change                        | 12                          |

¹ The pool lights the 8 largest; on the WebGPU dGPU run the readback saw 40 while the first view's
pipelines were still compiling (programs 111 → 121 during it), so that cell is the WebGL2 and iGPU
runs' 8. ² Programs are flat on every path once warm. The 0.1 left on GridLights' far side is the
readback's floor (grain and dither).

**CPU** (Node 22, `buildLists` + `buildRows` on the fixtures, median of 7): a light switched or moved
with the sights cached rebuilds the lists in 0.20 ms on dungeon-40 (40 lights; 0.15 the village and
the Hollow) and its own row in about 0.02 ms; a door toggle, which clears the sight cache, rebuilds
all of it in 4.3 ms on dungeon-40 (the lists 3.35, every row 0.91; 2.2 + 0.3 the village, 1.0 + 0.5 the
Hollow), within M34's 6.4 ms relight for the GM loading the village. In the browser the whole relight
(the rules' light levels, the pool, fixtures and the cell maps included; median of 6 per run) was
2-11 ms with the pool and 4-16 ms with GridLights across runs, too noisy to separate; the grid's own share being the Node figures above
plus the uploads (80 KB lists, 268 KB data, all of it each time in the spike: #228 should upload only
the rows that changed, `addUpdateRange`).

### The r186 internals it rides on

For the upgrade procedure ("Upgrading three.js"): `AnalyticLightNode.setup` (overridden whole, so
three's shadow setup for the light never runs), `LightsNode.setupDirectLight` and the
`builder.context.reflectedLight` `directDiffuse`/`directSpecular` `toStack()` calls before the loop
(as `ClusteredLightsNode.setupLights`), `directPointLight` from `three/tsl`, `NodeLibrary.addLight`,
`TextureNode.getUniformHash` (by the texture's uuid: several `textureLoad`s of one texture share one
binding), and `PhysicalLightingModel.direct`'s `{ lightDirection, lightColor }` contract.
`LightsNode.customCacheKey` hashes light ids and `castShadow` only, which is why one stable
`GridLight` never recompiles. A parity test against `DynamicLighting` on a wall-free table (#228)
should be the first thing an upgrade fails.

### Fallback and what is left

- If a device lacks 15 sampled textures per stage (none we target; WebGL2 guarantees 16 units), the
  low tier drops the occlusion taps and reads lists only (cell-exact walls, no wedges).
- Radiance cascades do not deserve a research issue yet: the per-light rows give exact wall shadows
  at this cost, and #234's bounce field covers the indirect light the cascades would add.
- Unrelated, seen on every path and on M67's pool: on WebGPU one pipeline per table failed with
  "Color target has no corresponding fragment stage output" (`targets[1]`). Not a mini's (#379): the
  mini's async compile only caught the error in its scope. It was the output stage's quad, drawn by
  a perf benchmark while the warm-up held the scene pass's three targets set; a benchmark now waits
  for the warm-up, and `fixtures.svelte.spec.ts` benchmarks during one on both backends.

### The shipped path (#228)

- **Sources and entries.** `LightingLayer` (`lighting.ts`) hands every source that is on, placed or
  carried (`litSources`: `lightSources`' order with the light's or the carrier's id), to
  `GridLighting` (`grid-light-layer.ts`), which makes a `LightEntry` each (`grid-lights.ts`: id,
  rule origin, visual position, reach `renderedReach`, linear colour, intensity = the look's
  intensity × `2 + radius`, flicker profile and phase (#231, below), flags hero / bake-excluded /
  no-core; the flags are 0 until #230, #234 and #236 fill them, but the layout has them). The visual position
  is `lightMount`, a sconce's or brazier's top (`lightSeats`), or the carrier's hand (`HAND`, by its
  scale and lift), which follows the mini as it glides (`LightingLayer.carry` from the frame's token
  tick: only those lights' layers upload). The day halving of the pool is gone: the sky's exposure
  handles the day.
- **Data and uploads.** `GridLight` (`materials/grid-light-node.ts`) holds two `DataArrayTexture`s:
  the data, a layer per light (`packLight`: 3 data texels, then the 64 texels of its occlusion row),
  and the lists, a layer per grid row (K per cell, four to an RGBA8 texel). A light that changes
  uploads its own layer and a list change the rows that changed (`addLayerUpdate`, which r186 honours
  on both backends; `Texture.addUpdateRange` is the classic renderer's only). Rows are cached per
  sight (`WeakMap` on the `SightCache`'s mask), and the client's `SightCache` keeps every sight while
  the obstacles are the same, so a token's move works out one sight.
- **The node.** One `GridLight` per scene, made by `createSceneLights` so the lobby's warm-up and the
  table compile the same, registered by `registerGridLights` beside the sky's lights (`loop.ts`). Its
  K is the tier's `lights` (4 low, 8 medium and high, 16 ultra); another K is another `GridLight`,
  swapped by `LightingLayer.setTier` (a new program, as any tier switch makes). M67's pool of 8 (`?off=manylights`) was
  removed at M68's close. Per entry: the rules window, body and core (`falloffNode`, the mirror
  of `lightFalloff`) times three occlusion taps, never below `READABLE_EDGE` on a listed cell, into
  the lighting model as a direct light (`lightDirection` toward the visual position).
- **One dimming.** The lit kinds light with `KindLightingModel` (`materials/lighting-model.ts`,
  their `KindStandardMaterial` and `KindPhysicalMaterial` bases): its `indirect()` scales the indirect
  light (hemisphere, image light, AO, a mini's clearcoat) by `worldLight` (the rules' light factor
  `worldModify` used to put on the whole output), `SkyLightNode` scales the key light by it for these
  materials only (`kindLit`), and `worldModify(output, emissive, true)` fogs, tints and adds the dark's
  colour without darkening again, so a torch's pool is no longer dimmed by the dark it lights. Materials
  that are not kinds (fixtures, flames, the mist) keep the whole darkening.
- **Budget.** The largest fragment stage samples 15 textures (terrain on medium and high; 14 on
  low), counted per material and tier from every fragment shader the table's warm-up compiled
  (`program-count.svelte.spec.ts`, `STAGE_TEXTURES`); the readable fill needs no texture (it is the
  `READABLE_EDGE` floor in the loop), so the plan's `light` cell map is left to #234, which packs
  bounce and cavity into an existing texture.
- **Tests.** `grid-lights.svelte.spec.ts` on both backends: dungeon-40 from above with the GridLight
  on and off (every rule-lit cell centre brighter, every other one unchanged, every torch in view
  lighting its pool), a wall with a torch half a cell from it (neither the far face nor the floor
  behind it changes when the torch's colour goes black) and the monastery's `mn-gallery-lamp` on its
  balcony (no cell past its rules' sight changes). The program-count sweep's `lightSteps` (40 torches
  in and out, every kind, recoloured, a carried light on, coloured, moved and off) on every tier;
  unexplored-black's dungeon-40 and ref-6 with a lantern carrier on hidden ground beside the player;
  `grid-light-layer.spec.ts` (a hidden carrier beside a player is never one of the player's lights).
  The parity test against `DynamicLighting` waits: the falloff is no longer three's, so it would
  compare shapes, not pixels.

### Flicker (#231)

Flames flicker in the shader, at no CPU cost per light. Each `LightEntry` carries a `profile` (the
look's `flicker`, its index in `FLICKERS`) and a `phase` (`flickerPhase`: FNV-1a of the light's id,
or the carrying token's, over 2³², the same hash as the `SightCache`'s `hashBytes`, exported as
`fnv1a`), so a torch flickers the same on every client, after a reload and however other lights come
and go. `flickerAt(profile, phase, t)` in `light-model.ts` is the reference, two sines
`1 + a1 sin 2π(f1 t + phase) + a2 sin 2π(f2 t + 2 phase)`, and `flickerNode` in
`materials/flicker.ts` mirrors it from the same table (`FLICKER_WAVES`, a uniform array), multiplying
each GridLight's falloff (never its `READABLE_EDGE` floor).

| Profile (`flicker`) | Kinds by default  | Waves (amplitude @ Hz) | Character            |
| ------------------- | ----------------- | ---------------------- | -------------------- |
| `none`              | glow, neon, panel | none                   | steady               |
| `candle`            | candle            | 3% @ 1.9, 2.5% @ 2.7   | small and quick      |
| `torch`             | torch             | 4.5% @ 1.16, 3% @ 2.08 | M67's curve          |
| `fire`              | brazier, fire     | 5% @ 0.7, 3% @ 1.45    | slower and deeper    |
| `pulse`             | magic             | 8% @ 0.4               | arcane: a slow sine  |
| `lantern`           | lantern           | 1.5% @ 0.9, 1% @ 1.7   | behind glass: gentle |

Flash-safe by construction (tested in `light-flicker.spec.ts`): the amplitudes add to at most 8%
and every wave is under 3 Hz, below WCAG 2.3.1's general-flash threshold, so Reduce flashing need
not act. Every frequency is a whole number of cycles in `FLICKER_PERIOD` (100 s), so the shader's
time wraps there without a jump and stays precise in 32-bit floats.

Two uniforms drive it: `flickerTime` from the renderer's injected clock (never TSL's `time`, which
follows frame time and would break held-clock goldens) and `flickerAmp`, 0 under reduced motion
(the live media query, through `setReducedMotion`), so every golden (reduced motion) is unchanged.
`LightingLayer.animating(camera, now)`, called from `drawFrame`, sets both and reports `ambient` to
the scheduler only while a GridLight that flickers reads (the night glow past day's, or its cell in
a dark area; roofed rooms are not counted yet) and its reach sphere meets the camera's frustum: no
AMBIENT frames by day, with nothing flickering in view, or under reduced motion. The fixtures' flames (#232) read the same `flickerNode` and uniforms in
their vertex stage, so flame and light breathe together. Changes are numbers only: the program-count
sweep's `lightSteps` turns the 40 torches through every profile on every tier.

### Strips and panels (#236)

A light of kind `neon` is a bar and one of kind `panel` a lit quad: long sources, drawn through the
GridLights on every tier.

- **Samples.** `stripSamples(light, facing)` (`light-model.ts`, pure) gives a neon bar three
  samples along its 0.84-cell bar (at −0.3, 0 and +0.3 cells, a twentieth of a cell in front) and a
  panel two, corner to corner across it, each a third or a half of the light's intensity; every
  other kind none. `stripEntries` turns a light's `LightEntry` into one per sample: the same id
  (so the same flicker phase), **the same rule origin**, reach, colour and flicker, its share of the
  intensity, its visual position the light's point (its cell centre at its look's height) plus the
  sample's offset, and the no-core flag. Each sample is a layer of its own in the data and listed on
  exactly the cells the light itself lights (`buildLists` takes the light's source for each), so
  reach, occlusion and membership stay the rules' (`litMask` for its radius) and nothing lights past
  a wall. Bounce counts the light once, not per sample. A carried light, or one seated on a prop's
  flame, stays a point.
- **No hot core.** The node reads the no-core flag (`LIGHT_FLAGS.noCore`, 4) from the colour
  texel's w and sets `falloffNode`'s core to 1: a long source lights evenly, with no point to burn
  at. A number in the data, never a program.
- **Facing.** `LightLook.facing` turns a strip as a wall fixture is turned to its side: facing `f`
  has its back to `SIDES[f]` (0 north, then east, south, west) and shines away from it (0 south, 1
  west, 2 north, 3 east), a quarter turn clockwise each. The samples turn with it, and so does the
  fixture.
- **Fixtures.** `neon-bar` (a bar between two posts) and `light-panel` (a framed quad on a stand)
  are part-list placeholders (#232) whose glowing part is the `flame` mesh: the emissive kind in the
  light's colour at `FLAME_GLOW` (above 1, so it blooms), the wick's dark when off, dimmed by
  `worldModify` in fog; `LightFixtures` turns them by `facing`.
- **Deferred.** The ultra tier's fixed pool of `RectAreaLight`s (LTC, assigned to the strips nearest
  the focus and taken out of the sampled path) waits for #357, with ClusteredLighting: its LTC table
  is a large lazy chunk for a tier nobody has measured. A ceiling panel (facing down) waits for a
  look that asks for it.
- **Tests.** `light-model.spec.ts` (sample counts, shares adding to 1, samples inside the cell,
  facing turning them, each entry the same light from the same rule origin with the no-core flag);
  `grid-lights.svelte.spec.ts` (a magenta bar facing a wall lights the wall's face magenta, and from
  above every floor cell its rules light changes and no other, the far side of the wall included);
  the program-count sweep's `lightSteps` (the 40 torches as neon facing every way, recoloured, mixed
  with panels and torches, turned, and back) on every tier, now a test and a CI shard per tier
  (programs 16 to 18).

### Translucency (#237)

Thin and waxy things glow when a light is behind them. `KindLightingModel.direct()`
(`materials/lighting-model.ts`) adds, for the prop, mini and foliage kinds only (by the material's
`kind`, fixed with its graph), a term to direct diffuse before the standard one, so it reaches
every light path that calls the model: GridLights, the sky's key light, the pool.

- **Transmission**, `MeshSSSNodeMaterial`'s: `saturate(V · -normalize(L + 0.2 N))⁴ × 1.2`, times
  thinness: `aBake.x` on props and minis (the bake's openness; where its own parts occlude it, it is
  thick), 1 on foliage.
- **Wrap**, a bump just past the terminator, `max(N·L + 0.5, 0) × saturate(-N·L / 0.5)`: 0 at the
  terminator and on every face the light falls on, so lit from the front only a translucent thing
  looks as it would opaque.
- Both times the albedo (`diffuseContribution`), the light's colour, `1/π` and the strength,
  `params.translucency` (a `materialReference` uniform, `Params` in `kinds.ts`): 0 is off, and any
  value compiles nothing. Specular and emissive are untouched.

The strength comes with the model: a part list's `translucency` (0 to 1) goes into its manifest
entry (`ModelEntry.translucency`), and `PropLayer` and `LightFixtures` give a translucent model
materials of its own in the shared variant (as a textured part's): tent 0.8, banner 0.8, crystal
0.9, candle cluster 0.5, tree 0.4; the foliage kind defaults to 0.6. A model's whole body takes it
(the candle cluster's holder too) until a per-part mask is needed (minis' wings and ears). Ref 1
has a tent between the camera and its torch and a banner by it, ref 6 a crystal before each
brazier. `translucency.svelte.spec.ts` draws each twice, at its strength and at 0, from behind
(the term must brighten it) and, for the tent, from the torch's side (it must not), and checks no
program is made; the program-count sweep's `lightSteps` sets the home table's tree to 0 and back.

### Probe grid (#235)

On high and ultra a coarse grid of L2 irradiance probes (three's `LightProbeGrid`) adds coloured
bounce from the sun, the sky and placed lights. It is an additive layer, `probes`, **off by
default** until the owner's gate (the Hollow's bake under about 3 s on the dGPU with the renderer
idle afterwards; never on WebGL2 on an integrated GPU, `wantsProbes`); `?on=probes` turns it on
for a review (`layersFrom` reads `?on=` as well as `?off=`).

- **Layout** (`probeLayout` in `light-model.ts`, pure and tested): a lattice over the grid from
  cell centre to cell centre, a probe every `PROBE_SPACING` (3) cells, at most `PROBE_MAX` (24) a
  side (farther apart past that), at `PROBE_HEIGHTS` (3) heights from half a cell over the table to
  a wall above its highest floor. The Hollow uses 17 × 3 × 13 = 663 probes.
- **One grid and one atlas for the renderer's life** (`probe-grid.ts`, a lazy chunk with its own
  bundle budget): the atlas is made at `PROBE_MAX × PROBE_HEIGHTS × PROBE_MAX` and a table uses its
  corner; the light object, its texture and so every program stay the same from table to table (a
  replaced texture strands bindings, #380). Our node (`ProbeGridNode`, registered for three's grid
  class before anything compiles) is three's `LightProbeGridNode` sampling over the atlas's own
  size, times `skyAmbient()`, so dark areas take no probe light; the kinds' lighting model then
  dims it by the rules' light factor and cavity like any indirect light.
- **Bake** (`probes.ts`, the scheduler's background `Work`): `ProbeBake` (pure, tested) restarts
  `BAKE_DEBOUNCE_MS` (500) after anything the bake captures changes (the table, levels, walls and
  doors, props, floors, dark areas, roofs, placed lights, the explored mask, the environment, the
  band, the hour to the half hour, any warm-up; never tokens), then bakes `PROBES_PER_FRAME` (8) a
  frame on CONVERGE frames, fades in over `PROBE_FADE_MS` (at once under reduced motion) and stops:
  an idle table draws nothing for it. `ProbeLayer` follows the tabletop's own setters, so
  `renderer.ts` only makes it. A capture renders the client's own scene, which holds only what the
  viewer was sent, through `worldModify` (unexplored cells capture black), with tokens, dice,
  effects and the fog cloud hidden and carried light zeroed (`baking`, the lights' `bakeExcluded`
  flag); its data never leaves the client. Only the first pass is baked (three's indirect passes
  would need a second atlas).
- **Programs.** The grid is in the scene before a warm-up, and every warm-up's hold captures one
  probe, so a bake compiles nothing (`probe-grid.svelte.spec.ts`: the programs and pipelines before
  and after a rebake, and no frame for 3 s once it has converged).
- **Texture slots.** The atlas is one 3D texture, so the largest fragment stage goes from 15 to 16
  sampled textures on high with probes: exactly WebGPU's default limit, with none spare. The
  spec asserts at most 16; anything else a lit kind samples on high (hero shadow maps, #230) must
  share a binding or turn the probes off. The hero atlas took terrain to 17, so terrain has no
  emissive slot (no floor glows: its glow is the tint alone, `KINDS.terrain.slots`): with probes
  and hero shadows on high, terrain samples 16 and prop and mini 15.

### Hero shadows (#230)

A fixed pool of shadow-casting point lights per tier (`shadowedTorches`: none on low, 2 at 256 px on
medium, 4 at 512 px on high and ultra; `heroTier` in `hero-shadows.ts`) goes to the GridLights
nearest the camera's focus. `assignHeroSlots` (`light-model.ts`, pure, `light-model.spec.ts`) scores
each source by its distance from the focus, 8 cells more without a token, prop or step of raised
ground in its reach, and leaves out those past 16 cells; a free slot takes the best, a holder keeps
its slot (and its index) until a challenger is 2 cells better, so camera moves within that never
hand one over. Casters are only what the viewer was sent.

- **Lights.** `HeroLight` (`materials/hero-light-node.ts`), a `PointLight` subclass with its own
  node, registered beside the GridLight's (`registerHeroLights`, `loop.ts`), made with the pool
  (`createSceneLights` makes medium's, `LightingLayer.setTier` another tier's; a new pool is a new
  program, as a tier switch is) and casting for its whole life, so the lights' cache key never
  changes. Its node draws the entry its `layer` uniform names exactly as the GridLights do
  (`entryLight` and `fragmentCell`, shared with `GridLightNode`), only on cells whose lists hold it,
  times its `fade` and its cube's shadow. The GridLight gives that entry's light up by the same
  share (`heroIndex`/`heroFade`, a float uniform per slot), so a light is never lit twice and an
  unshadowed cell reads the same with or without its slot (`hero-shadows.svelte.spec.ts`: within 2%).
  The share is uniforms, not the data's `hero` flag (reserved, left 0), so a handover uploads
  nothing. Vector uniforms on these lights read back wrong on the WebGL2 backend (r186: the slot
  uniforms as `vec4`s did), so they are floats or uniform arrays.
- **Cubes.** One depth atlas for the pool (`HeroAtlas`, a row of six 90° faces per slot, compared
  with the hardware's 2×2 PCF), so the slots add one texture to a lit fragment stage: the largest,
  terrain, is at 15 without probes and 16 with them (WebGPU's default and WebGL2's least, since
  terrain dropped its emissive slot), prop and mini at 15 with probes. `HeroShadowNode`
  (a `ShadowNode` with its own render target, filter and `renderShadow`) fills each face's tile with
  the far depth (a clear would clear the whole atlas), draws the casters with one shared material,
  and records the face matrices and the light's position it drew with, which the filter uses, so a
  cube and its lookup always agree. `shadow.autoUpdate` is off: a slot is due when what its reach + 1
  holds changes at a relight (tokens, props, raised ground, the light's sight, so walls and doors), its
  light moves (a carried light) or a mini glides through it, and for half a second after a change
  (a door's swing, a prop's glide); at most `slots / 2` cubes draw a frame, taking turns. A camera
  move draws none. On a warm-up's gallery frame every slot draws once over the whole table, so the
  casters' shadow passes compile with the warm-up, and again at its reach the frame after.
- **Handovers** fade the old holder out and the new in over `HERO_FADE_MS` (200 ms; at least a twelfth
  a frame, snapped under reduced motion), the new one once its cube is drawn; frames are requested
  until they land. `?perf` shows the holders, cubes drawn and cube memory; the program-count sweep
  hands every slot over (`lightSteps`) on each tier, a test per tier.

## World shape (milestone 69)

`src/lib/tabletop/world/` turns the grid data a viewer was sent into the description every ground,
cliff, void, kit, water and scatter builder of M69 and after consumes (#239). It is pure: no three.js,
relative imports of `src/lib/game/` and `ground.ts` only (a spec fails otherwise), so its specs run in
the server project and `server/perf/world-shape.ts` runs it in Node. CPU only, the same on every tier
and backend. Two rules hold for everything in it: **the picture never contradicts movement or sight**
(steps are what `canStep` climbs, saddles follow `canStep`), and **no edge is drawn toward an
unexplored cell**.

### Input and secrecy

`worldShape({ grid, levels, floor, objects, known })` takes the level and floor maps as sent (masked by
`viewFor`), the scene objects, and `known`: the decoded `FogView.explored` for players and spectators
under fog, null for the GM (whose `explored` is the party's) and with fog off (`knownOf(grid, fog, gm)`).
It reads nothing of an unexplored cell: a property test scrambles every value sent for unexplored cells
and finds every output unchanged. No wire change.

### Continued maps

- **Per cell** (`shape.levels`, `shape.floor`, and `shape.ground`, `groundFor` over them, for dice,
  picks and `floorY`): a known cell's own value; an unexplored cell takes its first known orthogonal
  neighbour's (N, E, S, W, N being y - 1), else 0. Only cells within one cell of the known region change.
- **Per dual tile** (`shape.tiles.levels`, `shape.tiles.floor`): one tile per grid corner,
  `(width + 1) * (height + 1)` of them (`tileIndex(grid, tx, ty)`), whose corners are the four cells
  round it, clockwise from NW (`CORNERS`; off the table a corner is its nearest cell). Each corner's
  quarter is two sectors, split along the diagonal from the tile's centre: eight bytes per tile,
  clockwise from north (`SECTORS`: 0 NE toward NW, 1 NE toward SE, 2 SE toward NE, 3 SE toward SW,
  4 SW toward SE, 5 SW toward NW, 6 NW toward SW, 7 NW toward NE; `SECTOR_H[k]` and `SECTOR_V[k]` are
  corner k's halves toward its horizontal and vertical neighbours). A known corner's halves are its own
  value. An unexplored corner's half toward a neighbour takes that neighbour's value if known, else the
  other neighbour's, else the diagonal's, else its own continued value; so where its two known
  neighbours differ it is split along the diagonal, and every boundary lies on a known-known edge or
  inside unexplored cells. Across a known-unexplored half edge the sectors are always equal, so a
  known-unexplored edge is always flat.

`checkContinuation(shape)` (`invariants.ts`) checks this: every edge with an unexplored side is flat,
every change between sectors is on a known-known half edge, between two unexplored corners or on an
unexplored corner's diagonal, and neighbouring tiles agree on their shared side except inside an
unexplored cell. It runs exhaustively over the 16 known/unexplored patterns of a tile times every
triple of levels {0, 1, 3} and of floors {plain, water, void}, on 150 seeded random tables, and on
every committed view.

### Edge classes

Two `EdgeMap`s (`shape.edges.ground`, `shape.edges.built`), one byte per unit edge:
`h[y * width + x]` (y in 0..height) is the edge along the top of cell (x, y);
`v[y * (width + 1) + x]` (x in 0..width) the one along its left side. `edgeSlot(grid, edge)` and
`slotBetween(grid, i, j)` find an edge's slot; `hEdge` and `vEdge` index directly.

| Ground (`EDGE_GROUND`) | When                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| `flat` 0               | the same level, both void, or an unexplored cell on either side     |
| `step` 1               | a difference of one level: what `canStep` climbs (`MAX_STEP`)       |
| `cliff` 2              | two levels or more: one `STEP_HEIGHT` taller than any walkable step |
| `void` 3               | void on one side only                                               |
| `border` 4             | the table's edge (public; still no face below an unexplored cell)   |

Built (`EDGE_BUILT`): `none`, `wall`, `window`, `door`; the first wall on an edge decides wall or
window (as `walls.ts` draws it), and a door, open or shut, is over any wall it cut. A sealed secret door
(`<id>-sealed`) is a wall, as sent.

### Wall spans

`shape.walls` (`wallSpans(grid, objects, levels, known)` in `wall-spans.ts`) is what `walls.ts`'s
`rebuildWalls` drew, and `walls.ts` now draws from it: each unit edge once (its first wall), from the
lower floor beside it to `WALL_HEIGHT` above the higher; a window a sill to `SILL` (0.35) of a wall
above the higher floor and, between equal floors only, a lintel from `LINTEL` (0.8). With `known`, an
unexplored side counts as level with the known side, so a wall shows no drop toward unexplored ground
(no committed view has one: the spans equal the old ones on every fixture and view; `walls.ts` passes
no mask until #240's layer owns the shape). The eye (`EYE_LEVELS` above the higher floor) lies in
every window's gap. Where a window's floors differ by two levels or more (`mn-railing`, the gallery at
5 over the nave at 0) the sill hides what the rules let the nave see; the spans keep it, and #253 and
#256's balustrade must draw it see-through.

### Regions

`regionsOf(shape)` (`regions.ts`), over known cells only:

- **Stair runs** (`StairRun { cells, dir }`, for #255): chains of known, non-void cells each one level
  above the last in one direction (`DIRS[dir]`: N, E, S, W), with no wall or window between, two risers
  or more, foot to head. A two-wide stair is two runs side by side. The monastery's belfry stair and the
  stairs to the gallery, the Hollow's stairs to the steps and to the watch and the high bridge's end
  are found.
- **One-wide runs** (`OneWideRun { cells, along }`, for #256): known raised cells with a drop of two
  levels or more (or the void) on both sides across `along`, joined along it within one level and no
  wall between. A pillar is in a run of each axis. The Hollow's ruins' bridge (x = 12) and high bridge
  (y = 9) are runs; the two-wide causeway is not.
- **Water bodies** (`WaterBody { cells, level }`, for #292): edge-joined water cells at one level.
- **Void regions** (`VoidRegion { cells, touchesBorder }`, for #243): edge-joined void cells; the night
  train's border void is one region on the table's edge.

### Dual-grid cases and saddles

`dualCase(shape, tx, ty, mask)` (`dual.ts`) gives a tile's `sectors` (bit k: sector k is inside the
mask), its classic `corners` case (corners clockwise from NW as bits 1, 2, 4, 8, so the saddles are 5
and 10; -1 when an unexplored corner is split across the mask) and its `join`. Masks: `'walkable'`
(not void), `'land'` (not water) and a number L, the level band `level >= L`. A tile whose ring of
sectors changes four times or more is ambiguous, and resolves (`JOIN`) by the rules on ground-only
obstacles (`groundObstacles`: levels and void, no walls or props):

- a diagonal pair joins (`in` or `out`) only if `canStep` connects it both ways; otherwise the blocker
  side joins;
- where both pairs connect (a one-level checkerboard) the higher pair (`in`, in a band) joins, so the
  riser stays continuous;
- where neither connects (two cells two levels or more above the other two, and always for walkable
  ground across void corners) the saddle is `pinch`ed at the grid corner, with no rounding: between two
  high and two low cells nothing may suggest a passage;
- land and water join by `tileHash(tx, ty)`, the same on every client;
- an ambiguous tile with an unexplored corner is pinched.

`saddleProblems(shape)` checks every saddle of every mask against `canStep`; it runs over every 2x2
pattern of levels {0, 1, 2, 3} and void, the random tables and every fixture view.

### Constants

`TOKEN_DISK` 0.43 cell (half the 0.86 u base, docs/ART.md), `INTRUSION` 0.08, `MAX_ROUND` 0.25 and
`MAX_NOISE` 0.07. A corner rounded by `MAX_ROUND` stays 0.6 cell from the centre and an edge pushed in
by `MAX_NOISE` stops at 0.43, so neither eats a token's disk.

### Dirty chunks

`dirtyChunks(prev, next)` lists the `CHUNK` x `CHUNK` (16 x 16) chunks, row-major
(`chunksAcross(grid)`), touched by a cell whose continued level, floor or known state changed, plus a
one-cell margin (a dual tile reads the cells on both sides of a chunk's edge); every chunk with no
previous shape or a new grid size. #240 rebuilds only these.

### The invariant harness

`invariants.ts` is test support. An emitter hands over an `EmitterMesh` (positions in world units,
triangle indices, the owning cell of each vertex) and `checkEmitter(shape, ground, decorations?)` names
each `Violation`:

- `disk`: a known walkable cell's ground is not flat at `floorY` everywhere within `TOKEN_DISK`;
- `intrusion`: a decoration stands above the floor within `TOKEN_DISK - INTRUSION` (it may reach 0.08
  cell into the disk, no further);
- `cliff-top`: along a step or cliff, away from its ends by `MAX_ROUND`, the ground just inside the
  higher cell is not at the higher `floorY`, or something rises above it across the edge;
- `unexplored-face`: a face that is not flat lies within `MAX_NOISE` of an edge with an unexplored cell
  on either side (the border too);
- `owner`: a vertex owned by no cell.

`referenceBoxes(shape)` is today's boxes made from the shape (each cell's top at its floor, a side face
where a known cell stands above a known neighbour or the table's edge) and passes on every fixture
scene and the GM, fogged player and spectator of every committed view; the same boxes from the levels
as sent fail with `unexplored-face`. #240, #241 and #243 add their emitters to the world specs beside
it, on the same fixtures, views and random tables.

### Picking cells (#246)

A cell is picked by an Amanatides-Woo DDA over the grid's columns, not by raycasting ground meshes:
`pickCell(grid, heightAt, origin, dir, cutLevel = Infinity)` in `world/pick.ts` (pure, server-tested
in `pick.spec.ts`). Each cell is a column, solid up to `heightAt(x, y)`, its drawn floor (the
renderer's `Ground.floorY`; void will pass `CHASM_DEPTH` with #243). The ray is clipped to the grid's
x and z, then steps column by column (`tMax`/`tDelta` per axis): in each, a ray already under the
column's top hits its `side` where it came in (a raised column's wall, picked as the raised cell,
as `TerrainLayer.pick` did), and a ray that drops to the top before leaving hits its `top`. It
returns `{ cell, point, face }`, or `{ cell: null, point }` with the ray's point on the y = 0 plane
(null if it never meets it). Beyond the grid the ground is that plane: a ray coming into the grid
under it met it outside, so it picks nothing. A cut (#281) lowers every column above `cutLevel` to
it. The cost is one step per cell crossed, on every tier and backend, with no GPU work.

`Picker` (`picking.ts`) keeps the order: tokens, walls and doors, light fixtures and handles, props,
then the cell, whose point gives the corner, the edge and `edgeDistance` as before, so a click off
the grid has no cell but still snaps corners and edges along the border. The things are raycast on
`PICK_LAYER` (1) only: `pickable(mesh)` enables it (layer 0 stays, so they still draw) on every
token base and figure, wall instance, door panel, prop mesh, fixture mesh and GM light handle, and
the raycaster tests only that layer, so ground, cliffs, the backdrop, dice and effects are never
tested. `tablePlane` is gone, and `TerrainLayer.pick` is no longer called (both go with the layer at
the milestone's close).

`pick.spec.ts` checks the DDA against the picker it replaced, written there in plain maths (a box
per raised cell from y = 0 to its floor, and the y = 0 plane, the nearer winning, ties to the box):
1,000 seeded rays from each named pose of every fixture (overshooting the frame, so rays beyond the
grid too) and, where there is raised ground, 1,000 more at random points of raised columns, on every
scene and every committed GM view as sent, and on every fogged player's view over the continued
levels (`worldShape`'s `levels`, the surface #240 draws): 508,000 rays, 104,018 of them landing on
raised ground (29,449 on a side) and 169,651 on no cell, every one the same cell and face. `renderer.svelte.spec.ts` clicks the monastery's gallery floor at level
5, the nave beside it and the gallery's south face, and beyond the grid's edge (no cell, a border
corner), and checks every object a raycast tested is on the pick layer.

A fogged player's picks follow the levels the renderer draws: as sent while `TerrainLayer` draws
them, the continued levels once #240's layer does (the renderer's `ground` then comes from
`worldShape`). Neither reads anything of an unexplored cell that the picture doesn't show.

### Dice and previews on the ground (#247)

Dice land on the floor where they fall. `diceSurface(grid, ground, floor)` (`dice3d.ts`) is the
surface they land on: a point's cell's `Ground.floorY`, the drawn floors (the same `ground` the picks
use, so the continued levels once #240's layer draws them), and null on a void cell or off the
grid. `throwFromView` centres the throw on the cell the camera looks at, or, where that is void or
past the grid, on the nearest cell that holds dice (a scan of the cells, once per throw), and throws
from the viewer's side above the walls on that floor; it hands `DiceLayer.throw` the centre, the
start and the surface (`DiceAim`). Each die keeps its seeded spot on the golden-angle spiral; a spot
the surface refuses is pulled in along the spiral's radius a quarter cell at a time to the first
that holds (`landing`: no random draws, so every client's throw is still the same), and the die
rests at the highest surface under its centre and four points half a die out (so it never sinks
into the face of raised ground beside it) plus its inradius. The arc, `landingQuaternion` and the
wall-clock timing are unchanged, so the face a player reads is too, and reduced motion still lands
them at once. A die may pass through a wall or a cliff on the way down: the landing is what counts.
`dice3d.spec.ts` lands every face of every die on raised ground reading the rolled face, pulls 40
throws of 12 dice beside a void column and the table's edge in, and aims past the grid at the
nearest cell; `renderer.svelte.spec.ts` throws a d20 at the monastery's gallery (level 5) and finds
it drawn there, resting on the gallery's floor, not the nave's.

Editor previews stand on the ground they mark. `previewPlacements(items, grid, ground)`
(`previews.ts`, pure, `previews.spec.ts`) turns preview items into instances by bucket: an area is
a tile per patch of cells at one floor (`patches`: each row's runs of equal floors, joined to the
row above when the span and floor match, so a flat area is one tile however large and one across
levels steps with the ground), a corner sits on the highest floor of the cells round it, a segment
is a box per run of unit edges with the same floors beside them, from the lower floor to the
preview's height above the higher (as a wall stands), its ends reaching past its corners as before,
and the beacon's column and ring stand on their cell's floor. `PreviewLayer` draws them from a pool
made with the layer: one `InstancedMesh` per bucket (the box in its five tones, the corner, the
beacon's column and ring), `PREVIEW_CAPACITY` (1,024) instances each, always in the overlay scene
and drawing nothing at a count of 0, so the warm-up compiles them and a hover only rewrites
instance matrices and counts. They never grow: r186 gives every new `InstancedMesh` a vertex stage
of its own, so a mesh made mid-game would compile; patches keep the counts far below the capacity,
and past it the rest is left out. program-count's runtime sweep sets every tone, a whole-table
area, walls in every tone, the beacon and none, compiling nothing. The hover highlight sits at its
cell's floor, as before. Previews are the GM's but for the tutorial's beacon, and over an unexplored
cell they stand on the height the viewer's ground gives it, so they show nothing the picture
doesn't.

### Costs

In Node on the i9-13900HX (`npx tsx server/perf/world-shape.ts`, docs/PERFORMANCE.md): classifying a
fogged 64x64 table with 64 walls takes 0.58 ms, a 100x100 one 1.4 ms. A cell pick by the DDA takes about 1 µs on
the Hollow (48x36), where raycasting its raised boxes and the plane took 88 µs (docs/PERFORMANCE.md).

### The ground in chunks (#240)

The ground inside the grid is no longer the play plane and `TerrainLayer`'s boxes: `WorldLayer`
(`world-layer.ts`) draws the world's shape as dual-grid meshes, one 16x16-cell chunk at a time, built by
the pure `chunkGround(shape, chunk)` (`world/ground-mesh.ts`).

- **Quarters.** A cell is four quarters, each the corner of the render tile at one of its grid corners.
  A quarter is flat at its sectors' height: its floor, or one `STEP_HEIGHT` below in the void, where a
  flat plane (the void's palette, near black) closes the hole until #243. An unexplored cell whose two
  known neighbours differ is split along its diagonal, as the continued tiles say.
- **Corners.** A tile whose four cells are known, on the table and not void is rounded: within `r` of
  the grid corner each quarter has a sliver beyond a quarter circle (`MAX_ROUND`, `ARC_SEGMENTS` 4), a
  straight chamfer of `BEVEL` 0.05 where any of the four is a man-made floor (stone, wood). The sliver's
  height comes from the level bands: a convex corner is cut down to its neighbours, a concave one filled
  up; across a saddle only the pair `dualCase` joins is (a filled low quarter, or cut high ones), and a
  pinched saddle stays square. A sliver lies 0.6 cell from any cell's centre, so token disks stay flat.
  Tiles with an unexplored, off-table or void corner stay square.
- **Sides** are sheer until #241 makes them cliffs and risers: wherever two heights meet there is one
  vertical face, made by the higher piece's cell (normal toward the lower), so each chunk holds only its
  own cells' triangles (the owners say so, and a spec checks it). A known cell on the table's border gets
  a face down (or, round the void, up) to the ring at 0. Between two unexplored cells, or an unexplored
  cell and the border, nothing may stand on the edge (the harness's `unexplored-face`), so a **skirt**
  slants from the other side's height on the edge to the cell's top `SKIRT` (0.1 cell) in under it, its
  ends closed (across the cell's middle line, and at the grid corner on a slant): no gap shows the sky,
  and no face lies along the edge.
- **Checked** in the server project: `checkEmitter` on every fixture scene and every GM, player and
  spectator view, and on 120 seeded random tables fogged and not, plus rays slanting down from above
  each of them that must hit the ground before falling below its lowest point (no cracks), and the
  rounding, chamfer, saddle, void and chunk-ownership cases (`ground-mesh.spec.ts`, `fixtures.spec.ts`).

**The layer.** Per chunk a top mesh (receives shadows) and a side mesh (casts and receives; the shadow
pass draws back faces), each its own `BufferGeometry` (position, normal, 32-bit indices) with its own
bounding sphere for culling, `raycast` a no-op. Both are the **terrain kind** (non-instanced, anti-tiled
on medium and up): tops wear the environment's `surface` look (so plain cells look as the play plane
did), sides its `ground` look (as the boxes did); the floors, their painted surfaces and the paleness of
height come from the ground map as before. One graph, so nothing compiles: floors, levels, the explored
mask and environments change data and uniforms only, and the warm-up compiles both through stand-ins
(`gallery`), a casting side among them, since a flat table has none until the GM raises ground (the
program-count sweep raises, stairs and flattens the test world's ground). Sides moving onto the rock
kind is #241's, with their cliffs.

**Its inputs and rebuilds.** `WorldLayer.update(grid, levels, floor, fog, mode)` (from the renderer's
`setGrid`, `setTerrain`, `setFloor` and `setFog`) makes the shape from what the viewer was sent (`known`
from `knownOf`, so the GM and fog-off tables have none), skipped when nothing it reads changed (a
player's fog changes `explored` only as they explore), and rebuilds the chunks `dirtyChunks` names
against the shape last drawn, each timed as `world-chunk`; `stats().world` has the chunks on the table
and how many the last update rebuilt. The renderer's `Ground` (tokens, props, walls, lights, previews,
dice, shots) is the shape's, from the continued levels: identical on known cells, flush with the
ground drawn elsewhere. The ground map is fed the continued maps too. Walls take the explored mask
(`wallSpans` with `known`), so none shows a drop toward unexplored ground, and are synced again when it
changes. The renderer's own `levels` (the camera's fit, the light's) stay as sent.

**Its own chunk.** The builders are a lazy chunk, `world` (`world/build.ts`, its own budget in
`scripts/check-bundle.mjs`): the shape (`worldShape`, `knownOf`, `dirtyChunks`), the dual cases, the
regions and the ground's emitter, and every builder to come (cliffs, the void and beyond, splats), each
exported from `build.ts` and imported elsewhere in the renderer only as a type. `WorldLayer` takes the
module; `createTabletop` awaits `loadWorld()` beside the node renderer, so it is there before the table's
first frame (inside the loading cover's wait), and `loadRenderer` (load.ts) starts it as soon as the
renderer chunk arrives, so a prefetched table never waits on it. Its materials are the terrain kind's,
warmed as before. What a frame needs at once stays in the renderer: the DDA's picks (`world/pick.ts`) and
the wall spans (`world/wall-spans.ts`, which the walls draw from).

**The fallback.** The `terrain` layer (`LAYERS` in `quality.ts`, on): `?off=terrain` draws the old boxes
and the play plane again and builds no chunk; back on, every chunk is built. `TerrainLayer` stays in the
layer, hidden, synced from the continued ground. Both go at the milestone's close. Picking (#246) needs
neither: the DDA walks the renderer's `Ground`, which is the shape's, so a fogged player's picks land on
the continued ground the chunks draw.

**Deviations from #240.** Border tiles do not overhang the grid by half a cell: the skirt meets the play
area at the grid's edge at y = 0 (`skirtMesh`, #244), so an overhang would z-fight with it; they stop at the
edge, with the boxes' faces down to 0. There is no owner-cell vertex attribute on the GPU: the terrain
kind reads each fragment's cell from the ground map by its position, as the boxes did (a rounded sliver
takes the colour of the cell it lies in), and an attribute only the chunks carry would be a program of
their own; the owners stay on the CPU for the harness. Sides are the terrain kind, not the rock kind,
until #241.

**Specs.** `world-layer.svelte.spec.ts` (`RENDER_SPECS`, its own `world` job in rendering.yml, about a
minute) mounts the Hollow for the GM and checks the nine chunks are drawn, the ground at every cell's
floor height (rays straight down onto the chunk meshes), the rebuild counts per edit (a cell inside the
middle chunk 1, on its corner 4, every floor over its inside 1 each, a 16x16 area with its margin 9, a
raise inside it 1), no program or pipeline from any of it, a fogged player's explored disc moving 35
steps east rebuilding 1 to 4 chunks a step, and `?off=terrain`.

### Beyond the grid (#244)

The play area runs on into a landscape that belongs to its environment and fades into the sky:
a skirt of land out to the horizon and a ring or two of far silhouettes. Procedural only (no art, so
nothing to credit), textured from the environment's own looks (and so the surface library's walls).

- **Its inputs are scene-level.** `world/beyond.ts` (pure, in the lazy `world` chunk, exported from
  `world/build.ts`) builds everything from `BeyondInput`: the environment's id, `WorldLook.backdrop`
  (kind and level) and the grid's size as a `Span` (`spanOf(worldExtents(grid))`: half extents, cell
  size, frame, the camera's reach, the horizon and the haze's range; not the table's top, so raised ground a viewer
  was or wasn't sent changes nothing). No cell is read, so the GM, players and spectators get the
  same backdrop and it says nothing about unexplored ground. `beyond.spec.ts` builds it from every
  fixture view as the GM, a player and a spectator and finds it byte for byte the same, checks the
  input has only those three keys, and that the same input always builds the same arrays.
- **The skirt** (`skirtMesh`) is an annulus whose hole is exactly the grid's rectangle (its corners
  are vertices), so it meets the chunks' border faces at y = 0 with no gap or overlap. Its first loops
  are the rectangle offset outward (the diagonal at the corners), so the lip runs along the border:
  from 0 at the edge down to half a level below `backdrop.level` within `LIP_CELLS` (0.35 cell), a
  bevelled kerb rather than a cliff. The rest run out to a circle at the horizon, closer together near
  the grid (128 directions and 12 loops; 32 and 6 on low). Heights are `beyondHeightAt(beyond, x, z)`,
  exported for the camera (`CameraRig.keepAbove`, and #280's rig): the land rises with seeded noise
  (`recipe.rise` frames at most) only beyond the camera's reach, so wherever the camera may stand the
  skirt is at or below max(0, the backdrop's level) (a spec sweeps every kind, level, environment and
  grid). It wears the environment's ground look, darker (0.62) with broad macro patches.
- **Silhouettes** (`ridgeMesh`) are rings of ridge round the grid, their foot sunk a step into the
  skirt where the haze is partway (`distance` 0 at the fog's near, 1 at its far: by view depth, so
  nearer than the camera's reach, or the haze would take them whole), their crest from periodic value
  noise by style: `hills`, `forest` (a ragged canopy line), `mountains` (ridged peaks), `mesas` (flat
  tops, sheer sides) and `cave` (rough walls rising into the dark with no ceiling, inside #221's
  shell). Every face looks toward the grid (the spec checks it), so from beyond a ridge, where the
  camera may stand, it is culled and never hides the map. The village's far ridge carries a landmark:
  a peak at `MOUNTAIN.azimuth`, up the mountain path the `firstBell` shot looks along (a spec checks
  the bearing against Bellweather's `MOUNTAIN_PATH` cell), with the monastery's hall and bell tower on
  top as two flat silhouettes facing the grid. 240 columns a ridge, 72 on low.
- **Recipes** (`world/recipes.ts`, keyed by the environment's id; not in the manifest): the village
  (forest, and mountains with the monastery), stone halls (hills, and a mountainside in the walls'
  stone), the cavern and the living cave (cave walls, dark navy and dark crimson), the railcar and
  the ghost town (mesas, and far desert ridges); any other environment (or none) gets low hills.
- **Backdrop kinds.** null keeps the environment's recipe; `none` (no silhouettes, flat land),
  `plains`, `hills`, `forest`, `mountains` and `cavern` replace it with their own. `beyondSample(kind)`
  says what lies beyond the border, for the border tiles (#240) and the chasms (#243): `land`, `water`
  for `sea` (the skirt flat in a dark glossy water look, #120 gives it swell) and `void` for `abyss`
  (past the lip a gap, no wall, then a plane 0.6 frame below that runs on under the grid: the haze
  is no longer held off below `PLAY_FOG_DEPTH`, 1 m under the ground (`beyondPlay`'s depth term,
  mirrored in `skyFogNode`), so the drop fills with mist instead of standing on a black pillar;
  the void's own floors a step down are untouched: the Hollow) and
  `prairie-scroll` (the moving ground, two levels below and still until #243 and #344 move it: the
  train); those three keep the environment's silhouettes.
- **Rules.** Never picked (no-op raycast), casts no shadow (received, so it shares the old ring's
  program), drawn off the grid only, where `worldModify` is neutral, so unexplored cells stay black
  and nothing of the play area shows through it. Every mesh is the surface kind with the anti-tiled
  variant (twinned with the tier like the other layers): kinds, levels and environments change
  geometry, params and slots only, so nothing compiles (`beyond.svelte.spec.ts`; the program-count
  sweep's sky part steps through every kind). Rebuilt only when the grid's size, the environment, the
  backdrop or the tier's row (low or not) changes, never per frame; nothing moves, so reduced motion
  has nothing to still and there are no idle frames.
- **Draws:** the skirt and one or two silhouettes (three at most), about 4k triangles for the skirt
  and 1.4k a ridge on medium and up.
- **Specs.** `world/beyond.spec.ts` (server project: the skirt meets the grid and covers the disc,
  every vertex on `beyondHeightAt`, the camera never under it, the lip and the drops, the kinds'
  samples and recipes, silhouettes round the play area and inside the horizon facing in, the landmark,
  determinism and scene-level inputs); `beyond.svelte.spec.ts` (`RENDER_SPECS`, its own `beyond` job in
  rendering.yml): the village at dusk as a fogged player, its three meshes, the mountain on screen and
  not black, changed by `none`, and every kind and environment without a new program or pipeline.

**Deviations from #244.** The recipes are code keyed by environment id, not a `beyond` block in the
manifest: the landscape is procedural and needs no files, so parsing and the pipeline stay as they are
(the owner's decision: no new art). The forest is a ragged ridge strip on every tier, not instanced
tree cards: cards would be another variant (instanced) to warm and #121's vegetation brings real trees.
The landmark is two flat procedural silhouettes, not a model. The silhouettes stand inside the camera's reach (in the haze's range), not beyond it, since the haze is by view depth and would hide them whole there; facing only the grid keeps them out of the way. The abyss needed the fog's play-area cap to lift with depth (`PLAY_FOG_DEPTH`): a change to the scene's fog node, so every program once, and to the picture only more than 1 m below the ground. The camera keeps above the skirt through
`keepAbove(…, beyondHeightAt)` already; #280 owns the rig. Goldens and look metrics are for the
milestone's close (G2).

## Modules

`src/lib/tabletop/renderer.ts` creates the scene and implements the `Tabletop` interface as short
delegations; every module in the folder stays under 500 lines (`modules.spec.ts` checks it).

| Module                                | What it holds                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                            | The `Tabletop` interface and its types (re-exported by `renderer.ts`), `TIMED`, `RESHADOWS`                                      |
| `camera.ts`                           | `CameraRig`: orbit controls, `viewPose`, view changes, shots, `setPose`                                                          |
| `picking.ts`                          | `Picker` (pointer to cell by the DDA, corner, edge; token, wall, light, prop on `PICK_LAYER`), `pickKey`, clicks                 |
| `loop.ts`                             | `createNodeRenderer`, the frame hooks r186's own loop ran, live reduced motion                                                   |
| `scheduler.ts`                        | The render scheduler: IDLE, AMBIENT, ACTIVE and CONVERGE, the frame-rate cap, pausing when unseen                                |
| `scene-lights.ts`                     | The hemisphere and the key light; fitting the shadow box, the fog and the camera to the table                                    |
| `atmosphere.ts`                       | The scene's fog and environment nodes and background (`createScene`), `AtmosphereLayer`: the hour's light, tween and shadow rule |
| `atmosphere-curve.ts`, `sky-maths.ts` | The pure curve (`atmosphereAt`), the sun's and moon's paths, the stars, `CaptureThrottle`                                        |
| `sky.ts`                              | `SkyLayer`: the dome, moon, stars and clouds, and the capture into `SKY_CUBE`/`SKY_CUBE_LOW`                                     |
| `sky-light.ts`                        | `SkyLight`, `SkyHemisphere`: the key light and hemisphere masked by sky visibility, `registerSkyLights`                          |
| `flash.ts`                            | The flash's envelope (`flashAt`), `flashPolicy` (Reduce flashing), `countFlashes`                                                |
| `world-ground.ts`, `landscape.ts`     | The play and world extents (`worldExtents`, `spanOf`); `WorldGround`, the play plane and what lies beyond (#244)                 |
| `previews.ts`                         | Editor previews from a pool of instanced meshes on the ground (`previewPlacements`, #247), the beacon and the highlighted cell   |
| `perf.ts`                             | Frame and update timings, renderer stats, `benchmark`, and the timing wrapper                                                    |
| `quality.ts`                          | Quality tiers: `Caps`, the settings table, the starting tier, `?tier=`/`?off=`, the pixel cap, refinement, `thirdfold:graphics`  |
| `capabilities.ts`                     | `probeCapabilities`, and `QualityControl`: canvas sizing within the tier's megapixels, the sun's shadow size, refinement         |
| `post.ts`                             | `Post`: the RenderPipeline per tier (prepass, scene pass, output), its uniforms, `gate`, the warm-up's targets                   |
| `focus.ts`                            | `Focus`: depth of field and tilt-shift over the pipeline's sharp image, aimed each frame; `FrameView`                            |
| `passes.ts`                           | The pipeline's passes (prepass, overlay, scene), `Stages`, `stagesFor`, the tone mappings                                        |
| `overlay.ts`                          | `OverlayLayer`: the overlay's scene, `follow` groups for labels and floats, grid lines masked by floor, fog and darkness         |
| `materials/`                          | The shader kinds: `createMaterial`, slots and their blanks, the hooks for later looks (#169), the kinds' warm-up gallery (#180)  |
| `cell-maps.ts`                        | `CellMaps`: the `visibility` and `ground` maps and `cellUniforms` that `worldModify` reads (#171), the reveal fades (#174)       |
| `fog-soft.ts`                         | Soft fog's pure halves: edges, `RevealFades`, the cloud's shape (#174)                                                           |
| `grid-light-layer.ts`                 | `GridLighting`: the point lights from what the viewer was sent, uploads, `carry`; `grid-lights.ts` its data (#228)               |
| `fog-cloud.ts`                        | `FogCloudLayer`: the fog cloud over a player's hidden cells, with its layer on (#174)                                            |
| `warmup.ts`                           | `warmUp`, `Gallery` (the layers' stand-ins, drawn once after a warm-up)                                                          |
| `lobby.ts`                            | `warmLobby`: the renderer made and warmed before any table, for the first table to adopt (#180)                                  |
| `shape.ts`                            | The pipeline's shape before and after the device is known (`initialShape`, `startingSettings`)                                   |
| `world/`                              | The world's shape (M69); `build.ts` is the builders' lazy chunk (`world`), `pick.ts` and `wall-spans.ts` stay in the renderer    |
| `world-layer.ts`                      | `WorldLayer`: the ground in 16x16-cell chunks (#240), the shape it is built from, the old boxes behind `?off=terrain`            |
| layer modules                         | `tokens.ts`, `walls.ts`, `props.ts`, `terrain.ts`, `lighting.ts`, `effects.ts`, `dice3d.ts`; `fog.ts` is `FogMode`               |

## Quality tiers

`src/lib/tabletop/quality.ts` (pure, tested in `quality.spec.ts`) turns what a device offers into a
starting tier, and each tier into one row of settings every effect reads (#147).
`probeCapabilities` in `capabilities.ts` fills `Caps` after the renderer starts: the backend
(WebGPU, compat WebGPU or WebGL2), whether it is a software rasteriser, the GPU's vendor and
architecture, the largest texture, timestamp queries, phone or not, the shell (browser, Tauri,
Capacitor), pixel ratio, screen size, and where browsers give them, memory and CPU class.

**Presets and options** (owner, 27 September 2026): a tier is a preset. The Graphics menu picks one
(Auto, Low, Medium, High, Ultra), and under Advanced the viewer sets options apart from it:
resolution, antialiasing, ambient occlusion, bloom, vignette, chromatic aberration, film grain,
colour grading, Miniature (depth of field, #165), shadows and frame rate (`OPTIONS`, only what the
renderer applies today). **Clarity** (#164) turns the lens effects (vignette, aberration, grain) and
Miniature off and leaves AO, bloom and the grade, which are light, not lens: the documented way to
an unprocessed, legible image. Reduced motion keeps grain and Miniature off whatever is stored (the
menu shows it disabled, the stored choice kept), and a `?off=` layer wins over the menu. Changing an
option keeps it in `GraphicsPrefs.overrides`, which `withOverrides` lays over the preset's row
(never MSAA on compat WebGPU); setting it back to the preset's value forgets it, and choosing a
preset clears them all. MSAA and the prepass (`needsPrepass`: drawn for MSAA or AO) make the
pipeline's shape, and a change of shape builds a new renderer, as a change of MSAA always did:
rebuilding passes on the same renderer left their old shaders behind.

**The starting tier,** with no input (`qualityFor`): software rasterisers and compat WebGPU low;
phones low with 4 GB or less, else medium; under 4 GB or the lowest CPU class low; integrated
(Intel) GPUs medium; everything else high. Ultra is only ever chosen by hand. Ceilings: WebGL2 at
high, compat WebGPU at low, Capacitor and Tauri on Linux at medium (#155 fixes them with
measurements). In CI (SwiftShader) the tier is low. `?tier=` overrides everything, then the
viewer's choice in `thirdfold:graphics`, then the tier refinement measured on this device.

| Setting          | Low  | Medium | High | Ultra     | Applied                     |
| ---------------- | ---- | ------ | ---- | --------- | --------------------------- |
| Megapixels       | 1.0  | 2.1    | 3.7  | 3.7       | now: the pixel cap          |
| Sun shadow map   | 1024 | 2048   | 2048 | 4096      | now                         |
| MSAA             | off  | 4×     | 4×   | 4×        | with the rebuild (#150)     |
| AO               | off  | on     | on   | on        | #159                        |
| Point lights     | 8    | 16     | 32   | clustered | #228, #357                  |
| Shadowed torches | 0    | 2      | 4    | 4         | #230                        |
| Particles        | 250  | 1000   | 4000 | 8000      | #122                        |
| Vegetation       | 25%  | 50%    | 100% | 100%      | #121                        |
| Frame rate cap   | 30   | 60     | 60   | 60        | the render scheduler (#148) |
| Flicker          | 20   | 30     | 30   | 30        | the render scheduler (#148) |
| Sky              | flat | dome   | dome | dome      | #225: 1 capture, 16 px      |
| Sky captures     | once | 5 s    | 2 s  | 2 s       | #216                        |
| Converge frames  | 0    | 4      | 8    | 16        | TRAA (#110)                 |

Layers (`sky`, `ao`, `bloom`, `lens`, `grade`, `grass`, `water`, `vfx`, `weather`, `xray`, `dof`,
`fogcloud`) are off until each passes its milestone's gates (on: `sky` since M67, `ao`, `bloom`,
`lens`, `grade`, `dof`; `fogcloud` stays off by the owner's call, volumetric fog being M75); `?off=sky,grass` turns layers off, for A/B tests and emergencies.
Neither `?tier=` nor `?off=` is saved.

**The Graphics menu** (`src/lib/ui/GraphicsControls.svelte`, #154), beside Sound in the room's
header, and at the top of the side sheet on phones: Auto (showing what it picked), Low, Medium, High,
Ultra (disabled, saying why, off core WebGPU); Compatibility (WebGL2), which applies on reload; and a
power saver that stops ambient animation. It keeps its choice in `thirdfold:graphics` and never
reaches the room. `RoomView` passes the choice to `Tabletop.svelte`, which applies it at once (a
tier that turns MSAA on or off rebuilds the tabletop, a second or two) and reports the tier in
effect back for the menu.

**The pixel cap:** the drawing buffer's pixel ratio is `min(dpr, sqrt(megapixels × 10⁶ / css
pixels))` (`pixelRatioFor`), worked out on every resize and when the window moves to a screen with
another pixel ratio: 4K at DPR 2 on medium draws about 2.1 MP, not 33. Tests fix the ratio at 1.

**Refinement:** on an automatic tier, the first 120 frames drawn after it is set are timed
(main-thread ms; GPU ms only exist under `?perf`); if their median is over the tier's frame budget
(`1000 / fps cap`), the tier steps down once and `thirdfold:graphics` remembers it (`measured`) for
this device. It never steps up. Changing the tier recompiles nothing: the shadow map's size is a
uniform to the node renderer, which a client test checks by the program count.

Without a GPU at all (no WebGL2, no WebGPU adapter), the table shows "This device can't show 3D
(WebGL2 unavailable)"; under a software rasteriser it draws, at low, with a dismissable notice.

### Recovering a lost device (#150)

A lost WebGL context or WebGPU device (memory pressure, a backgrounded app, a driver reset) used to
freeze the canvas. Now `createNodeRenderer` replaces three's `onDeviceLost` (which only logs an
error and stops drawing) with one that stops drawing and calls `TabletopOptions.onLost`.
`Tabletop.svelte` then makes the tabletop again: a new `generation` keys a fresh `<canvas>` (a lost
context stays lost on its canvas, and a canvas keeps its kind), `createTabletop` runs again, and
every prop effect replays the table into it from what the component already holds; one-shot cues,
dice and floats are de-duplicated by their sequence numbers and don't replay. The camera goes back
to where it was (`cameraPose()`, then `setPose` after the replay). While the page is hidden it
waits for `visibilitychange`; "Restoring the table…" covers the canvas until the new tabletop has
drawn.

A loss drops one tier for the session (`tierAfterLoss` in `quality.ts`, never saved: a loss is not a
measurement); a second loss within five minutes drops to low with a notice; three within a minute
stop, with the error panel instead of a loop. The same rebuild applies a tier whose MSAA differs
from the renderer's (MSAA is fixed at construction): `applyQuality` rebuilds with the tier's
`antialias`, which the component also picks before the first renderer when the tier is already known
(`?tier=`, a chosen or measured tier).

`recovery.svelte.spec.ts` checks the same table comes back on a new canvas, a tier lower, the camera
where it was, with no more geometries, textures or programs than before and no console error. On
WebGL2 it loses the context (`WEBGL_lose_context`). On WebGPU (`npm run test:webgpu`) it crashes the
GPU process through the DevTools protocol (the `crashGpu` browser command in `vite.config.ts`), a real
device loss like a driver reset: `device.destroy()` never reaches three's handler, whose reason is
then `destroyed`. The crash takes WebGPU away from the whole browser for a moment, so that project runs
its files one at a time and the test waits for WebGPU to come back before it ends.

**On devices (the device matrix, #361):** with a table open, send the app to the background for a
minute and bring it back, on the Capacitor Android app and a WKWebView shell (iOS or macOS): the table
draws again (restored if it was lost, "Restoring the table…" at most a few seconds), never a frozen
canvas; chat, dice and panels keep working meanwhile.

### WebGPU golden images (#151)

The renderer's smoke tests (and, by hand, the goldens) also run through the WebGPU backend,
locally, in the `client-webgpu` Vitest project, which exists only with `THIRDFOLD_WEBGPU=1`, so
`npm test` and CI never see it:

```bash
npm run test:webgpu                            # the smoke, recovery and post tests
npm run test:golden:webgpu                     # every golden image, before a rendering PR only
npm run test:golden:webgpu -- --update         # re-record on purpose
```

It draws on the real GPU (the RTX 4060 Laptop, the reference machine, through Vulkan), headless.
Chrome's WebGPU picks its own SwiftShader over Mesa's lavapipe even with lavapipe the only Vulkan
driver, and SwiftShader's WebGPU is too slow and unreliable to test on, so the references
(`*-webgpu-chromium-linux.png`, beside the WebGL2 ones) belong to that GPU and driver. The specs read
the project's backend with `inject('backend')` (`BACKEND` in `testing.ts`); `mountFixture` pins the
tier to medium and fails if WebGPU silently fell back to WebGL2. Tests that read pixels back are
WebGL2-only and skip on WebGPU, naming why.

Its first runs caught a bug the WebGL2 goldens never showed: a tabletop torn down while the next
started (every test, and #150's rebuild) could leave the new one's raised ground missing or black.
`TableLayer.dispose` disposed the shared blank texture every dressed material falls back to, which
destroys it in every renderer; the kinds' slot blanks (`slotDefault`) are never disposed either. And two renderers disposing
and starting at once still broke each other, so `dispose()` resolves once the renderer is gone,
and the component and the test helper make the next tabletop only after that.

## Render scheduler

`src/lib/tabletop/scheduler.ts` decides when a frame is drawn (#148). The policy (`modeFor`,
`frameInterval`, `frameDue`) is pure and tested in `scheduler.spec.ts`; `RenderScheduler` drives it
with `requestAnimationFrame` (r186's internal loop stays stopped, per the spike: each drawn frame
resets `renderer.info` and advances the node frame itself).

| Mode     | When                                                            | Frames                                                       |
| -------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| IDLE     | nothing moves or animates, or the table can't be seen           | none until something changes                                 |
| ACTIVE   | tokens, doors, dice, props, cue effects, shots, the camera move | every screen frame, at most the tier's `fpsCap` (60, low 30) |
| AMBIENT  | flames flicker or mist drifts, nothing else                     | every 80 ms (12.5 fps), 100 ms after a minute without input  |
| CONVERGE | movement just ended                                             | the tier's `convergeFrames` (0 until TRAA, #163), then IDLE  |

AMBIENT is off under reduced motion (followed live, no reload), power saver (the viewer's setting),
a hidden tab (`visibilitychange`) or a canvas scrolled out of view (`IntersectionObserver`);
pointer, key and wheel input reset the minute. A screen faster than the cap (144 Hz) has its early
callbacks skipped, so a camera drag draws at most 60 frames a second. A warm-up (#149) holds frames
while shaders compile. `stats().mode` shows the mode in the `?perf` overlay.

**The layer contract:** each frame the renderer asks the layers what they did (their `tick`
returns) and reports it to the scheduler as a `FrameReport`: anything still moving (`active`), or
animating slowly (`ambient`: `LightingLayer.animating`, flicker in the shader, #231; the fog cloud). One-off changes call
`request()`. Every animation runs on the injected clock (#128), from a start time and a duration,
never on frame counts, so a throttled browser (Energy Saver, Low Power Mode) draws fewer frames of
the same motion: token moves and floats, door swings, dice, props, cues and shots. Only layers that
move shadow casters (tokens, doors, dice, props, the bell's swing) redraw the sun's shadows; dust, a
flash, a shudder and ambient animation never do, and the perf gate fails if orbiting the camera
draws a shadow pass.

## RenderPipeline

Milestone 63 draws every frame through one `THREE.RenderPipeline`, built in `post.ts` (#156). Its
passes, in order:

| Pass      | Tiers      | Draws                                    | Attachments                                                                      |
| --------- | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| `scene`   | all        | Everything, with the tier's MSAA samples | `output`: colour, half-float; `emissive` and `hidden`, 8-bit, blended; depth     |
| `prepass` | medium, up | Opaque only, no MSAA                     | `output`: view normals, 8-bit (`packNormalToRGB`); depth                         |
| `overlay` | all        | The overlay's scene (`overlay.ts`)       | `output`: premultiplied, half-float; the prepass's depth (low: the scene pass's) |
| output    | all        | A full-screen quad                       | `renderOutput`: exposure, the tone mapper (`TONE_MAPPING`), sRGB; the overlay    |

- **Tone mapping happens once, at the end.** Inside the pipeline every pass draws linear with no
  tone mapping, so a material's `toneMapped: false` no longer means anything; the mist is tone
  mapped with the rest (black stays black). Exposure is
  `uniforms.exposure`; `renderer.toneMappingExposure` stays 1 and `renderer.toneMapping` never
  changes while drawing, since `RenderPipeline` rebuilds when it does.
- **The overlay** (#157) is everything that shows game state rather than scenery: token labels
  and floats, the selection ring, the turn marker, highlights, editor previews, the beacon and the
  grid lines. It is its own scene (no background, so its pass clears to transparent), drawn by its
  own pass, and laid over the finished image: straightened, encoded to sRGB without tone mapping
  and mixed by its alpha, as the classic renderer blended it. So nothing the pipeline does to the
  world (AO, bloom, grading, depth of field, TRAA) touches it, and its colours are the ones on
  screen: the grid lines are back at 0.35 and label plates at 0.78 (#153 had halved them for
  blending before tone mapping). It is depth-tested against the world, so walls and raised ground
  still hide labels and rings: the overlay pass keeps the depth texture of a pass without MSAA
  (the prepass, or on low the scene pass) and does not clear it, and has that pass drawn first
  (`NodeFrame.updateBeforeNode`, once a frame however often asked). Labels and floats ride in
  `follow` groups that copy their mini's world transform and visibility just before the overlay
  draws. Grid lines fade by the cell maps (#173): `worldShade` (the fog and the dark as every
  material has them) times one minus the cell's floor cover (`floorPalette`, from `groundFlat`, the
  ground texel without a normal): never over an unexplored cell, dimmer at night, none over the void.
  - **The grid shows only when wanted** (#167): hidden at rest (the tiles' seams are the grid),
    shown while the GM's Build panel is open, while placing a token or an enemy, and while a hover
    highlight aims a move, or always with the Graphics menu's Always show grid (`alwaysGrid` in
    `thirdfold:graphics`). `Tabletop.setGridShown` only sets the lines' `visible`: one draw call
    fewer at rest, nothing compiled.
- **Each hour has its own hues** (#167, since #218 from the atmosphere curve): the sky preset gives
  the hemisphere a sky and a ground colour through the day (moon-blue over deep blue at night, peach
  over slate at dusk, day's warm pair). Only colours change, so a change of hour compiles nothing. The dark itself is `worldModify`'s, from `lightLevels` (#173 deleted the
  darkness overlay and its tint).
- **The prepass** draws opaque objects with no MSAA: the overlay's depth, normals for AO (#159)
  and depth of field (#165), and with TRAA each pixel's velocity (half-float).
- **Only a change of stages rebuilds.** `Post.set` compares the prepass, the samples, the
  antialiasing, the AO's kind and the tone mapper; in play a change of the first four builds a new renderer
  (`Tabletop.svelte`), since rebuilding passes on the same one left their old shaders behind, and
  a tone mapper only recomposes the output stage. Every effect's knob is a uniform, and `Post.gate` stops an effect's passes at strength
  0 (`updateBeforeType` NONE), so toggling one never recompiles. Each gated pass still draws its
  first two frames (the AO's materials are set up while the scene pass builds, after the AO drew on
  the first), so an effect stored off compiles with the pipeline, not when first turned on; a
  post spec sweeps every switch on every tier against `info.memory.programs` and the pipeline
  cache.
- **Bloom** (#160) glows from the scene pass's emissive attachment plus the exposed HDR colour
  above 1 with a soft knee of 0.5 (`Post.bloomInput`, Unity's curve on the brightest channel), so
  flames and what they light hot bloom and sunlit grass and plaster, below 1, do not. Three's
  `BloomNode` blurs it (its own threshold replaced by the identity, `highPassFn`) over 5 mips from
  half resolution (a quarter on low), at strength 0.3 and radius 0.2, and the glow is added to the
  exposed image before tone mapping; about 0.2 ms at 1080p on the RTX 4060, within the noise. Lit flames are at `emissiveIntensity` 4 so their cores exceed
  1. `uniforms.bloomStrength` (0 with the Bloom option or `?off=bloom` off) gates its passes and
     mixes its texture out, so toggling compiles nothing; it and `uniforms.exposure` are the cues'
     knobs for the toll and the flash (#222).
  - **Lens dirt** (optional, `dirt.ts`): the bloom is added again multiplied by `lens-dirt`, a
    256² noise recipe from the asset pipeline (42 kB), at `Post.dirt.set(strength)`, 0 by default,
    so the look is unchanged until the art review asks for it. At 0 it adds exactly nothing and has
    no pass of its own; the texture loads the first time the strength goes above 0, and until it
    arrives a 1×1 black stand-in is sampled, so its arrival swaps a binding, never a shader (a
    post spec loads it and counts programs and pipelines).
- **The output stage** (#161) is one pass (`Post.compose`), in this order: exposure over the scene
  and the bloom; chromatic aberration (red and blue sampled apart radially by the square of the
  distance from the centre, so the centre is untouched); a vignette that multiplies toward
  TaleWeaver's dark purple (0.09, 0.038, 0.208) at 0.33 from a radius of 0.2 to 0.75; the tone
  mapper and sRGB; film grain (interleaved gradient noise, 0.035); the overlay; and a triangular
  dither of ±1 step against banding, never on the overlay. Each is a uniform and a Graphics
  option (Vignette, Chromatic aberration, Film grain; `?off=lens` all three).
  - **The black rule:** every step maps 0 to 0. The vignette multiplies, grain and dither are
    masked by `smoothstep(0, 2/255, luminance)`, `worldModify` makes a player's hidden cells
    exactly 0 (haze included), and the re-mask takes back what bloom and the lens spread over them
    (see "Materials and world visibility"), so unexplored cells are exactly (0, 0, 0) on screen. A test draws black with every effect at full strength and reads
    only zeros; #176 checks it over the fixtures' fogged views.
  - **Grain and dither are seeded by the tabletop's clock** (`uniforms.frameIndex`, 24 steps a
    second), so a held clock holds them still (goldens, the idle table) and they only move on
    frames the scheduler draws. Grain is 0 under reduced motion.
  - **The colour grade** (#162) sits between the tone mapper and the grain: `lut3D` on one 32³
    3D texture (`grade.ts` `GradeBlend`) holding the environment's grade for the viewer's tone
    mapper and the ambient band (`docs/ASSETS.md`), a Graphics option (Colour grading,
    `?off=grade`). A new environment's grade is put in place at once; a change of band or tone
    mapper blends its bytes over 1.5 s on the CPU (the tabletop draws while it does), so the
    shader never changes. A table loads only its tone mapper's three strips; picking another
    loads that one's three, keeping the grade drawn until they arrive. Every strip keeps black
    at 0, checked by the pipeline, and the loader forces texel 0 to black against canvas-read
    noise.
- **Antialiasing** (#163, `antialias.ts`) is one Graphics option with five modes (`AaMode`): off;
  FXAA on the finished colour after the grade (grain, the overlay and dither come after it); SMAA
  (r186's `SMAANode`, 1x medium, colour edges) on the linear HDR image before depth of field and
  the output stage, since it wants its input before the sRGB encode; MSAA 4× on the scene pass;
  TRAA on the HDR image from the prepass's depth and velocity (r186's `TRAANode`, 32 Halton
  offsets), sharpened by RCAS at 0.3. The presets use FXAA on low, MSAA on medium and TRAA on high
  and ultra; compat WebGPU, which has no MSAA, gets SMAA for it (FXAA stays FXAA). SMAA's three
  targets are disposed with the pipeline. MSAA and converge frames
  follow from the mode (`derive` in `quality.ts`), and a change of mode builds a new renderer.
  TRAA jitters the camera for every pass, so the overlay draws with a copy taken before (labels
  never jitter); bloom reads the unresolved scene.
  - **Converging:** every real change (`RenderScheduler.request`: a setter, the camera, the last
    frame of a tween) restarts CONVERGE at 24 frames with TRAA (12 under power saver, 0 for the
    other modes); the scheduler's own frames (converge and ambient) do not, so a still table
    stops drawing after them and a flickering one keeps its capped ambient rate, accumulating.
    `stats().mode` reports `converge` for them. A test moves a token on TRAA and counts at most 32
    frames from the end of the move to idle, then none, and a golden (`ref-1-close-high-converged`,
    on both backends) is taken on the high tier once the converge frames are drawn and the table
    is idle, under the held clock: the jitter and GTAO's rotations follow the frame count.
  - r186's `TRAANode` keeps its 1×1 previous-depth texture past `dispose`: `post.ts` disposes it;
    another 8 bytes stay until the renderer goes, which a change of mode always replaces.
  - Velocity in the prepass is back: the WebGPU errors blamed on it in #157 were the warm-up's
    timed-out compiles and the AO's nesting, both fixed since.
- **Depth of field and tilt-shift** (#165, `focus.ts`) sit after TRAA or SMAA on the HDR image, before
  the output stage: depth of field is r186's `DepthOfFieldNode` on the prepass's view depth (never
  multisampled), focused on the camera's pivot (`controls.target`, the shot's focus during a
  shot) along the look direction, with full blur `FOCAL_SHARE` (0.4) of the camera's distance
  from the focal plane, so it stays gentle zoomed in, and a bokeh per tier; tilt-shift is a
  half-resolution Gaussian blur (a quarter on low) mixed in outside a band round the pivot's row.
  How strong each is comes from `lensStrengths` in `quality.ts`, every frame, through the
  renderer's `FrameView` (reduced motion, the shot, the view, the pivot): a shot's focus
  (`shotFocus`: eases in over `SHOT_MS.go`, holds, eases out over `SHOT_MS.back`; 0 once a
  shot ends or the viewer takes the camera) blurs by depth; the **Miniature** option (off in every
  preset, since zooming in on a blurred board gets in the way of play) keeps depth of field on in
  the tabletop view and tilt-shift in the tactical one, which looks nearly straight down; without
  a prepass (low) tilt-shift stands in. Reduced motion and `?off=dof` keep both off.
  - Both are strengths gated like the other effects, and both are **mixed** in, never selected: a
    TSL `select` is a branch, and a texture sampled in a branch has no reliable derivatives
    (SwiftShader filtered the sharp image differently, which moved the AO and lens tests).
  - `DepthOfFieldNode.getTextureNode()` is a plain texture, which never draws the node: the output
    samples it as a `passTexture` of the node, as `GaussianBlurNode`'s own is.
  - Cost on the RTX 4060 at 1080p (the test world, `MINIATURE=tilt|dof` with `perf-gpu.mjs`):
    tilt-shift about 0–0.6 ms (5–8 draws), depth of field about 1–1.7 ms on high (13–15 draws),
    nothing when off. Their passes compile with the pipeline, so the perf baseline's programs went
    120 → 135 and textures 53 → 59.
- **A timed-out warm-up still finishes the compile in flight** before frames resume: compiling
  for a pass sets the renderer's target and outputs until the compile ends (three reads them while
  it waits), and a frame drawn meanwhile drew into them, which on WebGPU built pipelines for the
  wrong targets and aborted the frame.
- **The warm-up compiles for the scene pass** (`Post.targets`: its target and outputs, drawn
  linear without tone mapping, as the pipeline draws them). Not for the prepass: compiled outside
  its pass on WebGPU, some of its pipelines come out invalid, so it compiles when first drawn. The pass draws nested in the
  pipeline's quad, a different render context from the warm-up's, so three builds those materials
  again at draw time; the shaders mostly come out identical and are shared, but some shadowed ones
  differ in the order of their uniform declarations, which is why the test world counts 66
  programs through the pipeline against 52 straight to the canvas.
- **There is one render path** (#168): the pipeline. The direct `renderer.render(scene, camera)`
  of before M63, the `?off=post` kill switch, went with the goldens re-captured per tier.
- Emissive is 8-bit on purpose: a flame's excess above 1.0 reaches bloom through the HDR term
  (#160).
- **Ambient occlusion** (#159, `ao.ts`) comes from the prepass's depth and normals: SSAO
  (`SSAONode`, self-denoised) at half resolution on medium; GTAO (`GTAONode`) with temporal
  filtering, which TRAA resolves, at half resolution on high and full on ultra; none on low
  (`aoKind` in `quality.ts`: without TRAA to resolve its noise, as on high with MSAA or SMAA chosen,
  SSAO stands in). The kind is a pipeline stage, so a change of it builds a new renderer; high and
  ultra share one, whose change of resolution is a number, not a shader. GTAO's first frame is
  left out (the scene pass draws it before its materials, which set it up, are built) and TRAA's
  converge frames draw over it. SSAO costs about 0.7 ms a frame
  at 1080p on the RTX 4060 (WebGPU, medium; #166 measures every pass per tier). It reaches the scene pass's
  materials through `builtinAOContext` (`scenePass.contextNode`), so it scales indirect light only:
  the hemisphere darkens in creases and under things, while torches, lamps and the sun light faces
  as before; transparent materials (fog, darkness, mist, painted floors) and the overlay get none.
  Its reach and depth are per environment, in cells (`AO_LOOKS`, `Post.setLook` on a new table or
  look), all uniforms: SSAO's `radius` and `intensity`; GTAO's `radius`, `scale` (the intensity,
  a power) and `thickness` (twice the radius). GTAO's `samples` is compiled in and stays at 16. `uniforms.aoStrength` (0 with the tier's `ao` off or `?off=ao`) mixes it to
  exactly 1 and `Post.gate` stops its passes, so toggling compiles nothing. The scene pass draws
  what it reads first (`ScenePassNode.drawsFirst`: the prepass, then the AO), each once a frame.
  Three keys a render context by how deeply the pass is nested: a prepass drawn from inside the
  AO's pass one frame and from the overlay's the next compiled everything twice, and an AO drawn
  from inside the scene's own draw, when a material first asked for it, made WebGPU pipelines for
  the wrong targets and aborted the frame. The
  warm-up compiles without the AO's context: compiled with it (merged into the renderer's), three
  released and rebuilt those programs as tables were loaded again, so the scene's materials take
  the AO context when first drawn.
- **The tone mapper is the viewer's** (#158, owner's decision 27 September 2026): Filmic (ACES),
  Soft (AgX) or True colour (Neutral) in the Graphics menu (`GraphicsPrefs.toneMapper`, into
  `QualitySettings.toneMapper`), `?tonemap=` for A/B runs. The default is `GRADE_TONE_MAPPER` in
  `src/lib/assets/manifest.ts`, ACES: the one every grade (#162) is authored after, which the asset
  pipeline checks. Only the output stage holds the tone mapper, so a switch recomposes that stage
  (`Post.compose`) and keeps the passes; rebuilding them compiled every material again and never
  released the old shaders (about 11 programs a switch). The measurements are in `docs/LOOK.md`.
  #162 decides how a grade made after ACES treats the other two.

### Milestone 63 smoke run, 28 September 2026

On the RTX 4060 Laptop (WebGL2 through ANGLE Vulkan, the default tier, high), from the built app
at the M63 tip, after the loose ends of #157, #159, #160, #162, #163, #165 and #167 landed:

- `node scripts/playthrough.mjs`: The Hollow Bell to its end (Silence) in 14 steps and 65 s, every
  cinematic shot playing with its depth of field, and The Last Train to Blackwater to its end
  (Stopped Short) in 6 steps and 33 s; the table came to rest after every step, moves animated,
  no console errors.
- The perf gate passed on the new baseline: 0 idle frames, 60 fps orbiting, render targets per
  tier 17 / 27 / 29 (post 25.7 / 79.8 / 112.9 MB; high lost a target to GTAO at half resolution).
  Low and medium each gained 4 bytes, the lens dirt's 1×1 stand-in.
- The client suite on SwiftShader (264 tests) and the WebGPU suite on the RTX (222) passed; three
  SwiftShader tests failed once under a full run's load (a screenshot timeout, crowd-60, the shot
  test) and passed alone, and the shot test was made independent of what loads before it.
- After #168 (goldens per tier, the direct render path removed), again from the built app: both
  adventures to their ends (64 s and 33 s), the perf gate passed on the same baseline, and the
  golden sets passed on both backends (159 each; WebGPU three runs in a row, WebGL2 twice).
- `npm run bundle:check`: the renderer chunk is 343.1 kB gz of its 360 kB (from 303.4 kB: SMAA's
  lookup textures and GTAO); the room page's own code 74.9 kB gz of its 76 kB (74.4 before M63).

## Materials and world visibility (milestone 64)

Every surface the renderer draws is one of a closed set of **shader kinds**
(`src/lib/tabletop/materials/`, #169), and every kind ends in the same world term, `worldModify`
(#171), which draws the fog of war and the dark from two cell maps. Milestone 64 put every layer
on the kinds (#172) and deleted the fog plane, the darkness overlay, the floor plane and raised
ground's instance shading (#173). Two tests hold it in place: runtime state never compiles a
shader (`program-count.svelte.spec.ts`, #170) and unexplored cells stay exactly black
(`unexplored-black.svelte.spec.ts`, #176). Every kind runs on both backends; CI checks WebGL2
(SwiftShader, `rendering.yml`), and the WebGPU runs are the local `client-webgpu` project.

### Kinds and slots

`createMaterial(kind, options)` makes a material; `KINDS` in `kinds.ts` defines each kind.

| Kind     | Base                               | Slots                         | Defaults and extras                                 | First users                         |
| -------- | ---------------------------------- | ----------------------------- | --------------------------------------------------- | ----------------------------------- |
| surface  | Standard                           | albedo, normal, ORM, emissive | box mapping in the world, macro variation           | walls, door panels, the table's rim |
| terrain  | Standard                           | as surface                    | as surface; floors and height from the `ground` map | the table's top, raised ground      |
| rock     | Standard                           | as surface                    | triplanar in the world, macro variation             | none yet (#177's tests)             |
| prop     | Standard                           | as surface                    | object space, paint (#178), lift (#181)             | props and placeholder boxes         |
| mini     | Physical (clearcoat a uniform)     | as surface                    | object space, paint, own colour and see-through     | tokens                              |
| emissive | Standard                           | as surface                    | the mesh's uv                                       | none yet                            |
| decal    | Standard, transparent              | as surface                    | the mesh's uv, lift                                 | none yet                            |
| foliage  | Standard, alpha-tested, both sides | as surface                    | the mesh's uv, sways on `worldTime`                 | none yet                            |
| water    | Standard, transparent              | as surface                    | the mesh's uv slid on `worldTime`, lift             | none yet                            |
| overlay  | Basic, or LineBasic (`lines`)      | albedo (lines: none)          | transparent                                         | the fog cloud                       |

- **Fixed at creation**, each a variant with a graph of its own (never toggled later): the kind,
  `instanced` (an `InstancedMesh` whose geometry has the tint and lift attributes,
  `addInstanceTints`), `lines`, `local` (box mapping in the geometry's own space), `antiTiled`,
  `vertexColors`, and the kind's `transparent`, `side` and alpha test. `graphFor(kind, variant)`
  builds a graph the first time a material of that kind and variant is made; every later material
  shares it.
- **Values are `params`**, one object per material (`Params` in `kinds.ts`: colour, roughness,
  metalness, emissive, tint, opacity, repeat, cutoff, sway, flow, clearcoat, lift and the macro
  variation), read by the graph through a reference to the drawn object's own kind material
  (`OwnReferenceNode` in `tsl.ts`, not three's `materialReference`: the shadow pass draws with
  three's own material while still running the kind's colour and position nodes). They sit in one
  object because r186 keys node state by whether each number on a material is zero
  (`RenderObject.getMaterialCacheKey`), so a value of the material's own crossing 0 would build
  new state. `setParams` changes them; nothing compiles.
- **Slots are never empty** (`defaults.ts`). Each slot has a type (2D, array, 3D), a colour space,
  wrap, filters and mapping, and while it holds no texture it holds a blank of exactly those:
  albedo white sRGB, normal (128, 128, 255) and ORM (255, 255, 0) linear, emissive black; array and
  3D slots 1×1 `DataArrayTexture` and `Data3DTexture`. World slots repeat and filter trilinearly
  (`WORLD`), so anisotropy can apply (#179). Loaders put the same sampling on real textures with
  `prepareSlotTexture`, and `setSlot(material, slot, texture | null)` swaps one in or back out
  with no program and no node state (r186 keys node state by a texture's mapping, and on WebGPU
  its wrap and filters). ORM's blue can only add metal (`max(params.metalness, b)`), so the blank
  keeps a material's own metalness.
- **Sampled textures:** 4 slots on the lit kinds, 1 on overlay meshes, none on lines, plus the
  two cell maps and the shadow maps; 16 per stage are guaranteed. Paint adds two maps on props and
  minis (below). The reveal fades live in the `ground` map's spare channels rather than a map of
  their own for this reason.
- **Never `clone()` a kind material** (`Material.copy` drops `params` and the slots): `remake`
  makes one of another variant with the same values and textures, and `twinOf` keeps a material's
  other anti-tiling variant both ways, so switching tiers back and forth makes no material.

### Variant rules: what makes a new program

A program is compiled for each graph and each set of material properties three puts in its cache
key. So:

- **No literal that differs between materials.** A value a material or runtime state chooses is a
  `params` field, a per-object uniform (`uniform().onObjectUpdate`, as the mini's colour and
  see-through are), an instance attribute (`aTint`, `aLift`) or a shared uniform (`worldTime`,
  `cellUniforms`, `paint`, `mipBias`). The hooks that later looks attach to (`hooks.ts`:
  `surfaceMapping`, `slotSample`, `paintNormal`, `paintRoughness`, `ownAlbedo`, `ownOutput`) run
  once, while a graph is built: no runtime value may pick a branch there.
- **Never toggle** `transparent`, `side`, `alphaTest`, `vertexColors` or `fog` after creation, and
  never let a numeric material property cross 0 at runtime. Foliage cuts by `params.cutoff`
  through `alphaTestNode`; physical features are driven by their node (`clearcoatNode` on
  `params.clearcoat`, 0 until #267), since three's `useClearcoat` would add a define the moment
  `material.clearcoat` left 0.
- **Tier differences are separate graphs** chosen when the pipeline is (anti-tiling is the one
  so far); a tier switch that keeps the pipeline swaps materials for their kept twins (see
  "Shader warm-up"). A uniform strength (paint, macro variation, the mip bias) is not a variant.
- **Animated kinds read `worldTime`**, a uniform the renderer owns and holds still under reduced
  motion, never three's `time`. The fog cloud has its own `cloudTime`.
- **No GLSL, no WGSL, no `onBeforeCompile`**: ESLint refuses `onBeforeCompile`, `glslFn` and
  `wgslFn` under `src/lib/tabletop/` (`eslint.config.js`).
- **r186's own costs**: every `InstancedMesh` gets a vertex stage of its own (its instance matrix
  buffer is named by id), a built-in material's too, and a shadowed lit material's uniforms are
  declared in another order compiled than drawn. The warm-up and the sweep account for both.

`materials.svelte.spec.ts` checks, on both backends, that a second material, other values, a slot
swapped between blank and real, or the mini's clearcoat leaving 0 add no program, and a slot swap
no node state.

### worldModify and the cell maps

`cell-maps.ts` keeps two one-texel-per-cell textures in grid row order (no flip on either
backend), fed by `CellMaps.update` from the renderer's `relight` with what the viewer was sent
(no wire change):

- `visibility`, RGBA8, linear, no mipmaps: R visible, G explored (the viewer's fog), B the rules'
  light level (`lightLevels`), A sky visibility (255 open, 0 in a dark area; #219 adds roofs).
- `ground`, RGBA8, nearest: R the floor (`FLOOR_IDS` index), G the level, B and A the reveal
  fades (below).

Each channel is written only when its input changed; a new grid size replaces the textures under
the same nodes. The uniforms (`cellUniforms`) carry fog on or off, the mode (player or GM), the
ambient's darkness and night's, the flash (`CellMaps.setFlash`), the cut height, the cell size and
the soft-fog shape.

Every kind ends in `worldModify(output, emissive)` and passes its emissive through
`worldEmissive` first (`world-modify.ts`). Per fragment, from the fragment's cell:

- **fog**: 1 visible; a player's explored cells `FOG_LEVELS.player.explored`, hidden exactly 0;
  the GM's unseen cells lighter, with explored dimmer (`FOG_LEVELS.gm`, the deleted plane's alphas
  as `1 - alpha / 255`);
- **the unseen tint** on a player's explored cells (desaturated and cool) or the GM's unseen ones
  (the GM tint);
- **light**: `1 - shade × (1 - max(level, fill))`, where `shade` is the ambient's darkness (night's
  in a dark area at any hour), `level` the rules' light level and `fill` the perception fill
  (`PERCEPTION_FILL`) on a fogged player's visible cells, so a cell the rules show is never black;
  the flash thins it (`FLASH_THINS`);
- the result `(output - emissive) × light × fog + emissive × (light × fog)`, emissive dimmed once:
  the emissive the scene pass's MRT reads for bloom is the fogged one too;
- a discard above `cutY`, parked at `NO_CUT` (a large finite value: WGSL may assume no infinities)
  when nothing is cut;
- outside the grid it is neutral. There is no weather input yet (#320 adds it as a uniform or a
  map channel, never a variant).

A hidden cell comes out exactly 0, haze and emissive included. Fog, mode, ambient, flash, cut and
a new grid size compile nothing (`cell-maps.svelte.spec.ts`, both backends), and the pure mirrors
in `cell-maps.ts` are tested against the old overlays' numbers in `cell-maps.spec.ts`. What isn't a
kind takes the same terms: `inWorld(material, glow)` puts `worldModify` last and the glow through
`worldEmissive` on fixtures, flames (one shared flame material, colour and glow per-object
uniforms) and the mist; `worldShade()` fades the grid lines (`overlay.ts`); `worldHidden()` is
the re-mask's input.

### The re-mask

Bloom, chromatic aberration, depth of field and FXAA carry light a little way over hidden cells.
So the scene pass writes a third attachment, `hidden` (`worldHidden`: 1 where a player's fog
hides the fragment's cell), and `Post.compose` multiplies the world by `1 - hidden` after FXAA,
before grain and the overlay (post.ts): unexplored cells are exactly black after every effect.
The attachment is RGBA8, not R8 (r186 declares a WebGPU fragment output with the target's
channels, so an R8 target has no alpha to blend transparent surfaces with), blends normally, and
clears to 0 (shown, `setClearColor` on the MRT, #176), so the sky around the table counts as shown
however bright it becomes. Dice are not the world: `dieMaterial` writes 0 there (`mrtNode`,
dice3d.ts), so a public roll over a hidden cell still shows. `post.svelte.spec.ts` checks it on
both backends, a bright background included.

### Fog as atmosphere (#174)

`fog-soft.ts` holds the pure halves, tested in `fog-soft.spec.ts`; `fog-soft.svelte.spec.ts`
checks them drawn. The rule every piece keeps: softening and fading only ever darken, so a hidden
cell stays exactly 0 and the re-mask follows the soft edge.

- **Soft edges**: the `visibility` map's linear samples of R and G through a `smoothstep` band
  (`EDGE_BAND`, 0.3 of the sample) that low world noise (`mx_noise_float`, no time term, so edges
  don't crawl; `EDGE_NOISE`, `EDGE_SCALE`) pushes inward only, keeping `min(hard, soft)`: 0 on the
  line between cells whatever the noise, the cell's own value at a known cell's centre.
- **Reveal fades**: `CellMaps.setFog` diffs the viewer's visible mask (`RevealFades`) and writes
  each newly visible cell's remaining fade and the state it came from (hidden or explored) into
  the `ground` map's B and A, rewritten on the renderer's clock by `CellMaps.tick` only while a
  fade runs (`FADE_MS`, 450), which counts as movement for the scheduler. Losing sight is
  immediate; a new mode or table size fades nothing; under reduced motion reveals are instant.
- **The fog cloud** (`fog-cloud.ts`): one overlay-kind mesh over the grid, `cloudDivisions`
  vertices a cell under `CLOUD_VERTEX_CAP` (64k), raised in the vertex stage by an `aHidden`
  attribute (`cloudMask`: 1 - explored, bilinear between cell centres) times fractal noise on
  `cloudTime`, capped at a quarter cell and sunk into the slab where nothing is hidden. Raycast
  off, players and spectators only, black over hidden cells through `worldModify`. It drifts only
  in ambient frames and is held still on low, under reduced motion and in power saver. Its layer
  (`fogcloud`, `?off=fogcloud`) is off until the owner approves it on ref-1 and the Hollow.

### Mapping (#177)

`surfaceMapping` in `hooks.ts` picks `materials/mapping.ts`'s mapping per kind; `params.repeat` is
always the tile, so changing it compiles nothing, and slots sample at the mapping's coordinates,
never through a texture's own matrix (r186 snapshots it from the first texture it sees).

- **surface and terrain**: a box projection of the world (`positionWorld`, the face by the largest
  axis of `normalWorldGeometry`, ties to x then y). Textures run on across instances, walls of any
  length and raised cells of any height. Sides repeat `repeat.x` per world unit across and
  `repeat.y` up, tops `repeat.x` both ways, u flipped by the face's sign. `repeatFor`
  (`materials/tiling.ts`) gives the tile from `look.cells`, the cell size and `STEP_HEIGHT`: one
  repeat per `look.cells` cells across, and up the whole number of level steps or courses nearest
  the width. One fetch per slot; each face's tangent frame is constant, so normal maps need no
  tangents.
- **`local: true`** (surface, terrain, rock): the same box in the geometry's own space, for door
  panels, whose texture would slide as they swing. For single meshes: on an `InstancedMesh` a
  rotated instance would be lit wrong.
- **rock**: triplanar in the world (zy, xz and xy, weights `pow(|n|, triplanarSharpness)`,
  normals blended by Whiteout). A slot's three fetches are its reference plus two `.sample()`
  clones that keep its `referenceNode`, so a new texture reaches all three. Three fetches a slot.
- **prop and mini**: the mesh's uv (#188): a cooked model's glTF uvs, and zeros on a part list,
  whose slots hold their blanks, so both draw with one program (`tabletop/models.ts` gives every
  model part the same attribute set). Their paint (#178) stays in object space on its own.
- **everything else**: the mesh's uv, water's slid by `params.flow` on `worldTime`.

`mapping.svelte.spec.ts` checks it drawn on both backends: no seam between two wall instances or
two raised cells of different heights, a door panel's texture moving with it, and rock's new
texture on every face with no new program.

### Paint (#178)

Props and minis take TaleSpire's painted-miniature recipe through `paintNormal` and
`paintRoughness` (`paint.ts`), sampled triplanar in object space (`positionGeometry`,
`normalGeometry`: r186 gives instanced meshes the instance-transformed `positionLocal`, so noise
there would swim as a prop glides). The noise tilt comes in a frame of screen-space derivatives of
each projection's coordinates and is added over the vertex normal; gloss sets
`roughness = clamp(r - (gloss - 0.5) × amount, 0.1, 1)`. The maps (`paint-normal`, `paint-gloss`,
256 px, linear data, from the `paint` texture recipe in `server/assets/textures.ts`) load when the
first painted graph is built, behind neutral blanks sampled the same way. `paint.strength` (0.5;
0 on the low tier, `QualitySettings.paint`), `paint.gloss` (0.4) and `paint.scale` (1.5 repeats a
cell) are uniforms shared by every painted material. Six fetches per prop or mini fragment.
`paint.svelte.spec.ts`: the maps' arrival and tuning add no program or node state, 1 and 200
props share one, and the paint moves with a gliding prop.

### Texture filtering (#179)

`materials/texture-quality.ts`: every world texture (an environment's map, a dice numeral, later
KTX2 and array textures) is registered with `worldTexture` as it loads, and `setTextureQuality`
gives the registered ones the tier's anisotropy (4 on low, 8 on medium, 16 on high and ultra,
clamped to `renderer.getMaxAnisotropy()`: 0 on WebGL2 without the extension, where it stays 1)
and sets `mipBias` (`mipBiasFor`: -0.5 on high and ultra with TRAA, else 0), a uniform every slot
sample reads. Anisotropy is part of the sampler on WebGPU and a texture parameter on WebGL2, never
of a material's cache key, so a tier switch re-uploads the registered textures and makes no
program. Data textures (cell maps, LUTs, the slots' blanks) are never registered.

### Lift and variation (#181)

- **Lift, against z-fighting**: instanced prop, decal and water meshes carry `aLift` in [0, 1)
  (`LIFT_ATTRIBUTE`, added by `addInstanceTints`), and their vertex stage moves each instance
  `aLift × params.lift` along its normal; the layer sets `params.lift` to a thousandth of a cell.
  `liftOf(assetId, anchorCell)` (`lift.ts`) is a PCG hash of FNV-1a of the id xor the cell,
  worked out in JS, so it is the same on every client, load and backend (`lift.spec.ts` pins it).
  Never negative, so the table and raised ground (not lifted) stay below.
- **Macro variation**: surface, terrain and rock vary by fractal noise of world xz times
  `params.macroScale`: albedo `1 ± macroTint`, roughness `± macroRoughness` (0.1 and 0.08 on those
  kinds, 0 elsewhere; 0 is off in the same graph). ALU only, every tier.
- **Anti-tiling** (`antiTiled: true`, surface and terrain): each slot sampled twice at offsets a
  low-frequency noise index picks (iq, "Texture repetition", technique 3), with the coordinates'
  own gradients, and blended. A variant: medium and up (`QualitySettings.antiTile`); low keeps
  one fetch.
- **Depth precision** (worked out, not measured): with the near plane at 0.1 and a 24-bit depth
  buffer a depth step is about z² / (0.1 × 2²⁴): 6e-5 at 10 units, 1e-3 at 41. Two coplanar lifted
  sheets are on average a third of `params.lift` apart, so they resolve to about 23 units away,
  and the whole lift to about 41; farther needs the reversed float depth buffer, decided with the
  horizon work in 67.

### What each layer uses (#172)

`kind-layers.svelte.spec.ts` walks the layers and checks every material came from the factory.

- **The table** (`table.ts`): the top is the terrain kind, the rim the surface kind, both
  `antiTiled` from the start and remade (`twinOf`) when the tier's `antiTile` differs.
  **Raised ground** (`terrain.ts`) is the terrain kind, instanced. The terrain kind reads the
  `ground` map (`ownAlbedo`): on the table each floor's colour (`floorPalette`, from
  `FLOOR_LOOKS`, a uniform array) over the textured surface at its cover (plain none, the void
  all); on a raised cell its texture in its floor's colour or the look's, paler with height toward
  `cellUniforms.maxLevel`.
- **Walls** (`walls.ts`): the surface kind, instanced; door panels the surface kind's `local`
  variant, one material and a tinted second for the hovered door.
- **Props** (`props.ts`): the prop kind, instanced, one material for models (vertex colours) and
  one for placeholder boxes (their colour a param); `aLift` from `liftOf`.
- **Minis** (`tokens.ts`): the mini kind, three materials for every token (bases, figure bodies
  with vertex colours, the parts in the token's colour). Colour and how much shows are per-object
  uniforms (`miniColour`, `miniOpacity` over `userData.miniColor` and `userData.mini`), so a new
  token makes no material, and the GM's see-through hidden token is a screen-door dither
  (`interleavedGradientNoise(screenCoordinate)` against the opacity, discarding) that never
  flips `transparent`.
- **Environments** `wear` their looks (`environment.ts`): colour, roughness and metalness as
  params, the loaded map in the albedo slot (registered with `worldTexture`), the tile from
  `repeatFor` on walls, raised ground and the table, the rim a repeat per two world units.
- **Hover, selection and the GM's hidden ghost** are emissive tints: per instance on props and
  walls (`aTint`), `params.tint` elsewhere; a textured albedo is never multiplied by them.
- **Not kinds**: fixtures, flames and the mist take the world with `inWorld`; the grid lines with
  `worldShade`; the fog cloud is the overlay kind. Dice stay `dieMaterial`: a roll is public and
  may land over black cells, and dice are flat shaded; they fade by a screen-door dither on a
  per-object uniform (`userData.fade`), never by turning `transparent` on. The toll's dust stays a
  sized-points sprite (its position is its own per-particle buffer, which no kind reads), re-masked
  by the output stage; its shadow is black. All of them are warmed as gallery stand-ins.

### Warm-up

A table's warm-up (see "Shader warm-up") compiles its layers and the tabletop gallery's stand-ins
(`gallery()` on the dice, effects, the fog cloud (`FogCloudLayer.warm`, the same geometry and
material never hidden) and the tokens' ring and marker). The lobby compiles `kindGallery()`
(`materials/warmup.ts`): every kind in every variant the layers make (plain and instanced;
anti-tiled surface and terrain; vertex-coloured prop and mini), casting shadows or not, plus the
`local` box and the overlay's lines. It is built from `SHADER_KINDS`, so a new kind joins by
itself; a new variant a layer makes must be added to `variantsOf`.

### The tests that hold it

- **Runtime state never compiles** (`program-count.svelte.spec.ts`, #170, per tier on both
  backends): after a warm-up of every environment and table, each named step (environments, times
  of day, floors, fog in both modes, the fog cloud on and a reveal fading, dark areas, light
  counts past the pool, tokens and props in every state, walls and doors hovered, cues, a thrown
  die at rest, fading and gone, table travel, and where the tier keeps the pipeline anti-tiling
  back and forth) must leave `shaderCounts` (`perf.ts`: programs, pipelines) unchanged; node
  states are reported, not failed. A second test plays the toll with motion (its dust and shadow).
  A deliberately bad material (a literal of its own in the graph) proves the sweep is not vacuous.
  A failure names the step and the stages it made or dropped; a stage is named after its
  material, so a kind's shows as its kind. Compiles still left are in `KNOWN` with the issue or
  reason that ends each; since #180 only the first in-place switch of anti-tiling. Shrink it,
  never grow it without a written reason.
- **Unexplored cells stay black** (`unexplored-black.svelte.spec.ts`, #176; see "Testing the
  renderer").
- Beside them: `materials.svelte.spec.ts` (programs per material, value and slot),
  `cell-maps.svelte.spec.ts` (world state compiles nothing), `kind-layers.svelte.spec.ts`,
  `mapping.svelte.spec.ts`, `paint.svelte.spec.ts`, `fog-soft.svelte.spec.ts`,
  `lobby.svelte.spec.ts` (the lobby fetches only public data and a table after it compiles fewer
  programs) and `post.svelte.spec.ts` (the re-mask).

### Adding a kind or a layer

1. **A kind**: add it to `ShaderKind`, `SHADER_KINDS` and `KINDS` (base, slots, `transparent`,
   side, alpha test, defaults); build its graph in `graphFor` from `params` and slots only, ending
   in `worldModify` and with its emissive through `worldEmissive`. The lobby's gallery picks it up;
   if a layer makes it in a new variant, add that to `variantsOf`.
2. **A layer**: make its materials with `createMaterial` (or, when it can't be a kind, `inWorld`),
   and give it `gallery()` stand-ins for anything it shows only later, handed to the tabletop's
   `Gallery`. Add its runtime states as steps to the program-count sweep, and add it to
   `kind-layers.svelte.spec.ts`.
3. **Turn it on in the unexplored-black sweep** (`mountCase`, or in the fixtures if it comes from
   the view) and, if it stands on explored ground, add its height to `standing`. A layer that
   fails there is fixed in the render path, never by skipping cells.
4. **Any new per-viewer input** (a mask, a list, anything that differs by who looks) is built
   from the viewer's view only, and joins the raw-frame secrecy check (`framesLeaks` in
   `server/frame-secrecy.ts`, #175, run by `game-server.spec.ts` for a fogged player and a
   spectator, with the GM as the control): decode it there and require nothing in the never
   explored region. The file's header lists the inputs later milestones add.
5. Run the render specs named above on WebGL2 (`npm run test:render -- <files>`) and on WebGPU,
   add a new spec to `RENDER_SPECS` in `vite.config.ts` and a group in `rendering.yml` within
   about 5 minutes (a slim set for CI and the full set by hand, as the goldens do).

Costs on SwiftShader and what the perf gate measures on real GPUs are in `docs/PERFORMANCE.md`
("Milestone 64").

### Milestone 64 smoke run, 29 September 2026

From the built app at the M64 tip, on the RTX 4060 Laptop: `node scripts/playthrough.mjs` plays
The Hollow Bell to its end (Silence, 14 steps, 68 s) and The Last Train to Blackwater (Stopped
Short, 6 steps, 33 s) on WebGL2, and again with `PERF_BACKEND=webgpu` (70 s and 33 s): every
table came to rest after each step, moves animated, no console errors. The perf gate passed on
the new baseline, both golden sets (159 each) were re-recorded and the slim set passes against
them, and the renderer chunk is 356.1 kB gz of its 360 kB.

## Testing the renderer

The client test project (`vite.config.ts`) draws with SwiftShader on an 800×500 viewport, with no
tester UI around the frame. `src/lib/tabletop/testing.ts` mounts any fixture table
(`tests/fixtures`, see `docs/PERFORMANCE.md`) as the GM, a fogged player or a spectator sees it, at
DPR 1, with a clock the test holds still, reduced motion on and the camera at a named pose.
Under SwiftShader a table's cost is its shader compile (the WebGL link in the frame that first draws
a program, then SwiftShader's JIT in the GPU process for seconds after the frames stop), so the
harness keeps it out of the way: `settle` ends by reading a pixel back, so the GPU's queued work is
the test's that drew it (an `afterEach` unmount used to wait it out and time out); `mountFixture`
loads the lights' fixture models with the table's (no extra warm-up); `settle(…, clock)` moves a
held clock on while the table draws actively (a grade blending into a band's, the exposure's lift
with motion on), where a held clock kept it busy until the limit; tests of other things mount with
`heroes: false` (no hero shadow slots, #230, a third of every lit shader: smoke, atmosphere, flash,
shot focus, exposure, sky light), while the slots' own tests, program-count, the goldens and the
fixtures keep them; and the probe case of unexplored-black bakes a coarser lattice
(`probeSpacing`).

- **Smoke tests** (`fixtures.svelte.spec.ts`, `renderer.svelte.spec.ts`,
  `scheduling.svelte.spec.ts` and `stability.svelte.spec.ts`, apart so CI runs them side by
  side; the long ones sharded further with `THIRDFOLD_SHARD=k/n`, by fixture, tier or case, or
  by test with `shardedIt` from `testing.ts`): every fixture draws for every
  viewer with no `console.error`; the same inputs draw the same pixels; an idle daylight table draws no frames;
  torch flicker stays at the slow ambient rate, and stops at once when the system asks for reduced
  motion; reloading tables leaks no geometry, texture or shader program; cycling the times of day
  compiles nothing new the second time; a disposed tabletop answers no pointer events.
- **Golden images** (`golden.svelte.spec.ts`): the `MATRIX` table lists every image, named
  `<fixture>-<pose>-<band>-<viewer>`, with `-low` or `-high` for the per-tier sets (#168: medium
  draws every shot; low and high the reference compositions for the GM and a player, close up,
  a spectator and the dark Hollow, high with TRAA converged and GTAO). The close and low poses
  draw with depth of field focused on the pose's pivot (`mountFixture`'s `miniature`, with the
  power saver so no flame keeps TRAA's jitter going). Captures with TRAA, GTAO or depth of field
  compare by SSIM (`tests/visual/ssim.ts`: mean SSIM over luminance in 8×8 windows, at least
  0.98, a diff of each window's loss), the rest by pixelmatch with threshold 0.1 and at most 0.5%
  mismatched pixels. Only Linux references are committed (`__screenshots__/golden.svelte.spec.ts/`),
  and the spec skips elsewhere; CI is the authority. Diffs land in `.vitest-attachments/`.
  Unexplored cells are checked exactly black per tier by `unexplored-black.svelte.spec.ts` (below).
  **When they run:** never with `npm test`. CI takes the slim set (`SLIM` in the spec, 26 images)
  in `.github/workflows/rendering.yml`, only on pull requests that touch rendering, never on
  pushes, beside the renderer's other pixel tests (`RENDER_SPECS` in `vite.config.ts`, `npm run
test:render`), which leave `npm test` too, so the verify job stays within minutes.
  The full set (159 per backend: `npm run test:golden:full`, `npm run test:golden:webgpu`) runs by
  hand, once a rendering PR is ready and agreed, not during development, where the test world and
  the targeted specs are the check.

**Unexplored cells stay black** (#176, `unexplored-black.svelte.spec.ts`). For each fixture with
fog and unexplored ground, the player's view and the spectator's (left out where it is exactly the
player's), each named pose (overview, close and low in the fixture's band, dark in its own), each
tier (low, medium, high; ultra too on WebGPU), the medium tier again with reduced motion and again
with the fog cloud's layer on (#174), it mounts the view with every layer on (grid lines shown, mist, fixtures, carried light, bloom, the lens
and grain; no dice, no hover), projects each unexplored cell's centre and reads a 3x3 block from the
captured frame (`readFrame` in testing.ts: the drawing buffer on WebGL2, a screenshot on WebGPU),
requiring exactly (0, 0, 0). Skipped are cells whose block leaves the cell's outline on screen and
cells behind something the viewer was sent (explored floor, walls, minis, lights and props, each as
tall as it can stand); cells right beside explored ground count, where bloom and the lens spread and
the re-mask must take them back. A pose with fewer than 20 such cells is left out and logged (most
close and low poses, which look at explored ground), and so is a view with none left (ref-6, and
the dark band of the monastery, railcar, test world and village, whose one pose looks at the party).
Each pose also checks the frame read back is not all black, and a self-check lays the GM's reveal
preview (an overlay the fog never shades) over the dungeon and must fail, naming the fixture, pose
and cell. CI takes the slim set (`SLIM`: six cases on WebGL2, about 2 minutes on SwiftShader
here; seven with ultra on WebGPU), and fails if one of them stops existing; the full set (every
view, five cases each on WebGL2 and six on WebGPU; over half an hour on SwiftShader) runs by hand
before a rendering PR:

```bash
THIRDFOLD_UNEXPLORED=full npm run test:render -- src/lib/tabletop/unexplored-black.svelte.spec.ts
THIRDFOLD_WEBGPU=1 THIRDFOLD_UNEXPLORED=full npx vitest run --project client-webgpu src/lib/tabletop/unexplored-black.svelte.spec.ts
```

**A new layer joins it when it lands:** turn it on in `mountCase` (or in the fixtures, if it comes
from the view), and if it stands on explored ground add its height to `standing`. The sky (#214),
grass (#302), scatter, decals, water (#293), VFX, weather (#320), motes, x-ray (#284) and overlays
(#285) are next. A layer that fails here is fixed in the render path, never by skipping cells.

**When a golden fails in CI**, the `goldens` job of `rendering.yml` uploads the `goldens-diffs`
artifact (`.vitest-attachments/`: the reference, the actual image and a diff for each failure;
kept 14 days). Download it from the run's page; its reference and actual PNGs are the before and after a
golden PR shows.

**Changing goldens.** Update them only on purpose, on Linux:

```bash
npm run test:golden:full -- --update
```

and on WebGPU `npm run test:golden:webgpu -- --update`.

A PR that changes goldens says why, shows the before and after of every changed image in its
description, and names the milestone gate it serves. Keep the set under about 20 MB: if it grows
past that, drop the `low` pose and the extra overview bands of the frozen story tables before
dropping any player view.

## Upgrading three.js, Playwright and Vitest

`three`, `@types/three`, `playwright`, `vitest` and `@vitest/browser-playwright` are pinned to exact
versions in `package.json`. Each Playwright release ships a specific Chromium whose SwiftShader output
the golden images depend on; the screenshot comparator comes with Vitest; and three.js renames or
changes node-renderer APIs in most releases. Vite stays on a caret range so security fixes arrive; the
bundle gate catches chunking changes.

Pinned today: three.js 0.186.0, Playwright 1.63.0 (Chromium 153.0.8010.12, headless shell revision
1243), Vitest 4.1.11. Upgrade one of them at a time, like this:

1. Open a dedicated PR that upgrades one of the three and nothing else.
2. For three.js, read the [Migration Guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
   for every release crossed. List the renames and behaviour changes that touch `src/lib/tabletop`,
   `server/assets` or the TSL nodes in use, and grep for each.
3. Run `npm run check`, `npm run lint`, `npm test` and `npm run build`. Run `npm run assets:check`,
   because three.js can change the bytes of built GLBs, and `npm run bundle:check`. For three.js,
   also run `npm run assets:cook` and commit `assets/cook.lock.json`: the lock records three's
   version (the cook's tangents come from it), so CI's `assets:cook -- --check` fails until it does.
4. Re-baseline the golden images deliberately (`--update`, on Linux or in the pinned Playwright
   image), with before and after images of every changed golden in the PR.
5. Re-run the perf gate locally and `scripts/perf-gpu.mjs` on the reference GPUs (RTX 4060 and the iGPU). Update
   `docs/perf-baseline.json` and `docs/PERFORMANCE.md` with the reason for every change.
6. For Playwright, record the new Chromium revision in `docs/PERFORMANCE.md`, and check that the
   SwiftShader and WebGPU lavapipe flags still behave.
7. Play both adventures on the default tier as a smoke run.

Locally, `npx playwright install chromium` fetches the pinned browser before the client test project
can run.
