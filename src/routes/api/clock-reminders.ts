import {
  createFileRoute,
} from "@tanstack/react-router";

let lastSweepAt = 0;

export const Route =
  createFileRoute(
    "/api/clock-reminders",
  )({
    server: {
      handlers: {
        POST:
          async () => {
            /*
             * Lightweight additional
             * protection against the
             * same server instance being
             * hammered repeatedly.
             */
            const now =
              Date.now();

            if (
              now -
                lastSweepAt <
              60_000
            ) {
              return Response.json({
                ok: true,
                skipped:
                  true,
              });
            }

            lastSweepAt =
              now;

            try {
              const {
                runClockReminderSweep,
              } =
                await import(
                  "@/lib/push.server"
                );

              await runClockReminderSweep();

              /*
               * Deliberately don't
               * expose user counts or
               * any user information.
               */
              return Response.json({
                ok: true,
              });
            } catch (
              error
            ) {
              console.error(
                "Clock reminder sweep failed:",
                error,
              );

              return Response.json(
                {
                  ok:
                    false,
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