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
          {
            data: { ...payload } as Record<string, string>,
            options: { ttl: 60 * 60 * 12 },
          },
          subscription,
          vapid,
        );

        const response = await fetch(row.endpoint, {
          method: request.method,
          headers: request.headers as unknown as HeadersInit,
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

let lastSweep = 0;

/** Runs the reminder sweep: long-running clocks and un-answered upcoming meetings. */
export async function runReminderSweep() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendPushToUsers, audienceForMeeting } = await import("@/lib/push.server");

  const now = Date.now();
  let clockReminders = 0;
  let rsvpReminders = 0;

  // 1. Clocks that have been running for more than 8 hours.
  const eightHoursAgo = new Date(now - 8 * 60 * 60 * 1000).toISOString();
  const fourHoursAgo = new Date(now - 4 * 60 * 60 * 1000).toISOString();

  const { data: timers } = await supabaseAdmin
    .from("active_timers")
    .select("user_id, started_at, last_reminded_at")
    .lt("started_at", eightHoursAgo);

  for (const timer of timers ?? []) {
    if (timer.last_reminded_at && timer.last_reminded_at > fourHoursAgo) continue;

    const hours = Math.floor(
      (now - new Date(timer.started_at).getTime()) / (60 * 60 * 1000),
    );

    const sent = await sendPushToUsers([timer.user_id], {
      title: "Your clock is still running",
      body: `You've been clocked in for ${hours} hours. Did you forget to stop the timer?`,
      url: "/",
      tag: "clock-running",
    });

    clockReminders += sent;

    await supabaseAdmin
      .from("active_timers")
      .update({ last_reminded_at: new Date(now).toISOString() })
      .eq("user_id", timer.user_id);
  }

  // 2. Meetings in the next 24 hours with no RSVP yet.
  const today = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(now + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: meetings } = await supabaseAdmin
    .from("meetings")
    .select("id, title, date, time, team_id, locked")
    .gte("date", today)
    .lte("date", tomorrow);

  for (const meeting of meetings ?? []) {
    if (meeting.locked) continue;

    const audience = await audienceForMeeting(meeting.team_id);
    if (audience.length === 0) continue;

    const [{ data: rsvps }, { data: alreadySent }] = await Promise.all([
      supabaseAdmin.from("rsvps").select("user_id").eq("meeting_id", meeting.id),
      supabaseAdmin
        .from("push_reminders_sent")
        .select("user_id")
        .eq("meeting_id", meeting.id)
        .eq("kind", "rsvp_reminder"),
    ]);

    const answered = new Set((rsvps ?? []).map((row) => row.user_id));
    const notified = new Set((alreadySent ?? []).map((row) => row.user_id));

    const pending = audience.filter((id) => !answered.has(id) && !notified.has(id));
    if (pending.length === 0) continue;

    const sent = await sendPushToUsers(pending, {
      title: "RSVP needed",
      body: `${meeting.title} is coming up at ${meeting.time}. Let the team know if you're in.`,
      url: "/meetings",
      tag: `rsvp-needed-${meeting.id}`,
    });

    rsvpReminders += sent;

    await supabaseAdmin.from("push_reminders_sent").insert(
      pending.map((userId) => ({
        user_id: userId,
        meeting_id: meeting.id,
        kind: "rsvp_reminder",
      })),
    );
  }

  return { clockReminders, rsvpReminders };
}
