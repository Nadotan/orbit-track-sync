import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { completeOnboardingProfile } from "./profile.functions";
import {
  getAdminDirectory,
  setUserRole,
} from "./admin.functions";
import {
  markTimerRunning,
  markTimerStopped,
  notifyMeetingCreated,
  notifyRsvpChange,
  sweepReminders,
} from "./push.functions";

import type {
  AppNotification,
  Meeting,
  Profile,
  Recurrence,
  Rsvp,
  RsvpStatus,
  Team,
  TimeEntry,
} from "./types";

const SESSION_KEY = "chrona-active-session";

interface ActiveSession {
  userId: string;
  startTime: string;
}

interface Db {
  teams: Team[];
  profiles: Profile[];
  timeEntries: TimeEntry[];
  meetings: Meeting[];
  rsvps: Rsvp[];
  notifications: AppNotification[];
}

const emptyDb: Db = {
  teams: [],
  profiles: [],
  timeEntries: [],
  meetings: [],
  rsvps: [],
  notifications: [],
};

export interface AppStore extends Db {
  currentUser: Profile;
  loading: boolean;
  needsOnboarding: boolean;

  activeSession: ActiveSession | null;

  startSession: () => void;
  stopSession: (description: string) => void;
  cancelSession: () => void;

  setRsvp: (
    meetingId: string,
    status: RsvpStatus,
  ) => void;

  rsvpFor: (
    meetingId: string,
    userId?: string,
  ) => Rsvp | undefined;

  createMeeting: (
    meeting: Omit<Meeting, "id">,
  ) => void;

  updateMeeting: (
    id: string,
    patch: Partial<Omit<Meeting, "id">>,
  ) => void;

  toggleMeetingLock: (id: string) => void;

  deleteMeeting: (id: string) => void;

  assignTeam: (
    userId: string,
    teamId: string | null,
  ) => void;

  setRole: (
    userId: string,
    role: Profile["role"],
  ) => void;

  createTeam: (name: string) => void;

  markNotificationsRead: () => void;

  teamName: (
    teamId: string | null,
  ) => string;

  updateOwnProfile: (patch: {
    name?: string;
    avatarUrl?: string | null;
  }) => Promise<void>;

  completeOnboarding: (patch: {
    name: string;
    teamId: string | null;
    avatarUrl: string | null;
  }) => Promise<void>;

  signOut: () => Promise<void>;

  refresh: () => void;
}

const StoreContext =
  createContext<AppStore | null>(null);

async function fetchDb(): Promise<Db> {
  const [
    teams,
    profiles,
    roles,
    entries,
    meetings,
    rsvps,
    notifications,
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .order("name"),

    supabase
      .from("profiles")
      .select("*")
      .order("name"),

    supabase
      .from("user_roles")
      .select("*"),

    supabase
      .from("time_entries")
      .select("*")
      .order("start_time", {
        ascending: false,
      }),

    supabase
      .from("meetings")
      .select("*")
      .order("date"),

    supabase
      .from("rsvps")
      .select("*"),

    supabase
      .from("notifications")
      .select("*")
      .order("created_at", {
        ascending: false,
      }),
  ]);

  const roleOf = (
    id: string,
  ): Profile["role"] =>
    (roles.data ?? []).some(
      (role) =>
        role.user_id === id &&
        role.role === "admin",
    )
      ? "Admin"
      : "User";

  return {
    teams: (teams.data ?? []).map(
      (team) => ({
        id: team.id,
        name: team.name,
      }),
    ),

    profiles: (
      profiles.data ?? []
    ).map((profile) => ({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: roleOf(profile.id),
      teamId: profile.team_id,
      avatarUrl: profile.avatar_url,

      /*
       * Onboarding is NOT stored in profiles anymore.
       * The current user's value is replaced below
       * using Supabase Auth app_metadata.
       */
      onboarded: false,
    })),

    timeEntries: (
      entries.data ?? []
    ).map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      startTime: entry.start_time,
      endTime: entry.end_time,
      durationMs: Number(entry.duration_ms),
      description: entry.description,
    })),

    meetings: (
      meetings.data ?? []
    ).map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      teamId:
        meeting.team_id ?? "general",
      recurrence:
        (meeting.recurrence ??
          "none") as Recurrence,
      locked: meeting.locked ?? false,
    })),

    rsvps: (
      rsvps.data ?? []
    ).map((rsvp) => ({
      id: rsvp.id,
      userId: rsvp.user_id,
      meetingId: rsvp.meeting_id,
      status: rsvp.status as RsvpStatus,
      createdAt: rsvp.created_at,
    })),

    notifications: (
      notifications.data ?? []
    ).map((notification) => ({
      id: notification.id,
      message: notification.message,
      createdAt: notification.created_at,
      read: notification.read,
      tone:
        notification.tone as AppNotification["tone"],
    })),
  };
}

export function AppStoreProvider({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const userId = session.user.id;

  const queryClient =
    useQueryClient();

  const [
    activeSession,
    setActiveSession,
  ] = useState<ActiveSession | null>(
    null,
  );

  /*
   * Onboarding state now comes from Supabase Auth
   * app_metadata instead of the profiles table.
   */
  const [
    onboardingComplete,
    setOnboardingComplete,
  ] = useState(
    session.user.app_metadata?.['onboarded'] ===
      true,
  );

  useEffect(() => {
    setOnboardingComplete(
      session.user.app_metadata?.['onboarded'] ===
        true,
    );
  }, [
    userId,
    session.user.app_metadata?.['onboarded'],
  ]);

  useEffect(() => {
    void sweepReminders().catch(
      () => undefined,
    );
  }, [userId]);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          SESSION_KEY,
        );

      if (!raw) {
        return;
      }

      const parsed =
        JSON.parse(
          raw,
        ) as ActiveSession;

      if (
        parsed.userId === userId
      ) {
        setActiveSession(parsed);
      }
    } catch {
      // Ignore invalid local storage data.
    }
  }, [userId]);

  const persistSession =
    useCallback(
      (
        value:
          | ActiveSession
          | null,
      ) => {
        setActiveSession(value);

        if (value) {
          localStorage.setItem(
            SESSION_KEY,
            JSON.stringify(value),
          );
        } else {
          localStorage.removeItem(
            SESSION_KEY,
          );
        }
      },
      [],
    );

  const {
    data,
    isLoading,
  } = useQuery({
    queryKey: [
      "chrona-db",
      userId,
    ],

    queryFn: fetchDb,
  });

  const db =
    data ?? emptyDb;

  const refresh =
    useCallback(() => {
      void queryClient.invalidateQueries({
        queryKey: [
          "chrona-db",
        ],
      });
    }, [queryClient]);

  const currentUser: Profile =
    useMemo(() => {
      const databaseProfile =
        db.profiles.find(
          (profile) =>
            profile.id === userId,
        );

      if (databaseProfile) {
        return {
          ...databaseProfile,

          onboarded:
            onboardingComplete,
        };
      }

      return {
        id: userId,

        name:
          session.user.user_metadata
            ?.['name'] ??
          session.user.email?.split(
            "@",
          )[0] ??
          "You",

        email:
          session.user.email ?? "",

        role: "User",

        teamId: null,

        avatarUrl: null,

        onboarded:
          onboardingComplete,
      };
    }, [
      db.profiles,
      userId,
      session.user.email,
      session.user.user_metadata?.['name'],
      onboardingComplete,
    ]);

  const teamName =
    useCallback(
      (
        teamId:
          | string
          | null,
      ) => {
        if (
          teamId === null
        ) {
          return "Unassigned";
        }

        if (
          teamId === "general"
        ) {
          return "General";
        }

        return (
          db.teams.find(
            (team) =>
              team.id === teamId,
          )?.name ??
          "Unassigned"
        );
      },
      [db.teams],
    );

  const notify =
    useCallback(
      async (
        message: string,
        tone: AppNotification["tone"],
      ) => {
        const { error } =
          await supabase
            .from(
              "notifications",
            )
            .insert({
              message,
              tone,
            });

        if (error) {
          console.error(
            "Failed to create notification:",
            error,
          );
        }
      },
      [],
    );

  const value: AppStore = {
    ...db,

    loading: isLoading,

    currentUser,

    /*
     * This no longer depends on
     * public.profiles.onboarded.
     */
    needsOnboarding:
      !onboardingComplete,

    activeSession,

    teamName,

    refresh,

    startSession: () => {
      const startTime =
        new Date().toISOString();

      persistSession({
        userId,
        startTime,
      });

      void markTimerRunning({
        data: { startedAt: startTime },
      }).catch(() => undefined);
    },

    cancelSession: () => {
      persistSession(null);

      void markTimerStopped().catch(
        () => undefined,
      );
    },

    stopSession: (
      description,
    ) => {
      if (!activeSession) {
        return;
      }

      const end =
        new Date();

      const start =
        new Date(
          activeSession.startTime,
        );

      persistSession(null);

      void markTimerStopped().catch(
        () => undefined,
      );

      void (async () => {
        const { error } =
          await supabase
            .from("time_entries")
            .insert({
              user_id: userId,

              start_time:
                activeSession.startTime,

              end_time:
                end.toISOString(),

              duration_ms:
                end.getTime() -
                start.getTime(),

              description,
            });

        if (error) {
          console.error(
            "Failed to save time entry:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    rsvpFor: (
      meetingId,
      uid,
    ) =>
      db.rsvps.find(
        (rsvp) =>
          rsvp.meetingId ===
            meetingId &&
          rsvp.userId ===
            (uid ?? userId),
      ),

    setRsvp: (
      meetingId,
      status,
    ) => {
      const meeting =
        db.meetings.find(
          (candidate) =>
            candidate.id ===
            meetingId,
        );

      if (
        meeting?.locked &&
        currentUser.role !==
          "Admin"
      ) {
        return;
      }

      const previous =
        db.rsvps.find(
          (rsvp) =>
            rsvp.meetingId ===
              meetingId &&
            rsvp.userId === userId,
        )?.status ?? null;

      void (async () => {
        const {
          error: rsvpError,
        } = await supabase
          .from("rsvps")
          .upsert(
            {
              user_id:
                userId,

              meeting_id:
                meetingId,

              status,
            },
            {
              onConflict:
                "user_id,meeting_id",
            },
          );

        if (rsvpError) {
          console.error(
            "Failed to save RSVP:",
            rsvpError,
          );
          return;
        }

        await notify(
          status ===
            "Attending"
            ? `${currentUser.name} is attending ${meeting?.title}.`
            : `${currentUser.name} can't attend ${meeting?.title}.`,

          status ===
            "Attending"
            ? "positive"
            : "negative",
        );

        void notifyRsvpChange({
          data: {
            meetingId,
            status,
            previousStatus:
              previous,
          },
        }).catch(
          () => undefined,
        );

        refresh();
      })();
    },

    createMeeting: (
      meeting,
    ) => {
      void (async () => {
        const {
          data: createdMeeting,
          error: meetingError,
        } = await supabase
          .from("meetings")
          .insert({
            title:
              meeting.title,

            date:
              meeting.date,

            time:
              meeting.time,

            team_id:
              meeting.teamId ===
              "general"
                ? null
                : meeting.teamId,

            recurrence:
              meeting.recurrence ??
              "none",

            locked:
              meeting.locked ??
              false,
          })
          .select("id")
          .maybeSingle();

        if (meetingError) {
          console.error(
            "Failed to create meeting:",
            meetingError,
          );
          return;
        }

        await notify(
          `New meeting scheduled: ${meeting.title}.`,
          "neutral",
        );

        if (createdMeeting?.id) {
          void notifyMeetingCreated({
            data: {
              meetingId:
                createdMeeting.id,
            },
          }).catch(
            () => undefined,
          );
        }

        refresh();
      })();
    },

    updateMeeting: (
      id,
      patch,
    ) => {
      void (async () => {
        const { error } =
          await supabase
            .from("meetings")
            .update({
              ...(patch.title !==
              undefined
                ? {
                    title:
                      patch.title,
                  }
                : {}),

              ...(patch.date !==
              undefined
                ? {
                    date:
                      patch.date,
                  }
                : {}),

              ...(patch.time !==
              undefined
                ? {
                    time:
                      patch.time,
                  }
                : {}),

              ...(patch.teamId !==
              undefined
                ? {
                    team_id:
                      patch.teamId ===
                      "general"
                        ? null
                        : patch.teamId,
                  }
                : {}),

              ...(patch.recurrence !==
              undefined
                ? {
                    recurrence:
                      patch.recurrence,
                  }
                : {}),

              ...(patch.locked !==
              undefined
                ? {
                    locked:
                      patch.locked,
                  }
                : {}),
            })
            .eq("id", id);

        if (error) {
          console.error(
            "Failed to update meeting:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    toggleMeetingLock: (
      id,
    ) => {
      const meeting =
        db.meetings.find(
          (candidate) =>
            candidate.id === id,
        );

      if (!meeting) {
        return;
      }

      void (async () => {
        const { error } =
          await supabase
            .from("meetings")
            .update({
              locked:
                !meeting.locked,
            })
            .eq("id", id);

        if (error) {
          console.error(
            "Failed to change meeting lock:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    deleteMeeting: (
      id,
    ) => {
      void (async () => {
        const { error } =
          await supabase
            .from("meetings")
            .delete()
            .eq("id", id);

        if (error) {
          console.error(
            "Failed to delete meeting:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    assignTeam: (
      targetUserId,
      teamId,
    ) => {
      void (async () => {
        const { error } =
          await supabase
            .from("profiles")
            .update({
              team_id:
                teamId,
            })
            .eq(
              "id",
              targetUserId,
            );

        if (error) {
          console.error(
            "Failed to assign team:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    setRole: (
      targetUserId,
      role,
    ) => {
      void (async () => {
        const {
          error: deleteError,
        } = await supabase
          .from("user_roles")
          .delete()
          .eq(
            "user_id",
            targetUserId,
          );

        if (deleteError) {
          console.error(
            "Failed to remove old role:",
            deleteError,
          );
          return;
        }

        const {
          error: insertError,
        } = await supabase
          .from("user_roles")
          .insert({
            user_id:
              targetUserId,

            role:
              role ===
              "Admin"
                ? "admin"
                : "user",
          });

        if (insertError) {
          console.error(
            "Failed to save role:",
            insertError,
          );
          return;
        }

        refresh();
      })();
    },

    createTeam: (
      name,
    ) => {
      void (async () => {
        const { error } =
          await supabase
            .from("teams")
            .insert({
              name,
            });

        if (error) {
          console.error(
            "Failed to create team:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    markNotificationsRead:
      () => {
        if (
          currentUser.role !==
          "Admin"
        ) {
          return;
        }

        void (async () => {
          const { error } =
            await supabase
              .from(
                "notifications",
              )
              .update({
                read: true,
              })
              .eq(
                "read",
                false,
              );

          if (error) {
            console.error(
              "Failed to mark notifications as read:",
              error,
            );
            return;
          }

          refresh();
        })();
      },

    updateOwnProfile:
      async (patch) => {
        const { error } =
          await supabase
            .from("profiles")
            .update({
              ...(patch.name !==
              undefined
                ? {
                    name:
                      patch.name,
                  }
                : {}),

              ...(patch.avatarUrl !==
              undefined
                ? {
                    avatar_url:
                      patch.avatarUrl,
                  }
                : {}),
            })
            .eq(
              "id",
              userId,
            );

        if (error) {
          throw new Error(
            error.message,
          );
        }

        refresh();
      },

    completeOnboarding:
      async ({
        name,
        teamId,
        avatarUrl,
      }) => {
        const updatedProfile =
          await completeOnboardingProfile({
            data: {
              name,
              teamId,
              avatarUrl,
            },
          });

        if (
          !updatedProfile ||
          !updatedProfile.onboarded
        ) {
          throw new Error(
            "Onboarding was not saved. Please try again.",
          );
        }

        /*
         * The server changed app_metadata.
         * Refresh the Supabase session so the new JWT
         * contains onboarded: true.
         */
        const {
          error:
            refreshSessionError,
        } =
          await supabase.auth.refreshSession();

        if (
          refreshSessionError
        ) {
          console.warn(
            "Profile completed but session refresh failed:",
            refreshSessionError,
          );
        }

        /*
         * Update UI immediately.
         */
        setOnboardingComplete(
          true,
        );

        /*
         * Update the cached profile so the user sees the
         * selected name/team/avatar immediately.
         */
        queryClient.setQueryData<Db>(
          [
            "chrona-db",
            userId,
          ],
          (previous) => {
            if (!previous) {
              return {
                ...emptyDb,
                profiles: [
                  {
                    id:
                      updatedProfile.id,

                    name:
                      updatedProfile.name,

                    email:
                      updatedProfile.email,

                    role:
                      currentUser.role,

                    teamId:
                      updatedProfile.team_id,

                    avatarUrl:
                      updatedProfile.avatar_url,

                    onboarded:
                      true,
                  },
                ],
              };
            }

            const existing =
              previous.profiles.find(
                (profile) =>
                  profile.id ===
                  userId,
              );

            const profile: Profile =
              {
                id:
                  updatedProfile.id,

                name:
                  updatedProfile.name,

                email:
                  updatedProfile.email,

                role:
                  existing?.role ??
                  currentUser.role,

                teamId:
                  updatedProfile.team_id,

                avatarUrl:
                  updatedProfile.avatar_url,

                onboarded:
                  true,
              };

            const hasProfile =
              previous.profiles.some(
                (
                  existingProfile,
                ) =>
                  existingProfile.id ===
                  userId,
              );

            return {
              ...previous,

              profiles:
                hasProfile
                  ? previous.profiles.map(
                      (
                        existingProfile,
                      ) =>
                        existingProfile.id ===
                        userId
                          ? profile
                          : existingProfile,
                    )
                  : [
                      ...previous.profiles,
                      profile,
                    ],
            };
          },
        );

        await queryClient.invalidateQueries({
          queryKey: [
            "chrona-db",
            userId,
          ],

          refetchType:
            "none",
        });
      },

    signOut: async () => {
      persistSession(null);

      await queryClient.cancelQueries();

      queryClient.clear();

      await supabase.auth.signOut();
    },
  };

  return (
    <StoreContext.Provider
      value={value}
    >
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context =
    useContext(StoreContext);

  if (!context) {
    throw new Error(
      "useStore must be used inside AppStoreProvider",
    );
  }

  return context;
}