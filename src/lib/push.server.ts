import { buildPushPayload } from "@block65/webcrypto-web-push";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

function vapidKeys() {
  return {
    subject: process.env["VAPID_SUBJECT"] ?? "mailto:notifications@chrona.app",
    publicKey: process.env["VAPID_PUBLIC_KEY"],
    privateKey: process.env["VAPID_PRIVATE_KEY"],
  };
}

/** Sends a web push notification to every registered device of the given users. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return 0;

  const vapid = vapidKeys();
  if (!vapid.publicKey || !vapid.privateKey) {
    console.error("[push] Missing VAPID keys");
    return 0;
  }

  const { data: subscriptions, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", unique);

  if (error) {
    console.error("[push] Failed to load subscriptions", error);
    return 0;
  }

  let sent = 0;
  const stale: string[] = [];

  await Promise.all(
    (subscriptions ?? []).map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        expirationTime: null,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };

      try {
        const request = await buildPushPayload(
          { data: payload, options: { ttl: 60 * 60 * 12 } },
          subscription,
          vapid,
        );

        const response = await fetch(row.endpoint, {
          method: request.method,
          headers: request.headers,
          body: request.body as BodyInit,
        });

        if (response.status === 404 || response.status === 410) {
          stale.push(row.id);
          return;
        }

        if (!response.ok) {
          console.error("[push] Delivery failed", response.status, await response.text());
          return;
        }

        sent += 1;
      } catch (pushError) {
        console.error("[push] Delivery error", pushError);
      }
    }),
  );

  if (stale.length > 0) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", stale);
  }

  return sent;
}

/** User ids that should hear about a meeting: the meeting's team, or everyone for General. */
export async function audienceForMeeting(teamId: string | null) {
  const query = supabaseAdmin.from("profiles").select("id");
  const { data, error } = teamId ? await query.eq("team_id", teamId) : await query;

  if (error) {
    console.error("[push] Failed to load meeting audience", error);
    return [];
  }

  return (data ?? []).map((profile) => profile.id);
}

export async function adminUserIds() {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (error) {
    console.error("[push] Failed to load admins", error);
    return [];
  }

  return (data ?? []).map((row) => row.user_id);
}
