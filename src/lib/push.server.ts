import { buildPushPayload } from "@block65/webcrypto-web-push";

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

const THREE_HOURS_MS =
  3 * 60 * 60 * 1000;

function vapidKeys() {
  return {
    subject:
      process.env["VAPID_SUBJECT"] ??
      "mailto:notifications@chrona.app",

    publicKey:
      process.env["VAPID_PUBLIC_KEY"],

    privateKey:
      process.env["VAPID_PRIVATE_KEY"],
  };
}

/**
 * Send Web Push to every registered device
 * belonging to the supplied users.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
) {
  const unique = [
    ...new Set(
      userIds.filter(Boolean),
    ),
  ];

  if (unique.length === 0) {
    return 0;
  }

  const vapid =
    vapidKeys();

  if (
    !vapid.publicKey ||
    !vapid.privateKey
  ) {
    console.error(
      "[push] Missing VAPID keys",
    );

    return 0;
  }

  const {
    data: subscriptions,
    error,
  } =
    await supabaseAdmin
      .from("push_subscriptions")
      .select(
        "id, endpoint, p256dh, auth",
      )
      .in(
        "user_id",
        unique,
      );

  if (error) {
    console.error(
      "[push] Failed to load subscriptions",
      error,
    );

    return 0;
  }

  let sent = 0;

  const stale: string[] =
    [];

  await Promise.all(
    (
      subscriptions ??
      []
    ).map(
      async (row) => {
        const subscription = {
          endpoint:
            row.endpoint,

          expirationTime:
            null,

          keys: {
            p256dh:
              row.p256dh,

            auth:
              row.auth,
          },
        };

        try {
          const request =
            await buildPushPayload(
              {
                data: {
                  ...payload,
                } as Record<
                  string,
                  string
                >,

                options: {
                  ttl:
                    60 *
                    60 *
                    12,
                },
              },

              subscription,
              vapid,
            );

          const response =
            await fetch(
              row.endpoint,
              {
                method:
                  request.method,

                headers:
                  request.headers as unknown as HeadersInit,

                body:
                  request.body as BodyInit,
              },
            );

          if (
            response.status === 404 ||
            response.status === 410
          ) {
            stale.push(
              row.id,
            );

            return;
          }

          if (
            !response.ok
          ) {
            console.error(
              "[push] Delivery failed",
              response.status,
              await response.text(),
            );

            return;
          }

          sent += 1;
        } catch (
          pushError
        ) {
          console.error(
            "[push] Delivery error",
            pushError,
          );
        }
      },
    ),
  );

  if (
    stale.length > 0
  ) {
    const {
      error:
        deleteError,
    } =
      await supabaseAdmin
        .from(
          "push_subscriptions",
        )
        .delete()
        .in(
          "id",
          stale,
        );

    if (deleteError) {
      console.error(
        "[push] Failed to delete stale subscriptions",
        deleteError,
      );
    }
  }

  return sent;
}

/**
 * Meeting audience:
 *
 * General meeting -> everyone
 * Team meeting -> users belonging to that team
 */
export async function audienceForMeeting(
  teamId:
    | string
    | null,
) {
  const query =
    supabaseAdmin
      .from("profiles")
      .select("id");

  const {
    data,
    error,
  } =
    teamId
      ? await query.eq(
          "team_id",
          teamId,
        )
      : await query;

  if (error) {
    console.error(
      "[push] Failed to load meeting audience",
      error,
    );

    return [];
  }

  return (
    data ??
    []
  ).map(
    (profile) =>
      profile.id,
  );
}

export async function adminUserIds() {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "user_roles",
      )
      .select(
        "user_id",
      )
      .eq(
        "role",
        "admin",
      );

  if (error) {
    console.error(
      "[push] Failed to load admins",
      error,
    );

    return [];
  }

  return (
    data ??
    []
  ).map(
    (row) =>
      row.user_id,
  );
}

/**
 * Called when Chrona is closed while
 * the user's clock is still running.
 *
 * This DOES NOT stop the clock.
 */
export async function sendClockClosedPush(
  userId: string,
) {
  const {
    data: timer,
    error,
  } =
    await supabaseAdmin
      .from(
        "active_timers",
      )
      .select(
        "started_at",
      )
      .eq(
        "user_id",
        userId,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "[push] Failed to check active timer",
      error,
    );

    return 0;
  }

  if (!timer) {
    return 0;
  }

  const startedAt =
    new Date(
      timer.started_at,
    ).getTime();

  const elapsedMs =
    Date.now() -
    startedAt;

  const totalMinutes =
    Math.max(
      1,
      Math.floor(
        elapsedMs /
          60_000,
      ),
    );

  let timeText =
    `${totalMinutes} minute${
      totalMinutes === 1
        ? ""
        : "s"
    }`;

  if (
    totalMinutes >= 60
  ) {
    const hours =
      Math.floor(
        totalMinutes /
          60,
      );

    const minutes =
      totalMinutes %
      60;

    timeText =
      `${hours}h${
        minutes > 0
          ? ` ${minutes}m`
          : ""
      }`;
  }

  return sendPushToUsers(
    [userId],
    {
      title:
        "Your clock is still running",

      body:
        `You closed Chrona, but your clock is still running (${timeText}).`,

      url:
        "/",

      tag:
        "clock-app-closed",
    },
  );
}

/**
 * Sends the user's 3-hour clock reminder.
 *
 * There is NO polling here.
 *
 * The browser calls this only when
 * the next reminder becomes due.
 */
export async function sendClockRunningReminder(
  userId: string,
) {
  const now =
    Date.now();

  const {
    data: timer,
    error,
  } =
    await supabaseAdmin
      .from(
        "active_timers",
      )
      .select(
        "started_at, last_reminded_at",
      )
      .eq(
        "user_id",
        userId,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "[push] Failed to load active timer",
      error,
    );

    return {
      active:
        false,

      sent:
        0,

      nextReminderAt:
        null as string | null,
    };
  }

  if (!timer) {
    return {
      active:
        false,

      sent:
        0,

      nextReminderAt:
        null as string | null,
    };
  }

  const startedAt =
    new Date(
      timer.started_at,
    ).getTime();

  if (
    !Number.isFinite(
      startedAt,
    )
  ) {
    return {
      active:
        false,

      sent:
        0,

      nextReminderAt:
        null as string | null,
    };
  }

  const lastReminder =
    timer.last_reminded_at
      ? new Date(
          timer.last_reminded_at,
        ).getTime()
      : null;

  const reminderBase =
    lastReminder !==
        null &&
      Number.isFinite(
        lastReminder,
      )
      ? lastReminder
      : startedAt;

  const dueAt =
    reminderBase +
    THREE_HOURS_MS;

  /*
   * Not due yet.
   *
   * Tell the browser exactly when
   * to wake up next.
   */
  if (
    now <
    dueAt
  ) {
    return {
      active:
        true,

      sent:
        0,

      nextReminderAt:
        new Date(
          dueAt,
        ).toISOString(),
    };
  }

  const hours =
    Math.max(
      3,
      Math.floor(
        (
          now -
          startedAt
        ) /
          (
            60 *
            60 *
            1000
          ),
      ),
    );

  const sent =
    await sendPushToUsers(
      [userId],
      {
        title:
          "Your clock is still running",

        body:
          `You've been clocked in for ${hours} hours. Did you forget to stop the timer?`,

        url:
          "/",

        tag:
          "clock-running",
      },
    );

  /*
   * Only mark it as reminded if
   * at least one Web Push was
   * successfully accepted.
   */
  if (
    sent > 0
  ) {
    const {
      error:
        updateError,
    } =
      await supabaseAdmin
        .from(
          "active_timers",
        )
        .update({
          last_reminded_at:
            new Date(
              now,
            ).toISOString(),
        })
        .eq(
          "user_id",
          userId,
        );

    if (
      updateError
    ) {
      console.error(
        "[push] Failed to update clock reminder",
        updateError,
      );
    }
  }

  /*
   * Do not retry constantly if push is
   * disabled or temporarily fails.
   *
   * The next attempt is three hours later.
   */
  return {
    active:
      true,

    sent,

    nextReminderAt:
      new Date(
        now +
          THREE_HOURS_MS,
      ).toISOString(),
  };
}

let lastSweep = 0;

/**
 * Existing RSVP reminder check.
 *
 * Important:
 * Clock reminders are NOT handled here anymore.
 *
 * There is no recurring server-side
 * clock polling.
 */
export async function runReminderSweep() {
  const now =
    Date.now();

  let rsvpReminders =
    0;

  const today =
    new Date(
      now,
    )
      .toISOString()
      .slice(
        0,
        10,
      );

  const tomorrow =
    new Date(
      now +
        24 *
          60 *
          60 *
          1000,
    )
      .toISOString()
      .slice(
        0,
        10,
      );

  const {
    data: meetings,
    error:
      meetingsError,
  } =
    await supabaseAdmin
      .from(
        "meetings",
      )
      .select(
        "id, title, date, time, team_id, locked",
      )
      .gte(
        "date",
        today,
      )
      .lte(
        "date",
        tomorrow,
      );

  if (
    meetingsError
  ) {
    console.error(
      "[push] Failed to load meetings for reminders",
      meetingsError,
    );

    return {
      rsvpReminders:
        0,
    };
  }

  for (
    const meeting of
    meetings ??
    []
  ) {
    if (
      meeting.locked
    ) {
      continue;
    }

    const audience =
      await audienceForMeeting(
        meeting.team_id,
      );

    if (
      audience.length ===
      0
    ) {
      continue;
    }

    const [
      {
        data: rsvps,
      },

      {
        data:
          alreadySent,
      },
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "rsvps",
          )
          .select(
            "user_id",
          )
          .eq(
            "meeting_id",
            meeting.id,
          ),

        supabaseAdmin
          .from(
            "push_reminders_sent",
          )
          .select(
            "user_id",
          )
          .eq(
            "meeting_id",
            meeting.id,
          )
          .eq(
            "kind",
            "rsvp_reminder",
          ),
      ]);

    const answered =
      new Set(
        (
          rsvps ??
          []
        ).map(
          (row) =>
            row.user_id,
        ),
      );

    const notified =
      new Set(
        (
          alreadySent ??
          []
        ).map(
          (row) =>
            row.user_id,
        ),
      );

    const pending =
      audience.filter(
        (id) =>
          !answered.has(
            id,
          ) &&
          !notified.has(
            id,
          ),
      );

    if (
      pending.length ===
      0
    ) {
      continue;
    }

    const sent =
      await sendPushToUsers(
        pending,
        {
          title:
            "RSVP needed",

          body:
            `${meeting.title} is coming up at ${meeting.time}. Let the team know if you're in.`,

          url:
            "/meetings",

          tag:
            `rsvp-needed-${meeting.id}`,
        },
      );

    rsvpReminders +=
      sent;

    if (
      sent > 0
    ) {
      const {
        error:
          insertError,
      } =
        await supabaseAdmin
          .from(
            "push_reminders_sent",
          )
          .insert(
            pending.map(
              (
                userId,
              ) => ({
                user_id:
                  userId,

                meeting_id:
                  meeting.id,

                kind:
                  "rsvp_reminder",
              }),
            ),
          );

      if (
        insertError
      ) {
        console.error(
          "[push] Failed to record RSVP reminders",
          insertError,
        );
      }
    }
  }

  return {
    rsvpReminders,
  };
}

/**
 * This is only an app-opening fallback.
 *
 * It is NOT a scheduler.
 */
export async function runReminderSweepThrottled() {
  const now =
    Date.now();

  if (
    now -
      lastSweep <
    15 *
      60 *
      1000
  ) {
    return {
      skipped:
        true,
    };
  }

  lastSweep =
    now;

  return runReminderSweep();
}