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
  updatedByName: string | null;
}

const updateWorkshopSchema =
  z.object({
    isOpen:
      z.boolean(),
  });

async function getProfileName(
  admin:
    any,

  userId:
    string |
    null |
    undefined,
) {
  if (
    !userId
  ) {
    return null;
  }

  const {
    data:
      profile,
    error,
  } =
    await admin
      .from(
        "profiles",
      )
      .select(
        "name",
      )
      .eq(
        "id",
        userId,
      )
      .maybeSingle();

  if (
    error
  ) {
    console.error(
      "[workshop] Failed to load profile name",
      error,
    );

    return null;
  }

  return (
    profile?.name ??
    null
  );
}

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

        const updatedByName =
          await getProfileName(
            admin,
            status?.updated_by,
          );

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

          updatedByName,
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
              "is_open, updated_at, updated_by",
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
          const updatedByName =
            await getProfileName(
              admin,
              current?.updated_by,
            );

          return {
            isOpen:
              previousOpen,

            changed:
              false,

            pushesSent:
              0,

            updatedAt:
              current?.updated_at ??
              null,

            updatedBy:
              current?.updated_by ??
              null,

            updatedByName,
          };
        }

        const actorName =
          (
            await getProfileName(
              admin,
              context.userId,
            )
          ) ??
          "A team member";

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
         * Send a notification for BOTH directions:
         *
         * Closed -> Open
         * Open   -> Closed
         *
         * The person who moved the switch is excluded because
         * they already see the result immediately in POM.
         */
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
                      data.isOpen
                        ? "Workshop opened"
                        : "Workshop closed",

                    body:
                      data.isOpen
                        ? `${actorName} opened the workshop.`
                        : `${actorName} closed the workshop.`,

                    url:
                      "/meetings",

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
           * The status change must still succeed if Push
           * is temporarily unavailable.
           */
          console.error(
            "[workshop] Failed to send workshop notification",
            pushError,
          );
        }

        return {
          isOpen:
            data.isOpen,

          changed:
            true,

          pushesSent,

          updatedAt:
            now,

          updatedBy:
            context.userId,

          updatedByName:
            actorName,
        };
      },
    );