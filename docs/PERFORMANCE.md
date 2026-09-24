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
- **Tables to measure on:** `npx tsx server/perf/scenes.ts data/perf` plays the story with the
  engine and writes a save at each big table (`village.json` 36×28, `monastery.json` 30×20,
  `hollow.json` 48×36, each with its story, two characters and, in the Hollow, the watch).
- **Multiplayer synchronization:** `npx tsx server/perf/sync.ts [moves]` runs a real game server
  with a GM, five players and a spectator over WebSockets on each table. It measures the load, the
  bytes and messages each client gets per move, and the time until the GM and the mover have it.
  It also times the server's per-action view work directly (every viewer's view, then the diffs),
  with a character on a random walk to new cells, and the watch's patrol step.
- **Client (load, scene loading, frames, memory, network):** build, serve and start a server, then
  run `node scripts/perf-client.mjs http://localhost:4173 data/perf`. See the comment at the top of
  the script. The script uses a GM and two players in Chromium. It measures the landing page, the
  join form from an invite link, and each table's load (snapshot size, long tasks, what each
  renderer update cost). It then measures idle frames, frames while orbiting the camera, a move's
  network and main-thread cost, heap after GC, and GPU resources after loading the tables again.
- **GPU cost of a frame:** `node scripts/perf-gpu.mjs`. It draws each table's current view
  repeatedly and waits for the GPU each time.
- **Asset sizes:** `npm run build` prints each chunk. `npx vite build --sourcemap true` with a
  source-map walk shows what a chunk is made of.

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

## Not changed, and why

- **three.js's size.** It is already split out and prefetched. Replacing namespace imports with
  named ones would save little, since three's core is not very tree-shakeable.
- **Per-move messages.** They are 1 kB or less.
- **The GM's larger view.** The GM sees everything by design.
- **Ambient flicker and mist at dusk.** These are an intended look. They run on a slow timer, only
  when visible, and are off with reduced motion.
