// First-run flow: explainer slides → invite code → sign in → profile → group.
// Starting a new group follows the same path with "create" in place of a code.
import { html, useState, useEffect, useRef } from "../vendor/preact-htm.mjs";
import { sb, rpc, friendly, uploadAvatar, storage } from "../lib/db.js";
import { useApp, go } from "../lib/state.js";
import { Avatar, ErrorNote, useAction, Icons, Switch, BackLink } from "../lib/ui.js";

// Where to send someone next, based on what they've done so far.
export async function continueOnboarding(app) {
  const pendingCode = storage.get("pendingCode");
  const pendingCreate = storage.get("pendingCreate");
  if (!app.user) return go(pendingCode || pendingCreate ? "/signin" : "/welcome");
  if (!app.profile) return go("/profile");
  if (pendingCode) {
    const groupId = await rpc("twelve_join_group", { p_code: pendingCode });
    storage.set("pendingCode", null);
    await app.refreshGroups();
    return go(`/g/${groupId}/home`);
  }
  if (pendingCreate) return go("/create");
  const groups = app.groups || [];
  const last = storage.get("lastGroup");
  const target = groups.find((g) => g.id === last) || groups[0];
  return go(target ? `/g/${target.id}/home` : "/join");
}

// Returning members (new phone, signed out) go straight to sign-in and
// land back in their groups. Clear any half-finished join or create.
function signInExisting() {
  storage.set("pendingCode", null);
  storage.set("pendingCreate", null);
  go("/signin");
}

function PanelPage({ back, title, subtitle, children }) {
  return html`<div class="panel-page">
    <div class="panel-head">
      ${back && html`<${BackLink} href=${back} />`}
      <h1>${title}</h1>
      ${subtitle && html`<p>${subtitle}</p>`}
    </div>
    <div class="panel-body">${children}</div>
  </div>`;
}

// ---------- Explainer slides ----------

const SLIDES = [
  {
    cls: "",
    art: null,
    title: html`<div class="wordmark">Twelve<span class="dot">.</span></div>`,
    body: "The holiday app for your family, friends, or team. Two traditions, one place.",
  },
  {
    cls: "green",
    art: "🎁",
    title: html`<h1>Secret Santa, but better</h1>`,
    body: html`<div class="feature-list">
      <div><span>✨</span><span><b>Scratch to reveal</b>See who you drew, privately.</span></div>
      <div><span>💬</span><span><b>Ask anonymously</b>Message your giftee without giving yourself away.</span></div>
      <div><span>🧭</span><span><b>No more guessing</b>A quick questionnaire tells you what they'd love.</span></div>
    </div>`,
  },
  {
    cls: "pine",
    art: "🎄",
    title: html`<h1>12 Days of Games</h1>`,
    body: html`<div class="feature-list">
      <div><span>🔓</span><span><b>A new game every day</b>Trivia, bingo, scavenger hunts and more.</span></div>
      <div><span>⏳</span><span><b>Play anytime in 24 hours</b>Everyone gets the same game, on their own time.</span></div>
      <div><span>👑</span><span><b>Crown a champion</b>Leaderboards build to a Day 12 finale.</span></div>
    </div>`,
  },
];

export function Welcome() {
  const [index, setIndex] = useState(0);
  const track = useRef(null);
  const last = index === SLIDES.length - 1;

  const onScroll = () => {
    const el = track.current;
    setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const next = () => {
    if (last) return go("/code");
    track.current.scrollTo({ left: (index + 1) * track.current.clientWidth, behavior: "smooth" });
  };

  return html`<div class=${"onboard " + (SLIDES[index].cls ? "slide " + SLIDES[index].cls : "")} style="padding:0">
    <div class="slides" ref=${track} onScroll=${onScroll}>
      ${SLIDES.map((s) => html`<section class=${"slide " + s.cls}>
        ${s.art && html`<div class="slide-art" aria-hidden="true">${s.art}</div>`}
        ${s.title}
        ${typeof s.body === "string" ? html`<p>${s.body}</p>` : s.body}
      </section>`)}
    </div>
    <div class="onboard-foot">
      <div class="dots" aria-hidden="true">${SLIDES.map((_, i) => html`<span class=${i === index ? "on" : ""}></span>`)}</div>
      <button class="btn white block" onClick=${next}>${last ? "I have an invite code" : "Next"}</button>
      <div class="center small">
        ${last
          ? html`<button class="link-btn" style="color:#fff" onClick=${() => { storage.set("pendingCreate", true); go("/signin"); }}>Starting a group? Create one</button>`
          : html`<button class="link-btn" style="color:#fff" onClick=${() => go("/code")}>Skip</button>`}
      </div>
      <div class="center small" style="opacity:0.9">
        Already in a group?${" "}
        <button class="link-btn" style="color:#fff" onClick=${signInExisting}>Sign in</button>
      </div>
    </div>
  </div>`;
}

// ---------- Invite code ----------

export function CodeEntry({ code: initial = "" }) {
  const app = useApp();
  const [code, setCode] = useState(initial.toUpperCase());
  const [found, setFound] = useState(null);
  const action = useAction(async () => {
    const rows = await rpc("twelve_peek_invite", { p_code: code });
    if (!rows?.length) throw new Error("That code doesn't match any group. Check it and try again.");
    setFound(rows[0]);
  });
  const join = useAction(async () => {
    storage.set("pendingCode", code);
    storage.set("pendingCreate", null);
    await continueOnboarding(app);
  });

  useEffect(() => {
    if (initial.length === 6) action.run();
  }, []);

  const clean = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

  if (found) {
    return html`<${PanelPage} title="You're invited!" subtitle="Here's the group you're about to join.">
      <div class="stack-lg">
        <div class="card center stack">
          <div style="font-size:3rem">🎉</div>
          <h2>${found.name}</h2>
          <p class="muted">Hosted by ${found.host_name || "someone"} · ${found.member_count} ${found.member_count === 1 ? "member" : "members"}</p>
        </div>
        <${ErrorNote} error=${join.error} />
        <button class="btn block" disabled=${join.busy} onClick=${join.run}>Join ${found.name}</button>
        <button class="btn ghost block" onClick=${() => setFound(null)}>Use a different code</button>
      </div>
    <//>`;
  }

  return html`<${PanelPage} back=${app.user ? "#/" : "#/welcome"} title="Enter your invite code" subtitle="Your host has a six-character code for your group.">
    <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); action.run(); }}>
      <div class="field">
        <label for="code" class="sr-only">Invite code</label>
        <input id="code" class="input code" autocomplete="off" autocapitalize="characters" spellcheck="false"
          inputmode="text" placeholder="ABC123" value=${code} onInput=${(e) => setCode(clean(e.currentTarget.value))} />
      </div>
      <${ErrorNote} error=${action.error} />
      <button class="btn block" disabled=${code.length !== 6 || action.busy}>${action.busy ? "Checking…" : "Continue"}</button>
      <p class="center small muted">
        Hosting this year?${" "}
        <button type="button" class="link-btn" onClick=${() => { storage.set("pendingCreate", true); storage.set("pendingCode", null); continueOnboarding(app); }}>Start a new group</button>
      </p>
      ${!app.user && html`<p class="center small muted">
        Already in a group?${" "}
        <button type="button" class="link-btn" onClick=${signInExisting}>Sign in</button>
      </p>`}
    </form>
  <//>`;
}

// ---------- Sign in (email magic link + 6-digit code) ----------

const RESEND_WAIT = 60; // seconds; Supabase allows one email per minute per address

function signInError(error) {
  const message = error?.message || "";
  if (/rate limit/i.test(message)) return new Error("Too many sign-in emails were sent just now. Please wait a few minutes and try again.");
  if (/only request this after (\d+) seconds?/i.test(message)) {
    return new Error(`Please wait ${message.match(/after (\d+) seconds?/i)[1]} seconds before asking for another code.`);
  }
  if (/invalid.*email|email.*invalid/i.test(message)) return new Error("That email address doesn't look right. Check it and try again.");
  return friendly(error);
}

export function SignIn() {
  const app = useApp();
  // Remember a code that's on its way, so switching to the Mail app (which
  // can reload Twelve on a phone) brings you straight back to the code box.
  const pending = storage.get("signinPending");
  const [email, setEmail] = useState(pending?.email || storage.get("email", ""));
  const [sentAt, setSentAt] = useState(pending?.sentAt || null);
  const [token, setToken] = useState("");
  const [now, setNow] = useState(Date.now());

  // Once signed in (and their profile and groups have loaded), move on.
  useEffect(() => {
    if (app.user && !app.loading) {
      storage.set("signinPending", null);
      continueOnboarding(app);
    }
  }, [app.user, app.loading]);

  // Tick the resend countdown.
  useEffect(() => {
    if (!sentAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sentAt]);

  const send = useAction(async () => {
    const address = email.trim().toLowerCase();
    storage.set("email", address);
    const { error } = await sb.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
    });
    if (error) throw signInError(error);
    const at = Date.now();
    setEmail(address);
    setSentAt(at);
    setNow(at);
    setToken("");
    storage.set("signinPending", { email: address, sentAt: at });
  });

  const verify = useAction(async (code) => {
    const { error } = await sb.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: "email" });
    if (error) {
      setToken("");
      // Supabase gives the same answer for a mistyped code and an expired one.
      throw new Error("That code didn't work. Check the numbers, or tap Resend code if it's more than an hour old.");
    }
  });

  const changeEmail = () => {
    storage.set("signinPending", null);
    setSentAt(null);
    setToken("");
  };

  if (sentAt) {
    const wait = Math.max(0, RESEND_WAIT - Math.floor((now - sentAt) / 1000));
    const onCode = (value) => {
      const digits = value.replace(/\D/g, "").slice(0, 10);
      setToken(digits);
      // Codes are 6 digits: sign in as soon as the last one is typed or pasted.
      if (digits.length === 6 && !verify.busy) verify.run(digits);
    };
    return html`<${PanelPage} title="Enter your code 📬" subtitle=${`We emailed a 6-digit code to ${email}.`}>
      <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); if (token.length >= 6) verify.run(token); }}>
        <div class="field">
          <label for="otp" class="sr-only">6-digit code</label>
          <input id="otp" class="input code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*"
            placeholder="••••••" autofocus value=${token} disabled=${verify.busy}
            onInput=${(e) => onCode(e.currentTarget.value)} aria-label="6-digit code from the email" />
        </div>
        <${ErrorNote} error=${verify.error || send.error} />
        <button class="btn block" disabled=${token.length < 6 || verify.busy}>${verify.busy ? "Signing in…" : "Sign in"}</button>
        <div class="row" style="justify-content:center;gap:16px">
          <button type="button" class="link-btn" disabled=${wait > 0 || send.busy} onClick=${() => send.run()}
            style=${wait > 0 ? "color:var(--ink-soft);text-decoration:none" : ""}>
            ${send.busy ? "Sending…" : wait > 0 ? `Resend code in ${wait}s` : "Resend code"}
          </button>
          <button type="button" class="link-btn" onClick=${changeEmail}>Change email</button>
        </div>
        <p class="center small muted">
          Can't find it? Check your spam folder. The email also has a sign-in link, which works if you open it on this same device.
        </p>
      </form>
    <//>`;
  }

  const joining = storage.get("pendingCode") || storage.get("pendingCreate");
  return html`<${PanelPage} back=${joining ? "#/code" : "#/welcome"} title="Sign in with your email"
    subtitle="No passwords. We'll email you a 6-digit code.">
    <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); send.run(); }}>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" class="input" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" required
          placeholder="you@example.com" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} />
      </div>
      <${ErrorNote} error=${send.error} />
      <button class="btn block" disabled=${!/^\S+@\S+\.\S+$/.test(email.trim()) || send.busy}>${send.busy ? "Sending…" : "Send my code"}</button>
    </form>
  <//>`;
}

// ---------- Profile (name + photo) ----------

export function ProfileForm({ editing }) {
  const app = useApp();
  const [name, setName] = useState(app.profile?.display_name || "");
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(app.profile?.avatar_url || null);

  const save = useAction(async () => {
    let avatar_url = app.profile?.avatar_url || null;
    if (photo) avatar_url = await uploadAvatar(app.user.id, photo);
    const { error } = await sb
      .from("twelve_profiles")
      .upsert({ id: app.user.id, display_name: name.trim(), avatar_url, updated_at: new Date().toISOString() });
    if (error) throw friendly(error);
    const profile = await app.refreshProfile();
    if (editing) return history.back();
    await continueOnboarding({ ...app, profile });
  });

  const onPick = (e) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  return html`<${PanelPage} back=${editing ? "#/me" : null} title=${editing ? "Your profile" : "Who are you?"}
    subtitle=${editing ? "Shared with everyone in your groups." : "Your name and photo, so your group knows it's you."}>
    <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); save.run(); }}>
      <div class="photo-picker">
        <label for="photo">
          <${Avatar} profile=${{ display_name: name || "?", avatar_url: preview }} size=${112} />
        </label>
        <label for="photo" class="btn ghost small">${Icons.camera()} ${preview ? "Change photo" : "Add a photo"}</label>
        <input id="photo" type="file" accept="image/*" class="sr-only" onChange=${onPick} />
      </div>
      <div class="field">
        <label for="name">Your name</label>
        <input id="name" class="input" maxlength="40" required placeholder="What should people call you?" autocomplete="given-name"
          value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </div>
      <${ErrorNote} error=${save.error} />
      <button class="btn block" disabled=${!name.trim() || save.busy}>${save.busy ? "Saving…" : editing ? "Save" : "Continue"}</button>
    </form>
  <//>`;
}

// ---------- Create a group ----------

export function CreateGroup() {
  const app = useApp();
  const [name, setName] = useState("");
  const [gifts, setGifts] = useState(true);
  const [games, setGames] = useState(true);
  const create = useAction(async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const id = await rpc("twelve_create_group", { p_name: name.trim(), p_gifts: gifts, p_games: games, p_timezone: timezone });
    storage.set("pendingCreate", null);
    await app.refreshGroups();
    go(`/g/${id}/home`);
  });

  return html`<${PanelPage} back=${app.groups?.length ? "#/" : null} title="Start a group" subtitle="You'll be the host. You can change any of this later.">
    <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); create.run(); }}>
      <div class="field">
        <label for="gname">Group name</label>
        <input id="gname" class="input" maxlength="60" required placeholder="The Smith Family, Team Elf…"
          value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </div>
      <div class="card">
        <div class="section-label">What are you doing this year?</div>
        <${Switch} label="🎁 Gift exchange" hint="Draw names, scratch to reveal, ask questions anonymously." checked=${gifts} onChange=${setGifts} />
        <${Switch} label="🎄 12 Days of Games" hint="A new game every day for twelve days in December." checked=${games} onChange=${setGames} />
      </div>
      ${!gifts && !games && html`<div class="note">Turn on at least one.</div>`}
      <${ErrorNote} error=${create.error} />
      <button class="btn block" disabled=${!name.trim() || (!gifts && !games) || create.busy}>${create.busy ? "Creating…" : "Create group"}</button>
    </form>
  <//>`;
}

// ---------- No group yet ----------

export function NoGroup() {
  return html`<${PanelPage} title="Welcome to Twelve" subtitle="You're not in a group yet.">
    <div class="stack">
      <a class="btn block" href="#/code">I have an invite code</a>
      <button class="btn ghost block" onClick=${() => { storage.set("pendingCreate", true); go("/create"); }}>Start a new group</button>
    </div>
  <//>`;
}
