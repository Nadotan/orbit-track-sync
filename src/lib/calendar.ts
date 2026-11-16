
import { z } from "zod";

export const CALENDAR_COLORS = [
  "primary", "success", "warning", "destructive", "chart-2", "chart-3",
  "chart-4", "chart-5", "blue", "teal", "lime", "slate",
] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export const calendarColorClasses: Record<CalendarColor, { dot: string; event: string }> = {
  primary: { dot: "bg-violet-600", event: "bg-violet-600/10 text-violet-700 border-violet-600/30 dark:text-violet-300" },
  success: { dot: "bg-green-600", event: "bg-green-600/10 text-green-700 border-green-600/30 dark:text-green-300" },
  warning: { dot: "bg-yellow-500", event: "bg-yellow-500/15 text-yellow-800 border-yellow-500/35 dark:text-yellow-200" },
  destructive: { dot: "bg-red-600", event: "bg-red-600/10 text-red-700 border-red-600/30 dark:text-red-300" },
  "chart-2": { dot: "bg-indigo-600", event: "bg-indigo-600/10 text-indigo-700 border-indigo-600/30 dark:text-indigo-300" },
  "chart-3": { dot: "bg-pink-600", event: "bg-pink-600/10 text-pink-700 border-pink-600/30 dark:text-pink-300" },
  "chart-4": { dot: "bg-cyan-600", event: "bg-cyan-600/10 text-cyan-700 border-cyan-600/30 dark:text-cyan-300" },
  "chart-5": { dot: "bg-orange-500", event: "bg-orange-500/10 text-orange-700 border-orange-500/30 dark:text-orange-300" },
  blue: { dot: "bg-blue-600", event: "bg-blue-600/10 text-blue-700 border-blue-600/30 dark:text-blue-300" },
  teal: { dot: "bg-teal-600", event: "bg-teal-600/10 text-teal-700 border-teal-600/30 dark:text-teal-300" },
  lime: { dot: "bg-lime-500", event: "bg-lime-500/15 text-lime-800 border-lime-500/35 dark:text-lime-200" },
  slate: { dot: "bg-slate-500", event: "bg-slate-500/10 text-slate-700 border-slate-500/30 dark:text-slate-300" },
};

export function canManageCalendar(roles: readonly string[]) {
  return roles.some((role) => ["admin", "team_lead", "mentor"].includes(role));
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Choose a valid date.");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const calendarSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  color: z.enum(CALENDAR_COLORS),
});

export const calendarEventSchema = z.object({
  id: z.string().uuid().optional(),
  calendarId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000),
  location: z.string().trim().max(300),
  startDate: date,
  endDate: date,
  startTime: time,
  endTime: time,
  allDay: z.boolean(),
  teamId: z.string().uuid().nullable(),
  isMeeting: z.boolean(),
}).refine((event) => (
  event.endDate >= event.startDate &&
  (event.allDay || event.endDate > event.startDate || event.endTime > event.startTime)
), { message: "The event must end after it starts.", path: ["endDate"] });

export type CalendarEventInput = z.infer<typeof calendarEventSchema>;

export function eventOccursOn(
  event: { start_date: string; end_date: string }, day: string,
) {
  return event.start_date <= day && event.end_date >= day;
}

export function eventOverlapsRange(
  event: { start_date: string; end_date: string }, start: string, end: string,
) {
  return event.start_date <= end && event.end_date >= start;
}

/** Assign non-overlapping columns to timed events; adjacent events may reuse a column. */
export function layoutTimedEvents(
  events: readonly { id: string; start_time: string; end_time: string }[],
): Map<string, { column: number; columns: number }> {
  const minutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  const sorted = events.map((event) => ({
    id: event.id, start: minutes(event.start_time), end: minutes(event.end_time),
  })).filter((event) => Number.isFinite(event.start) && event.end > event.start)
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));

  const result = new Map<string, { column: number; columns: number }>();
  let cluster: typeof sorted = [];
  let clusterEnd = -1;

  function flush() {
    if (!cluster.length) return;
    const columnEnds: number[] = [];
    const assigned: Array<{ id: string; column: number }> = [];
    for (const event of cluster) {
      let column = columnEnds.findIndex((end) => end <= event.start);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = event.end;
      assigned.push({ id: event.id, column });
    }
    for (const item of assigned) {
      result.set(item.id, { column: item.column, columns: columnEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  }

  for (const event of sorted) {
    if (cluster.length && event.start >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, event.end);
  }
  flush();
  return result;
}
