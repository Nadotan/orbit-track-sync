import {
  createServerFn,
} from "@tanstack/react-start";

import {
  z,
} from "zod";

import {
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-middleware";

export interface WorkshopStatus {
  isOpen: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const updateWorkshopSchema =
  z.object({
    isOpen:
      z.boolean(),
  });

export const getWorkshopStatus =
  createServerFn({
    method:
      "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async () => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const {
          data:
            status,
          error,
        } =
          await admin
            .from(
              "workshop_status",
            )
            .select(
              "is_open, updated_at, updated_by",
            )
            .eq(
              "id",
              1,
            )
            .maybeSingle();

        if (
          error
        ) {
          throw new Error(
            "Unable to load workshop status.",
          );
        }

        return {
          isOpen:
            status?.is_open ??
            true,

          updatedAt:
            status?.updated_at ??
            null,

          updatedBy:
            status?.updated_by ??
            null,
        } satisfies WorkshopStatus;
      },
    );

export const setWorkshopStatus =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      updateWorkshopSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const {
          data:
            current,
          error:
            currentError,
        } =
          await admin
            .from(
              "workshop_status",
            )
            .select(
              "is_open",
            )
            .eq(
              "id",
              1,
            )
            .maybeSingle();

        if (
          currentError
        ) {
          throw new Error(
            "Unable to read workshop status.",
          );
        }

        const previousOpen =
          current?.is_open ??
          true;

        if (
          previousOpen ===
          data.isOpen
        ) {
          return {
            isOpen:
              data.isOpen,

            changed:
              false,

            pushesSent:
              0,
          };
        }

        const now =
          new Date()
            .toISOString();

        const {
          error:
            updateError,
        } =
          await admin
            .from(
              "workshop_status",
            )
            .upsert(
              {
                id:
                  1,

                is_open:
                  data.isOpen,

                updated_at:
                  now,

                updated_by:
                  context.userId,
              },
              {
                onConflict:
                  "id",
              },
            );

        if (
          updateError
        ) {
          throw new Error(
            "Unable to change workshop status.",
          );
        }

        let pushesSent =
          0;

        /*
         * Send a Push only when the workshop
         * changes from Open -> Closed.
         */
        if (
          previousOpen &&
          !data.isOpen
        ) {
          try {
            const {
              data:
                profiles,
              error:
                profilesError,
            } =
              await admin
                .from(
                  "profiles",
                )
                .select(
                  "id",
                );

            if (
              profilesError
            ) {
              console.error(
                "[workshop] Failed to load push audience",
                profilesError,
              );
            } else {
              /*
               * The person who changed the switch already
               * sees the result immediately in POM.
               */
              const userIds =
                (
                  profiles ??
                  []
                )
                  .map(
                    (
                      profile:
                        any,
                    ) =>
                      profile.id,
                  )
                  .filter(
                    (
                      userId:
                        string,
                    ) =>
                      userId !==
                      context.userId,
                  );

              if (
                userIds.length >
                0
              ) {
                const {
                  sendPushToUsers,
                } =
                  await import(
                    "./push.server"
                  );

                pushesSent =
                  await sendPushToUsers(
                    userIds,
                    {
                      title:
                        "Workshop closed",

                      body:
                        "The workshop is now closed.",

                      url:
                        "/",

                      tag:
                        "workshop-status",
                    },
                  );
              }
            }
          } catch (
            pushError
          ) {
            /*
             * Changing workshop status must still succeed
             * if Push is temporarily unavailable.
             */
            console.error(
              "[workshop] Failed to send closed notification",
              pushError,
            );
          }
        }

        return {
          isOpen:
            data.isOpen,

          changed:
            true,

          pushesSent,
        };
      },
    );