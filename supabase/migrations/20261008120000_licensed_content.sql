-- Licensed content (milestone 59, see server/licensed/licence-store.ts and
-- docs/LICENSED.md): which creators the server's operator granted each
-- installed licensed source to, and whether a source is withdrawn. Grants
-- are revoked, never deleted. Game server only: RLS on, no policies,
-- nothing granted to browser roles.
create table public.licensed_grants (
	id text primary key check (id ~ '^[0-9a-f]{32}$'),
	source text not null check (source ~ '^[a-z][a-z0-9]*(-[a-z0-9]+){0,5}$'),
	creator text not null check (creator ~ '^[0-9a-f]{16}$'),
	"by" text not null check (char_length("by") between 1 and 60),
	at timestamptz not null default now(),
	expires timestamptz,
	revoked timestamptz,
	note text not null default '' check (char_length(note) <= 200)
);

create index licensed_grants_holder on public.licensed_grants (source, creator, at);

create table public.licensed_status (
	source text primary key check (source ~ '^[a-z][a-z0-9]*(-[a-z0-9]+){0,5}$'),
	status text not null check (status in ('active', 'withdrawn')),
	at timestamptz not null default now(),
	note text not null default '' check (char_length(note) <= 200)
);

alter table public.licensed_grants enable row level security;
alter table public.licensed_status enable row level security;
revoke all on table public.licensed_grants from anon, authenticated;
revoke all on table public.licensed_status from anon, authenticated;

comment on table public.licensed_grants is
	'thirdfold licensed sources granted to creators by the operator. Game server only (service role).';
comment on table public.licensed_status is
	'thirdfold licensed sources withdrawn or active, as the operator set them. Game server only (service role).';
