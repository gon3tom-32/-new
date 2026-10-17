// Daily and overall leaderboards, plus the host-triggered champion reveal.
import { html, useState, useEffect } from "../vendor/preact-htm.mjs";
import { play } from "../lib/sound.js";
import { rpc } from "../lib/db.js";
import { useApp, useGroup } from "../lib/state.js";
import { Avatar, ErrorNote, Spinner, useAsync, useAction, useNow } from "../lib/ui.js";
import { formatName, formatEmoji } from "../lib/formats.js";

// Ties share a rank: 100, 100, 80 → 1, 1, 3.
function ranked(rows, key) {
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || r[key] !== rows[i - 1][key]) rank = i + 1;
    return { ...r, rank };
  });
}

const AWARD_ICONS = {
  "Daily Crown Collector": "👑",
  "Most Consistent Player": "📅",
  "Early Bird": "🐦",
  "Last-Minute Scrambler": "⏰",
};

function ChampionReveal({ data }) {
  const g = useGroup();
  // The first time each device sees the champion: a drumroll, then the reveal.
  const seenKey = `twelve.champion.${g.groupId}.${g.schedule?.champion_revealed_at}`;
  const [suspense, setSuspense] = useState(() => { try { return !localStorage.getItem(seenKey); } catch { return false; } });
  useEffect(() => {
    if (!suspense) return;
    try { localStorage.setItem(seenKey, "1"); } catch { /* private mode */ }
    play("champion");
    const timer = setTimeout(() => setSuspense(false), 1700);
    return () => clearTimeout(timer);
  }, []);
  if (suspense) {
    return html`<section class="champion sprinkles stack-lg" role="status">
      <div class="crown" aria-hidden="true">🥁</div>
      <h2>And the champion is…</h2>
    </section>`;
  }
  const names = (ids) => ids.map((id) => g.profiles[id]?.display_name || "Someone");
  const champs = data.champions || [];
  return html`<section class="champion sprinkles stack-lg">
    <div class="crown" aria-hidden="true">👑</div>
    <div>
      <div class="section-label" style="color:var(--gold-soft)">${champs.length > 1 ? "Your co-champions" : "Your champion"}</div>
      <div class="row" style="justify-content:center;gap:16px;margin:14px 0 8px;flex-wrap:wrap">
        ${champs.map((id) => html`<div class="stack" style="align-items:center;gap:6px">
          <${Avatar} profile=${g.profiles[id]} size=${86} />
          <h2>${g.profiles[id]?.display_name || "Someone"}</h2>
        </div>`)}
      </div>
      ${champs.length === 0 && html`<p>Nobody scored any points this year. A tie for everyone!</p>`}
      ${champs.length > 0 && html`<p style="opacity:0.85">${(data.overall?.[0]?.total ?? 0).toLocaleString()} points across twelve days</p>`}
    </div>
    ${data.awards?.length > 0 && html`<div class="stack">
      <div class="section-label" style="color:var(--gold-soft)">Awards</div>
      ${data.awards.map((a) => html`<div class="award">
        <div class="icon" aria-hidden="true">${AWARD_ICONS[a.title] || "⭐"}</div>
        <div class="grow">
          <div style="font-weight:800">${a.title}</div>
          <div class="small" style="opacity:0.85">${names(a.user_ids).join(" & ")} · ${a.blurb.toLowerCase()} (${a.value})</div>
        </div>
      </div>`)}
    </div>`}
  </section>`;
}

function RevealButton({ onDone }) {
  const g = useGroup();
  const [confirming, setConfirming] = useState(false);
  const reveal = useAction(async () => {
    await rpc("twelve_reveal_champion", { p_group: g.groupId });
    await g.reload();
    onDone();
  });
  return html`<section class="hero gold sprinkles">
    <div class="kicker">Host only</div>
    <h2>Crown the champion</h2>
    <p>Wait until everyone is together, then reveal it on the big moment. ${!confirming && "This also closes Day 12."}</p>
    ${confirming
      ? html`<div class="stack" style="margin-top:14px">
          <p><b>Is everyone together and ready?</b> Day 12 closes now and the results go out to the whole group.</p>
          <div class="row">
            <button class="btn grow" disabled=${reveal.busy} onClick=${reveal.run}>${reveal.busy ? "Revealing…" : "Reveal! 👑"}</button>
            <button class="btn white" onClick=${() => setConfirming(false)}>Wait</button>
          </div>
        </div>`
      : html`<button class="btn" onClick=${() => setConfirming(true)}>Reveal the champion</button>`}
    <${ErrorNote} error=${reveal.error} />
  </section>`;
}

function Row({ row, profile, score, sub, crown }) {
  return html`<div class=${"rank-row" + (row.rank === 1 ? " top" : "")}>
    <div class="rank">${row.rank === 1 && crown ? "👑" : row.rank}</div>
    <${Avatar} profile=${profile} size=${38} />
    <div class="grow">
      <div style="font-weight:700">${profile?.display_name || "Someone"}</div>
      ${sub && html`<div class="small muted">${sub}</div>`}
    </div>
    <div class="rank-score">${score}</div>
  </div>`;
}

function Overall({ board }) {
  const g = useGroup();
  const rows = ranked(board.overall, "total");
  const anyClosed = board.days.length > 0;
  const top = rows.filter((r) => r.total > 0).slice(0, 3);
  return html`<div class="stack-lg">
    ${top.length >= 2 && html`<div class="podium" aria-hidden="true">
      ${[top[1], top[0], top[2]].map((r, i) => r && html`<div class=${"podium-spot p" + [2, 1, 3][i]}>
        <${Avatar} profile=${g.profiles[r.user_id]} size=${[52, 64, 48][i]} />
        <div class="small" style="font-weight:700">${g.profiles[r.user_id]?.display_name}</div>
        <div class="podium-block">${r.rank}</div>
      </div>`)}
    </div>`}
    <div class="card">
      ${!anyClosed && html`<p class="muted">Scores show up here once Day 1 closes. Everyone plays blind until then!</p>`}
      ${anyClosed && rows.map((r) => html`<${Row} row=${r} profile=${g.profiles[r.user_id]} score=${r.total}
        sub=${`${r.days_played} ${r.days_played === 1 ? "day" : "days"} played`} />`)}
    </div>
    <p class="small muted center">Every game is worth up to 100 points. Today's scores appear after the day closes.</p>
  </div>`;
}

function Daily({ board }) {
  const g = useGroup();
  const days = board.days;
  const [selected, setSelected] = useState(days.length ? days[days.length - 1].day : null);
  if (!days.length) return html`<div class="empty"><div class="big">🔒</div><p>Each day's results are revealed the next day, once its 24 hours are up.</p></div>`;
  const day = days.find((d) => d.day === selected) || days[days.length - 1];
  const rows = ranked(day.scores, "score");
  const winners = day.winners.map((id) => g.profiles[id]?.display_name || "Someone");
  return html`<div class="stack-lg">
    <div class="chips" role="tablist">
      ${days.map((d) => html`<button class=${"chip" + (d.day === day.day ? " on" : "")} role="tab" aria-selected=${d.day === day.day}
        onClick=${() => setSelected(d.day)}>Day ${d.day}</button>`)}
    </div>
    <div class="hero sprinkles">
      <div class="kicker">Day ${day.day} · ${formatEmoji(day.format)} ${formatName(day.format)}</div>
      <h2>${winners.length ? `👑 ${winners.join(" & ")}` : "No winner"}</h2>
      <p>${winners.length > 1 ? "Co-champions of the day!" : winners.length ? "Champion of the day!" : day.format === "photo" ? "Waiting for the host to pick a winner." : "Nobody played this one."}</p>
      <a class="btn white small" href=${`#/g/${g.groupId}/day/${day.day}`}>See answers</a>
    </div>
    <div class="card">
      ${rows.length === 0 && html`<p class="muted">Nobody played Day ${day.day}.</p>`}
      ${rows.map((r) => html`<${Row} row=${r} profile=${g.profiles[r.user_id]} score=${r.score} crown />`)}
    </div>
  </div>`;
}

export function Leaderboard() {
  const g = useGroup();
  const now = useNow(60000);
  const [tab, setTab] = useState("overall");
  const board = useAsync(() => rpc("twelve_leaderboard", { p_group: g.groupId }), [g.groupId]);
  const revealed = Boolean(g.schedule?.champion_revealed_at);
  const champion = useAsync(() => (revealed ? rpc("twelve_champion", { p_group: g.groupId }) : null), [g.groupId, revealed]);

  if (!g.group.games_enabled) {
    return html`<main class="page"><div class="empty"><div class="big">🏆</div><p>The 12 Days of Games are turned off for ${g.group.name}.</p></div></main>`;
  }
  if (!g.schedule) {
    return html`<main class="page"><div class="empty"><div class="big">🏆</div><p>The leaderboard fills up once the 12 Days of Games begin.</p></div></main>`;
  }

  const day12 = g.schedule.days.find((d) => d.day === 12);
  const canReveal = g.isHost && !revealed && day12 && new Date(day12.unlocks_at) <= now;

  return html`<main class="page stack-lg">
    <h1>Leaderboard</h1>
    ${revealed && champion.data && html`<${ChampionReveal} data=${champion.data} />`}
    ${canReveal && html`<${RevealButton} onDone=${() => board.reload()} />`}
    <div class="segmented" role="tablist">
      <button class=${tab === "overall" ? "active" : ""} role="tab" aria-selected=${tab === "overall"} onClick=${() => setTab("overall")}>Overall</button>
      <button class=${tab === "daily" ? "active" : ""} role="tab" aria-selected=${tab === "daily"} onClick=${() => setTab("daily")}>Daily</button>
    </div>
    <${ErrorNote} error=${board.error} retry=${board.reload} />
    ${board.loading && !board.data && html`<${Spinner} />`}
    ${board.data && (tab === "overall" ? html`<${Overall} board=${board.data} />` : html`<${Daily} board=${board.data} />`)}
  </main>`;
}
