import { describe, expect, test } from "bun:test";
import { canManageCalendar, calendarEventSchema, eventOccursOn } from "./calendar";

describe("calendar permissions", () => {
  test("admins can change calendars", () => expect(canManageCalendar(["admin"])).toBe(true));
  test("mentors can change calendars", () => expect(canManageCalendar(["mentor"])).toBe(true));
  test("team leads can change calendars", () => expect(canManageCalendar(["team_lead"])).toBe(true));
  test("ordinary users cannot change calendars", () => expect(canManageCalendar(["user"])).toBe(false));
  test("multiple roles preserve management rights", () => expect(canManageCalendar(["user", "mentor"])).toBe(true));
});
test("calendar events can also be meetings", () => {
  const result = calendarEventSchema.parse({ calendarId: "00000000-0000-4000-8000-000000000001", title: "Team meeting", description: "", location: "", startDate: "2026-10-17", endDate: "2026-10-17", startTime: "09:00", endTime: "10:00", allDay: false, teamId: null, isMeeting: true });
  expect(result.isMeeting).toBe(true);
});
test("multi-day events include both calendar dates", () => {
  const event = { start_date: "2026-10-17", end_date: "2026-10-19" };
  expect(eventOccursOn(event, "2026-10-19")).toBe(true);
  expect(eventOccursOn(event, "2026-10-20")).toBe(false);
});