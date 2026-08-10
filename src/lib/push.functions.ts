import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

const endpointSchema = z.object({
  endpoint: z.string().url().max(2000),
});

const meetingSchema = z.object({
  meetingId: z.string().uuid(),
});

const rsvpChangeSchema = z.object({
  meetingId: z.string().uuid(),
  status: z.enum(["Attending", "Declined"]),
  previousStatus: z.enum(["Attending", "Declined"]).nullable(),
});

const timerSchema = z.object({
  startedAt: z.string().min(1).max(40),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(subscriptionSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
      },
      { onConflict: "endpoint" },
    );

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(endpointSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint);

    return { ok: true };
  });

/** Records that the caller's clock is running, so they can be reminded later. */
export const markTimerRunning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(timerSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("active_timers").upsert(
      {
        user_id: context.userId,
        started_at: data.startedAt,
        last_reminded_at: null,
      },
      { onConflict: "user_id" },
    );

    return { ok: true };
  });

export const markTimerStopped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await supabaseAdmin.from("active_timers").delete().eq("user_id", context.userId);

    return { ok: true };
  });

/** Notifies the meeting's audience that a new meeting was scheduled. */
export const notifyMeetingCreated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(meetingSchema)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });

    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUsers, audienceForMeeting } = await import("./push.server");

    const { data: meeting } = await supabaseAdmin
      .from("meetings")
      .select("id, title, date, time, team_id")
      .eq("id", data.meetingId)
      .maybeSingle();

    if (!meeting) return { sent: 0 };

    const audience = (await audienceForMeeting(meeting.team_id)).filter(
      (id) => id !== context.userId,
    );

    const sent = await sendPushToUsers(audience, {
      title: "New meeting scheduled",
      body: `${meeting.title} — ${meeting.date} at ${meeting.time}. Tap to RSVP.`,
      url: "/meetings",
      tag: `meeting-${meeting.id}`,
    });

    return { sent };
  });

/** Tells admins when someone flips their attendance answer. */
export const notifyRsvpChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(rsvpChangeSchema)
  .handler(async ({ data, context }) => {
    if (!data.previousStatus || data.previousStatus === data.status) {
      return { sent: 0 };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendPushToUsers, adminUserIds } = await import("./push.server");

    const [{ data: meeting }, { data: profile }] = await Promise.all([
      supabaseAdmin.from("meetings").select("title").eq("id", data.meetingId).maybeSingle(),
      supabaseAdmin.from("profiles").select("name").eq("id", context.userId).maybeSingle(),
    ]);

    const who = profile?.name ?? "Someone";
    const admins = (await adminUserIds()).filter((id) => id !== context.userId);

    const sent = await sendPushToUsers(admins, {
      title: "Attendance changed",
      body:
        data.status === "Attending"
          ? `${who} switched to attending ${meeting?.title ?? "a meeting"}.`
          : `${who} switched to not attending ${meeting?.title ?? "a meeting"}.`,
      url: "/meetings",
      tag: `rsvp-${data.meetingId}-${context.userId}`,
    });

    return { sent };
  });
