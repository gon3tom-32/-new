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
    </form>
  <//>`;
}

// ---------- Sign in (email magic link + 6-digit code) ----------

export function SignIn() {
  const app = useApp();
  const [email, setEmail] = useState(storage.get("email", ""));
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");

  // Once signed in (and their profile and groups have loaded), move on.
  useEffect(() => {
    if (app.user && !app.loading) continueOnboarding(app);
  }, [app.user, app.loading]);

  const send = useAction(async () => {
    storage.set("email", email.trim());
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true },
    });
    if (error) throw friendly(error);
    setSent(true);
  });
  const verify = useAction(async () => {
    const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
    if (error) throw new Error("That code didn't work. Check it, or send a new one.");
  });

  if (sent) {
    return html`<${PanelPage} title="Check your email 📬" subtitle=${`We sent a sign-in link to ${email}.`}>
      <div class="stack-lg">
        <p>Tap the link in the email to sign in. Or, if the email shows a code, type it here — handy if the link opens in a different browser.</p>
        <form class="stack" onSubmit=${(e) => { e.preventDefault(); verify.run(); }}>
          <input class="input code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"
            value=${token} onInput=${(e) => setToken(e.currentTarget.value.replace(/\D/g, "").slice(0, 10))} aria-label="Code from the email" />
          <${ErrorNote} error=${verify.error} />
          <button class="btn block" disabled=${token.length < 6 || verify.busy}>${verify.busy ? "Signing in…" : "Sign in with code"}</button>
        </form>
        <p class="center small muted">
          Nothing yet? Check spam, or${" "}
          <button class="link-btn" onClick=${() => { setSent(false); setToken(""); }}>use a different email</button>
        </p>
      </div>
    <//>`;
  }

  return html`<${PanelPage} back="#/code" title="What's your email?" subtitle="No passwords. We'll email you a link to sign in.">
    <form class="stack-lg" onSubmit=${(e) => { e.preventDefault(); send.run(); }}>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" class="input" type="email" autocomplete="email" required placeholder="you@example.com"
          value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} />
      </div>
      <${ErrorNote} error=${send.error} />
      <button class="btn block" disabled=${!email.includes("@") || send.busy}>${send.busy ? "Sending…" : "Email me a link"}</button>
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
