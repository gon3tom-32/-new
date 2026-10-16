-- Database setup for Twelve (the holiday app in the twelve/ folder).
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Then run twelve_content.sql the same way. Both are safe to run again;
-- existing data is kept. Run them again whenever these files change.
--
-- Every table and function here starts with "twelve_".
--
-- How it fits together:
--   * A group has members, one host, one permanent invite code, and two
--     optional modules (gift exchange, games).
--   * Everything that resets each year carries a "season" (the year). The
--     season rolls over on January 16 (UTC), so New Year's gatherings and a
--     late champion reveal still count toward the year that just ended.
--   * Things that must stay secret (who matched whom, game answers, other
--     players' scores before a day closes) are never readable directly.
--     The app gets them through the functions below, which check who is
--     asking and when.

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seasons and small helpers
-- ---------------------------------------------------------------------------

create or replace function public.twelve_current_season()
returns int
language sql
stable
set search_path = ''
as $$
  select extract(year from (now() at time zone 'UTC') - interval '15 days')::int;
$$;

grant execute on function public.twelve_current_season() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Profiles (one per person, shared across all their groups)
-- ---------------------------------------------------------------------------

create table if not exists public.twelve_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.twelve_profiles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Groups and members
-- ---------------------------------------------------------------------------

create table if not exists public.twelve_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  invite_code text not null unique check (invite_code ~ '^[A-Z2-9]{6}$'),
  host_id uuid not null references auth.users (id),
  gifts_enabled boolean not null default true,
  games_enabled boolean not null default true,
  -- The host's time zone. Game unlocks and reminders use it for everyone.
  timezone text not null default 'UTC',
  created_at timestamptz not null default now()
);

create table if not exists public.twelve_members (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists twelve_members_user_idx on public.twelve_members (user_id);

alter table public.twelve_groups enable row level security;
alter table public.twelve_members enable row level security;

create or replace function public.twelve_is_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.twelve_members
    where group_id = p_group and user_id = (select auth.uid())
  );
$$;

create or replace function public.twelve_is_host(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.twelve_groups
    where id = p_group and host_id = (select auth.uid())
  );
$$;

-- True when the signed-in person shares at least one group with p_user.
create or replace function public.twelve_shares_group(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.twelve_members mine
    join public.twelve_members theirs on theirs.group_id = mine.group_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = p_user
  );
$$;

revoke all on function public.twelve_is_member(uuid) from public;
revoke all on function public.twelve_is_host(uuid) from public;
revoke all on function public.twelve_shares_group(uuid) from public;
grant execute on function public.twelve_is_member(uuid) to authenticated;
grant execute on function public.twelve_is_host(uuid) to authenticated;
grant execute on function public.twelve_shares_group(uuid) to authenticated;

grant select, insert, update on public.twelve_profiles to authenticated;

drop policy if exists "See your own profile and your groupmates'" on public.twelve_profiles;
create policy "See your own profile and your groupmates'"
  on public.twelve_profiles for select
  to authenticated
  using (id = (select auth.uid()) or public.twelve_shares_group(id));

drop policy if exists "Create your own profile" on public.twelve_profiles;
create policy "Create your own profile"
  on public.twelve_profiles for insert
  to authenticated
  with check (id = (select auth.uid()));

drop policy if exists "Update your own profile" on public.twelve_profiles;
create policy "Update your own profile"
  on public.twelve_profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Groups are created and changed through the functions below.
grant select on public.twelve_groups to authenticated;
grant select on public.twelve_members to authenticated;

drop policy if exists "Members see their groups" on public.twelve_groups;
create policy "Members see their groups"
  on public.twelve_groups for select
  to authenticated
  using (public.twelve_is_member(id));

drop policy if exists "Members see who else is in the group" on public.twelve_members;
create policy "Members see who else is in the group"
  on public.twelve_members for select
  to authenticated
  using (public.twelve_is_member(group_id));

-- ---------------------------------------------------------------------------
-- 3. Notifications (in-app inbox, also sent as push notifications)
-- ---------------------------------------------------------------------------

create table if not exists public.twelve_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.twelve_groups (id) on delete cascade,
  title text not null,
  body text not null default '',
  url text not null default '',
  -- Scheduled reminders use this so each one is only ever sent once.
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);

create index if not exists twelve_notifications_user_idx
  on public.twelve_notifications (user_id, created_at desc);
create index if not exists twelve_notifications_unpushed_idx
  on public.twelve_notifications (created_at) where pushed_at is null;

alter table public.twelve_notifications enable row level security;

grant select on public.twelve_notifications to authenticated;
grant update (read_at) on public.twelve_notifications to authenticated;

drop policy if exists "See your own notifications" on public.twelve_notifications;
create policy "See your own notifications"
  on public.twelve_notifications for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Mark your own notifications read" on public.twelve_notifications;
create policy "Mark your own notifications read"
  on public.twelve_notifications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.twelve_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.twelve_push_subscriptions enable row level security;

grant select, insert, delete on public.twelve_push_subscriptions to authenticated;

drop policy if exists "Manage your own push subscriptions" on public.twelve_push_subscriptions;
create policy "Manage your own push subscriptions"
  on public.twelve_push_subscriptions for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Internal: queue a notification. Not callable from the app.
create or replace function public.twelve_notify(
  p_user uuid, p_group uuid, p_title text, p_body text, p_url text, p_dedupe text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  values (p_user, p_group, p_title, p_body, p_url, p_dedupe)
  on conflict (dedupe_key) do nothing;
$$;

revoke all on function public.twelve_notify(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Internal: notify every member of a group (optionally skipping one person).
create or replace function public.twelve_notify_group(
  p_group uuid, p_title text, p_body text, p_url text, p_skip uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.twelve_notifications (user_id, group_id, title, body, url)
  select user_id, p_group, p_title, p_body, p_url
  from public.twelve_members
  where group_id = p_group and user_id is distinct from p_skip;
$$;

revoke all on function public.twelve_notify_group(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Creating, joining, and running a group
-- ---------------------------------------------------------------------------

-- Look up a group by invite code before joining (works before signing in,
-- so the app can show "You're joining The Smiths").
create or replace function public.twelve_peek_invite(p_code text)
returns table (group_id uuid, name text, host_name text, member_count int)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, p.display_name,
    (select count(*)::int from public.twelve_members m where m.group_id = g.id)
  from public.twelve_groups g
  left join public.twelve_profiles p on p.id = g.host_id
  where g.invite_code = upper(btrim(p_code));
$$;

revoke all on function public.twelve_peek_invite(text) from public;
grant execute on function public.twelve_peek_invite(text) to anon, authenticated;

create or replace function public.twelve_create_group(
  p_name text, p_gifts boolean, p_games boolean, p_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text;
  v_id uuid;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  if not exists (select 1 from public.twelve_profiles where id = v_uid) then
    raise exception 'Please set up your profile first.';
  end if;
  if not (p_gifts or p_games) then
    raise exception 'Turn on the gift exchange, the games, or both.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    p_timezone := 'UTC';
  end if;

  loop
    select string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
    into v_code
    from generate_series(1, 6);
    exit when not exists (select 1 from public.twelve_groups where invite_code = v_code);
  end loop;

  insert into public.twelve_groups (name, invite_code, host_id, gifts_enabled, games_enabled, timezone)
  values (btrim(p_name), v_code, v_uid, p_gifts, p_games, p_timezone)
  returning id into v_id;

  insert into public.twelve_members (group_id, user_id) values (v_id, v_uid);
  return v_id;
end;
$$;

revoke all on function public.twelve_create_group(text, boolean, boolean, text) from public;
grant execute on function public.twelve_create_group(text, boolean, boolean, text) to authenticated;

create or replace function public.twelve_join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first.';
  end if;
  if not exists (select 1 from public.twelve_profiles where id = v_uid) then
    raise exception 'Please set up your profile first.';
  end if;

  select id into v_group from public.twelve_groups where invite_code = upper(btrim(p_code));
  if v_group is null then
    raise exception 'That invite code doesn''t match any group. Check it and try again.';
  end if;

  insert into public.twelve_members (group_id, user_id)
  values (v_group, v_uid)
  on conflict do nothing;
  return v_group;
end;
$$;

revoke all on function public.twelve_join_group(text) from public;
grant execute on function public.twelve_join_group(text) to authenticated;

create or replace function public.twelve_update_group(
  p_group uuid, p_name text, p_gifts boolean, p_games boolean, p_timezone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can change group settings.';
  end if;
  if not (p_gifts or p_games) then
    raise exception 'Keep at least one of the gift exchange or the games turned on.';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone: %', p_timezone;
  end if;
  update public.twelve_groups
  set name = btrim(p_name), gifts_enabled = p_gifts, games_enabled = p_games, timezone = p_timezone
  where id = p_group;
end;
$$;

revoke all on function public.twelve_update_group(uuid, text, boolean, boolean, text) from public;
grant execute on function public.twelve_update_group(uuid, text, boolean, boolean, text) to authenticated;

-- The host removes someone, or a member (not the host) leaves.
create or replace function public.twelve_remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_host uuid;
  v_season int := public.twelve_current_season();
begin
  select host_id into v_host from public.twelve_groups where id = p_group;
  if v_host is null or not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if p_user = v_host then
    raise exception 'The host can''t be removed from the group.';
  end if;
  if v_uid <> v_host and v_uid <> p_user then
    raise exception 'Only the host can remove people.';
  end if;

  delete from public.twelve_members where group_id = p_group and user_id = p_user;
  -- Before the draw, they also leave this year's gift exchange. (After the
  -- draw their match stays as it is; that case is deliberately out of scope.)
  delete from public.twelve_gift_participants gp
  where gp.group_id = p_group and gp.season = v_season and gp.user_id = p_user
    and not exists (
      select 1 from public.twelve_gift_seasons gs
      where gs.group_id = p_group and gs.season = v_season and gs.drawn_at is not null
    );
  delete from public.twelve_couples
  where group_id = p_group and (user_a = p_user or user_b = p_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Group chat (one thread per group; only this season's messages show)
-- ---------------------------------------------------------------------------

create table if not exists public.twelve_chat_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null default public.twelve_current_season(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists twelve_chat_group_idx
  on public.twelve_chat_messages (group_id, season, created_at desc);

alter table public.twelve_chat_messages enable row level security;

grant select, insert on public.twelve_chat_messages to authenticated;

drop policy if exists "Members read their group chat" on public.twelve_chat_messages;
create policy "Members read their group chat"
  on public.twelve_chat_messages for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Members post in their group chat" on public.twelve_chat_messages;
create policy "Members post in their group chat"
  on public.twelve_chat_messages for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and season = public.twelve_current_season()
    and public.twelve_is_member(group_id)
  );

-- Emoji reactions on chat messages: one per person per message, from a
-- fixed set of five. Picking a different emoji replaces yours.
create table if not exists public.twelve_chat_reactions (
  message_id bigint not null references public.twelve_chat_messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  emoji text not null check (emoji in ('❤️', '😂', '😮', '👍', '🎄')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists twelve_chat_reactions_group_idx
  on public.twelve_chat_reactions (group_id, message_id);

-- Lets live updates for removed reactions reach the right group.
alter table public.twelve_chat_reactions replica identity full;

alter table public.twelve_chat_reactions enable row level security;

grant select, insert, update, delete on public.twelve_chat_reactions to authenticated;

drop policy if exists "Members see reactions in their group chat" on public.twelve_chat_reactions;
create policy "Members see reactions in their group chat"
  on public.twelve_chat_reactions for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Members react to messages in their group chat" on public.twelve_chat_reactions;
create policy "Members react to messages in their group chat"
  on public.twelve_chat_reactions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.twelve_is_member(group_id)
    and exists (
      select 1 from public.twelve_chat_messages m
      where m.id = message_id and m.group_id = twelve_chat_reactions.group_id
    )
  );

drop policy if exists "Change your own reaction" on public.twelve_chat_reactions;
create policy "Change your own reaction"
  on public.twelve_chat_reactions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.twelve_is_member(group_id)
    and exists (
      select 1 from public.twelve_chat_messages m
      where m.id = message_id and m.group_id = twelve_chat_reactions.group_id
    )
  );

drop policy if exists "Remove your own reaction" on public.twelve_chat_reactions;
create policy "Remove your own reaction"
  on public.twelve_chat_reactions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Gift exchange
-- ---------------------------------------------------------------------------

-- This year's settings for a group's exchange.
create table if not exists public.twelve_gift_seasons (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  budget text check (budget is null or char_length(budget) <= 60),
  gathering_date date,
  drawn_at timestamptz,
  primary key (group_id, season)
);

-- Who is in this year's exchange.
create table if not exists public.twelve_gift_participants (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, season, user_id)
);

-- Couples are a standing rule: they carry over from year to year.
create table if not exists public.twelve_couples (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  primary key (group_id, user_a, user_b),
  check (user_a < user_b)
);

-- Who gives to whom. Each giver can only ever read their own row.
create table if not exists public.twelve_matches (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  giver_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  revealed_at timestamptz,
  bought boolean not null default false,
  primary key (group_id, season, giver_id),
  unique (group_id, season, recipient_id)
);

create table if not exists public.twelve_questionnaires (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  answers jsonb not null default '[]'::jsonb check (jsonb_typeof(answers) = 'array'),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (group_id, season, user_id)
);

-- The anonymous Q&A between a giver and their recipient. The recipient can't
-- read this table; they get their thread through twelve_anon_thread(), which
-- never says who the giver is.
create table if not exists public.twelve_anon_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  giver_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  from_giver boolean not null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists twelve_anon_thread_idx
  on public.twelve_anon_messages (group_id, season, giver_id, created_at);

alter table public.twelve_gift_seasons enable row level security;
alter table public.twelve_gift_participants enable row level security;
alter table public.twelve_couples enable row level security;
alter table public.twelve_matches enable row level security;
alter table public.twelve_questionnaires enable row level security;
alter table public.twelve_anon_messages enable row level security;

grant select on public.twelve_gift_seasons to authenticated;
grant select on public.twelve_gift_participants to authenticated;
grant select on public.twelve_couples to authenticated;
grant select on public.twelve_matches to authenticated;
grant update (bought, revealed_at) on public.twelve_matches to authenticated;
grant select, insert, update on public.twelve_questionnaires to authenticated;
grant select on public.twelve_anon_messages to authenticated;

drop policy if exists "Members see the exchange settings" on public.twelve_gift_seasons;
create policy "Members see the exchange settings"
  on public.twelve_gift_seasons for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Members see who is in the exchange" on public.twelve_gift_participants;
create policy "Members see who is in the exchange"
  on public.twelve_gift_participants for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Members see the couples" on public.twelve_couples;
create policy "Members see the couples"
  on public.twelve_couples for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Givers see only their own match" on public.twelve_matches;
create policy "Givers see only their own match"
  on public.twelve_matches for select
  to authenticated
  using (giver_id = (select auth.uid()));

drop policy if exists "Givers update their own match" on public.twelve_matches;
create policy "Givers update their own match"
  on public.twelve_matches for update
  to authenticated
  using (giver_id = (select auth.uid()))
  with check (giver_id = (select auth.uid()));

-- Your own answers, plus the answers of the person you're giving to.
drop policy if exists "See your answers and your recipient's" on public.twelve_questionnaires;
create policy "See your answers and your recipient's"
  on public.twelve_questionnaires for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.twelve_matches m
      where m.group_id = twelve_questionnaires.group_id
        and m.season = twelve_questionnaires.season
        and m.giver_id = (select auth.uid())
        and m.recipient_id = twelve_questionnaires.user_id
    )
  );

drop policy if exists "Write your own answers" on public.twelve_questionnaires;
create policy "Write your own answers"
  on public.twelve_questionnaires for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and season = public.twelve_current_season()
    and public.twelve_is_member(group_id)
  );

drop policy if exists "Update your own answers" on public.twelve_questionnaires;
create policy "Update your own answers"
  on public.twelve_questionnaires for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and season = public.twelve_current_season());

drop policy if exists "Givers read their side of the anonymous chat" on public.twelve_anon_messages;
create policy "Givers read their side of the anonymous chat"
  on public.twelve_anon_messages for select
  to authenticated
  using (giver_id = (select auth.uid()));

-- Now that the gift tables exist, finish twelve_remove_member's grants.
revoke all on function public.twelve_remove_member(uuid, uuid) from public;
grant execute on function public.twelve_remove_member(uuid, uuid) to authenticated;

-- Host: set the budget guideline and gathering date. They can change these
-- at any time; every change is announced to the whole group.
create or replace function public.twelve_set_gift_settings(
  p_group uuid, p_budget text, p_gathering_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_old public.twelve_gift_seasons;
  v_changes text[] := '{}';
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can change the exchange settings.';
  end if;
  p_budget := nullif(btrim(p_budget), '');

  select * into v_old from public.twelve_gift_seasons where group_id = p_group and season = v_season;

  insert into public.twelve_gift_seasons (group_id, season, budget, gathering_date)
  values (p_group, v_season, p_budget, p_gathering_date)
  on conflict (group_id, season) do update
    set budget = excluded.budget, gathering_date = excluded.gathering_date;

  if v_old.group_id is not null and v_old.budget is distinct from p_budget and p_budget is not null then
    v_changes := v_changes || ('The budget is now ' || p_budget || '.');
  end if;
  if v_old.group_id is not null and v_old.gathering_date is distinct from p_gathering_date
     and p_gathering_date is not null then
    v_changes := v_changes || ('The gathering is now on ' || to_char(p_gathering_date, 'FMDay, FMMonth FMDD') || '.');
  end if;

  if array_length(v_changes, 1) > 0 then
    perform public.twelve_notify_group(
      p_group, 'Gift exchange update', array_to_string(v_changes, ' '),
      '#/g/' || p_group || '/gifts', (select auth.uid())
    );
  end if;
end;
$$;

revoke all on function public.twelve_set_gift_settings(uuid, text, date) from public;
grant execute on function public.twelve_set_gift_settings(uuid, text, date) to authenticated;

-- Join or leave this year's exchange. Anyone can opt themselves in or out;
-- the host can add or remove anyone. Only before the draw.
create or replace function public.twelve_set_gift_participant(p_group uuid, p_user uuid, p_in boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_season int := public.twelve_current_season();
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if p_user <> v_uid and not public.twelve_is_host(p_group) then
    raise exception 'Only the host can add or remove other people.';
  end if;
  if not exists (select 1 from public.twelve_groups where id = p_group and gifts_enabled) then
    raise exception 'The gift exchange is turned off for this group.';
  end if;
  if exists (
    select 1 from public.twelve_gift_seasons
    where group_id = p_group and season = v_season and drawn_at is not null
  ) then
    raise exception 'Names have already been drawn this year.';
  end if;
  if not exists (select 1 from public.twelve_members where group_id = p_group and user_id = p_user) then
    raise exception 'That person isn''t in this group.';
  end if;

  if p_in then
    insert into public.twelve_gift_participants (group_id, season, user_id)
    values (p_group, v_season, p_user)
    on conflict do nothing;
  else
    delete from public.twelve_gift_participants
    where group_id = p_group and season = v_season and user_id = p_user;
  end if;
end;
$$;

revoke all on function public.twelve_set_gift_participant(uuid, uuid, boolean) from public;
grant execute on function public.twelve_set_gift_participant(uuid, uuid, boolean) to authenticated;

create or replace function public.twelve_set_couple(p_group uuid, p_a uuid, p_b uuid, p_couple boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lo uuid := least(p_a, p_b);
  v_hi uuid := greatest(p_a, p_b);
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can set couples.';
  end if;
  if p_a = p_b then
    raise exception 'Pick two different people.';
  end if;
  if p_couple then
    if (select count(*) from public.twelve_members where group_id = p_group and user_id in (p_a, p_b)) <> 2 then
      raise exception 'Both people need to be in the group.';
    end if;
    insert into public.twelve_couples (group_id, user_a, user_b)
    values (p_group, v_lo, v_hi)
    on conflict do nothing;
  else
    delete from public.twelve_couples where group_id = p_group and user_a = v_lo and user_b = v_hi;
  end if;
end;
$$;

revoke all on function public.twelve_set_couple(uuid, uuid, uuid, boolean) from public;
grant execute on function public.twelve_set_couple(uuid, uuid, uuid, boolean) to authenticated;

-- Host: draw names. Nobody gets themselves, couples never get each other,
-- everything else is random. Everyone in the exchange is notified privately.
create or replace function public.twelve_draw_names(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_people uuid[];
  v_order uuid[];
  v_n int;
  v_ok boolean;
  v_try int := 0;
  i int;
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can draw names.';
  end if;
  if not exists (select 1 from public.twelve_groups where id = p_group and gifts_enabled) then
    raise exception 'The gift exchange is turned off for this group.';
  end if;

  -- Lock this year's row so two taps can't draw twice.
  insert into public.twelve_gift_seasons (group_id, season)
  values (p_group, v_season)
  on conflict do nothing;
  perform 1 from public.twelve_gift_seasons
  where group_id = p_group and season = v_season
  for update;
  if exists (
    select 1 from public.twelve_gift_seasons
    where group_id = p_group and season = v_season and drawn_at is not null
  ) then
    raise exception 'Names have already been drawn this year.';
  end if;

  select array_agg(user_id order by user_id) into v_people
  from public.twelve_gift_participants
  where group_id = p_group and season = v_season;
  v_n := coalesce(array_length(v_people, 1), 0);
  if v_n < 2 then
    raise exception 'At least two people need to be in the exchange.';
  end if;

  -- Shuffle and check; with this few people a valid draw turns up quickly.
  loop
    v_try := v_try + 1;
    select array_agg(p order by random()) into v_order from unnest(v_people) as p;
    v_ok := true;
    for i in 1..v_n loop
      if v_people[i] = v_order[i] or exists (
        select 1 from public.twelve_couples c
        where c.group_id = p_group
          and c.user_a = least(v_people[i], v_order[i])
          and c.user_b = greatest(v_people[i], v_order[i])
      ) then
        v_ok := false;
        exit;
      end if;
    end loop;
    exit when v_ok;
    if v_try >= 5000 then
      raise exception 'There''s no way to draw names with these couples. Add more people or remove a couple.';
    end if;
  end loop;

  insert into public.twelve_matches (group_id, season, giver_id, recipient_id)
  select p_group, v_season, v_people[k.n], v_order[k.n]
  from generate_series(1, v_n) as k(n);

  update public.twelve_gift_seasons set drawn_at = now()
  where group_id = p_group and season = v_season;

  insert into public.twelve_notifications (user_id, group_id, title, body, url)
  select gp.user_id, p_group, 'Your match is ready 🎁',
    'Names have been drawn in ' || g.name || '. Scratch to see who you got!',
    '#/g/' || p_group || '/gifts'
  from public.twelve_gift_participants gp
  join public.twelve_groups g on g.id = gp.group_id
  where gp.group_id = p_group and gp.season = v_season;
end;
$$;

revoke all on function public.twelve_draw_names(uuid) from public;
grant execute on function public.twelve_draw_names(uuid) to authenticated;

-- Send a message in the anonymous chat. A giver writes to their recipient;
-- a recipient writes back to their (unknown) giver.
create or replace function public.twelve_send_anon(p_group uuid, p_as_giver boolean, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_season int := public.twelve_current_season();
  v_match public.twelve_matches;
begin
  if p_as_giver then
    select * into v_match from public.twelve_matches
    where group_id = p_group and season = v_season and giver_id = v_uid;
  else
    select * into v_match from public.twelve_matches
    where group_id = p_group and season = v_season and recipient_id = v_uid;
  end if;
  if v_match.group_id is null then
    raise exception 'Names haven''t been drawn yet.';
  end if;

  insert into public.twelve_anon_messages (group_id, season, giver_id, recipient_id, from_giver, body)
  values (p_group, v_season, v_match.giver_id, v_match.recipient_id, p_as_giver, btrim(p_body));

  if p_as_giver then
    perform public.twelve_notify(v_match.recipient_id, p_group, 'Your Secret Santa has a question 🤫',
      left(btrim(p_body), 140), '#/g/' || p_group || '/gifts/santa');
  else
    perform public.twelve_notify(v_match.giver_id, p_group, 'Your giftee wrote back',
      left(btrim(p_body), 140), '#/g/' || p_group || '/gifts/ask');
  end if;
end;
$$;

revoke all on function public.twelve_send_anon(uuid, boolean, text) from public;
grant execute on function public.twelve_send_anon(uuid, boolean, text) to authenticated;

-- The recipient's view of the anonymous chat: messages with their giver,
-- with no giver id in sight.
create or replace function public.twelve_anon_inbox(p_group uuid)
returns table (id bigint, from_me boolean, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, not a.from_giver, a.body, a.created_at
  from public.twelve_anon_messages a
  where a.group_id = p_group
    and a.season = public.twelve_current_season()
    and a.recipient_id = (select auth.uid())
  order by a.created_at;
$$;

revoke all on function public.twelve_anon_inbox(uuid) from public;
grant execute on function public.twelve_anon_inbox(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The 12 Days of Games
-- ---------------------------------------------------------------------------

-- Built-in content. Each format has a couple of packs so a repeated format
-- gets fresh questions. Filled in by twelve_content.sql. The app never reads
-- this table directly (answers live here); twelve_get_day() serves it.
create table if not exists public.twelve_game_packs (
  format text not null,
  pack int not null,
  title text not null,
  content jsonb not null,
  answers jsonb,
  primary key (format, pack)
);

alter table public.twelve_game_packs enable row level security;
revoke all on public.twelve_game_packs from anon, authenticated;

create table if not exists public.twelve_game_seasons (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  start_date date not null,
  unlock_time time not null,
  repeat_formats text[] not null,
  champion_revealed_at timestamptz,
  primary key (group_id, season)
);

create table if not exists public.twelve_game_days (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  day int not null check (day between 1 and 12),
  format text not null,
  pack int not null,
  -- Photo Challenge only: the host's pick.
  winner_id uuid references auth.users (id) on delete set null,
  primary key (group_id, season, day)
);

create table if not exists public.twelve_game_plays (
  group_id uuid not null references public.twelve_groups (id) on delete cascade,
  season int not null,
  day int not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  response jsonb,
  score int,
  primary key (group_id, season, day, user_id)
);

alter table public.twelve_game_seasons enable row level security;
alter table public.twelve_game_days enable row level security;
alter table public.twelve_game_plays enable row level security;

grant select on public.twelve_game_seasons to authenticated;
grant select on public.twelve_game_days to authenticated;
grant select on public.twelve_game_plays to authenticated;

drop policy if exists "Members see the game schedule" on public.twelve_game_seasons;
create policy "Members see the game schedule"
  on public.twelve_game_seasons for select
  to authenticated
  using (public.twelve_is_member(group_id));

drop policy if exists "Members see which game is on which day" on public.twelve_game_days;
create policy "Members see which game is on which day"
  on public.twelve_game_days for select
  to authenticated
  using (public.twelve_is_member(group_id));

-- Only your own plays. Other people's results come from the leaderboard
-- function once each day has closed.
drop policy if exists "See your own plays" on public.twelve_game_plays;
create policy "See your own plays"
  on public.twelve_game_plays for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The nine formats that can appear on days 1–11 (Day 12 is always the Finale).
create or replace function public.twelve_formats()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['trivia', 'bingo', 'emoji', 'two_truths', 'photo', 'lyrics', 'wyr', 'speed_match', 'scavenger'];
$$;

grant execute on function public.twelve_formats() to authenticated;

create or replace function public.twelve_day_unlock(p_group uuid, p_season int, p_day int)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((gs.start_date + (p_day - 1)) + gs.unlock_time) at time zone g.timezone
  from public.twelve_game_seasons gs
  join public.twelve_groups g on g.id = gs.group_id
  where gs.group_id = p_group and gs.season = p_season;
$$;

-- A day closes 24 hours after it unlocks. Day 12 also closes the moment the
-- host reveals the champion.
create or replace function public.twelve_day_close(p_group uuid, p_season int, p_day int)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_day = 12 and gs.champion_revealed_at is not null
      then least(public.twelve_day_unlock(p_group, p_season, p_day) + interval '24 hours', gs.champion_revealed_at)
    else public.twelve_day_unlock(p_group, p_season, p_day) + interval '24 hours'
  end
  from public.twelve_game_seasons gs
  where gs.group_id = p_group and gs.season = p_season;
$$;

revoke all on function public.twelve_day_unlock(uuid, int, int) from public;
revoke all on function public.twelve_day_close(uuid, int, int) from public;
grant execute on function public.twelve_day_unlock(uuid, int, int) to authenticated;
grant execute on function public.twelve_day_close(uuid, int, int) to authenticated;

-- Internal: write days 1–12 from an ordered list of 11 formats. The first
-- time a format appears it uses pack 1, the second time pack 2.
create or replace function public.twelve_write_days(p_group uuid, p_season int, p_order text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i int;
  v_pack int;
begin
  for i in 1..11 loop
    select count(*) + 1 into v_pack from unnest(p_order[1:i - 1]) as f where f = p_order[i];
    insert into public.twelve_game_days (group_id, season, day, format, pack)
    values (p_group, p_season, i, p_order[i], v_pack)
    on conflict (group_id, season, day) do update
      set format = excluded.format, pack = excluded.pack, winner_id = null
      where public.twelve_game_days.format is distinct from excluded.format
         or public.twelve_game_days.pack is distinct from excluded.pack;
  end loop;
  insert into public.twelve_game_days (group_id, season, day, format, pack)
  values (p_group, p_season, 12, 'finale', 1)
  on conflict (group_id, season, day) do nothing;
end;
$$;

revoke all on function public.twelve_write_days(uuid, int, text[]) from public, anon, authenticated;

-- Host: schedule the games. p_start_date is Day 1 (Day 12 must still fall in
-- December). p_repeats are the two formats that get a second day.
create or replace function public.twelve_set_game_settings(
  p_group uuid, p_start_date date, p_unlock_time time, p_repeats text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_existing public.twelve_game_seasons;
  v_order text[];
  v_started boolean := false;
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can schedule the games.';
  end if;
  if p_start_date < make_date(v_season, 12, 1) or p_start_date > make_date(v_season, 12, 20) then
    raise exception 'Day 1 needs to be between December 1 and December 20 so all twelve days fit in December.';
  end if;
  if coalesce(array_length(p_repeats, 1), 0) <> 2 or p_repeats[1] = p_repeats[2]
     or not (p_repeats <@ public.twelve_formats()) then
    raise exception 'Pick two different games to repeat.';
  end if;

  select * into v_existing from public.twelve_game_seasons where group_id = p_group and season = v_season;
  if v_existing.group_id is not null then
    v_started := public.twelve_day_unlock(p_group, v_season, 1) <= now();
  end if;

  if v_started then
    if p_start_date <> v_existing.start_date or p_unlock_time <> v_existing.unlock_time
       or not (p_repeats @> v_existing.repeat_formats and p_repeats <@ v_existing.repeat_formats) then
      raise exception 'The games have already started, so the schedule can''t change now.';
    end if;
    return;
  end if;

  insert into public.twelve_game_seasons (group_id, season, start_date, unlock_time, repeat_formats)
  values (p_group, v_season, p_start_date, p_unlock_time, p_repeats)
  on conflict (group_id, season) do update
    set start_date = excluded.start_date, unlock_time = excluded.unlock_time,
        repeat_formats = excluded.repeat_formats;

  -- Keep the host's custom order if the repeats didn't change; otherwise
  -- start from the default order: each game once, then the two repeats.
  if v_existing.group_id is not null
     and p_repeats @> v_existing.repeat_formats and p_repeats <@ v_existing.repeat_formats then
    return;
  end if;
  v_order := public.twelve_formats() || p_repeats;
  perform public.twelve_write_days(p_group, v_season, v_order);
end;
$$;

revoke all on function public.twelve_set_game_settings(uuid, date, time, text[]) from public;
grant execute on function public.twelve_set_game_settings(uuid, date, time, text[]) to authenticated;

-- Host: rearrange days 1–11. Days that have already unlocked must stay put.
create or replace function public.twelve_set_game_order(p_group uuid, p_order text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_gs public.twelve_game_seasons;
  v_expected text[];
  i int;
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can rearrange the games.';
  end if;
  select * into v_gs from public.twelve_game_seasons where group_id = p_group and season = v_season;
  if v_gs.group_id is null then
    raise exception 'Schedule the games first.';
  end if;
  if coalesce(array_length(p_order, 1), 0) <> 11 then
    raise exception 'Days 1 to 11 each need a game.';
  end if;

  v_expected := public.twelve_formats() || v_gs.repeat_formats;
  if (select array_agg(f order by f) from unnest(p_order) f)
     is distinct from (select array_agg(f order by f) from unnest(v_expected) f) then
    raise exception 'Every game needs to appear once, plus the two repeats.';
  end if;

  for i in 1..11 loop
    if public.twelve_day_unlock(p_group, v_season, i) <= now() and exists (
      select 1 from public.twelve_game_days
      where group_id = p_group and season = v_season and day = i and format <> p_order[i]
    ) then
      raise exception 'Day % has already unlocked, so it can''t move.', i;
    end if;
  end loop;

  perform public.twelve_write_days(p_group, v_season, p_order);
end;
$$;

revoke all on function public.twelve_set_game_order(uuid, text[]) from public;
grant execute on function public.twelve_set_game_order(uuid, text[]) to authenticated;

-- Internal: the Finale's questions, picked from the quiz-style games played
-- on days 1–11. Every player gets the same twelve.
create or replace function public.twelve_finale_items(p_group uuid, p_season int)
returns table (prompt text, choices jsonb, answer int, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with quiz_days as (
    select d.day, d.format, p.title, p.content, p.answers
    from public.twelve_game_days d
    join public.twelve_game_packs p on p.format = d.format and p.pack = d.pack
    where d.group_id = p_group and d.season = p_season and d.day <= 11
      and d.format in ('trivia', 'emoji', 'two_truths', 'lyrics')
  ),
  items as (
    select q.day, q.format, q.title, (item.ord - 1)::int as idx, item.value as question,
      (q.answers -> 'correct' ->> (item.ord - 1)::int)::int as answer,
      row_number() over (
        partition by q.day
        order by md5(p_group::text || q.day::text || item.ord::text)
      ) as pick
    from quiz_days q,
      jsonb_array_elements(q.content -> 'questions') with ordinality as item(value, ord)
  )
  select
    i.question ->> 'prompt',
    i.question -> 'choices',
    i.answer,
    'Day ' || i.day || ' · ' || i.title
  from items i
  where i.pick <= 3
  order by md5(p_group::text || 'finale' || i.day::text || i.idx::text)
  limit 12;
$$;

revoke all on function public.twelve_finale_items(uuid, int) from public, anon, authenticated;

-- Internal: everything needed to describe one day, as the database sees it.
create or replace function public.twelve_day_row(p_group uuid, p_day int)
returns table (
  season int, format text, pack int, unlocks_at timestamptz, closes_at timestamptz,
  content jsonb, answers jsonb, title text, winner_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if p_day = 12 then
    return query
    select v_season, d.format, d.pack,
      public.twelve_day_unlock(p_group, v_season, 12),
      public.twelve_day_close(p_group, v_season, 12),
      jsonb_build_object(
        'intro', 'Twelve questions pulled from everything you played this month.',
        'questions', coalesce(jsonb_agg(jsonb_build_object(
          'prompt', f.prompt, 'choices', f.choices, 'source', f.source)), '[]'::jsonb)
      ),
      jsonb_build_object('correct', coalesce(jsonb_agg(f.answer), '[]'::jsonb)),
      'Finale Quiz'::text,
      d.winner_id
    from public.twelve_game_days d
    left join lateral public.twelve_finale_items(p_group, v_season) f on true
    where d.group_id = p_group and d.season = v_season and d.day = 12
    group by d.format, d.pack, d.winner_id;
  else
    return query
    select v_season, d.format, d.pack,
      public.twelve_day_unlock(p_group, v_season, p_day),
      public.twelve_day_close(p_group, v_season, p_day),
      p.content, p.answers, p.title, d.winner_id
    from public.twelve_game_days d
    join public.twelve_game_packs p on p.format = d.format and p.pack = d.pack
    where d.group_id = p_group and d.season = v_season and d.day = p_day;
  end if;
end;
$$;

revoke all on function public.twelve_day_row(uuid, int) from public, anon, authenticated;

-- What the app shows for one day: the game (once it unlocks), your own play,
-- and the answers (once it closes). For the timed games (Scavenger Hunt,
-- Speed-Matching) the content stays hidden until you press start.
create or replace function public.twelve_get_day(p_group uuid, p_day int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
  v_play public.twelve_game_plays;
  v_state text;
  v_show_content boolean;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  select * into r from public.twelve_day_row(p_group, p_day);
  if r.format is null then
    return null;
  end if;

  select * into v_play from public.twelve_game_plays
  where group_id = p_group and season = r.season and day = p_day and user_id = v_uid;

  v_state := case
    when now() < r.unlocks_at then 'locked'
    when now() < r.closes_at then 'open'
    else 'closed'
  end;
  v_show_content := v_state <> 'locked'
    and (r.format not in ('scavenger', 'speed_match') or v_play.user_id is not null or v_state = 'closed');

  return jsonb_build_object(
    'day', p_day,
    'format', r.format,
    'title', r.title,
    'state', v_state,
    'unlocks_at', r.unlocks_at,
    'closes_at', r.closes_at,
    'content', case when v_show_content then r.content end,
    'answers', case when v_state = 'closed' then r.answers end,
    'winner_id', case when v_state = 'closed' then r.winner_id end,
    'play', case when v_play.user_id is null then null else jsonb_build_object(
      'started_at', v_play.started_at,
      'submitted_at', v_play.submitted_at,
      'response', v_play.response,
      'score', v_play.score
    ) end
  );
end;
$$;

revoke all on function public.twelve_get_day(uuid, int) from public;
grant execute on function public.twelve_get_day(uuid, int) to authenticated;

-- Start a day's game. Timed games measure from here.
create or replace function public.twelve_start_play(p_group uuid, p_day int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if not exists (select 1 from public.twelve_groups where id = p_group and games_enabled) then
    raise exception 'The games are turned off for this group.';
  end if;
  select * into r from public.twelve_day_row(p_group, p_day);
  if r.format is null or now() < r.unlocks_at then
    raise exception 'This game hasn''t unlocked yet.';
  end if;
  if now() >= r.closes_at then
    raise exception 'This game has closed.';
  end if;

  insert into public.twelve_game_plays (group_id, season, day, user_id)
  values (p_group, r.season, p_day, (select auth.uid()))
  on conflict do nothing;

  return public.twelve_get_day(p_group, p_day);
end;
$$;

revoke all on function public.twelve_start_play(uuid, int) from public;
grant execute on function public.twelve_start_play(uuid, int) to authenticated;

-- The calendar for this season: each day's game, when it unlocks and
-- closes, and whether you've played it. No content or answers.
create or replace function public.twelve_schedule(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_gs public.twelve_game_seasons;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  select * into v_gs from public.twelve_game_seasons where group_id = p_group and season = v_season;
  if v_gs.group_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'start_date', v_gs.start_date,
    'unlock_time', v_gs.unlock_time,
    'repeat_formats', to_jsonb(v_gs.repeat_formats),
    'champion_revealed_at', v_gs.champion_revealed_at,
    'now', now(),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'format', d.format,
        'title', coalesce(p.title, 'Finale Quiz'),
        'unlocks_at', public.twelve_day_unlock(p_group, v_season, d.day),
        'closes_at', public.twelve_day_close(p_group, v_season, d.day),
        'winner_id', d.winner_id,
        'played', exists (
          select 1 from public.twelve_game_plays pl
          where pl.group_id = p_group and pl.season = v_season and pl.day = d.day
            and pl.user_id = (select auth.uid()) and pl.submitted_at is not null
        )
      ) order by d.day), '[]'::jsonb)
      from public.twelve_game_days d
      left join public.twelve_game_packs p on p.format = d.format and p.pack = d.pack
      where d.group_id = p_group and d.season = v_season
    )
  );
end;
$$;

revoke all on function public.twelve_schedule(uuid) from public;
grant execute on function public.twelve_schedule(uuid) to authenticated;

-- Internal: score one response. Every game is worth up to 100 points.
create or replace function public.twelve_score(
  p_format text, p_content jsonb, p_answers jsonb, p_response jsonb, p_seconds numeric
)
returns int
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total int;
  v_right int := 0;
  v_marked int[];
  v_lines int := 0;
  v_line int[];
  v_found int;
  v_speed numeric;
  i int;
begin
  if p_format in ('trivia', 'emoji', 'two_truths', 'lyrics', 'finale') then
    v_total := jsonb_array_length(p_answers -> 'correct');
    if v_total = 0 then
      return 0;
    end if;
    for i in 0..v_total - 1 loop
      if (p_response -> 'answers' ->> i) = (p_answers -> 'correct' ->> i) then
        v_right := v_right + 1;
      end if;
    end loop;
    return round(100.0 * v_right / v_total);

  elsif p_format = 'bingo' then
    -- 5×5 card, square 12 is the free middle. 3 points a square plus
    -- 8 points a line, up to 100.
    select coalesce(array_agg(distinct x::int), '{}') into v_marked
    from jsonb_array_elements_text(coalesce(p_response -> 'marked', '[]')) x
    where x ~ '^\d+$' and x::int between 0 and 24 and x::int <> 12;
    foreach v_line slice 1 in array array[
      [0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24],
      [0,5,10,15,20],[1,6,11,16,21],[2,7,12,17,22],[3,8,13,18,23],[4,9,14,19,24],
      [0,6,12,18,24],[4,8,12,16,20]
    ] loop
      if (v_marked || 12) @> v_line then
        v_lines := v_lines + 1;
      end if;
    end loop;
    return least(100, 3 * coalesce(array_length(v_marked, 1), 0) + 8 * v_lines);

  elsif p_format = 'scavenger' then
    -- 10 points an item found, plus up to 40 for speed: full bonus within
    -- 10 minutes, nothing after an hour, scaled by how much you found.
    v_total := jsonb_array_length(p_content -> 'items');
    select count(*) into v_found
    from jsonb_each_text(coalesce(p_response -> 'photos', '{}'))
    where key ~ '^\d+$' and key::int between 0 and v_total - 1 and value <> '';
    v_speed := greatest(0, least(1, (3600 - p_seconds) / 3000));
    return round(60.0 * v_found / v_total + 40 * v_speed * v_found / v_total);

  elsif p_format = 'photo' then
    -- 50 for entering; the host's pick gets 100 (set when they choose).
    return case when coalesce(p_response ->> 'photo', '') <> '' then 50 else 0 end;

  elsif p_format = 'wyr' then
    -- Would You Rather has no wrong answers: answer them all for full points.
    v_total := jsonb_array_length(p_content -> 'questions');
    select count(*) into v_found
    from jsonb_array_elements_text(coalesce(p_response -> 'choices', '[]')) x
    where x in ('a', 'b');
    return round(100.0 * least(v_found, v_total) / v_total);

  elsif p_format = 'speed_match' then
    -- 70 for accuracy, up to 30 for speed: full within 30 seconds, nothing
    -- after two minutes, scaled by accuracy.
    v_total := jsonb_array_length(p_answers -> 'correct');
    for i in 0..v_total - 1 loop
      if (p_response -> 'matches' ->> i) = (p_answers -> 'correct' ->> i) then
        v_right := v_right + 1;
      end if;
    end loop;
    v_speed := greatest(0, least(1, (120 - p_seconds) / 90));
    return round(70.0 * v_right / v_total + 30 * v_speed * v_right / v_total);
  end if;
  return 0;
end;
$$;

revoke all on function public.twelve_score(text, jsonb, jsonb, jsonb, numeric) from public, anon, authenticated;

-- Submit a day's game. Bingo can be updated until the day closes (mark more
-- squares as things happen); every other game is one go.
create or replace function public.twelve_submit_play(p_group uuid, p_day int, p_response jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r record;
  v_play public.twelve_game_plays;
  v_score int;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  select * into r from public.twelve_day_row(p_group, p_day);
  if r.format is null or now() < r.unlocks_at then
    raise exception 'This game hasn''t unlocked yet.';
  end if;
  if now() >= r.closes_at then
    raise exception 'Time''s up — this game has closed.';
  end if;
  if pg_column_size(p_response) > 20000 then
    raise exception 'That answer is too long.';
  end if;

  select * into v_play from public.twelve_game_plays
  where group_id = p_group and season = r.season and day = p_day and user_id = v_uid
  for update;
  if v_play.user_id is null then
    if r.format in ('scavenger', 'speed_match') then
      raise exception 'Start the game first.';
    end if;
    insert into public.twelve_game_plays (group_id, season, day, user_id)
    values (p_group, r.season, p_day, v_uid)
    returning * into v_play;
  elsif v_play.submitted_at is not null and r.format <> 'bingo' then
    raise exception 'You''ve already played today''s game.';
  end if;

  v_score := public.twelve_score(
    r.format, r.content, r.answers, p_response,
    extract(epoch from now() - v_play.started_at)
  );
  if r.format = 'photo' and r.winner_id = v_uid then
    v_score := 100;
  end if;

  update public.twelve_game_plays
  set submitted_at = now(), response = p_response, score = v_score
  where group_id = p_group and season = r.season and day = p_day and user_id = v_uid;

  return public.twelve_get_day(p_group, p_day);
end;
$$;

revoke all on function public.twelve_submit_play(uuid, int, jsonb) from public;
grant execute on function public.twelve_submit_play(uuid, int, jsonb) to authenticated;

-- Who has played a day's game so far. Only shown once you've played it
-- yourself, and it never includes scores.
create or replace function public.twelve_day_status(p_group uuid, p_day int)
returns table (user_id uuid, played boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if not exists (
    select 1 from public.twelve_game_plays p
    where p.group_id = p_group and p.season = v_season and p.day = p_day
      and p.user_id = (select auth.uid()) and p.submitted_at is not null
  ) and public.twelve_day_close(p_group, v_season, p_day) > now() then
    raise exception 'Play today''s game to see who else has.';
  end if;

  return query
  select m.user_id, exists (
    select 1 from public.twelve_game_plays p
    where p.group_id = p_group and p.season = v_season and p.day = p_day
      and p.user_id = m.user_id and p.submitted_at is not null
  )
  from public.twelve_members m
  where m.group_id = p_group
  order by m.joined_at;
end;
$$;

revoke all on function public.twelve_day_status(uuid, int) from public;
grant execute on function public.twelve_day_status(uuid, int) to authenticated;

-- Would You Rather: how the group split, once you've answered.
create or replace function public.twelve_wyr_split(p_group uuid, p_day int)
returns table (question int, a int, b int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if not exists (
    select 1 from public.twelve_game_plays p
    where p.group_id = p_group and p.season = v_season and p.day = p_day
      and p.user_id = (select auth.uid()) and p.submitted_at is not null
  ) and not (public.twelve_is_member(p_group) and public.twelve_day_close(p_group, v_season, p_day) <= now()) then
    raise exception 'Answer first, then see how everyone split.';
  end if;

  return query
  select (c.ord - 1)::int,
    count(*) filter (where c.value = 'a')::int,
    count(*) filter (where c.value = 'b')::int
  from public.twelve_game_plays p,
    jsonb_array_elements_text(p.response -> 'choices') with ordinality as c(value, ord)
  where p.group_id = p_group and p.season = v_season and p.day = p_day and p.submitted_at is not null
  group by c.ord
  order by c.ord;
end;
$$;

revoke all on function public.twelve_wyr_split(uuid, int) from public;
grant execute on function public.twelve_wyr_split(uuid, int) to authenticated;

-- Photos entered for a Photo Challenge or Scavenger Hunt. Visible to the
-- group once the day closes (the host uses this to pick a winner).
create or replace function public.twelve_day_photos(p_group uuid, p_day int)
returns table (user_id uuid, response jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if public.twelve_day_close(p_group, v_season, p_day) > now() then
    raise exception 'Entries are shown once the day closes.';
  end if;
  return query
  select p.user_id, p.response
  from public.twelve_game_plays p
  where p.group_id = p_group and p.season = v_season and p.day = p_day and p.submitted_at is not null
  order by p.submitted_at;
end;
$$;

revoke all on function public.twelve_day_photos(uuid, int) from public;
grant execute on function public.twelve_day_photos(uuid, int) to authenticated;

-- Host: pick the Photo Challenge winner after the day closes.
create or replace function public.twelve_pick_photo_winner(p_group uuid, p_day int, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host picks the winner.';
  end if;
  if not exists (
    select 1 from public.twelve_game_days
    where group_id = p_group and season = v_season and day = p_day and format = 'photo'
  ) then
    raise exception 'That day isn''t a Photo Challenge.';
  end if;
  if public.twelve_day_close(p_group, v_season, p_day) > now() then
    raise exception 'Pick a winner once the day closes.';
  end if;
  if not exists (
    select 1 from public.twelve_game_plays
    where group_id = p_group and season = v_season and day = p_day
      and user_id = p_user and submitted_at is not null
  ) then
    raise exception 'That person didn''t enter.';
  end if;

  update public.twelve_game_days set winner_id = p_user
  where group_id = p_group and season = v_season and day = p_day;
  update public.twelve_game_plays
  set score = case when user_id = p_user then 100 else 50 end
  where group_id = p_group and season = v_season and day = p_day and submitted_at is not null;

  perform public.twelve_notify_group(p_group, 'Photo Challenge winner 📸',
    coalesce((select display_name from public.twelve_profiles where id = p_user), 'Someone')
      || ' won Day ' || p_day || '''s Photo Challenge!',
    '#/g/' || p_group || '/board');
end;
$$;

revoke all on function public.twelve_pick_photo_winner(uuid, int, uuid) from public;
grant execute on function public.twelve_pick_photo_winner(uuid, int, uuid) to authenticated;

-- Leaderboards: every closed day's scores and the running total. Days that
-- are still open stay hidden, so everyone plays blind.
create or replace function public.twelve_leaderboard(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_result jsonb;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;

  with closed_days as (
    select d.day, d.format, d.winner_id,
      public.twelve_day_close(p_group, v_season, d.day) as closes_at
    from public.twelve_game_days d
    where d.group_id = p_group and d.season = v_season
      and public.twelve_day_close(p_group, v_season, d.day) <= now()
      -- Day 12's scores would give the champion away, so they wait for the
      -- host's reveal even after the day closes.
      and (d.day < 12 or exists (
        select 1 from public.twelve_game_seasons gs
        where gs.group_id = p_group and gs.season = v_season and gs.champion_revealed_at is not null
      ))
  ),
  scores as (
    select p.day, p.user_id, coalesce(p.score, 0) as score
    from public.twelve_game_plays p
    join closed_days c on c.day = p.day
    where p.group_id = p_group and p.season = v_season and p.submitted_at is not null
  ),
  totals as (
    select m.user_id,
      coalesce(sum(s.score), 0)::int as total,
      count(s.day)::int as days_played
    from public.twelve_members m
    left join scores s on s.user_id = m.user_id
    where m.group_id = p_group
    group by m.user_id
  )
  select jsonb_build_object(
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', c.day,
        'format', c.format,
        'closes_at', c.closes_at,
        'scores', coalesce((
          select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'score', s.score) order by s.score desc)
          from scores s where s.day = c.day
        ), '[]'::jsonb),
        -- Everyone tied for the top score shares the crown.
        'winners', coalesce((
          select jsonb_agg(s.user_id)
          from scores s
          where s.day = c.day and s.score > 0
            and s.score = (select max(s2.score) from scores s2 where s2.day = c.day)
        ), '[]'::jsonb)
      ) order by c.day)
      from closed_days c
    ), '[]'::jsonb),
    'overall', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', t.user_id, 'total', t.total, 'days_played', t.days_played
      ) order by t.total desc, t.days_played desc)
      from totals t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.twelve_leaderboard(uuid) from public;
grant execute on function public.twelve_leaderboard(uuid) to authenticated;

-- Host: crown the champion. Allowed once Day 12 has unlocked; it also closes
-- Day 12, so the final standings are locked in on the spot.
create or replace function public.twelve_reveal_champion(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
begin
  if not public.twelve_is_host(p_group) then
    raise exception 'Only the host can reveal the champion.';
  end if;
  if coalesce(public.twelve_day_unlock(p_group, v_season, 12) > now(), true) then
    raise exception 'The champion can be revealed once Day 12 has unlocked.';
  end if;
  update public.twelve_game_seasons
  set champion_revealed_at = now()
  where group_id = p_group and season = v_season and champion_revealed_at is null;
  if found then
    perform public.twelve_notify_group(p_group, 'The champion has been crowned 👑',
      'Open Twelve to see who won the 12 Days of Games.', '#/g/' || p_group || '/board', (select auth.uid()));
  end if;
end;
$$;

revoke all on function public.twelve_reveal_champion(uuid) from public;
grant execute on function public.twelve_reveal_champion(uuid) to authenticated;

-- The champion and superlative awards, once the host has revealed them.
create or replace function public.twelve_champion(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_board jsonb;
  v_awards jsonb;
begin
  if not public.twelve_is_member(p_group) then
    raise exception 'Group not found.';
  end if;
  if not exists (
    select 1 from public.twelve_game_seasons
    where group_id = p_group and season = v_season and champion_revealed_at is not null
  ) then
    return null;
  end if;

  v_board := public.twelve_leaderboard(p_group);

  with plays as (
    select p.user_id, p.day, p.submitted_at,
      public.twelve_day_unlock(p_group, v_season, p.day) as unlocks_at,
      public.twelve_day_unlock(p_group, v_season, p.day) + interval '24 hours' as closes_at
    from public.twelve_game_plays p
    where p.group_id = p_group and p.season = v_season and p.submitted_at is not null
      and p.submitted_at <= public.twelve_day_close(p_group, v_season, p.day)
  ),
  crowns as (
    select (w.value #>> '{}')::uuid as user_id, count(*)::int as n
    from jsonb_array_elements(v_board -> 'days') d,
      jsonb_array_elements(d -> 'winners') w
    group by 1
  ),
  stats as (
    select user_id,
      count(*)::int as days_played,
      count(*) filter (where submitted_at >= closes_at - interval '3 hours')::int as late,
      count(*) filter (where submitted_at < unlocks_at + interval '1 hour')::int as early
    from plays group by user_id
  ),
  award_rows as (
    select 'Daily Crown Collector' as title, 'Most days won' as blurb, 1 as sort,
      user_id, n as value from crowns
    union all
    select 'Most Consistent Player', 'Played the most days', 2, user_id, days_played from stats
    union all
    select 'Early Bird', 'Most games played within an hour of unlocking', 3, user_id, early from stats
    union all
    select 'Last-Minute Scrambler', 'Most games played in the final three hours', 4, user_id, late from stats
  ),
  winners as (
    select a.title, a.blurb, a.sort, a.value, a.user_id
    from award_rows a
    where a.value > 0
      and a.value = (select max(b.value) from award_rows b where b.title = a.title)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'title', title, 'blurb', blurb, 'value', value, 'user_ids', user_ids
  ) order by sort), '[]'::jsonb)
  into v_awards
  from (
    select title, blurb, sort, value, jsonb_agg(user_id) as user_ids
    from winners group by title, blurb, sort, value
  ) grouped;

  return jsonb_build_object(
    'champions', coalesce((
      select jsonb_agg(o -> 'user_id')
      from jsonb_array_elements(v_board -> 'overall') o
      where (o ->> 'total')::int > 0
        and (o ->> 'total')::int = (
          select max((o2 ->> 'total')::int) from jsonb_array_elements(v_board -> 'overall') o2
        )
    ), '[]'::jsonb),
    'overall', v_board -> 'overall',
    'awards', v_awards
  );
end;
$$;

revoke all on function public.twelve_champion(uuid) from public;
grant execute on function public.twelve_champion(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Scheduled reminders. Run every few minutes by the twelve-push Edge
--    Function (see twelve_push_schedule.sql). Safe to run as often as you
--    like: each reminder is only ever created once.
-- ---------------------------------------------------------------------------

create or replace function public.twelve_run_scheduled()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season int := public.twelve_current_season();
  v_before int;
  v_after int;
begin
  select count(*) into v_before from public.twelve_notifications;

  -- A day's game unlocks (only while it is still open).
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  select m.user_id, d.group_id,
    'Day ' || d.day || ' is open! 🎄',
    coalesce(p.title, 'Today''s game') || ' just unlocked in ' || g.name || '. You have 24 hours.',
    '#/g/' || d.group_id || '/day/' || d.day,
    'unlock:' || d.group_id || ':' || v_season || ':' || d.day || ':' || m.user_id
  from public.twelve_game_days d
  join public.twelve_groups g on g.id = d.group_id and g.games_enabled
  join public.twelve_members m on m.group_id = d.group_id
  left join public.twelve_game_packs p on p.format = d.format and p.pack = d.pack
  cross join lateral (
    select public.twelve_day_unlock(d.group_id, v_season, d.day) as u,
           public.twelve_day_close(d.group_id, v_season, d.day) as c
  ) t
  where d.season = v_season and now() >= t.u and now() < t.c
  on conflict (dedupe_key) do nothing;

  -- Three hours before a day closes, nudge anyone who hasn't played.
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  select m.user_id, d.group_id,
    'Last call for Day ' || d.day || ' ⏰',
    'Today''s game in ' || g.name || ' closes in a few hours.',
    '#/g/' || d.group_id || '/day/' || d.day,
    'closing:' || d.group_id || ':' || v_season || ':' || d.day || ':' || m.user_id
  from public.twelve_game_days d
  join public.twelve_groups g on g.id = d.group_id and g.games_enabled
  join public.twelve_members m on m.group_id = d.group_id
  cross join lateral (select public.twelve_day_close(d.group_id, v_season, d.day) as c) t
  where d.season = v_season
    and now() >= t.c - interval '3 hours' and now() < t.c - interval '30 minutes'
    and not exists (
      select 1 from public.twelve_game_plays p
      where p.group_id = d.group_id and p.season = v_season and p.day = d.day
        and p.user_id = m.user_id and p.submitted_at is not null
    )
  on conflict (dedupe_key) do nothing;

  -- Photo Challenge closed: the host picks a winner.
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  select g.host_id, d.group_id,
    'Pick the Photo Challenge winner 📸',
    'Day ' || d.day || ' has closed. Look through the entries and crown a winner.',
    '#/g/' || d.group_id || '/day/' || d.day,
    'photo-pick:' || d.group_id || ':' || v_season || ':' || d.day
  from public.twelve_game_days d
  join public.twelve_groups g on g.id = d.group_id and g.games_enabled
  where d.season = v_season and d.format = 'photo' and d.winner_id is null
    and now() >= public.twelve_day_close(d.group_id, v_season, d.day)
    and now() < public.twelve_day_close(d.group_id, v_season, d.day) + interval '3 days'
  on conflict (dedupe_key) do nothing;

  -- Questionnaire not done yet: a reminder every few days, in the daytime.
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  select gp.user_id, gp.group_id,
    'Tell your Secret Santa about you ✨',
    'Your questionnaire for ' || g.name || ' takes two minutes and helps whoever drew your name.',
    '#/g/' || gp.group_id || '/gifts/questions',
    'quiz:' || gp.group_id || ':' || v_season || ':' || gp.user_id || ':'
      || floor(extract(epoch from now()) / (4 * 86400))::bigint
  from public.twelve_gift_participants gp
  join public.twelve_groups g on g.id = gp.group_id and g.gifts_enabled
  left join public.twelve_gift_seasons gs on gs.group_id = gp.group_id and gs.season = gp.season
  where gp.season = v_season
    and gp.joined_at < now() - interval '1 day'
    and (gs.gathering_date is null or gs.gathering_date >= (now() at time zone g.timezone)::date)
    and extract(hour from now() at time zone g.timezone) between 10 and 19
    and not exists (
      select 1 from public.twelve_questionnaires q
      where q.group_id = gp.group_id and q.season = v_season
        and q.user_id = gp.user_id and q.completed_at is not null
    )
  on conflict (dedupe_key) do nothing;

  -- Countdown to the gathering: 3 weeks, 2 weeks, 1 week, 3 days, tomorrow.
  insert into public.twelve_notifications (user_id, group_id, title, body, url, dedupe_key)
  select gp.user_id, gp.group_id,
    case left_days
      when 1 then 'Gift exchange is tomorrow! 🎁'
      else left_days || ' days until the gift exchange'
    end,
    case
      when m.bought then 'You''re all set for ' || g.name || '. Nice work!'
      when m.giver_id is not null then 'Still shopping? Peek at your giftee''s answers for ideas.'
      else 'The ' || g.name || ' gift exchange is coming up.'
    end,
    '#/g/' || gp.group_id || '/gifts',
    'countdown:' || gp.group_id || ':' || v_season || ':' || gp.user_id || ':' || left_days
  from public.twelve_gift_participants gp
  join public.twelve_groups g on g.id = gp.group_id and g.gifts_enabled
  join public.twelve_gift_seasons gs on gs.group_id = gp.group_id and gs.season = gp.season
  left join public.twelve_matches m
    on m.group_id = gp.group_id and m.season = gp.season and m.giver_id = gp.user_id
  cross join lateral (
    select (gs.gathering_date - (now() at time zone g.timezone)::date) as left_days
  ) t
  where gp.season = v_season
    and gs.gathering_date is not null
    and left_days in (21, 14, 7, 3, 1)
    and extract(hour from now() at time zone g.timezone) between 9 and 19
  on conflict (dedupe_key) do nothing;

  select count(*) into v_after from public.twelve_notifications;
  return v_after - v_before;
end;
$$;

revoke all on function public.twelve_run_scheduled() from public, anon, authenticated;
grant execute on function public.twelve_run_scheduled() to service_role;

-- ---------------------------------------------------------------------------
-- 9. Photo storage
--    twelve-avatars (public): avatars/<user id>/<file>
--    twelve-photos (private): <group id>/<season>/<day>/<user id>/<file>
--    Game photos are visible to their owner right away, and to the rest of
--    the group once that day closes.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('twelve-avatars', 'twelve-avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('twelve-photos', 'twelve-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.twelve_can_read_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_group uuid;
begin
  if array_length(v_parts, 1) <> 5 or v_parts[1] !~ '^[0-9a-f-]{36}$'
     or v_parts[2] !~ '^\d{4}$' or v_parts[3] !~ '^\d{1,2}$' then
    return false;
  end if;
  if v_parts[4] = (select auth.uid())::text then
    return true;
  end if;
  v_group := v_parts[1]::uuid;
  return public.twelve_is_member(v_group)
    and v_parts[2]::int = public.twelve_current_season()
    and coalesce(public.twelve_day_close(v_group, v_parts[2]::int, v_parts[3]::int) <= now(), false);
end;
$$;

create or replace function public.twelve_can_write_photo(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
begin
  return array_length(v_parts, 1) = 5
    and v_parts[1] ~ '^[0-9a-f-]{36}$'
    and v_parts[4] = (select auth.uid())::text
    and public.twelve_is_member(v_parts[1]::uuid);
end;
$$;

revoke all on function public.twelve_can_read_photo(text) from public;
revoke all on function public.twelve_can_write_photo(text) from public;
grant execute on function public.twelve_can_read_photo(text) to authenticated;
grant execute on function public.twelve_can_write_photo(text) to authenticated;

drop policy if exists "twelve: upload your own avatar" on storage.objects;
create policy "twelve: upload your own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'twelve-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "twelve: see your own avatar files" on storage.objects;
create policy "twelve: see your own avatar files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'twelve-avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "twelve: delete your own avatar files" on storage.objects;
create policy "twelve: delete your own avatar files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'twelve-avatars'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "twelve: upload game photos" on storage.objects;
create policy "twelve: upload game photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'twelve-photos' and public.twelve_can_write_photo(name));

drop policy if exists "twelve: see game photos" on storage.objects;
create policy "twelve: see game photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'twelve-photos' and public.twelve_can_read_photo(name));

-- ---------------------------------------------------------------------------
-- 10. Live updates for the group chat, its reactions, and the notification bell.
-- ---------------------------------------------------------------------------

do $$
declare
  live_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach live_table in array array['twelve_chat_messages', 'twelve_chat_reactions', 'twelve_notifications'] loop
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
