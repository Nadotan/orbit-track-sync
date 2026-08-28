import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled notification sweep:
 * - unanswered meeting RSVP reminders
 * - reminders to attending members who forgot to start The Clock
 */
export const Route = createFileRoute("/api/public/cron/reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CRON_SECRET"];
        const provided = request.headers.get("x-cron-secret");

        if (!secret || provided !== secret) {
          return new Response("Unauthorized", {
            status: 401,
          });
        }

        const [
          { runReminderSweep },
          { runAttendanceClockReminderSweep },
        ] = await Promise.all([
          import("@/lib/push.server"),
          import("@/lib/attendance-clock-reminders.server"),
        ]);

        const reminderResult = await runReminderSweep();
        const clockResult =
          await runAttendanceClockReminderSweep();

        return Response.json({
          ...reminderResult,
          ...clockResult,
        });
      },
    },
  },
});