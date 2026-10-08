-- Who may find, open and play what the library holds (milestone 54, see
-- src/lib/game/access.ts and server/library-access.ts). An item is public
-- (listed), restricted (listed, but only its owner and those granted it may
-- open, play or include it) or private (not listed). Its owner grants roles
-- on it to a creator (by public id), a collection or a table (a room's code,
-- for at most a day); a grant is revoked, never deleted, so who had access
-- when stays on record. The game server decides every request by these;
-- as before, only its secret key reaches any of it.

alter table public.library_adventures
	add column restricted boolean not null default false;

create table public.library_grants (
	id text primary key check (id ~ '^[0-9a-f]{32}$'),
	adventure_id text not null references public.library_adventures (id) on delete cascade,
	target_kind text not null check (target_kind in ('creator', 'collection', 'room')),
	target_id text not null check (
		(target_kind = 'creator' and target_id ~ '^[0-9a-f]{16}$') or
		(target_kind = 'collection' and target_id ~ '^[0-9a-f]{32}$') or
		(target_kind = 'room' and target_id ~ '^[A-Z2-9]{6}$')
	),
	role text not null check (role in ('collaborator', 'member')),
	granted_by text not null check (granted_by ~ '^[0-9a-f]{16}$'),
	granted_at timestamptz not null,
	expires_at timestamptz,
	revoked_at timestamptz,
	note text not null default '' check (char_length(note) <= 120),
	check (role = 'member' or target_kind = 'creator'),
	check (target_kind <> 'room' or expires_at is not null)
);

create index library_grants_item on public.library_grants (adventure_id);
create index library_grants_target on public.library_grants (target_kind, target_id)
	where revoked_at is null;

alter table public.library_grants enable row level security;
revoke all on public.library_grants from anon, authenticated;
