-- Repair environments where the historical profile-photo migration is marked
-- applied but the Storage bucket was not created.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-photos',
  'member-photos',
  false,
  524288,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner member photo read" on storage.objects;
drop policy if exists "owner member photo insert" on storage.objects;
drop policy if exists "owner member photo update" on storage.objects;
drop policy if exists "owner member photo delete" on storage.objects;

create policy "owner member photo read" on storage.objects for select
using (
  bucket_id = 'member-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 1)::uuid = public.current_gym_id()
);

create policy "owner member photo insert" on storage.objects for insert
with check (
  bucket_id = 'member-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 1)::uuid = public.current_gym_id()
);

create policy "owner member photo update" on storage.objects for update
using (
  bucket_id = 'member-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 1)::uuid = public.current_gym_id()
)
with check (
  bucket_id = 'member-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 1)::uuid = public.current_gym_id()
);

create policy "owner member photo delete" on storage.objects for delete
using (
  bucket_id = 'member-photos'
  and split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and split_part(name, '/', 1)::uuid = public.current_gym_id()
);

notify pgrst, 'reload schema';
