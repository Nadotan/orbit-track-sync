import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const subscriptionSchema =
  z.object({
    endpoint:
      z.string()
        .url()
        .max(2000),

    p256dh:
      z.string()
        .min(1)
        .max(500),

    auth:
      z.string()
        .min(1)
        .max(500),
  });

const endpointSchema =
  z.object({
    endpoint:
      z.string()
        .url()
        .max(2000),
  });

const meetingSchema =
  z.object({
    meetingId:
      z.string()
        .uuid(),
  });

const rsvpChangeSchema =
  z.object({
    meetingId:
      z.string()
        .uuid(),

    status:
      z.enum([
        "Attending",
        "Declined",
      ]),

    previousStatus:
      z
        .enum([
          "Attending",
          "Declined",
        ])
        .nullable(),
  });

const timerSchema =
  z.object({
    startedAt:
      z.string()
        .datetime(),
  });

export const savePushSubscription =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      subscriptionSchema,
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

        const {
          error,
        } =
          await supabaseAdmin
            .from(
              "push_subscriptions",
            )
            .upsert(
              {
                user_id:
                  context.userId,

                endpoint:
                  data.endpoint,

                p256dh:
                  data.p256dh,

                auth:
                  data.auth,
              },

              {
                onConflict:
                  "endpoint",
              },
            );

        if (error) {
          console.error(
            "[push] Failed to save push subscription",
            error,
          );

          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const removePushSubscription =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      endpointSchema,
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

        const {
          error,
        } =
          await supabaseAdmin
            .from(
              "push_subscriptions",
            )
            .delete()
            .eq(
              "user_id",
              context.userId,
            )
            .eq(
              "endpoint",
              data.endpoint,
            );

        if (error) {
          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const markTimerRunning =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      timerSchema,
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

        const {
          error,
        } =
          await supabaseAdmin
            .from(
              "active_timers",
            )
            .upsert(
              {
                user_id:
                  context.userId,

                started_at:
                  data.startedAt,

                last_reminded_at:
                  null,
              },

              {
                onConflict:
                  "user_id",
              },
            );

        if (error) {
          console.error(
            "[push] Failed to save running timer",
            error,
          );

          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const markTimerStopped =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          error,
        } =
          await supabaseAdmin
            .from(
              "active_timers",
            )
            .delete()
            .eq(
              "user_id",
              context.userId,
            );

        if (error) {
          console.error(
            "[push] Failed to stop active timer",
            error,
          );

          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const sendClockReminder =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          sendClockRunningReminder,
        } =
          await import(
            "./push.server"
          );

        return sendClockRunningReminder(
          context.userId,
        );
      },
    );

export const notifyMeetingCreated =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      meetingSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          data:
            adminRole,
        } =
          await context
            .supabase
            .from(
              "user_roles",
            )
            .select(
              "role",
            )
            .eq(
              "user_id",
              context.userId,
            )
            .eq(
              "role",
              "admin",
            )
            .maybeSingle();

        const isAdmin =
          Boolean(
            adminRole,
          );

        if (
          !isAdmin
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          sendPushToUsers,
          audienceForMeeting,
        } =
          await import(
            "./push.server"
          );

        const {
          data:
            meeting,
          error:
            meetingError,
        } =
          await supabaseAdmin
            .from(
              "meetings",
            )
            .select(
              "id, title, date, time, team_id",
            )
            .eq(
              "id",
              data.meetingId,
            )
            .maybeSingle();

        if (
          meetingError
        ) {
          throw new Error(
            meetingError.message,
          );
        }

        if (
          !meeting
        ) {
          return {
            sent:
              0,
          };
        }

        const audience =
          (
            await audienceForMeeting(
              meeting.team_id,
            )
          ).filter(
            (id) =>
              id !==
              context.userId,
          );

        const sent =
          await sendPushToUsers(
            audience,
            {
              title:
                "New meeting scheduled",

              body:
                `${meeting.title} — ${meeting.date} at ${meeting.time}. Tap to RSVP.`,

              url:
                "/meetings",

              tag:
                `meeting-${meeting.id}`,
            },
          );

        return {
          sent,
        };
      },
    );

export const notifyRsvpChange =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      rsvpChangeSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        if (
          !data.previousStatus ||
          data.previousStatus ===
            data.status
        ) {
          return {
            sent:
              0,
          };
        }

        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          data:
            storedRsvp,
          error:
            storedRsvpError,
        } =
          await supabaseAdmin
            .from(
              "rsvps",
            )
            .select(
              "status",
            )
            .eq(
              "meeting_id",
              data.meetingId,
            )
            .eq(
              "user_id",
              context.userId,
            )
            .maybeSingle();

        if (
          storedRsvpError ||
          !storedRsvp ||
          storedRsvp.status !==
            data.status
        ) {
          return {
            sent:
              0,
          };
        }

        const {
          sendPushToUsers,
          adminUserIds,
        } =
          await import(
            "./push.server"
          );

        const [
          {
            data:
              meeting,
          },

          {
            data:
              profile,
          },
        ] =
          await Promise.all([
            supabaseAdmin
              .from(
                "meetings",
              )
              .select(
                "title",
              )
              .eq(
                "id",
                data.meetingId,
              )
              .maybeSingle(),

            supabaseAdmin
              .from(
                "profiles",
              )
              .select(
                "name",
              )
              .eq(
                "id",
                context.userId,
              )
              .maybeSingle(),
          ]);

        const who =
          profile?.name ??
          "Someone";

        const admins =
          (
            await adminUserIds()
          ).filter(
            (id) =>
              id !==
              context.userId,
          );

        const sent =
          await sendPushToUsers(
            admins,
            {
              title:
                "Attendance changed",

              body:
                data.status ===
                "Attending"
                  ? `${who} switched to attending ${meeting?.title ?? "a meeting"}.`
                  : `${who} switched to not attending ${meeting?.title ?? "a meeting"}.`,

              url:
                "/meetings",

              tag:
                `rsvp-${data.meetingId}-${context.userId}`,
            },
          );

        return {
          sent,
        };
      },
    );

export const sweepReminders =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async () => {
        const {
          runReminderSweepThrottled,
        } =
          await import(
            "./push.server"
          );

        return runReminderSweepThrottled();
      },
    );

const broadcastSchema =
  z.object({
    title:
      z.string()
        .trim()
        .min(1)
        .max(80),

    body:
      z.string()
        .trim()
        .min(1)
        .max(300),

    userIds:
      z
        .array(
          z.string()
            .uuid(),
        )
        .max(500)
        .optional(),
  });

export const getPushAdminStatus =
  createServerFn({
    method:
      "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          data:
            adminRole,
        } =
          await context
            .supabase
            .from(
              "user_roles",
            )
            .select(
              "role",
            )
            .eq(
              "user_id",
              context.userId,
            )
            .eq(
              "role",
              "admin",
            )
            .maybeSingle();

        if (
          !adminRole
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          data,
          error,
        } =
          await supabaseAdmin
            .from(
              "push_subscriptions",
            )
            .select(
              "user_id",
            );

        if (
          error
        ) {
          throw new Error(
            error.message,
          );
        }

        const enabledUserIds =
          [
            ...new Set(
              (
                data ??
                []
              ).map(
                (row) =>
                  row.user_id,
              ),
            ),
          ];

        return {
          enabledUserIds,
        };
      },
    );

export const broadcastPush =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      broadcastSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          data:
            adminRole,
        } =
          await context
            .supabase
            .from(
              "user_roles",
            )
            .select(
              "role",
            )
            .eq(
              "user_id",
              context.userId,
            )
            .eq(
              "role",
              "admin",
            )
            .maybeSingle();

        if (
          !adminRole
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const {
          sendPushToUsers,
        } =
          await import(
            "./push.server"
          );

        let targetUserIds:
          string[];

        if (
          data.userIds
        ) {
          const requested =
            [
              ...new Set(
                data.userIds,
              ),
            ];

          if (
            requested.length ===
            0
          ) {
            return {
              sent:
                0,

              recipients:
                0,
            };
          }

          const {
            data:
              profiles,
            error,
          } =
            await supabaseAdmin
              .from(
                "profiles",
              )
              .select(
                "id",
              )
              .in(
                "id",
                requested,
              );

          if (
            error
          ) {
            throw new Error(
              error.message,
            );
          }

          targetUserIds =
            (
              profiles ??
              []
            ).map(
              (profile) =>
                profile.id,
            );
        } else {
          /*
           * "Everyone" means everyone who actually
           * has at least one registered push device.
           *
           * Do not build the audience from profiles.
           * The push subscription table is the
           * source of truth for push recipients.
           */
          const {
            data:
              subscriptions,
            error,
          } =
            await supabaseAdmin
              .from(
                "push_subscriptions",
              )
              .select(
                "user_id",
              );

          if (
            error
          ) {
            throw new Error(
              error.message,
            );
          }

          targetUserIds =
            [
              ...new Set(
                (
                  subscriptions ??
                  []
                ).map(
                  (subscription) =>
                    subscription.user_id,
                ),
              ),
            ];
        }

        if (
          targetUserIds.length ===
          0
        ) {
          return {
            sent:
              0,

            recipients:
              0,
          };
        }

        const sent =
          await sendPushToUsers(
            targetUserIds,
            {
              title:
                data.title,

              body:
                data.body,

              url:
                "/",

              tag:
                `admin-broadcast-${Date.now()}`,
            },
          );

        return {
          sent,

          recipients:
            targetUserIds.length,
        };
      },
    );