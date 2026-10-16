// Scavenger Hunt: find each item, snap a photo, beat the clock.
import { html, useState, useEffect } from "../vendor/preact-htm.mjs";
import { uploadGamePhoto, storage } from "../lib/db.js";
import { ErrorNote, useAction, useNow } from "../lib/ui.js";

function Timer({ since }) {
  const now = useNow(1000);
  const s = Math.max(0, Math.floor((now - new Date(since)) / 1000));
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return html`<span class="timer-chip" role="timer" aria-label=${`${label} elapsed`}>⏱ ${label}</span>`;
}

export function Scavenger({ data, start, submit, groupId, userId }) {
  const started = data.play?.started_at;
  const begin = useAction(start);

  if (!started) {
    return html`<section class="stack-lg">
      <div class="hero pine sprinkles">
        <div class="kicker">How it works</div>
        <h2>Ready, set… hunt!</h2>
        <p>You'll see a list of things to find around you. Snap a photo of each. 10 points per item, plus up to 40 for speed — the full bonus if you finish inside 10 minutes.</p>
      </div>
      <${ErrorNote} error=${begin.error} />
      <button class="btn block green" disabled=${begin.busy} onClick=${begin.run}>Start the clock</button>
      <p class="small muted center">The list stays hidden until you start, so it's fair for everyone.</p>
    </section>`;
  }
  return html`<${Hunt} data=${data} submit=${submit} groupId=${groupId} userId=${userId} />`;
}

function Hunt({ data, submit, groupId, userId }) {
  const key = `hunt.${groupId}.${data.day}`;
  const items = data.content.items;
  // Remember uploads on this device in case the page reloads mid-hunt.
  const [photos, setPhotos] = useState(() => storage.get(key, {}));
  const [previews, setPreviews] = useState({});
  const [uploading, setUploading] = useState(null);
  const [error, setError] = useState(null);
  const finish = useAction(async () => {
    await submit({ photos });
    storage.set(key, null);
  });
  useEffect(() => storage.set(key, photos), [photos]);

  const onPick = async (i, file) => {
    if (!file) return;
    setError(null);
    setUploading(i);
    setPreviews((p) => ({ ...p, [i]: URL.createObjectURL(file) }));
    try {
      const path = await uploadGamePhoto(groupId, data.day, userId, file);
      setPhotos((p) => ({ ...p, [i]: path }));
    } catch (e) {
      setError(e);
      setPreviews((p) => ({ ...p, [i]: undefined }));
    } finally {
      setUploading(null);
    }
  };

  const found = Object.keys(photos).length;
  return html`<section class="stack-lg">
    <div class="row between">
      <span style="font-weight:700">${found} of ${items.length} found</span>
      <${Timer} since=${data.play.started_at} />
    </div>
    <div class="stack">
      ${items.map((item, i) => html`<label class=${"hunt-item" + (photos[i] ? " found" : "")} for=${`hunt-${i}`} style="cursor:pointer">
        <div class="hunt-thumb">${previews[i] ? html`<img src=${previews[i]} alt="" />` : photos[i] ? "✅" : "📷"}</div>
        <div class="grow">
          <div style="font-weight:700">${item}</div>
          <div class="small muted">${uploading === i ? "Uploading…" : photos[i] ? "Found! Tap to retake" : "Tap to snap it"}</div>
        </div>
        <input id=${`hunt-${i}`} type="file" accept="image/*" capture="environment" class="sr-only"
          disabled=${uploading !== null} onChange=${(e) => onPick(i, e.currentTarget.files?.[0])} />
      </label>`)}
    </div>
    <${ErrorNote} error=${error || finish.error} />
    <button class="btn block" disabled=${found === 0 || uploading !== null || finish.busy} onClick=${finish.run}>
      ${finish.busy ? "Submitting…" : found === items.length ? "Done! Stop the clock" : `Finish with ${found} of ${items.length}`}
    </button>
    <p class="small muted center">The clock keeps running until you finish. One go only.</p>
  </section>`;
}
