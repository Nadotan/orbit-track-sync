import {
  removePushSubscription,
  reportPushClientStatus,
  savePushSubscription,
} from "./push.functions";

/** VAPID public key — safe to ship to the browser. */
export const VAPID_PUBLIC_KEY =
  "BGEzxsjM_gjkW-BX3iXfLY4H6gY8TezR5gvlv0RaOqKRY_Ap4Kvd5o7PivHc9lboTGiEpE05PUiy5ie21MUJICQ";

const SW_URL =
  "/push-sw.js";

const PUSH_CLIENT_ID_KEY =
  "pom.push.client-id";

export type PushPermissionState =
  | NotificationPermission
  | "unsupported";

export interface PushClientSyncState {
  supported: boolean;
  permission: PushPermissionState;
  enabled: boolean;
}

function urlBase64ToUint8Array(
  base64String: string,
) {
  const padding =
    "=".repeat(
      (
        4 -
        (
          base64String.length %
          4
        )
      ) %
      4,
    );

  const base64 =
    (
      base64String +
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
    atob(
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
      raw.charCodeAt(
        i,
      );
  }

  return output;
}

function createClientId() {
  if (
    typeof crypto.randomUUID ===
    "function"
  ) {
    return crypto.randomUUID();
  }

  const bytes =
    crypto.getRandomValues(
      new Uint8Array(
        16,
      ),
    );

  bytes[6] =
    (
      bytes[6]! &
      0x0f
    ) |
    0x40;

  bytes[8] =
    (
      bytes[8]! &
      0x3f
    ) |
    0x80;

  const hex =
    [
      ...bytes,
    ].map(
      (value) =>
        value
          .toString(
            16,
          )
          .padStart(
            2,
            "0",
          ),
    );

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function getPushClientId() {
  try {
    const existing =
      window.localStorage.getItem(
        PUSH_CLIENT_ID_KEY,
      );

    if (existing) {
      return existing;
    }

    const clientId =
      createClientId();

    window.localStorage.setItem(
      PUSH_CLIENT_ID_KEY,
      clientId,
    );

    return clientId;
  } catch {
    try {
      const existing =
        window.sessionStorage.getItem(
          PUSH_CLIENT_ID_KEY,
        );

      if (existing) {
        return existing;
      }

      const clientId =
        createClientId();

      window.sessionStorage.setItem(
        PUSH_CLIENT_ID_KEY,
        clientId,
      );

      return clientId;
    } catch {
      return createClientId();
    }
  }
}

export function isPushSupported() {
  return (
    typeof window !==
      "undefined" &&
    "serviceWorker" in
      navigator &&
    "PushManager" in
      window &&
    "Notification" in
      window
  );
}

async function getRegistration() {
  return navigator
    .serviceWorker
    .register(
      SW_URL,
      {
        scope:
          "/",
      },
    );
}

export async function getPushSubscription() {
  if (
    !isPushSupported()
  ) {
    return null;
  }

  const registration =
    await navigator
      .serviceWorker
      .getRegistration(
        SW_URL,
      );

  if (
    !registration
  ) {
    return null;
  }

  return registration
    .pushManager
    .getSubscription();
}

function subscriptionData(
  subscription:
    PushSubscription,
) {
  const json =
    subscription
      .toJSON() as {
        endpoint?: string;
        keys?: {
          p256dh?: string;
          auth?: string;
        };
      };

  if (
    !json.endpoint ||
    !json.keys?.p256dh ||
    !json.keys?.auth
  ) {
    throw new Error(
      "Could not register this device for notifications.",
    );
  }

  return {
    endpoint:
      json.endpoint,

    p256dh:
      json.keys.p256dh,

    auth:
      json.keys.auth,
  };
}

async function saveBrowserSubscription(
  subscription:
    PushSubscription,
) {
  const data =
    subscriptionData(
      subscription,
    );

  await savePushSubscription({
    data,
  });

  return data;
}

async function reportClientStatus(
  permission:
    PushPermissionState,
  endpoint:
    string | null,
) {
  await reportPushClientStatus({
    data: {
      clientId:
        getPushClientId(),

      permission,

      endpoint,
    },
  });
}

export async function syncPushClientStatus():
  Promise<PushClientSyncState> {
  if (
    !isPushSupported()
  ) {
    try {
      await reportClientStatus(
        "unsupported",
        null,
      );
    } catch {
      // Health reporting should never block the app.
    }

    return {
      supported:
        false,

      permission:
        "unsupported",

      enabled:
        false,
    };
  }

  const permission =
    Notification.permission;

  let subscription:
    PushSubscription | null =
    null;

  try {
    subscription =
      await getPushSubscription();
  } catch {
    subscription =
      null;
  }

  let serverRegistered =
    false;

  let endpoint =
    subscription
      ?.endpoint ??
    null;

  if (
    permission ===
      "granted" &&
    subscription
  ) {
    try {
      const data =
        await saveBrowserSubscription(
          subscription,
        );

      endpoint =
        data.endpoint;

      serverRegistered =
        true;
    } catch {
      serverRegistered =
        false;
    }
  }

  try {
    await reportClientStatus(
      permission,
      endpoint,
    );
  } catch {
    // Health reporting should never block the app.
  }

  return {
    supported:
      true,

    permission,

    enabled:
      permission ===
        "granted" &&
      Boolean(
        subscription,
      ) &&
      serverRegistered,
  };
}

export async function enablePush() {
  if (
    !isPushSupported()
  ) {
    throw new Error(
      "Push notifications aren't supported here. On iPhone, add POM to your home screen first.",
    );
  }

  const permission =
    await Notification
      .requestPermission();

  if (
    permission !==
    "granted"
  ) {
    let endpoint:
      string | null =
      null;

    try {
      endpoint =
        (
          await getPushSubscription()
        )
          ?.endpoint ??
        null;

      await reportClientStatus(
        permission,
        endpoint,
      );
    } catch {
      // The permission error below is the important part.
    }

    throw new Error(
      "Notifications are blocked. Enable them in your browser settings.",
    );
  }

  const registration =
    await getRegistration();

  await navigator
    .serviceWorker
    .ready;

  const existing =
    await registration
      .pushManager
      .getSubscription();

  const subscription =
    existing ??
    (
      await registration
        .pushManager
        .subscribe({
          userVisibleOnly:
            true,

          applicationServerKey:
            urlBase64ToUint8Array(
              VAPID_PUBLIC_KEY,
            ),
        })
    );

  const data =
    await saveBrowserSubscription(
      subscription,
    );

  try {
    await reportClientStatus(
      "granted",
      data.endpoint,
    );
  } catch {
    // Push is already registered.
    // Health reporting retries on the next app open.
  }

  return subscription;
}

export async function disablePush() {
  if (
    !isPushSupported()
  ) {
    return;
  }

  const subscription =
    await getPushSubscription();

  if (
    subscription
  ) {
    const endpoint =
      subscription.endpoint;

    /*
     * Keep the browser subscription intact
     * if server-side removal fails.
     *
     * This lets the next sync repair state
     * instead of losing the local subscription.
     */
    await removePushSubscription({
      data: {
        endpoint,
      },
    });

    await subscription
      .unsubscribe();
  }

  try {
    await reportClientStatus(
      Notification.permission,
      null,
    );
  } catch {
    // The subscription itself is already disabled.
  }
}