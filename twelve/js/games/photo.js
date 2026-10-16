// Photo Challenge (host picks the winner) and the shared photo gallery
// shown for Photo Challenge and Scavenger Hunt once a day closes.
import { html, useState, useEffect } from "../vendor/preact-htm.mjs";
import { rpc, uploadGamePhoto, signedUrls } from "../lib/db.js";
import { useGroup } from "../lib/state.js";
import { ErrorNote, Spinner, useAction, useAsync, Icons, toast } from "../lib/ui.js";

export function PhotoChallenge({ data, submit, groupId, userId }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [caption, setCaption] = useState("");
  const send = useAction(async () => {
    const path = await uploadGamePhoto(groupId, data.day, userId, file);
    await submit({ photo: path, caption: caption.trim() });
  });
  const onPick = (e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  return html`<section class="stack-lg">
    <div class="hero gold">
      <div class="kicker">Today's prompt</div>
      <h2>${data.content.prompt}</h2>
      ${data.content.tips && html`<p>${data.content.tips}</p>`}
    </div>
    <label class="card stack center" style="cursor:pointer;align-items:center" for="photo-input">
      ${preview
        ? html`<img src=${preview} alt="Your photo" style="border-radius:14px;max-height:360px;object-fit:contain" />`
        : html`<div style="font-size:3rem">📸</div><b>Take or choose a photo</b>`}
      <span class="btn ghost small">${Icons.camera()} ${preview ? "Change photo" : "Choose photo"}</span>
    </label>
    <input id="photo-input" type="file" accept="image/*" class="sr-only" onChange=${onPick} />
    <div class="field">
      <label for="caption">Caption (optional)</label>
      <input id="caption" class="input" maxlength="100" value=${caption} onInput=${(e) => setCaption(e.currentTarget.value)} />
    </div>
    <${ErrorNote} error=${send.error} />
    <button class="btn block" disabled=${!file || send.busy} onClick=${send.run}>${send.busy ? "Uploading…" : "Submit my entry"}</button>
    <p class="small muted center">One entry each. Entries are shown to the group after the day closes.</p>
  </section>`;
}

export function PhotoGallery({ data, groupId, reload }) {
  const g = useGroup();
  const entries = useAsync(() => rpc("twelve_day_photos", { p_group: groupId, p_day: data.day }), [groupId, data.day]);
  const [urls, setUrls] = useState({});
  const isPhoto = data.format === "photo";
  const items = data.content?.items || [];

  // Flatten to one tile per photo.
  const tiles = (entries.data || []).flatMap((e) => isPhoto
    ? e.response?.photo ? [{ user: e.user_id, path: e.response.photo, caption: e.response.caption }] : []
    : Object.entries(e.response?.photos || {}).map(([i, path]) => ({ user: e.user_id, path, caption: items[i] })));

  useEffect(() => {
    if (tiles.length) signedUrls(tiles.map((t) => t.path)).then(setUrls).catch(() => {});
  }, [entries.data]);

  const pick = useAction(async (userId) => {
    await rpc("twelve_pick_photo_winner", { p_group: groupId, p_day: data.day, p_user: userId });
    await reload();
    g.reload();
    toast("Winner crowned 👑");
  });

  if (entries.loading && !entries.data) return html`<${Spinner} />`;
  if (entries.error) return html`<${ErrorNote} error=${entries.error} />`;
  if (!tiles.length) return html`<div class="empty"><div class="big">🖼️</div><p>No photos were entered for Day ${data.day}.</p></div>`;

  return html`<section class="stack">
    <div class="section-label">${isPhoto ? "The entries" : "Everyone's finds"}</div>
    ${isPhoto && g.isHost && html`<p class="note small">${data.winner_id ? "You can change your pick any time." : "You're the judge! Tap “Crown” under your favorite."}</p>`}
    <div class="photo-grid">
      ${tiles.map((t) => html`<div class="stack" style="gap:6px">
        <div class="photo-tile">
          ${urls[t.path] ? html`<img src=${urls[t.path]} alt=${t.caption || "Entry"} loading="lazy" />` : null}
          ${isPhoto && data.winner_id === t.user && html`<span class="crown" aria-label="Winner">👑</span>`}
          <div class="cap">${g.profiles[t.user]?.display_name || "Someone"}${t.caption ? ` · ${t.caption}` : ""}</div>
        </div>
        ${isPhoto && g.isHost && data.winner_id !== t.user && html`<button class="btn gold small" disabled=${pick.busy} onClick=${() => pick.run(t.user)}>Crown</button>`}
      </div>`)}
    </div>
    <${ErrorNote} error=${pick.error} />
  </section>`;
}
