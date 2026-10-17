// One day of the 12 Days of Games: locked, open (play it), played (see who
// else has), or closed (answers, photos, and that day's results).
import { html, useEffect } from "../vendor/preact-htm.mjs";
import { play } from "../lib/sound.js";
import { rpc } from "../lib/db.js";
import { useApp, useGroup } from "../lib/state.js";
import { Avatar, ErrorNote, Spinner, useAsync, Countdown, BackLink, timeLeft, useNow, formatTime } from "../lib/ui.js";
import { formatEmoji } from "../lib/formats.js";
import { Quiz, QuizReview } from "./quiz.js";
import { Bingo } from "./bingo.js";
import { Scavenger } from "./scavenger.js";
import { PhotoChallenge, PhotoGallery } from "./photo.js";
import { WouldYouRather, WyrSplit } from "./wyr.js";
import { SpeedMatch, SpeedMatchReview } from "./speedmatch.js";

const QUIZ = ["trivia", "emoji", "two_truths", "lyrics", "finale"];

function WhoPlayed({ day }) {
  const g = useGroup();
  const status = useAsync(() => rpc("twelve_day_status", { p_group: g.groupId, p_day: day }), [g.groupId, day]);
  if (!status.data) return null;
  const played = status.data.filter((s) => s.played);
  const waiting = status.data.filter((s) => !s.played);
  return html`<section class="card stack">
    <div class="section-label">${played.length} of ${status.data.length} have played</div>
    <div class="list">
      ${[...played, ...waiting].map((s) => html`<div class="list-item">
        <${Avatar} profile=${g.profiles[s.user_id]} size=${32} />
        <div class="grow">${g.profiles[s.user_id]?.display_name || "Someone"}</div>
        ${s.played ? html`<span class="pill green">Played ✓</span>` : html`<span class="pill">Not yet</span>`}
      </div>`)}
    </div>
    <p class="small muted">Scores stay secret until the day closes.</p>
  </section>`;
}

// The first time you see a closed day's results on this device: a ding if
// you did well, a friendly bonk if not. Would You Rather has no score to judge.
function ResultChime({ data, groupId, day }) {
  useEffect(() => {
    const score = data.play?.score;
    if (score == null || data.format === "wyr") return;
    const key = `twelve.result.${groupId}.${day}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch { return; }
    if (data.format === "photo") { if (score === 100) play("right"); return; }
    play(score >= 50 ? "right" : "wrong");
  }, []);
  return null;
}

function ScoreCard({ data }) {
  const play = data.play;
  if (!play?.submitted_at) return null;
  const f = data.format;
  let headline = `${play.score} points`;
  let note = "Final standings for the day land once it closes.";
  if (f === "photo") {
    headline = play.score === 100 ? "You won! 👑" : "You're entered 📸";
    note = data.state === "closed" ? (data.winner_id ? "The host has picked a winner." : "Waiting for the host to pick a winner.") : "The host picks a winner after the day closes.";
  } else if (f === "wyr") {
    headline = "Thanks for answering!";
    note = "There are no wrong answers in Would You Rather — full points for playing.";
  } else if (f === "bingo" && data.state === "open") {
    note = "Keep marking squares as things happen. Your card saves until the day closes.";
  }
  return html`<section class="hero green sprinkles center">
    <div class="kicker">Your result</div>
    ${f === "photo" || f === "wyr"
      ? html`<h2>${headline}</h2>`
      : html`<div class="score-big">${play.score}</div><div style="font-weight:700">out of 100</div>`}
    <p style="margin-top:8px">${note}</p>
  </section>`;
}

export function DayScreen({ day }) {
  const g = useGroup();
  const { user } = useApp();
  const now = useNow(30000);
  const result = useAsync(() => rpc("twelve_get_day", { p_group: g.groupId, p_day: day }), [g.groupId, day]);
  const data = result.data;
  const back = html`<${BackLink} href=${`#/g/${g.groupId}/home`} />`;

  if (result.error) return html`<main class="page stack-lg">${back}<${ErrorNote} error=${result.error} retry=${result.reload} /></main>`;
  if (!data) {
    if (result.loading) return html`<${Spinner} />`;
    return html`<main class="page stack-lg">${back}<div class="empty"><div class="big">🗓️</div><p>There's no Day ${day} on the calendar yet.</p></div></main>`;
  }

  // Server calls return the updated day, so the screen re-renders from it.
  const submit = async (response) => {
    const next = await rpc("twelve_submit_play", { p_group: g.groupId, p_day: day, p_response: response });
    await result.reload(true);
    g.reload();
    return next;
  };
  const start = async () => {
    await rpc("twelve_start_play", { p_group: g.groupId, p_day: day });
    await result.reload(true);
  };

  const f = data.format;
  const played = Boolean(data.play?.submitted_at);
  const props = { data, submit, start, groupId: g.groupId, userId: user.id, reload: () => result.reload(true) };

  let body;
  if (data.state === "locked") {
    body = html`<section class="hero pine sprinkles">
      <div class="kicker">Unlocks ${formatTime(data.unlocks_at)}</div>
      <h2>🔒 Not yet!</h2>
      <p>No peeking. Day ${day} opens in:</p>
      <div style="margin-top:12px"><${Countdown} to=${data.unlocks_at} /></div>
    </section>`;
  } else if (data.state === "open") {
    let game;
    if (QUIZ.includes(f)) game = played ? null : html`<${Quiz} ...${props} />`;
    else if (f === "bingo") game = html`<${Bingo} ...${props} />`;
    else if (f === "scavenger") game = played ? null : html`<${Scavenger} ...${props} />`;
    else if (f === "photo") game = played ? null : html`<${PhotoChallenge} ...${props} />`;
    else if (f === "wyr") game = played ? html`<${WyrSplit} ...${props} />` : html`<${WouldYouRather} ...${props} />`;
    else if (f === "speed_match") game = played ? null : html`<${SpeedMatch} ...${props} />`;
    body = html`
      ${played && html`<${ScoreCard} data=${data} />`}
      ${game}
      ${played && html`<${WhoPlayed} day=${day} />`}`;
  } else {
    body = html`
      ${played && html`<${ResultChime} data=${data} groupId=${g.groupId} day=${day} />`}
      ${played ? html`<${ScoreCard} data=${data} />` : html`<div class="note">This day has closed${data.play ? "" : " — you didn't play it"}. Here's how it went.</div>`}
      ${day === 12 && !g.schedule?.champion_revealed_at && html`<div class="card"><p>👑 Final standings stay under wraps until the host reveals the champion.</p></div>`}
      ${QUIZ.includes(f) && html`<${QuizReview} ...${props} />`}
      ${f === "bingo" && html`<${Bingo} ...${props} readOnly />`}
      ${(f === "photo" || f === "scavenger") && html`<${PhotoGallery} ...${props} />`}
      ${f === "wyr" && html`<${WyrSplit} ...${props} />`}
      ${f === "speed_match" && html`<${SpeedMatchReview} ...${props} />`}
      ${day < 12 && html`<a class="btn ghost block" href=${`#/g/${g.groupId}/board`}>See the leaderboard</a>`}`;
  }

  return html`<main class="page stack-lg">
    ${back}
    <div class="stack" style="gap:6px">
      <div class="row wrap" style="gap:8px">
        <span class="pill red">Day ${day} of 12</span>
        ${data.state === "open" && html`<span class="pill gold">⏳ ${timeLeft(data.closes_at, now)} left</span>`}
        ${data.state === "closed" && html`<span class="pill">Closed</span>`}
      </div>
      <h1>${data.state === "locked" ? `Day ${day}` : `${formatEmoji(f)} ${data.title}`}</h1>
      ${data.content?.intro && data.state !== "locked" && html`<p class="muted">${data.content.intro}</p>`}
    </div>
    ${body}
  </main>`;
}
