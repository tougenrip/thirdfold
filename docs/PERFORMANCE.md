# Performance

Milestone 34 measured thirdfold on The Hollow Bell's three big tables and fixed the bottlenecks the
measurements showed. This page records how to measure, what was found, what changed, and what was
measured and left alone.

## How to measure

- **In the browser:** add `?perf` to a room's URL. An overlay shows frames per second, main-thread
  ms per frame, draw calls, triangles, geometries/textures/shader programs, and how often and how
  long lighting was worked out. The page also exposes `window.thirdfoldPerf` (the renderer's
  `stats()`, `resetStats()` and `benchmark(frames)`) and `window.thirdfoldRoom` (the connection),
  for the scripts below. Timings come from `src/lib/tabletop/perf.ts`.
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
  the top of the script. The script uses a GM and two players in Chromium, on the committed fixture
  tables. It measures the landing page, the join form from an invite link, and each table's load
  (snapshot size, long tasks, what each renderer update cost). It then measures idle frames, a fixed
  orbit of the camera, a move's network and main-thread cost, heap after GC, GPU resources after
  loading every table three more times and after leaving and rejoining the room three times, and
  the bundle sizes (`check-bundle.mjs --json`). `--json <file>` writes the whole report.
- **Perf gate:** `--baseline docs/perf-baseline.json` compares the counters that do not depend on
  the machine's speed with the committed baseline and exits 1 on a regression. The `Perf` workflow
  (`.github/workflows/perf.yml`) runs it on every push to `main` and on pull requests that touch
  the renderer, assets, fixtures or the perf scripts; its table goes to the run's summary and the
  whole report is uploaded as the `perf-report` artifact. The gate fails when:

  | Counter                                                 | Fails when                     |
  | ------------------------------------------------------- | ------------------------------ |
  | Draw calls in the settled frame after the orbit         | more than baseline × 1.10      |
  | Shader programs after a table loads                     | more than baseline             |
  | Geometries, textures, heap after GC (per table, viewer) | more than baseline × 1.10      |
  | Frames in 3 s of idle on a daylight table               | more than 0                    |
  | Geometries, textures, programs after three more reloads | above the first load           |
  | The same after three more remounts of the Tabletop      | above the first remount        |
  | Heap after each remount                                 | above the first × 1.10         |
  | "Too many active WebGL contexts" warnings               | any                            |
  | Bundle sizes (`check-bundle.mjs` budgets)               | over budget, or three.js eager |

  Milliseconds are printed, never gated: SwiftShader's timings say little about real GPUs. To change
  the baseline on purpose, run with `--update-baseline docs/perf-baseline.json` on the pinned
  Chromium and say why in the PR.

- **GPU cost of a frame:** `PERF_GPU=vulkan node scripts/perf-gpu.mjs [url] [scenes] [out.json]`.
  It draws the fixture tables at their named poses for the GM and a player, at 1400×900 and
  1920×1080, timed by WebGL2 timer queries where the driver has them and by a readPixels round trip.
  `PERF_GPU` is `swiftshader` (default), `vulkan` (a discrete GPU) or `egl` (an integrated GPU); the
  report names the GPU the browser actually used.
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
timer (`AMBIENT_FRAME_MS`, 80 ms), by design since M15.

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

- **Software GPU experiments.** With `perf-gpu.mjs` (GPU ms per frame under SwiftShader, 1400×900):

  | Change                      | Effect  |
  | --------------------------- | ------- |
  | No shadows at all           | −15%    |
  | No antialiasing             | −18%    |
  | 2 point lights instead of 8 | −20–30% |
  | A quarter of the pixels     | −50%    |

  The cost is per-pixel shading, which a real GPU does in hardware. Lowering quality for software
  rendering was not worth it, so antialiasing, the light pool and resolution are unchanged.

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

**RTX 4060 Laptop (discrete, high-tier proxy).** `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA NVIDIA GeForce RTX 4060 Laptop GPU (0x000028E0)), NVIDIA)`.

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

**Intel Raptor Lake-S UHD (integrated, low and medium proxy).** `ANGLE (Intel, Vulkan 1.4.335 (Intel(R) Graphics (RPL-S) (0x0000A788)), Intel open-source Mesa driver)`.

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

- **The discrete GPU has headroom.** Every view draws in 0.5–3.5 ms at 1080p, well inside the high
  tier's budget.
- **The integrated GPU is already over the medium budget.** Today's plain look costs 12–40 ms per
  frame at 1080p on the iGPU, against the medium tier's target of about 11 ms at 2 MP. Close,
  low-angle views of large lit tables are the worst: the Hollow at 38–40 ms, ref-8 close 32 ms,
  the 64×64 outdoor table close 29 ms. The cost is per pixel (draw counts are small, from 10 to
  245), which points at fill and lighting: 8 point lights on every lit fragment, full-screen
  transparent overlays (fog, darkness, floor), and MSAA. Milestone 62's tiers must start the iGPU
  below 2 MP, or with fewer lights, before any new effect is added.
- **Draw calls are modest** (the most is 245, crowd-60) and shader programs 16–17 on every
  table, so batching is not today's bottleneck.

## Not changed, and why

- **three.js's size.** It is already split out and prefetched. Replacing namespace imports with
  named ones would save little, since three's core is not very tree-shakeable.
- **Per-move messages.** They are 1 kB or less.
- **The GM's larger view.** The GM sees everything by design.
- **Ambient flicker and mist at dusk.** These are an intended look. They run on a slow timer, only
  when visible, and are off with reduced motion.
