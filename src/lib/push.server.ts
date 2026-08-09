import {
  createCipheriv,
  createECDH,
  createHash,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface StoredPushSubscription {
  endpoint: string;

  expirationTime?:
    | number
    | null;

  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/*
 * NIST P-256 curve order.
 */
const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);

/*
 * Send the forgotten-clock notification
 * after 8 hours.
 */
const CLOCK_REMINDER_AFTER_MS =
  8 * 60 * 60 * 1000;

function base64UrlDecode(
  value: string,
): Buffer {
  return Buffer.from(
    value,
    "base64url",
  );
}

function hmacSha256(
  key: Buffer,
  data: Buffer,
): Buffer {
  return createHmac(
    "sha256",
    key,
  )
    .update(data)
    .digest();
}

function getServerSecret() {
  const secret =
    process.env[
      "SUPABASE_SERVICE_ROLE_KEY"
    ];

  if (!secret) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Push notifications require the existing server-side Supabase connection.",
    );
  }

  return secret;
}

/*
 * We derive a stable VAPID private key from
 * the existing server secret.
 *
 * This means:
 * - no new environment variables
 * - no Lovable configuration
 * - same push key after server restarts
 */
function deriveVapidPrivateKey(): Buffer {
  const secret =
    getServerSecret();

  for (
    let counter = 0;
    counter < 1000;
    counter += 1
  ) {
    const candidate =
      createHash("sha256")
        .update(
          `chrona-vapid-v1:${counter}:`,
        )
        .update(secret)
        .digest();

    const scalar =
      BigInt(
        `0x${candidate.toString(
          "hex",
        )}`,
      );

    if (
      scalar > 0n &&
      scalar < P256_ORDER
    ) {
      return candidate;
    }
  }

  throw new Error(
    "Could not derive a valid Web Push application key.",
  );
}

function getVapidKeyPair() {
  const privateKey =
    deriveVapidPrivateKey();

  const ecdh =
    createECDH("prime256v1");

  ecdh.setPrivateKey(
    privateKey,
  );

  const publicKey =
    ecdh.getPublicKey();

  return {
    privateKey,
    publicKey,
  };
}

export function getVapidPublicKey() {
  return getVapidKeyPair()
    .publicKey
    .toString("base64url");
}

function createVapidJwt(
  endpoint: string,
) {
  const {
    privateKey,
    publicKey,
  } = getVapidKeyPair();

  const x =
    publicKey
      .subarray(1, 33)
      .toString("base64url");

  const y =
    publicKey
      .subarray(33, 65)
      .toString("base64url");

  const d =
    privateKey.toString(
      "base64url",
    );

  const key =
    createPrivateKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x,
        y,
        d,
      },

      format: "jwk",
    });

  const header =
    Buffer.from(
      JSON.stringify({
        typ: "JWT",
        alg: "ES256",
      }),
    ).toString("base64url");

  const payload =
    Buffer.from(
      JSON.stringify({
        aud:
          new URL(
            endpoint,
          ).origin,

        exp:
          Math.floor(
            Date.now() /
              1000,
          ) +
          60 * 60,

        sub:
          "mailto:notifications@chrona.app",
      }),
    ).toString("base64url");

  const signingInput =
    `${header}.${payload}`;

  const signature =
    sign(
      "sha256",

      Buffer.from(
        signingInput,
      ),

      {
        key,
        dsaEncoding:
          "ieee-p1363",
      },
    ).toString("base64url");

  return `${signingInput}.${signature}`;
}

function encryptPayload(
  subscription:
    StoredPushSubscription,

  payload: string,
): Buffer {
  const receiverPublicKey =
    base64UrlDecode(
      subscription
        .keys
        .p256dh,
    );

  const authenticationSecret =
    base64UrlDecode(
      subscription
        .keys
        .auth,
    );

  if (
    receiverPublicKey.length !==
      65 ||
    receiverPublicKey[0] !== 4
  ) {
    throw new Error(
      "Invalid Web Push public key.",
    );
  }

  const sender =
    createECDH(
      "prime256v1",
    );

  sender.generateKeys();

  const senderPublicKey =
    sender.getPublicKey();

  const sharedSecret =
    sender.computeSecret(
      receiverPublicKey,
    );

  const salt =
    randomBytes(16);

  /*
   * RFC 8291:
   *
   * PRK_key =
   * HMAC(auth_secret, shared_secret)
   */
  const prkKey =
    hmacSha256(
      authenticationSecret,
      sharedSecret,
    );

  const keyInfo =
    Buffer.concat([
      Buffer.from(
        "WebPush: info",
      ),

      Buffer.from([0]),

      receiverPublicKey,

      senderPublicKey,
    ]);

  const ikm =
    hmacSha256(
      prkKey,

      Buffer.concat([
        keyInfo,
        Buffer.from([1]),
      ]),
    );

  /*
   * RFC 8188 content encryption.
   */
  const prk =
    hmacSha256(
      salt,
      ikm,
    );

  const cek =
    hmacSha256(
      prk,

      Buffer.concat([
        Buffer.from(
          "Content-Encoding: aes128gcm",
        ),

        Buffer.from([
          0,
          1,
        ]),
      ]),
    ).subarray(
      0,
      16,
    );

  const nonce =
    hmacSha256(
      prk,

      Buffer.concat([
        Buffer.from(
          "Content-Encoding: nonce",
        ),

        Buffer.from([
          0,
          1,
        ]),
      ]),
    ).subarray(
      0,
      12,
    );

  /*
   * 0x02 is the final-record
   * delimiter.
   */
  const plaintext =
    Buffer.concat([
      Buffer.from(
        payload,
        "utf8",
      ),

      Buffer.from([2]),
    ]);

  if (
    plaintext.length +
      16 >
    4096
  ) {
    throw new Error(
      "Push notification payload is too large.",
    );
  }

  const cipher =
    createCipheriv(
      "aes-128-gcm",
      cek,
      nonce,
    );

  const ciphertext =
    Buffer.concat([
      cipher.update(
        plaintext,
      ),

      cipher.final(),

      cipher.getAuthTag(),
    ]);

  /*
   * aes128gcm header:
   *
   * 16 bytes salt
   * 4 bytes record size
   * 1 byte key ID length
   * sender public key
   */
  const header =
    Buffer.alloc(21);

  salt.copy(
    header,
    0,
  );

  header.writeUInt32BE(
    4096,
    16,
  );

  header[20] =
    senderPublicKey.length;

  return Buffer.concat([
    header,
    senderPublicKey,
    ciphertext,
  ]);
}

export async function sendWebPush(
  subscription:
    StoredPushSubscription,

  payload:
    PushPayload,
): Promise<{
  ok: boolean;
  expired: boolean;
  status: number;
}> {
  const encrypted =
    encryptPayload(
      subscription,
      JSON.stringify(
        payload,
      ),
    );

  const publicKey =
    getVapidPublicKey();

  const token =
    createVapidJwt(
      subscription.endpoint,
    );

  const response =
    await fetch(
      subscription.endpoint,
      {
        method: "POST",

        headers: {
          TTL: "300",

          Urgency: "high",

          "Content-Encoding":
            "aes128gcm",

          "Content-Type":
            "application/octet-stream",

          Authorization:
            `vapid t=${token}, k=${publicKey}`,
        },

        body:
          new Uint8Array(
            encrypted,
          ),
      },
    );

  return {
    ok:
      response.ok,

    expired:
      response.status ===
        404 ||
      response.status ===
        410,

    status:
      response.status,
  };
}

function readSubscription(
  metadata:
    Record<
      string,
      unknown
    >,
):
  | StoredPushSubscription
  | null {
  const candidate =
    metadata[
      "push_subscription"
    ];

  if (
    !candidate ||
    typeof candidate !==
      "object"
  ) {
    return null;
  }

  const subscription =
    candidate as Partial<StoredPushSubscription>;

  if (
    typeof subscription.endpoint !==
      "string" ||
    !subscription.keys ||
    typeof subscription.keys
      .p256dh !==
      "string" ||
    typeof subscription.keys
      .auth !==
      "string"
  ) {
    return null;
  }

  return {
    endpoint:
      subscription.endpoint,

    expirationTime:
      subscription
        .expirationTime ??
      null,

    keys: {
      p256dh:
        subscription
          .keys
          .p256dh,

      auth:
        subscription
          .keys
          .auth,
    },
  };
}

async function getAuthUser(
  userId: string,
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .auth
      .admin
      .getUserById(
        userId,
      );

  if (
    error ||
    !data.user
  ) {
    throw new Error(
      error?.message ||
        "User not found.",
    );
  }

  return data.user;
}

async function patchAppMetadata(
  userId: string,

  patch:
    Record<
      string,
      unknown
    >,
) {
  const user =
    await getAuthUser(
      userId,
    );

  const current =
    (user.app_metadata ??
      {}) as Record<
      string,
      unknown
    >;

  const { error } =
    await supabaseAdmin
      .auth
      .admin
      .updateUserById(
        userId,
        {
          app_metadata: {
            ...current,
            ...patch,
          },
        },
      );

  if (error) {
    throw new Error(
      error.message,
    );
  }
}

export async function savePushSubscriptionForUser(
  userId: string,

  subscription:
    StoredPushSubscription,
) {
  await patchAppMetadata(
    userId,
    {
      push_subscription:
        subscription,
    },
  );
}

export async function setUserClockStatus(
  userId: string,

  startedAt:
    | string
    | null,
) {
  if (startedAt) {
    await patchAppMetadata(
      userId,
      {
        active_clock_started_at:
          startedAt,

        clock_reminder_sent_at:
          null,
      },
    );

    return;
  }

  await patchAppMetadata(
    userId,
    {
      active_clock_started_at:
        null,

      clock_reminder_sent_at:
        null,
    },
  );
}

export async function isAdminUser(
  userId: string,
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "user_roles",
      )
      .select("id")
      .eq(
        "user_id",
        userId,
      )
      .eq(
        "role",
        "admin",
      )
      .limit(1);

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return (
    data?.length ??
    0
  ) > 0;
}

async function listAllUsers() {
  const users = [];

  const perPage = 1000;

  for (
    let page = 1;
    page <= 100;
    page += 1
  ) {
    const {
      data,
      error,
    } =
      await supabaseAdmin
        .auth
        .admin
        .listUsers({
          page,
          perPage,
        });

    if (error) {
      throw new Error(
        error.message,
      );
    }

    users.push(
      ...data.users,
    );

    if (
      data.users.length <
      perPage
    ) {
      break;
    }
  }

  return users;
}

async function clearExpiredSubscription(
  userId: string,
) {
  try {
    await patchAppMetadata(
      userId,
      {
        push_subscription:
          null,
      },
    );
  } catch (error) {
    console.error(
      "Failed to clear expired push subscription:",
      error,
    );
  }
}

export async function sendNewMeetingPush({
  creatorUserId,
  title,
  date,
  time,
  teamId,
}: {
  creatorUserId: string;
  title: string;
  date: string;
  time: string;

  teamId:
    | string
    | null;
}) {
  const users =
    await listAllUsers();

  let teamUsers:
    | Set<string>
    | null =
    null;

  if (
    teamId &&
    teamId !== "general"
  ) {
    const {
      data,
      error,
    } =
      await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq(
          "team_id",
          teamId,
        );

    if (error) {
      throw new Error(
        error.message,
      );
    }

    teamUsers =
      new Set(
        (
          data ?? []
        ).map(
          (profile) =>
            profile.id,
        ),
      );
  }

  let sent = 0;

  for (
    const user of users
  ) {
    /*
     * Don't send the creator a
     * notification about the meeting
     * they just created.
     */
    if (
      user.id ===
      creatorUserId
    ) {
      continue;
    }

    if (
      teamUsers &&
      !teamUsers.has(
        user.id,
      )
    ) {
      continue;
    }

    const metadata =
      (user.app_metadata ??
        {}) as Record<
        string,
        unknown
      >;

    const subscription =
      readSubscription(
        metadata,
      );

    if (!subscription) {
      continue;
    }

    try {
      const result =
        await sendWebPush(
          subscription,
          {
            title:
              "New meeting",

            body:
              `${title} — ${date} at ${time}`,

            url:
              "/meetings",

            tag:
              `meeting-${date}-${time}-${title}`,
          },
        );

      if (result.ok) {
        sent += 1;
      }

      if (
        result.expired
      ) {
        await clearExpiredSubscription(
          user.id,
        );
      }

      if (
        !result.ok &&
        !result.expired
      ) {
        console.error(
          `Push failed for ${user.id}: HTTP ${result.status}`,
        );
      }
    } catch (error) {
      console.error(
        `Could not send meeting push to ${user.id}:`,
        error,
      );
    }
  }

  return {
    sent,
  };
}

let reminderSweepRunning =
  false;

export async function runClockReminderSweep() {
  if (
    reminderSweepRunning
  ) {
    return;
  }

  reminderSweepRunning =
    true;

  try {
    const users =
      await listAllUsers();

    const now =
      Date.now();

    let remindersSent = 0;

    for (
      const user of users
    ) {
      const metadata =
        (user.app_metadata ??
          {}) as Record<
          string,
          unknown
        >;

      const startedAtValue =
        metadata[
          "active_clock_started_at"
        ];

      const reminderSentValue =
        metadata[
          "clock_reminder_sent_at"
        ];

      if (
        typeof startedAtValue !==
        "string"
      ) {
        continue;
      }

      /*
       * Already reminded during
       * this work session.
       */
      if (
        typeof reminderSentValue ===
          "string" &&
        reminderSentValue
      ) {
        continue;
      }

      const startedAtMs =
        Date.parse(
          startedAtValue,
        );

      if (
        !Number.isFinite(
          startedAtMs,
        )
      ) {
        continue;
      }

      if (
        now -
          startedAtMs <
        CLOCK_REMINDER_AFTER_MS
      ) {
        continue;
      }

      /*
       * Safety check:
       *
       * If stopSession succeeded but
       * clearing Auth metadata failed,
       * there should already be a
       * time_entries row with the same
       * start time.
       *
       * If so, the user DID stop the
       * clock and we must not send a
       * false reminder.
       */
      const {
        data:
          completedEntries,

        error:
          completedError,
      } =
        await supabaseAdmin
          .from(
            "time_entries",
          )
          .select("id")
          .eq(
            "user_id",
            user.id,
          )
          .eq(
            "start_time",
            startedAtValue,
          )
          .limit(1);

      if (
        completedError
      ) {
        console.error(
          `Could not verify clock state for ${user.id}:`,
          completedError,
        );

        continue;
      }

      if (
        completedEntries &&
        completedEntries.length >
          0
      ) {
        try {
          await patchAppMetadata(
            user.id,
            {
              active_clock_started_at:
                null,

              clock_reminder_sent_at:
                null,
            },
          );
        } catch (
          error
        ) {
          console.error(
            "Could not clear completed clock metadata:",
            error,
          );
        }

        continue;
      }

      const subscription =
        readSubscription(
          metadata,
        );

      if (!subscription) {
        /*
         * Leave reminderSent null.
         * If they enable push later
         * while still clocked in,
         * they can still receive it.
         */
        continue;
      }

      try {
        const result =
          await sendWebPush(
            subscription,
            {
              title:
                "Still working?",

              body:
                "You've been clocked in for more than 8 hours. Did you forget to stop the clock?",

              url: "/",

              tag:
                `clock-reminder-${user.id}`,
            },
          );

        if (
          result.expired
        ) {
          await clearExpiredSubscription(
            user.id,
          );

          continue;
        }

        if (!result.ok) {
          console.error(
            `Clock reminder push failed for ${user.id}: HTTP ${result.status}`,
          );

          continue;
        }

        remindersSent +=
          1;

        await patchAppMetadata(
          user.id,
          {
            clock_reminder_sent_at:
              new Date().toISOString(),
          },
        );
      } catch (error) {
        console.error(
          `Could not send clock reminder to ${user.id}:`,
          error,
        );
      }
    }

    console.log(
      `[Chrona Push] Clock reminder sweep finished. Sent ${remindersSent} reminder(s).`,
    );
  } finally {
    reminderSweepRunning =
      false;
  }
}