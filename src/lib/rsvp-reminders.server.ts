import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  audienceForMeeting,
  mentorUserIds,
  sendPushToUsers,
} from "./push.server";

const APP_TIME_ZONE = "Asia/Jerusalem";

interface MeetingRow {
  id: string;
  title: string;
  date: string;
  time: string;
  team_id: string | null;
  recurrence: string | null;
  locked: boolean | null;
}

function localDateKey(
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
      },
    ).formatToParts(
      new Date(ms),
    );

  const value = (
    type: string,
  ) =>
    parts.find(
      (part) =>
        part.type === type,
    )?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(
  date: string,
  days: number,
) {
  const value =
    new Date(
      `${date}T00:00:00Z`,
    );

  value.setUTCDate(
    value.getUTCDate() +
      days,
  );

  return value
    .toISOString()
    .slice(
      0,
      10,
    );
}

function meetingOccursOnDate(
  meeting: MeetingRow,
  targetDate: string,
) {
  const cursor =
    new Date(
      `${meeting.date}T00:00:00Z`,
    );

  const target =
    new Date(
      `${targetDate}T00:00:00Z`,
    );

  if (
    !Number.isFinite(
      cursor.getTime(),
    ) ||
    !Number.isFinite(
      target.getTime(),
    ) ||
    cursor >
      target
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
      cursor.getTime() ===
      target.getTime()
    );
  }

  let guard =
    0;

  while (
    cursor <
      target &&
    guard++ <
      5000
  ) {
    if (
      recurrence ===
      "daily"
    ) {
      cursor.setUTCDate(
        cursor.getUTCDate() +
          1,
      );
    } else if (
      recurrence ===
      "weekly"
    ) {
      cursor.setUTCDate(
        cursor.getUTCDate() +
          7,
      );
    } else if (
      recurrence ===
      "biweekly"
    ) {
      cursor.setUTCDate(
        cursor.getUTCDate() +
          14,
      );
    } else {
      cursor.setUTCMonth(
        cursor.getUTCMonth() +
          1,
      );
    }
  }

  return (
    cursor.getTime() ===
    target.getTime()
  );
}

/**
 * Sends the only remaining automated reminder:
 * one RSVP reminder on the day before a meeting when the user has not
 * submitted any RSVP yet.
 *
 * This function is called only by the single daily cron endpoint.
 */
export async function runRsvpReminderSweep() {
  const admin =
    supabaseAdmin as any;

  const today =
    localDateKey(
      Date.now(),
      APP_TIME_ZONE,
    );

  const targetDate =
    addDays(
      today,
      1,
    );

  const {
    data:
      meetingRows,
    error:
      meetingsError,
  } =
    await admin
      .from(
        "meetings",
      )
      .select(
        "id, title, date, time, team_id, recurrence, locked",
      )
      .lte(
        "date",
        targetDate,
      );

  if (
    meetingsError
  ) {
    throw new Error(
      meetingsError.message,
    );
  }

  const meetings =
    (
      meetingRows ??
      []
    )
      .filter(
        (
          meeting: MeetingRow,
        ) =>
          !meeting.locked &&
          meetingOccursOnDate(
            meeting,
            targetDate,
          ),
      );

  if (
    meetings.length ===
    0
  ) {
    return {
      rsvpReminders:
        0,

      targetDate,
    };
  }

  const mentors =
    await mentorUserIds();

  let rsvpReminders =
    0;

  for (
    const meeting
    of meetings
  ) {
    const audience =
      await audienceForMeeting(
        meeting.team_id,
      );

    const eligibleAudience =
      audience.filter(
        (
          userId,
        ) =>
          !mentors.has(
            userId,
          ),
      );

    if (
      eligibleAudience.length ===
      0
    ) {
      continue;
    }

    const [
      rsvpResult,
      sentResult,
    ] =
      await Promise.all([
        admin
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

        admin
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

    if (
      rsvpResult.error ||
      sentResult.error
    ) {
      console.error(
        "[rsvp-reminder] Failed to prepare meeting reminder",
        rsvpResult.error ??
          sentResult.error,
      );

      continue;
    }

    const answered =
      new Set<string>(
        (
          rsvpResult.data ??
          []
        ).map(
          (
            row: {
              user_id:
                string;
            },
          ) =>
            row.user_id,
        ),
      );

    const alreadySent =
      new Set<string>(
        (
          sentResult.data ??
          []
        ).map(
          (
            row: {
              user_id:
                string;
            },
          ) =>
            row.user_id,
        ),
      );

    const pending =
      eligibleAudience.filter(
        (
          userId,
        ) =>
          !answered.has(
            userId,
          ) &&
          !alreadySent.has(
            userId,
          ),
      );

    for (
      const userId
      of pending
    ) {
      const sent =
        await sendPushToUsers(
          [
            userId,
          ],
          {
            title:
              "RSVP needed",

            body:
              `${meeting.title} is tomorrow at ${meeting.time}. Let the team know if you're in.`,

            url:
              "/meetings",

            tag:
              `rsvp-needed-${meeting.id}`,
          },
        );

      if (
        sent <=
        0
      ) {
        continue;
      }

      rsvpReminders +=
        sent;

      const {
        error:
          insertError,
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

            kind:
              "rsvp_reminder",
          });

      if (
        insertError &&
        insertError.code !==
          "23505"
      ) {
        console.error(
          "[rsvp-reminder] Failed to record sent reminder",
          insertError,
        );
      }
    }
  }

  return {
    rsvpReminders,
    targetDate,
  };
}