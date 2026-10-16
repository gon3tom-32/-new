-- Removes the old Color Changer test site's database objects: the click
-- counter, guestbook, favorite-color profiles, photo wall, and admin list.
-- Twelve's tables (all named twelve_*) and everyone's sign-in accounts are
-- left alone.
--
-- This permanently deletes that test data. Run it once in the SQL Editor
-- (New query → paste → Run). Running it again does nothing.
--
-- The photo files themselves live in the "photos" Storage bucket, which
-- Supabase only lets you delete from the dashboard: Storage → photos →
-- select all → Delete, then the bucket's ⋯ menu → Delete bucket.

drop policy if exists "Users can upload photos to their own folder" on storage.objects;
drop policy if exists "Users can see their own photo files" on storage.objects;
drop policy if exists "Users can delete their own photo files" on storage.objects;

drop table if exists public.photos;
drop table if exists public.guestbook_entries;
drop table if exists public.profiles;
drop table if exists public.click_counter;
drop table if exists public.admins;

drop function if exists public.increment_clicks();
drop function if exists public.is_admin();
