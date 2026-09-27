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
draw. Hidden one-shot effects compile when they first play.

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

| Module            | What it holds                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | The `Tabletop` interface and its types (re-exported by `renderer.ts`), `TIMED`, `RESHADOWS`                                      |
| `camera.ts`       | `CameraRig`: orbit controls, `viewPose`, view changes, shots, `setPose`                                                          |
| `picking.ts`      | `Picker` (pointer to cell, corner, edge, token, wall, light, prop), `pickKey`, clicks                                            |
| `loop.ts`         | `createNodeRenderer`, the frame hooks r186's own loop ran, live reduced motion                                                   |
| `scheduler.ts`    | The render scheduler: IDLE, AMBIENT, ACTIVE and CONVERGE, the frame-rate cap, pausing when unseen                                |
| `scene-lights.ts` | Hemisphere, sun and lamp; fitting them, the haze and the camera to the table                                                     |
| `table.ts`        | The slab and surface, dressed by the environment                                                                                 |
| `previews.ts`     | Editor previews, the beacon and the highlighted cell                                                                             |
| `perf.ts`         | Frame and update timings, renderer stats, `benchmark`, and the timing wrapper                                                    |
| `quality.ts`      | Quality tiers: `Caps`, the settings table, the starting tier, `?tier=`/`?off=`, the pixel cap, refinement, `thirdfold:graphics`  |
| `capabilities.ts` | `probeCapabilities`, and `QualityControl`: canvas sizing within the tier's megapixels, the sun's shadow size, refinement         |
| `post.ts`         | `Post`: the RenderPipeline per tier (prepass, scene pass, output), its uniforms, `gate`, the warm-up's targets                   |
| `focus.ts`        | `Focus`: depth of field and tilt-shift over the pipeline's sharp image, aimed each frame; `FrameView`                            |
| `passes.ts`       | The pipeline's passes (prepass, overlay, scene), `Stages`, `stagesFor`, the tone mappings                                        |
| `overlay.ts`      | `OverlayLayer`: the overlay's scene, `follow` groups for labels and floats, grid lines masked by floor, fog and darkness         |
| layer modules     | `tokens.ts`, `walls.ts`, `props.ts`, `terrain.ts`, `floor.ts`, `fog.ts`, `lighting.ts`, `ambience.ts`, `effects.ts`, `dice3d.ts` |

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

The goldens and the renderer's smoke tests also run through the WebGPU backend, locally, in the
`client-webgpu` Vitest project, which exists only with `THIRDFOLD_WEBGPU=1`, so `npm test` and CI
never see it:

```bash
npm run test:webgpu                                      # all of it, about 3.5 minutes
npm run test:webgpu -- src/lib/tabletop/golden.svelte.spec.ts --update   # re-record on purpose
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
destroys it in every renderer; `undress` (environment.ts) never does. And two renderers disposing
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
| `scene`   | all        | Everything, with the tier's MSAA samples | `output`: colour, half-float; `emissive`, 8-bit, blended like colour; depth      |
| `prepass` | medium, up | Opaque only, no MSAA                     | `output`: view normals, 8-bit (`packNormalToRGB`); depth                         |
| `overlay` | all        | The overlay's scene (`overlay.ts`)       | `output`: premultiplied, half-float; the prepass's depth (low: the scene pass's) |
| output    | all        | A full-screen quad                       | `renderOutput`: exposure, the tone mapper (`TONE_MAPPING`), sRGB; the overlay    |

- **Tone mapping happens once, at the end.** Inside the pipeline every pass draws linear with no
  tone mapping, so a material's `toneMapped: false` no longer means anything; the fog plane, the
  darkness overlay and the mist are tone mapped with the rest (black stays black). Exposure is
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
  draws. Grid lines, no longer under the floor, fog and darkness planes, fade by those planes'
  textures (`setMasks`, one texel per cell): never over an unexplored cell, dimmer at night. Each
  mask slot keeps one filter (nearest for floor and fog, linear for darkness), because WebGPU fixes
  a sampler's filtering when the material compiles. With `?off=post` the overlay scene is drawn
  over the world on the canvas, without tone mapping.
- **The prepass** draws opaque objects with no MSAA: the overlay's depth, normals for AO (#159)
  and depth of field (#165), and with TRAA each pixel's velocity (half-float).
- **Only a change of stages rebuilds.** `Post.set` compares the prepass, the samples, the
  antialiasing and the tone mapper; in play a change of the first three builds a new renderer
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
- **The output stage** (#161) is one pass (`Post.compose`), in this order: exposure over the scene
  and the bloom; chromatic aberration (red and blue sampled apart radially by the square of the
  distance from the centre, so the centre is untouched); a vignette that multiplies toward
  TaleWeaver's dark purple (0.09, 0.038, 0.208) at 0.33 from a radius of 0.2 to 0.75; the tone
  mapper and sRGB; film grain (interleaved gradient noise, 0.035); the overlay; and a triangular
  dither of ±1 step against banding, never on the overlay. Each is a uniform and a Graphics
  option (Vignette, Chromatic aberration, Film grain; `?off=lens` all three).
  - **The black rule:** every step maps 0 to 0. The vignette multiplies, grain and dither are
    masked by `smoothstep(0, 2/255, luminance)`, and the fog's hidden shade is exactly black
    (`SHADE` 0, 0, 0, `fog: false` so the distance haze never lifts it), so unexplored cells are
    exactly (0, 0, 0) on screen. A test draws black with every effect at full strength and reads
    only zeros; #176 checks it over the fixtures' fogged views.
  - **Grain and dither are seeded by the tabletop's clock** (`uniforms.frameIndex`, 24 steps a
    second), so a held clock holds them still (goldens, the idle table) and they only move on
    frames the scheduler draws. Grain is 0 under reduced motion.
  - **The colour grade** (#162) sits between the tone mapper and the grain: `lut3D` on one 32³
    3D texture (`grade.ts` `GradeBlend`) holding the environment's grade for the viewer's tone
    mapper and the ambient band (`docs/ASSETS.md`), a Graphics option (Colour grading,
    `?off=grade`). A new environment's grade is put in place at once; a change of band or tone
    mapper blends its bytes over 1.5 s on the CPU (the tabletop draws while it does), so the
    shader never changes. Every strip keeps black at 0, checked by the pipeline, and the loader
    forces texel 0 to black against canvas-read noise.
- **Antialiasing** (#163) is one Graphics option with four modes (`AaMode`): off; FXAA on the
  finished colour after the grade (grain, the overlay and dither come after it); MSAA 4× on the
  scene pass; TRAA on the HDR image from the prepass's depth and velocity (r186's `TRAANode`, 32
  Halton offsets), sharpened by RCAS at 0.3. The presets use FXAA on low, MSAA on medium and TRAA
  on high and ultra; compat WebGPU, which has no MSAA, gets FXAA for it. MSAA and converge frames
  follow from the mode (`derive` in `quality.ts`), and a change of mode builds a new renderer.
  TRAA jitters the camera for every pass, so the overlay draws with a copy taken before (labels
  never jitter); bloom reads the unresolved scene.
  - **Converging:** every real change (`RenderScheduler.request`: a setter, the camera, the last
    frame of a tween) restarts CONVERGE at 24 frames with TRAA (12 under power saver, 0 for the
    other modes); the scheduler's own frames (converge and ambient) do not, so a still table
    stops drawing after them and a flickering one keeps its capped ambient rate, accumulating.
    `stats().mode` reports `converge` for them. A test moves a token on TRAA and counts at most 32
    frames from the end of the move to idle, then none.
  - r186's `TRAANode` keeps its 1×1 previous-depth texture past `dispose`: `post.ts` disposes it;
    another 8 bytes stay until the renderer goes, which a change of mode always replaces.
  - Velocity in the prepass is back: the WebGPU errors blamed on it in #157 were the warm-up's
    timed-out compiles and the AO's nesting, both fixed since.
- **Depth of field and tilt-shift** (#165, `focus.ts`) sit after TRAA on the HDR image, before
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
- **`?off=post`** turns the `post` layer off and draws straight to the canvas as before, on both
  backends: the kill switch until #168 removes it.
- Emissive is 8-bit on purpose: a flame's excess above 1.0 reaches bloom through the HDR term
  (#160).
- **Ambient occlusion** (#159) is SSAO (`SSAONode`, self-denoised) from the prepass's depth and
  normals, on medium (half resolution) and up (full); none on low. It costs about 0.7 ms a frame
  at 1080p on the RTX 4060 (WebGPU, medium; #166 measures every pass per tier). It reaches the scene pass's
  materials through `builtinAOContext` (`scenePass.contextNode`), so it scales indirect light only:
  the hemisphere darkens in creases and under things, while torches, lamps and the sun light faces
  as before; transparent materials (fog, darkness, mist, painted floors) and the overlay get none.
  Its reach and depth are per environment, in cells (`AO_LOOKS`, `Post.setLook` on a new table or
  look), all uniforms. `uniforms.aoStrength` (0 with the tier's `ao` off or `?off=ao`) mixes it to
  exactly 1 and `Post.gate` stops its passes, so toggling compiles nothing. The scene pass draws
  what it reads first (`ScenePassNode.drawsFirst`: the prepass, then the AO), each once a frame.
  Three keys a render context by how deeply the pass is nested: a prepass drawn from inside the
  AO's pass one frame and from the overlay's the next compiled everything twice, and an AO drawn
  from inside the scene's own draw, when a material first asked for it, made WebGPU pipelines for
  the wrong targets and aborted the frame. GTAO with temporal filtering waits for TRAA (#163). The
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

## Shader kinds

Filled in by milestone 64.

## Testing the renderer

The client test project (`vite.config.ts`) draws with SwiftShader on an 800×500 viewport, with no
tester UI around the frame. `src/lib/tabletop/testing.ts` mounts any fixture table
(`tests/fixtures`, see `docs/PERFORMANCE.md`) as the GM, a fogged player or a spectator sees it, at
DPR 1, with a clock the test holds still, reduced motion on and the camera at a named pose.

- **Smoke tests** (`renderer.svelte.spec.ts`): every fixture draws for every viewer with no
  `console.error`; the same inputs draw the same pixels; an idle daylight table draws no frames;
  torch flicker stays at the slow ambient rate, and stops at once when the system asks for reduced
  motion; reloading tables leaks no geometry, texture or shader program; cycling the times of day
  compiles nothing new the second time; a disposed tabletop answers no pointer events.
- **Golden images** (`golden.svelte.spec.ts`): the `MATRIX` table lists every image, named
  `<fixture>-<pose>-<band>-<viewer>`. Pixelmatch with threshold 0.1 and at most 0.5% mismatched
  pixels. Only Linux references are committed (`__screenshots__/golden.svelte.spec.ts/`), and the
  spec skips elsewhere; CI is the authority. Diffs land in `.vitest-attachments/`.

**When a golden fails in CI**, the `verify` job uploads the `golden-diffs` artifact
(`.vitest-attachments/`: the reference, the actual image and a diff for each failure; kept 14
days). Download it from the run's page; its reference and actual PNGs are the before and after a
golden PR shows.

**Changing goldens.** Update them only on purpose, on Linux:

```bash
npx vitest run --project client src/lib/tabletop/golden.svelte.spec.ts --update
```

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
