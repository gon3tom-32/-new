// Group hub: today's game up front, then the advent calendar, gift exchange status,
// and who's in the group.
import { html } from "../vendor/preact-htm.mjs";
import { useApp, useGroup, currentDay } from "../lib/state.js";
import { Avatar, Countdown, useNow, timeLeft, formatDate, daysUntil, shareInvite, Icons } from "../lib/ui.js";
import { formatEmoji } from "../lib/formats.js";
import { AdventCalendar } from "../lib/advent.js";

function TodayHero() {
  const g = useGroup();
  const now = useNow(30000);
  const base = `#/g/${g.groupId}`;
  const schedule = g.schedule;

  if (!schedule) {
    return html`<div class="hero pine sprinkles">
      <div class="kicker">12 Days of Games</div>
      <h2>Coming this December</h2>
      <p>${g.isHost ? "Pick when the games start and what time each day unlocks." : `${g.profiles[g.group.host_id]?.display_name || "Your host"} hasn't scheduled the games yet.`}</p>
      ${g.isHost && html`<a class="btn white" href=${`${base}/settings`}>Schedule the games</a>`}
    </div>`;
  }

  const day = currentDay(schedule, now);
  if (day.state === "locked" && day.day === 1) {
    return html`<div class="hero pine sprinkles">
      <div class="kicker">12 Days of Games</div>
      <h2>Day 1 unlocks ${formatDate(day.unlocks_at, { weekday: "long", month: "short", day: "numeric" })}</h2>
      <div style="margin-top:12px"><${Countdown} to=${day.unlocks_at} /></div>
    </div>`;
  }
  if (day.state === "open") {
    return html`<div class="hero sprinkles">
      <div class="day-num" aria-hidden="true">${day.day}</div>
      <div class="kicker">Day ${day.day} of 12 · ${timeLeft(day.closes_at, now)} left</div>
      <h2>${formatEmoji(day.format)} ${day.title}</h2>
      <p>${day.played ? "You've played today's game. Results land tomorrow." : "Everyone gets the same game. Play anytime before it closes."}</p>
      <a class="btn white" href=${`${base}/day/${day.day}`}>${day.played ? (day.format === "bingo" ? "Update my card" : "See who's played") : "Play now"}</a>
    </div>`;
  }
  if (day.state === "locked") {
    return html`<div class="hero green sprinkles">
      <div class="day-num" aria-hidden="true">${day.day}</div>
      <div class="kicker">Next up · Day ${day.day}</div>
      <h2>A new game unlocks soon</h2>
      <div style="margin-top:12px"><${Countdown} to=${day.unlocks_at} /></div>
    </div>`;
  }
  return html`<div class="hero gold sprinkles">
    <div class="kicker">12 Days of Games</div>
    <h2>${schedule.champion_revealed_at ? "We have a champion! 👑" : "All twelve days are done"}</h2>
    <p>${schedule.champion_revealed_at ? "See who took the crown and the awards." : g.isHost ? "Reveal the champion when everyone is together." : "The host will reveal the champion when you're all together."}</p>
    <a class="btn" href=${`${base}/board`}>${schedule.champion_revealed_at ? "See the champion" : "Leaderboard"}</a>
  </div>`;
}

function Calendar() {
  const g = useGroup();
  const now = useNow(60000);
  if (!g.schedule?.days?.length) return null;
  return html`<section class="stack">
    <div class="section-label">Your 12 days</div>
    <${AdventCalendar} groupId=${g.groupId} days=${g.schedule.days} now=${now} />
  </section>`;
}

function GiftStatus() {
  const g = useGroup();
  const { user } = useApp();
  const gift = g.gift;
  const inExchange = gift.participants.includes(user.id);
  const date = gift.season?.gathering_date;
  const days = date ? daysUntil(date) : null;

  let line;
  if (!gift.season?.drawn_at) {
    line = inExchange
      ? gift.questionnaire?.completed_at ? "You're in. Names haven't been drawn yet." : "You're in! Fill out your questionnaire while you wait."
      : "Names haven't been drawn yet. Join the exchange.";
  } else if (gift.match && !gift.match.revealed_at) {
    line = "Names are drawn! Scratch to see who you got.";
  } else if (gift.match) {
    line = `You're giving to ${g.profiles[gift.match.recipient_id]?.display_name || "someone"}${gift.match.bought ? " — gift bought ✓" : "."}`;
  } else {
    line = "Names have been drawn. You're not in this year's exchange.";
  }

  return html`<a class="card card-link stack" href=${`#/g/${g.groupId}/gifts`}>
    <div class="row between">
      <div class="section-label">🎁 Gift exchange</div>
      ${gift.season?.budget && html`<span class="pill gold">Budget ${gift.season.budget}</span>`}
    </div>
    <p style="font-weight:700">${line}</p>
    ${date && days >= 0 && html`<div class="row between">
      <span class="muted small">${formatDate(date)}</span>
      <span class="pill red">${days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `${days} days to go`}</span>
    </div>`}
  </a>`;
}

function Roster() {
  const g = useGroup();
  return html`<section class="card stack">
    <div class="row between">
      <div class="section-label">${g.members.length} ${g.members.length === 1 ? "person" : "people"}</div>
      <button class="btn ghost small" onClick=${() => shareInvite(g.group)}>${Icons.share()} Invite</button>
    </div>
    <div class="list">
      ${g.members.map((m) => html`<div class="list-item">
        <${Avatar} profile=${m.profile} size=${36} />
        <div class="grow">${m.profile.display_name}</div>
        ${m.user_id === g.group.host_id && html`<span class="pill gold">Host</span>`}
      </div>`)}
    </div>
    <div class="row between" style="border-top:1px solid var(--line);padding-top:12px">
      <div>
        <div class="small muted">Invite code</div>
        <div style="font-family:var(--display);font-weight:800;font-size:1.4rem;letter-spacing:0.15em">${g.group.invite_code}</div>
      </div>
      <a class="btn ghost small" href=${`#/g/${g.groupId}/settings`}>${g.isHost ? "Host settings" : "Group info"}</a>
    </div>
  </section>`;
}

export function Home() {
  const g = useGroup();
  return html`<main class="page stack-lg">
    ${g.group.games_enabled && html`<${TodayHero} />`}
    ${g.group.games_enabled && html`<${Calendar} />`}
    ${g.group.gifts_enabled && html`<${GiftStatus} />`}
    <${Roster} />
  </main>`;
}
