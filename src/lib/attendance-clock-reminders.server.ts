import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPushToUsers } from "./push.server";

const DEFAULT_TIME_ZONE = "Asia/Jerusalem";

const DELAY_MS = 15 * 60 * 1000;
const WINDOW_MS = 2 * 60 * 60 * 1000;
const LOOKBACK_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Recurrence =
  | "none"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly";

type Meeting = {
  id: string;
  title: string;
  date: string;
  time: string;
  recurrence: Recurrence | null;
};

function zoneParts(
  ms: number,
  timeZone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      },
    ).formatToParts(
      new Date(ms),
    );

  const value = (
    type: string,
  ) =>
    Number(
      parts.find(
        (part) =>
          part.type === type,
      )?.value ?? 0,
    );

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localDate(
  ms: number,
  timeZone: string,
) {
  const parts =
    zoneParts(
      ms,
      timeZone,
    );

  const pad = (
    value: number,
  ) =>
    String(value).padStart(
      2,
      "0",
    );

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function zoneOffset(
  ms: number,
  timeZone: string,
) {
  const parts =
    zoneParts(
      ms,
      timeZone,
    );

  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ) - ms
  );
}

function localDateTimeMs(
  date: string,
  time: string,
  timeZone: string,
) {
  const [
    year,
    month,
    day,
  ] =
    date
      .split("-")
      .map(Number);

  const [
    hour,
    minute,
    second = 0,
  ] =
    time
      .split(":")
      .map(Number);

  const guess =
    Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
    );

  const firstOffset =
    zoneOffset(
      guess,
      timeZone,
    );

  let result =
    guess -
    firstOffset;

  const finalOffset =
    zoneOffset(
      result,
      timeZone,
    );

  if (
    finalOffset !==
    firstOffset
  ) {
    result =
      guess -
      finalOffset;
  }

  return result;
}

function dateMs(
  date: string,
) {
  const [
    year,
    month,
    day,
  ] =
    date
      .split("-")
      .map(Number);

  return Date.UTC(
    year,
    month - 1,
    day,
  );
}

function occursToday(
  meeting: Meeting,
  today: string,
) {
  const start =
    dateMs(
      meeting.date,
    );

  const target =
    dateMs(
      today,
    );

  if (
    target <
    start
  ) {
    return false;
  }

  const recurrence =
    meeting.recurrence ??
    "none";

  if (
    recurrence ===
    "none"
  ) {
    return (
      meeting.date ===
      today
    );
  }

  const days =
    Math.floor(
      (
        target -
        start
      ) /
        DAY_MS,
    );

  if (
    recurrence ===
    "daily"
  ) {
    return true;
  }

  if (
    recurrence ===
    "weekly"
  ) {
    return (
      days %
        7 ===
      0
    );
  }

  if (
    recurrence ===
    "biweekly"
  ) {
    return (
      days %
        14 ===
      0
    );
  }

  const cursor =
    new Date(start);

  let guard =
    0;

  while (
    cursor.getTime() <
      target &&
    guard++ <
      600
  ) {
    cursor.setUTCMonth(
      cursor.getUTCMonth() +
        1,
    );
  }

  return (
    cursor.getTime() ===
    target
  );
}

export async function runAttendanceClockReminderSweep() {
  const admin =
    supabaseAdmin as any;

  const timeZone =
    process.env[
      "APP_TIME_ZONE"
    ] ??
    DEFAULT_TIME_ZONE;

  const now =
    Date.now();

  const today =
    localDate(
      now,
      timeZone,
    );

  /*
   * Date is deliberately part of the kind.
   *
   * This lets a recurring meeting remind the
   * same person again on its next occurrence,
   * while still limiting reminders to once
   * per user per day.
   */
  const kind =
    `clock_start_reminder:${today}`;

  const [
    meetingsResult,
    sentResult,
  ] =
    await Promise.all([
      admin
        .from(
          "meetings",
        )
        .select(
          "id, title, date, time, recurrence",
        )
        .lte(
          "date",
          today,
        ),

      admin
        .from(
          "push_reminders_sent",
        )
        .select(
          "user_id",
        )
        .eq(
          "kind",
          kind,
        ),
    ]);

  if (
    meetingsResult.error ||
    sentResult.error
  ) {
    console.error(
      "[push] Failed to prepare attendance clock reminders",
      meetingsResult.error ??
        sentResult.error,
    );

    return {
      clockStartReminders:
        0,
    };
  }

  const notifiedToday =
    new Set<string>(
      (
        sentResult.data ??
        []
      ).map(
        (row: any) =>
          row.user_id,
      ),
    );

  const meetings =
    (
      meetingsResult.data ??
      []
    )
      .filter(
        (
          meeting: any,
        ) =>
          occursToday(
            meeting as Meeting,
            today,
          ),
      )
      .map(
        (
          meeting: any,
        ) => ({
          ...(meeting as Meeting),

          startMs:
            localDateTimeMs(
              today,
              meeting.time,
              timeZone,
            ),
        }),
      )
      .filter(
        (
          meeting:
            Meeting & {
              startMs: number;
            },
        ) =>
          now >=
            meeting.startMs +
              DELAY_MS &&
          now <=
            meeting.startMs +
              WINDOW_MS,
      )
      .sort(
        (
          a:
            Meeting & {
              startMs: number;
            },

          b:
            Meeting & {
              startMs: number;
            },
        ) =>
          a.startMs -
          b.startMs,
      );

  let clockStartReminders =
    0;

  for (
    const meeting
    of meetings
  ) {
    const {
      data: rsvps,
      error:
        rsvpError,
    } =
      await admin
        .from(
          "rsvps",
        )
        .select(
          "user_id",
        )
        .eq(
          "meeting_id",
          meeting.id,
        )
        .eq(
          "status",
          "Attending",
        );

    if (
      rsvpError
    ) {
      console.error(
        "[push] Failed to load attending RSVPs",
        rsvpError,
      );

      continue;
    }

    const attendees = [
      ...new Set<string>(
        (
          rsvps ??
          []
        )
          .map(
            (
              row: any,
            ) =>
              row.user_id as string,
          )
          .filter(
            (
              userId:
                string,
            ) =>
              !notifiedToday.has(
                userId,
              ),
          ),
      ),
    ];

    if (
      attendees.length ===
      0
    ) {
      continue;
    }

    const {
      data:
        activeTimers,
      error:
        timerError,
    } =
      await admin
        .from(
          "active_timers",
        )
        .select(
          "user_id",
        )
        .in(
          "user_id",
          attendees,
        );

    if (
      timerError
    ) {
      console.error(
        "[push] Failed to check attendee clocks",
        timerError,
      );

      continue;
    }

    const running =
      new Set<string>(
        (
          activeTimers ??
          []
        ).map(
          (
            row: any,
          ) =>
            row.user_id,
        ),
      );

    const clockOff =
      attendees.filter(
        (
          userId,
        ) =>
          !running.has(
            userId,
          ),
      );

    if (
      clockOff.length ===
      0
    ) {
      continue;
    }

    /*
     * If someone already logged time overlapping
     * the start of the meeting, don't remind them.
     *
     * This prevents a reminder when the person
     * already started and stopped a short session.
     */
    const {
      data: entries,
      error:
        entryError,
    } =
      await admin
        .from(
          "time_entries",
        )
        .select(
          "user_id",
        )
        .in(
          "user_id",
          clockOff,
        )
        .gte(
          "end_time",
          new Date(
            meeting.startMs -
              LOOKBACK_MS,
          ).toISOString(),
        )
        .lte(
          "start_time",
          new Date(
            now,
          ).toISOString(),
        );

    if (
      entryError
    ) {
      console.error(
        "[push] Failed to check recent time entries",
        entryError,
      );

      continue;
    }

    const alreadyLogged =
      new Set<string>(
        (
          entries ??
          []
        ).map(
          (
            row: any,
          ) =>
            row.user_id,
        ),
      );

    const candidates =
      clockOff.filter(
        (
          userId,
        ) =>
          !alreadyLogged.has(
            userId,
          ),
      );

    for (
      const userId
      of candidates
    ) {
      const sent =
        await sendPushToUsers(
          [
            userId,
          ],
          {
            title:
              "Forgot to start your clock?",

            body:
              `You marked Attending for ${meeting.title}, but your clock isn't running.`,

            url:
              "/",

            tag:
              `clock-start-reminder-${today}`,
          },
        );

      /*
       * Only remember the notification if a push
       * actually reached at least one device.
       */
      if (
        sent ===
        0
      ) {
        continue;
      }

      clockStartReminders +=
        sent;

      notifiedToday.add(
        userId,
      );

      const {
        error,
      } =
        await admin
          .from(
            "push_reminders_sent",
          )
          .insert({
            user_id:
              userId,

            meeting_id:
              meeting.id,

            kind,
          });

      if (
        error
      ) {
        console.error(
          "[push] Failed to record clock-start reminder",
          error,
        );
      }
    }
  }

  return {
    clockStartReminders,
  };
}