import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function secretsMatch(
  provided: string | null,
  expected: string | undefined | null,
) {
  if (!provided || !expected) {
    return false;
  }

  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

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

        let authorized = secretsMatch(
          provided,
          secret,
        );

        if (!authorized && provided) {
          const { supabaseAdmin } = await import(
            "@/integrations/supabase/client.server"
          );

          const {
            data: schedulerSecret,
            error: schedulerSecretError,
          } = await (supabaseAdmin as any)
            .from("scheduler_secrets")
            .select("secret")
            .eq("name", "reminder_sweep")
            .maybeSingle();

          if (schedulerSecretError) {
            console.error(
              "[cron] Failed to validate scheduler",
              schedulerSecretError,
            );
          }

          authorized = secretsMatch(
            provided,
            schedulerSecret?.secret,
          );
        }

        if (!authorized) {
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