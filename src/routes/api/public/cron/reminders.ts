import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function secretsMatch(
  provided: string | null,
  expected: string | undefined | null,
) {
  if (
    !provided ||
    !expected
  ) {
    return false;
  }

  const providedBytes =
    Buffer.from(
      provided,
    );

  const expectedBytes =
    Buffer.from(
      expected,
    );

  return (
    providedBytes.length ===
      expectedBytes.length &&
    timingSafeEqual(
      providedBytes,
      expectedBytes,
    )
  );
}

/**
 * Daily scheduled notification endpoint.
 *
 * The only automated reminder left is the day-before RSVP reminder.
 * Clock reminders and overdue-task reminder sweeps are intentionally disabled.
 */
export const Route =
  createFileRoute(
    "/api/public/cron/reminders",
  )({
    server: {
      handlers: {
        POST:
          async ({
            request,
          }) => {
            const secret =
              process.env[
                "CRON_SECRET"
              ];

            const provided =
              request.headers.get(
                "x-cron-secret",
              );

            let authorized =
              secretsMatch(
                provided,
                secret,
              );

            if (
              !authorized &&
              provided
            ) {
              const {
                supabaseAdmin,
              } =
                await import(
                  "@/integrations/supabase/client.server"
                );

              const {
                data:
                  schedulerSecret,
                error:
                  schedulerSecretError,
              } =
                await (
                  supabaseAdmin as any
                )
                  .from(
                    "scheduler_secrets",
                  )
                  .select(
                    "secret",
                  )
                  .eq(
                    "name",
                    "reminder_sweep",
                  )
                  .maybeSingle();

              if (
                schedulerSecretError
              ) {
                console.error(
                  "[cron] Failed to validate scheduler",
                  schedulerSecretError,
                );
              }

              authorized =
                secretsMatch(
                  provided,
                  schedulerSecret?.secret,
                );
            }

            if (
              !authorized
            ) {
              return new Response(
                "Unauthorized",
                {
                  status:
                    401,
                },
              );
            }

            try {
              const {
                runRsvpReminderSweep,
              } =
                await import(
                  "@/lib/rsvp-reminders.server"
                );

              const result =
                await runRsvpReminderSweep();

              return Response.json(
                result,
              );
            } catch (
              error
            ) {
              console.error(
                "[cron] RSVP reminder sweep failed",
                error,
              );

              return Response.json(
                {
                  error:
                    "RSVP reminder sweep failed",
                },
                {
                  status:
                    500,
                },
              );
            }
          },
      },
    },
  });