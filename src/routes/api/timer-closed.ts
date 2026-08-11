import { createFileRoute } from "@tanstack/react-router";

export const Route =
  createFileRoute(
    "/api/timer-closed",
  )({
    server: {
      handlers: {
        POST:
          async ({
            request,
          }) => {
            try {
              const authHeader =
                request.headers.get(
                  "authorization",
                );

              if (
                !authHeader?.startsWith(
                  "Bearer ",
                )
              ) {
                return new Response(
                  null,
                  {
                    status:
                      401,
                  },
                );
              }

              const token =
                authHeader.slice(
                  7,
                );

              const {
                supabaseAdmin,
              } =
                await import(
                  "@/integrations/supabase/client.server"
                );

              /*
               * Verify the access token with
               * Supabase Auth.
               *
               * Never trust a user ID sent
               * directly from the browser.
               */
              const {
                data: {
                  user,
                },
                error,
              } =
                await supabaseAdmin
                  .auth
                  .getUser(
                    token,
                  );

              if (
                error ||
                !user
              ) {
                return new Response(
                  null,
                  {
                    status:
                      401,
                  },
                );
              }

              const {
                sendClockClosedPush,
              } =
                await import(
                  "@/lib/push.server"
                );

              await sendClockClosedPush(
                user.id,
              );

              return new Response(
                null,
                {
                  status:
                    204,
                },
              );
            } catch (
              error
            ) {
              console.error(
                "[push] Timer-close endpoint failed",
                error,
              );

              return new Response(
                null,
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