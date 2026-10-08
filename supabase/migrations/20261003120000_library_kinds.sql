-- The library holds three kinds of thing (milestone 53): adventures, homebrew
-- packs and collections (a campaign's adventures, tables and packs, each at
-- a pinned version). They share the tables, versions, ownership, listing,
-- plays and ratings; a new version keeps its kind. Existing rows are
-- adventures. As before, only the game server's secret key reaches any of it.

alter table public.library_adventures
	add column kind text not null default 'adventure'
		check (kind in ('adventure', 'pack', 'collection'));

create index library_adventures_kind on public.library_adventures (kind, listed);

-- Publishes a new item (version 1) of a kind, or the next version of one the
-- publisher owns and of that kind, in one transaction. Returns the version.
-- Raises 'not_found' (a different kind) or 'forbidden' (someone else's).
drop function public.library_publish(text, text, text, text, text, text, jsonb);

create function public.library_publish(
	target text,
	who text,
	creator text,
	creator_label text,
	label text,
	blurb text,
	body jsonb,
	item_kind text
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
	current_owner text;
	current_kind text;
	next_version integer;
begin
	select a.owner, a.kind, a.version + 1 into current_owner, current_kind, next_version
		from public.library_adventures a where a.id = target for update;
	if not found then
		insert into public.library_adventures
			(id, kind, owner, creator_id, creator_name, title, about, version)
			values (target, item_kind, who, creator, creator_label, label, blurb, 1);
		next_version := 1;
	elsif current_kind <> item_kind then
		raise exception 'not_found';
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

revoke execute on function public.library_publish(text, text, text, text, text, text, jsonb, text)
	from public, anon, authenticated;
grant execute on function public.library_publish(text, text, text, text, text, text, jsonb, text)
	to service_role;
