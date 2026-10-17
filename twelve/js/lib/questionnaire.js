// The Secret Santa questionnaire: mostly taps, a few short answers.
// Answers are saved as one object keyed by question id, for example
// { thisthat: { drink: "Coffee" }, vibes: ["Bookworm"], hobby: "Pottery" }.
// The giver's summary and the AI gift ideas both read this format, so keep
// question ids stable once people have answered.
import { html } from "../vendor/preact-htm.mjs";

export const QUESTIONS = [
  {
    id: "thisthat", type: "thisthat", title: "This or that ⚡", sub: "Go with your gut.",
    pairs: [
      { id: "drink", a: ["☕", "Coffee"], b: ["🍵", "Tea"] },
      { id: "taste", a: ["🍫", "Sweet"], b: ["🥨", "Salty"] },
      { id: "night", a: ["🛋️", "Cozy night in"], b: ["🎉", "Night out"] },
      { id: "kind", a: ["🔧", "Practical"], b: ["🎈", "Just for fun"] },
      { id: "form", a: ["🎁", "A thing"], b: ["🎟️", "An experience"] },
    ],
  },
  {
    id: "vibes", type: "multi", max: 3, title: "Pick your vibes", sub: "Up to 3.",
    options: [
      ["🏠", "Homebody"], ["🍜", "Foodie"], ["🏕️", "Outdoorsy"], ["🧶", "Crafty / DIY"],
      ["📚", "Bookworm"], ["🎮", "Gamer"], ["💪", "Fitness"], ["🎧", "Music lover"],
      ["🍿", "Movie / TV buff"], ["✈️", "Traveler"], ["💻", "Techie"], ["🪴", "Plant parent"],
      ["🐾", "Pet person"], ["🛁", "Self-care"],
    ],
  },
  {
    id: "treats", type: "multi", title: "Favorite treats", sub: "Pick as many as you like.",
    options: [
      ["🍫", "Chocolate"], ["🍬", "Candy"], ["🥨", "Salty snacks"], ["🧁", "Baked goods"],
      ["☕", "Coffee"], ["🍵", "Tea"], ["⛄", "Hot cocoa"], ["🌶️", "Spicy"],
      ["🥗", "Healthy snacks"], ["🍷", "Wine / beer"],
    ],
  },
  {
    id: "colors", type: "colors", max: 3, title: "Colors you love", sub: "Up to 3.",
    options: [
      ["Red", "#d7263d"], ["Pink", "#f58bb4"], ["Orange", "#f77f00"], ["Gold", "#e9b200"],
      ["Green", "#2a9d4a"], ["Sage", "#a3b899"], ["Teal", "#1c9a9a"], ["Blue", "#2f6fdb"],
      ["Navy", "#1d2b53"], ["Purple", "#7b4bc4"], ["Black", "#1b1b1b"], ["White", "#ffffff"],
      ["Cream", "#f3e6c8"], ["Brown", "#8a5a3b"], ["Grey", "#9a9a9a"], ["Silver", "linear-gradient(135deg,#e8e8e8,#a9a9a9)"],
    ],
  },
  {
    id: "scents", type: "multi", title: "Scents you like", sub: "Pick any.",
    options: [
      ["🍦", "Vanilla"], ["🌲", "Pine"], ["🍊", "Citrus"], ["🌸", "Floral"],
      ["🍂", "Cinnamon & spice"], ["🫧", "Fresh & clean"], ["🚫", "Unscented, please"],
    ],
    only: "Unscented, please",
  },
  {
    id: "ideal", type: "single", title: "Your ideal gift is…",
    options: [
      ["🔧", "Something useful"], ["🎈", "Something fun"], ["🧣", "Something cozy"],
      ["🍪", "Something tasty"], ["🎟️", "An experience"], ["🎲", "Surprise me!"],
    ],
  },
  {
    id: "giftcard", type: "single", title: "Gift cards?",
    options: [["😍", "Love them"], ["👍", "They're fine"], ["🙅", "Please no"]],
  },
  {
    id: "hobby", type: "text", title: "A hobby you've been wanting to try",
    placeholder: "Pottery, pickleball, sourdough…",
  },
  {
    id: "into", type: "text", title: "A show, book, or artist you're into right now",
    placeholder: "Type a few…",
  },
  {
    id: "secret", type: "text", title: "Something you'd never buy yourself but secretly want",
    placeholder: "Go on, we won't tell…",
  },
  {
    id: "avoid", type: "avoid", title: "Please avoid…", sub: "Allergies, dislikes, or things you have enough of.",
    options: [
      ["🥜", "Nuts"], ["🌾", "Gluten"], ["🥛", "Dairy"], ["🍷", "Alcohol"],
      ["🕯️", "Candles"], ["☕", "Mugs"], ["🧸", "Knick-knacks"],
    ],
    placeholder: "Anything else?",
  },
];

// Old questionnaires were a plain list of typed answers; treat them as empty.
export function normalize(answers) {
  return answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
}

export function isAnswered(question, value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (question.type === "avoid") return (value.picks || []).length > 0 || Boolean(value.other?.trim());
  return Object.values(value).some(Boolean);
}

export function countAnswered(answers) {
  const a = normalize(answers);
  return QUESTIONS.filter((q) => isAnswered(q, a[q.id])).length;
}

// ---------- Answering ----------

const toggle = (list, item, max) => {
  if (list.includes(item)) return list.filter((x) => x !== item);
  if (max && list.length >= max) return list;
  return [...list, item];
};

// One question's input. `value` is this question's answer; `onChange` gets the new one.
export function QuestionInput({ question: q, value, onChange }) {
  if (q.type === "thisthat") {
    const v = value || {};
    return html`<div class="tt-list">
      ${q.pairs.map((p) => html`<div class="tt-pair" role="group" aria-label=${`${p.a[1]} or ${p.b[1]}`}>
        ${[p.a, p.b].map(([emoji, label], i) => html`
          ${i === 1 && html`<span class="tt-or" aria-hidden="true">or</span>`}
          <button type="button" class=${"tt-option" + (v[p.id] === label ? " on" : "")} aria-pressed=${v[p.id] === label}
            onClick=${() => onChange({ ...v, [p.id]: v[p.id] === label ? undefined : label })}>
            <span class="tt-emoji">${emoji}</span><span>${label}</span>
          </button>`)}
      </div>`)}
    </div>`;
  }

  if (q.type === "multi") {
    const list = value || [];
    const full = q.max && list.length >= q.max;
    const pick = (label) => {
      if (q.only && label === q.only) return onChange(list.includes(label) ? [] : [label]);
      onChange(toggle(list.filter((x) => x !== q.only), label, q.max));
    };
    return html`<div class="pick-grid">
      ${q.options.map(([emoji, label]) => {
        const on = list.includes(label);
        return html`<button type="button" class=${"pick" + (on ? " on" : "")} aria-pressed=${on}
          disabled=${!on && full} onClick=${() => pick(label)}>
          <span class="pick-emoji">${emoji}</span><span>${label}</span>
        </button>`;
      })}
    </div>`;
  }

  if (q.type === "colors") {
    const list = value || [];
    const full = list.length >= q.max;
    return html`<div class="swatch-grid">
      ${q.options.map(([name, color]) => {
        const on = list.includes(name);
        return html`<button type="button" class=${"swatch" + (on ? " on" : "")} aria-pressed=${on} aria-label=${name}
          disabled=${!on && full} onClick=${() => onChange(toggle(list, name, q.max))}>
          <span class="swatch-dot" style=${`background:${color}`}>${on ? "✓" : ""}</span>
          <span class="swatch-name">${name}</span>
        </button>`;
      })}
    </div>`;
  }

  if (q.type === "single") {
    return html`<div class="choices">
      ${q.options.map(([emoji, label]) => html`<button type="button" class=${"choice" + (value === label ? " picked" : "")}
        aria-pressed=${value === label} onClick=${() => onChange(value === label ? "" : label)}>
        <span style="margin-right:10px">${emoji}</span>${label}
      </button>`)}
    </div>`;
  }

  if (q.type === "avoid") {
    const v = value || { picks: [], other: "" };
    return html`<div class="stack">
      <div class="pick-grid">
        ${q.options.map(([emoji, label]) => {
          const on = (v.picks || []).includes(label);
          return html`<button type="button" class=${"pick avoid" + (on ? " on" : "")} aria-pressed=${on}
            onClick=${() => onChange({ ...v, picks: toggle(v.picks || [], label) })}>
            <span class="pick-emoji">${emoji}</span><span>${label}</span>
          </button>`;
        })}
      </div>
      <input class="input" maxlength="200" placeholder=${q.placeholder} aria-label=${q.placeholder}
        value=${v.other || ""} onInput=${(e) => onChange({ ...v, other: e.currentTarget.value })} />
    </div>`;
  }

  return html`<textarea class="textarea" maxlength="300" placeholder=${q.placeholder} aria-label=${q.title} key=${q.id}
    value=${value || ""} onInput=${(e) => onChange(e.currentTarget.value)}></textarea>`;
}

// ---------- What the giver sees ----------

const emojiFor = (q, label) => (q.options || []).find((o) => o[1] === label)?.[0] || "";
const byId = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

export function AnswerSummary({ answers, name }) {
  const a = normalize(answers);
  const tt = byId.thisthat.pairs.map((p) => {
    const label = a.thisthat?.[p.id];
    const side = [p.a, p.b].find((x) => x[1] === label);
    return side && html`<span class="pill">${side[0]} ${side[1]}</span>`;
  }).filter(Boolean);
  const chips = (id) => (a[id] || []).map((label) => html`<span class="pill">${emojiFor(byId[id], label)} ${label}</span>`);
  // Skips empty answers (including a 0 from an empty list's length).
  const row = (title, content) => (content ? html`<div class="answer-card">
    <div class="q">${title}</div><div class="a">${content}</div>
  </div>` : null);
  const pickLabel = (id) => a[id] && `${emojiFor(byId[id], a[id])} ${a[id]}`;
  const avoid = a.avoid || {};
  const avoidList = [...(avoid.picks || []), ...(avoid.other?.trim() ? [avoid.other.trim()] : [])];

  return html`<div>
    ${row("This or that", tt.length && html`<div class="chips">${tt}</div>`)}
    ${row(`${name}'s vibes`, (a.vibes || []).length && html`<div class="chips">${chips("vibes")}</div>`)}
    ${row("Favorite treats", (a.treats || []).length && html`<div class="chips">${chips("treats")}</div>`)}
    ${row("Colors they love", (a.colors || []).length && html`<div class="chips">${a.colors.map((c) => {
      const color = byId.colors.options.find((o) => o[0] === c)?.[1] || c;
      return html`<span class="pill"><span class="swatch-mini" style=${`background:${color}`}></span>${c}</span>`;
    })}</div>`)}
    ${row("Scents", (a.scents || []).length && html`<div class="chips">${chips("scents")}</div>`)}
    ${row("Ideal gift", pickLabel("ideal"))}
    ${row("Gift cards", pickLabel("giftcard"))}
    ${row("Wants to try", a.hobby?.trim())}
    ${row("Into right now", a.into?.trim())}
    ${row("Secretly wants", a.secret?.trim())}
    ${avoidList.length > 0 && html`<div class="avoid-note"><b>🚫 Please avoid:</b> ${avoidList.join(", ")}</div>`}
  </div>`;
}
