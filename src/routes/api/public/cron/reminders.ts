import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled notification sweep:
 * - unanswered meeting RSVP reminders
 * - overdue task reminders
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

        const { runReminderSweep } = await import("@/lib/push.server");
        const result = await runReminderSweep();

        return Response.json(result);
      },
    },
  },
});