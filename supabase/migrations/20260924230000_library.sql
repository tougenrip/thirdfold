-- The adventure library (see server/library-store.ts): adventures creators
-- publish, their versions, and the ratings of those who played them. Owners
-- are the SHA-256 of a GM's lasting key, never the key. Like the other
-- tables, RLS is on with no policies and nothing is granted to anon or
-- authenticated: only the game server's secret key reaches them.

create table public.library_adventures (
	id text primary key check (id ~ '^[0-9a-f]{32}$'),
	owner text not null check (owner ~ '^[0-9a-f]{64}$'),
	creator_id text not null check (creator_id ~ '^[0-9a-f]{16}$'),
	creator_name text not null check (char_length(creator_name) between 1 and 40),
	title text not null check (char_length(title) between 1 and 200),
	about text not null default '' check (char_length(about) <= 1000),
	listed boolean not null default true,
	version integer not null check (version >= 1),
	published_at timestamptz not null default now(),
	created_at timestamptz not null default now(),
	plays integer not null default 0,
	rating_sum integer not null default 0,
	rating_count integer not null default 0
);

create index library_adventures_owner on public.library_adventures (owner);
create index library_adventures_creator on public.library_adventures (creator_id);

create table public.library_versions (
	adventure_id text not null references public.library_adventures (id) on delete cascade,
	version integer not null check (version between 1 and 100),
	file jsonb not null check (octet_length(file::text) <= 1100000),
	published_at timestamptz not null default now(),
	primary key (adventure_id, version)
);

create table public.library_ratings (
	adventure_id text not null references public.library_adventures (id) on delete cascade,
	rater text not null check (rater ~ '^[0-9a-f]{64}$'),
	stars smallint not null check (stars between 1 and 5),
	rated_at timestamptz not null default now(),
	primary key (adventure_id, rater)
);

alter table public.library_adventures enable row level security;
alter table public.library_versions enable row level security;
alter table public.library_ratings enable row level security;
revoke all on public.library_adventures, public.library_versions, public.library_ratings
	from anon, authenticated;

-- Publishes a new adventure (version 1) or the next version of one the
-- publisher owns, in one transaction. Returns the version. Raises
-- 'not_found' or 'forbidden' (the server turns them into messages).
create function public.library_publish(
	target text,
	who text,
	creator text,
	creator_label text,
	label text,
	blurb text,
	body jsonb
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
	current_owner text;
	next_version integer;
begin
	select a.owner, a.version + 1 into current_owner, next_version
		from public.library_adventures a where a.id = target for update;
	if not found then
		insert into public.library_adventures (id, owner, creator_id, creator_name, title, about, version)
			values (target, who, creator, creator_label, label, blurb, 1);
		next_version := 1;
	elsif current_owner <> who then
		raise exception 'forbidden';
	else
		update public.library_adventures
			set version = next_version, creator_name = creator_label, title = label, about = blurb,
				published_at = now()
			where id = target;
	end if;
	insert into public.library_versions (adventure_id, version, file) values (target, next_version, body);
	return next_version;
end;
$$;

-- A table started playing an adventure.
create function public.library_play(target text) returns void
language sql
security invoker
set search_path = ''
as $$
	update public.library_adventures set plays = plays + 1 where id = target;
$$;

-- Someone rates an adventure (again: their new stars replace the old), and
-- its totals follow.
create function public.library_rate(target text, who text, score smallint) returns void
language sql
security invoker
set search_path = ''
as $$
	insert into public.library_ratings (adventure_id, rater, stars) values (target, who, score)
		on conflict (adventure_id, rater) do update set stars = excluded.stars, rated_at = now();
	update public.library_adventures a
		set rating_sum = t.total, rating_count = t.n
		from (
			select coalesce(sum(r.stars), 0)::integer as total, count(*)::integer as n
			from public.library_ratings r where r.adventure_id = target
		) t
		where a.id = target;
$$;

revoke execute on function public.library_publish(text, text, text, text, text, text, jsonb),
	public.library_play(text),
	public.library_rate(text, text, smallint)
	from public, anon, authenticated;
grant execute on function public.library_publish(text, text, text, text, text, text, jsonb),
	public.library_play(text),
	public.library_rate(text, text, smallint)
	to service_role;
