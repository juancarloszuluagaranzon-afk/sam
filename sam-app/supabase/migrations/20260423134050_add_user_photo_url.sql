-- Add foto_url column so each user can store their avatar URL.
alter table app_usuarios
  add column if not exists foto_url text;

-- Create the public avatars bucket if missing (idempotent).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Anonymous clients (the app uses custom PIN auth, not supabase auth)
-- need to upload and overwrite their own avatar objects.
drop policy if exists "avatars_anon_insert" on storage.objects;
create policy "avatars_anon_insert"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_anon_update" on storage.objects;
create policy "avatars_anon_update"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');

-- Public read is already allowed because the bucket is public,
-- but add an explicit anon SELECT policy in case default policies
-- restrict reads in this project.
drop policy if exists "avatars_anon_select" on storage.objects;
create policy "avatars_anon_select"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'avatars');
