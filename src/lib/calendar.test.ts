
import { describe, expect, test } from "vitest";
import {
  canManageCalendar, calendarEventSchema, eventOccursOn,
  eventOverlapsRange, layoutTimedEvents,
} from "./calendar";

describe("calendar permissions", () => {
  test("admins can manage", () => expect(canManageCalendar(["admin"])).toBe(true));
  test("mentors can manage", () => expect(canManageCalendar(["mentor"])).toBe(true));
  test("team leads can manage", () => expect(canManageCalendar(["team_lead"])).toBe(true));
  test("members cannot manage", () => expect(canManageCalendar(["user"])).toBe(false));
  test("multi-role managers keep permission", () => expect(canManageCalendar(["user", "mentor"])).toBe(true));
});

test("an event can link to a meeting", () => {
  const event = calendarEventSchema.parse({
    calendarId: "00000000-0000-4000-8000-000000000001", title: "Team meeting",
    description: "", location: "", startDate: "2026-10-17", endDate: "2026-10-17",
    startTime: "09:00", endTime: "10:00", allDay: false, teamId: null, isMeeting: true,
  });
  expect(event.isMeeting).toBe(true);
});

test("multi-day events include both boundaries", () => {
  const event = { start_date: "2026-10-17", end_date: "2026-10-19" };
  expect(eventOccursOn(event, "2026-10-17")).toBe(true);
  expect(eventOccursOn(event, "2026-10-19")).toBe(true);
  expect(eventOccursOn(event, "2026-10-20")).toBe(false);
});

describe("bounded data loading", () => {
  const event = { start_date: "2026-09-28", end_date: "2026-10-03" };
  test("a carry-over event is included", () => expect(eventOverlapsRange(event, "2026-10-01", "2026-12-31")).toBe(true));
  test("an event at the end boundary is included", () => expect(eventOverlapsRange(event, "2026-10-03", "2026-12-31")).toBe(true));
  test("an event outside is omitted", () => expect(eventOverlapsRange(event, "2026-10-04", "2026-12-31")).toBe(false));
});

describe("overlapping event layout", () => {
  test("back-to-back events use full width", () => {
    const result = layoutTimedEvents([
      { id: "a", start_time: "09:00", end_time: "10:00" },
      { id: "b", start_time: "10:00", end_time: "11:00" },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columns: 1 });
    expect(result.get("b")).toEqual({ column: 0, columns: 1 });
  });
  test("simultaneous events take separate columns", () => {
    const result = layoutTimedEvents([
      { id: "a", start_time: "09:00", end_time: "11:00" },
      { id: "b", start_time: "09:30", end_time: "10:30" },
    ]);
    expect(result.get("a")).toEqual({ column: 0, columns: 2 });
    expect(result.get("b")).toEqual({ column: 1, columns: 2 });
  });
  test("overlap chains share width while later events reset", () => {
    const result = layoutTimedEvents([
      { id: "a", start_time: "09:00", end_time: "10:00" },
      { id: "b", start_time: "09:30", end_time: "10:30" },
      { id: "c", start_time: "10:00", end_time: "11:00" },
      { id: "d", start_time: "12:00", end_time: "13:00" },
    ]);
    expect(result.get("a")?.columns).toBe(2);
    expect(result.get("b")?.columns).toBe(2);
    expect(result.get("c")?.columns).toBe(2);
    expect(result.get("d")).toEqual({ column: 0, columns: 1 });
  });
  test("night events remain visible", () => {
    const result = layoutTimedEvents([
      { id: "a", start_time: "00:30", end_time: "02:00" },
      { id: "b", start_time: "01:00", end_time: "03:00" },
    ]);
    expect(result.get("a")?.columns).toBe(2);
    expect(result.get("b")?.columns).toBe(2);
  });
});
