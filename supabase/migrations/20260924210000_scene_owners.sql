-- Saves belong to the GM who made them (see server/scene-store.ts): `owner` is
-- the SHA-256 of the GM's lasting key, never the key itself. Saves from before
-- have no owner and stay loadable by id. `auto` marks the saves a table makes
-- by itself as its story goes on; `summary` is where that story had got to,
-- for the GM's list. RLS stays on with no browser access.
alter table public.scenes
	add column owner text check (owner ~ '^[0-9a-f]{64}$'),
	add column auto boolean not null default false,
	add column summary jsonb check (summary is null or octet_length(summary::text) <= 4000),
	add column saved_at timestamptz not null default now();

create index scenes_owner_saved_at on public.scenes (owner, saved_at desc);
