// One shared chat per group. Only this season's messages show.
import { html, useState, useEffect, useRef } from "../vendor/preact-htm.mjs";
import { sb, q, currentSeason } from "../lib/db.js";
import { useApp, useGroup } from "../lib/state.js";
import { Avatar, ErrorNote, Spinner, useAction, formatTime } from "../lib/ui.js";

const PAGE = 100;

export function Chat() {
  const g = useGroup();
  const { user } = useApp();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState("");
  const bottom = useRef(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const rows = await q(sb.from("twelve_chat_messages").select("*").eq("group_id", g.groupId)
          .eq("season", currentSeason()).order("created_at", { ascending: false }).limit(PAGE));
        if (alive) setMessages(rows.reverse());
      } catch (e) {
        if (alive) setError(e);
      }
    };
    load();
    const channel = sb
      .channel("chat-" + g.groupId)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "twelve_chat_messages", filter: `group_id=eq.${g.groupId}` },
        (payload) => setMessages((list) => (list && !list.some((m) => m.id === payload.new.id) ? [...list, payload.new] : list)))
      .subscribe();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      sb.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [g.groupId]);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages?.length]);

  const send = useAction(async () => {
    const body = text.trim();
    const row = await q(sb.from("twelve_chat_messages").insert({ group_id: g.groupId, body }).select().single());
    setText("");
    setMessages((list) => (list.some((m) => m.id === row.id) ? list : [...list, row]));
  });

  return html`<main class="page stack">
    <${ErrorNote} error=${error} />
    ${!messages && !error && html`<${Spinner} />`}
    ${messages && messages.length === 0 && html`<div class="empty"><div class="big">💬</div><p>Say hi to ${g.group.name}! Trash talk about the leaderboard is encouraged.</p></div>`}
    <div class="chat">
      ${(messages || []).map((m, i) => {
        const mine = m.user_id === user.id;
        const profile = g.profiles[m.user_id] || { display_name: "Someone" };
        const sameAsPrev = messages[i - 1]?.user_id === m.user_id;
        return html`<div class=${"msg" + (mine ? " mine" : "")} key=${m.id}>
          ${!mine && (sameAsPrev ? html`<div style="width:30px"></div>` : html`<${Avatar} profile=${profile} size=${30} />`)}
          <div>
            ${!mine && !sameAsPrev && html`<div class="who">${profile.display_name}</div>`}
            <div class="bubble">${m.body}</div>
            ${messages[i + 1]?.user_id !== m.user_id && html`<div class="when">${formatTime(m.created_at)}</div>`}
          </div>
        </div>`;
      })}
    </div>
    <${ErrorNote} error=${send.error} />
    <div class="chat-pad" ref=${bottom}></div>
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
