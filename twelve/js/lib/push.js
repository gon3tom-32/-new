// Push notifications: register the service worker and save this device's
// push subscription so the twelve-push Edge Function can reach it.
import { VAPID_PUBLIC_KEY } from "../config.js";
import { sb, friendly } from "./db.js";

export const pushConfigured = () => Boolean(VAPID_PUBLIC_KEY);
export const pushSupported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iPhones and iPads only allow push once Twelve is added to the Home Screen.
export const needsInstallForPush = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch {
    return null;
  }
}

function keyToBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function pushStatus() {
  if (!pushConfigured() || !pushSupported()) return "unavailable";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  return subscription ? "on" : "off";
}

export async function enablePush() {
  if (!pushConfigured()) throw new Error("Push notifications aren't set up for this copy of Twelve yet.");
  if (needsInstallForPush()) {
    throw new Error("On iPhone, add Twelve to your Home Screen first (Share → Add to Home Screen), then turn on notifications from there.");
  }
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked. You can allow them in your browser settings.");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  await navigator.serviceWorker.ready;
  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) }));
  const json = subscription.toJSON();
  const { error } = await sb
    .from("twelve_push_subscriptions")
    .upsert({ endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: "endpoint" });
  if (error) throw friendly(error);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await sb.from("twelve_push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}
