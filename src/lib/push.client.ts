import {
  getPushPublicKey,
  savePushSubscription,
} from "./push.functions";

interface StandaloneNavigator
  extends Navigator {
  standalone?: boolean;
}

function isIosDevice() {
  const ua =
    navigator.userAgent;

  const classicIos =
    /iPad|iPhone|iPod/i.test(
      ua,
    );

  const modernIpad =
    /Macintosh/i.test(
      ua,
    ) &&
    navigator.maxTouchPoints >
      1;

  return (
    classicIos ||
    modernIpad
  );
}

function isStandaloneMode() {
  const navigatorWithStandalone =
    navigator as StandaloneNavigator;

  return (
    window.matchMedia(
      "(display-mode: standalone)",
    ).matches ||
    navigatorWithStandalone
      .standalone === true
  );
}

function urlBase64ToUint8Array(
  value: string,
): Uint8Array {
  const padding =
    "=".repeat(
      (4 -
        (value.length %
          4)) %
        4,
    );

  const base64 =
    (
      value +
      padding
    )
      .replace(
        /-/g,
        "+",
      )
      .replace(
        /_/g,
        "/",
      );

  const raw =
    window.atob(
      base64,
    );

  const output =
    new Uint8Array(
      raw.length,
    );

  for (
    let i = 0;
    i < raw.length;
    i += 1
  ) {
    output[i] =
      raw.charCodeAt(i);
  }

  return output;
}

export async function enablePushNotifications() {
  if (
    !(
      "serviceWorker" in
      navigator
    )
  ) {
    throw new Error(
      "This browser does not support background notifications.",
    );
  }

  if (
    !(
      "Notification" in
      window
    )
  ) {
    throw new Error(
      "Notifications are not supported on this device.",
    );
  }

  if (
    !(
      "PushManager" in
      window
    )
  ) {
    throw new Error(
      "Push notifications are not supported by this browser.",
    );
  }

  /*
   * iPhone/iPad Web Push works from
   * the installed Home Screen app.
   */
  if (
    isIosDevice() &&
    !isStandaloneMode()
  ) {
    throw new Error(
      "On iPhone or iPad, first add Chrona to your Home Screen, open Chrona from the new icon, and then enable phone alerts.",
    );
  }

  /*
   * IMPORTANT:
   * Request permission immediately
   * from the user's click.
   */
  const permission =
    await Notification
      .requestPermission();

  if (
    permission ===
    "denied"
  ) {
    throw new Error(
      "Notification permission was denied. Enable notifications for Chrona in your device settings and try again.",
    );
  }

  if (
    permission !==
    "granted"
  ) {
    throw new Error(
      "Notification permission was not granted.",
    );
  }

  const registration =
    await navigator
      .serviceWorker
      .register(
        "/sw.js",
        {
          scope: "/",
        },
      );

  await navigator
    .serviceWorker
    .ready;

  const {
    publicKey,
  } =
    await getPushPublicKey();

  let subscription =
    await registration
      .pushManager
      .getSubscription();

  if (!subscription) {
    subscription =
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly:
            true,

          applicationServerKey:
            urlBase64ToUint8Array(
              publicKey,
            ) as BufferSource,
        });
  }

  const json =
    subscription.toJSON();

  if (
    !json.endpoint ||
    !json.keys
      ?.p256dh ||
    !json.keys?.auth
  ) {
    throw new Error(
      "The browser returned an invalid push subscription.",
    );
  }

  await savePushSubscription({
    data: {
      endpoint:
        json.endpoint,

      expirationTime:
        json.expirationTime ??
        null,

      keys: {
        p256dh:
          json.keys
            .p256dh,

        auth:
          json.keys
            .auth,
      },
    },
  });

  return {
    success: true,
  };
}