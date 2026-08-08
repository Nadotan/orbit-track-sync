import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppNotification, Meeting, Profile, Rsvp, RsvpStatus, Team, TimeEntry } from "./types";
import {
  seedMeetings,
  seedNotifications,
  seedProfiles,
  seedRsvps,
  seedTeams,
  seedTimeEntries,
} from "./seed";

const STORAGE_KEY = "chrona-mock-db-v3";

interface DbShape {
  teams: Team[];
  profiles: Profile[];
  timeEntries: TimeEntry[];
  meetings: Meeting[];
  rsvps: Rsvp[];
  notifications: AppNotification[];
  currentUserId: string;
  authUserId: string | null;
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
  authUserId: null,
  activeSession: null,
};

const uid = () => Math.random().toString(36).slice(2, 10);

function isValidDb(value: unknown): value is DbShape {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<DbShape>;
  return (
    Array.isArray(v.profiles) &&
    v.profiles.every(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.email === "string" &&
        typeof p.password === "string" &&
        typeof p.onboarded === "boolean",
    ) &&
    Array.isArray(v.teams) &&
    Array.isArray(v.meetings) &&
    Array.isArray(v.rsvps) &&
    Array.isArray(v.notifications) &&
    Array.isArray(v.timeEntries) &&
    typeof v.currentUserId === "string" &&
    (v.authUserId === null || typeof v.authUserId === "string")
  );
}

export interface AuthResult {
  ok: boolean;
  error?: string;
}

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export interface OnboardingInput {
  name: string;
  teamId: string | null;
}

interface AppStore extends DbShape {
  currentUser: Profile;
  isAuthenticated: boolean;
  needsOnboarding: boolean;
  hydrated: boolean;
  setCurrentUserId: (id: string) => void;
  signUp: (input: SignUpInput) => AuthResult;
  signIn: (email: string, password: string) => AuthResult;
  signOut: () => void;
  completeOnboarding: (input: OnboardingInput) => void;
  startSession: () => void;
  stopSession: (description: string) => void;
  cancelSession: () => void;
  setRsvp: (meetingId: string, status: RsvpStatus) => void;
  rsvpFor: (meetingId: string, userId?: string) => Rsvp | undefined;
  createMeeting: (m: Omit<Meeting, "id">) => void;
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
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isValidDb(parsed)) {
          setDb(parsed);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }, [db, hydrated]);

  const currentUser = useMemo(
    () => db.profiles.find((p) => p.id === (db.authUserId ?? db.currentUserId)) ?? db.profiles[0]!,
    [db.profiles, db.currentUserId, db.authUserId],
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
    hydrated,
    isAuthenticated: db.authUserId !== null,
    needsOnboarding: db.authUserId !== null && !currentUser.onboarded,
    setCurrentUserId: (id) => setDb((d) => ({ ...d, currentUserId: id, authUserId: id })),
    signUp: ({ name, email, password }) => {
      const trimmedEmail = email.trim().toLowerCase();
      if (!name.trim() || !trimmedEmail || !password) {
        return { ok: false, error: "Please fill in every field." };
      }
      if (password.length < 6) {
        return { ok: false, error: "Password must be at least 6 characters." };
      }
      if (db.profiles.some((p) => p.email.toLowerCase() === trimmedEmail)) {
        return { ok: false, error: "An account with that email already exists." };
      }
      const id = uid();
      const profile: Profile = {
        id,
        name: name.trim(),
        email: trimmedEmail,
        password,
        role: "User",
        teamId: null,
        onboarded: false,
      };
      setDb((d) => ({
        ...d,
        profiles: [...d.profiles, profile],
        currentUserId: id,
        authUserId: id,
      }));
      return { ok: true };
    },
    signIn: (email, password) => {
      const trimmedEmail = email.trim().toLowerCase();
      const match = db.profiles.find((p) => p.email.toLowerCase() === trimmedEmail);
      if (!match || match.password !== password) {
        return { ok: false, error: "Incorrect email or password." };
      }
      setDb((d) => ({ ...d, currentUserId: match.id, authUserId: match.id }));
      return { ok: true };
    },
    signOut: () => setDb((d) => ({ ...d, authUserId: null })),
    completeOnboarding: ({ name, teamId }) =>
      setDb((d) => ({
        ...d,
        profiles: d.profiles.map((p) =>
          p.id === (d.authUserId ?? d.currentUserId)
            ? { ...p, name: name.trim() || p.name, teamId, onboarded: true }
            : p,
        ),
      })),
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