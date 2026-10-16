// Speed-Matching: pair each item on the left with one on the right, fast.
import { html, useState } from "../vendor/preact-htm.mjs";
import { ErrorNote, useAction, useNow } from "../lib/ui.js";

const PAIR_COLORS = ["#E8173A", "#00A65A", "#E89B00", "#0B3D2A", "#FF6B35", "#7B2CBF", "#0077B6", "#C2185B"];

export function SpeedMatch({ data, start, submit }) {
  const begin = useAction(start);
  if (!data.play?.started_at) {
    return html`<section class="stack-lg">
      <div class="hero pine sprinkles">
        <div class="kicker">How it works</div>
        <h2>On your marks…</h2>
        <p>Tap something on the left, then its match on the right. Accuracy is worth 70 points and speed up to 30 — finish inside 30 seconds for the full bonus.</p>
      </div>
      <${ErrorNote} error=${begin.error} />
      <button class="btn block green" disabled=${begin.busy} onClick=${begin.run}>Start the clock</button>
    </section>`;
  }
  return html`<${Board} data=${data} submit=${submit} />`;
}

function Board({ data, submit }) {
  const { lefts, rights, left_label, right_label } = data.content;
  const [matches, setMatches] = useState(() => lefts.map(() => null));
  const [selected, setSelected] = useState(null);
  const send = useAction(() => submit({ matches }));
  const now = useNow(250);
  const secs = Math.max(0, (now - new Date(data.play.started_at)) / 1000);

  const tapLeft = (i) => {
    if (matches[i] !== null) {
      const next = [...matches];
      next[i] = null;
      setMatches(next);
    }
    setSelected(i);
  };
  const tapRight = (j) => {
    const owner = matches.indexOf(j);
    if (selected === null) {
      if (owner !== -1) {
        const next = [...matches];
        next[owner] = null;
        setMatches(next);
      }
      return;
    }
    const next = matches.map((m) => (m === j ? null : m));
    next[selected] = j;
    setMatches(next);
    const free = next.findIndex((m) => m === null);
    setSelected(free === -1 ? null : free);
  };
  const done = matches.every((m) => m !== null);

  return html`<section class="stack-lg">
    <div class="row between">
      <span style="font-weight:700">${matches.filter((m) => m !== null).length} of ${lefts.length} matched</span>
      <span class="timer-chip" role="timer">⚡ ${secs.toFixed(1)}s</span>
    </div>
    <div class="match-grid">
      <div class="match-col">
        <div class="section-label">${left_label}</div>
        ${lefts.map((l, i) => html`<button class=${"match-card" + (selected === i ? " selected" : "") + (matches[i] !== null ? " paired" : "")}
          style=${matches[i] !== null ? `background:${PAIR_COLORS[i % PAIR_COLORS.length]}` : ""} onClick=${() => tapLeft(i)}>${l}</button>`)}
      </div>
      <div class="match-col">
        <div class="section-label">${right_label}</div>
        ${rights.map((r, j) => {
          const owner = matches.indexOf(j);
          return html`<button class=${"match-card" + (owner !== -1 ? " paired" : "")}
            style=${owner !== -1 ? `background:${PAIR_COLORS[owner % PAIR_COLORS.length]}` : ""} onClick=${() => tapRight(j)}>${r}</button>`;
        })}
      </div>
    </div>
    <${ErrorNote} error=${send.error} />
    <button class="btn block" disabled=${!done || send.busy} onClick=${send.run}>${done ? "Stop the clock!" : "Match them all to finish"}</button>
  </section>`;
}

export function SpeedMatchReview({ data }) {
  const { lefts = [], rights = [] } = data.content || {};
  const correct = data.answers?.correct || [];
  const mine = data.play?.response?.matches || [];
  return html`<section class="card stack">
    <div class="section-label">Answers</div>
    <div class="list">
      ${lefts.map((l, i) => html`<div class="list-item">
        <span>${mine.length ? (mine[i] === correct[i] ? "✅" : "❌") : "•"}</span>
        <div class="grow"><b>${l}</b> → ${rights[correct[i]]}</div>
      </div>`)}
    </div>
  </section>`;
}
