// Holiday Bingo: mark real-life moments as they happen, until the day closes.
import { html, useState } from "../vendor/preact-htm.mjs";
import { ErrorNote, useAction, toast } from "../lib/ui.js";

const FREE = 12;
const LINES = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];

// Same formula as the database: 3 points a square, 8 a line, up to 100.
export function bingoScore(marked) {
  const set = new Set([...marked, FREE]);
  const lines = LINES.filter((line) => line.every((i) => set.has(i))).length;
  return { lines, score: Math.min(100, 3 * marked.length + 8 * lines) };
}

export function Bingo({ data, submit, readOnly }) {
  const squares = data.content?.squares || [];
  const saved = data.play?.response?.marked || [];
  const [marked, setMarked] = useState(saved);
  const save = useAction(async () => {
    await submit({ marked });
    toast("Card saved");
  });
  const dirty = marked.length !== saved.length || marked.some((m) => !saved.includes(m));
  const { lines, score } = bingoScore(marked);

  // The 24 prompts fill the grid around the free middle square.
  const cells = [];
  for (let i = 0, s = 0; i < 25; i++) cells.push(i === FREE ? null : squares[s++]);

  const toggle = (i) => {
    if (readOnly || i === FREE) return;
    setMarked(marked.includes(i) ? marked.filter((m) => m !== i) : [...marked, i]);
  };

  return html`<section class="stack-lg">
    <div class="card stack">
      <div class="bingo-head" aria-hidden="true">${[..."BINGO"].map((l) => html`<span>${l}</span>`)}</div>
      <div class="bingo">
        ${cells.map((text, i) => i === FREE
          ? html`<div class="bingo-cell free">FREE ⭐</div>`
          : html`<button class=${"bingo-cell" + (marked.includes(i) ? " marked" : "")} aria-pressed=${marked.includes(i)}
              disabled=${readOnly} onClick=${() => toggle(i)}>${text}</button>`)}
      </div>
      <div class="row between small">
        <span><b>${marked.length}</b> squares · <b>${lines}</b> ${lines === 1 ? "line" : "lines"}</span>
        <span class="pill gold">${score} pts</span>
      </div>
    </div>
    ${!readOnly && html`
      <${ErrorNote} error=${save.error} />
      <button class="btn block" disabled=${save.busy || (!dirty && data.play?.submitted_at)} onClick=${save.run}>
        ${save.busy ? "Saving…" : data.play?.submitted_at ? (dirty ? "Save changes" : "Card saved ✓") : "Save my card"}
      </button>
      <p class="small muted center">Honor system! Only mark what really happened today.</p>`}
  </section>`;
}
