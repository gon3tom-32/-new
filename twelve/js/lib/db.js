// Supabase client and small data helpers shared by every screen.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// Same rule as twelve_current_season() in the database: the season is the
// year, rolling over on January 16 (UTC).
export function currentSeason() {
  return new Date(Date.now() - 15 * 86400000).getUTCFullYear();
}

// Turn a Supabase error into a plain Error with a readable message. The
// database functions raise messages written for people, so pass those on.
export function friendly(error) {
  if (!error) return null;
  if (error instanceof Error && !error.code) return error;
  let message = error.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    message = "Can't reach Twelve right now. Check your connection and try again.";
  } else if (error.code === "PGRST202" || /function .* does not exist/i.test(message)) {
    message = "Twelve's database isn't set up yet (run supabase/twelve.sql).";
  } else if (error.code === "42501") {
    message = "You don't have permission to do that.";
  }
  const out = new Error(message);
  out.code = error.code;
  return out;
}

export async function rpc(name, args = {}) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw friendly(error);
  return data;
}

// Run a query builder and return its data, throwing a friendly error.
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw friendly(error);
  return data;
}

// Shrink a photo in the browser before upload. Re-encoding as JPEG also
// strips metadata such as location.
export async function resizeImage(file, maxSide = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That photo couldn't be opened."));
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("That photo couldn't be processed.");
  return blob;
}

const randomName = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;

export async function uploadAvatar(userId, file) {
  const blob = await resizeImage(file, 512, 0.85);
  const path = `avatars/${userId}/${randomName()}`;
  const { error } = await sb.storage.from("twelve-avatars").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw friendly(error);
  return sb.storage.from("twelve-avatars").getPublicUrl(path).data.publicUrl;
}

export async function uploadGamePhoto(groupId, day, userId, file) {
  const blob = await resizeImage(file, 1600, 0.82);
  const path = `${groupId}/${currentSeason()}/${day}/${userId}/${randomName()}`;
  const { error } = await sb.storage.from("twelve-photos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw friendly(error);
  return path;
}

// Signed (temporary) links for private game photos, cached for the session.
const signedCache = new Map();
export async function signedUrls(paths) {
  const wanted = [...new Set(paths.filter(Boolean))];
  const missing = wanted.filter((p) => !signedCache.has(p));
  if (missing.length) {
    const { data, error } = await sb.storage.from("twelve-photos").createSignedUrls(missing, 60 * 60 * 6);
    if (error) throw friendly(error);
    for (const item of data || []) if (item.signedUrl) signedCache.set(item.path, item.signedUrl);
  }
  const out = {};
  for (const p of wanted) out[p] = signedCache.get(p);
  return out;
}

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("twelve." + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem("twelve." + key);
      else localStorage.setItem("twelve." + key, JSON.stringify(value));
    } catch {
      /* private mode: fine to forget */
    }
  },
};
