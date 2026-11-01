export type {
  PushAdminHealthStatus,
  PushAdminUserHealth,
  PushTemplate,
} from "./push.impl.functions";

export {
  savePushSubscription,
  removePushSubscription,
  reportPushClientStatus,
  notifyMeetingCreated,
  notifyRsvpChange,
  getPushAdminStatus,
  broadcastPush,
  listPushTemplates,
  savePushTemplate,
  deletePushTemplate,
} from "./push.impl.functions";

/**
 * Clock reminder tracking is intentionally disabled.
 *
 * The actual Clock still runs from the local active session and time entries.
 * These compatibility functions stay here so existing callers do not need to
 * change, but they no longer create Lovable server runs or database writes.
 */
export async function markTimerRunning(_options: {
  data: {
    startedAt: string;
  };
}) {
  return {
    ok: true,
  };
}

export async function markTimerStopped() {
  return {
    ok: true,
  };
}

/**
 * Automated Clock push reminders are disabled.
 */
export async function sendClockReminder() {
  return {
    active: false,
    sent: 0,
    nextReminderAt: null as string | null,
  };
}

/**
 * The old app-opening reminder sweep is disabled.
 *
 * RSVP reminders are now handled only by the single daily Supabase cron job.
 */
export async function sweepReminders() {
  return {
    skipped: true,
  };
}