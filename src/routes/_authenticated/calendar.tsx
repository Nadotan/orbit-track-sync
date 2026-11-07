
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth,
  endOfWeek, format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import {
  CalendarPlus, Check, ChevronLeft, ChevronRight,
  Clock3, Loader2, MapPin, Pencil, Plus, Trash2, Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  getCalendarData, saveCalendar, deleteCalendar, saveCalendarEvent,
  deleteCalendarEvent, setCalendarVisibility,
} from "@/lib/calendar.functions";
import {
  CALENDAR_COLORS, calendarColorClasses, calendarEventSchema,
  eventOccursOn, eventOverlapsRange, layoutTimedEvents,
  type CalendarColor, type CalendarEventInput,
} from "@/lib/calendar";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type CalendarData = Awaited<ReturnType<typeof getCalendarData>>;
type CalendarEvent = CalendarData["events"][number];
type Calendar = CalendarData["calendars"][number];
type View = "month" | "week" | "day" | "agenda";
const dateKey = (date: Date) => format(date, "yyyy-MM-dd");
const fromKey = (key: string) => new Date(`${key}T12:00:00`);
const timeMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const minutesTime = (minutes: number) => {
  const clamped = Math.max(0, Math.min(minutes, 1439));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
};
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const queryKeyRoot = (userId: string) => ["pom-calendar", userId] as const;

function queryFor(userId: string, startDate: string, endDate: string) {
  return queryOptions({
    queryKey: [...queryKeyRoot(userId), startDate, endDate],
    queryFn: () => getCalendarData({ data: { startDate, endDate } }),
    staleTime: 2 * 60_000,
    gcTime: 15 * 60_000,
  });
}

function TimeGrid({
  date, events, colors, now, canManage, onCreate, onOpen,
}: {
  date: string;
  events: CalendarEvent[];
  colors: (id: string) => string;
  now: Date;
  canManage: boolean;
  onCreate: (day: string, time: string) => void;
  onOpen: (event: CalendarEvent) => void;
}) {
  const timed = events.filter((event) =>
    !event.all_day && event.start_date === date && event.end_date === date,
  );
  const layout = layoutTimedEvents(timed);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div
      className="relative h-[1344px] min-w-0 border-r border-border bg-card last:border-r-0"
      onClick={(click) => {
        if (!canManage || click.target !== click.currentTarget) return;
        const bounds = click.currentTarget.getBoundingClientRect();
        const minute = Math.floor((click.clientY - bounds.top) / (HOUR_HEIGHT / 2)) * 30;
        onCreate(date, minutesTime(minute));
      }}
    >
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="pointer-events-none absolute inset-x-0 border-t border-border/70"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
      {date === dateKey(now) && (
        <div
          aria-label="Current time"
          className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-destructive"
          style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }}
        >
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-destructive" />
        </div>
      )}
      {timed.map((event) => {
        const start = timeMinutes(event.start_time);
        const end = timeMinutes(event.end_time);
        if (end <= start) return null;
        const position = layout.get(event.id) ?? { column: 0, columns: 1 };
        return (
          <button
            key={event.id}
            type="button"
            title={`${event.title}, ${event.start_time}–${event.end_time}`}
            aria-label={`Open ${event.title}, ${event.start_time} to ${event.end_time}`}
            className={cn(
              "absolute z-10 overflow-hidden rounded-lg border-l-4 px-1.5 py-1 text-left text-xs shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              colors(event.calendar_id),
            )}
            style={{
              top: (start / 60) * HOUR_HEIGHT,
              height: Math.max(22, ((end - start) / 60) * HOUR_HEIGHT),
              left: `calc(${(position.column / position.columns) * 100}% + 3px)`,
              width: `calc(${100 / position.columns}% - 6px)`,
            }}
            onClick={(click) => { click.stopPropagation(); onOpen(event); }}
          >
            <span dir="auto" className="block truncate font-semibold">{event.title}</span>
            <span className="block truncate text-[10px] opacity-80">
              {event.start_time}–{event.end_time}
            </span>
          </button>
        );
      })}
      {canManage && (
        <div className="absolute bottom-0 right-1 text-[10px] text-muted-foreground">
          Click a free slot to add
        </div>
      )}
    </div>
  );
}

function HourLabels() {
  return (
    <div className="relative h-[1344px] border-r border-border bg-card">
      {HOURS.map((hour) => (
        <span
          key={hour}
          className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          {`${String(hour).padStart(2, "0")}:00`}
        </span>
      ))}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [
    { title: "Calendar · POM" },
    { name: "description", content: "Your POM calendars, events, and team meetings in one place." },
    { property: "og:title", content: "Calendar · POM" },
    { property: "og:description", content: "Plan together with shared calendars and connected team meetings." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => (
    <Suspense fallback={<div className="grid h-full place-items-center"><Loader2 className="animate-spin" /></div>}>
      <CalendarPage />
    </Suspense>
  ),
});

function CalendarPage() {
  const queryClient = useQueryClient();
  const { teams, currentUser, refresh } = useStore();
  const saveCalendarFn = useServerFn(saveCalendar);
  const deleteCalendarFn = useServerFn(deleteCalendar);
  const saveEventFn = useServerFn(saveCalendarEvent);
  const deleteEventFn = useServerFn(deleteCalendarEvent);
  const visibilityFn = useServerFn(setCalendarVisibility);

  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [view, setView] = useState<View>("month");
  const quarterStart = new Date(anchor.getFullYear(), Math.floor(anchor.getMonth() / 3) * 3, 1);
  const periodStart = dateKey(startOfWeek(quarterStart));
  const periodEnd = dateKey(endOfWeek(endOfMonth(addMonths(quarterStart, 2))));
  const { data } = useSuspenseQuery(queryFor(currentUser.id, periodStart, periodEnd));

  const [hiddenOverride, setHiddenOverride] = useState<string[] | null>(null);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [calendarEditor, setCalendarEditor] = useState<{
    id?: string; name: string; color: CalendarColor; visible: boolean;
  } | null>(null);
  const [eventEditor, setEventEditor] = useState<CalendarEventInput | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [confirmation, setConfirmation] = useState<{
    type: "calendar" | "event"; id: string; name: string; affectsMeetings: boolean;
  } | null>(null);
  const timeScroll = useRef<HTMLDivElement>(null);
  const lastScrollKey = useRef("");

  const hidden = hiddenOverride ?? data.hiddenIds;
  const hiddenSet = new Set(hidden);
  const visible = useMemo(
    () => data.events.filter((event) => !hiddenSet.has(event.calendar_id)),
    // hidden is always replaced, not mutated, by visibility handlers.
    [data.events, hidden],
  );
  const color = (id: string) => {
    const calendar = data.calendars.find((item) => item.id === id);
    return calendarColorClasses[(calendar?.color ?? "primary") as CalendarColor];
  };
  const displayEvents = (day: string) => visible.filter((event) => eventOccursOn(event, day));
  const sortedEvents = (events: CalendarEvent[]) => [...events].sort((a, b) =>
    Number(b.all_day) - Number(a.all_day) ||
    a.start_date.localeCompare(b.start_date) ||
    a.start_time.localeCompare(b.start_time) || a.title.localeCompare(b.title),
  );

  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const monthDays = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });
  const weekDays = eachDayOfInterval({ start: startOfWeek(anchor), end: endOfWeek(anchor) });
  const agendaEvents = sortedEvents(visible.filter((event) =>
    eventOverlapsRange(event, dateKey(monthStart), dateKey(monthEnd)),
  ));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (view !== "week" && view !== "day") return;
    const key = `${view}:${selectedDate}`;
    if (lastScrollKey.current === key) return;
    const first = visible.filter((event) =>
      !event.all_day && event.start_date === selectedDate && event.end_date === selectedDate,
    ).map((event) => timeMinutes(event.start_time));
    const target = first.length ? Math.min(...first) : 8 * 60;
    if (timeScroll.current) {
      timeScroll.current.scrollTop = Math.max(0, (target - 60) / 60 * HOUR_HEIGHT);
      lastScrollKey.current = key;
    }
  }, [view, selectedDate, visible]);

  async function reload(affectsMeetings = false) {
    await queryClient.invalidateQueries({ queryKey: queryKeyRoot(currentUser.id), refetchType: "active" });
    if (affectsMeetings) refresh();
  }

  async function perform(action: () => Promise<unknown>, message: string, affectsMeetings = false) {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      await reload(affectsMeetings);
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your changes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function move(direction: number) {
    const date = view === "day" ? addDays(fromKey(selectedDate), direction)
      : view === "week" ? addWeeks(anchor, direction) : addMonths(anchor, direction);
    setAnchor(date);
    setSelectedDate(dateKey(date));
  }
  function jumpTo(day: string) {
    const date = fromKey(day);
    if (Number.isNaN(date.getTime())) return;
    setAnchor(date);
    setSelectedDate(day);
  }
  function chooseDay(day: Date) {
    const key = dateKey(day);
    jumpTo(key);
    if (window.matchMedia("(max-width: 639px)").matches) setView("day");
    else if (selectedDate === key) setView("day");
  }
  function changeView(next: View) {
    if (next === "day" || next === "week") setAnchor(fromKey(selectedDate));
    setView(next);
  }
  function newEvent(day = selectedDate, requestedTime?: string) {
    const calendar = data.calendars.find((item) => !hiddenSet.has(item.id)) ?? data.calendars[0];
    if (!calendar) {
      setCalendarEditor({ name: "", color: "primary", visible: true });
      return;
    }
    const current = new Date();
    const start = requestedTime ? timeMinutes(requestedTime)
      : day === dateKey(current)
        ? Math.min(Math.ceil((current.getHours() * 60 + current.getMinutes()) / 30) * 30, 22 * 60)
        : 9 * 60;
    jumpTo(day);
    setEventEditor({
      calendarId: calendar.id, title: "", description: "", location: "",
      startDate: day, endDate: day, startTime: requestedTime ?? minutesTime(start),
      endTime: minutesTime(start + 60), allDay: false, teamId: null, isMeeting: false,
    });
  }
  function editEvent(event: CalendarEvent) {
    setDetail(null);
    setEventEditor({
      id: event.id, calendarId: event.calendar_id, title: event.title,
      description: event.description, location: event.location,
      startDate: event.start_date, endDate: event.end_date,
      startTime: event.start_time, endTime: event.end_time, allDay: event.all_day,
      teamId: event.team_id, isMeeting: event.is_meeting,
    });
  }
  async function toggleCalendar(calendar: Calendar) {
    if (visibilityPending) return;
    const next = hiddenSet.has(calendar.id)
      ? hidden.filter((id) => id !== calendar.id) : [...hidden, calendar.id];
    setVisibilityPending(true);
    setHiddenOverride(next);
    try {
      await visibilityFn({ data: { calendarId: calendar.id, hidden: next.includes(calendar.id) } });
      queryClient.setQueriesData<CalendarData>(
        { queryKey: queryKeyRoot(currentUser.id) },
        (old) => old ? { ...old, hiddenIds: next } : old,
      );
    } catch {
      toast.error("Could not save calendar visibility.");
    } finally {
      setHiddenOverride(null);
      setVisibilityPending(false);
    }
  }

  function eventButton(event: CalendarEvent) {
    return (
      <button
        key={event.id} type="button"
        className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => setDetail(event)}
      >
        <span className={cn("mt-1 h-7 w-1 shrink-0 rounded-full", color(event.calendar_id).dot)} />
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-medium">{event.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {event.all_day ? "All day" : `${event.start_time}–${event.end_time}`}
            {" · "}{data.calendars.find((item) => item.id === event.calendar_id)?.name}
          </span>
        </span>
        {event.is_meeting && <Users className="mt-1 size-4 shrink-0 text-muted-foreground" />}
      </button>
    );
  }

  function monthView() {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="grid grid-cols-7 border-b border-border bg-muted/20 text-center text-xs font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day} className="py-2">{day}</span>
          ))}
        </div>
        <div className="grid min-h-[440px] flex-1 grid-cols-7 auto-rows-fr">
          {monthDays.map((day) => {
            const key = dateKey(day);
            const events = sortedEvents(displayEvents(key));
            const selected = key === selectedDate;
            return (
              <div key={key} className={cn(
                "group relative min-w-0 border-b border-r border-border p-1 sm:p-1.5",
                !isSameMonth(day, anchor) && "bg-muted/20",
                selected && "bg-accent/20",
              )}>
                <button
                  type="button"
                  aria-label={`Show ${format(day, "EEEE, MMMM d, yyyy")}`}
                  aria-pressed={selected}
                  className={cn(
                    "mb-1 grid size-7 place-items-center rounded-full text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                    key === dateKey(now) && "bg-primary font-semibold text-primary-foreground",
                    selected && "ring-2 ring-ring",
                    !isSameMonth(day, anchor) && "text-muted-foreground",
                  )}
                  onClick={() => chooseDay(day)}
                >
                  {format(day, "d")}
                </button>
                {events.length > 0 && (
                  <button
                    type="button"
                    className="flex w-full items-center justify-center gap-0.5 py-1 sm:hidden"
                    aria-label={`${events.length} events on ${format(day, "MMMM d")}. Open day.`}
                    onClick={() => { jumpTo(key); setView("day"); }}
                  >
                    {events.slice(0, 3).map((event) => (
                      <span key={event.id} className={cn("size-1.5 rounded-full", color(event.calendar_id).dot)} />
                    ))}
                    {events.length > 3 && <span className="text-[9px]">+{events.length - 3}</span>}
                  </button>
                )}
                <div className="hidden space-y-0.5 sm:block">
                  {events.slice(0, 2).map((event) => (
                    <button
                      key={event.id} type="button" title={event.title}
                      className={cn(
                        "w-full truncate rounded border-l-[3px] px-1 py-0.5 text-left text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                        color(event.calendar_id).event,
                      )}
                      onClick={() => setDetail(event)}
                    >
                      {event.title}
                    </button>
                  ))}
                  {events.length > 2 && (
                    <button type="button" className="text-[10px] text-muted-foreground hover:underline"
                      onClick={() => { jumpTo(key); setView("day"); }}>
                      +{events.length - 2} more
                    </button>
                  )}
                </div>
                {data.canManage && (
                  <button type="button" title={`Add event on ${key}`} aria-label={`Add event on ${key}`}
                    className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground hover:bg-muted sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    onClick={() => newEvent(key)}>
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function allDayRow(day: string) {
    const allDay = sortedEvents(displayEvents(day).filter((event) =>
      event.all_day || event.start_date !== event.end_date,
    ));
    return allDay.length > 0 ? (
      <div className="flex flex-wrap gap-1 border-b border-border p-1.5">
        <span className="mr-1 self-center text-[10px] text-muted-foreground">All day</span>
        {allDay.map((event) => (
          <button key={event.id} type="button"
            className={cn("max-w-[190px] truncate rounded border-l-[3px] px-2 py-1 text-xs", color(event.calendar_id).event)}
            onClick={() => setDetail(event)}>{event.title}</button>
        ))}
      </div>
    ) : null;
  }

  function timeView() {
    const days = view === "week" ? weekDays.map(dateKey) : [selectedDate];
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "week" && (
          <div className="grid shrink-0 grid-cols-7 border-b border-border sm:hidden">
            {weekDays.map((day) => (
              <button key={dateKey(day)} type="button"
                aria-pressed={dateKey(day) === selectedDate}
                className={cn("py-2 text-center text-xs", dateKey(day) === selectedDate && "bg-accent")}
                onClick={() => jumpTo(dateKey(day))}>
                {format(day, "EEE")}<span className="block font-semibold">{format(day, "d")}</span>
              </button>
            ))}
          </div>
        )}
        {view === "week" && (
          <div className="hidden shrink-0 grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border sm:grid">
            <div />
            {weekDays.map((day) => (
              <button key={dateKey(day)} type="button" className="py-2 text-center text-xs hover:bg-muted"
                onClick={() => jumpTo(dateKey(day))}>
                <span className="block text-muted-foreground">{format(day, "EEE")}</span>
                <span className={cn("mx-auto grid size-7 place-items-center rounded-full", dateKey(day) === dateKey(now) && "bg-primary text-primary-foreground")}>{format(day, "d")}</span>
              </button>
            ))}
          </div>
        )}
        {view === "day" ? allDayRow(selectedDate) : (
          <>
            <div className="sm:hidden">{allDayRow(selectedDate)}</div>
            <div className="hidden grid-cols-7 sm:grid">
              {weekDays.map((day) => <div key={dateKey(day)} className="min-w-0 border-r">{allDayRow(dateKey(day))}</div>)}
            </div>
          </>
        )}
        <div ref={timeScroll} className="min-h-0 flex-1 overflow-auto" role="region" aria-label="Calendar hours">
          <div className={cn("grid min-w-0", view === "week" ? "grid-cols-[3rem_minmax(0,1fr)] sm:min-w-[800px] sm:grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]" : "grid-cols-[3rem_minmax(0,1fr)] sm:grid-cols-[3.5rem_minmax(0,1fr)]")}>
            <HourLabels />
            {view === "week" ? (
              <>
                <div className="sm:hidden">
                  <TimeGrid date={selectedDate} events={visible} colors={(id) => color(id).event}
                    now={now} canManage={data.canManage} onCreate={newEvent} onOpen={setDetail} />
                </div>
                {days.map((day) => (
                  <div className="hidden sm:block" key={day}>
                    <TimeGrid date={day} events={visible} colors={(id) => color(id).event}
                      now={now} canManage={data.canManage} onCreate={newEvent} onOpen={setDetail} />
                  </div>
                ))}
              </>
            ) : (
              <TimeGrid date={selectedDate} events={visible} colors={(id) => color(id).event}
                now={now} canManage={data.canManage} onCreate={newEvent} onOpen={setDetail} />
            )}
          </div>
        </div>
      </div>
    );
  }

  function agendaView() {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-3xl divide-y divide-border">
          {agendaEvents.map((event) => (
            <div key={event.id} className="flex items-center gap-2 py-1">
              <span className="w-14 shrink-0 text-center text-sm font-semibold">
                {format(fromKey(event.start_date < dateKey(monthStart) ? dateKey(monthStart) : event.start_date), "MMM d")}
              </span>
              <div className="min-w-0 flex-1">{eventButton(event)}</div>
            </div>
          ))}
          {agendaEvents.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">No events this month.</p>
          )}
        </div>
      </div>
    );
  }

  const periodTitle = view === "day" ? format(fromKey(selectedDate), "EEEE, MMMM d, yyyy")
    : view === "week" ? `${format(weekDays[0], "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`
      : format(anchor, "MMMM yyyy");

  return (
    <div className="-mx-4 -mb-28 -mt-6 flex h-[calc(100dvh-9rem)] min-h-[450px] flex-col overflow-hidden border-y border-border bg-card sm:mx-0 sm:mb-0 sm:mt-0 sm:h-[calc(100dvh-8rem)] sm:rounded-xl sm:border">
      <header className="shrink-0 border-b border-border p-2 sm:px-3">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => jumpTo(dateKey(new Date()))}>Today</Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Previous period" onClick={() => move(-1)}><ChevronLeft className="size-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Next period" onClick={() => move(1)}><ChevronRight className="size-4" /></Button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-lg">{periodTitle}</h1>
          {data.canManage && <Button size="sm" className="hidden sm:inline-flex" onClick={() => newEvent()}><Plus className="mr-1 size-4" /> Event</Button>}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 sm:justify-end">
          <Input type="date" aria-label="Jump to date" value={selectedDate} className="h-9 w-[140px] shrink-0 text-xs"
            onChange={(event) => { if (event.target.value) jumpTo(event.target.value); }} />
          <Select value={view} onValueChange={(next) => changeView(next as View)}>
            <SelectTrigger className="h-9 w-[125px] sm:w-[145px]" aria-label="Calendar view"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="agenda">Schedule</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>

      {data.calendars.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div><CalendarPlus className="mx-auto size-10 text-primary/45" />
            <h2 className="mt-3 text-lg font-semibold">A place for every plan</h2>
            <p className="mt-2 text-sm text-muted-foreground">Create a calendar to plan with your team.</p>
            {data.canManage && <Button className="mt-4" onClick={() => setCalendarEditor({ name: "", color: "primary", visible: true })}><Plus className="mr-1 size-4" /> Add calendar</Button>}
          </div>
        </div>
      ) : view === "month" ? monthView()
        : view === "agenda" ? agendaView() : timeView()}

      {data.calendars.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border p-2">
          <span className="hidden text-xs font-semibold text-muted-foreground sm:block">Calendars</span>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {data.calendars.map((calendar) => (
              <div key={calendar.id} className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1">
                <Checkbox disabled={visibilityPending} checked={!hiddenSet.has(calendar.id)}
                  aria-label={`Show ${calendar.name}`} onCheckedChange={() => void toggleCalendar(calendar)} />
                <span className={cn("size-2 shrink-0 rounded-full", color(calendar.id).dot)} />
                <span dir="auto" className="max-w-28 truncate text-xs">{calendar.name}</span>
                {data.canManage && <Button type="button" variant="ghost" size="icon" className="size-6"
                  aria-label={`Edit ${calendar.name}`} onClick={() => setCalendarEditor({
                    id: calendar.id, name: calendar.name,
                    color: calendar.color as CalendarColor, visible: !hiddenSet.has(calendar.id),
                  })}><Pencil className="size-3" /></Button>}
              </div>
            ))}
          </div>
          {data.canManage && <Button type="button" variant="ghost" size="icon" aria-label="Add calendar"
            onClick={() => setCalendarEditor({ name: "", color: "primary", visible: true })}><Plus /></Button>}
        </div>
      )}

      {data.canManage && <Button size="icon" aria-label="Create event" className="fixed bottom-24 right-4 z-30 size-12 rounded-xl shadow-lg sm:hidden"
        onClick={() => newEvent()}><Plus /></Button>}

      <Dialog open={!!calendarEditor} onOpenChange={(open) => !open && setCalendarEditor(null)}>
        <DialogContent className="w-[calc(100%-2rem)] rounded-xl sm:max-w-sm">
          <DialogHeader><DialogTitle>{calendarEditor?.id ? "Customize calendar" : "New calendar"}</DialogTitle>
            <DialogDescription>Name, color, and visibility.</DialogDescription></DialogHeader>
          {calendarEditor && (
            <form className="space-y-4" onSubmit={async (event) => {
              event.preventDefault();
              const { visible: isVisible, ...input } = calendarEditor;
              const saved = await perform(async () => {
                const result = await saveCalendarFn({ data: input });
                const wasVisible = calendarEditor.id ? !hiddenSet.has(calendarEditor.id) : true;
                if (wasVisible !== isVisible) {
                  await visibilityFn({ data: { calendarId: result.id, hidden: !isVisible } });
                }
              }, "Calendar saved");
              if (saved) setCalendarEditor(null);
            }}>
              <div><Label htmlFor="calendar-name">Name</Label>
                <Input id="calendar-name" autoFocus required maxLength={80} dir="auto"
                  placeholder="e.g. Electrical" value={calendarEditor.name}
                  onChange={(event) => setCalendarEditor({ ...calendarEditor, name: event.target.value })} />
              </div>
              <div><Label>Color</Label><div className="mt-2 grid grid-cols-6 gap-2">
                {CALENDAR_COLORS.map((colorName) => (
                  <button key={colorName} type="button" aria-label={`${colorName} calendar color`}
                    aria-pressed={calendarEditor.color === colorName}
                    className={cn("grid size-9 place-items-center rounded-md focus-visible:ring-2", calendarColorClasses[colorName].dot, calendarEditor.color === colorName && "ring-2 ring-ring ring-offset-2")}
                    onClick={() => setCalendarEditor({ ...calendarEditor, color: colorName })}>
                    {calendarEditor.color === colorName && <Check className="size-4 text-white" />}
                  </button>
                ))}
              </div></div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="calendar-visible">Visible for me</Label>
                <Switch id="calendar-visible" checked={calendarEditor.visible}
                  onCheckedChange={(visible) => setCalendarEditor({ ...calendarEditor, visible })} />
              </div>
              <div className="flex justify-between">
                {calendarEditor.id ? <Button type="button" variant="ghost" className="text-destructive"
                  aria-label="Delete calendar" onClick={() => setConfirmation({
                    type: "calendar", id: calendarEditor.id!, name: calendarEditor.name, affectsMeetings: true,
                  })}><Trash2 className="size-4" /></Button> : <span />}
                <Button type="submit" disabled={busy}>{busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save calendar</Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!eventEditor} onOpenChange={(open) => !open && setEventEditor(null)}>
        <DialogContent className="max-h-[88dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl p-4 sm:max-w-lg">
          <DialogHeader><DialogTitle>{eventEditor?.id ? "Edit event" : "New event"}</DialogTitle>
            <DialogDescription>{eventEditor ? format(fromKey(eventEditor.startDate), "EEEE, MMMM d") : ""}</DialogDescription>
          </DialogHeader>
          {eventEditor && (
            <form className="space-y-3" onSubmit={async (event) => {
              event.preventDefault();
              const parsed = calendarEventSchema.safeParse(eventEditor);
              if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? "Check event details.");
                return;
              }
              const saved = await perform(
                () => saveEventFn({ data: parsed.data }),
                parsed.data.isMeeting ? "Event and meeting saved" : "Event saved",
                parsed.data.isMeeting,
              );
              if (saved) setEventEditor(null);
            }}>
              <Input aria-label="Event title" autoFocus required maxLength={160} dir="auto"
                placeholder="Add title" value={eventEditor.title}
                onChange={(event) => setEventEditor({ ...eventEditor, title: event.target.value })} />
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Select value={eventEditor.calendarId}
                  onValueChange={(calendarId) => setEventEditor({ ...eventEditor, calendarId })}>
                  <SelectTrigger aria-label="Calendar"><SelectValue /></SelectTrigger>
                  <SelectContent>{data.calendars.map((calendar) => <SelectItem key={calendar.id} value={calendar.id}>{calendar.name}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-2 rounded-md border px-2">
                  <Label htmlFor="event-all-day">All day</Label>
                  <Switch id="event-all-day" checked={eventEditor.allDay}
                    onCheckedChange={(allDay) => setEventEditor({ ...eventEditor, allDay })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="event-start-date">Start</Label>
                  <Input id="event-start-date" required type="date" value={eventEditor.startDate}
                    onChange={(event) => {
                      const startDate = event.target.value;
                      setEventEditor({ ...eventEditor, startDate,
                        endDate: eventEditor.endDate < startDate ? startDate : eventEditor.endDate });
                    }} />
                  {!eventEditor.allDay && <Input aria-label="Start time" type="time" required value={eventEditor.startTime}
                    onChange={(event) => {
                      const startTime = event.target.value;
                      setEventEditor({ ...eventEditor, startTime,
                        endTime: eventEditor.startDate === eventEditor.endDate &&
                          timeMinutes(eventEditor.endTime) <= timeMinutes(startTime)
                          ? minutesTime(timeMinutes(startTime) + 60) : eventEditor.endTime });
                    }} />}
                </div>
                <div className="space-y-1"><Label htmlFor="event-end-date">End</Label>
                  <Input id="event-end-date" required type="date" min={eventEditor.startDate}
                    value={eventEditor.endDate}
                    onChange={(event) => setEventEditor({ ...eventEditor, endDate: event.target.value })} />
                  {!eventEditor.allDay && <Input aria-label="End time" type="time" required value={eventEditor.endTime}
                    onChange={(event) => setEventEditor({ ...eventEditor, endTime: event.target.value })} />}
                </div>
              </div>
              <details className="rounded-lg border bg-muted/20 p-3" defaultOpen={!!(eventEditor.location || eventEditor.description || eventEditor.isMeeting)}>
                <summary className="cursor-pointer text-sm font-medium">More options</summary>
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0" />
                    <Input aria-label="Location" dir="auto" placeholder="Location" maxLength={300}
                      value={eventEditor.location} onChange={(event) => setEventEditor({ ...eventEditor, location: event.target.value })} />
                  </div>
                  <Textarea aria-label="Description" dir="auto" placeholder="Description" maxLength={4000}
                    value={eventEditor.description} onChange={(event) => setEventEditor({ ...eventEditor, description: event.target.value })} />
                  <div><Label>Team</Label>
                    <Select value={eventEditor.teamId ?? "general"}
                      onValueChange={(teamId) => setEventEditor({ ...eventEditor, teamId: teamId === "general" ? null : teamId })}>
                      <SelectTrigger aria-label="Event team"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="general">General · All teams</SelectItem>
                        {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div><Label htmlFor="event-meeting">Also create a meeting</Label>
                      <p className="text-xs text-muted-foreground">Linked meetings appear in Meetings for RSVP.</p></div>
                    <Switch id="event-meeting" checked={eventEditor.isMeeting}
                      disabled={!!eventEditor.id && !!data.events.find((event) => event.id === eventEditor.id)?.meeting_id}
                      onCheckedChange={(isMeeting) => setEventEditor({ ...eventEditor, isMeeting })} />
                  </div>
                </div>
              </details>
              <div className="flex justify-end"><Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 size-4 animate-spin" />} Save event
              </Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-md">
          <DialogHeader><DialogTitle dir="auto">{detail?.title}</DialogTitle>
            <DialogDescription>{detail ? data.calendars.find((calendar) => calendar.id === detail.calendar_id)?.name : ""}</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm"><Clock3 className="size-4 shrink-0 text-muted-foreground" />
                <span>{format(fromKey(detail.start_date), "EEEE, MMMM d, yyyy")}
                  {detail.end_date !== detail.start_date && ` – ${format(fromKey(detail.end_date), "MMM d, yyyy")}`}
                  <span className="block text-muted-foreground">{detail.all_day ? "All day" : `${detail.start_time}–${detail.end_time}`}</span>
                </span>
              </div>
              {detail.location && <div className="flex gap-3 text-sm"><MapPin className="size-4 shrink-0" /><span dir="auto">{detail.location}</span></div>}
              {detail.description && <p dir="auto" className="whitespace-pre-wrap text-sm">{detail.description}</p>}
              {detail.is_meeting && <Button variant="secondary" asChild><Link to="/meetings"><Users className="mr-2 size-4" /> View in Meetings</Link></Button>}
              {data.canManage && <div className="flex justify-end gap-2 border-t pt-3">
                <Button type="button" variant="ghost" className="text-destructive" aria-label="Delete event"
                  onClick={() => setConfirmation({ type: "event", id: detail.id, name: detail.title, affectsMeetings: detail.is_meeting })}>
                  <Trash2 className="size-4" />
                </Button>
                <Button type="button" variant="outline" onClick={() => editEvent(detail)}><Pencil className="mr-2 size-4" /> Edit</Button>
              </div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <DialogContent className="w-[calc(100%-2rem)] rounded-xl sm:max-w-sm">
          <DialogHeader><DialogTitle>Delete {confirmation?.type}?</DialogTitle>
            <DialogDescription>
              “{confirmation?.name}” {confirmation?.type === "calendar"
                ? "and all its events and linked meetings will be deleted."
                : "will be deleted, including any linked meeting."} This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button>
            <Button variant="destructive" disabled={busy} onClick={async () => {
              if (!confirmation) return;
              const saved = await perform(
                () => confirmation.type === "calendar"
                  ? deleteCalendarFn({ data: { id: confirmation.id } })
                  : deleteEventFn({ data: { id: confirmation.id } }),
                "Deleted", confirmation.affectsMeetings,
              );
              if (saved) { setConfirmation(null); setCalendarEditor(null); setDetail(null); }
            }}><Trash2 className="mr-2 size-4" /> Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
