import {
  createServerFn,
} from "@tanstack/react-start";

import { z } from "zod";

import {
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-middleware";

const subscriptionSchema =
  z.object({
    endpoint:
      z.string().url(),

    expirationTime:
      z.number()
        .nullable()
        .optional(),

    keys:
      z.object({
        p256dh:
          z.string().min(1),

        auth:
          z.string().min(1),
      }),
  });

const clockSchema =
  z.object({
    startedAt:
      z.string()
        .datetime()
        .nullable(),
  });

const meetingPushSchema =
  z.object({
    title:
      z.string()
        .trim()
        .min(1)
        .max(200),

    date:
      z.string()
        .min(1)
        .max(40),

    time:
      z.string()
        .min(1)
        .max(40),

    teamId:
      z.string()
        .nullable(),
  });

export const getPushPublicKey =
  createServerFn({
    method: "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async () => {
        const {
          getVapidPublicKey,
        } =
          await import(
            "@/lib/push.server"
          );

        return {
          publicKey:
            getVapidPublicKey(),
        };
      },
    );

export const savePushSubscription =
  createServerFn({
    method: "POST",
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
          savePushSubscriptionForUser,
        } =
          await import(
            "@/lib/push.server"
          );

        await savePushSubscriptionForUser(
          context.userId,
          data,
        );

        return {
          success: true,
        };
      },
    );

export const setClockStatus =
  createServerFn({
    method: "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      clockSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          setUserClockStatus,
        } =
          await import(
            "@/lib/push.server"
          );

        await setUserClockStatus(
          context.userId,
          data.startedAt,
        );

        return {
          success: true,
        };
      },
    );

export const broadcastNewMeetingPush =
  createServerFn({
    method: "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      meetingPushSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          isAdminUser,
          sendNewMeetingPush,
        } =
          await import(
            "@/lib/push.server"
          );

        const admin =
          await isAdminUser(
            context.userId,
          );

        if (!admin) {
          throw new Error(
            "Only administrators can send meeting notifications.",
          );
        }

        return sendNewMeetingPush({
          creatorUserId:
            context.userId,

          title:
            data.title,

          date:
            data.date,

          time:
            data.time,

          teamId:
            data.teamId,
        });
      },
    );