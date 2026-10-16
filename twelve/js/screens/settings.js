// Group settings. The host can change everything; everyone else sees the
// invite code and can leave.
import { html, useState } from "../vendor/preact-htm.mjs";
import { rpc, currentSeason } from "../lib/db.js";
import { useApp, useGroup, go } from "../lib/state.js";
import { Avatar, ErrorNote, useAction, Switch, BackLink, toast, shareInvite, Icons, formatDate } from "../lib/ui.js";
import { FORMATS, REPEATABLE, formatName, formatEmoji } from "../lib/formats.js";

function Section({ title, children }) {
  return html`<section class="card stack"><h3>${title}</h3>${children}</section>`;
}

function GroupDetails() {
  const g = useGroup();
  const app = useApp();
  const [name, setName] = useState(g.group.name);
  const [gifts, setGifts] = useState(g.group.gifts_enabled);
  const [games, setGames] = useState(g.group.games_enabled);
  const [tz, setTz] = useState(g.group.timezone);
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [g.group.timezone];
  if (!zones.includes(tz)) zones.unshift(tz);
  const save = useAction(async () => {
    await rpc("twelve_update_group", { p_group: g.groupId, p_name: name.trim(), p_gifts: gifts, p_games: games, p_timezone: tz });
    await Promise.all([g.reload(), app.refreshGroups()]);
    toast("Group saved");
  });
  return html`<${Section} title="Group">
    <div class="field">
      <label for="gname">Name</label>
      <input id="gname" class="input" maxlength="60" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
    </div>
    <div>
      <${Switch} label="🎁 Gift exchange" checked=${gifts} onChange=${setGifts} />
      <${Switch} label="🎄 12 Days of Games" checked=${games} onChange=${setGames} />
    </div>
    <div class="field">
      <label for="tz">Time zone</label>
      <select id="tz" class="select" value=${tz} onChange=${(e) => setTz(e.currentTarget.value)}>
        ${zones.map((z) => html`<option value=${z}>${z.replace(/_/g, " ")}</option>`)}
      </select>
      <span class="hint">Games unlock at the same moment for everyone, using this time zone.</span>
    </div>
    <${ErrorNote} error=${save.error} />
    <button class="btn" disabled=${save.busy || !name.trim() || (!gifts && !games)} onClick=${save.run}>Save group</button>
  <//>`;
}

function GiftSettings() {
  const g = useGroup();
  const s = g.gift.season;
  const [budget, setBudget] = useState(s?.budget || "");
  const [date, setDate] = useState(s?.gathering_date || "");
  const save = useAction(async () => {
    await rpc("twelve_set_gift_settings", { p_group: g.groupId, p_budget: budget, p_gathering_date: date || null });
    await g.reload();
    toast(s ? "Saved — the group has been notified" : "Saved");
  });
  return html`<${Section} title="🎁 Gift exchange">
    <div class="field">
      <label for="budget">Budget guideline</label>
      <input id="budget" class="input" maxlength="60" placeholder="e.g. $30, or $25–$40" value=${budget} onInput=${(e) => setBudget(e.currentTarget.value)} />
    </div>
    <div class="field">
      <label for="gdate">Gathering date</label>
      <input id="gdate" class="input" type="date" value=${date} onInput=${(e) => setDate(e.currentTarget.value)} />
      <span class="hint">The day you'll swap gifts in person. Everyone sees a countdown to it.</span>
    </div>
    ${s && html`<p class="small muted">You can change these any time. Everyone gets a notification when you do.</p>`}
    <${ErrorNote} error=${save.error} />
    <button class="btn" disabled=${save.busy} onClick=${save.run}>Save exchange details</button>
  <//>`;
}

function GameSettings() {
  const g = useGroup();
  const sched = g.schedule;
  const season = currentSeason();
  const started = sched && new Date(sched.days?.[0]?.unlocks_at) <= Date.now();
  const [start, setStart] = useState(sched?.start_date || "");
  const [time, setTime] = useState((sched?.unlock_time || "18:00").slice(0, 5));
  const [repeats, setRepeats] = useState(sched?.repeat_formats || ["trivia", "wyr"]);
  const save = useAction(async () => {
    await rpc("twelve_set_game_settings", { p_group: g.groupId, p_start_date: start, p_unlock_time: time, p_repeats: repeats });
    await g.reload();
    toast("Schedule saved");
  });
  const toggleRepeat = (key) => {
    if (repeats.includes(key)) setRepeats(repeats.filter((r) => r !== key));
    else setRepeats([...repeats, key].slice(-2));
  };

  return html`<${Section} title="🎄 12 Days of Games">
    ${started && html`<div class="note">The games have started, so the schedule is locked. You can still rearrange days that haven't unlocked.</div>`}
    <div class="row wrap" style="align-items:flex-start">
      <div class="field grow">
        <label for="start">Day 1</label>
        <input id="start" class="input" type="date" min=${`${season}-12-01`} max=${`${season}-12-20`} disabled=${started}
          value=${start} onInput=${(e) => setStart(e.currentTarget.value)} />
      </div>
      <div class="field grow">
        <label for="time">Unlocks at</label>
        <input id="time" class="input" type="time" disabled=${started} value=${time} onInput=${(e) => setTime(e.currentTarget.value)} />
      </div>
    </div>
    <p class="hint small muted">Day 1 can be December 1–20, so all twelve days land in December. Times are in ${g.group.timezone.replace(/_/g, " ")}. Each game stays open for 24 hours.</p>
    <div class="field">
      <label>Pick two games to play twice</label>
      <span class="hint">There are 10 games for 12 days. The repeats get fresh questions.</span>
      <div class="chips">
        ${REPEATABLE.map((key) => html`<button type="button" class=${"chip" + (repeats.includes(key) ? " on" : "")} disabled=${started}
          aria-pressed=${repeats.includes(key)} onClick=${() => toggleRepeat(key)}>${FORMATS[key].emoji} ${FORMATS[key].name}</button>`)}
      </div>
    </div>
    <${ErrorNote} error=${save.error} />
    ${!started && html`<button class="btn" disabled=${save.busy || !start || !time || repeats.length !== 2} onClick=${save.run}>
      ${sched ? "Save schedule" : "Schedule the games"}
    </button>`}
    ${sched && html`<${OrderEditor} />`}
  <//>`;
}

function OrderEditor() {
  const g = useGroup();
  const days = g.schedule.days.filter((d) => d.day <= 11);
  const [order, setOrder] = useState(days.map((d) => d.format));
  const locked = (i) => new Date(days[i].unlocks_at) <= Date.now();
  const changed = order.some((f, i) => f !== days[i].format);
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= order.length || locked(i) || locked(j)) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const save = useAction(async () => {
    await rpc("twelve_set_game_order", { p_group: g.groupId, p_order: order });
    await g.reload();
    toast("Order saved");
  });
  return html`<div class="stack" style="border-top:1px solid var(--line);padding-top:14px">
    <div class="section-label">Order of games</div>
    <div>
      ${order.map((f, i) => html`<div class="order-row">
        <div class="n">${i + 1}</div>
        <div class="grow">${formatEmoji(f)} ${formatName(f)}
          <div class="small muted">${locked(i) ? "Unlocked" : formatDate(days[i].unlocks_at, { weekday: "short", month: "short", day: "numeric" })}</div>
        </div>
        <button class="mini" aria-label="Move up" disabled=${locked(i) || i === 0 || locked(i - 1)} onClick=${() => move(i, -1)}>↑</button>
        <button class="mini" aria-label="Move down" disabled=${locked(i) || i === order.length - 1 || locked(i + 1)} onClick=${() => move(i, 1)}>↓</button>
      </div>`)}
      <div class="order-row"><div class="n">12</div><div class="grow">👑 Finale Quiz <div class="small muted">Always the last day</div></div></div>
    </div>
    <${ErrorNote} error=${save.error} />
    ${changed && html`<div class="row">
      <button class="btn grow" disabled=${save.busy} onClick=${save.run}>Save order</button>
      <button class="btn ghost" onClick=${() => setOrder(days.map((d) => d.format))}>Undo</button>
    </div>`}
  </div>`;
}

function Members() {
  const g = useGroup();
  const [confirm, setConfirm] = useState(null);
  const remove = useAction(async (userId) => {
    await rpc("twelve_remove_member", { p_group: g.groupId, p_user: userId });
    setConfirm(null);
    await g.reload();
    toast("Removed");
  });
  return html`<${Section} title="People">
    <div class="list">
      ${g.members.map((m) => html`<div class="list-item">
        <${Avatar} profile=${m.profile} size=${36} />
        <div class="grow">${m.profile.display_name}</div>
        ${m.user_id === g.group.host_id
          ? html`<span class="pill gold">Host</span>`
          : confirm === m.user_id
            ? html`<button class="btn small" disabled=${remove.busy} onClick=${() => remove.run(m.user_id)}>Confirm</button>
                   <button class="btn ghost small" onClick=${() => setConfirm(null)}>Cancel</button>`
            : html`<button class="btn ghost small" onClick=${() => setConfirm(m.user_id)}>Remove</button>`}
      </div>`)}
    </div>
    <${ErrorNote} error=${remove.error} />
  <//>`;
}

function Invite() {
  const g = useGroup();
  return html`<${Section} title="Invite people">
    <p class="muted">Anyone with this code can join, any time. It never changes.</p>
    <div class="row between">
      <div style="font-family:var(--display);font-weight:800;font-size:2rem;letter-spacing:0.2em">${g.group.invite_code}</div>
      <button class="btn green small" onClick=${() => shareInvite(g.group)}>${Icons.share()} Share</button>
    </div>
  <//>`;
}

function Leave() {
  const g = useGroup();
  const app = useApp();
  const [confirming, setConfirming] = useState(false);
  const leave = useAction(async () => {
    await rpc("twelve_remove_member", { p_group: g.groupId, p_user: app.user.id });
    await app.refreshGroups();
    go("/");
  });
  return html`<${Section} title="Leave group">
    <p class="muted">You can rejoin later with the invite code.</p>
    ${confirming
      ? html`<div class="row"><button class="btn grow" disabled=${leave.busy} onClick=${leave.run}>Yes, leave ${g.group.name}</button>
          <button class="btn ghost" onClick=${() => setConfirming(false)}>Cancel</button></div>`
      : html`<button class="btn ghost" onClick=${() => setConfirming(true)}>Leave group</button>`}
    <${ErrorNote} error=${leave.error} />
  <//>`;
}

export function Settings() {
  const g = useGroup();
  return html`<main class="page stack-lg">
    <${BackLink} href=${`#/g/${g.groupId}/home`} />
    <h1>${g.isHost ? "Host settings" : "Group info"}</h1>
    <${Invite} />
    ${g.isHost && html`<${GroupDetails} />`}
    ${g.isHost && g.group.gifts_enabled && html`<${GiftSettings} />`}
    ${g.isHost && g.group.games_enabled && html`<${GameSettings} />`}
    ${g.isHost && html`<${Members} />`}
    ${!g.isHost && html`<${Leave} />`}
  </main>`;
}
