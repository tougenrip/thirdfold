# Rendering

How thirdfold draws its world, the decisions behind it, and the rules every renderer change keeps.
The rendering roadmap is tracked in [#107](https://github.com/tougenrip/thirdfold/issues/107),
milestones 61–78.

## Decision: WebGPURenderer with TSL, WebGL2 through its fallback

**Status:** accepted in milestone 61. The go/no-go spike in
[#142](https://github.com/tougenrip/thirdfold/issues/142) confirms it or amends this record with
numbers before any port lands.

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

## Quality tiers

Filled in by milestone 62.

## Render scheduler

Filled in by milestone 62.

## RenderPipeline

Filled in by milestone 63.

## Shader kinds

Filled in by milestone 64.

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
5. Re-run the perf gate and `scripts/perf-gpu.mjs` on the dGPU and iGPU. Update
   `docs/perf-baseline.json` and `docs/PERFORMANCE.md` with the reason for every change.
6. For Playwright, record the new Chromium revision in `docs/PERFORMANCE.md`, and check that the
   SwiftShader and WebGPU lavapipe flags still behave.
7. Play both adventures on the default tier as a smoke run.

Locally, `npx playwright install chromium` fetches the pinned browser before the client test project
can run.
