import type { Meeting, Profile, Rsvp, TimeEntry, Team, AppNotification } from "./types";

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export const seedTeams: Team[] = [
  { id: "t1", name: "Engineering" },
  { id: "t2", name: "Design" },
  { id: "t3", name: "Operations" },
];

export const seedProfiles: Profile[] = [
  { id: "u1", name: "Avery Quinn", email: "avery@northwind.co", role: "Admin", teamId: "t3" },
  { id: "u2", name: "Noor Haddad", email: "noor@northwind.co", role: "User", teamId: "t1" },
  { id: "u3", name: "Kai Restrepo", email: "kai@northwind.co", role: "User", teamId: "t1" },
  { id: "u4", name: "Lena Fischer", email: "lena@northwind.co", role: "User", teamId: "t2" },
  { id: "u5", name: "Tobias Reid", email: "tobias@northwind.co", role: "User", teamId: null },
];

export const seedTimeEntries: TimeEntry[] = [
  {
    id: "te1",
    userId: "u2",
    startTime: hoursAgo(28),
    endTime: hoursAgo(22),
    durationMs: 6 * 3600_000,
    description: "Refactored the billing sync worker and cleaned up retry logic.",
  },
  {
    id: "te2",
    userId: "u2",
    startTime: hoursAgo(7),
    endTime: hoursAgo(3.5),
    durationMs: 3.5 * 3600_000,
    description: "Paired with Kai on the auth migration, wrote integration tests.",
  },
  {
    id: "te3",
    userId: "u3",
    startTime: hoursAgo(9),
    endTime: hoursAgo(1),
    durationMs: 8 * 3600_000,
    description: "Shipped the notifications queue and reviewed two pull requests.",
  },
  {
    id: "te4",
    userId: "u4",
    startTime: hoursAgo(30),
    endTime: hoursAgo(25),
    durationMs: 5 * 3600_000,
    description: "Explored dashboard layouts, delivered high-fidelity mocks.",
  },
];

export const seedMeetings: Meeting[] = [
  { id: "m1", title: "Company All-Hands", date: day(2), time: "10:00", teamId: "general" },
  { id: "m2", title: "Engineering Sprint Review", date: day(1), time: "14:30", teamId: "t1" },
  { id: "m3", title: "Design Critique", date: day(3), time: "11:00", teamId: "t2" },
  { id: "m4", title: "Ops Weekly Sync", date: day(4), time: "09:15", teamId: "t3" },
];

export const seedRsvps: Rsvp[] = [
  { id: "r1", userId: "u3", meetingId: "m1", status: "Attending", createdAt: hoursAgo(20) },
  { id: "r2", userId: "u4", meetingId: "m1", status: "Declined", createdAt: hoursAgo(18) },
];

export const seedNotifications: AppNotification[] = [
  {
    id: "n1",
    message: "Lena Fischer can't attend Company All-Hands.",
    createdAt: hoursAgo(18),
    read: false,
    tone: "negative",
  },
  {
    id: "n2",
    message: "Kai Restrepo is attending Company All-Hands.",
    createdAt: hoursAgo(20),
    read: true,
    tone: "positive",
  },
];
