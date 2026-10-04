# Performance

Milestone 34 measured thirdfold on The Hollow Bell's three big tables and fixed the bottlenecks the
measurements showed. This page records how to measure, what was found, what changed, and what was
measured and left alone.

## How to measure

- **In the browser:** add `?perf` to a room's URL. An overlay shows the backend (WebGPU, with
  "(compat)" in compatibility mode, or WebGL2), the GPU as the browser names it, the quality tier
  and scheduler mode (from #147 and #148), frames per second, main-thread ms per frame, GPU ms per
  frame, draw calls, triangles, geometries/textures/shader programs, GPU memory (all of it, and
  textures), and how often and how long lighting was worked out. GPU ms come from timestamp queries,
  which the renderer records only under `?perf` (so normal play never pays for them) and the overlay
  reads every 500 ms, and on WebGPU by pass too (#166: prepass, ao, scene, smaa, traa, dof, blur,
  bloom, output, overlay; `stats().gpu`). A small inspector (`PassNames` in `loop.ts`, installed
  only under `?perf`) remembers the name of what each render draws by its timestamp id, and `passOf`
  in `perf.ts` groups those names (our passes', three's effect quads') into passes. WebGL2 times
  only the whole frame: every pass draws inside the pipeline's last render, and its timer queries do
  not nest, so `gpu` is null there. "n/a" where there are none: WebGL2 without
  `EXT_disjoint_timer_query_webgl2`, or a software GPU (SwiftShader, llvmpipe), whose timestamps
  mean nothing. `?perf&inspector` also opens three.js's Inspector, a chunk of its own fetched only
  then. The page exposes `window.thirdfoldPerf` (the renderer's `stats()`, `resetStats()`, async
  `benchmark(frames)` and `sampleGpu()`) and `window.thirdfoldRoom` (the connection), for the
  scripts below. Timings come from `src/lib/tabletop/perf.ts`.
- **What the counters count:** `drawCalls` and `triangles` are the last drawn frame's, shadow
  passes included (they are drawn inside the frame's render). `programs` counts the node
  renderer's shader stages (vertex and fragment, deduplicated by code), not linked GL programs as
  under the classic renderer, so it only compares with itself and differs between backends;
  `pipelines` counts render pipelines (a pair of stages and the state they draw with), and
  `nodeStates` the node builder's generated code (`shaderCounts` in `perf.ts`, #170, the one place
  that reads three's private caches). The overlay shows programs and pipelines. `memoryBytes` is everything three.js
  tracks on the GPU; `texturesBytes` its textures.
- **Choosing the GPU and the backend:** both scripts below read `PERF_GPU` (`swiftshader`, the
  default, software and the same everywhere; `vulkan`, a real GPU; or `egl`, ANGLE over the
  system's GL) and `PERF_BACKEND` (`webgl`, the default: WebGPURenderer's WebGL2 backend, forced
  with `?backend=webgl`; or `webgpu`), set up in `scripts/perf-browser.mjs`. WebGPU is measured on
  real GPUs only: Chromium's SwiftShader WebGPU drops its instance once a table draws. A run fails
  if the page draws with another backend than asked (WebGPU missing falls back to WebGL2).
- **Deterministic frames:** `createTabletop(canvas, events, options)` takes `TabletopOptions`: an
  animation clock (`now`), a fixed `pixelRatio`, `preserveDrawingBuffer` so a test can read the
  canvas, and a `reducedMotion` override. `setPose(pose)` puts the camera at a named pose. With a
  clock the test holds still, the same table, pose and options always draw the same pixels.
  Labels and die faces are drawn in the bundled Alegreya (`tabletop/label-font.ts`), never in a
  system font.
- **Fixture tables:** `tests/fixtures/scenes` holds fixed tables for rendering tests, perf gates and
  look metrics: five compositions that recreate reference shots (`ref-1` torch room, `ref-3` red
  ruined floor, `ref-6` night gate, `ref-7` minis on grass, `ref-8` walled town block), three stress
  tables (`dungeon-40`, `outdoor-64`, `crowd-60`) and the adventures' tables frozen (`village`,
  `monastery`, `hollow`, `heart`, `railcar`, `ghost-town`). Each has a `<name>.poses.json` of named
  camera poses (`overview`, `close`, `low`, `dark`) in grid terms, which `poseFor` in
  `src/lib/tabletop/poses.ts` turns into a camera pose. `tests/fixtures/views` holds what the GM, a
  fogged player and a spectator are sent for each table in each ambient band, made by the real
  server rules, so client tests render them without importing server code. Rebuild with
  `npx tsx server/fixtures/build.ts`; the frozen adventure tables are rewritten only with
  `--refreeze`. `server/fixtures/*.spec.ts` fail when a committed file is stale, and check that no
  player or spectator view holds a hidden id or ground outside their explored cells.
- **Tables to measure on:** `npx tsx server/perf/scenes.ts data/perf` plays the story with the
  engine and writes a save at each big table (`village.json` 36×28, `monastery.json` 30×20,
  `hollow.json` 48×36, each with its story, two characters and, in the Hollow, the watch).
- **Multiplayer synchronization:** `npx tsx server/perf/sync.ts [moves]` runs a real game server
  with a GM, five players and a spectator over WebSockets on each table. It measures the load, the
  bytes and messages each client gets per move, and the time until the GM and the mover have it.
  It also times the server's per-action view work directly (every viewer's view, then the diffs),
  with a character on a random walk to new cells, and the watch's patrol step.
- **Client (load, scene loading, frames, memory, network):** build, serve and start a server, then
  run `node scripts/perf-client.mjs http://localhost:4173 tests/fixtures/scenes`. See the comment at
  the top of the script. The script uses a GM and two players in Chromium, with reduced motion (no
  flicker or mist, so a table is quiet as soon as it is drawn; the counts are the same), on the
  test world (`server/fixtures/test-world.ts`): one 24×24 table at dusk with a bit of everything
  the renderer draws (a walled hall with a door, a window and furniture, sconces, a brazier, a
  platform three levels up a stair behind a railing, a dark area with a torch, a pond, trees and
  eight figures). `SCENES=a,b` measures other fixture tables instead. It measures the landing
  page, the join form from an invite link, and the table's load (snapshot size, long tasks, what
  each renderer update cost). It then measures idle frames, a fixed orbit of the camera, a move's
  network and main-thread cost, heap after GC, GPU resources after loading the table twice more
  and after leaving and rejoining the room twice, and the bundle sizes (`check-bundle.mjs
--json`). `--json <file>` writes the whole report. A run takes about 30 seconds on the RTX 4060.
- **Perf gate:** `--baseline docs/perf-baseline.json` compares the counters that do not depend on
  the machine's speed with the committed baseline and exits 1 on a regression. It runs locally, not
  in CI (a run takes about 13 minutes, too much of the free build minutes to spend on every PR):
  before merging a PR that touches the renderer, assets, fixtures or the perf scripts, run it and
  paste its table into the PR. The gate fails when:

  | Counter                                                 | Fails when                     |
  | ------------------------------------------------------- | ------------------------------ |
  | Draw calls in the settled frame after the orbit         | more than baseline × 1.10      |
  | Shader programs after a table loads                     | more than baseline             |
  | Shader programs and pipelines per tier (#170)           | not exactly the baseline's     |
  | Geometries, textures, heap after GC (per table, viewer) | more than baseline × 1.10      |
  | Frames in 2 s of idle (motion reduced)                  | more than 0                    |
  | Geometries, textures, programs after three more reloads | above the first load           |
  | The same after three more remounts of the Tabletop      | above the first remount        |
  | Heap after each remount                                 | above the first × 1.10         |
  | "Too many active WebGL contexts" warnings               | any                            |
  | Bundle sizes (`check-bundle.mjs` budgets)               | over budget, or three.js eager |

  Milliseconds are printed, never gated: SwiftShader's timings say little about real GPUs. A
  baseline records the backend it was taken on, and the gate fails against a baseline of another
  backend: `docs/perf-baseline.json` is WebGL2 on the RTX 4060 Laptop, the medium tier's reference
  machine, the scripts' default GPU (`PERF_GPU=vulkan`). Under SwiftShader the node renderer's
  shaders compile on the CPU, three pages at once, which makes runs slow. To change the
  baseline on purpose, run with `--update-baseline docs/perf-baseline.json` on the pinned Chromium
  and say why in the PR.

- **GPU cost of a frame:** `PERF_BACKEND=webgpu node scripts/perf-gpu.mjs [url] [scenes]
[out.json]`, a few seconds. It draws the test world at its overview and close poses for the GM
  and a player at 1920×1080 (`SCENES`, `POSES` for others), with `benchmark`: the GPU's ms per
  frame by timestamp queries (`timestamp`, real GPUs on both backends), else the ms until each
  frame is drawn (`sync`: a pixel read back on WebGL2, `onSubmittedWorkDone` on WebGPU; SwiftShader
  always). The report names the backend and the GPU the browser actually used.
- **Playthrough:** `node scripts/playthrough.mjs [url]`, about 1.5 minutes on the RTX 4060. A GM
  and a player (who takes a character) play every built-in adventure to its end, the GM skipping
  scene by scene and taking each choice's first option. After every step the player's table must
  come to rest (the render scheduler idle or ambient, no warm-up holding it) within 20 s, a token
  move at each new place must animate, and no page may log an error.
- **Asset sizes:** `npm run build` prints each chunk. `npx vite build --sourcemap true` with a
  source-map walk shows what a chunk is made of.
- **Bundle gate:** `npm run bundle:check`, after `npm run build` (CI runs it too). It walks the Vite
  manifest and sums each page's static import closure, gzipped with `node:zlib` at its default
  level. It fails if three.js reaches any page's static imports, or if a page or the renderer goes
  over its budget in `scripts/check-bundle.mjs`. A page's "own" size is what it adds beyond the
  app shell (the entries and the root layout); "renderer (added)" is what loading a table adds on
  top of the room page.

Baselines from milestone 61 on are taken with the pinned Playwright 1.63.0 (Chromium
153.0.8010.12, headless shell revision 1243) and three.js 0.186.0; `docs/RENDERING.md` has the
upgrade procedure.

All numbers below come from a cloud container. The browser is headless Chromium with SwiftShader,
so WebGL is software-rendered on the CPU. Main-thread times and counts (draw calls, bytes,
programs) carry over to real machines. Absolute GPU times do not: SwiftShader's rasterizing is
hundreds of times slower than a GPU, so those numbers are only good for comparing with each other.

## Results

### Asset sizes and initial load

three.js was bundled into the room page, so the join form waited for it.

| Chunk                                         | Before                  | After                                     |
| --------------------------------------------- | ----------------------- | ----------------------------------------- |
| Room page (`/room/[id]`: join form and table) | 744 kB (196 kB gzipped) | 115 kB (36 kB gzipped)                    |
| Renderer and three.js                         | (inside the above)      | 630 kB (160 kB gzipped), loaded on demand |
| Landing page                                  | 43 kB transferred       | 49 kB (prefetches the renderer once idle) |

Of the renderer chunk, three.js is about 414 kB.

The renderer now loads when the table mounts (`tabletop/load.ts`). The landing page and the join
form prefetch it once the browser is idle, so it is usually cached by the time a table shows.

Opening an invite link (cold cache, median of 3):

| Connection                         | Before                      | After                      |
| ---------------------------------- | --------------------------- | -------------------------- |
| Local                              | join form after 244 ms      | 207 ms                     |
| Slow 4G (1.6 Mbps, 150 ms latency) | 1798 ms, 248 kB transferred | 1299 ms, 95 kB transferred |

**Milestone 61 re-measure.** Between milestones 34 and 60, three.js crept back into the room page:
rolldown put modules that both the page and the lazy renderer import (`dice-throw.ts`, and the
Build panel's floor swatches from `tabletop/floor.ts`) into one chunk with three.js. The fix moved
the renderer-only parts into `dice-faces.ts` and the swatch colours into `floor-looks.ts`, gave
three.js its own chunk (`vite.config.ts`), and added the bundle gate. Measured with
`npm run bundle:check` (Vite 8.3.0, rolldown 1.2.10):

| Closure (gzipped)       | Before the fix          | After    | What the page adds beyond the shell |
| ----------------------- | ----------------------- | -------- | ----------------------------------- |
| Room page `/room/[id]`  | 167.5 kB, with three.js | 109.7 kB | 68.8 kB                             |
| Landing `/`             | 57.6 kB                 | 57.6 kB  | 16.7 kB                             |
| Library `/library`      | 59.8 kB                 | 59.8 kB  | 18.9 kB                             |
| Builder `/builder`      | 88.2 kB                 | 88.2 kB  | 47.3 kB                             |
| Renderer, added on load | 118.8 kB                | 178.2 kB | (lazy, budget 360 kB)               |

(The "before" totals here count the app shell too, so they are larger than milestone 34's
per-chunk figures.) The room page's own code is now 68.8 kB gzipped against 36 kB in milestone 34. three.js is no longer in it; the UI itself grew in milestones 35–40.

### Multiplayer synchronization

After every action the server works out each viewer's view (fog, light, rooms, the story) and
sends each client the difference. The profile of that work was almost entirely line of sight.
Each token's vision was worked out again for every viewer who shares it (its player, spectators,
the GM's shading). All the table's light was worked out again on every sync, and again for every
sentry on every patrol step.

`SightCache` (in `src/lib/game/visibility.ts`) keeps each sight: a source at a cell with a radius,
whether a token's vision or a light's reach. It is kept on the room and used by the views and by
the enemies' light (`sightsFor` in `server/scene.ts`). It is kept while the walls, doors, windows,
props and ground stay the same, compared by content, and cleared when they change. Unioning cached
sights gives exactly what the old shared-mask computation gave (tested). Most actions move one
token, so a sync now works out one sight.

Measured with 7 viewers, a character on a random walk to new cells:

| Table            | Views per action | Diffs  | Move reaches GM and mover (median) | Patrol step (3 sentries) |
| ---------------- | ---------------- | ------ | ---------------------------------- | ------------------------ |
| Village 36×28    | 5.16 → 2.46 ms   | 0.7 ms | 6.4 → 3.4 ms                       |                          |
| Monastery 30×20  | 7.13 → 1.12 ms   | 0.4 ms | 9.3 → 2.3 ms                       |                          |
| The Hollow 48×36 | 10.66 → 2.11 ms  | 1.2 ms | 22.7 → 4.6 ms                      | 14.3 → 1.5 ms            |

### Network traffic (measured, unchanged)

This is already small, so nothing changed:

| Table      | Snapshot (on load)      | Per move                                    |
| ---------- | ----------------------- | ------------------------------------------- |
| Village    | GM 30 kB, players 5 kB  | 0.2–0.7 kB per client (mostly the fog mask) |
| Monastery  | GM 20 kB, players 6 kB  | 0.1–0.2 kB per client                       |
| The Hollow | GM 36 kB, players 31 kB | 0.2–0.9 kB per client                       |

Players' Hollow snapshot is larger because they remember the whole cavern's shape. Diffs send only
what changed per viewer.

### Scene loading

Each table reaches every client within 18–41 ms of the import. On the client:

- **Light was worked out once per update.** A new table brings the grid, tokens, walls, props, fog
  and lights together, so it was worked out 6–9 times (27.9 ms for the GM in the village). It is
  now marked stale and worked out once before the next frame: 6.4 ms. A move now works it out once,
  instead of twice.
- **Shaders were recompiled when the time of day changed.** Turning the sun's shadows off in the
  dark changed every material's shader, so moving between day and the dark Hollow recompiled
  everything (11 → 15 programs, growing to 17 over repeated loads). The sun now always casts and
  its shadows are simply not redrawn while it is out. The program count stays at 11–12 across
  every table and every load.
- **What's left is the first frame's GPU work.** One page loading the Hollow spends about 240 ms of
  main thread in the first frame, 160 ms of it waiting on shader compiles. The multi-second long
  tasks the script reports with three pages come from software rendering competing for the CPU.

### Frame rate and GPU

Main-thread time per frame is 1–6 ms on every table, so frame rate is limited by the GPU. The
renderer draws only when something changes. After dusk, flames flicker and mist drifts on a slow
timer (80 ms, the render scheduler's AMBIENT mode since M62), by design since M15.

- **The sun's shadow pass redrew the whole scene on every frame,** including frames where only the
  camera moved or flames flickered. That nearly doubled the draw calls. It is now redrawn only when
  something on the table changed (an update from the room, or something moving) and the sun is up.

  | Draw calls per frame, camera moving | Before   | After    |
  | ----------------------------------- | -------- | -------- |
  | Village, GM                         | 287      | 161      |
  | Village, player                     | 48       | 32       |
  | Monastery, GM                       | 216      | 119      |
  | Monastery, player                   | 74       | 45       |
  | The Hollow (dark, sun out)          | 113 / 98 | 113 / 98 |

  Since M67 (#215) the key light moves with the hour, and the map is also redrawn when the light
  has turned `SHADOW_STEP_DEG` (0.5°) or switched between sun and moon (`shadowFrame` in
  `atmosphere.ts`), never while its strength is 0. A day swept a minute at a time redraws 481 times
  (two body switches); noon to 13:00, 21; noon to 18:30, 131. A 3 s tween across hours redraws on
  most of its frames (bounded by the frames it draws, all in ACTIVE); at the running clock's one
  game minute a second (#324) that is about one redraw every 2 s. A tween frame costs one
  `atmosphereAt` (about 1 µs in Node) and a handful of uniform writes; the lamp's point light went
  (#218), one light fewer per lit fragment.

- **Software GPU experiments.** With `perf-gpu.mjs` (GPU ms per frame under SwiftShader, 1400×900):

  | Change                      | Effect  |
  | --------------------------- | ------- |
  | No shadows at all           | −15%    |
  | No antialiasing             | −18%    |
  | 2 point lights instead of 8 | −20–30% |
  | A quarter of the pixels     | −50%    |

  The cost is per-pixel shading, which a real GPU does in hardware. Lowering quality for software
  rendering was not worth it, so antialiasing, the light pool and resolution are unchanged.

### Post-processing per pass and per tier (milestone 63, #166)

GPU ms per frame by pass, with WebGPU's timestamps (`PERF_BACKEND=webgpu TIER=<tier>
SCENES=ref-3,village,monastery,hollow POSES=overview node scripts/perf-gpu.mjs`, 48 frames, the
GM's overview at 1920×1080, reduced motion: depth of field and tilt-shift, which only shots and the
Miniature option turn on, are off). The ranges run over the four tables; "post" is AO, TRAA, bloom
and the output stage, the passes this milestone added (the overlay is the old overlays' cost,
moved).

RTX 4060 Laptop (the medium tier's reference):

| Tier   | prepass   | ao        | scene     | traa      | bloom     | output    | overlay   | post      | frame   |
| ------ | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | ------- |
| low    | –         | –         | 0.33–0.91 | –         | 0.06–0.22 | 0.15–0.47 | 0.01–0.04 | 0.21–0.65 | 0.5–1.6 |
| medium | 0.07–0.12 | 0.26–0.51 | 1.4–3.2   | –         | 0.21–0.41 | 0.29–0.57 | 0.02–0.05 | 0.76–1.5  | 2.3–4.8 |
| high   | 0.09–0.19 | 0.23–0.47 | 0.60–0.96 | 0.31–0.55 | 0.16–0.32 | 0.19–0.39 | 0.01–0.02 | 1.0–1.7   | 1.8–2.9 |
| ultra  | 0.10–0.14 | 0.75–1.5  | 0.50–0.66 | 0.36–0.49 | 0.18–0.23 | 0.21–0.29 | 0.01–0.02 | 1.5–2.3   | 2.3–3.0 |

Intel Graphics (Raptor Lake-S, Gen12, the low tier's reference):

| Tier   | prepass   | ao        | scene     | traa    | bloom     | output  | overlay   | post      | frame     |
| ------ | --------- | --------- | --------- | ------- | --------- | ------- | --------- | --------- | --------- |
| low    | –         | –         | 5.5–7.9   | –       | 0.59–0.69 | 2.3–3.5 | 0.07–0.09 | 2.9–4.2   | 8.8–10.9  |
| medium | 0.53–0.96 | 3.3–5.3   | 15.4–21.8 | –       | 2.7–3.1   | 3.1–4.5 | 0.09–0.11 | 9.1–12.9  | 25.5–35.7 |
| high   | 1.1–1.5   | 3.0–4.9   | 6.4–10.9  | 4.0–4.2 | 1.4–1.5   | 2.4–2.5 | 0.02–0.03 | 11.0–13.1 | 18.5–25.4 |
| ultra  | 1.1–1.5   | 12.0–19.8 | 6.5–11.3  | 4.0–4.3 | 1.4–1.6   | 2.4–2.5 | 0.02–0.03 | 19.9–28.1 | 28.1–40.8 |

Against the starting budgets for post at 1080p on the iGPU (low about 1–1.5 ms, medium 3–4.5 ms,
high 5–8 ms), the RTX is far inside every one, and the iGPU is over all three, by about two to
three times:

- **Low:** 2.9–4.2 ms, almost all the output stage (2.3–3.5 ms: the three chromatic aberration
  taps of scene and bloom, the tone mapper, the 3D grade, then FXAA through a target of its own).
- **Medium:** 9.1–12.9 ms: AO at half resolution 3.3–5.3, bloom 2.7–3.1 (half resolution), the
  output stage 3.1–4.5. The scene pass itself, MSAA 4× on half-float colour with an 8-bit emissive
  attachment, is the frame's biggest cost at 15–22 ms.
- **High and ultra:** high 11–13 ms, ultra 20–28 ms. Since the loose ends of #159 both run GTAO
  resolved by TRAA (high at half resolution: 3–5 ms, where full-resolution SSAO took 12–17;
  ultra at full resolution, 12–20 ms) and TRAA takes about 4 ms; the scene pass (no MSAA) is
  6–11 ms. The high and ultra rows were measured again on 28 September, a day after the others,
  and the passes GTAO did not touch came in lower too, so part of the difference is the machine.

The starting tier already keeps an integrated GPU off high, but medium, its tier, draws at 26–36 ms
a frame at 1080p (about 30 fps), and the refinement lowers it to low (9–11 ms) on a slow frame.
With GTAO at half resolution, high (19–25 ms) now costs the iGPU less than medium (26–36 ms):
medium's MSAA 4× scene pass outweighs TRAA and GTAO. Where the time goes is now measured; which
defaults to change for integrated GPUs (MSAA off on medium, AO and bloom at a quarter, a cheaper
output stage) is the G1 review's call.

On WebGL2 (the same runs with `PERF_BACKEND=webgl`) only the frame total is timed, and it is
higher: on the RTX low 2.0–4.6 ms, medium 3.9–9.9, high 2.8–4.7 (one village run at 26); on the
iGPU low 9.1–12.1, medium 32–67, high 60–92. WebGPU is the faster backend on both machines.

**Render-target memory per tier** (the perf gate, Ana's view of the test world at 1400×900, WebGL2
on the RTX): `scripts/perf-client.mjs` records `renderTargets` and texture bytes per tier in
`docs/perf-baseline.json`, and fails when either rises. The post chain's share was measured
against `?off=post` (each tier drawn straight to the canvas) until #168 removed that path.

| Tier   | Render targets | Texture bytes | Of which the post chain |
| ------ | -------------- | ------------- | ----------------------- |
| low    | 17             | 46.0 MB       | 25.7 MB                 |
| medium | 27             | 127.1 MB      | 79.8 MB                 |
| high   | 30             | 162.6 MB      | 115.3 MB                |

Before #166 the overlay's GPU ms under-reported: three's resolve returns only the last frame's
total, which `sampleGpu` divided by every frame since the last sample. It now sums every timed
render.

### Shader programs under runtime state (milestone 64, #170)

`src/lib/tabletop/program-count.svelte.spec.ts` warms the test world up (every environment drawn
once, the village, Hollow and Heart visited once), then changes everything that changes at
runtime one named step at a time and fails when a step changes the programs or pipelines. Counts
after the warm-up, GM view, reduced motion (28 September 2026; SwiftShader WebGL2 in the `client`
project, the RTX 4060 Laptop's WebGPU in `client-webgpu`):

| Tier   | WebGL2 programs | WebGL2 pipelines | WebGPU programs | WebGPU pipelines |
| ------ | --------------- | ---------------- | --------------- | ---------------- |
| low    | 142             | 123              | 143             | 126              |
| medium | 205             | 172              | 207             | 177              |
| high   | 211             | 173              | 212             | 178              |

Environments, the times of day, every floor, fog off and on in both modes, fully visible,
explored and unseen fog, dark areas, 0, 1 and 12 lights (past a cell's K on low, medium and high), recolouring and
switching them, a token carrying light, a token without a model, fallen and enemy turns, props
selected, hovered, hidden and moved, both cues and travel between four tables of three sizes change
none. Of `KNOWN` in the spec (each compile still left, with the issue that ends it) #180 ended both
entries: the first selection (+1 vertex, +1 fragment) and the first turn marker (+1 fragment)
compiled because the ring and the marker live in the overlay scene, which the warm-up did not
compile. It now compiles the overlay's pass too, and stand-ins for everything that shows only later
(the ring and marker, a die, the toll's dust and shadow; the first frame after a warm-up draws them
once, far below the table, for what only a draw makes: a die's shadow-pass material). The sweep
also throws a die (at rest, fading, gone), plays the toll with motion (its dust and shadow shown)
and, on low, switches anti-tiling back and forth. That adds the one entry `KNOWN` holds now: the
first switch of anti-tiling in place compiles the table's, walls' and raised ground's twins' vertex
stages (every InstancedMesh has its own, and a compile declares a shadowed material's uniforms in
another order than the draw), in the hold the switch starts; switching back and again compiles
nothing, since the twins are kept (`twinOf`).

#172 ended two more by putting the layers on the shader kinds: hiding a token (which toggled
`transparent` on the mini's own materials; the mini kind's hidden token is a screen-door dither on
a per-object uniform) and, on WebGPU, table travel releasing and rebuilding two pipelines. The
counts above are from before #172.

Node states (generated code) go up and down by 2-3 on every table travel with no program change:
reported, not failed. `?perf` shows programs and pipelines, and the perf gate records both per
tier, exactly (`scripts/perf-client.mjs`; shown, not failed, until the baseline is next written).

### Fog and darkness in the materials (milestone 64, #173)

The fog plane and the darkness overlay are gone (every material's `worldModify` draws both), and
with them two transparent planes over the whole grid and their overdraw: 129 → 127 draw calls for
the GM and 65 → 63 for a player on the test world, dusk and dark (medium, SwiftShader WebGL2 in the
`client` project; the floor plane, also deleted, had drawn nothing since #172). Programs don't
rise (`program-count.svelte.spec.ts` passes unchanged on every tier and both backends). The scene
pass gains an 8-bit `hidden` attachment, and the output stage one more fetch. Real-GPU numbers
come with the perf gate before the PR.

### What milestone 64 costs, and what the perf gate still measures

What the kinds and the world term cost per fragment (`docs/RENDERING.md`, "Materials and world
visibility"), worked out from the graphs:

| Where                         | Fetches a fragment                                               | ALU                                                 |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| every kind (`worldModify`)    | 3 cell-map fetches (visibility texel and bilinear, ground texel) | one `mx_noise_float` for the soft edge (#174)       |
| surface, terrain (low)        | one per slot, box mapping (#177); terrain one more ground texel  | fractal macro variation (#181)                      |
| surface, terrain (medium, up) | two per slot, anti-tiling (#181)                                 | the noise index and the blend, macro variation      |
| rock                          | three per slot, triplanar (#177)                                 | Whiteout normal blend, macro variation              |
| prop, mini                    | one per slot, plus six for paint (#178)                          | the derivative frames; strength 0 on low still runs |
| fog cloud (layer off)         | none: not drawn                                                  | on: fractal noise per vertex, up to 64k vertices    |
| output stage                  | one more (`hidden`, the re-mask, #173)                           |                                                     |

Measured so far, all on SwiftShader WebGL2 in the `client` project (a software rasteriser on a
loaded machine, so ratios, not budgets):

- **Draw calls**: the fog and darkness planes' going took 129 → 127 for the GM and 65 → 63 for a
  player on the test world (#173, above). The fog cloud adds one while its layer is on (off).
- **Programs**: the village on medium went 164 → 178 with the layers on the kinds (#172), and the
  per-tier table above is from before that; the lobby's warm-up leaves a table to compile fewer
  (the test world: 158 cold, 110 after the lobby, #180, `lobby.svelte.spec.ts`).
- **Frame and mount**: a benchmarked frame 2.0 → 3.5 s and a mount 5 → 10 s against the classic
  materials (medium, the village), anti-tiling about a third of the difference (#172, #181).
- **Filtering** (#179): anisotropy 4, 8 and 16 by tier and the mip bias change no program; a tier
  switch re-uploads the registered world textures once.
- **Reveal fades** (#174) rewrite the `ground` map only while a fade runs (450 ms), and keep the
  scheduler drawing for that long; soft edges cost nothing between frames.

**Measured on real GPUs before the PR** (29 September 2026; the same runs as #166's table:
`PERF_BACKEND=webgpu TIER=… SCENES=ref-3,village,monastery,hollow POSES=overview
scripts/perf-gpu.mjs`, 48 frames, the GM's overview at 1920×1080, reduced motion, the fog cloud
off). GPU ms per frame, and of it the scene pass, where the kinds and `worldModify` run, against
M63's:

| GPU           | Tier   | Frame, M63 | Frame, M64 | Scene pass, M63 | Scene pass, M64 |
| ------------- | ------ | ---------- | ---------- | --------------- | --------------- |
| RTX 4060      | low    | 0.54–1.6   | 1.1–2.8    | 0.33–0.91       | 0.81–2.0        |
| RTX 4060      | medium | 2.3–4.8    | 5.6–7.5    | 1.4–3.2         | 4.0–5.8         |
| RTX 4060      | high   | 1.8–2.9    | 2.7–5.1    | 0.60–0.96       | 1.2–2.6         |
| Intel (RPL-S) | low    | 8.8–10.9   | 11.4–19.4  | 5.5–7.9         | 9.3–17.4        |
| Intel (RPL-S) | medium | 25.5–35.7  | 31.4–53.4  | 15.4–21.8       | 22.9–43.6       |
| Intel (RPL-S) | high   | 18.5–25.4  | 38.1–54.6  | 6.4–10.9        | 21.9–37.6       |

The scene pass costs about two to three times what it did: every fragment now fetches the cell
maps and runs the soft edge's noise, props and minis add paint's six fetches, and medium and up
fetch every surface slot twice for anti-tiling. On the RTX every tier stays well inside a 60 fps
frame; on the integrated GPU, already over M63's post budgets, high doubles and medium and low
grow by a third to a half. This is G1's finding for the review: the cheapest cuts are the
anti-tiling (a third of the difference on SwiftShader), paint on medium (strength 0 on low still
runs its fetches; a variant without them would not) and the soft edge's noise on low.

The perf gate (`node scripts/perf-client.mjs --baseline docs/perf-baseline.json`, the test world
on the RTX 4060, WebGL2) was re-baselined deliberately:

- programs 131 → 164 (the kinds and their variants; now also recorded per tier with pipelines:
  low 99 programs and 69 pipelines);
- textures 63 → 70 (the cell maps, the paint maps and the slots' blanks), heap about +0.7 MB;
- texture bytes per tier up 1.3 MB on medium and high (the paint maps and the cell maps) and
  5.3 MB on low, whose extra 4 MB was not investigated;
- draw calls 119 → 116 after orbiting (the fog and darkness planes are gone); 0 frames idle;
  60 fps orbiting; reloads and remounts leak nothing.

Still not measured: the fog cloud's cost with its layer on, the first frame after the lobby's
warm-up in a real browser (`?perf` discards the lobby's renderer), and anisotropy 16 against 4 on
the integrated GPU alone.

### Memory

- Heap after GC is 6.6–8.6 MB per client on every table.
- Loading the three tables twice more leaves geometries (20) and textures (8) where they were, and
  now shader programs too (12). Before, programs grew from 15 to 17.
- The heap grows by about 0.4 MB over six loads. That is the room log, which is capped at
  `LOG_LIMIT`.

## Before the rendering overhaul (milestone 61)

Real-GPU baselines of today's `WebGLRenderer`, before milestone 62 changes the backend. Measured
with `scripts/perf-gpu.mjs` on a laptop with both proxy GPUs (Linux 7.0, NVIDIA driver 595.91,
Mesa for Intel; Chromium 153.0.8010.12 from Playwright 1.63.0; three.js 0.186.0; September 2026).
Each number is the median GPU time of 16 frames of that view from WebGL2 timer queries, in ms.
The GM sees everything; the player is fogged. A few 1400×900 numbers run high where the GPU had
not yet clocked up (the first views of a run); the 1920×1080 column is the steadier one.

**RTX 4060 Laptop (discrete; the middle of the scale, the reference card for the medium tier).** `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0)), NVIDIA)`.

| Table      | Pose     | GM 1400×900 | GM 1920×1080 | Player 1920×1080 | Draws (GM) | Programs |
| ---------- | -------- | ----------- | ------------ | ---------------- | ---------- | -------- |
| village    | overview | 0.52        | 3.21         | 1.72             | 110        | 16       |
| village    | close    | 0.64        | 2.99         | 2.18             | 39         | 16       |
| village    | low      | 0.47        | 2.05         | 1.35             | 19         | 16       |
| monastery  | overview | 0.47        | 0.67         | 0.60             | 66         | 16       |
| monastery  | close    | 0.78        | 1.23         | 1.20             | 33         | 16       |
| monastery  | low      | 0.62        | 1.00         | 1.58             | 21         | 16       |
| hollow     | overview | 0.61        | 3.51         | 2.32             | 72         | 16       |
| hollow     | close    | 1.11        | 3.31         | 2.12             | 35         | 16       |
| hollow     | low      | 1.10        | 3.05         | 2.11             | 61         | 16       |
| ref-1      | overview | 0.67        | 1.00         | 1.00             | 30         | 17       |
| ref-1      | close    | 0.61        | 0.90         | 0.90             | 29         | 17       |
| ref-1      | low      | 0.57        | 0.89         | 1.53             | 22         | 17       |
| ref-6      | overview | 0.63        | 0.94         | 0.94             | 28         | 17       |
| ref-6      | close    | 0.82        | 1.29         | 1.29             | 28         | 17       |
| ref-6      | low      | 0.62        | 1.00         | 1.56             | 18         | 17       |
| ref-7      | overview | 0.52        | 0.77         | 0.77             | 85         | 17       |
| ref-7      | close    | 0.70        | 1.09         | 1.09             | 82         | 17       |
| ref-7      | low      | 0.58        | 0.92         | 0.92             | 52         | 17       |
| ref-8      | overview | 4.28        | 0.99         | 0.99             | 44         | 17       |
| ref-8      | close    | 3.52        | 1.54         | 1.53             | 19         | 17       |
| ref-8      | low      | 1.91        | 1.21         | 1.20             | 17         | 17       |
| dungeon-40 | overview | 3.15        | 3.53         | 1.76             | 138        | 17       |
| dungeon-40 | close    | 2.75        | 2.58         | 2.37             | 20         | 17       |
| dungeon-40 | low      | 1.79        | 2.05         | 1.75             | 20         | 17       |
| outdoor-64 | overview | 0.62        | 0.89         | 0.89             | 10         | 17       |
| outdoor-64 | close    | 0.88        | 1.45         | 1.45             | 10         | 17       |
| outdoor-64 | low      | 0.75        | 1.19         | 1.20             | 10         | 17       |
| crowd-60   | overview | 0.68        | 0.98         | 0.98             | 245        | 17       |
| crowd-60   | close    | 0.80        | 1.25         | 1.25             | 196        | 17       |
| crowd-60   | low      | 0.69        | 1.07         | 1.84             | 91         | 17       |

Slowest at 1920×1080: dungeon-40 overview (GM), 3.53 ms.

**Intel Raptor Lake-S UHD (integrated; the low tier's reference).** `ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (RPL-S) (0x0000A788)), Intel open-source Mesa driver)`.

| Table      | Pose     | GM 1400×900 | GM 1920×1080 | Player 1920×1080 | Draws (GM) | Programs |
| ---------- | -------- | ----------- | ------------ | ---------------- | ---------- | -------- |
| village    | overview | 11.95       | 15.10        | 12.49            | 110        | 16       |
| village    | close    | 14.34       | 18.14        | 18.38            | 39         | 16       |
| village    | low      | 11.37       | 15.20        | 11.09            | 75         | 16       |
| monastery  | overview | 8.73        | 13.61        | 12.02            | 66         | 16       |
| monastery  | close    | 17.28       | 23.60        | 22.45            | 42         | 16       |
| monastery  | low      | 12.45       | 21.52        | 20.06            | 45         | 16       |
| hollow     | overview | 12.15       | 16.15        | 16.51            | 72         | 16       |
| hollow     | close    | 24.94       | 37.53        | 37.69            | 34         | 16       |
| hollow     | low      | 22.61       | 38.65        | 39.66            | 60         | 16       |
| ref-1      | overview | 11.71       | 22.18        | 22.89            | 30         | 17       |
| ref-1      | close    | 12.35       | 16.94        | 16.92            | 30         | 17       |
| ref-1      | low      | 13.64       | 17.54        | 20.23            | 30         | 17       |
| ref-6      | overview | 12.76       | 16.52        | 18.14            | 28         | 17       |
| ref-6      | close    | 14.43       | 26.23        | 24.01            | 28         | 17       |
| ref-6      | low      | 12.47       | 18.52        | 21.21            | 28         | 17       |
| ref-7      | overview | 7.92        | 12.24        | 16.42            | 85         | 17       |
| ref-7      | close    | 13.63       | 16.52        | 17.74            | 85         | 17       |
| ref-7      | low      | 10.16       | 18.26        | 24.04            | 85         | 17       |
| ref-8      | overview | 14.72       | 19.50        | 20.47            | 44         | 17       |
| ref-8      | close    | 18.33       | 32.45        | 32.26            | 29         | 17       |
| ref-8      | low      | 15.64       | 23.46        | 24.34            | 36         | 17       |
| dungeon-40 | overview | 10.85       | 15.77        | 15.93            | 138        | 17       |
| dungeon-40 | close    | 14.49       | 22.79        | 25.02            | 20         | 17       |
| dungeon-40 | low      | 12.57       | 21.38        | 19.59            | 20         | 17       |
| outdoor-64 | overview | 10.36       | 14.57        | 18.99            | 10         | 17       |
| outdoor-64 | close    | 17.00       | 29.20        | 28.24            | 10         | 17       |
| outdoor-64 | low      | 13.23       | 21.76        | 21.08            | 10         | 17       |
| crowd-60   | overview | 11.44       | 13.91        | 20.38            | 245        | 17       |
| crowd-60   | close    | 12.98       | 24.87        | 24.92            | 218        | 17       |
| crowd-60   | low      | 14.98       | 20.24        | 23.13            | 208        | 17       |

Slowest at 1920×1080: hollow low (Ana), 39.66 ms.

**What this says.**

- **The middle of the scale has headroom.** The RTX 4060 Laptop is the reference card for the
  medium tier: everything the default look adds must fit its budget there. Every view draws in
  0.5–3.5 ms at 1080p today.
- **The integrated GPU is the low tier, and already over budget.** Today's plain look costs 12–40 ms
  per frame at 1080p on the iGPU. Close,
  low-angle views of large lit tables are the worst: the Hollow at 38–40 ms, ref-8 close 32 ms,
  the 64×64 outdoor table close 29 ms. The cost is per pixel (draw counts are small, from 10 to
  245), which points at fill and lighting: 8 point lights on every lit fragment, full-screen
  transparent overlays (fog, darkness, floor), and MSAA. Milestone 62's low tier must start integrated
  GPUs below 2 MP, or with fewer lights, before any new effect is added.
- **Draw calls are modest** (the most is 245, crowd-60) and shader programs 16–17 on every
  table, so batching is not today's bottleneck.

## Not changed, and why

- **three.js's size.** It is already split out and prefetched. Replacing namespace imports with
  named ones would save little, since three's core is not very tree-shakeable.
- **Per-move messages.** They are 1 kB or less.
- **The GM's larger view.** The GM sees everything by design.
- **Ambient flicker and mist at dusk.** These are an intended look. They run on a slow timer, only
  when visible, and are off with reduced motion.

## Manifest v2 (#184)

`static/assets/manifest.json`, the one fetch before any asset loads, before and after manifest
v2 (the same 69 models, 64 textures and 2 sounds; gzip -9):

| Manifest | Bytes  | Gzipped |
| -------- | ------ | ------- |
| v1       | 32,061 | 4,781   |
| v2       | 52,140 | 10,605  |

Most of the growth is the whole SHA-256 of each of the 135 files, which does not compress
(135 × 64 hex digits is 8.6 kB), and each texture's usage, colour space, layers, levels and GPU
bytes. It stays one fetch, cached by the browser like the rest of the page.

## Asset budgets

What one table's assets may add up to (`TABLE_BUDGETS` in `server/assets/scenes.ts`, #193), from
the roadmap's first-table download and GPU memory budgets. The build fails over any of them.

| Tier    | Download | GPU    | Counted at texture detail                 |
| ------- | -------- | ------ | ----------------------------------------- |
| Desktop | 15 MB    | 160 MB | medium (1K), the reference tier's default |
| Mobile  | 6 MB     | 80 MB  | low (512), what phones start on           |

MB here is 1024 × 1024 bytes, as in the manifest's `LIMITS`. Mobile's download is the roadmap's
mobile first-table budget, stricter than half the desktop's; its GPU figure counts the 512 px bases
(texture detail's low, which the low tier and phones default to) and KTX2 at RGBA8 (four times the
manifest's `gpuBytes`, which assume a compressed transcode target), what a phone the transcoder
finds no compressed format on gets; a cooked model's whole `gpuBytes` is counted so, geometry too,
a bound rather than the figure. Each level counts a variant's download after its base (which
always loads first) and its GPU bytes instead. High (2K) is reported, not held to the budgets:
see below. These are starting values, confirmed per tier in #155: change them only on purpose,
with the reason here.

What is counted is in [ASSETS.md](ASSETS.md#rules-the-pipeline-enforces). Totals with the assets
of milestone 64 (`npm run assets`; kB of 1024 bytes), and with #190's bevelled, baked part lists
(normals and `_BAKE` in every model file):

| Table                   | Download (M64 → #190) | GPU (M64 → #190)  | Mobile GPU |
| ----------------------- | --------------------- | ----------------- | ---------- |
| hollow-bell/bellweather | 519 kB → 855 kB       | 1176 kB → 1460 kB | 1460 kB    |
| hollow-bell/monastery   | 443 kB → 725 kB       | 1052 kB → 1290 kB | 1290 kB    |
| hollow-bell/hollow      | 401 kB → 653 kB       | 1100 kB → 1313 kB | 1313 kB    |
| hollow-bell/heart       | 300 kB → 479 kB       | 905 kB → 1057 kB  | 1057 kB    |
| blackwater/train        | 383 kB → 620 kB       | 979 kB → 1178 kB  | 1178 kB    |
| blackwater/engine       | 260 kB → 405 kB       | 870 kB → 992 kB   | 992 kB     |
| blackwater/blackwater   | 254 kB → 399 kB       | 864 kB → 986 kB   | 986 kB     |
| example/yard            | 191 kB → 279 kB       | 882 kB → 957 kB   | 957 kB     |
| example/cellar          | 171 kB → 251 kB       | 808 kB → 876 kB   | 876 kB     |

Part-list triangles (#190): 25,848 → 37,660 over the 69 models, their files 692 → 1,200 kB. A box
is 12 → 44 triangles, a cylinder 72 → 144 and a cone 36 → 72; spheres are unchanged. Some models:
crate 24 → 88, barrel 216 → 432, great-bell 592 → 932, warden 616 → 960, tentacle 1,308 → 1,560,
hound 1,136 → 1,628 (the largest now), each far under its class's limit. Draw calls and programs
are unchanged: the bevels are in the same meshes, and every prop and mini geometry carries the
bake (`withBake`).

Each environment alone is 56–68 kB to download and 683–789 kB on the GPU. Every table is under
4% of the mobile download budget at M64, and under 15% with #190's baked models: the part-list
models and 128 px textures are small. The budgets start to bite with the cooked models and
surface sets (#186, #187). Record the totals here again at each milestone.

With the surface library (#187) and the cooked bell (#196), KTX2 counted at RGBA8 on mobile: the
largest table, the Hollow, is 4,805 kB to download, 11,208 kB on the GPU and 40,972 kB on a mobile
GPU (51% of its 80 MB); every other table is 2.4–3.6 MB, 5.8–7.6 MB and 21–26 MB.

With texture detail (every texture at a 512 px base, 1K and 2K variants in the asset store;
recipes rendered at 512 rather than 64–256), per level (`npm run assets`, kB):

| Table                   | Download low | medium | high   | GPU low | medium | high    | Mobile GPU |
| ----------------------- | ------------ | ------ | ------ | ------- | ------ | ------- | ---------- |
| hollow-bell/bellweather | 3,775        | 12,553 | 32,450 | 11,444  | 42,164 | 160,948 | 29,876     |
| hollow-bell/monastery   | 3,518        | 11,669 | 30,777 | 11,338  | 42,058 | 160,842 | 29,770     |
| hollow-bell/hollow      | 4,368        | 14,708 | 37,877 | 14,600  | 52,488 | 199,944 | 38,988     |
| hollow-bell/heart       | 2,957        | 10,027 | 25,614 | 8,737   | 32,289 | 122,401 | 24,097     |
| blackwater/train        | 3,356        | 11,390 | 29,443 | 9,882   | 36,506 | 138,906 | 28,314     |
| blackwater/engine       | 3,142        | 11,175 | 29,228 | 9,696   | 36,320 | 138,720 | 28,128     |
| blackwater/blackwater   | 3,136        | 11,169 | 29,222 | 9,690   | 36,314 | 138,714 | 28,122     |
| example/yard            | 3,200        | 11,977 | 31,875 | 10,941  | 41,661 | 160,445 | 29,373     |
| example/cellar          | 3,044        | 11,195 | 30,303 | 10,924  | 41,644 | 160,428 | 29,356     |

Every table fits at low (mobile: at most 4.4 MB of 6 and 39 of 80 MB) and at medium (desktop: the
Hollow is 14.7 of 15 MB to download, the tightest). At high every table is over the desktop
download budget (25–38 MB) and the Hollow over its GPU budget (195 MB): a recipe's 2K PNG is
21 MB on the GPU (seven or eight of them per table: the materials' maps, the paint maps, the lens
dirt) and each surface's 2K maps are 5.3 MB. Before high is held to a budget, either the budget
for high is set on purpose or the recipes' variants become KTX2 (#193). The 2K grass normal map
(4.4 MB) is over the texture file limit, so the cook leaves it out and the floors' normal array
tops out at 1K at high (the albedo and ORM arrays reach 2K).

### The great bell, the first cooked model (#196)

The pilot (`scripts/make-bell-art.ts`, cooked from `art/prop/great-bell/`): a set piece of 14,292
triangles at LOD0 (body 4,852, swing 9,440), 6,487 at LOD1 and 2,416 at LOD2, meshopt-encoded,
with one texture set painted at 2048² (albedo ETC1S, normal and ORM UASTC + Zstd) and a 512²
emissive rim mask, cooked into a 512 px base GLB (876 kB, 1.9 MB GPU) and 1K (2,059 kB, 4.9 MB) and
2K (5,952 kB, 16.9 MB) variants in the asset store. Its part list is the preview. (Its first
texture set was 1024² albedo and normal and a 512² ORM in one 1,535 kB file, the table below.)

| What                        | Before (part list) | The pilot                             |
| --------------------------- | ------------------ | ------------------------------------- |
| Model file                  | 29 kB              | 1,535 kB, plus the 30 kB preview      |
| GPU bytes (`gpuBytes`)      | 27 kB              | 3.7 MB (3 compressed maps + geometry) |
| hollow-bell/hollow download | 653 kB             | 2,759 kB (with the 571 kB transcoder) |
| hollow-bell/hollow GPU      | 1,313 kB           | 5,064 kB (desktop)                    |

The Hollow stays well inside its budgets (45% of mobile's 6 MB download, 6% of its 80 MB GPU; with
the surface library's floors and walls (#187) 4,805 kB and 11,208 kB). The first cut was 22,708
triangles; 40 segments round the bell instead of 64, lighter chain links and square bolt heads
brought it within #196's 15k. The normal map is most of the file: UASTC is 8 bits a texel before
Zstd, so a 1024² normal map costs about as much as the rest together; the ORM is painted at 512²,
which quarters it with no visible loss (occlusion, roughness and metal change slowly). On the RTX
4060 Laptop the cooked bell is ready 160–300 ms after its request goes out from a local dev server
(download, meshopt decode, KTX2 transcode and upload together; WebGL2 and WebGPU alike); the shader
stages stay the same when it replaces its preview on both backends. The iGPU figures are still to be
taken.

## The M65 perf re-baseline

The test world on the RTX 4060 Laptop (WebGL2, reduced motion, the 512 bases). Programs,
pipelines, geometries, draws and render targets are unchanged: 164 programs, 116 draws. Nothing
leaked over two reloads and two remounts (45 geometries, 79 textures, 164 programs). Idle drew 0
frames in 2 s.

Two numbers rose, both from the floor surface arrays (#187), the albedo, normal and ORM arrays
that the terrain kind samples per cell:

- Textures went from 77 to 79.
- Texture bytes rose by 6.1 MB on every tier (low 53.5 → 59.6 MB, medium 134.6 → 140.7 MB,
  high 169.2 → 175.3 MB).

## The M66 perf check

The world look (#197-#209) needed no re-baseline. The test world on the RTX 4060 Laptop (WebGL2,
reduced motion, the 512 bases) passed the gate against the M65 baseline with every counter
unchanged: 164 programs, 116 draws, 45 geometries, 79 textures, 0 shadow passes while orbiting.
Per tier, render targets, texture bytes, programs and pipelines were also unchanged (low 17, 59.6
MB, 99, 69; medium 27, 140.7 MB, 162, 105; high 29, 175.3 MB, 164, 106). Nothing leaked over two
reloads and two remounts, and idle drew 0 frames in 2 s.

M66 adds light looks (kinds, flicker, fixtures; a glow draws no fixture), token and prop looks, the
preset blend by the hour and the GM's light handles. None of them adds a shader program: the blend
and the looks are uniforms and instance values, and the handles are one instanced mesh of the
overlay kind (compiled by the warm-up), made only when a GM's table first needs one, so players
never build or draw it.

The server's view work with the world look in every view and diff (`npx tsx server/perf/sync.ts
40`, 7 viewers, a character on a random walk). The machine was loaded during the run (load average
about 6-9), so medians and p95s are noisy:

| Table            | Views per action | Diffs   | Move reaches GM and mover (median, p95) | Patrol step (3 sentries) |
| ---------------- | ---------------- | ------- | --------------------------------------- | ------------------------ |
| Village 36×28    | 1.15 ms          | 0.37 ms | 1.42 ms, 4.39 ms                        |                          |
| Monastery 30×20  | 0.57 ms          | 0.22 ms | 1.04 ms, 3.98 ms                        |                          |
| The Hollow 48×36 | 1.21 ms          | 0.56 ms | 1.54 ms, 6.14 ms                        | 0.61 ms                  |

These are within the M34 numbers above (views 2.46, 1.12 and 2.11 ms). The `world` in snapshots,
the remembered lights and the roof masks add nothing per move: Ana's per-move traffic is still
chat, fog and the move (0.7 kB in the village, 0.9 kB in the Hollow).

## The M67 sky

**Captures (#216, #225).** The sky is captured into the environment only when `environmentKey`
changed (about 160 times over a day with no weather, never under an enclosed sky), at most every 2 s
on high and ultra and 5 s on medium, with one trailing capture; low captures once per table into a
16 px cube, and every table's first capture runs inside the warm-up hold, never on a drawn frame.
The capture renders the dome alone into six faces; PMREM filters the cube on the next frame drawn.
Main-thread time on SwiftShader (the test world, 800×500, reduced motion; a software GPU's
timestamps mean nothing, so these are the CPU's share only): a table's first capture 14 ms on medium
(the 64 px cube) and 42-51 ms on low (the 16 px cube's first use, in the hold); a later capture on
medium under 1 ms. A frame drawn right after a capture took 8-16 ms on medium against 6-13 ms for a
frame with none, and 4-6 ms against 3-6 ms on low. Real-GPU costs of the dome, the fog and a capture
per tier come from `scripts/perf-gpu.mjs` on the RTX 4060 Laptop and the integrated GPU (below,
"The M67 perf re-baseline").

**Shadow redraws (#215).** Recorded above ("Frame rate and GPU"): the key light's map is drawn again
about once per half degree it turns and when it switches body; a 3 s tween across hours redraws on
most of its frames.

**The low tier (#225).** No dome, stars or clouds (hidden, not removed, so a tier switch compiles
nothing), a clear-colour background, one 16 px capture per table and no height fog. The key light,
hemisphere, sky visibility and flash are the same on every tier. The program count holds through a
24-hour sweep in hourly steps under the temperate sky, every other sky at 06:00, 12:00, 19:30 and
23:00, haze 0 to 1, a roof on and off, and the flash with Reduce flashing on and off, on low, medium
and high (`program-count.svelte.spec.ts`: each tier's sky its own test and CI job, 70 to 125 s on
SwiftShader here; every sky every hour took about 11 minutes for the three tiers).

## The M67 perf re-baseline

The test world on the RTX 4060 Laptop (WebGL2, reduced motion, the 512 bases, Chromium
153.0.8010.12), re-baselined deliberately with `--update-baseline`. Against M66's baseline (main),
counting the step already recorded at #215 (the PMREM pass: +4 programs, +2 pipelines, +2 targets):

| Check                                | M66                   | M67                   |
| ------------------------------------ | --------------------- | --------------------- |
| Programs (each viewer)               | 164                   | 174                   |
| Geometries                           | 45                    | 55                    |
| Textures                             | 79                    | 82                    |
| Draw calls after orbiting            | 116                   | 117                   |
| Shadow passes while orbiting         | 0                     | 0                     |
| Frames in 2 s idle                   | 0                     | 0                     |
| Heap (Ana)                           | 18.9 MB               | 25.0 MB               |
| Low: targets, programs, pipelines    | 17, 99, 69            | 20, 109, 74           |
| Medium: targets, programs, pipelines | 27, 162, 105          | 30, 172, 110          |
| High: targets, programs, pipelines   | 29, 164, 106          | 32, 174, 111          |
| Texture bytes low, medium, high      | 59.6, 140.7, 175.3 MB | 58.5, 140.7, 175.3 MB |

What moved, and why:

- **Programs +10, pipelines +5 on every tier:** PMREM's filters for the sky's environment (+4,
  #216, recorded at #215), then the dome and its stars in the scene pass and the dome again in the
  capture (linear, no MRT, no tone mapping), and the ground ring (#220) in place of the table's
  slab. All of them are compiled by the warm-up: the program count spec holds every hour and sky
  on every tier, and the gate's reloads and remounts compile nothing more (174 → 174).
- **Render targets +3:** the sky cubes (64 px, and 16 px on low) and PMREM's target.
- **Geometries and textures:** the dome, the stars and the ring's geometry; the cube textures.
  The table's slab and rim are gone (the ground runs to the horizon), and so is the lamp.
- **Draw calls +1** after orbiting: the sky's dome and stars, less the table's slab and rim
  that went (the ring draws in the slab's place). `?off=sky` draws one fewer.
- **Texture bytes:** medium and high +16 kB (the cube); low 1.0 MB less.
- **Heap +6 MB:** the sky, the atmosphere's state and the capture's cameras and targets.

Nothing leaked: two reloads and two remounts end at 55 geometries, 82 textures and 174 programs,
with no WebGL context warnings. Idle drew 0 frames in 2 s; orbiting ran at 60.6 fps (5.6 ms a
frame).

**Real GPUs** (`scripts/perf-gpu.mjs`, the test world at 1920×1080, reduced motion). The first view
of each run is slow while the sky's programs compile (the `?perf` page discards the lobby's
warm-up; 50-78 ms on the RTX, 40-76 ms on the iGPU), so the numbers are the later views. GPU ms
per frame (timestamp queries), overview and close, GM and player:

| GPU           | Backend | Tier   | GM overview | GM close  | Player overview | Player close |
| ------------- | ------- | ------ | ----------- | --------- | --------------- | ------------ |
| RTX 4060      | WebGL2  | low    | 0.95        | 0.80      | 0.76            | 0.80-1.11    |
| RTX 4060      | WebGL2  | medium | 2.75        | 3.15      | 2.92            | 3.00-3.07    |
| RTX 4060      | WebGL2  | high   | 5.55-5.70   | 6.66-7.07 | 3.06-5.98       | 3.42-4.46    |
| RTX 4060      | WebGPU  | high   | 2.31        | 2.97      | 2.56-2.80       | 2.88-3.04    |
| Intel (RPL-S) | WebGL2  | low    | 14.3        | 15.3      | 15.0            | 15.2-16.0    |
| Intel (RPL-S) | WebGL2  | medium | 47.9        | 52.2      | 47.8            | 49.8         |
| Intel (RPL-S) | WebGL2  | high   | 54.6        | 59.6      | 54.2            | 59.9-60.3    |

- **The dome** costs nothing measurable: with `?off=sky` (PERF_EXTRA) the WebGPU scene pass on the
  RTX is the same to 0.01 ms (1.26 ms overview, 1.25 close), and the iGPU's medium frame the same
  within its noise (47.8-52.3 ms without, 47.8-52.2 with). It is one draw pinned to the far plane,
  behind everything, and mostly covered by the ground.
- **The fog** is in every kind's fog node and has no switch; its cost is inside the scene pass
  above (WebGPU on the RTX: scene 1.24-1.40 ms of a 2.3-3.0 ms frame, against 1.2-2.6 ms at M64).
- **A capture** is never in a benchmark frame (the key is unchanged while a view is drawn again),
  and the scripts do not time one on a GPU; the SwiftShader main-thread numbers above are all we
  have. At most one every 2 s (high) or 5 s (medium), it is not a per-frame cost.
- **The iGPU** stays over its budgets, as recorded since M61 (low 14-16 ms, medium 48-52 ms, high
  55-60 ms at 1080p); M67 did not change that picture, and the dome is not what costs.

## The M68 many lights (#228)

GridLights replace the pool of 8 point lights (docs/RENDERING.md, "Many lights"; the pool, kept
behind `?off=manylights` until then, was removed at M68's close). Measured with
`scripts/perf-gpu.mjs` (`SCENES=dungeon-40,village,hollow TIER=medium FRAMES=32`, 1920×1080,
reduced motion) against the M67 build (`tougenrip/m68-lighting` before #228, its pool) served
beside it, the two alternating twice; each cell is the lower of the two rounds' GPU ms per frame
(timestamp queries). `VK_DRIVER_FILES=/usr/share/vulkan/icd.d/intel_icd.json` for the iGPU. A
first view that compiles (village's GM overview on WebGL2) is noise either way.

| GPU           | Backend | Path       | dungeon-40 GM overview / close | player overview / close | village GM overview / close | player overview / close | Hollow GM overview / close | player overview / close |
| ------------- | ------- | ---------- | ------------------------------ | ----------------------- | --------------------------- | ----------------------- | -------------------------- | ----------------------- |
| RTX 4060      | WebGPU  | M67 pool   | 2.3 / 3.0                      | 2.4 / 2.9               | 2.1 / 2.3                   | 2.1 / 2.3               | 3.0 / 6.8                  | 3.5 / 6.4               |
| RTX 4060      | WebGPU  | GridLights | 2.4 / 2.9                      | 2.2 / 2.8               | 1.9 / 2.1                   | 1.9 / 2.1               | 3.2 / 5.8                  | 2.6 / 6.5               |
| RTX 4060      | WebGL2  | M67 pool   | 2.7 / 3.3                      | 2.8 / 3.3               | (26.3) / 2.5                | 2.3 / 2.5               | 6.3 / 6.7                  | 3.6 / 7.4               |
| RTX 4060      | WebGL2  | GridLights | 2.6 / 3.1                      | 2.6 / 3.2               | (14.7) / 2.4                | 2.0 / 2.3               | 4.7 / 6.7                  | 3.3 / 5.8               |
| Intel (RPL-S) | WebGPU  | M67 pool   | 49.0 / 62.5                    | 49.8 / 63.2             | 43.9 / 45.1                 | 42.8 / 45.4             | 71.9 / 165.1               | 73.8 / 164.8            |
| Intel (RPL-S) | WebGPU  | GridLights | 42.8 / 56.2                    | 43.9 / 56.3             | 40.7 / 39.3                 | 37.1 / 39.8             | 63.7 / 146.4               | 64.0 / 146.4            |
| Intel (RPL-S) | WebGL2  | M67 pool   | 43.0 / 55.1                    | 43.9 / 55.9             | (71.4) / 38.5               | 36.7 / 39.3             | 62.4 / 108.9               | 74.4 / 131.6            |
| Intel (RPL-S) | WebGL2  | GridLights | 39.2 / 49.3                    | 37.5 / 48.7             | (62.4) / 31.3               | 30.7 / 32.7             | 49.0 / 90.0                | 58.9 / 104.2            |

- **The iGPU at medium is no worse than M67 on every view (the owner's gate), 8-20% faster on
  most:** each fragment runs its cell's few lights (two at most on these tables) instead of all 8
  pool lights. A first build whose falloff used `pow` for its squares was 5-15% slower than M67 on
  the iGPU's WebGL2 views; `falloffNode` multiplies instead, and that is the build measured here.
- **The RTX** is the same or a little faster on both backends, within a tenth of a millisecond on
  most views.
- **CPU.** The relight for the GM loading the village (`perf-client.mjs`, `SCENES=village`,
  `lighting` over the load) averaged 1.2 ms a relight (14 in 16.8 ms) against M67's 3.1 ms (10 in
  31.4 ms) on this machine, well within M34's 6.4 ms; the builders' own costs are the ADR's
  (`buildLists` 0.2 ms with the sights cached, a door toggle 4.3 ms on dungeon-40). A light that
  changes uploads its own data layer (1 KB), a list change the grid rows that changed.
- **Memory.** The data texture (255 lights × 67 RGBA32F texels, 273 KB) and the lists (100 rows of
  K per cell: 80 KB at K = 8, 160 KB at 16), whatever the table.

**The perf gate** was re-baselined deliberately (`--update-baseline`, the test world, WebGL2 on the
RTX): textures 82 → 84 and texture bytes +353 KB on every tier (GridLights' two textures), the heap
about 1.5 MB more; programs (174), pipelines, render targets, draw calls (117 after orbiting) and
idle frames (0) unchanged, nothing leaked over reloads and remounts.

## The M68 probe grid (#235)

The probe grid's bake (docs/RENDERING.md, "Probe grid"), timed by `probe-grid.svelte.spec.ts` on
the RTX 4060 Laptop (`THIRDFOLD_WEBGPU=1 npx vitest run --project client-webgpu --reporter=verbose
--silent=false -t times src/lib/tabletop/probe-grid.svelte.spec.ts`): the Hollow's GM view on high
(48 × 36, 17 × 3 × 13 = 663 probes, 8 px cube faces), a whole rebake from its first step to its
last after a light changes, three runs on a machine running other tests beside it.

| Backend                        | Bake, wall | In the 83 steps (CPU) | Longest step | Frames |
| ------------------------------ | ---------- | --------------------- | ------------ | ------ |
| WebGPU                         | 2.1-3.0 s  | 1.7-2.5 s             | 34-62 ms     | 131    |
| WebGL2 (ANGLE Vulkan, the RTX) | 3.5-4.0 s  | 2.9-3.4 s             | 48-76 ms     | 131    |

- **CPU-bound:** a step is 8 probes × 6 cube faces of the whole scene, about 0.6 ms of draw
  submission a face; the GPU work is small at 8 px. A step is a long frame (35-75 ms, up to 200 ms
  on a loaded machine, where one WebGL2 run took 12.8 s), so a bake hitches the picture while it
  runs; fewer probes a frame would smooth it and take longer.
- **Idle afterwards:** 131 frames are the 83 steps and TRAA's 24-frame settle after the last (and
  the fade); then none (the spec waits 3 s for a frame and gets none).
- **The gate** (about 3 s on the dGPU) is met on WebGPU, just; WebGL2 is over it, and the iGPU is
  not measured (`wantsProbes` never bakes on WebGL2 on an integrated GPU). The layer stays off by
  default.
- **Memory:** the atlas, 24 × 3 × 182 RGBA16F texels (105 KB), the bake's batch target (9 × 663
  RGBA32F texels, 95 KB) and an 8 px half-float cube, whatever the table. The chunk is 4.5 kB gz.
- **Programs:** none compiled by a bake (the warm-up's hold captures a probe); the largest fragment
  stage samples 16 textures on high with probes (229 programs on the test world on WebGPU).

## The M68 hero shadows (#230)

Measured with `scripts/perf-gpu.mjs` on the test world (`FRAMES=32 POSES=close,overview`, 1920×1080,
WebGL2 on the RTX 4060, reduced motion), the same build with its slots forced to none against the
slots on; other jobs shared the GPU, so a tenth or two either way is noise, and the first pose after
the scene import (the GM's close) compiles and is left out.

| Tier                    | GM overview | player close / overview | Cube memory (depth + R8 colour) |
| ----------------------- | ----------- | ----------------------- | ------------------------------- |
| medium, no slots        | 3.0         | 3.0 / 3.0               | 0                               |
| medium, 2 slots, 256 px | 3.0         | 3.4 / 4.0               | 3.1 + 0.8 MB                    |
| high, no slots          | 4.2         | 3.2 / 3.0               | 0                               |
| high, 4 slots, 512 px   | 4.4         | 4.4 / 3.8               | 25.2 + 6.3 MB                   |

- **Per fragment** a slot costs its cell-list check and one cube lookup (a face matrix and a 2×2
  compare); the entry's light (data, occlusion taps, falloff) is worked out only where the slot's
  light is listed. A first build that worked it out everywhere cost 2.5-3.5 ms more on medium.
- **Per redraw** a cube is six caster passes into its row of the atlas, only when something in the
  light's reach + 1 changed, at most one a frame on medium and two on high; camera moves draw none.
- **The iGPU** was not measured for this change; low has no slots.

## The M69 world shape (#239)

`npx tsx server/perf/world-shape.ts 200` in Node 22 on the i9-13900HX, median of 200 runs after a
warm-up, on busy generated tables (terraces up to level 7, void, water and stone patches, a wall per
row of cells, two thirds explored, so the continuation rule works on every cell):

| Table   | Classify | Regions | Dual cases, walkable + 7 bands | Dirty chunks, one cell |
| ------- | -------- | ------- | ------------------------------ | ---------------------- |
| 64x64   | 0.58 ms  | 0.70 ms | 3.5 ms                         | 0.05 ms                |
| 100x100 | 1.4 ms   | 2.1 ms  | 9.9 ms                         | 0.12 ms                |

- **Classify** is `worldShape`: the continued cell maps, the dual tiles' sectors (eight per grid
  corner, levels and floors), both edge maps and the wall spans. Under the issue's 1 ms for 64x64.
- **Dual cases** for a whole table is every tile under every mask; #240 asks only a dirty chunk's tiles
  (a 16 x 16 chunk is about a fifteenth of a 64x64 table's, about 0.25 ms here).
- `walls.ts` builds its wall instances from the same spans, with no cost of note (it ran them inline).

## The M69 cell picks (#246)

Cells are picked by a DDA over the drawn levels (`world/pick.ts`), not by raycasting the raised
boxes and the table plane; things (tokens, walls, props, fixtures) are raycast on `PICK_LAYER` only.

**The DDA on its own**, in Node 22 on the i9-13900HX. `npx tsx server/perf/world-shape.ts 200`
picks every pixel of a 160x100 view across the generated tables: 0.004 ms a pick on 64x64 and 0.006
ms on 100x100 (terraces to level 7), under the issue's 0.05 ms. On the fixtures' own poses (10,240
rays from four poses each, median of 15 runs, measured once by a scratch script):

| Fixture              | Raised cells | Raised boxes + plane (before) | DDA (after) |
| -------------------- | ------------ | ----------------------------- | ----------- |
| The Hollow, 48x36    | 788          | 87.5 µs                       | 0.9 µs      |
| The monastery, 30x20 | 72           | 1.0 µs                        | 1.0 µs      |
| outdoor-64, 64x64    | 0            | 0.06 µs                       | 1.3 µs      |

The DDA's cost follows the cells a ray crosses, not the ground's detail, so it stays this size when
#240's chunks replace the boxes; the old raycast grew with every raised cell.

**The whole 'pick' timing** (`perf.time('pick')`: the things' raycasts and the cell), in the client
project's Chromium (SwiftShader, 800x500), 2,000 pointer moves over the GM's overview pose after 200
to warm up, mean per pick, by a scratch spec on this change and on the commit before it:

| Fixture       | Before (runs) | After (runs)    |
| ------------- | ------------- | --------------- |
| The Hollow    | 277, 243 µs   | 185, 119, 97 µs |
| The monastery | 55, 57 µs     | 106, 61, 50 µs  |

The Hollow's picks drop by about half (its 788 boxes are no longer raycast); the monastery's are
unchanged within the noise (the first run after had an 11 ms stall). What remains is the things'
raycasts, which this change leaves as they were.

## The M69 ground in chunks (#240)

What a chunk rebuild costs on the main thread (`chunkGround`, the pure emitter; the layer adds a
`BufferGeometry` and its bounding sphere), on the RTX 4060 Laptop's i9-13900HX, Node 22 through Vite's
transform (as the browser bundle runs it: no names kept on closures), medians of 20, measured while
other agents' browser tests kept the machine at a load average of about 15, so read them as upper
bounds:

| Table                                   | Mean chunk | Slowest chunk | Whole table      | One-cell edit (shape + its chunks) |
| --------------------------------------- | ---------- | ------------- | ---------------- | ---------------------------------- |
| Hollow (48x36, GM)                      | 1.2 ms     | 2.5 ms        | 11 ms (9 chunks) | 2.0 ms (1 chunk)                   |
| Monastery (30x20, GM)                   | 0.75 ms    | 1.5 ms        | 3.0 ms (4)       | 0.1 ms (0: an unchanged cell)      |
| outdoor-64 (64x64, GM)                  | 1.3 ms     | 2.0 ms        | 21 ms (16)       | 1.9 ms (1)                         |
| test world (24x24, GM)                  | 1.1 ms     | 2.4 ms        | 4.4 ms (4)       | 0.4 ms (1)                         |
| busy random 64x64, all known / fogged   | 1.0 / 2.0  | 1.1 / 4.8     | 15 / 32 ms       | 4.6 / 1.6 ms                       |
| busy random 100x100, all known / fogged | 0.9 / 1.3  | 1.7 / 2.2     | 45 / 64 ms       | 2.6 / 3.3 ms                       |

- **A one-cell paint** rebuilds one chunk (four on a chunk's corner): about 1 ms of meshing; the edit's
  total (the shape, about 0.6 ms on 64x64, then the chunk) stays within 2-5 ms. A fogged player's step
  rebuilds one to four chunks (the world-layer spec walks 35 steps across the Hollow).
- **A whole table** (a new table, or `?off=terrain` turned back on) is 3-21 ms on the fixtures and about
  45-65 ms on a busy 100x100 one. A new table is built twice today, once for `setGrid` (flat) and again
  for `setTerrain`; batching the build to the next frame would halve that, if it ever shows.
- **The issue's 1.5 ms a chunk on the dGPU machine** holds on average (0.75-1.3 ms on the fixtures);
  the slowest chunks (rounded corners all over, or fogged tiles split along diagonals with skirts) reach
  2-2.5 ms under the background load, 4.8 ms on the busiest random table. No worker yet: the numbers
  don't call for one, and the general path (rounded and unexplored quarters) is where to look first.
- `npx tsx server/perf/world-shape.ts` prints the same rows (`ground mesh, ...`) but tsx keeps every
  closure's name (`__name`), which inflates them two to three times; the table above is the one to
  quote.
- **The GPU:** two draws per chunk (tops and sides; sides also in the sun's shadow pass), 18 for the
  Hollow, 32 for 64x64. Tops are eight triangles a cell (more at round corners), about 33k on
  64x64, where the play plane drew 2 and the boxes 12 a raised cell. The perf gate and the iGPU were not run
  for this change (the iGPU is not a gate for M69).
