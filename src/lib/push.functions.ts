import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PushAdminHealthStatus =
  | "working"
  | "blocked"
  | "failing"
  | "untested"
  | "no_push";

export interface PushAdminUserHealth {
  userId: string;
  status: PushAdminHealthStatus;
  registeredDevices: number;
  workingDevices: number;
  failingDevices: number;
  untestedDevices: number;
  reportingClients: number;
  blockedClients: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureStatus: number | null;
  lastFailureMessage: string | null;
  lastPermission: "granted" | "denied" | "default" | "unsupported" | null;
  lastPermissionAt: string | null;
}

const PUSH_WORKING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(500),
  auth: z.string().min(1).max(500),
});

const endpointSchema = z.object({
  endpoint: z.string().url().max(2000),
});

const pushClientStatusSchema = z.object({
  clientId: z.string().uuid(),
  permission: z.enum(["granted", "denied", "default", "unsupported"]),
  endpoint: z.string().url().max(2000).nullable(),
});

const meetingSchema = z.object({
  meetingId: z.string().uuid(),
});

const rsvpChangeSchema = z.object({
  meetingId: z.string().uuid(),
  status: z.enum(["Attending", "Declined"]),
  previousStatus: z.enum(["Attending", "Declined"]).nullable(),
});

const timerSchema = z.object({
  startedAt: z.string().datetime(),
});

function timestampMs(value: string | null | undefined) {
  if (!value) return null;

  const parsed = new Date(value).getTime();

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function latestTimestamp(
  values: Array<string | null | undefined>,
) {
  let bestValue: string | null = null;
  let bestMs = -Infinity;

  for (const value of values) {
    const ms = timestampMs(value);

    if (
      ms === null ||
      ms <= bestMs
    ) {
      continue;
    }

    bestMs = ms;
    bestValue = value ?? null;
  }

  return bestValue;
}

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
          ok: true,
        };
      },
    );

export const removePushSubscription =
  createServerFn({
    method: "POST",
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
          ok: true,
        };
      },
    );

export const reportPushClientStatus =
  createServerFn({
    method: "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      pushClientStatusSchema,
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

        const now =
          new Date()
            .toISOString();

        const [
          {
            data:
              existing,
            error:
              existingError,
          },

          endpointResult,
        ] =
          await Promise.all([
            (
              supabaseAdmin as any
            )
              .from(
                "push_clients",
              )
              .select(
                "ever_registered_at",
              )
              .eq(
                "user_id",
                context.userId,
              )
              .eq(
                "client_id",
                data.clientId,
              )
              .maybeSingle(),

            data.endpoint
              ? supabaseAdmin
                  .from(
                    "push_subscriptions",
                  )
                  .select(
                    "endpoint",
                  )
                  .eq(
                    "user_id",
                    context.userId,
                  )
                  .eq(
                    "endpoint",
                    data.endpoint,
                  )
                  .maybeSingle()
              : Promise.resolve({
                  data: null,
                  error: null,
                }),
          ]);

        if (
          existingError
        ) {
          console.error(
            "[push] Failed to load push client state",
            existingError,
          );

          throw new Error(
            existingError.message,
          );
        }

        if (
          endpointResult.error
        ) {
          console.error(
            "[push] Failed to verify push client endpoint",
            endpointResult.error,
          );

          throw new Error(
            endpointResult.error.message,
          );
        }

        const verifiedEndpoint =
          endpointResult
            .data
            ?.endpoint ??
          null;

        const everRegisteredAt =
          existing
            ?.ever_registered_at ??
          (
            verifiedEndpoint
              ? now
              : null
          );

        const {
          error,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "push_clients",
            )
            .upsert(
              {
                user_id:
                  context.userId,

                client_id:
                  data.clientId,

                endpoint:
                  verifiedEndpoint,

                permission:
                  data.permission,

                last_seen_at:
                  now,

                ever_registered_at:
                  everRegisteredAt,
              },

              {
                onConflict:
                  "user_id,client_id",
              },
            );

        if (error) {
          console.error(
            "[push] Failed to save push client state",
            error,
          );

          throw new Error(
            error.message,
          );
        }

        return {
          ok: true,
        };
      },
    );

export const markTimerRunning =
  createServerFn({
    method: "POST",
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
          ok: true,
        };
      },
    );

export const markTimerStopped =
  createServerFn({
    method: "POST",
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
          ok: true,
        };
      },
    );

export const sendClockReminder =
  createServerFn({
    method: "POST",
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
    method: "POST",
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
            sent: 0,
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
    method: "POST",
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
            sent: 0,
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
            sent: 0,
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
    method: "POST",
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
    method: "GET",
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

        const [
          subscriptionsResult,
          clientsResult,
        ] =
          await Promise.all([
            (
              supabaseAdmin as any
            )
              .from(
                "push_subscriptions",
              )
              .select(
                "user_id, endpoint, last_attempt_at, last_success_at, last_failure_at, last_failure_status, last_failure_message",
              ),

            (
              supabaseAdmin as any
            )
              .from(
                "push_clients",
              )
              .select(
                "user_id, client_id, endpoint, permission, last_seen_at, ever_registered_at",
              ),
          ]);

        if (
          subscriptionsResult.error
        ) {
          throw new Error(
            subscriptionsResult
              .error
              .message,
          );
        }

        if (
          clientsResult.error
        ) {
          throw new Error(
            clientsResult
              .error
              .message,
          );
        }

        type SubscriptionHealthRow = {
          user_id: string;
          endpoint: string;
          last_attempt_at: string | null;
          last_success_at: string | null;
          last_failure_at: string | null;
          last_failure_status: number | null;
          last_failure_message: string | null;
        };

        type ClientHealthRow = {
          user_id: string;
          client_id: string;
          endpoint: string | null;
          permission:
            | "granted"
            | "denied"
            | "default"
            | "unsupported";
          last_seen_at: string;
          ever_registered_at: string | null;
        };

        const subscriptions =
          (
            subscriptionsResult
              .data ??
            []
          ) as SubscriptionHealthRow[];

        const clients =
          (
            clientsResult
              .data ??
            []
          ) as ClientHealthRow[];

        const userIds =
          [
            ...new Set([
              ...subscriptions.map(
                (row) =>
                  row.user_id,
              ),

              ...clients.map(
                (row) =>
                  row.user_id,
              ),
            ]),
          ];

        const now =
          Date.now();

        const userStatuses:
          PushAdminUserHealth[] =
          userIds.map(
            (
              userId,
            ) => {
              const userSubscriptions =
                subscriptions.filter(
                  (row) =>
                    row.user_id ===
                    userId,
                );

              const userClients =
                clients.filter(
                  (row) =>
                    row.user_id ===
                    userId,
                );

              let workingDevices =
                0;

              let failingDevices =
                0;

              let untestedDevices =
                0;

              const failingSubscriptionRows:
                SubscriptionHealthRow[] =
                [];

              for (
                const row of
                userSubscriptions
              ) {
                const successMs =
                  timestampMs(
                    row.last_success_at,
                  );

                const failureMs =
                  timestampMs(
                    row.last_failure_at,
                  );

                if (
                  failureMs !==
                    null &&
                  (
                    successMs ===
                      null ||
                    failureMs >
                      successMs
                  )
                ) {
                  failingDevices +=
                    1;

                  failingSubscriptionRows.push(
                    row,
                  );

                  continue;
                }

                if (
                  successMs !==
                    null &&
                  now -
                    successMs <=
                    PUSH_WORKING_WINDOW_MS
                ) {
                  workingDevices +=
                    1;

                  continue;
                }

                untestedDevices +=
                  1;
              }

              const registeredClients =
                userClients.filter(
                  (row) =>
                    row.ever_registered_at !==
                    null,
                );

              const blockedClients =
                registeredClients.filter(
                  (row) =>
                    row.permission !==
                    "granted",
                ).length;

              const allRegisteredClientsBlocked =
                registeredClients.length >
                  0 &&
                blockedClients ===
                  registeredClients.length;

              let status:
                PushAdminHealthStatus;

              if (
                workingDevices >
                0
              ) {
                status =
                  "working";
              } else if (
                blockedClients >
                  0 &&
                (
                  userSubscriptions.length ===
                    0 ||
                  allRegisteredClientsBlocked
                )
              ) {
                status =
                  "blocked";
              } else if (
                failingDevices >
                0
              ) {
                status =
                  "failing";
              } else if (
                userSubscriptions.length >
                0
              ) {
                status =
                  "untested";
              } else {
                status =
                  "no_push";
              }

              const failureRowsForDetails =
                failingSubscriptionRows.length >
                0
                  ? failingSubscriptionRows
                  : userSubscriptions;

              const latestFailureRow =
                failureRowsForDetails
                  .reduce<
                    SubscriptionHealthRow | null
                  >(
                    (
                      latest,
                      row,
                    ) => {
                      const rowMs =
                        timestampMs(
                          row.last_failure_at,
                        );

                      const latestMs =
                        timestampMs(
                          latest
                            ?.last_failure_at,
                        );

                      if (
                        rowMs ===
                        null
                      ) {
                        return latest;
                      }

                      if (
                        latestMs ===
                          null ||
                        rowMs >
                          latestMs
                      ) {
                        return row;
                      }

                      return latest;
                    },

                    null,
                  );

              const latestClient =
                userClients
                  .reduce<
                    ClientHealthRow | null
                  >(
                    (
                      latest,
                      row,
                    ) => {
                      const rowMs =
                        timestampMs(
                          row.last_seen_at,
                        );

                      const latestMs =
                        timestampMs(
                          latest
                            ?.last_seen_at,
                        );

                      if (
                        rowMs ===
                        null
                      ) {
                        return latest;
                      }

                      if (
                        latestMs ===
                          null ||
                        rowMs >
                          latestMs
                      ) {
                        return row;
                      }

                      return latest;
                    },

                    null,
                  );

              return {
                userId,
                status,

                registeredDevices:
                  userSubscriptions.length,

                workingDevices,
                failingDevices,
                untestedDevices,

                reportingClients:
                  userClients.length,

                blockedClients,

                lastAttemptAt:
                  latestTimestamp(
                    userSubscriptions.map(
                      (row) =>
                        row.last_attempt_at,
                    ),
                  ),

                lastSuccessAt:
                  latestTimestamp(
                    userSubscriptions.map(
                      (row) =>
                        row.last_success_at,
                    ),
                  ),

                lastFailureAt:
                  latestFailureRow
                    ?.last_failure_at ??
                  null,

                lastFailureStatus:
                  latestFailureRow
                    ?.last_failure_status ??
                  null,

                lastFailureMessage:
                  latestFailureRow
                    ?.last_failure_message ??
                  null,

                lastPermission:
                  latestClient
                    ?.permission ??
                  null,

                lastPermissionAt:
                  latestClient
                    ?.last_seen_at ??
                  null,
              };
            },
          );

        const enabledUserIds =
          userStatuses
            .filter(
              (status) =>
                status.registeredDevices >
                0,
            )
            .map(
              (status) =>
                status.userId,
            );

        return {
          enabledUserIds,
          userStatuses,
          workingWindowDays:
            30,
        };
      },
    );

export const broadcastPush =
  createServerFn({
    method: "POST",
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
              sent: 0,
              recipients: 0,
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

          if (error) {
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

          if (error) {
            throw new Error(
              error.message,
            );
          }

          targetUserIds =
            [
              ...new Set<string>(
                (
                  subscriptions ??
                  []
                ).map(
                  (subscription) =>
                    String(
                      subscription.user_id,
                    ),
                ),
              ),
            ];
        }

        if (
          targetUserIds.length ===
          0
        ) {
          return {
            sent: 0,
            recipients: 0,
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