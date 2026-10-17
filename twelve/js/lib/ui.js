// Small UI building blocks used across screens.
import { html, useState, useEffect, useRef, useCallback } from "../vendor/preact-htm.mjs";

export { html };

// ---------- Async data ----------

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true });
  const alive = useRef(true);
  const run = useCallback(async (quiet = false) => {
    if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (alive.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, deps);
  useEffect(() => {
    alive.current = true;
    run();
    return () => { alive.current = false; };
  }, [run]);
  return { ...state, reload: run };
}

// Ticks every `ms` so countdowns stay live.
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Wraps an async action with busy and error state for buttons.
export function useAction(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (...args) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      return await fn(...args);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, setError };
}

// ---------- Toast ----------

let toastListener = null;
export function toast(message) {
  toastListener?.(message);
}
export function Toaster() {
  const [message, setMessage] = useState(null);
  useEffect(() => {
    let timer;
    toastListener = (m) => {
      setMessage(m);
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2600);
    };
    return () => { toastListener = null; };
  }, []);
  return message ? html`<div class="toast" role="status">${message}</div>` : null;
}

// ---------- Bits ----------

export const Spinner = () => html`<div class="spinner" role="status" aria-label="Loading"></div>`;

export function ErrorNote({ error, retry }) {
  if (!error) return null;
  return html`<div class="error" role="alert">
    ${error.message || String(error)}
    ${retry && html` <button class="link-btn" onClick=${() => retry()}>Try again</button>`}
  </div>`;
}

const avatarColors = ["#E8173A", "#00A65A", "#FFB703", "#0B3D2A", "#FF6B35", "#7B2CBF"];
export function initials(name = "?") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
export function Avatar({ profile, size = 40 }) {
  const name = profile?.display_name || "?";
  const color = avatarColors[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % avatarColors.length];
  return html`<div class="avatar" style=${`width:${size}px;height:${size}px;font-size:${size * 0.4}px;background:${color}`}>
    ${profile?.avatar_url ? html`<img src=${profile.avatar_url} alt="" loading="lazy" />` : initials(name)}
  </div>`;
}

export function Sheet({ open, onClose, children, label }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label=${label}>
      <div class="sheet-grip"></div>
      ${children}
    </div>
  </div>`;
}

export function Switch({ checked, onChange, label, hint, disabled }) {
  return html`<label class="toggle-row">
    <div class="grow">
      <div style="font-weight:700">${label}</div>
      ${hint && html`<div class="small muted">${hint}</div>`}
    </div>
    <span class="switch">
      <input type="checkbox" role="switch" checked=${checked} disabled=${disabled}
        onChange=${(e) => onChange(e.currentTarget.checked)} />
      <span></span>
    </span>
  </label>`;
}

// ---------- Time ----------

export function splitDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function Countdown({ to, short }) {
  const now = useNow(1000);
  const { d, h, m, s } = splitDuration(new Date(to).getTime() - now);
  const units = d > 0 ? [[d, "days"], [h, "hrs"], [m, "min"]] : [[h, "hrs"], [m, "min"], [s, "sec"]];
  if (short) return html`<span>${units.map(([n, l]) => `${n}${l[0]}`).join(" ")}</span>`;
  return html`<div class="countdown" role="timer">
    ${units.map(([n, l]) => html`<div class="unit"><div class="num">${String(n).padStart(2, "0")}</div><div class="lbl">${l}</div></div>`)}
  </div>`;
}

export function timeLeft(to, now = Date.now()) {
  const { d, h, m } = splitDuration(new Date(to).getTime() - now);
  if (d > 1) return `${d} days`;
  if (d === 1) return `1 day ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export function formatDate(value, opts = { weekday: "long", month: "long", day: "numeric" }) {
  if (!value) return "";
  // Plain dates (2026-12-25) are calendar days, not instants.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : new Date(value);
  return d.toLocaleDateString(undefined, opts);
}

export function formatTime(value) {
  return new Date(value).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function daysUntil(dateString) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const target = new Date(dateString + "T12:00:00");
  return Math.round((target - today) / 86400000);
}

// ---------- Icons ----------

const icon = (paths) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const Icons = {
  home: () => icon(html`<path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />`),
  trophy: () => icon(html`<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 01-10 0V4z" /><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />`),
  gift: () => icon(html`<rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18" /><path d="M12 8c-2-4-6-4-6-1.5S9 8 12 8zM12 8c2-4 6-4 6-1.5S15 8 12 8z" />`),
  chat: () => icon(html`<path d="M21 12a8 8 0 01-11.6 7.1L4 21l1.9-5.4A8 8 0 1121 12z" />`),
  bell: () => icon(html`<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 20a2 2 0 004 0" />`),
  gear: () => icon(html`<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />`),
  back: () => icon(html`<path d="M15 18l-6-6 6-6" />`),
  share: () => icon(html`<path d="M4 12v8h16v-8M12 3v13M7 8l5-5 5 5" />`),
  camera: () => icon(html`<path d="M4 7h3l2-3h6l2 3h3v13H4z" /><circle cx="12" cy="13" r="4" />`),
};

export function BackLink({ href, label = "Back", onClick }) {
  return html`<a class="back-link" href=${href} onClick=${onClick}>${Icons.back()} ${label}</a>`;
}

export async function shareInvite(group) {
  const url = `${location.origin}${location.pathname}#/join/${group.invite_code}`;
  const text = `Join "${group.name}" on Twelve! Invite code: ${group.invite_code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Twelve", text, url });
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("Invite copied — paste it anywhere");
  } catch {
    toast(`Invite code: ${group.invite_code}`);
  }
}
