-- Database setup for the Color Changer site.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again; existing data is kept.
--
-- The grants below give the website (the anon and authenticated roles) access
-- to these tables. The policies then limit which rows each visitor can use.

-- ---------------------------------------------------------------------------
-- 1. Shared click counter
-- ---------------------------------------------------------------------------

create table if not exists public.click_counter (
  id int primary key default 1 check (id = 1),
  total bigint not null default 0
);

insert into public.click_counter (id, total)
values (1, 0)
on conflict (id) do nothing;

alter table public.click_counter enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.click_counter to anon, authenticated;

drop policy if exists "Anyone can read the click total" on public.click_counter;
create policy "Anyone can read the click total"
  on public.click_counter for select
  to anon, authenticated
  using (true);

-- Visitors can't write to the table directly; they can only add one click
-- at a time through this function.
create or replace function public.increment_clicks()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.click_counter
  set total = total + 1
  where id = 1
  returning total;
$$;

revoke all on function public.increment_clicks() from public;
grant execute on function public.increment_clicks() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guestbook
-- ---------------------------------------------------------------------------

create table if not exists public.guestbook_entries (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  message text not null check (char_length(btrim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Messages posted while signed in record their author, so the author can
-- remove them later. Messages posted while signed out have no author.
alter table public.guestbook_entries
  add column if not exists user_id uuid default auth.uid()
  references auth.users (id) on delete set null;

alter table public.guestbook_entries enable row level security;

grant select, insert on public.guestbook_entries to anon, authenticated;
grant delete on public.guestbook_entries to authenticated;

drop policy if exists "Anyone can read guestbook entries" on public.guestbook_entries;
create policy "Anyone can read guestbook entries"
  on public.guestbook_entries for select
  to anon, authenticated
  using (true);

-- Visitors can't post a message under someone else's account.
drop policy if exists "Anyone can sign the guestbook" on public.guestbook_entries;
create policy "Anyone can sign the guestbook"
  on public.guestbook_entries for insert
  to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));

drop policy if exists "Users can remove their own guestbook entries" on public.guestbook_entries;
create policy "Users can remove their own guestbook entries"
  on public.guestbook_entries for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 3. Logins: each signed-in visitor's favorite color
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  favorite_color text check (favorite_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

grant select, insert, update on public.profiles to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 4. Photo wall: signed-in visitors upload photos that everyone can see.
--    Files live in a public Storage bucket, in a folder named after the
--    uploader's user id; the photos table lists them with a caption.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can upload photos to their own folder" on storage.objects;
create policy "Users can upload photos to their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Deleting a file also requires being able to see it. (Anyone can still view
-- photos through their public URLs; this only covers the Storage API.)
drop policy if exists "Users can see their own photo files" on storage.objects;
create policy "Users can see their own photo files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own photo files" on storage.objects;
create policy "Users can delete their own photo files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create table if not exists public.photos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null unique,
  caption text check (caption is null or char_length(caption) <= 100),
  created_at timestamptz not null default now()
);

alter table public.photos enable row level security;

grant select on public.photos to anon, authenticated;
grant insert, delete on public.photos to authenticated;

drop policy if exists "Anyone can see the photo wall" on public.photos;
create policy "Anyone can see the photo wall"
  on public.photos for select
  to anon, authenticated
  using (true);

-- A photo can only be listed by its uploader, and only from their own folder.
drop policy if exists "Users can add their own photos" on public.photos;
create policy "Users can add their own photos"
  on public.photos for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and path like (select auth.uid())::text || '/%'
  );

drop policy if exists "Users can remove their own photos" on public.photos;
create policy "Users can remove their own photos"
  on public.photos for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 5. Live updates: send changes to the click total, guestbook, and photos to
--    open pages through Supabase Realtime. Visitors still only receive rows
--    the policies above let them read.
-- ---------------------------------------------------------------------------

do $$
declare
  live_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach live_table in array array['click_counter', 'guestbook_entries', 'photos'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = live_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', live_table);
    end if;
  end loop;
end
$$;
