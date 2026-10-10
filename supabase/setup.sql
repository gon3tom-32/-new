-- Database setup for the Color Changer site.
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again; existing data is kept.

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

alter table public.guestbook_entries enable row level security;

drop policy if exists "Anyone can read guestbook entries" on public.guestbook_entries;
create policy "Anyone can read guestbook entries"
  on public.guestbook_entries for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can sign the guestbook" on public.guestbook_entries;
create policy "Anyone can sign the guestbook"
  on public.guestbook_entries for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. Logins: each signed-in visitor's favorite color
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  favorite_color text check (favorite_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

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
