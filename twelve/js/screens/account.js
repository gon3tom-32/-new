// The notification inbox and your profile page.
import { html, useState, useEffect } from "../vendor/preact-htm.mjs";
import { sb, q } from "../lib/db.js";
import { useApp, go } from "../lib/state.js";
import { Avatar, ErrorNote, Spinner, useAsync, useAction, formatTime, Icons } from "../lib/ui.js";
import { pushStatus, enablePush, disablePush, pushConfigured } from "../lib/push.js";

function PushCard() {
  const [status, setStatus] = useState(null);
  useEffect(() => { pushStatus().then(setStatus); }, []);
  const turnOn = useAction(async () => {
    await enablePush();
    setStatus(await pushStatus());
  });
  const turnOff = useAction(async () => {
    await disablePush();
    setStatus(await pushStatus());
  });
  if (!pushConfigured() || status === null) return null;
  return html`<div class="card stack">
    <div class="row">
      <div style="font-size:1.8rem">🔔</div>
      <div class="grow">
        <h3>Push notifications</h3>
        <p class="small muted">${status === "on" ? "On for this device." : status === "blocked" ? "Blocked in your browser settings." : status === "unavailable" ? "Not supported in this browser." : "Get a ping when games unlock and names are drawn."}</p>
      </div>
      ${status === "off" && html`<button class="btn green small" disabled=${turnOn.busy} onClick=${turnOn.run}>Turn on</button>`}
      ${status === "on" && html`<button class="btn ghost small" disabled=${turnOff.busy} onClick=${turnOff.run}>Turn off</button>`}
    </div>
    <${ErrorNote} error=${turnOn.error || turnOff.error} />
  </div>`;
}

export function Inbox() {
  const { user } = useApp();
  const list = useAsync(
    () => q(sb.from("twelve_notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(60)),
    [user.id]
  );

  // Opening the inbox marks everything read.
  useEffect(() => {
    if (!list.data?.some((n) => !n.read_at)) return;
    sb.from("twelve_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null)
      .then(() => window.dispatchEvent(new Event("twelve:notifications-read")));
  }, [list.data]);

  return html`<main class="page no-tabs stack-lg">
    <button class="back-link" onClick=${() => history.length > 1 ? history.back() : go("/")}>${Icons.back()} Back</button>
    <h1>Notifications</h1>
    <${PushCard} />
    <${ErrorNote} error=${list.error} retry=${list.reload} />
    ${list.loading && !list.data && html`<${Spinner} />`}
    ${list.data?.length === 0 && html`<div class="empty"><div class="big">🔔</div><p>Nothing yet. You'll hear about new games, the draw, and anything your host changes.</p></div>`}
    <div class="card flush">
      ${(list.data || []).map((n) => html`<a class="list-item" style="padding:14px 16px;text-decoration:none;border-top:1px solid var(--line)" href=${n.url || "#/"}>
        ${!n.read_at && html`<span style="width:8px;height:8px;border-radius:50%;background:var(--red);flex:none" aria-label="New"></span>`}
        <div class="grow">
          <div style="font-weight:700">${n.title}</div>
          ${n.body && html`<div class="small muted">${n.body}</div>`}
          <div class="small muted" style="margin-top:2px">${formatTime(n.created_at)}</div>
        </div>
      </a>`)}
    </div>
  </main>`;
}

export function Me() {
  const app = useApp();
  const signOut = useAction(async () => {
    await sb.auth.signOut();
    go("/welcome");
  });
  return html`<main class="page no-tabs stack-lg">
    <button class="back-link" onClick=${() => history.length > 1 ? history.back() : go("/")}>${Icons.back()} Back</button>
    <div class="card stack center" style="align-items:center">
      <${Avatar} profile=${app.profile} size=${96} />
      <h2>${app.profile?.display_name}</h2>
      <p class="small muted">${app.user?.email}</p>
      <a class="btn ghost small" href="#/me/edit">Edit name & photo</a>
    </div>
    <${PushCard} />
    <div class="card stack">
      <div class="section-label">Your groups</div>
      <div class="list">
        ${(app.groups || []).map((g) => html`<a class="list-item" style="text-decoration:none" href=${`#/g/${g.id}/home`}>
          <div class="grow" style="font-weight:700">${g.name}</div>
          ${g.host_id === app.user.id && html`<span class="pill gold">Host</span>`}
        </a>`)}
      </div>
      <a class="btn ghost block" href="#/code">Join another group</a>
    </div>
    <${ErrorNote} error=${signOut.error} />
    <button class="btn ghost block" disabled=${signOut.busy} onClick=${signOut.run}>Sign out</button>
    <p class="small muted center">Twelve · made for the holidays</p>
  </main>`;
}
