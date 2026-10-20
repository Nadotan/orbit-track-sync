import { z } from "zod";

export const CALENDAR_COLORS = ["primary", "success", "warning", "destructive", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type CalendarColor = typeof CALENDAR_COLORS[number];
export const calendarColorClasses: Record<CalendarColor, { dot: string; event: string }> = {
  primary: { dot: "bg-primary", event: "bg-primary/10 text-primary border-primary/30" },
  success: { dot: "bg-success", event: "bg-success/10 text-success border-success/30" },
  warning: { dot: "bg-warning", event: "bg-warning/15 text-warning-foreground border-warning/40" },
  destructive: { dot: "bg-destructive", event: "bg-destructive/10 text-destructive border-destructive/30" },
  "chart-2": { dot: "bg-chart-2", event: "bg-chart-2/10 text-chart-2 border-chart-2/30" },
  "chart-3": { dot: "bg-chart-3", event: "bg-chart-3/10 text-chart-3 border-chart-3/30" },
  "chart-4": { dot: "bg-chart-4", event: "bg-chart-4/15 text-chart-4 border-chart-4/35" },
  "chart-5": { dot: "bg-chart-5", event: "bg-chart-5/10 text-chart-5 border-chart-5/30" },
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
  id: z.string().uuid().optional(), calendarId: z.string().uuid(),
  title: z.string().trim().min(1).max(160), description: z.string().trim().max(4000),
  location: z.string().trim().max(300), startDate: date, endDate: date,
  startTime: time, endTime: time, allDay: z.boolean(),
  teamId: z.string().uuid().nullable(), isMeeting: z.boolean(),
}).refine((event) => event.endDate >= event.startDate &&
  (event.allDay || event.endDate > event.startDate || event.endTime > event.startTime),
{ message: "The event must end after it starts.", path: ["endDate"] });
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
export function eventOccursOn(event: { start_date: string; end_date: string }, day: string) {
  return event.start_date <= day && event.end_date >= day;
}
