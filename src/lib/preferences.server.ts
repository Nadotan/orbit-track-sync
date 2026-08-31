import {
  supabaseAdmin,
} from "@/integrations/supabase/client.server";

import {
  PREFERENCE_DEFINITIONS,
  defaultUserPreferences,
  isUserPreferenceKey,
  type UserPreferenceKey,
  type UserPreferences,
} from "./preferences";

function uniqueStrings(
  values: string[],
) {
  return Array.from(
    new Set(
      values.filter(Boolean),
    ),
  );
}

export async function getPreferencesForUser(
  userId: string,
): Promise<UserPreferences> {
  const admin =
    supabaseAdmin as any;

  const preferences =
    defaultUserPreferences();

  const {
    data,
    error,
  } =
    await admin
      .from(
        "user_preferences",
      )
      .select(
        "preference_key, enabled",
      )
      .eq(
        "user_id",
        userId,
      );

  if (error) {
    throw new Error(
      error.message,
    );
  }

  for (
    const row
    of data ?? []
  ) {
    if (
      isUserPreferenceKey(
        row.preference_key,
      )
    ) {
      preferences[
        row.preference_key
      ] =
        Boolean(
          row.enabled,
        );
    }
  }

  return preferences;
}

export async function setPreferenceForUser(
  userId: string,
  key: UserPreferenceKey,
  enabled: boolean,
) {
  const admin =
    supabaseAdmin as any;

  const {
    error,
  } =
    await admin
      .from(
        "user_preferences",
      )
      .upsert(
        {
          user_id:
            userId,

          preference_key:
            key,

          enabled,

          updated_at:
            new Date()
              .toISOString(),
        },

        {
          onConflict:
            "user_id,preference_key",
        },
      );

  if (error) {
    throw new Error(
      error.message,
    );
  }

  return {
    key,
    enabled,
  };
}

export async function filterUsersByPreference(
  userIds: string[],
  key: UserPreferenceKey,
) {
  const uniqueUserIds =
    uniqueStrings(
      userIds,
    );

  if (
    uniqueUserIds.length ===
    0
  ) {
    return [];
  }

  const admin =
    supabaseAdmin as any;

  const {
    data,
    error,
  } =
    await admin
      .from(
        "user_preferences",
      )
      .select(
        "user_id, enabled",
      )
      .eq(
        "preference_key",
        key,
      )
      .in(
        "user_id",
        uniqueUserIds,
      );

  if (error) {
    console.error(
      `[preferences] Failed to load ${key} preference audience`,
      error,
    );

    /*
     * Fail closed:
     * if preferences cannot be read,
     * do not send an optional push.
     */
    return [];
  }

  const overrides =
    new Map<
      string,
      boolean
    >(
      (
        data ??
        []
      ).map(
        (
          row: any,
        ) => [
          row.user_id as string,
          Boolean(
            row.enabled,
          ),
        ],
      ),
    );

  const defaultEnabled =
    PREFERENCE_DEFINITIONS[
      key
    ].defaultEnabled;

  return uniqueUserIds.filter(
    (
      userId,
    ) =>
      overrides.get(
        userId,
      ) ??
      defaultEnabled,
  );
}