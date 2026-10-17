import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canManageCalendar, calendarSchema, calendarEventSchema } from "./calendar";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function manager(context: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
  if (error || !canManageCalendar((data ?? []).map((row) => row.role))) {
    throw new Error("Only team leads, mentors, and admins can change the calendar.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getCalendarData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth]).handler(async ({ context }) => {
    const [calendars, events, visibility, roles] = await Promise.all([
      context.supabase.from("calendars").select("*").order("created_at"),
      context.supabase.from("calendar_events").select("*").order("start_date").order("start_time"),
      context.supabase.from("calendar_visibility").select("calendar_id,hidden").eq("user_id", context.userId),
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
    ]);
    for (const result of [calendars, events, visibility, roles]) if (result.error) throw new Error("Could not load the calendar.");
    return {
      calendars: calendars.data ?? [], events: events.data ?? [],
      hiddenIds: (visibility.data ?? []).filter((row) => row.hidden).map((row) => row.calendar_id),
      canManage: canManageCalendar((roles.data ?? []).map((row) => row.role)),
    };
  });

export const saveCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(calendarSchema).handler(async ({ context, data }) => {
    const admin = await manager(context);
    const result = data.id
      ? await admin.from("calendars").update({ name: data.name, color: data.color }).eq("id", data.id).select("id").single()
      : await admin.from("calendars").insert({ name: data.name, color: data.color, created_by: context.userId }).select("id").single();
    if (result.error) throw new Error("Could not save the calendar.");
    return result.data;
  });

export const deleteCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ context, data }) => {
    const admin = await manager(context);
    const { error } = await admin.from("calendars").delete().eq("id", data.id);
    if (error) throw new Error("Could not delete the calendar.");
    return { ok: true };
  });

export const setCalendarVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ calendarId: z.string().uuid(), hidden: z.boolean() }))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("calendar_visibility").upsert({ user_id: context.userId, calendar_id: data.calendarId, hidden: data.hidden });
    if (error) throw new Error("Could not save calendar visibility.");
    return { ok: true };
  });

export const saveCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(calendarEventSchema).handler(async ({ context, data }) => {
    const admin = await manager(context);
    let previousMeeting: string | null = null;
    if (data.id) {
      const { data: existing, error } = await admin.from("calendar_events").select("meeting_id").eq("id", data.id).single();
      if (error) throw new Error("This event no longer exists.");
      previousMeeting = existing.meeting_id;
      if (previousMeeting && !data.isMeeting) throw new Error("A linked meeting must stay connected to its event.");
    }
    const values = {
      calendar_id: data.calendarId, title: data.title, description: data.description, location: data.location,
      start_date: data.startDate, end_date: data.endDate, start_time: data.startTime, end_time: data.endTime,
      all_day: data.allDay, team_id: data.teamId, is_meeting: data.isMeeting,
    };
    const result = data.id
      ? await admin.from("calendar_events").update(values).eq("id", data.id).select("*").single()
      : await admin.from("calendar_events").insert({ ...values, created_by: context.userId }).select("*").single();
    if (result.error) { console.error("Calendar event save failed", result.error.message); throw new Error("Could not save the event."); }
    if (result.data.meeting_id && !previousMeeting) {
      try {
        const { audienceForMeeting, sendPushToUsers } = await import("./push.server");
        const userIds = await audienceForMeeting(data.teamId);
        if (userIds.length) {
          const { error } = await admin.from("user_notifications").insert(userIds.map((userId) => ({ user_id: userId, kind: "meeting", title: "New meeting scheduled", message: `${data.title} · ${data.startDate} at ${data.startTime}`, created_by: context.userId })));
          if (error) console.error("Calendar meeting notification failed", error.message);
          await sendPushToUsers(userIds, { title: "New meeting scheduled", body: `${data.title} · ${data.startDate} at ${data.startTime}`, url: "/meetings", tag: `meeting-${result.data.meeting_id}` });
        }
      } catch (error) { console.error("Calendar meeting notification failed", error); }
    }
    return result.data;
  });

export const deleteCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator(z.object({ id: z.string().uuid() })).handler(async ({ context, data }) => {
    const admin = await manager(context);
    const { error } = await admin.from("calendar_events").delete().eq("id", data.id);
    if (error) { console.error("Calendar event delete failed", error.message); throw new Error("Could not delete the event."); }
    return { ok: true };
  });