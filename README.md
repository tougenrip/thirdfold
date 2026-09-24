# thirdfold

A browser-based, real-time multiplayer **3D virtual tabletop** for tabletop RPGs.
A Game Master opens a table, shares a link, and the players move miniatures
around a lit, fogged, three-dimensional table together, with dice, chat, doors,
walls, props and light. thirdfold also runs whole adventures itself (story,
people, investigation, turn-based fights, choices and endings) and lets
creators build and publish their own without writing code.

One SvelteKit codebase serves the web app, the Tauri desktop app and the
Capacitor Android/iOS apps. An authoritative Node WebSocket game server
(`server/`) owns every rule: clients only ask, the server decides.

## Quick start

You need **Node 22** and npm. Nothing else is required: without further
settings the game server keeps its data in local files.

```bash
npm install
npm run server   # terminal 1: the game server on ws://localhost:8787 (restarts on changes)
npm run dev      # terminal 2: the web app on http://localhost:1420
```

Open http://localhost:1420, enter a name and choose **Create room**. You are
the GM. Share the invite link (or the six-letter room code) so others can join
as players or spectators. Other machines on your network can use
`http://<your-ip>:1420`; the page reaches the game server on port 8787 of the
same host.

Things to try as a GM:

- In the **Adventure** panel, start **The Hollow Bell** or **The Last Train to
  Blackwater**. Players pick a character, and the story runs itself; the
  **Direct** panel lets you pause, skip scenes, start fights and more.
- Build your own table from the **Build** and **Scene** panels: walls, doors,
  props, lights, floors, raised ground, fog of war. Save it, or share it as a
  link.
- Open the **adventure builder** (`/builder`) to write an adventure with forms,
  play it, and publish it to the **library** (`/library`).
- Switch the header from **Invite only** to **Open to all** to list your game
  on the front page, where anyone can join it.

## What's in it

The MVP (milestones 1-10) and the whole post-MVP roadmap (milestones 11-40,
`docs/ROADMAP.md`) are done.

**The tabletop**

- Rooms: create, join, reconnect. Roles are GM, player and spectator, and the
  server enforces them.
- A 3D table with tactical and tabletop cameras. Tokens are moved on a square
  grid and can't pass walls or closed doors.
- Walls, windows, doors, props, floors and elevation (balconies, stairs,
  ledges). Line of sight works in 3D.
- Fog of war: each player sees through their own tokens, and the GM reveals or
  hides areas and whole rooms.
- Lighting: time of day, dark areas, torches and lanterns.
- Chat, a room log, server-rolled dice (d4 to d100, `NdX+M`, secret rolls) with
  3D dice.
- A scene editor for the GM: select, move, rotate, scale and delete things.
- Saves belong to the GM's key, so they are reachable from any device.
  Autosave, Continue, file import/export, and shared table links.
- Sessions survive network drops and server restarts. Sound and music are
  synthesized in the browser.

**Adventures**

- An adventure engine that knows no particular story. It covers chapters and
  objectives, NPCs with dialogue, investigation with private evidence and
  checks, physical interaction (push, pull, carry, levers and mechanisms),
  turn-based combat with initiative, and enemy AI with sight and patrols.
  It also covers choices, several endings, and an end-of-session summary.
- Two built-in adventures. **The Hollow Bell** is a dark fantasy in thirteen
  chapters across a village, a monastery and a vast cavern.
  **The Last Train to Blackwater** is a supernatural western on a night train.
- Onboarding for new players: join with just a name, choose a character, and
  play an interactive tutorial inside the real session.
- Tools for the GM to direct a story: pause, skip, fights, enemies, story
  events, light, fog and secret dice.

**Creating and sharing**

- The **adventure builder** (`/builder`) writes an adventure as a plain JSON
  file, with forms for scenes, flow, people, fights, things, choices and
  endings. It checks the adventure as you go and can play it at once.
- The **adventure library** (`/library`): creators publish adventures under a
  name, each publish adds a version, and they can unlist or remove them. GMs
  search the library, run adventures, and rate them after playing. Each
  creator has a page.
- **Open games:** a GM can list a game for anyone to find on the front page.

**Limitations**

- Identity is a secret **GM key** kept in the browser (copy it to another
  device from the front page), not an account. There are no logins, billing or
  a marketplace.
- There is only a square grid. Elevation is a height field, so nothing can
  stand under a balcony.
- The four playable characters are shared by every adventure.
- Mobile works, but the interface is designed for desktop browsers.

## Commands

| Command                             | What it does                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run server`                    | Game server in watch mode (`npm run server:start` without watching)                              |
| `npm run dev`                       | Web app with hot reload on port 1420                                                             |
| `npm run build`                     | Static web bundle in `build/`                                                                    |
| `npm run check`                     | Type-checks the app (svelte-check) and the server (tsc)                                          |
| `npm run lint` / `npm run format`   | Prettier and ESLint / fix formatting                                                             |
| `npm test`                          | All tests once: server/domain tests in Node, component tests in headless Chromium via Playwright |
| `npm run assets` / `assets:check`   | Rebuild `static/assets/` from `assets/` / check it is up to date                                 |
| `npm run db:start` / `db:stop`      | Local Supabase in Docker (optional, see below)                                                   |
| `npm run desktop` / `desktop:build` | Tauri desktop app                                                                                |
| `npm run android` / `npm run ios`   | Capacitor: build, sync and run on a device or emulator                                           |

Run a subset of tests with `npx vitest run --project server` or
`npx vitest run path/to/file.spec.ts`. The component tests need Playwright's
Chromium (`npx playwright install chromium`).

## Configuration

Everything is optional. Copy `.env.example` to `.env` to change it.

| Variable                                | Read by    | Default              | Purpose                                                                 |
| --------------------------------------- | ---------- | -------------------- | ----------------------------------------------------------------------- |
| `GAME_SERVER_PORT` / `GAME_SERVER_HOST` | server     | `8787` / `0.0.0.0`   | Where the game server listens                                           |
| `SCENES_DIR`                            | server     | `data/scenes`        | Saved tables and stories                                                |
| `ROOMS_DIR`                             | server     | `data/rooms`         | Live rooms, so a restart doesn't end a game                             |
| `LIBRARY_DIR`                           | server     | `data/library`       | Published adventures, their versions and ratings                        |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | server     | unset                | Store all of the above in Supabase Postgres instead of files (set both) |
| `VITE_GAME_SERVER_URL`                  | web bundle | port 8787, same host | Where the web app finds the game server, e.g. `wss://game.example.com`  |

`VITE_` values are baked into the web bundle when it is built. The Supabase
service key bypasses row-level security, so it belongs to the game server
only and must never go in a `VITE_` variable.

### Storing data in Supabase (optional)

```bash
npm run db:start                  # local Supabase (needs Docker): API :54321, Studio :54323
npx supabase migration up         # scenes, live rooms and the library; RLS on, no browser access
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_KEY=<SECRET_KEY from `npx supabase status`> npm run server
```

For a schema change, run `npx supabase migration new <name>`, write the SQL in
`supabase/migrations/`, then `npx supabase db reset` (which drops local data).
The live database tests in `server/supabase-scene-store.spec.ts` run when
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `SUPABASE_ANON_KEY` are set (see
`CLAUDE.md`).

## Deploying

1. Build the web app with `VITE_GAME_SERVER_URL` pointing at your game server
   (`wss://...` behind HTTPS): `npm run build`. Serve `build/` from any static
   host, with every unknown path falling back to `index.html`.
2. Run the game server with `npm run server:start` on a machine that keeps
   `data/`, or give it Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`).
   Put it behind a TLS proxy for `wss://`.

## Native apps

`android/` and `ios/` are generated and not committed: create them with
`npx cap add android` / `npx cap add ios`. Every web change needs
`npm run mobile:sync` before it shows in a native build. For a local http
game server on Android, see the notes in `capacitor.config.ts`. The desktop
app is in `src-tauri/`.

## How it's built

- `src/lib/game/`: the shared domain and wire protocol (grid, tokens, walls,
  visibility, light, dice, permissions, the versioned scene file). Plain
  TypeScript used by both the server and the browser.
- `server/`: the authoritative game server. It holds rooms, rules, per-viewer
  views (fog is enforced here: hidden things never reach a client), storage,
  the adventure engine (`server/adventure/`) and the built-in adventures
  (`server/adventures/`, kept off the client so stories aren't spoiled).
- `src/lib/tabletop/`: the three.js renderer. It only draws what the server
  says; `src/lib/audio/` does the same for sound.
- `src/routes/`: the front page, `/room/[id]`, `/builder` and `/library`.
- `assets/` → `static/assets/`: a reproducible asset pipeline (models,
  materials, textures, environments, sounds).

CI (`.github/workflows/ci.yml`) runs check, lint, all tests and the build on
every pull request, plus the live Supabase tests against a fresh local Supabase.

## Documentation

- `docs/ROADMAP.md`: the roadmap, milestone by milestone.
- `docs/ADVENTURES.md`: writing adventures, adventure files, the builder and
  the library.
- `docs/ASSETS.md`: the asset pipeline.
- `docs/PERFORMANCE.md`: how performance is measured, and what changed.
- `CLAUDE.md`: a detailed map of the architecture, for contributors and
  coding agents.
