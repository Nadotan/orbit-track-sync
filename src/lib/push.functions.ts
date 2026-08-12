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

/**
 * Records the currently running clock.
 */
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

/**
 * Called by the browser when the next
 * 3-hour reminder is due.
 */
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

/**
 * New meeting -> immediate Web Push.
 *
 * Recipients do not need POM open.
 */
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

        /*
         * Never trust the client-supplied status.
         *
         * Only notify when the caller really holds an RSVP on
         * this meeting and it really matches the claimed new
         * status (i.e. the change actually happened).
         */
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

/**
 * Existing app-opening RSVP check.
 *
 * This is NOT a periodic scheduler.
 */
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
  });

/**
 * Admin broadcast: sends a Web Push
 * to every registered device.
 */
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
          data: adminRole,
        } =
          await context
            .supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", context.userId)
            .eq("role", "admin")
            .maybeSingle();

        if (!adminRole) {
          throw new Error("Forbidden");
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
          await import("./push.server");

        const {
          data: profiles,
          error,
        } =
          await supabaseAdmin
            .from("profiles")
            .select("id");

        if (error) {
          throw new Error(error.message);
        }

        const sent =
          await sendPushToUsers(
            (profiles ?? []).map(
              (profile) => profile.id,
            ),
            {
              title: data.title,
              body: data.body,
              url: "/",
              tag: `admin-broadcast-${Date.now()}`,
            },
          );

        return { sent };
      },
    );
