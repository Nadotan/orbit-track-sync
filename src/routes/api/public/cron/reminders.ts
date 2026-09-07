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

        const publishableKey =
          process.env["SUPABASE_PUBLISHABLE_KEY"] ??
          process.env["SUPABASE_ANON_KEY"];

        const scheduledKey =
          request.headers.get("apikey");

        const validCronSecret =
          Boolean(secret) &&
          provided === secret;

        const validScheduledKey =
          Boolean(publishableKey) &&
          scheduledKey === publishableKey;

        if (!validCronSecret && !validScheduledKey) {
          return new Response("Unauthorized", {
            status: 401,
          });
        }

        try {
          const { runReminderSweep } = await import("@/lib/push.server");
          const result = await runReminderSweep();

          return Response.json(result);
        } catch (error) {
          console.error(
            "[cron] Reminder sweep failed",
            error,
          );

          return Response.json(
            {
              error:
                "Reminder sweep failed",
            },
            {
              status: 500,
            },
          );
        }
      },
    },
  },
});