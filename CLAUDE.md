# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

thirdfold is a browser-based, real-time multiplayer **3D virtual tabletop (VTT)** for tabletop RPGs. It should feel like a living 3D miniature tabletop, not a 2D VTT with a 3D renderer added on. Built so far: rooms (create/join/reconnect) over an authoritative WebSocket server, a 3D table with the connected players (milestone 1), tokens the GM places/assigns/deletes and owners move on the grid (milestone 2), and a shared room log with chat, server-rolled dice and system notices (milestone 3). Walls/doors/lights, visibility and persistence are not built yet.

## Commands

```bash
npm install
cp .env.example .env        # set VITE_SUPABASE_ANON_KEY from `npx supabase start` output
npm run db:start            # local Supabase (API :54321, Postgres :54322, Studio :54323); db:stop
npm run cache:up            # Redis :6379 via docker compose; cache:down
npm run server              # authoritative game server, ws://localhost:8787 (tsx watch)
npm run dev                 # web on http://localhost:1420 (strictPort)

npm run check               # svelte-check for the app + `tsc -p server` for the game server
npm run lint                # prettier --check + eslint
npm run format              # prettier --write
npm test                    # all vitest projects, run once
npm run build               # static SPA into build/
```

Tests are split into two Vitest projects in `vite.config.ts`:

- `server` runs in Node and picks up `src/**/*.{test,spec}.ts` plus `server/**/*.{test,spec}.ts`. Put pure domain logic tests here (grid, dice, permissions, serialization). `server/game-server.spec.ts` starts a real server on port 0 and drives it with `ws` clients; extend it for every new multiplayer action.
- `client` runs in headless Chromium through Playwright and picks up `src/**/*.svelte.{test,spec}.ts`, the component tests.

Run a subset:

```bash
npx vitest run --project server
npx vitest run src/lib/path/to/file.spec.ts
npx vitest run -t "test name"
```

`expect.requireAssertions` is on, so a test with no assertions fails. The `client` project needs a Playwright Chromium that matches the installed `playwright` version.

Schema changes: `npx supabase migration new <name>`, write SQL in `supabase/migrations/`, then `npx supabase db reset`. This drops local data. RLS is on for new tables, so a table without a policy returns empty results.

Native targets: `npm run desktop` / `desktop:build` builds Tauri. `npm run android` / `ios` builds, runs `cap sync`, and launches Capacitor. `android/` and `ios/` are generated and gitignored. Recreate them with `npx cap add <platform>`. Native builds only pick up web changes after `npm run mobile:sync`.

## Architecture

Three layers, each importable only in one direction:

- **`src/lib/game/`: shared domain + wire protocol.** Plain TypeScript with no DOM, Svelte, three.js or Node APIs, and relative imports only (no `$lib`), because the game server imports it directly. `grid.ts` holds logical grid ↔ world conversions, `token.ts` the token model, `dice.ts` the dice-expression parser/roller (hand-written tokenizer with hard limits, random source injected), `chat.ts` the log entry types plus `/roll` command parsing, and `permissions.ts` the role/ownership rules (`canMoveToken`, `canEditScene`) that the server enforces and the UI reuses only to decide what to offer. `protocol.ts` defines every `ClientMessage`/`ServerMessage` and `parseClientMessage`, the only way network input becomes typed data.
- **`server/`: the authoritative game server** (Node + `ws`, run with `tsx`, own `server/tsconfig.json`). `rooms.ts` is socket-free room state (`RoomManager`, returns `Result` values with an `ErrorCode`). `scene.ts` holds the token actions (`createToken`, `moveToken`, …), each taking the acting `Player` and checking permission, bounds and occupancy before mutating. `chat.ts` appends to the room log (`room.log`, capped at `LOG_LIMIT`, sequenced by `room.nextSeq`, included in snapshots) and rolls dice with `crypto.randomInt` (`startGameServer({ rollDie })` overrides it). Chat and dice go through a per-player `RateLimiter`. System notices (joins, token placed/moved/reassigned/removed) are posted by `game-server.ts` after a successful action. `game-server.ts` is transport: parse frame → entry messages go to `RoomManager`, in-room messages to `scene.ts` → reply with an `error` to the sender or broadcast the result to the room (rejected actions are never broadcast). State is in memory; rooms are pruned after 10 min with nobody connected. A new game action is: message + parser case in `protocol.ts`, rule in `scene.ts` (with unit tests), a case in `handleInRoom`, a fold in `room-state.ts`, and a multi-client test in `game-server.spec.ts`. Its `TestClient` queues `chat` messages separately from state messages, so `expect('token_moved')` is unaffected by notices; use `expect('chat')` to read the log stream.
- **Client (`src/lib/net`, `src/lib/tabletop`, `src/routes`).** `RoomConnection` (`room-connection.svelte.ts`) owns the socket and exposes `$state` (`status`, `room`, `playerId`, `error` for connection failures, `actionError` for rejected actions). The server's snapshot is the client's shared state. Broadcasts are folded in by the pure `applyRoomUpdate` in `room-state.ts`. Components must not mutate `conn.room`; they call `conn.send(action)` and wait for the broadcast (no optimistic updates). `ui/RoomView.svelte` owns local UI state (selection, placing tool, hovered cell, camera view) and turns clicks into actions. `tabletop/renderer.ts` is imperative three.js (render on demand, no per-frame loop when idle). It receives grid/tokens/selection/highlight and reports clicks and hovers back as grid cells and token ids via `TabletopEvents`, so nothing above it handles world coordinates. `tabletop/tokens.ts` diffs tokens by id and tweens moves (cosmetic only). `Tabletop.svelte` just mounts the renderer and forwards props.

Identity and reconnection: the welcome message carries a secret 64-hex `sessionToken` (never broadcast; tests assert this; not to be confused with game tokens). The client stores it in `localStorage` under `thirdfold:session:<roomId>` and, after any drop, reconnects with `resume` using exponential backoff. Resuming a seat from a second socket closes the older one with code `4001` (`CLOSE_SESSION_REPLACED`, duplicated in the client). The room creator is the only GM; `join` accepts only `player`/`spectator`. The landing page hands its already-seated connection to `/room/[id]` via `handOff`/`takeHandoff`, so navigation doesn't re-handshake.

## Platform constraints

- **The frontend is a static SPA.** It uses `adapter-static` with `fallback: 'index.html'`, and `+layout.ts` sets `ssr = false` and `prerender = false`. It has no SvelteKit server routes, hooks, or form actions. The same bundle ships in the Tauri and Capacitor shells. Anything needing a secret, direct DB access, Redis, or authoritative game logic goes in `server/` (or behind Supabase), never in `src/`.
- `VITE_*` env values are inlined into the bundle at build time. Only the anon/publishable key belongs there, never the service_role key.
- `src/lib/api.ts` rewrites `localhost` to `10.0.2.2` for the Android emulator. Build URLs from `API_URL` / `GAME_SERVER_URL`, not from `import.meta.env` directly. `GAME_SERVER_URL` defaults to port 8787 on the page's host (localhost inside native shells), overridable with `VITE_GAME_SERVER_URL`. `src/lib/supabase.ts` is the shared Supabase client (unused so far).
- Svelte 5 runes mode is forced for all project files (`vite.config.ts` `compilerOptions.runes`). Use `$state`/`$derived`/`$props`, not legacy `export let`/stores syntax.
- Formatting uses tabs, single quotes, and no trailing commas, with a print width of 100 (`prettier.config.js`).

## Product requirements (from the project brief)

The brief sets behavior, not stack. Extend the existing architecture. Don't add frameworks or services unless a concrete need justifies them.

**Layering.** Domain/game state → networking/sync → client state → 3D rendering + UI. The renderer only visualizes state; it is never the source of truth. Keep domain logic (scenes, tokens, grid, movement, visibility, dice, permissions) in plain, renderer-free modules so it can be unit-tested in the `server` Vitest project and reused by whatever runs authoritatively. Keep system-agnostic: no D&D-specific rules in core concepts.

**Authoritative server.** Clients send requests. The server validates identity, role, ownership, movement, scene edits, dice expressions, and persisted data, then applies the change and broadcasts it. The client is never trusted for roles, token ownership, positions, dice results, or permissions. Dice are rolled server-side. Dice parsing must never `eval` input. Scene data, chat, and assets must not carry executable content.

**Core concepts.** The domain distinguishes: Room (GM + players), Scene, Scene Object (floor/wall/door/prop/light), Token, Player, Role (GM / player / spectator), and **Grid Position (logical) vs World Position (render)**, which are kept separate. Assets are reusable resources referenced by scene objects, and placement is stored separately.

**Permissions (MVP defaults).** The GM sees everything, moves any token, edits the scene, controls lights, and reveals areas. A player sees allowed areas, moves only owned tokens, rolls dice, and chats. A spectator views, rolls dice, and chats. Enforcement happens server-side, not only in the UI.

**State split.** Shared authoritative state (players, tokens, scene, objects, lights, visibility) is kept separate from local UI state (selection, active tool, camera mode, hovered cell, drag). Don't keep competing copies of shared state.

**Subsystems (MVP level).**

- Square grid only, but behind an abstraction: cell size, dimensions, snapping, highlight, distance.
- Grid-based movement, not physics.
- Tactical and tabletop camera modes. Camera code stays out of gameplay rules.
- Visibility is grid-based: vision radius plus GM reveal, with visible, explored, and hidden states.
- Basic ambient, directional, and point/torch lighting.
- Dice support d4 through d100 and `NdX+M` expressions.
- Room chat carries name, content, timestamp, and type, plus system messages.
- A simple GM scene editor handles select, move, rotate, scale, delete, and creating tokens, objects, walls, doors, and lights. It is not a modeling tool. Primitive placeholder geometry is fine.

**Persistence.** Save plain domain data, never renderer objects. Serialized scenes are **versioned** so the schema can evolve. Reconnecting clients must recover their membership, identity, current scene, and owned-token access.

**Out of MVP scope.** Out of MVP scope: character sheets, a combat system, full rules, marketplace, billing, a complex animation system, procedural generation, advanced 3D line-of-sight, voice/video, campaign management, and mobile-first UX. Don't build these early.

**Performance.** Performance is first-class: no per-frame rebuilds for small changes, instancing for repeated geometry, lazy asset loading, and no high-frequency network traffic for visual-only state. Profile before optimizing. Target modern desktop browsers without requiring bleeding-edge APIs.

**Required test coverage.** Tests must cover grid conversion, movement/distance, dice parsing and results, permission validation, scene serialization, room join/leave, and multiplayer sync of movement, dice, and chat. One automated test must specifically prove **a player cannot move a token they don't control**.

**Workflow.** Build in small vertical milestones. Each one should be runnable and pass `check`, `lint`, `test`, and `build`. Milestones 1 (join a room, see the table and players), 2 (tokens and movement) and 3 (dice and chat) are complete.

**MVP done.** The MVP is done when all of the following work without manual code or DB edits:

1. The GM creates a room and shares a join link.
2. A player joins, and both see the same 3D table.
3. The GM places walls, a door, and tokens.
4. The player moves their token and the GM sees it.
5. The player rolls a d20 and both clients see the result.
6. Chat works.
7. The GM hides and reveals areas.
8. The GM saves the scene, and reloading it rebuilds the table.
