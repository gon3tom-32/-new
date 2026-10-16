-- Scheduled jobs for Twelve. Run this once in the SQL Editor after
-- twelve.sql. (Database → Extensions must allow pg_cron and pg_net; this
-- script turns them on.)
--
-- Part 1 is all you need for reminders to show up in the app's notification
-- bell. Part 2 also sends them to phones as push notifications; it needs the
-- twelve-push Edge Function deployed first (see the README).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Part 1: create reminders (game unlocks, last calls, questionnaire nudges,
-- gift countdowns) every five minutes.
-- ---------------------------------------------------------------------------

select cron.schedule('twelve-reminders', '*/5 * * * *', $$ select public.twelve_run_scheduled(); $$);

-- ---------------------------------------------------------------------------
-- Part 2: push. Replace PASTE-YOUR-TWELVE_PUSH_SECRET-HERE with the same
-- value you set as the TWELVE_PUSH_SECRET Edge Function secret, then run
-- this part. The secret is kept in Supabase Vault, not in this file.
-- ---------------------------------------------------------------------------

select vault.create_secret('PASTE-YOUR-TWELVE_PUSH_SECRET-HERE', 'twelve_push_secret');

select cron.schedule('twelve-push', '* * * * *', $$
  select net.http_post(
    url := 'https://gvbhdzyrojokhmwqxpao.supabase.co/functions/v1/twelve-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'twelve_push_secret')
    ),
    body := '{}'::jsonb
  );
$$);

-- To stop either job: select cron.unschedule('twelve-push');
