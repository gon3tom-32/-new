import { html, render, useState, useEffect } from "./vendor/preact-htm.mjs";
import { sb, storage } from "./lib/db.js";
import { AppContext, GroupContext, useApp, useRoute, useAppState, useGroupState, go } from "./lib/state.js";
import { Spinner, ErrorNote, Toaster, Sheet, Avatar, Icons } from "./lib/ui.js";
import { registerServiceWorker } from "./lib/push.js";
import { Welcome, CodeEntry, SignIn, ProfileForm, CreateGroup, NoGroup, continueOnboarding } from "./screens/onboarding.js";
import { Home } from "./screens/home.js";
import { Leaderboard } from "./screens/leaderboard.js";
import { Gifts, Questionnaire, AskThread, SantaThread } from "./screens/gifts.js";
import { Chat } from "./screens/chat.js";
import { Settings } from "./screens/settings.js";
import { Inbox, Me } from "./screens/account.js";
import { DayScreen } from "./games/day.js";

function useUnreadCount(userId) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    const load = async () => {
      const { count: n } = await sb
        .from("twelve_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null);
      setCount(n || 0);
    };
    load();
    const channel = sb
      .channel("notifications-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: "twelve_notifications", filter: `user_id=eq.${userId}` }, load)
      .subscribe();
    window.addEventListener("twelve:notifications-read", load);
    return () => {
      sb.removeChannel(channel);
      window.removeEventListener("twelve:notifications-read", load);
    };
  }, [userId]);
  return count;
}

function GroupSwitcher({ open, onClose, current }) {
  const app = useApp();
  return html`<${Sheet} open=${open} onClose=${onClose} label="Your groups">
    <div class="stack">
      <div class="row">
        <${Avatar} profile=${app.profile} size=${44} />
        <div class="grow">
          <div style="font-weight:700">${app.profile?.display_name}</div>
          <div class="small muted">${app.user?.email}</div>
        </div>
        <a class="btn ghost small" href="#/me" onClick=${onClose}>Profile</a>
      </div>
      <div class="section-label" style="margin-top:8px">Your groups</div>
      <div class="list card" style="padding:4px 16px">
        ${(app.groups || []).map((g) => html`<a class="list-item" style="text-decoration:none" href=${`#/g/${g.id}/home`} onClick=${onClose}>
          <div class="grow" style="font-weight:700">${g.name}</div>
          ${g.id === current && html`<span class="pill green">Open</span>`}
          ${g.host_id === app.user?.id && html`<span class="pill gold">Host</span>`}
        </a>`)}
      </div>
      <a class="btn ghost block" href="#/code" onClick=${onClose}>Join another group</a>
      <button class="btn ghost block" onClick=${() => { onClose(); storage.set("pendingCreate", true); go("/create"); }}>Start a new group</button>
    </div>
  <//>`;
}

const TABS = [
  ["home", "Home", Icons.home],
  ["board", "Leaderboard", Icons.trophy],
  ["gifts", "Gifts", Icons.gift],
  ["chat", "Chat", Icons.chat],
];

function GroupShell({ groupId, rest }) {
  const app = useApp();
  const group = useGroupState(groupId);
  const [switcher, setSwitcher] = useState(false);
  const unread = useUnreadCount(app.user?.id);
  const [section, sub] = rest;

  if (group.loading && !group.group) return html`<${Spinner} />`;
  if (group.missing) {
    return html`<div class="page no-tabs stack-lg">
      <h1>Group not found</h1>
      <p class="muted">You may have been removed from this group, or the link is wrong.</p>
      <button class="btn" onClick=${() => { storage.set("lastGroup", null); continueOnboarding(app); }}>Go to my groups</button>
    </div>`;
  }
  if (group.error && !group.group) return html`<div class="page no-tabs"><${ErrorNote} error=${group.error} retry=${group.reload} /></div>`;

  let screen;
  let tab = section;
  let showTabs = true;
  switch (section) {
    case "board": screen = html`<${Leaderboard} />`; break;
    case "gifts":
      if (sub === "questions") { screen = html`<${Questionnaire} />`; showTabs = false; }
      else if (sub === "ask") { screen = html`<${AskThread} />`; showTabs = false; }
      else if (sub === "santa") { screen = html`<${SantaThread} />`; showTabs = false; }
      else screen = html`<${Gifts} />`;
      break;
    case "chat": screen = html`<${Chat} />`; break;
    case "settings": screen = html`<${Settings} />`; tab = null; break;
    case "day": screen = html`<${DayScreen} day=${Number(sub)} key=${sub} />`; tab = "home"; break;
    default: screen = html`<${Home} />`; tab = "home";
  }

  return html`<${GroupContext.Provider} value=${group}>
    ${showTabs && html`<header class="topbar">
      <a class="brand" href=${`#/g/${groupId}/home`} aria-label="Twelve — go to Home">
        <img src="icons/icon.svg" alt="" width="34" height="34" />
        <span class="brand-word">Twelve<span class="dot">.</span></span>
      </a>
      <button class="group-chip" onClick=${() => setSwitcher(true)} aria-label=${`${group.group.name} — switch group`}>
        <span>${group.group.name}</span><span class="chev" aria-hidden="true">▾</span>
      </button>
      <a class="icon-btn" href="#/inbox" aria-label=${unread ? `${unread} unread notifications` : "Notifications"}>
        ${Icons.bell()}${unread > 0 && html`<span class="badge-dot">${unread > 9 ? "9+" : unread}</span>`}
      </a>
    </header>`}
    ${screen}
    ${showTabs && html`<nav class="tabbar" aria-label="Main">
      <div class="tabbar-inner">
        ${TABS.map(([key, label, icon]) => html`<a class=${"tab" + (tab === key ? " active" : "")} href=${`#/g/${groupId}/${key}`}
          aria-current=${tab === key ? "page" : null}>${icon()}<span>${label}</span></a>`)}
      </div>
    </nav>`}
    <${GroupSwitcher} open=${switcher} onClose=${() => setSwitcher(false)} current=${groupId} />
  <//>`;
}

function Router() {
  const app = useApp();
  const parts = useRoute();
  const [head, ...rest] = parts;

  // Pages that work signed out.
  if (head === "welcome") return html`<${Welcome} />`;
  if (head === "code") return html`<${CodeEntry} />`;
  if (head === "join" && rest[0]) return html`<${CodeEntry} code=${rest[0]} key=${rest[0]} />`;
  if (head === "signin") return html`<${SignIn} />`;

  if (app.loading) return html`<${Spinner} />`;
  if (!app.user) {
    // Returning from a magic link lands here before the session is ready.
    return html`<${Redirect} to=${storage.get("pendingCode") || storage.get("pendingCreate") ? "/signin" : "/welcome"} />`;
  }
  if (!app.profile && head !== "profile") return html`<${Redirect} to="/profile" />`;

  switch (head) {
    case "profile": return html`<${ProfileForm} />`;
    case "create": return html`<${CreateGroup} />`;
    case "join": return html`<${NoGroup} />`;
    case "inbox": return html`<${Inbox} />`;
    case "me": return rest[0] === "edit" ? html`<${ProfileForm} editing />` : html`<${Me} />`;
    case "g": return html`<${GroupShell} groupId=${rest[0]} rest=${rest.slice(1)} key=${rest[0]} />`;
    default: return html`<${Landing} />`;
  }
}

function Redirect({ to }) {
  useEffect(() => go(to), [to]);
  return html`<${Spinner} />`;
}

function Landing() {
  const app = useApp();
  const [error, setError] = useState(null);
  useEffect(() => {
    continueOnboarding(app).catch((e) => {
      storage.set("pendingCode", null);
      setError(e);
    });
  }, []);
  if (error) {
    return html`<div class="page no-tabs stack-lg">
      <${ErrorNote} error=${error} />
      <button class="btn" onClick=${() => { setError(null); continueOnboarding(app).catch(setError); }}>Continue</button>
    </div>`;
  }
  return html`<${Spinner} />`;
}

function App() {
  const app = useAppState();
  return html`<${AppContext.Provider} value=${app}>
    <${Router} />
    <${Toaster} />
  <//>`;
}

render(html`<${App} />`, document.getElementById("app"));
registerServiceWorker();
