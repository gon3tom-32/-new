// The Home screen's advent calendar: twelve doors, one per game day.
// Locked doors shake and say when they open. Today's door glows until you
// tap it, then swings open and takes you to the game. Past doors stay open.
import { html, useState } from "../vendor/preact-htm.mjs";
import { toast } from "./ui.js";
import { formatEmoji } from "./formats.js";
import { play } from "./sound.js";

// Whether you've already opened today's door is remembered on this device only.
const seenKey = (groupId, day) => `twelve.door.${groupId}.${day}`;
function wasSeen(groupId, day) {
  try { return localStorage.getItem(seenKey(groupId, day)) === "1"; } catch { return false; }
}
function markSeen(groupId, day) {
  try { localStorage.setItem(seenKey(groupId, day), "1"); } catch { /* private mode */ }
}

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const opensAt = (iso) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Door({ groupId, d, now, onOpen }) {
  const state = now < new Date(d.unlocks_at) ? "locked" : now < new Date(d.closes_at) ? "open" : "closed";
  const [seen, setSeen] = useState(() => wasSeen(groupId, d.day));
  const [shaking, setShaking] = useState(false);
  const isOpen = state === "closed" || (state === "open" && seen);
  const ready = state === "open" && !seen;
  const color = d.day === 12 ? "gold" : d.day % 2 ? "red" : "green";

  const tap = () => {
    if (state === "locked") {
      play("knock");
      setShaking(true);
      setTimeout(() => setShaking(false), 450);
      toast(`Day ${d.day} opens ${opensAt(d.unlocks_at)}`);
      return;
    }
    if (ready) {
      play("door");
      markSeen(groupId, d.day);
      setSeen(true);
      setTimeout(() => onOpen(d.day), reducedMotion() ? 0 : 700);
      return;
    }
    onOpen(d.day);
  };

  const status = state === "open"
    ? (d.played ? html`<span class="door-status done">✓ Played</span>` : html`<span class="door-status play">Play!</span>`)
    : d.played ? html`<span class="door-status done">✓ Played</span>` : html`<span class="door-status missed">Missed</span>`;

  const label = state === "locked"
    ? `Day ${d.day}, opens ${opensAt(d.unlocks_at)}`
    : ready ? `Day ${d.day} is ready. Open the door!` : `Day ${d.day}: ${d.title}`;

  return html`<button type="button" aria-label=${label}
    class=${["door", color, isOpen && "is-open", ready && "ready", shaking && "shake", state === "closed" && !d.played && "faded"].filter(Boolean).join(" ")}
    onClick=${tap}>
    <span class="door-inside" aria-hidden="true">
      <span class="door-emoji">${formatEmoji(d.format)}</span>
      <span class="door-day">Day ${d.day}</span>
      ${status}
    </span>
    <span class="door-front" aria-hidden="true">
      <span class="door-num">${d.day}</span>
      <span class="door-date">${ready ? "Open me!" : d.day === 12 ? "⭐ Finale" : shortDate(d.unlocks_at)}</span>
      <span class="door-knob"></span>
    </span>
  </button>`;
}

export function AdventCalendar({ groupId, days, now = Date.now(), onOpen }) {
  const open = onOpen || ((day) => { location.hash = `#/g/${groupId}/day/${day}`; });
  return html`<div class="advent-wrap"><div class="advent">
    ${days.map((d) => html`<${Door} key=${d.day} groupId=${groupId} d=${d} now=${now} onOpen=${open} />`)}
  </div></div>`;
}
