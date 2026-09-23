# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

thirdfold is a browser-based, real-time multiplayer **3D virtual tabletop (VTT)** for tabletop RPGs. It should feel like a living 3D miniature tabletop, not a 2D VTT with a 3D renderer added on. The repo is currently only the platform scaffold (SvelteKit + Capacitor + Tauri, local Supabase, Redis). No VTT code exists yet.

## Commands

```bash
npm install
cp .env.example .env        # set VITE_SUPABASE_ANON_KEY from `npx supabase start` output
npm run db:start            # local Supabase (API :54321, Postgres :54322, Studio :54323); db:stop
npm run cache:up            # Redis :6379 via docker compose; cache:down
npm run dev                 # web on http://localhost:1420 (strictPort)

npm run check               # svelte-kit sync + svelte-check (typecheck)
npm run lint                # prettier --check + eslint
npm run format              # prettier --write
npm test                    # all vitest projects, run once
npm run build               # static SPA into build/
```

Tests are split into two Vitest projects in `vite.config.ts`:

- `server` runs in Node and picks up `src/**/*.{test,spec}.ts`. Put pure domain logic tests here (grid, dice, permissions, serialization).
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

## Architecture constraints

- **The frontend is a static SPA.** It uses `adapter-static` with `fallback: 'index.html'`, and `+layout.ts` sets `ssr = false` and `prerender = false`. It has no SvelteKit server routes, hooks, or form actions. The same bundle ships in the Tauri and Capacitor shells. Code that needs a secret, direct DB access, Redis, or **authoritative game logic** cannot live in `src/`. It belongs behind Supabase (Postgres functions/RLS, Realtime, Edge Functions) or in a separate server process. Choosing where the authoritative multiplayer server lives is a real decision. Make it deliberately; don't let validation drift into the client.
- `VITE_*` env values are inlined into the bundle at build time. Only the anon/publishable key belongs there, never the service_role key.
- `src/lib/api.ts` rewrites `localhost` to `10.0.2.2` for the Android emulator. Always build API URLs from `API_URL`, not from `import.meta.env` directly. `src/lib/supabase.ts` is the shared Supabase client.
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

**Workflow.** Build in small vertical milestones. Each one should be runnable and pass `check`, `lint`, `test`, and `build`. The first milestone is: browser → 3D tabletop → multiplayer connection → join room → see connected players.

**MVP done.** The MVP is done when all of the following work without manual code or DB edits:

1. The GM creates a room and shares a join link.
2. A player joins, and both see the same 3D table.
3. The GM places walls, a door, and tokens.
4. The player moves their token and the GM sees it.
5. The player rolls a d20 and both clients see the result.
6. Chat works.
7. The GM hides and reveals areas.
8. The GM saves the scene, and reloading it rebuilds the table.
