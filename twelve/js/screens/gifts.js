// Gift exchange: join, questionnaire, draw, scratch-off reveal, your
// recipient's answers, and the anonymous Q&A.
import { html, useState, useEffect, useRef } from "../vendor/preact-htm.mjs";
import { sb, q, rpc, currentSeason } from "../lib/db.js";
import { useApp, useGroup } from "../lib/state.js";
import { QUESTIONS, QuestionInput, AnswerSummary, countAnswered, isAnswered, normalize } from "../lib/questionnaire.js";
import { Avatar, ErrorNote, Spinner, useAction, useAsync, Countdown, formatDate, daysUntil, BackLink, toast, formatTime } from "../lib/ui.js";


// ---------- Main screen ----------

export function Gifts() {
  const g = useGroup();
  const { user } = useApp();
  if (!g.group.gifts_enabled) {
    return html`<main class="page"><div class="empty"><div class="big">🎁</div>
      <p>The gift exchange is turned off for ${g.group.name}.${g.isHost ? " You can turn it on in host settings." : ""}</p>
      ${g.isHost && html`<a class="btn" style="margin-top:16px" href=${`#/g/${g.groupId}/settings`}>Host settings</a>`}
    </div></main>`;
  }
  const gift = g.gift;
  const drawn = Boolean(gift.season?.drawn_at);
  const inExchange = gift.participants.includes(user.id);

  return html`<main class="page stack-lg">
    <${ExchangeHeader} />
    ${drawn && gift.match && html`<${MyMatch} />`}
    ${drawn && inExchange && html`<${SantaInboxCard} />`}
    ${drawn && !gift.match && html`<div class="card"><p>Names were drawn ${formatDate(gift.season.drawn_at, { month: "long", day: "numeric" })}. You're not part of this year's exchange — enjoy the show!</p></div>`}
    ${inExchange && html`<${QuestionnaireCard} />`}
    ${!drawn && html`<${JoinCard} />`}
    <${Roster} />
    ${!drawn && g.isHost && html`<${HostDraw} />`}
    ${drawn && g.isHost && html`<${HostReset} />`}
  </main>`;
}

function ExchangeHeader() {
  const g = useGroup();
  const s = g.gift.season;
  const date = s?.gathering_date;
  const days = date ? daysUntil(date) : null;
  return html`<div class="hero green sprinkles">
    <div class="kicker">Gift exchange ${currentSeason()}</div>
    <h2>${date ? (days > 0 ? "Counting down" : days === 0 ? "It's gift day! 🎉" : "Hope it was merry!") : "Getting ready"}</h2>
    ${date && days > 0 && html`<div style="margin:10px 0"><${Countdown} to=${date + "T00:00:00"} /></div>`}
    <div class="row wrap" style="gap:8px;margin-top:8px">
      <span class="pill" style="background:rgba(255,255,255,0.2);color:#fff">💰 ${s?.budget ? `Budget: ${s.budget}` : "Budget not set yet"}</span>
      <span class="pill" style="background:rgba(255,255,255,0.2);color:#fff">📅 ${date ? formatDate(date) : "Date not set yet"}</span>
    </div>
    ${g.isHost && html`<a class="btn white small" href=${`#/g/${g.groupId}/settings`}>Edit budget & date</a>`}
  </div>`;
}

// Shown only to people who haven't joined yet. Once you're in, you can leave
// from your own row in the roster.
function JoinCard() {
  const g = useGroup();
  const { user } = useApp();
  const join = useAction(async () => {
    await rpc("twelve_set_gift_participant", { p_group: g.groupId, p_user: user.id, p_in: true });
    await g.reload();
  });
  if (g.gift.participants.includes(user.id)) return null;
  return html`<div class="card stack">
    <h3>Want in this year?</h3>
    <p class="muted">Join the exchange to be part of the draw. You can leave any time before names are drawn.</p>
    <${ErrorNote} error=${join.error} />
    <button class="btn green" disabled=${join.busy} onClick=${join.run}>Count me in</button>
  </div>`;
}

function QuestionnaireCard() {
  const g = useGroup();
  const done = g.gift.questionnaire?.completed_at;
  const answered = countAnswered(g.gift.questionnaire?.answers);
  const label = done ? "Edit my answers" : answered ? `Continue (${answered} of ${QUESTIONS.length})` : "Start the questionnaire";
  return html`<section class="card stack">
    <div class="row between">
      <h3>${done ? "Your questionnaire ✓" : "Tell your Secret Santa about you"}</h3>
      <span class=${"pill " + (done ? "green" : "red")}>${done ? "Done" : `${answered} of ${QUESTIONS.length}`}</span>
    </div>
    <p class="muted">${done ? "Your Secret Santa sees these answers. You can change them any time." : "Quick, mostly tap-to-pick questions instead of a wish list. Only the person who draws your name sees them. (If they ask for AI gift ideas, your answers, never your name, go to Google's AI.)"}</p>
    <a class=${"btn " + (done ? "ghost" : "green")} href=${`#/g/${g.groupId}/gifts/questions`}>${label}</a>
  </section>`;
}

function Roster() {
  const g = useGroup();
  const { user } = useApp();
  const drawn = Boolean(g.gift.season?.drawn_at);
  const people = g.members.filter((m) => g.gift.participants.includes(m.user_id));
  const outside = g.members.filter((m) => !g.gift.participants.includes(m.user_id));
  const setIn = useAction(async (userId, value) => {
    await rpc("twelve_set_gift_participant", { p_group: g.groupId, p_user: userId, p_in: value });
    await g.reload();
  });
  const partnerOf = (id) => {
    const c = g.gift.couples.find((c) => c.user_a === id || c.user_b === id);
    return c ? g.profiles[c.user_a === id ? c.user_b : c.user_a]?.display_name : null;
  };
  return html`<section class="card stack">
    <div class="section-label">In the exchange · ${people.length}</div>
    ${people.length === 0 && html`<p class="muted">Nobody yet.</p>`}
    <div class="list">
      ${people.map((m) => html`<div class="list-item">
        <${Avatar} profile=${m.profile} size=${36} />
        <div class="grow">
          <div>${m.profile.display_name}${m.user_id === user.id ? " (you)" : ""}</div>
          ${partnerOf(m.user_id) && html`<div class="small muted">💞 Won't draw ${partnerOf(m.user_id)}</div>`}
        </div>
        ${g.isHost && !drawn && m.user_id !== user.id && html`<button class="btn ghost small" disabled=${setIn.busy} onClick=${() => setIn.run(m.user_id, false)}>Remove</button>`}
        ${!drawn && m.user_id === user.id && html`<button class="btn ghost small" disabled=${setIn.busy} onClick=${() => setIn.run(user.id, false)}>Leave</button>`}
      </div>`)}
    </div>
    ${!drawn && people.some((m) => m.user_id === user.id) && html`<p class="small muted">When ${g.isHost ? "you draw" : "the host draws"} names, you'll get a private notification with who you're giving to.</p>`}
    ${drawn && html`<p class="small muted">Everyone can see who's taking part — but only you know who you're giving to.</p>`}
    ${g.isHost && !drawn && outside.length > 0 && html`
      <div class="section-label" style="margin-top:6px">Not in yet</div>
      <div class="list">
        ${outside.map((m) => html`<div class="list-item">
          <${Avatar} profile=${m.profile} size=${36} />
          <div class="grow">${m.profile.display_name}</div>
          <button class="btn green small" disabled=${setIn.busy} onClick=${() => setIn.run(m.user_id, true)}>Add</button>
        </div>`)}
      </div>`}
    <${ErrorNote} error=${setIn.error} />
  </section>`;
}

function HostDraw() {
  const g = useGroup();
  const people = g.members.filter((m) => g.gift.participants.includes(m.user_id));
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [confirming, setConfirming] = useState(false);
  const couple = useAction(async (x, y, value) => {
    await rpc("twelve_set_couple", { p_group: g.groupId, p_a: x, p_b: y, p_couple: value });
    setA("");
    setB("");
    await g.reload();
  });
  const draw = useAction(async () => {
    await rpc("twelve_draw_names", { p_group: g.groupId });
    setConfirming(false);
    await g.reload();
    toast("Names drawn! Everyone's been notified 🎁");
  });
  const name = (id) => g.profiles[id]?.display_name || "Someone";

  return html`<section class="card stack">
    <div class="section-label">Host · Draw names</div>
    <h3>Couples</h3>
    <p class="small muted">Couples never draw each other. Everything else is random. This carries over to next year.</p>
    <div class="list">
      ${g.gift.couples.map((c) => html`<div class="list-item">
        <div class="grow">💞 ${name(c.user_a)} & ${name(c.user_b)}</div>
        <button class="btn ghost small" onClick=${() => couple.run(c.user_a, c.user_b, false)}>Remove</button>
      </div>`)}
    </div>
    <div class="stack" style="gap:8px">
      <select class="select" value=${a} onChange=${(e) => setA(e.currentTarget.value)} aria-label="First person">
        <option value="">Pick someone</option>
        ${g.members.map((m) => html`<option value=${m.user_id}>${m.profile.display_name}</option>`)}
      </select>
      <select class="select" value=${b} onChange=${(e) => setB(e.currentTarget.value)} aria-label="Second person">
        <option value="">…and their partner</option>
        ${g.members.filter((m) => m.user_id !== a).map((m) => html`<option value=${m.user_id}>${m.profile.display_name}</option>`)}
      </select>
      <button class="btn ghost small" disabled=${!a || !b || a === b || couple.busy} onClick=${() => couple.run(a, b, true)}>💞 Add couple</button>
    </div>
    <${ErrorNote} error=${couple.error} />

    <h3 style="margin-top:8px">Ready?</h3>
    <p class="small muted">Draw when everyone's in — there's no automatic deadline. Once names are drawn, the list is locked for this year.</p>
    ${confirming
      ? html`<div class="note stack">
          <p><b>Draw names for ${people.length} people?</b> Everyone gets notified right away.</p>
          <div class="row">
            <button class="btn green grow" disabled=${draw.busy} onClick=${draw.run}>${draw.busy ? "Drawing…" : "Yes, draw!"}</button>
            <button class="btn ghost" onClick=${() => setConfirming(false)}>Not yet</button>
          </div>
        </div>`
      : html`<button class="btn green block" disabled=${people.length < 2} onClick=${() => setConfirming(true)}>🎲 Draw names</button>`}
    ${people.length < 2 && html`<p class="small muted center">At least two people need to be in the exchange.</p>`}
    <${ErrorNote} error=${draw.error} />
  </section>`;
}

function HostReset() {
  const g = useGroup();
  const [confirming, setConfirming] = useState(false);
  const reset = useAction(async () => {
    await rpc("twelve_reset_draw", { p_group: g.groupId });
    setConfirming(false);
    await g.reload();
    toast("Secret Santa reset. You can draw names again.");
  });
  return html`<section class="card stack">
    <div class="section-label">Host · Reset Secret Santa</div>
    <p class="small muted">Made a mistake, or someone new needs to join? Resetting undoes the draw so you can draw names again.</p>
    ${confirming
      ? html`<div class="note stack">
          <p><b>Reset the Secret Santa?</b> This deletes everyone's match, all anonymous messages, and the "gift bought" checkmarks. It can't be undone.</p>
          <p class="small">Kept: who's in the exchange, couples, budget, date, and everyone's questionnaire answers.</p>
          <div class="row">
            <button class="btn grow" disabled=${reset.busy} onClick=${reset.run}>${reset.busy ? "Resetting…" : "Yes, reset"}</button>
            <button class="btn ghost" onClick=${() => setConfirming(false)}>Cancel</button>
          </div>
        </div>`
      : html`<button class="btn ghost block" onClick=${() => setConfirming(true)}>🔄 Reset Secret Santa</button>`}
    <${ErrorNote} error=${reset.error} />
  </section>`;
}

// ---------- The reveal ----------

function ScratchCard({ recipient, onRevealed }) {
  const canvas = useRef(null);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const c = canvas.current;
    const rect = c.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d");
    ctx.scale(ratio, ratio);
    // Foil: gold with a candy-stripe border and an invitation to scratch.
    const grad = ctx.createLinearGradient(0, 0, rect.width, rect.height);
    grad.addColorStop(0, "#FFD34D");
    grad.addColorStop(0.5, "#FFB703");
    grad.addColorStop(1, "#F29E00");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    for (let i = -rect.height; i < rect.width; i += 26) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 12, 0);
      ctx.lineTo(i + 12 + rect.height, rect.height);
      ctx.lineTo(i + rect.height, rect.height);
      ctx.fill();
    }
    ctx.fillStyle = "#7a4a00";
    ctx.textAlign = "center";
    ctx.font = "800 26px 'Bricolage Grotesque', sans-serif";
    ctx.fillText("Scratch to reveal", rect.width / 2, rect.height / 2 - 4);
    ctx.font = "700 15px 'DM Sans', sans-serif";
    ctx.fillText("who you're giving to 🎁", rect.width / 2, rect.height / 2 + 22);

    let drawing = false;
    let strokes = 0;
    const point = (e) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const scratch = (e) => {
      if (!drawing) return;
      const [x, y] = point(e);
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, Math.PI * 2);
      ctx.fill();
      if (++strokes % 12 === 0) check();
    };
    const check = () => {
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let clear = 0;
      for (let i = 3; i < data.length; i += 4 * 16) if (data[i] === 0) clear++;
      if (clear / (data.length / (4 * 16)) > 0.5) setCleared(true);
    };
    const down = (e) => { drawing = true; c.setPointerCapture(e.pointerId); scratch(e); };
    const up = () => { drawing = false; check(); };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", scratch);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", scratch);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }, []);

  useEffect(() => {
    if (cleared) onRevealed();
  }, [cleared]);

  return html`<div class="stack">
    <div class="scratch-wrap">
      <div class="scratch-under">
        <div class="section-label">You're giving to</div>
        <${Avatar} profile=${recipient} size=${84} />
        <h2>${recipient.display_name}</h2>
      </div>
      <canvas ref=${canvas} aria-label="Scratch card. Drag your finger across it to reveal your match."
        style=${cleared ? "opacity:0;transition:opacity 0.6s;pointer-events:none" : ""}></canvas>
    </div>
    ${!cleared && html`<button class="link-btn center" onClick=${() => setCleared(true)}>Can't scratch? Tap to reveal</button>`}
  </div>`;
}

// AI gift ideas from the giftee's questionnaire answers (twelve-gift-ideas
// Edge Function, Google Gemini free tier). Only the answers and the budget
// are sent, never names.
function GiftIdeas({ groupId, name }) {
  const [ideas, setIdeas] = useState(null);
  const get = useAction(async () => {
    const { data, error } = await sb.functions.invoke("twelve-gift-ideas", { body: { group_id: groupId } });
    if (error) {
      let message = null;
      try {
        message = (await error.context.json()).error;
      } catch {
        /* not our JSON */
      }
      if (!message && error.context?.status === 404) message = "Gift ideas aren't switched on yet.";
      throw new Error(message || "Couldn't get gift ideas right now. Try again in a moment.");
    }
    setIdeas(data.ideas);
  });
  return html`<div class="stack" style="border-top:1px solid var(--line);padding-top:14px">
    <div class="section-label">✨ Gift ideas</div>
    ${!ideas && html`<p class="small muted">Stuck? AI can suggest gifts based on ${name}'s answers and the budget.</p>`}
    ${ideas && html`<div class="stack" style="gap:8px">
      ${ideas.map((i) => html`<div class="idea">
        <div class="row between" style="align-items:flex-start"><b>${i.idea}</b>${i.price && html`<span class="pill gold">${i.price}</span>`}</div>
        ${i.why && html`<div class="small muted">${i.why}</div>`}
      </div>`)}
    </div>`}
    <${ErrorNote} error=${get.error} />
    <button class="btn gold block" disabled=${get.busy} onClick=${get.run}>
      ${get.busy ? "Thinking…" : ideas ? "✨ Different ideas" : "✨ Suggest gift ideas"}
    </button>
    <p class="small muted center">Ideas come from Google's Gemini AI. Only ${name}'s answers and the budget are shared, never names.</p>
  </div>`;
}

function MyMatch() {
  const g = useGroup();
  const match = g.gift.match;
  const recipient = g.profiles[match.recipient_id] || { display_name: "Someone" };
  const [revealedNow, setRevealedNow] = useState(false);
  const answers = useAsync(
    () => q(sb.from("twelve_questionnaires").select("answers, completed_at").eq("group_id", g.groupId)
      .eq("season", currentSeason()).eq("user_id", match.recipient_id).maybeSingle()),
    [match.recipient_id]
  );
  const setBought = useAction(async (value) => {
    await q(sb.from("twelve_matches").update({ bought: value }).eq("group_id", g.groupId)
      .eq("season", currentSeason()).eq("giver_id", match.giver_id));
    await g.reload();
  });

  const markRevealed = async () => {
    setRevealedNow(true);
    await sb.from("twelve_matches").update({ revealed_at: new Date().toISOString() })
      .eq("group_id", g.groupId).eq("season", currentSeason()).eq("giver_id", match.giver_id);
  };

  if (!match.revealed_at && !revealedNow) {
    return html`<section class="stack">
      <div class="section-label">Your match is ready</div>
      <${ScratchCard} recipient=${recipient} onRevealed=${markRevealed} />
    </section>`;
  }

  const hasAnswers = countAnswered(answers.data?.answers) > 0;
  return html`<section class="card stack">
    <div class="row">
      <${Avatar} profile=${recipient} size=${64} />
      <div class="grow">
        <div class="section-label">You're giving to</div>
        <h2>${recipient.display_name}</h2>
      </div>
    </div>
    <label class="check-row">
      <input type="checkbox" checked=${match.bought} disabled=${setBought.busy} onChange=${(e) => setBought.run(e.currentTarget.checked)} />
      <span><b>Gift bought</b><br /><span class="small muted">Just for you — nobody else sees this.</span></span>
    </label>
    <div style="border-top:1px solid var(--line);padding-top:8px">
      <div class="section-label">About ${recipient.display_name}</div>
      ${answers.loading && html`<${Spinner} />`}
      ${!answers.loading && !hasAnswers && html`<p class="muted" style="padding:12px 0">${recipient.display_name} hasn't filled out their questionnaire yet. We'll keep nudging them.</p>`}
      ${hasAnswers && html`<${AnswerSummary} answers=${answers.data.answers} name=${recipient.display_name} />`}
    </div>
    ${hasAnswers && html`<${GiftIdeas} groupId=${g.groupId} name=${recipient.display_name} />`}
    <a class="btn ghost block" href=${`#/g/${g.groupId}/gifts/ask`}>🤫 Ask ${recipient.display_name} anonymously</a>
  </section>`;
}

function SantaInboxCard() {
  const g = useGroup();
  const inbox = useAsync(() => rpc("twelve_anon_inbox", { p_group: g.groupId }), [g.groupId]);
  const count = (inbox.data || []).filter((m) => !m.from_me).length;
  return html`<a class="card card-link row" href=${`#/g/${g.groupId}/gifts/santa`}>
    <div style="font-size:2rem">🎅</div>
    <div class="grow">
      <h3>Your Secret Santa</h3>
      <p class="small muted">${count ? `${count} ${count === 1 ? "question" : "questions"} from whoever drew your name` : "If whoever drew your name has a question, it shows up here."}</p>
    </div>
    ${count > 0 && html`<span class="pill red">${count}</span>`}
  </a>`;
}

// ---------- Questionnaire (one question at a time) ----------

export function Questionnaire() {
  const g = useGroup();
  const { user } = useApp();
  const [answers, setAnswers] = useState(() => normalize(g.gift.questionnaire?.answers));
  const firstEmpty = QUESTIONS.findIndex((q) => !isAnswered(q, answers[q.id]));
  const [index, setIndex] = useState(firstEmpty === -1 ? 0 : firstEmpty);
  const [finished, setFinished] = useState(false);

  const save = useAction(async (next, complete) => {
    const row = {
      group_id: g.groupId,
      season: currentSeason(),
      user_id: user.id,
      answers: next,
      updated_at: new Date().toISOString(),
    };
    if (complete) row.completed_at = new Date().toISOString();
    await q(sb.from("twelve_questionnaires").upsert(row, { onConflict: "group_id,season,user_id" }));
    return true;
  });

  const saveAndExit = async (e) => {
    e.preventDefault();
    if (!(await save.run(answers, Boolean(g.gift.questionnaire?.completed_at)))) return;
    await g.reload();
    location.hash = `#/g/${g.groupId}/gifts`;
  };
  const go = (i) => {
    setIndex(i);
    window.scrollTo(0, 0);
  };
  const advance = async () => {
    const last = index === QUESTIONS.length - 1;
    const complete = last || Boolean(g.gift.questionnaire?.completed_at);
    if (!(await save.run(answers, complete))) return;
    if (last) {
      await g.reload();
      setFinished(true);
      window.scrollTo(0, 0);
    } else {
      go(index + 1);
    }
  };

  if (finished) {
    return html`<div class="panel-page"><div class="panel-body stack-lg">
      <div class="center stack" style="padding-top:40px">
        <div style="font-size:4rem">🎉</div>
        <h1>All done!</h1>
        <p class="muted">Here's what your Secret Santa will see once names are drawn. You can come back and change it any time.</p>
      </div>
      <section class="card stack">
        <div class="section-label">About you</div>
        <${AnswerSummary} answers=${answers} name="Your" />
      </section>
      <a class="btn block" href=${`#/g/${g.groupId}/gifts`}>Back to the exchange</a>
    </div></div>`;
  }

  const question = QUESTIONS[index];
  const progress = ((index + 1) / QUESTIONS.length) * 100;
  const answered = isAnswered(question, answers[question.id]);
  return html`<div class="panel-page">
    <div class="panel-body stack-lg">
      <${BackLink} href=${`#/g/${g.groupId}/gifts`} label="Save & exit" onClick=${saveAndExit} />
      <div class="stack">
        <div class="row between small"><b>Question ${index + 1} of ${QUESTIONS.length}</b><span class="muted">Only your Secret Santa sees this</span></div>
        <div class="progress" role="progressbar" aria-valuenow=${index + 1} aria-valuemin="1" aria-valuemax=${QUESTIONS.length}><div style=${`width:${progress}%`}></div></div>
      </div>
      <div class="stack" style="gap:6px">
        <h1 style="font-size:1.7rem;text-wrap:balance">${question.title}</h1>
        ${question.sub && html`<p class="muted">${question.sub}</p>`}
      </div>
      <${QuestionInput} question=${question} value=${answers[question.id]}
        onChange=${(v) => setAnswers({ ...answers, [question.id]: v })} />
      <${ErrorNote} error=${save.error} />
      <div class="row">
        ${index > 0 && html`<button class="btn ghost" onClick=${() => go(index - 1)}>Back</button>`}
        <button class="btn grow" disabled=${save.busy} onClick=${advance}>
          ${index === QUESTIONS.length - 1 ? "Finish" : answered ? "Next" : "Skip"}
        </button>
      </div>
    </div>
  </div>`;
}

// ---------- Anonymous Q&A ----------

function Thread({ title, subtitle, messages, loading, onSend, placeholder, backHref, theirLabel }) {
  const [text, setText] = useState("");
  const bottom = useRef(null);
  const send = useAction(async () => {
    await onSend(text.trim());
    setText("");
  });
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages?.length]);

  return html`<div>
    <header class="topbar"><${BackLink} href=${backHref} /></header>
    <main class="page no-tabs stack-lg" style="padding-top:0">
      <div class="stack"><h1>${title}</h1><p class="muted">${subtitle}</p></div>
      ${loading && html`<${Spinner} />`}
      <div class="chat">
        ${(messages || []).map((m) => html`<div class=${"msg" + (m.mine ? " mine" : "")}>
          <div>
            ${!m.mine && html`<div class="who">${theirLabel}</div>`}
            <div class="bubble">${m.body}</div>
            <div class="when">${formatTime(m.created_at)}</div>
          </div>
        </div>`)}
      </div>
      <${ErrorNote} error=${send.error} />
      <div class="chat-pad" ref=${bottom}></div>
    </main>
    <div class="composer no-tabs">
      <form onSubmit=${(e) => { e.preventDefault(); if (text.trim()) send.run(); }}>
        <textarea rows="1" maxlength="1000" placeholder=${placeholder} value=${text} aria-label="Message"
          onInput=${(e) => setText(e.currentTarget.value)}></textarea>
        <button class="btn" disabled=${!text.trim() || send.busy}>Send</button>
      </form>
    </div>
  </div>`;
}

function usePolling(load, ms = 8000) {
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === "visible" && load(true), ms);
    return () => clearInterval(id);
  }, [load]);
}

// The giver's side: they know who they're talking to.
export function AskThread() {
  const g = useGroup();
  const match = g.gift.match;
  const data = useAsync(
    () => q(sb.from("twelve_anon_messages").select("id, from_giver, body, created_at").eq("group_id", g.groupId)
      .eq("season", currentSeason()).order("created_at")),
    [g.groupId]
  );
  usePolling(data.reload);
  if (!match) return html`<div class="page no-tabs"><p>Names haven't been drawn yet.</p></div>`;
  const name = g.profiles[match.recipient_id]?.display_name || "your giftee";
  return html`<${Thread}
    title=${`Ask ${name}`}
    subtitle=${`${name} sees your messages from “Your Secret Santa” — never your name. Ask away!`}
    messages=${(data.data || []).map((m) => ({ ...m, mine: m.from_giver }))}
    loading=${data.loading && !data.data}
    theirLabel=${name}
    placeholder="Which scent did you mean?"
    backHref=${`#/g/${g.groupId}/gifts`}
    onSend=${async (body) => { await rpc("twelve_send_anon", { p_group: g.groupId, p_as_giver: true, p_body: body }); await data.reload(true); }}
  />`;
}

// The recipient's side: they never learn who's asking.
export function SantaThread() {
  const g = useGroup();
  const data = useAsync(() => rpc("twelve_anon_inbox", { p_group: g.groupId }), [g.groupId]);
  usePolling(data.reload);
  return html`<${Thread}
    title="Your Secret Santa 🎅"
    subtitle="Whoever drew your name can ask you questions here. You'll never see who it is — just answer honestly!"
    messages=${(data.data || []).map((m) => ({ ...m, mine: m.from_me }))}
    loading=${data.loading && !data.data}
    theirLabel="Your Secret Santa"
    placeholder="Reply to your Secret Santa…"
    backHref=${`#/g/${g.groupId}/gifts`}
    onSend=${async (body) => { await rpc("twelve_send_anon", { p_group: g.groupId, p_as_giver: false, p_body: body }); await data.reload(true); }}
  />`;
}
