import { createFileRoute } from "@tanstack/react-router";

/** Scheduled reminder sweep: forgotten running clocks and un-answered meeting invites. */
export const Route = createFileRoute("/api/public/cron/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");

        if (!secret || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

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

        return Response.json({ clockReminders, rsvpReminders });
      },
    },
  },
});
