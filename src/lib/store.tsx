
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { CLOCK_ENABLED } from "./feature-flags";
import { completeOnboardingProfile } from "./profile.functions";
import { getCachedAvatarPaths, signAvatarPath } from "./avatars";
import {
  getAdminDirectory,
  getMentorIds,
  setUserRole,
} from "./admin.functions";
import {
  markTimerRunning,
  markTimerStopped,
  notifyMeetingCreated,
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
const DIRECTORY_CACHE_MS = 60_000;

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

  updateTimeEntry: (id: string, description: string) => void;
  deleteTimeEntry: (id: string) => void;

  setRsvp: (meetingId: string, status: RsvpStatus) => void;
  rsvpFor: (meetingId: string, userId?: string) => Rsvp | undefined;

  createMeeting: (meeting: Omit<Meeting, "id">) => void;
  updateMeeting: (
    id: string,
    patch: Partial<Omit<Meeting, "id">>,
  ) => void;
  toggleMeetingLock: (id: string) => void;
  deleteMeeting: (id: string) => void;

  assignTeam: (userId: string, teamId: string | null) => void;
  setUserTeams: (userId: string, teamIds: string[]) => void;
  setRoles: (userId: string, roles: Profile["role"][]) => void;
  createTeam: (name: string) => void;

  markNotificationsRead: () => void;
  teamName: (teamId: string | null) => string;

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

const StoreContext = createContext<AppStore | null>(null);

async function fetchDb(
  currentUserId: string,
  queryClient: QueryClient,
): Promise<Db> {
  // Shared data first; role determines whether large historical datasets
  // are needed by this user.
  const [
    teams,
    profiles,
    roles,
    meetings,
    rsvps,
    memberships,
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name")
      .order("name"),

    supabase
      .from("profiles")
      .select("id, name, avatar_url, team_id, created_at")
      .order("name"),

    supabase
      .from("user_roles")
      .select("user_id, role"),

    supabase
      .from("meetings")
      .select("id, title, date, time, team_id, recurrence, locked")
      .order("date"),

    supabase
      .from("rsvps")
      .select("id, user_id, meeting_id, status, created_at"),

    supabase
      .from("team_members")
      .select("user_id, team_id"),
  ]);

  const isAdmin = (roles.data ?? []).some(
    (role) =>
      role.user_id === currentUserId &&
      role.role === "admin",
  );

  const [entries, notifications] = await Promise.all([
    isAdmin || CLOCK_ENABLED
      ? supabase
          .from("time_entries")
          .select(
            "id, user_id, start_time, end_time, duration_ms, description",
          )
          .order("start_time", { ascending: false })
      : Promise.resolve({ data: [] }),

    isAdmin
      ? supabase
          .from("notifications")
          .select("id, message, created_at, read, tone")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const membershipMap = new Map<string, string[]>();

  for (const row of memberships.data ?? []) {
    const list = membershipMap.get(row.user_id) ?? [];
    list.push(row.team_id);
    membershipMap.set(row.user_id, list);
  }

  const roleMap = new Map<string, Set<Profile["role"]>>();

  const addRole = (userId: string, role: Profile["role"]) => {
    const set = roleMap.get(userId) ?? new Set<Profile["role"]>();
    set.add(role);
    roleMap.set(userId, set);
  };

  for (const role of roles.data ?? []) {
    if (role.role === "admin") {
      addRole(role.user_id, "Admin");
    } else if ((role.role as string) === "mentor") {
      addRole(role.user_id, "Mentor");
    }
  }

  try {
    const mentorIds = await queryClient.fetchQuery({
      queryKey: ["pom-mentor-ids", currentUserId],
      queryFn: () => getMentorIds(),
      staleTime: DIRECTORY_CACHE_MS,
    });

    for (const mentorId of mentorIds) {
      addRole(mentorId, "Mentor");
    }
  } catch {
    // Mentor directory is optional.
  }

  const emailMap = new Map<string, string>();

  if (roleMap.get(currentUserId)?.has("Admin")) {
    try {
      const directory = await queryClient.fetchQuery({
        queryKey: ["pom-admin-directory", currentUserId],
        queryFn: () => getAdminDirectory(),
        staleTime: DIRECTORY_CACHE_MS,
      });

      for (const entry of directory.emails) {
        emailMap.set(entry.id, entry.email);
      }

      for (const entry of directory.roles) {
        if (entry.role === "admin") {
          addRole(entry.userId, "Admin");
        } else if ((entry.role as string) === "mentor") {
          addRole(entry.userId, "Mentor");
        }
      }
    } catch {
      // Fall back to currently available profile information.
    }
  }

  const rolesOf = (id: string): Profile["role"][] => {
    const set = roleMap.get(id);
    if (!set || set.size === 0) return ["User"];

    const ordered: Profile["role"][] = [];
    if (set.has("Admin")) ordered.push("Admin");
    if (set.has("Mentor")) ordered.push("Mentor");
    if (ordered.length === 0) ordered.push("User");
    return ordered;
  };

  const roleOf = (id: string): Profile["role"] => {
    const set = roleMap.get(id);
    if (set?.has("Admin")) return "Admin";
    if (set?.has("Mentor")) return "Mentor";
    return "User";
  };

  const avatarMap = await getCachedAvatarPaths(
    queryClient,
    currentUserId,
    (profiles.data ?? []).map((profile) => profile.avatar_url),
  );

  return {
    teams: (teams.data ?? []).map((team) => ({
      id: team.id,
      name: team.name,
    })),

    profiles: (profiles.data ?? []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      email: emailMap.get(profile.id) ?? "",
      role: roleOf(profile.id),
      roles: rolesOf(profile.id),
      teamId: profile.team_id,
      teamIds:
        membershipMap.get(profile.id) ??
        (profile.team_id ? [profile.team_id] : []),

      avatarUrl: profile.avatar_url
        ? avatarMap.get(profile.avatar_url) ?? profile.avatar_url
        : null,

      onboarded: false,
    })),

    timeEntries: (entries.data ?? []).map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      startTime: entry.start_time,
      endTime: entry.end_time,
      durationMs: Number(entry.duration_ms),
      description: entry.description,
    })),

    meetings: (meetings.data ?? []).map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      time: meeting.time,
      teamId: meeting.team_id ?? "general",
      recurrence: (meeting.recurrence ?? "none") as Recurrence,
      locked: meeting.locked ?? false,
    })),

    rsvps: (rsvps.data ?? []).map((rsvp) => ({
      id: rsvp.id,
      userId: rsvp.user_id,
      meetingId: rsvp.meeting_id,
      status: rsvp.status as RsvpStatus,
      createdAt: rsvp.created_at,
    })),

    notifications: (notifications.data ?? []).map((notification) => ({
      id: notification.id,
      message: notification.message,
      createdAt: notification.created_at,
      read: notification.read,
      tone: notification.tone as AppNotification["tone"],
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
  const queryClient = useQueryClient();

  const [activeSession, setActiveSession] =
    useState<ActiveSession | null>(null);

  const [onboardingComplete, setOnboardingComplete] = useState(
    session.user.app_metadata?.["onboarded"] === true,
  );

  useEffect(() => {
    setOnboardingComplete(
      session.user.app_metadata?.["onboarded"] === true,
    );
  }, [userId, session.user.app_metadata?.["onboarded"]]);

  useEffect(() => {
    void sweepReminders().catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as ActiveSession;
      if (parsed.userId === userId) {
        setActiveSession(parsed);
      }
    } catch {
      // Invalid or unavailable local session data.
    }
  }, [userId]);

  const persistSession = useCallback(
    (value: ActiveSession | null) => {
      setActiveSession(value);

      if (value) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(value));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    },
    [],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["chrona-db", userId],
    queryFn: () => fetchDb(userId, queryClient),
  });

  const db = data ?? emptyDb;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ["chrona-db"],
    });
  }, [queryClient]);

  const currentUser: Profile = useMemo(() => {
    const databaseProfile = db.profiles.find(
      (profile) => profile.id === userId,
    );

    if (databaseProfile) {
      return {
        ...databaseProfile,
        onboarded: onboardingComplete,
      };
    }

    return {
      id: userId,
      name:
        session.user.user_metadata?.["name"] ??
        session.user.email?.split("@")[0] ??
        "You",
      email: session.user.email ?? "",
      role: "User",
      roles: ["User"],
      teamId: null,
      teamIds: [],
      avatarUrl: null,
      onboarded: onboardingComplete,
    };
  }, [
    db.profiles,
    userId,
    session.user.email,
    session.user.user_metadata?.["name"],
    onboardingComplete,
  ]);

  const teamName = useCallback(
    (teamId: string | null) => {
      if (teamId === null) return "Unassigned";
      if (teamId === "general") return "General";

      return (
        db.teams.find((team) => team.id === teamId)?.name ??
        "Unassigned"
      );
    },
    [db.teams],
  );

  // This is the legacy Admin Activity feed, NOT user_notifications.
  const notify = useCallback(
    async (message: string, tone: AppNotification["tone"]) => {
      const { error } = await supabase
        .from("notifications")
        .insert({ message, tone });

      if (error) {
        console.error("Failed to create admin activity:", error);
      }
    },
    [],
  );

  const value: AppStore = {
    ...db,
    loading: isLoading,
    currentUser,
    needsOnboarding: !onboardingComplete,
    activeSession,
    teamName,
    refresh,

    startSession: () => {
      const startTime = new Date().toISOString();

      persistSession({ userId, startTime });

      void markTimerRunning({
        data: { startedAt: startTime },
      }).catch(() => undefined);
    },

    cancelSession: () => {
      persistSession(null);

      void markTimerStopped().catch(() => undefined);
    },

    stopSession: (description) => {
      if (!activeSession) return;

      const end = new Date();
      const start = new Date(activeSession.startTime);

      persistSession(null);

      void markTimerStopped().catch(() => undefined);

      void (async () => {
        const { error } = await supabase
          .from("time_entries")
          .insert({
            user_id: userId,
            start_time: activeSession.startTime,
            end_time: end.toISOString(),
            duration_ms: end.getTime() - start.getTime(),
            description,
          });

        if (error) {
          console.error("Failed to save time entry:", error);
          return;
        }

        refresh();
      })();
    },

    updateTimeEntry: (id, description) => {
      void (async () => {
        const { error } = await supabase
          .from("time_entries")
          .update({ description })
          .eq("id", id)
          .eq("user_id", userId);

        if (error) {
          console.error("Failed to update time entry:", error);
          return;
        }

        refresh();
      })();
    },

    deleteTimeEntry: (id) => {
      void (async () => {
        const { error } = await supabase
          .from("time_entries")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);

        if (error) {
          console.error("Failed to delete time entry:", error);
          return;
        }

        refresh();
      })();
    },

    rsvpFor: (meetingId, uid) =>
      db.rsvps.find(
        (rsvp) =>
          rsvp.meetingId === meetingId &&
          rsvp.userId === (uid ?? userId),
      ),

    setRsvp: (meetingId, status) => {
      const meeting = db.meetings.find(
        (candidate) => candidate.id === meetingId,
      );

      if (meeting?.locked && currentUser.role !== "Admin") {
        return;
      }

      const previous =
        db.rsvps.find(
          (rsvp) =>
            rsvp.meetingId === meetingId &&
            rsvp.userId === userId,
        )?.status ?? null;

      if (previous === status) return;

      void (async () => {
        const { error: rsvpError } = await supabase
          .from("rsvps")
          .upsert(
            {
              user_id: userId,
              meeting_id: meetingId,
              status,
            },
            { onConflict: "user_id,meeting_id" },
          );

        if (rsvpError) {
          console.error("Failed to save RSVP:", rsvpError);
          return;
        }

        // Fetch only the updated RSVP instead of reloading all shared tables.
        // Keep the original upsert behavior independent of this read.
        const { data: savedRsvp, error: readError } = await supabase
          .from("rsvps")
          .select("id, user_id, meeting_id, status, created_at")
          .eq("user_id", userId)
          .eq("meeting_id", meetingId)
          .maybeSingle();

        if (!readError && savedRsvp) {
          const updatedRsvp: Rsvp = {
            id: savedRsvp.id,
            userId: savedRsvp.user_id,
            meetingId: savedRsvp.meeting_id,
            status: savedRsvp.status as RsvpStatus,
            createdAt: savedRsvp.created_at,
          };

          queryClient.setQueryData<Db>(
            ["chrona-db", userId],
            (previousDb) => {
              if (!previousDb) return previousDb;

              return {
                ...previousDb,
                rsvps: [
                  ...previousDb.rsvps.filter(
                    (rsvp) =>
                      !(
                        rsvp.userId === userId &&
                        rsvp.meetingId === meetingId
                      ),
                  ),
                  updatedRsvp,
                ],
              };
            },
          );

          // Mark the overall store stale without immediately re-fetching it.
          // The normal focus refresh can reconcile other users' updates.
          void queryClient.invalidateQueries({
            queryKey: ["chrona-db", userId],
            refetchType: "none",
          });
        } else {
          // Preserve correct behavior if the supplementary read is unavailable.
          refresh();
        }

        const meetingTitle = meeting?.title ?? "a meeting";

        const activityMessage =
          status === "Attending"
            ? previous === "Declined"
              ? `${currentUser.name} is now attending ${meetingTitle}.`
              : `${currentUser.name} is attending ${meetingTitle}.`
            : previous === "Attending"
              ? `${currentUser.name} cancelled attendance for ${meetingTitle}.`
              : `${currentUser.name} can't attend ${meetingTitle}.`;

        // Write exactly once to Admin Activity.
        await notify(
          activityMessage,
          status === "Attending" ? "positive" : "negative",
        );

        // RSVP responses are recorded in Admin Activity only.
        // Do not invoke the push server function for RSVP changes.

        // An admin also needs the newly inserted Admin Activity row.
        // Ordinary members avoid this expensive full-store refresh.
        if (currentUser.role === "Admin") {
          refresh();
        }
      })();
    },

    createMeeting: (meeting) => {
      void (async () => {
        const { data: createdMeeting, error: meetingError } =
          await supabase
            .from("meetings")
            .insert({
              title: meeting.title,
              date: meeting.date,
              time: meeting.time,
              team_id:
                meeting.teamId === "general"
                  ? null
                  : meeting.teamId,
              recurrence: meeting.recurrence ?? "none",
              locked: meeting.locked ?? false,
            })
            .select("id")
            .maybeSingle();

        if (meetingError) {
          console.error("Failed to create meeting:", meetingError);
          return;
        }

        await notify(
          `New meeting scheduled: ${meeting.title}.`,
          "neutral",
        );

        if (createdMeeting?.id) {
          void notifyMeetingCreated({
            data: {
              meetingId: createdMeeting.id,
            },
          }).catch(() => undefined);
        }

        refresh();
      })();
    },

    updateMeeting: (id, patch) => {
      void (async () => {
        const { error } = await supabase
          .from("meetings")
          .update({
            ...(patch.title !== undefined
              ? { title: patch.title }
              : {}),

            ...(patch.date !== undefined
              ? { date: patch.date }
              : {}),

            ...(patch.time !== undefined
              ? { time: patch.time }
              : {}),

            ...(patch.teamId !== undefined
              ? {
                  team_id:
                    patch.teamId === "general"
                      ? null
                      : patch.teamId,
                }
              : {}),

            ...(patch.recurrence !== undefined
              ? { recurrence: patch.recurrence }
              : {}),

            ...(patch.locked !== undefined
              ? { locked: patch.locked }
              : {}),
          })
          .eq("id", id);

        if (error) {
          console.error("Failed to update meeting:", error);
          return;
        }

        refresh();
      })();
    },

    toggleMeetingLock: (id) => {
      const meeting = db.meetings.find(
        (candidate) => candidate.id === id,
      );

      if (!meeting) return;

      void (async () => {
        const { error } = await supabase
          .from("meetings")
          .update({ locked: !meeting.locked })
          .eq("id", id);

        if (error) {
          console.error("Failed to change meeting lock:", error);
          return;
        }

        refresh();
      })();
    },

    deleteMeeting: (id) => {
      void (async () => {
        const { error } = await supabase
          .from("meetings")
          .delete()
          .eq("id", id);

        if (error) {
          console.error("Failed to delete meeting:", error);
          return;
        }

        refresh();
      })();
    },

    assignTeam: (targetUserId, teamId) => {
      void (async () => {
        const { error } = await supabase
          .from("profiles")
          .update({ team_id: teamId })
          .eq("id", targetUserId);

        if (error) {
          console.error("Failed to assign team:", error);
          return;
        }

        refresh();
      })();
    },

    /*
     * Multi-team membership remains backed by team_members.
     * profiles.team_id stores the first team for older views.
     */
    setUserTeams: (targetUserId, teamIds) => {
      void (async () => {
        const unique = Array.from(new Set(teamIds));

        const { error: deleteError } = await supabase
          .from("team_members")
          .delete()
          .eq("user_id", targetUserId);

        if (deleteError) {
          console.error("Failed to update teams:", deleteError);
          return;
        }

        if (unique.length > 0) {
          const { error: insertError } = await supabase
            .from("team_members")
            .insert(
              unique.map((teamId) => ({
                user_id: targetUserId,
                team_id: teamId,
              })),
            );

          if (insertError) {
            console.error("Failed to update teams:", insertError);
            return;
          }
        }

        const { error: profileError } = await supabase
          .from("profiles")
          .update({ team_id: unique[0] ?? null })
          .eq("id", targetUserId);

        if (profileError) {
          console.error(
            "Failed to update primary team:",
            profileError,
          );
        }

        refresh();
      })();
    },

    setRoles: (targetUserId, nextRoles) => {
      void (async () => {
        try {
          await setUserRole({
            data: {
              userId: targetUserId,
              roles: nextRoles.map((role) =>
                role === "Admin"
                  ? ("admin" as const)
                  : role === "Mentor"
                    ? ("mentor" as const)
                    : ("user" as const),
              ),
            },
          });
        } catch (error) {
          console.error("Failed to save role:", error);
          return;
        }

        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["pom-mentor-ids", userId],
            refetchType: "none",
          }),
          queryClient.invalidateQueries({
            queryKey: ["pom-admin-directory", userId],
            refetchType: "none",
          }),
        ]);

        refresh();
      })();
    },

    createTeam: (name) => {
      void (async () => {
        const { error } = await supabase
          .from("teams")
          .insert({ name });

        if (error) {
          console.error("Failed to create team:", error);
          return;
        }

        refresh();
      })();
    },

    markNotificationsRead: () => {
      if (currentUser.role !== "Admin") return;

      void (async () => {
        const { error } = await supabase
          .from("notifications")
          .update({ read: true })
          .eq("read", false);

        if (error) {
          console.error(
            "Failed to mark admin activity as read:",
            error,
          );
          return;
        }

        refresh();
      })();
    },

    updateOwnProfile: async (patch) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          ...(patch.name !== undefined
            ? { name: patch.name }
            : {}),

          ...(patch.avatarUrl !== undefined
            ? { avatar_url: patch.avatarUrl }
            : {}),
        })
        .eq("id", userId);

      if (error) {
        throw new Error(error.message);
      }

      refresh();
    },

    completeOnboarding: async ({
      name,
      teamId,
      avatarUrl,
    }) => {
      const updatedProfile = await completeOnboardingProfile({
        data: {
          name,
          teamId,
          avatarUrl,
        },
      });

      if (!updatedProfile || !updatedProfile.onboarded) {
        throw new Error(
          "Onboarding was not saved. Please try again.",
        );
      }

      const signedAvatarUrl = await signAvatarPath(
        updatedProfile.avatar_url,
      );

      const { error: refreshSessionError } =
        await supabase.auth.refreshSession();

      if (refreshSessionError) {
        console.warn(
          "Profile completed but session refresh failed:",
          refreshSessionError,
        );
      }

      setOnboardingComplete(true);

      queryClient.setQueryData<Db>(
        ["chrona-db", userId],
        (previous) => {
          if (!previous) {
            return {
              ...emptyDb,
              profiles: [
                {
                  id: updatedProfile.id,
                  name: updatedProfile.name,
                  email: updatedProfile.email,
                  role: currentUser.role,
                  roles: currentUser.roles,
                  teamId: updatedProfile.team_id,
                  teamIds: updatedProfile.team_id
                    ? [updatedProfile.team_id]
                    : [],
                  avatarUrl: signedAvatarUrl,
                  onboarded: true,
                },
              ],
            };
          }

          const existing = previous.profiles.find(
            (profile) => profile.id === userId,
          );

          const profile: Profile = {
            id: updatedProfile.id,
            name: updatedProfile.name,
            email: updatedProfile.email,
            role: existing?.role ?? currentUser.role,
            roles: existing?.roles ?? currentUser.roles,
            teamId: updatedProfile.team_id,
            teamIds: updatedProfile.team_id
              ? [updatedProfile.team_id]
              : [],
            avatarUrl: signedAvatarUrl,
            onboarded: true,
          };

          const hasProfile = previous.profiles.some(
            (existingProfile) =>
              existingProfile.id === userId,
          );

          return {
            ...previous,
            profiles: hasProfile
              ? previous.profiles.map((existingProfile) =>
                  existingProfile.id === userId
                    ? profile
                    : existingProfile,
                )
              : [...previous.profiles, profile],
          };
        },
      );

      await queryClient.invalidateQueries({
        queryKey: ["chrona-db", userId],
        refetchType: "none",
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
    <StoreContext.Provider value={value}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const context = useContext(StoreContext);

  if (!context) {
    throw new Error(
      "useStore must be used inside AppStoreProvider",
    );
  }

  return context;
}
