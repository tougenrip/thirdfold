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
| `material.clippingPlanes` and `localClippingEnabled` are ignored (clip through `ClippingGroup`); WebGPU points are 1 px                                                                                 | `ambience.ts` (mist), `effects.ts` (dust)                    | [#145](https://github.com/tougenrip/thirdfold/issues/145) |
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

## Modules

`src/lib/tabletop/renderer.ts` creates the scene and implements the `Tabletop` interface as short
delegations; every module in the folder stays under 500 lines (`modules.spec.ts` checks it).

| Module            | What it holds                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | The `Tabletop` interface and its types (re-exported by `renderer.ts`), `TIMED`, `RESHADOWS`                                       |
| `camera.ts`       | `CameraRig`: orbit controls, `viewPose`, view changes, shots, `setPose`                                                           |
| `picking.ts`      | `Picker` (pointer to cell, corner, edge, token, wall, light, prop), `pickKey`, clicks                                             |
| `loop.ts`         | `createNodeRenderer`, the frame hooks r186's own loop ran, live reduced motion                                                    |
| `scheduler.ts`    | The render scheduler: IDLE, AMBIENT, ACTIVE and CONVERGE, the frame-rate cap, pausing when unseen                                 |
| `scene-lights.ts` | Hemisphere, sun and lamp; fitting them, the haze and the camera to the table                                                      |
| `table.ts`        | The slab and surface (surface and terrain kinds), worn in the environment's looks                                                 |
| `previews.ts`     | Editor previews, the beacon and the highlighted cell                                                                              |
| `perf.ts`         | Frame and update timings, renderer stats, `benchmark`, and the timing wrapper                                                     |
| `quality.ts`      | Quality tiers: `Caps`, the settings table, the starting tier, `?tier=`/`?off=`, the pixel cap, refinement, `thirdfold:graphics`   |
| `capabilities.ts` | `probeCapabilities`, and `QualityControl`: canvas sizing within the tier's megapixels, the sun's shadow size, refinement          |
| `post.ts`         | `Post`: the RenderPipeline per tier (prepass, scene pass, output), its uniforms, `gate`, the warm-up's targets                    |
| `focus.ts`        | `Focus`: depth of field and tilt-shift over the pipeline's sharp image, aimed each frame; `FrameView`                             |
| `passes.ts`       | The pipeline's passes (prepass, overlay, scene), `Stages`, `stagesFor`, the tone mappings                                         |
| `overlay.ts`      | `OverlayLayer`: the overlay's scene, `follow` groups for labels and floats, grid lines masked by floor, fog and darkness          |
| `materials/`      | The shader kinds: `createMaterial`, slots and their blanks, the hooks for later looks (#169), the kinds' warm-up gallery (#180)   |
| `cell-maps.ts`    | `CellMaps`: the `visibility` and `ground` maps and `cellUniforms` that `worldModify` reads (#171), the reveal fades (#174)        |
| `fog-soft.ts`     | Soft fog's pure halves: edges, `RevealFades`, the cloud's shape (#174)                                                            |
| `fog-cloud.ts`    | `FogCloudLayer`: the fog cloud over a player's hidden cells, with its layer on (#174)                                             |
| `warmup.ts`       | `warmUp`, `Gallery` (the layers' stand-ins, drawn once after a warm-up)                                                           |
| `lobby.ts`        | `warmLobby`: the renderer made and warmed before any table, for the first table to adopt (#180)                                   |
| `shape.ts`        | The pipeline's shape before and after the device is known (`initialShape`, `startingSettings`)                                    |
| layer modules     | `tokens.ts`, `walls.ts`, `props.ts`, `terrain.ts`, `lighting.ts`, `ambience.ts`, `effects.ts`, `dice3d.ts`; `fog.ts` is `FogMode` |

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
| Flicker and mist | 20   | 30     | 30   | 30        | the render scheduler (#148) |
| Converge frames  | 0    | 4      | 8    | 16        | TRAA (#110)                 |

Layers (`sky`, `post`, `grass`, `water`, `vfx`, `weather`, `xray`, `dof`) are all off until each
passes its milestone's gates; `?off=sky,grass` turns layers off, for A/B tests and emergencies.
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
animating slowly (`ambient`: `LightingLayer.flicker`, `AmbienceLayer.tick`). One-off changes call
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
- **Each ambient band has its own hues** (#167, interim until the sky of #114): `PRESETS` in
  `lighting.ts` gives the hemisphere a sky and a ground colour per band (moon-blue over deep blue at
  night, peach over slate at dusk, day's warm pair). Only colours change, so a change of band
  compiles nothing. The dark itself is `worldModify`'s, from `lightLevels` (#173 deleted the
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
- **prop and mini**: object space (`positionGeometry.xz`); the models carry no uv.
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

- **Smoke tests** (`fixtures.svelte.spec.ts`, `renderer.svelte.spec.ts` and
  `stability.svelte.spec.ts`, apart so CI runs them side by side): every fixture draws for every
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
   because three.js can change the bytes of built GLBs, and `npm run bundle:check`.
4. Re-baseline the golden images deliberately (`--update`, on Linux or in the pinned Playwright
   image), with before and after images of every changed golden in the PR.
5. Re-run the perf gate locally and `scripts/perf-gpu.mjs` on the reference GPUs (RTX 4060 and the iGPU). Update
   `docs/perf-baseline.json` and `docs/PERFORMANCE.md` with the reason for every change.
6. For Playwright, record the new Chromium revision in `docs/PERFORMANCE.md`, and check that the
   SwiftShader and WebGPU lavapipe flags still behave.
7. Play both adventures on the default tier as a smoke run.

Locally, `npx playwright install chromium` fetches the pinned browser before the client test project
can run.
