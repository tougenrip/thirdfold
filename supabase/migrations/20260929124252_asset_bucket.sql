-- The asset store (#191, docs/ASSETS.md "The asset store"): built files by their content-hashed
-- names in a public bucket, served at <project>/storage/v1/object/public/assets/<file>. Anyone
-- may read; nobody but the service key (`npm run assets:publish`, which bypasses RLS) may write:
-- there is no insert, update or delete policy. The browser checks every file against the
-- manifest's SHA-256, so a changed object is refused, never drawn.
--
-- Storage's tables belong to the storage service; where it hasn't run (a Supabase started
-- without storage) there is no bucket to make, and this migration only says so.
do $$
begin
	if to_regclass('storage.buckets') is null then
		raise notice 'storage is not running: no assets bucket';
		return;
	end if;

	insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
	values (
		'assets',
		'assets',
		true,
		16 * 1024 * 1024,
		array['model/gltf-binary', 'image/png', 'image/ktx2', 'audio/wav', 'audio/ogg']
	)
	on conflict (id) do update
	set public = excluded.public,
		file_size_limit = excluded.file_size_limit,
		allowed_mime_types = excluded.allowed_mime_types;

	drop policy if exists "assets are public to read" on storage.objects;
	create policy "assets are public to read"
	on storage.objects for select
	to anon, authenticated
	using (bucket_id = 'assets');
end
$$;
