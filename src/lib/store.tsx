import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AppNotification,
  Meeting,
  Profile,
  Rsvp,
  RsvpStatus,
  Team,
  TimeEntry,
} from "./types";
import {
  seedMeetings,
  seedNotifications,
  seedProfiles,
  seedRsvps,
  seedTeams,
  seedTimeEntries,
} from "./seed";

const STORAGE_KEY = "chrona-mock-db-v1";

interface DbShape {
  teams: Team[];
  profiles: Profile[];
  timeEntries: TimeEntry[];
  meetings: Meeting[];
  rsvps: Rsvp[];
  notifications: AppNotification[];
  currentUserId: string;
  activeSession: { userId: string; startTime: string } | null;
}

const initialDb: DbShape = {
  teams: seedTeams,
  profiles: seedProfiles,
  timeEntries: seedTimeEntries,
  meetings: seedMeetings,
  rsvps: seedRsvps,
  notifications: seedNotifications,
  currentUserId: "u2",
  activeSession: null,
};

const uid = () => Math.random().toString(36).slice(2, 10);

interface AppStore extends DbShape {
  currentUser: Profile;
  setCurrentUserId: (id: string) => void;
  startSession: () => void;
  stopSession: (description: string) => void;
  cancelSession: () => void;
  setRsvp: (meetingId: string, status: RsvpStatus) => void;
  rsvpFor: (meetingId: string, userId?: string) => Rsvp | undefined;
  createMeeting: (m: Omit<Meeting, "id">) => void;
  updateMeeting: (id: string, patch: Partial<Omit<Meeting, "id">>) => void;
  toggleMeetingLock: (id: string) => void;
  deleteMeeting: (id: string) => void;
  assignTeam: (userId: string, teamId: string | null) => void;
  setRole: (userId: string, role: Profile["role"]) => void;
  createTeam: (name: string) => void;
  markNotificationsRead: () => void;
  teamName: (teamId: string | null) => string;
}

const StoreContext = createContext<AppStore | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DbShape>(initialDb);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDb({ ...initialDb, ...(JSON.parse(raw) as DbShape) });
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }, [db, hydrated]);

  const currentUser = useMemo(
    () => db.profiles.find((p) => p.id === db.currentUserId) ?? db.profiles[0]!,
    [db.profiles, db.currentUserId],
  );

  const teamName = useCallback(
    (teamId: string | null) =>
      teamId === null
        ? "Unassigned"
        : teamId === "general"
          ? "General"
          : (db.teams.find((t) => t.id === teamId)?.name ?? "Unassigned"),
    [db.teams],
  );

  const notify = useCallback(
    (message: string, tone: AppNotification["tone"]) =>
      setDb((d) => ({
        ...d,
        notifications: [
          { id: uid(), message, createdAt: new Date().toISOString(), read: false, tone },
          ...d.notifications,
        ],
      })),
    [],
  );

  const value: AppStore = {
    ...db,
    currentUser,
    teamName,
    setCurrentUserId: (id) => setDb((d) => ({ ...d, currentUserId: id })),
    startSession: () =>
      setDb((d) => ({
        ...d,
        activeSession: { userId: d.currentUserId, startTime: new Date().toISOString() },
      })),
    cancelSession: () => setDb((d) => ({ ...d, activeSession: null })),
    stopSession: (description) =>
      setDb((d) => {
        if (!d.activeSession) return d;
        const end = new Date();
        const start = new Date(d.activeSession.startTime);
        const entry: TimeEntry = {
          id: uid(),
          userId: d.activeSession.userId,
          startTime: d.activeSession.startTime,
          endTime: end.toISOString(),
          durationMs: end.getTime() - start.getTime(),
          description,
        };
        return { ...d, activeSession: null, timeEntries: [entry, ...d.timeEntries] };
      }),
    rsvpFor: (meetingId, userId) =>
      db.rsvps.find((r) => r.meetingId === meetingId && r.userId === (userId ?? db.currentUserId)),
    setRsvp: (meetingId, status) => {
      const target = db.meetings.find((m) => m.id === meetingId);
      if (target?.locked && currentUser.role !== "Admin") return;
      setDb((d) => {
        const existing = d.rsvps.find(
          (r) => r.meetingId === meetingId && r.userId === d.currentUserId,
        );
        const next: Rsvp = {
          id: existing?.id ?? uid(),
          userId: d.currentUserId,
          meetingId,
          status,
          createdAt: new Date().toISOString(),
        };
        return {
          ...d,
          rsvps: existing
            ? d.rsvps.map((r) => (r.id === existing.id ? next : r))
            : [next, ...d.rsvps],
        };
      });
      const meeting = db.meetings.find((m) => m.id === meetingId);
      notify(
        status === "Attending"
          ? `${currentUser.name} is attending ${meeting?.title}.`
          : `${currentUser.name} can't attend ${meeting?.title}.`,
        status === "Attending" ? "positive" : "negative",
      );
    },
    createMeeting: (m) => {
      setDb((d) => ({ ...d, meetings: [{ ...m, id: uid() }, ...d.meetings] }));
      notify(`New meeting scheduled: ${m.title}.`, "neutral");
    },
    updateMeeting: (id, patch) =>
      setDb((d) => ({
        ...d,
        meetings: d.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      })),
    toggleMeetingLock: (id) =>
      setDb((d) => ({
        ...d,
        meetings: d.meetings.map((m) => (m.id === id ? { ...m, locked: !m.locked } : m)),
      })),

    deleteMeeting: (id) =>
      setDb((d) => ({
        ...d,
        meetings: d.meetings.filter((m) => m.id !== id),
        rsvps: d.rsvps.filter((r) => r.meetingId !== id),
      })),
    assignTeam: (userId, teamId) =>
      setDb((d) => ({
        ...d,
        profiles: d.profiles.map((p) => (p.id === userId ? { ...p, teamId } : p)),
      })),
    setRole: (userId, role) =>
      setDb((d) => ({
        ...d,
        profiles: d.profiles.map((p) => (p.id === userId ? { ...p, role } : p)),
      })),
    createTeam: (name) => setDb((d) => ({ ...d, teams: [...d.teams, { id: uid(), name }] })),
    markNotificationsRead: () =>
      setDb((d) => ({ ...d, notifications: d.notifications.map((n) => ({ ...n, read: true })) })),
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside AppStoreProvider");
  return ctx;
}
