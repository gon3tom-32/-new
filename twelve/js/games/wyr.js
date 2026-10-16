// Would You Rather: answer every pair, then see how the group split.
import { html, useState } from "../vendor/preact-htm.mjs";
import { rpc } from "../lib/db.js";
import { ErrorNote, Spinner, useAction, useAsync } from "../lib/ui.js";

export function WouldYouRather({ data, submit }) {
  const questions = data.content.questions;
  const [choices, setChoices] = useState(() => questions.map(() => null));
  const send = useAction(() => submit({ choices }));
  const done = choices.every(Boolean);
  const pick = (i, side) => {
    const next = [...choices];
    next[i] = side;
    setChoices(next);
  };
  return html`<section class="stack-lg">
    ${questions.map((q, i) => html`<div class="card stack">
      <div class="small muted"><b>${i + 1} of ${questions.length}</b> · Would you rather…</div>
      <div class="wyr-pair">
        <button class="wyr-option a" aria-pressed=${choices[i] === "a"} onClick=${() => pick(i, "a")}
          style=${choices[i] === "b" ? "opacity:0.35" : ""}>${choices[i] === "a" ? "✓ " : ""}${q.a}</button>
        <div class="wyr-or">or</div>
        <button class="wyr-option b" aria-pressed=${choices[i] === "b"} onClick=${() => pick(i, "b")}
          style=${choices[i] === "a" ? "opacity:0.35" : ""}>${choices[i] === "b" ? "✓ " : ""}${q.b}</button>
      </div>
    </div>`)}
    <${ErrorNote} error=${send.error} />
    <button class="btn block" disabled=${!done || send.busy} onClick=${send.run}>
      ${done ? (send.busy ? "Submitting…" : "Submit & see the split") : `${choices.filter((c) => !c).length} left to answer`}
    </button>
  </section>`;
}

export function WyrSplit({ data, groupId }) {
  const split = useAsync(() => rpc("twelve_wyr_split", { p_group: groupId, p_day: data.day }), [groupId, data.day]);
  const questions = data.content?.questions || [];
  const mine = data.play?.response?.choices || [];
  if (split.loading && !split.data) return html`<${Spinner} />`;
  if (split.error) return html`<${ErrorNote} error=${split.error} />`;
  const byQ = Object.fromEntries((split.data || []).map((r) => [r.question, r]));
  return html`<section class="stack">
    <div class="section-label">How the group split${data.state === "open" ? " so far" : ""}</div>
    ${questions.map((q, i) => {
      const r = byQ[i] || { a: 0, b: 0 };
      const total = r.a + r.b || 1;
      const pa = Math.round((r.a / total) * 100);
      return html`<div class="card stack">
        <div class="row between small"><span><b>${q.a}</b>${mine[i] === "a" ? " (you)" : ""}</span><span style="text-align:right"><b>${q.b}</b>${mine[i] === "b" ? " (you)" : ""}</span></div>
        <div class="split-bar">
          ${r.a > 0 && html`<div class="a" style=${`width:${pa}%`}>${pa}%</div>`}
          ${r.b > 0 && html`<div class="b" style=${`width:${100 - pa}%`}>${100 - pa}%</div>`}
          ${r.a + r.b === 0 && html`<div style="background:var(--line);width:100%;color:var(--ink-soft)">No answers yet</div>`}
        </div>
      </div>`;
    })}
  </section>`;
}
