-- Campaigns (milestone 58, see server/campaigns.ts): a GM's party carried
-- from adventure to adventure, owned by the hash of their GM key. Each row's
-- `data` is the whole record, re-validated (characters by their rules) on
-- every read. Game server only: RLS on, no policies, nothing granted to
-- browser roles, like public.scenes.
create table public.campaigns (
	id text primary key check (id ~ '^[0-9a-f]{32}$'),
	owner text not null check (owner ~ '^[0-9a-f]{64}$'),
	data jsonb not null check (octet_length(data::text) <= 2000000),
	updated_at timestamptz not null default now()
);

create index campaigns_owner on public.campaigns (owner, updated_at desc);

alter table public.campaigns enable row level security;
revoke all on table public.campaigns from anon, authenticated;

comment on table public.campaigns is
	'thirdfold campaigns: rosters, history and rewards per GM key. Game server only (service role).';
