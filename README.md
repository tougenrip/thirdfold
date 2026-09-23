# thirdfold

One SvelteKit codebase for web, Android/iOS (Capacitor) and desktop (Tauri),
backed by a local Supabase stack and a Redis cache, all in Docker.

The frontend is a static SPA (`adapter-static`, `ssr = false`): no server
routes or form actions. Anything needing a secret, the database directly, or
Redis goes behind Supabase (RLS, Edge Functions) or your own API.

## Getting started

```bash
npm install
cp .env.example .env      # fill VITE_SUPABASE_ANON_KEY from `npx supabase start`
npm run db:start          # local Supabase: API :54321, Postgres :54322, Studio :54323
npm run cache:up          # Redis :6379 (server-side only)
npm run dev               # web on http://localhost:1420
```

## Targets

| Command                                     | Target                          |
| ------------------------------------------- | ------------------------------- |
| `npm run dev` / `npm run build`             | Web (static bundle in `build/`) |
| `npm run desktop` / `npm run desktop:build` | Tauri desktop                   |
| `npm run android` / `npm run ios`           | Capacitor (builds, syncs, runs) |

`android/` and `ios/` are generated and gitignored: recreate with
`npx cap add android` / `npx cap add ios`. For local http APIs on Android,
add the debug cleartext overlay at `android/app/src/debug/AndroidManifest.xml`
(see comments in `capacitor.config.ts`).

Every web change needs `npm run mobile:sync` before it shows in a native build,
and `VITE_` values are baked in at build time.

## Schema

```bash
npx supabase migration new <name>   # write SQL in supabase/migrations/
npx supabase db reset               # replay migrations locally (drops local data)
```

New tables have row-level security on: write a policy, or queries return empty.
