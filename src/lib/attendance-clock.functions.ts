import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const settingSchema = z.object({
  enabled: z.boolean(),
});

const meetingSchema = z.object({
  meetingId: z.string().uuid(),
});

const catchUpSchema = meetingSchema.extend({
  startedAt: z.string().datetime(),
});

export const getAttendanceClockReminderSetting = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAttendanceClockReminderSetting: getSetting } = await import(
      "./attendance-clock-reminders.server"
    );

    return {
      enabled: await getSetting(context.userId),
    };
  });

export const setAttendanceClockReminderSetting = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(settingSchema)
  .handler(async ({ data, context }) => {
    const { setAttendanceClockReminderSetting: setSetting } = await import(
      "./attendance-clock-reminders.server"
    );

    return setSetting(context.userId, data.enabled);
  });

export const getAttendanceClockPrompt = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAttendanceClockPromptForUser } = await import(
      "./attendance-clock-reminders.server"
    );

    return getAttendanceClockPromptForUser(context.userId);
  });

export const dismissAttendanceClockPrompt = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(meetingSchema)
  .handler(async ({ data, context }) => {
    const { dismissAttendanceClockPromptForUser } = await import(
      "./attendance-clock-reminders.server"
    );

    return dismissAttendanceClockPromptForUser(
      context.userId,
      data.meetingId,
    );
  });

export const logAttendanceClockCatchUp = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .validator(catchUpSchema)
  .handler(async ({ data, context }) => {
    const { logAttendanceClockCatchUpForUser } = await import(
      "./attendance-clock-reminders.server"
    );

    return logAttendanceClockCatchUpForUser(
      context.userId,
      data.meetingId,
      data.startedAt,
    );
  });