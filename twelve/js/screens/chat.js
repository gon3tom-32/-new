// One shared chat per group. Only this season's messages show.
import { html, useState, useEffect, useRef, useCallback } from "../vendor/preact-htm.mjs";
import { sb, q, currentSeason } from "../lib/db.js";
import { useApp, useGroup } from "../lib/state.js";
import { Avatar, ErrorNote, Spinner, useAction, formatTime } from "../lib/ui.js";

const PAGE = 100;
// Must match the list in twelve_chat_reactions' check constraint.
export const REACTIONS = ["❤️", "😂", "😮", "👍", "🎄"];

// Reactions grouped by message: { [messageId]: { [userId]: emoji } }.
function groupReactions(rows) {
  const out = {};
  for (const r of rows) (out[r.message_id] ||= {})[r.user_id] = r.emoji;
  return out;
}

function Reactions({ mine, byUser, profiles, onPick }) {
  const counts = REACTIONS.map((e) => [e, Object.values(byUser || {}).filter((x) => x === e).length]).filter(([, n]) => n);
  if (!counts.length) return null;
  return html`<div class="reactions">
    ${counts.map(([emoji, n]) => {
      const names = Object.entries(byUser).filter(([, e]) => e === emoji).map(([id]) => profiles[id]?.display_name || "Someone");
      return html`<button class=${"reaction" + (mine === emoji ? " mine" : "")} title=${names.join(", ")}
        aria-label=${`${emoji} ${n}: ${names.join(", ")}`} aria-pressed=${mine === emoji} onClick=${() => onPick(emoji)}>
        ${emoji}<span>${n}</span>
      </button>`;
    })}
  </div>`;
}

export function Chat() {
  const g = useGroup();
  const { user } = useApp();
  const [messages, setMessages] = useState(null);
  const [reactions, setReactions] = useState({});
  // Reactions stay hidden if the database hasn't been updated for them yet.
  const [reactionsOn, setReactionsOn] = useState(true);
  const [picker, setPicker] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const bottom = useRef(null);
  const oldestId = useRef(null);

  const loadReactions = useCallback(async () => {
    if (oldestId.current == null) return;
    const { data, error: e } = await sb.from("twelve_chat_reactions").select("message_id, user_id, emoji")
      .eq("group_id", g.groupId).gte("message_id", oldestId.current);
    if (e) return setReactionsOn(false);
    setReactions(groupReactions(data));
  }, [g.groupId]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await q(sb.from("twelve_chat_messages").select("*").eq("group_id", g.groupId)
          .eq("season", currentSeason()).order("created_at", { ascending: false }).limit(PAGE));
        if (!alive) return;
        oldestId.current = rows.length ? rows[rows.length - 1].id : 0;
        setMessages(rows.reverse());
        loadReactions();
      } catch (e) {
        if (alive) setError(e);
      }
    };
    load();
    const channel = sb
      .channel("chat-" + g.groupId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twelve_chat_messages", filter: `group_id=eq.${g.groupId}` },
        (payload) => setMessages((list) => (list && !list.some((m) => m.id === payload.new.id) ? [...list, payload.new] : list)))
      .on("postgres_changes", { event: "*", schema: "public", table: "twelve_chat_reactions", filter: `group_id=eq.${g.groupId}` },
        () => loadReactions())
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      sb.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [g.groupId]);

  // Jump to the newest message, but only once the chat is longer than the
  // screen (otherwise a short chat would scroll under the header).
  useEffect(() => {
    const el = bottom.current;
    if (el && el.getBoundingClientRect().bottom > window.innerHeight) el.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // Close the emoji picker when tapping anywhere else.
  useEffect(() => {
    if (picker == null) return;
    const close = (e) => !e.target.closest(".msg-react-zone") && setPicker(null);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [picker]);

  const send = useAction(async () => {
    const body = text.trim();
    const row = await q(sb.from("twelve_chat_messages").insert({ group_id: g.groupId, body }).select().single());
    setText("");
    setMessages((list) => (list.some((m) => m.id === row.id) ? list : [...list, row]));
  });

  // Tap the same emoji to remove yours; a different one replaces it.
  const react = async (messageId, emoji) => {
    setPicker(null);
    const current = reactions[messageId]?.[user.id];
    const next = current === emoji ? null : emoji;
    setReactions((all) => {
      const forMsg = { ...(all[messageId] || {}) };
      if (next) forMsg[user.id] = next;
      else delete forMsg[user.id];
      return { ...all, [messageId]: forMsg };
    });
    const { error: e } = next
      ? await sb.from("twelve_chat_reactions").upsert(
          { message_id: messageId, user_id: user.id, group_id: g.groupId, emoji: next },
          { onConflict: "message_id,user_id" })
      : await sb.from("twelve_chat_reactions").delete().eq("message_id", messageId).eq("user_id", user.id);
    if (e) loadReactions();
  };

  return html`<main class="page stack">
    <${ErrorNote} error=${error} />
    ${!messages && !error && html`<${Spinner} />`}
    ${messages && messages.length === 0 && html`<div class="empty"><div class="big">💬</div><p>Say hi to ${g.group.name}! Trash talk about the leaderboard is encouraged.</p></div>`}
    ${messages && messages.length > 0 && reactionsOn && html`<p class="small muted center">Tap a message to react.</p>`}
    <div class="chat">
      ${(messages || []).map((m, i) => {
        const mine = m.user_id === user.id;
        const profile = g.profiles[m.user_id] || { display_name: "Someone" };
        const sameAsPrev = messages[i - 1]?.user_id === m.user_id;
        const byUser = reactions[m.id];
        return html`<div class=${"msg" + (mine ? " mine" : "")} key=${m.id}>
          ${!mine && (sameAsPrev ? html`<div style="width:30px"></div>` : html`<${Avatar} profile=${profile} size=${30} />`)}
          <div class="msg-react-zone">
            ${!mine && !sameAsPrev && html`<div class="who">${profile.display_name}</div>`}
            ${picker === m.id && html`<div class="reaction-picker" role="toolbar" aria-label="React to this message">
              ${REACTIONS.map((e) => html`<button class=${byUser?.[user.id] === e ? "on" : ""} aria-label=${`React with ${e}`}
                onClick=${() => react(m.id, e)}>${e}</button>`)}
            </div>`}
            <div class="bubble" role=${reactionsOn ? "button" : null} tabindex=${reactionsOn ? 0 : null}
              onClick=${() => reactionsOn && setPicker(picker === m.id ? null : m.id)}
              onKeyDown=${(e) => reactionsOn && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setPicker(picker === m.id ? null : m.id))}>${m.body}</div>
            <${Reactions} mine=${byUser?.[user.id]} byUser=${byUser} profiles=${g.profiles} onPick=${(e) => react(m.id, e)} />
            ${messages[i + 1]?.user_id !== m.user_id && html`<div class="when">${formatTime(m.created_at)}</div>`}
          </div>
        </div>`;
      })}
    </div>
    <${ErrorNote} error=${send.error} />
    <div class="chat-pad with-tabs" ref=${bottom}></div>
    <div class="composer">
      <form onSubmit=${(e) => { e.preventDefault(); if (text.trim()) send.run(); }}>
        <textarea rows="1" maxlength="1000" placeholder="Message the group…" value=${text} aria-label="Message"
          onInput=${(e) => setText(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) { e.preventDefault(); if (text.trim()) send.run(); } }}></textarea>
        <button class="btn" disabled=${!text.trim() || send.busy}>Send</button>
      </form>
    </div>
  </main>`;
}
