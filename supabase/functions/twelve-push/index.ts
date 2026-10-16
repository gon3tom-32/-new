// twelve-push: sends Twelve's queued notifications as Web Push messages.
//
// Called every minute by the cron job in supabase/twelve_push_schedule.sql.
// It looks for notifications that haven't been pushed yet and sends each one
// to every device its person has turned push on for.
//
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   TWELVE_PUSH_SECRET  any long random string; the cron job sends it
//   VAPID_PUBLIC_KEY    from `npx web-push generate-vapid-keys`
//   VAPID_PRIVATE_KEY   from the same command (keep it secret)
//   VAPID_SUBJECT       mailto: address push services can contact, e.g. mailto:you@example.com
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import webpush from "npm:web-push@3.6.7";

const secret = Deno.env.get("TWELVE_PUSH_SECRET");
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Anything older than a day is stale; don't buzz phones about it.
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  await db.from("twelve_notifications").update({ pushed_at: new Date().toISOString() })
    .is("pushed_at", null).lt("created_at", cutoff);

  const { data: pending, error } = await db
    .from("twelve_notifications")
    .select("id, user_id, title, body, url")
    .is("pushed_at", null)
    .order("created_at")
    .limit(300);
  if (error) return new Response(error.message, { status: 500 });
  if (!pending?.length) return Response.json({ sent: 0 });

  const userIds = [...new Set(pending.map((n) => n.user_id))];
  const { data: subs } = await db
    .from("twelve_push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  // Mark them first so a slow run can't send the same thing twice.
  await db.from("twelve_notifications").update({ pushed_at: new Date().toISOString() })
    .in("id", pending.map((n) => n.id));

  let sent = 0;
  const gone: number[] = [];
  await Promise.all(pending.flatMap((n) =>
    (subs ?? []).filter((s) => s.user_id === n.user_id).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: `twelve-${n.id}` }),
          { TTL: 60 * 60 * 6 },
        );
        sent++;
      } catch (e) {
        // 404/410: the device unsubscribed or the app was uninstalled.
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(s.id);
      }
    })
  ));
  if (gone.length) await db.from("twelve_push_subscriptions").delete().in("id", gone);

  return Response.json({ sent, notifications: pending.length, removed: gone.length });
});
