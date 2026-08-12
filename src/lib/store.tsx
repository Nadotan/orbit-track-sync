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
import { signAvatarPaths, signAvatarPath } from "./avatars";
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

  updateTimeEntry: (
    id: string,
    description: string,
  ) => void;

  deleteTimeEntry: (id: string) => void;


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

async function fetchDb(
  currentUserId: string,
): Promise<Db> {
  const [
    teams,
    profiles,
    roles,
    entries,
    meetings,
    rsvps,
    notifications,
    memberships,
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("*")
      .order("name"),

    supabase
      .from("profiles")
      .select(
        "id, name, avatar_url, team_id, created_at",
      )
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

    supabase
      .from("team_members")
      .select("user_id, team_id"),
  ]);

  const membershipMap = new Map<
    string,
    string[]
  >();

  for (const row of memberships.data ?? []) {
    const list =
      membershipMap.get(row.user_id) ??
      [];

    list.push(row.team_id);

    membershipMap.set(
      row.user_id,
      list,
    );
  }


  /*
   * Roles are self-scoped by row level security, so a
   * normal member only ever sees their own role.
   */
  const roleMap = new Map<
    string,
    Profile["role"]
  >(
    (roles.data ?? [])
      .filter(
        (role) =>
          role.role === "admin",
      )
      .map(
        (role) =>
          [
            role.user_id,
            "Admin" as const,
          ] satisfies [
            string,
            Profile["role"],
          ],
      ),
  );

  const emailMap = new Map<
    string,
    string
  >();

  /*
   * Email addresses are not readable by other members.
   * Admins load them through a secured server action.
   */
  if (
    roleMap.get(currentUserId) ===
    "Admin"
  ) {
    try {
      const directory =
        await getAdminDirectory();

      for (const entry of directory.emails) {
        emailMap.set(
          entry.id,
          entry.email,
        );
      }

      for (const entry of directory.roles) {
        if (
          entry.role === "admin"
        ) {
          roleMap.set(
            entry.userId,
            "Admin",
          );
        }
      }
    } catch {
      // Directory is optional; fall back to limited data.
    }
  }

  const roleOf = (
    id: string,
  ): Profile["role"] =>
    roleMap.get(id) ?? "User";

  /*
   * Avatars are stored in a private bucket, so object paths
   * are resolved into signed URLs for display.
   */
  const avatarMap = await signAvatarPaths(
    (profiles.data ?? []).map(
      (profile) => profile.avatar_url,
    ),
  );

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
      email:
        emailMap.get(profile.id) ??
        "",
      role: roleOf(profile.id),
      teamId: profile.team_id,
      teamIds:
        membershipMap.get(profile.id) ??
        (profile.team_id
          ? [profile.team_id]
          : []),

      avatarUrl: profile.avatar_url
        ? (avatarMap.get(
            profile.avatar_url,
          ) ?? profile.avatar_url)
        : null,



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

    queryFn: () =>
      fetchDb(userId),
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

        teamIds: [],


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

    updateTimeEntry: (
      id,
      description,
    ) => {
      void (async () => {
        const { error } =
          await supabase
            .from("time_entries")
            .update({ description })
            .eq("id", id)
            .eq("user_id", userId);

        if (error) {
          console.error(
            "Failed to update time entry:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    deleteTimeEntry: (id) => {
      void (async () => {
        const { error } =
          await supabase
            .from("time_entries")
            .delete()
            .eq("id", id)
            .eq("user_id", userId);

        if (error) {
          console.error(
            "Failed to delete time entry:",
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
        try {
          await setUserRole({
            data: {
              userId:
                targetUserId,

              role:
                role === "Admin"
                  ? "admin"
                  : "user",
            },
          });
        } catch (error) {
          console.error(
            "Failed to save role:",
            error,
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

        const signedAvatarUrl =
          await signAvatarPath(
            updatedProfile.avatar_url,
          );

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

                    teamIds:
                      updatedProfile.team_id
                        ? [updatedProfile.team_id]
                        : [],


                    avatarUrl:
                      signedAvatarUrl,

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

                teamIds:
                  updatedProfile.team_id
                    ? [updatedProfile.team_id]
                    : [],


                avatarUrl:
                  signedAvatarUrl,

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