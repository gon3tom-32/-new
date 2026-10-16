// Multiple-choice games: Trivia, Emoji Decode, Two Truths and a Tradition,
// Lyric Fill-in-the-Blank, and the Finale Quiz.
import { html, useState } from "../vendor/preact-htm.mjs";
import { ErrorNote, useAction } from "../lib/ui.js";

function Prompt({ format, question }) {
  if (format === "emoji") return html`<div class="emoji-prompt" aria-label="Emoji clue">${question.prompt}</div>`;
  if (format === "lyrics") {
    const [before, after] = question.prompt.split("____");
    return html`<p class="question-prompt">“${before}<span style="display:inline-block;min-width:3.5em;border-bottom:3px solid var(--red)">\u00a0</span>${after ?? ""}”</p>`;
  }
  return html`<p class="question-prompt">${question.prompt}</p>`;
}

const LETTERS = ["A", "B", "C", "D"];

export function Quiz({ data, submit }) {
  const questions = data.content.questions;
  const [answers, setAnswers] = useState(() => questions.map(() => null));
  const [index, setIndex] = useState(0);
  const send = useAction(() => submit({ answers }));
  const question = questions[index];
  const last = index === questions.length - 1;
  const allAnswered = answers.every((a) => a !== null);

  const pick = (choice) => {
    const next = [...answers];
    next[index] = choice;
    setAnswers(next);
    if (!last) setTimeout(() => setIndex((i) => Math.min(i + 1, questions.length - 1)), 220);
  };

  return html`<section class="stack-lg">
    <div class="stack">
      <div class="row between small"><b>Question ${index + 1} of ${questions.length}</b>
        ${question.source && html`<span class="muted">${question.source}</span>`}
      </div>
      <div class="progress"><div style=${`width:${((index + 1) / questions.length) * 100}%`}></div></div>
    </div>
    <div class="card stack-lg">
      <${Prompt} format=${data.format} question=${question} />
      <div class="choices" role="radiogroup">
        ${question.choices.map((c, i) => html`<button class=${"choice" + (answers[index] === i ? " picked" : "")}
          role="radio" aria-checked=${answers[index] === i} onClick=${() => pick(i)}>
          <span class="muted" style="margin-right:10px">${LETTERS[i]}</span>${c}
        </button>`)}
      </div>
    </div>
    <${ErrorNote} error=${send.error} />
    <div class="row">
      ${index > 0 && html`<button class="btn ghost" onClick=${() => setIndex(index - 1)}>Back</button>`}
      ${!last && html`<button class="btn ghost grow" onClick=${() => setIndex(index + 1)}>${answers[index] === null ? "Skip" : "Next"}</button>`}
      ${last && html`<button class="btn grow" disabled=${send.busy} onClick=${send.run}>
        ${send.busy ? "Submitting…" : allAnswered ? "Submit answers" : `Submit (${answers.filter((a) => a === null).length} unanswered)`}
      </button>`}
    </div>
    <p class="small muted center">One go only — submit when you're happy with your answers.</p>
  </section>`;
}

export function QuizReview({ data }) {
  const questions = data.content?.questions || [];
  const correct = data.answers?.correct || [];
  const mine = data.play?.response?.answers || [];
  return html`<section class="stack">
    <div class="section-label">Answers</div>
    ${questions.map((q, i) => html`<div class="card stack">
      <div class="small muted">${q.source || `Question ${i + 1}`}</div>
      <${Prompt} format=${data.format} question=${q} />
      <div class="choices">
        ${q.choices.map((c, j) => {
          const isRight = j === correct[i];
          const isMine = j === mine[i];
          if (!isRight && !isMine) return null;
          return html`<div class=${"choice " + (isRight ? "right" : "wrong")}>
            ${isRight ? "✓ " : "✗ "}${c}${isMine ? html` <span class="small muted">(your answer)</span>` : ""}
          </div>`;
        })}
      </div>
    </div>`)}
  </section>`;
}
