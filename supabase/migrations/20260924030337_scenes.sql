-- Saved scenes (see server/scene-store.ts). Only the game server touches this
-- table, using the service/secret key, which bypasses row-level security.
-- RLS is on with no policies and no grants for browser roles, so the
-- anon/publishable key shipped in the web bundle can neither read nor list
-- anyone's saves. A scene's id is its only key, like a capability.
create table public.scenes (
	id text primary key check (id ~ '^[0-9a-f]{32}$'),
	name text not null check (char_length(name) between 1 and 48),
	-- A validated scene file (src/lib/game/scene-file.ts); re-validated on every load.
	data jsonb not null check (octet_length(data::text) <= 1100000),
	created_at timestamptz not null default now()
);

alter table public.scenes enable row level security;
revoke all on table public.scenes from anon, authenticated;

comment on table public.scenes is
	'thirdfold saved scenes. Written and read only by the game server (service role); no client access.';
