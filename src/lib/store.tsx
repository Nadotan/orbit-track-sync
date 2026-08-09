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
    m: Omit<Meeting, "id">,
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
  userId: string,
): Promise<Db> {
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
      (r) =>
        r.user_id === id &&
        r.role === "admin",
    )
      ? "Admin"
      : "User";

  return {
    teams: (teams.data ?? []).map(
      (t) => ({
        id: t.id,
        name: t.name,
      }),
    ),

    profiles: (
      profiles.data ?? []
    ).map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      role: roleOf(p.id),
      teamId: p.team_id,
      avatarUrl: p.avatar_url,
      onboarded: p.onboarded,
    })),

    timeEntries: (
      entries.data ?? []
    ).map((e) => ({
      id: e.id,
      userId: e.user_id,
      startTime: e.start_time,
      endTime: e.end_time,
      durationMs: Number(e.duration_ms),
      description: e.description,
    })),

    meetings: (
      meetings.data ?? []
    ).map((m) => ({
      id: m.id,
      title: m.title,
      date: m.date,
      time: m.time,
      teamId:
        m.team_id ?? "general",
      recurrence:
        (m.recurrence ??
          "none") as Recurrence,
      locked: m.locked ?? false,
    })),

    rsvps: (
      rsvps.data ?? []
    ).map((r) => ({
      id: r.id,
      userId: r.user_id,
      meetingId: r.meeting_id,
      status:
        r.status as RsvpStatus,
      createdAt: r.created_at,
    })),

    notifications: (
      notifications.data ?? []
    ).map((n) => ({
      id: n.id,
      message: n.message,
      createdAt: n.created_at,
      read: n.read,
      tone:
        n.tone as AppNotification["tone"],
    })),

    ...(userId ? {} : {}),
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
  ] =
    useState<ActiveSession | null>(
      null,
    );

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          SESSION_KEY,
        );

      if (raw) {
        const parsed =
          JSON.parse(
            raw,
          ) as ActiveSession;

        if (
          parsed.userId === userId
        ) {
          setActiveSession(parsed);
        }
      }
    } catch {
      // Ignore invalid local data.
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
      void queryClient.invalidateQueries(
        {
          queryKey: [
            "chrona-db",
          ],
        },
      );
    }, [queryClient]);

  const currentUser: Profile =
    useMemo(
      () =>
        db.profiles.find(
          (p) =>
            p.id === userId,
        ) ?? {
          id: userId,

          name:
            session.user.email?.split(
              "@",
            )[0] ??
            "You",

          email:
            session.user.email ??
            "",

          role: "User",

          teamId: null,

          avatarUrl: null,

          onboarded: false,
        },

      [
        db.profiles,
        userId,
        session.user.email,
      ],
    );

  const teamName =
    useCallback(
      (
        teamId:
          | string
          | null,
      ) =>
        teamId === null
          ? "Unassigned"
          : teamId ===
              "general"
            ? "General"
            : (db.teams.find(
                  (t) =>
                    t.id ===
                    teamId,
                )?.name ??
              "Unassigned"),

      [db.teams],
    );

  const notify =
    useCallback(
      async (
        message: string,
        tone: AppNotification["tone"],
      ) => {
        await supabase
          .from(
            "notifications",
          )
          .insert({
            message,
            tone,
          });
      },
      [],
    );

  const value: AppStore = {
    ...db,

    loading: isLoading,

    currentUser,

    needsOnboarding:
      !currentUser.onboarded,

    activeSession,

    teamName,

    refresh,

    startSession: () =>
      persistSession({
        userId,
        startTime:
          new Date().toISOString(),
      }),

    cancelSession: () =>
      persistSession(null),

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

      void supabase
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
        })
        .then(refresh);
    },

    rsvpFor: (
      meetingId,
      uid,
    ) =>
      db.rsvps.find(
        (r) =>
          r.meetingId ===
            meetingId &&
          r.userId ===
            (uid ?? userId),
      ),

    setRsvp: (
      meetingId,
      status,
    ) => {
      const meeting =
        db.meetings.find(
          (m) =>
            m.id ===
            meetingId,
        );

      if (
        meeting?.locked &&
        currentUser.role !==
          "Admin"
      ) {
        return;
      }

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

        refresh();
      })();
    },

    createMeeting: (m) => {
      void (async () => {
        const {
          error:
            meetingError,
        } = await supabase
          .from("meetings")
          .insert({
            title: m.title,

            date: m.date,

            time: m.time,

            team_id:
              m.teamId ===
              "general"
                ? null
                : m.teamId,

            recurrence:
              m.recurrence ??
              "none",

            locked:
              m.locked ??
              false,
          });

        if (meetingError) {
          console.error(
            "Failed to create meeting:",
            meetingError,
          );
          return;
        }

        await notify(
          `New meeting scheduled: ${m.title}.`,
          "neutral",
        );

        refresh();
      })();
    },

    updateMeeting: (
      id,
      patch,
    ) => {
      void supabase
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
        .eq("id", id)
        .then(refresh);
    },

    toggleMeetingLock: (
      id,
    ) => {
      const meeting =
        db.meetings.find(
          (m) => m.id === id,
        );

      if (!meeting) {
        return;
      }

      void supabase
        .from("meetings")
        .update({
          locked:
            !meeting.locked,
        })
        .eq("id", id)
        .then(refresh);
    },

    deleteMeeting: (id) => {
      void supabase
        .from("meetings")
        .delete()
        .eq("id", id)
        .then(refresh);
    },

    assignTeam: (
      targetUserId,
      teamId,
    ) => {
      void supabase
        .from("profiles")
        .update({
          team_id: teamId,
        })
        .eq(
          "id",
          targetUserId,
        )
        .then(refresh);
    },

    setRole: (
      targetUserId,
      role,
    ) => {
      void (async () => {
        await supabase
          .from("user_roles")
          .delete()
          .eq(
            "user_id",
            targetUserId,
          );

        await supabase
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

        refresh();
      })();
    },

    createTeam: (name) => {
      void supabase
        .from("teams")
        .insert({
          name,
        })
        .then(refresh);
    },

    markNotificationsRead:
      () => {
        if (
          currentUser.role !==
          "Admin"
        ) {
          return;
        }

        void supabase
          .from(
            "notifications",
          )
          .update({
            read: true,
          })
          .eq("read", false)
          .then(refresh);
      },

    updateOwnProfile: async (
      patch,
    ) => {
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
          .eq("id", userId);

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
        /*
         * This is now a protected server function.
         *
         * It creates the profile when missing and
         * updates it when it already exists.
         */
        const updatedProfile =
          await completeOnboardingProfile(
            {
              data: {
                name,
                teamId,
                avatarUrl,
              },
            },
          );

        if (
          !updatedProfile ||
          !updatedProfile.onboarded
        ) {
          throw new Error(
            "Onboarding was not saved. Please try again.",
          );
        }

        /*
         * Immediately update the current query cache,
         * so needsOnboarding switches to false without
         * waiting for a network refresh.
         */
        queryClient.setQueryData<Db>(
          [
            "chrona-db",
            userId,
          ],

          (previous) => {
            if (!previous) {
              return previous;
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
                  updatedProfile.onboarded,
              };

            const hasProfile =
              previous.profiles.some(
                (existingProfile) =>
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

        await queryClient.invalidateQueries(
          {
            queryKey: [
              "chrona-db",
              userId,
            ],

            refetchType:
              "none",
          },
        );
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