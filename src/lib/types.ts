export type Role = "Admin" | "User";

export interface Team {
  id: string;
  name: string;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string | null;
}

export interface TimeEntry {
  id: string;
  userId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  description: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: string; // yyyy-MM-dd
  time: string; // HH:mm
  teamId: string | "general";
}

export type RsvpStatus = "Attending" | "Declined";

export interface Rsvp {
  id: string;
  userId: string;
  meetingId: string;
  status: RsvpStatus;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  message: string;
  createdAt: string;
  read: boolean;
  tone: "positive" | "negative" | "neutral";
}
