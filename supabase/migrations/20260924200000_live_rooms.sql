-- Live rooms kept across game-server restarts (see server/room-store.ts). Each
-- row holds a room's seats, including their secret session tokens, so only
-- the game server may touch it: RLS is on with no policies and no grants for
-- browser roles, like public.scenes.
create table public.live_rooms (
	id text primary key check (id ~ '^[A-Z2-9]{6}$'),
	-- A serialized room, re-validated on every load.
	data jsonb not null check (octet_length(data::text) <= 2000000),
	updated_at timestamptz not null default now()
);

alter table public.live_rooms enable row level security;
revoke all on table public.live_rooms from anon, authenticated;

comment on table public.live_rooms is
	'thirdfold live rooms, kept across server restarts. Game server only (service role); holds session tokens.';
