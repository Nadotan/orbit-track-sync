import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendPushToUsers } from "./push.server";

const DEFAULT_TIME_ZONE = "Asia/Jerusalem";
const REMINDER_DELAY_MS = 15 * 60 * 1000;
const REMINDER_WINDOW_MS = 2 * 60 * 60 * 1000;
const LOG_LOOKBACK_MS = 30 * 60 * 1000;
const MAX_CATCH_UP_MS = 12 * 60 * 60 * 1000;

type Recurrence = "none" | "daily" | "weekly" | "biweekly" | "monthly";

type MeetingRow = {
  id: string;
  title: string;
  date: string;
  time: string;
  recurrence: Recurrence | null;
};

type MeetingOccurrence = MeetingRow & {
  startMs: number;
  dueMs: number;
};

export interface AttendanceClockPrompt {
  meetingId: string;
  title: string;
  date: string;
  time: string;
  meetingStartAt: string;
}

export interface AttendanceClockPromptResult {
  prompt: AttendanceClockPrompt | null;
  nextCheckAt: string | null;
}

function appTimeZone() {
  return process.env["APP_TIME_ZONE"] ?? DEFAULT_TIME_ZONE;
}

function zoneParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localDate(ms: number, timeZone: string) {
  const parts = zoneParts(ms, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function zoneOffset(ms: number, timeZone: string) {
  const parts = zoneParts(ms, timeZone);

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
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);

  const guess = Date.UTC(
    year!,
    month! - 1,
    day!,
    hour!,
    minute!,
    second,
  );

  const firstOffset = zoneOffset(guess, timeZone);

  let result = guess - firstOffset;

  const finalOffset = zoneOffset(result, timeZone);

  if (finalOffset !== firstOffset) {
    result = guess - finalOffset;
  }

  return result;
}

function meetingOccursOnDate(
  meeting: MeetingRow,
  targetDate: string,
) {
  const cursor = new Date(`${meeting.date}T00:00:00Z`);
  const target = new Date(`${targetDate}T00:00:00Z`);

  if (
    !Number.isFinite(cursor.getTime()) ||
    !Number.isFinite(target.getTime()) ||
    cursor > target
  ) {
    return false;
  }

  const recurrence = meeting.recurrence ?? "none";

  if (recurrence === "none") {
    return cursor.getTime() === target.getTime();
  }

  let guard = 0;

  while (cursor < target && guard++ < 5000) {
    if (recurrence === "daily") {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    } else if (recurrence === "weekly") {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    } else if (recurrence === "biweekly") {
      cursor.setUTCDate(cursor.getUTCDate() + 14);
    } else {
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  return cursor.getTime() === target.getTime();
}

function occurrenceForDate(
  meeting: MeetingRow,
  date: string,
  timeZone: string,
): MeetingOccurrence | null {
  if (!meetingOccursOnDate(meeting, date)) {
    return null;
  }

  const startMs = localDateTimeMs(
    date,
    meeting.time,
    timeZone,
  );

  return {
    ...meeting,
    startMs,
    dueMs: startMs + REMINDER_DELAY_MS,
  };
}

function reminderKind(
  channel: "push" | "in_app",
  date: string,
) {
  return channel === "push"
    ? `clock_start_reminder:${date}`
    : `clock_start_in_app:${date}`;
}

async function hasRecentLoggedTime(
  admin: any,
  userId: string,
  meetingStartMs: number,
  nowMs: number,
) {
  const { data, error } = await admin
    .from("time_entries")
    .select("id")
    .eq("user_id", userId)
    .gte(
      "end_time",
      new Date(
        meetingStartMs - LOG_LOOKBACK_MS,
      ).toISOString(),
    )
    .lte(
      "start_time",
      new Date(nowMs).toISOString(),
    )
    .limit(1);

  if (error) {
    console.error(
      "[clock-reminder] Failed to check recent time entries",
      error,
    );

    return false;
  }

  return (data ?? []).length > 0;
}

async function recordReminder(
  admin: any,
  userId: string,
  meetingId: string,
  kind: string,
) {
  const { error } = await admin
    .from("push_reminders_sent")
    .insert({
      user_id: userId,
      meeting_id: meetingId,
      kind,
    });

  if (error && error.code !== "23505") {
    console.error(
      "[clock-reminder] Failed to record reminder",
      error,
    );
  }
}

export async function getAttendanceClockReminderSetting(
  userId: string,
) {
  const admin = supabaseAdmin as any;

  const { data, error } = await admin
    .from("profiles")
    .select("attendance_clock_reminders")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.attendance_clock_reminders !== false;
}

export async function setAttendanceClockReminderSetting(
  userId: string,
  enabled: boolean,
) {
  const admin = supabaseAdmin as any;

  const { error } = await admin
    .from("profiles")
    .update({
      attendance_clock_reminders: enabled,
    })
    .eq("id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return {
    enabled,
  };
}

export async function getAttendanceClockPromptForUser(
  userId: string,
): Promise<AttendanceClockPromptResult> {
  const admin = supabaseAdmin as any;

  const timeZone = appTimeZone();
  const now = Date.now();
  const today = localDate(now, timeZone);

  const inAppKind = reminderKind(
    "in_app",
    today,
  );

  const [
    profileResult,
    timerResult,
    handledResult,
    rsvpResult,
  ] = await Promise.all([
    admin
      .from("profiles")
      .select("attendance_clock_reminders")
      .eq("id", userId)
      .maybeSingle(),

    admin
      .from("active_timers")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),

    admin
      .from("push_reminders_sent")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", inAppKind)
      .limit(1),

    admin
      .from("rsvps")
      .select("meeting_id")
      .eq("user_id", userId)
      .eq("status", "Attending"),
  ]);

  const firstError =
    profileResult.error ??
    timerResult.error ??
    handledResult.error ??
    rsvpResult.error;

  if (firstError) {
    throw new Error(firstError.message);
  }

  if (
    profileResult.data?.attendance_clock_reminders === false ||
    timerResult.data ||
    (handledResult.data ?? []).length > 0
  ) {
    return {
      prompt: null,
      nextCheckAt: null,
    };
  }

  const meetingIds = [
    ...new Set<string>(
      (rsvpResult.data ?? []).map(
        (row: any) => row.meeting_id as string,
      ),
    ),
  ];

  if (meetingIds.length === 0) {
    return {
      prompt: null,
      nextCheckAt: null,
    };
  }

  const {
    data: meetingRows,
    error: meetingError,
  } = await admin
    .from("meetings")
    .select(
      "id, title, date, time, recurrence",
    )
    .in("id", meetingIds)
    .lte("date", today);

  if (meetingError) {
    throw new Error(meetingError.message);
  }

  const occurrences = (meetingRows ?? [])
    .map((meeting: MeetingRow) =>
      occurrenceForDate(
        meeting,
        today,
        timeZone,
      ),
    )
    .filter(
      (
        meeting: MeetingOccurrence | null,
      ): meeting is MeetingOccurrence =>
        meeting !== null,
    )
    .sort(
      (
        a: MeetingOccurrence,
        b: MeetingOccurrence,
      ) => a.startMs - b.startMs,
    );

  let nextCheckAt: string | null = null;

  for (const meeting of occurrences) {
    if (now < meeting.dueMs) {
      if (nextCheckAt === null) {
        nextCheckAt = new Date(
          meeting.dueMs,
        ).toISOString();
      }

      continue;
    }

    if (
      now >
      meeting.startMs + REMINDER_WINDOW_MS
    ) {
      continue;
    }

    if (
      await hasRecentLoggedTime(
        admin,
        userId,
        meeting.startMs,
        now,
      )
    ) {
      continue;
    }

    return {
      prompt: {
        meetingId: meeting.id,
        title: meeting.title,
        date: today,
        time: meeting.time,
        meetingStartAt: new Date(
          meeting.startMs,
        ).toISOString(),
      },

      nextCheckAt,
    };
  }

  return {
    prompt: null,
    nextCheckAt,
  };
}

export async function dismissAttendanceClockPromptForUser(
  userId: string,
  meetingId: string,
) {
  const today = localDate(
    Date.now(),
    appTimeZone(),
  );

  await recordReminder(
    supabaseAdmin as any,
    userId,
    meetingId,
    reminderKind(
      "in_app",
      today,
    ),
  );

  return {
    ok: true,
  };
}

export async function logAttendanceClockCatchUpForUser(
  userId: string,
  meetingId: string,
  startedAt: string,
) {
  const admin = supabaseAdmin as any;

  const startMs = new Date(
    startedAt,
  ).getTime();

  const now = Date.now();

  if (
    !Number.isFinite(startMs) ||
    startMs >= now
  ) {
    throw new Error(
      "Choose a start time earlier than now.",
    );
  }

  if (
    now - startMs >
    MAX_CATCH_UP_MS
  ) {
    throw new Error(
      "The catch-up start time can be at most 12 hours ago.",
    );
  }

  const [
    meetingResult,
    rsvpResult,
    timerResult,
  ] = await Promise.all([
    admin
      .from("meetings")
      .select(
        "id, title, date, time, recurrence",
      )
      .eq("id", meetingId)
      .maybeSingle(),

    admin
      .from("rsvps")
      .select("meeting_id")
      .eq(
        "meeting_id",
        meetingId,
      )
      .eq(
        "user_id",
        userId,
      )
      .eq(
        "status",
        "Attending",
      )
      .maybeSingle(),

    admin
      .from("active_timers")
      .select("user_id")
      .eq(
        "user_id",
        userId,
      )
      .maybeSingle(),
  ]);

  const firstError =
    meetingResult.error ??
    rsvpResult.error ??
    timerResult.error;

  if (firstError) {
    throw new Error(
      firstError.message,
    );
  }

  const meeting =
    meetingResult.data as MeetingRow | null;

  if (
    !meeting ||
    !rsvpResult.data
  ) {
    throw new Error(
      "This meeting is no longer available for catch-up.",
    );
  }

  if (timerResult.data) {
    throw new Error(
      "Your Clock is already running.",
    );
  }

  const timeZone = appTimeZone();

  const today = localDate(
    now,
    timeZone,
  );

  if (
    !meetingOccursOnDate(
      meeting,
      today,
    )
  ) {
    throw new Error(
      "This meeting is not happening today.",
    );
  }

  const startTime = new Date(
    startMs,
  ).toISOString();

  const endTime = new Date(
    now,
  ).toISOString();

  const {
    data: overlap,
    error: overlapError,
  } = await admin
    .from("time_entries")
    .select("id")
    .eq(
      "user_id",
      userId,
    )
    .lt(
      "start_time",
      endTime,
    )
    .gt(
      "end_time",
      startTime,
    )
    .limit(1);

  if (overlapError) {
    throw new Error(
      overlapError.message,
    );
  }

  if (
    (overlap ?? []).length > 0
  ) {
    throw new Error(
      "You already have logged time in part of that range.",
    );
  }

  const {
    error: insertError,
  } = await admin
    .from("time_entries")
    .insert({
      user_id: userId,
      start_time: startTime,
      end_time: endTime,
      duration_ms:
        now - startMs,
      description:
        `Clock catch-up · ${meeting.title}`,
    });

  if (insertError) {
    throw new Error(
      insertError.message,
    );
  }

  await dismissAttendanceClockPromptForUser(
    userId,
    meetingId,
  );

  return {
    durationMs:
      now - startMs,
  };
}

export async function runAttendanceClockReminderSweep() {
  const admin = supabaseAdmin as any;

  const timeZone = appTimeZone();
  const now = Date.now();

  const today = localDate(
    now,
    timeZone,
  );

  const pushKind = reminderKind(
    "push",
    today,
  );

  const [
    meetingsResult,
    sentResult,
  ] = await Promise.all([
    admin
      .from("meetings")
      .select(
        "id, title, date, time, recurrence",
      )
      .lte(
        "date",
        today,
      ),

    admin
      .from("push_reminders_sent")
      .select("user_id")
      .eq(
        "kind",
        pushKind,
      ),
  ]);

  if (
    meetingsResult.error ||
    sentResult.error
  ) {
    console.error(
      "[clock-reminder] Failed to prepare attendance reminders",
      meetingsResult.error ??
        sentResult.error,
    );

    return {
      clockStartReminders: 0,
    };
  }

  const notifiedToday =
    new Set<string>(
      (sentResult.data ?? []).map(
        (row: any) =>
          row.user_id as string,
      ),
    );

  const meetings =
    (meetingsResult.data ?? [])
      .map((meeting: MeetingRow) =>
        occurrenceForDate(
          meeting,
          today,
          timeZone,
        ),
      )
      .filter(
        (
          meeting: MeetingOccurrence | null,
        ): meeting is MeetingOccurrence =>
          meeting !== null,
      )
      .filter(
        (
          meeting: MeetingOccurrence,
        ) =>
          now >= meeting.dueMs &&
          now <=
            meeting.startMs +
              REMINDER_WINDOW_MS,
      )
      .sort(
        (
          a: MeetingOccurrence,
          b: MeetingOccurrence,
        ) =>
          a.startMs -
          b.startMs,
      );

  let clockStartReminders = 0;

  for (const meeting of meetings) {
    const {
      data: rsvps,
      error: rsvpError,
    } = await admin
      .from("rsvps")
      .select("user_id")
      .eq(
        "meeting_id",
        meeting.id,
      )
      .eq(
        "status",
        "Attending",
      );

    if (rsvpError) {
      console.error(
        "[clock-reminder] Failed to load attending RSVPs",
        rsvpError,
      );

      continue;
    }

    const attendeeIds = [
      ...new Set<string>(
        (rsvps ?? [])
          .map(
            (row: any) =>
              row.user_id as string,
          )
          .filter(
            (userId: string) =>
              !notifiedToday.has(
                userId,
              ),
          ),
      ),
    ];

    if (
      attendeeIds.length === 0
    ) {
      continue;
    }

    const [
      profilesResult,
      timersResult,
    ] = await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, attendance_clock_reminders",
        )
        .in(
          "id",
          attendeeIds,
        ),

      admin
        .from("active_timers")
        .select("user_id")
        .in(
          "user_id",
          attendeeIds,
        ),
    ]);

    if (
      profilesResult.error ||
      timersResult.error
    ) {
      console.error(
        "[clock-reminder] Failed to check attendee reminder state",
        profilesResult.error ??
          timersResult.error,
      );

      continue;
    }

    const enabledUsers =
      new Set<string>(
        (profilesResult.data ?? [])
          .filter(
            (row: any) =>
              row.attendance_clock_reminders !==
              false,
          )
          .map(
            (row: any) =>
              row.id as string,
          ),
      );

    const runningUsers =
      new Set<string>(
        (timersResult.data ?? []).map(
          (row: any) =>
            row.user_id as string,
        ),
      );

    for (
      const userId
      of attendeeIds
    ) {
      if (
        !enabledUsers.has(
          userId,
        ) ||
        runningUsers.has(
          userId,
        )
      ) {
        continue;
      }

      if (
        await hasRecentLoggedTime(
          admin,
          userId,
          meeting.startMs,
          now,
        )
      ) {
        continue;
      }

      const sent =
        await sendPushToUsers(
          [userId],
          {
            title:
              "Forgot to start your Clock?",

            body:
              `You marked Attending for ${meeting.title}, but your Clock isn't running.`,

            url: "/",

            tag:
              `clock-start-reminder-${today}`,
          },
        );

      if (sent === 0) {
        continue;
      }

      clockStartReminders += sent;

      notifiedToday.add(
        userId,
      );

      await recordReminder(
        admin,
        userId,
        meeting.id,
        pushKind,
      );
    }
  }

  return {
    clockStartReminders,
  };
}