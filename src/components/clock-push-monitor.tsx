/**
 * Automated Clock push reminders are intentionally disabled.
 *
 * The Clock itself remains fully functional. This component stays in place so
 * AppHeader does not need to change, but it performs no preference reads,
 * timers, pagehide requests, server calls, or database work.
 */
export function ClockPushMonitor() {
  return null;
}