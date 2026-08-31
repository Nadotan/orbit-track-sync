export const PREFERENCE_DEFINITIONS = {
  clock_reminders: {
    defaultEnabled: true,
    title: "Clock reminders",
    description:
      "Remind me if my Clock has been running for a long time or POM closes while it is still running.",
  },

  workshop_clock_start_reminder: {
    defaultEnabled: true,
    title: "Workshop Clock reminder",
    description:
      "When the workshop opens and my Clock is off, remind me to start it.",
  },

  new_meeting_notifications: {
    defaultEnabled: false,
    title: "New meeting push notifications",
    description:
      "Send me a push when a new meeting is created. New meetings still appear in my Inbox.",
  },
} as const;

export type UserPreferenceKey =
  keyof typeof PREFERENCE_DEFINITIONS;

export type UserPreferences =
  Record<UserPreferenceKey, boolean>;

export const PREFERENCE_KEYS =
  Object.keys(
    PREFERENCE_DEFINITIONS,
  ) as UserPreferenceKey[];

export function isUserPreferenceKey(
  value: string,
): value is UserPreferenceKey {
  return Object.prototype.hasOwnProperty.call(
    PREFERENCE_DEFINITIONS,
    value,
  );
}

export function defaultUserPreferences(): UserPreferences {
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [
      key,
      PREFERENCE_DEFINITIONS[key].defaultEnabled,
    ]),
  ) as UserPreferences;
}