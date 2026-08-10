import {
  savePushSubscription,
  removePushSubscription,
} from "./push.functions";

/** VAPID public key — safe to ship to the browser. */
export const VAPID_PUBLIC_KEY =
  "BGEzxsjM_gjkW-BX3iXfLY4H6gY8TezR5gvlv0RaOqKRY_Ap4Kvd5o7PivHc9lboTGiEpE05PUiy5ie21MUJICQ";

const SW_URL = "/push-sw.js";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function isPushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function getRegistration() {
  return navigator.serviceWorker.register(SW_URL, { scope: "/" });
}

export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SW_URL);
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

export async function enablePush() {
  if (!isPushSupported()) {
    throw new Error(
      "Push notifications aren't supported here. On iPhone, add Chrona to your home screen first.",
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked. Enable them in your browser settings.");
  }

  const registration = await getRegistration();
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Could not register this device for notifications.");
  }

  await savePushSubscription({
    data: {
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  });

  return subscription;
}

export async function disablePush() {
  const subscription = await getPushSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await removePushSubscription({ data: { endpoint } });
}
