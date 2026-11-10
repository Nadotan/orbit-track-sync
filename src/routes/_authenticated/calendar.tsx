
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek,
  format, isSameMonth, startOfMonth, startOfWeek,
} from "date-fns";
import {
  ArrowLeft, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight,
  Clock3, Loader2, MapPin, Pencil, Plus, SlidersHorizontal, Trash2, Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const minutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

const toTime = (value: number) => {
  const n = Math.max(0, Math.min(1439, value));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
};

const sortEvents = (events: CalendarEvent[]) => [...events].sort((a, b) =>
  Number(b.all_day) - Number(a.all_day) ||
  a.start_date.localeCompare(b.start_date) ||
  a.start_time.localeCompare(b.start_time) ||
  a.title.localeCompare(b.title));

const queryKeyRoot = (userId: string) => ["pom-calendar", userId] as const;

const queryFor = (userId: string, startDate: string, endDate: string) => queryOptions({
  queryKey: [...queryKeyRoot(userId), startDate, endDate],
  queryFn: () => getCalendarData({ data: { startDate, endDate } }),
  staleTime: 2 * 60_000,
  gcTime: 15 * 60_000,
});

function HourLabels() {
  return (
    <div className="relative h-[1344px] border-r border-border bg-card">
      {HOURS.map((hour) => (
        <span
          key={hour}
          className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
          style={{ top: hour * HOUR_HEIGHT }}
        >
          {String(hour).padStart(2, "0")}:00
        </span>
      ))}
    </div>
  );
}

function TimeGrid({
  date, events, colors, now, canManage, onCreate, onOpen,
}: {
  date: string;
  events: CalendarEvent[];
  colors: (id: string) => string;
  now: Date;
  canManage: boolean;
  onCreate: (date: string, time: string) => void;
  onOpen: (event: CalendarEvent) => void;
}) {
  const timed = events.filter(
    (e) => !e.all_day && e.start_date === date && e.end_date === date,
  );
  const layout = layoutTimedEvents(timed);

  return (
    <div
      className="relative h-[1344px] min-w-0 border-r border-border bg-card"
      onClick={(event) => {
        if (!canManage || event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onCreate(
          date,
          toTime(Math.floor((event.clientY - rect.top) / (HOUR_HEIGHT / 2)) * 30),
        );
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
          style={{
            top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT,
          }}
        />
      )}

      {timed.map((event) => {
        const start = minutes(event.start_time);
        const end = minutes(event.end_time);
        if (end <= start) return null;

        const pos = layout.get(event.id) ?? { column: 0, columns: 1 };

        return (
          <button
            key={event.id}
            type="button"
            title={event.title}
            aria-label={`Open ${event.title}, ${event.start_time} to ${event.end_time}`}
            className={cn(
              "absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
              colors(event.calendar_id),
            )}
            style={{
              top: (start / 60) * HOUR_HEIGHT,
              height: Math.max(22, ((end - start) / 60) * HOUR_HEIGHT),
              left: `calc(${(pos.column / pos.columns) * 100}% + 2px)`,
              width: `calc(${100 / pos.columns}% - 4px)`,
            }}
            onClick={(click) => {
              click.stopPropagation();
              onOpen(event);
            }}
          >
            <span dir="auto" className="block truncate font-semibold">
              {event.title}
            </span>
            <span className="block truncate text-[10px] opacity-80">
              {event.start_time}–{event.end_time}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar · POM" },
      {
        name: "description",
        content: "Shared calendars, events, and team meetings.",
      },
      { property: "og:title", content: "Calendar · POM" },
    ],
  }),
  component: () => (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center">
          <Loader2 className="animate-spin" />
        </div>
      }
    >
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
  const [showFilters, setShowFilters] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const quarterStart = new Date(
    anchor.getFullYear(),
    Math.floor(anchor.getMonth() / 3) * 3,
    1,
  );
  const periodStart = dateKey(startOfWeek(quarterStart));
  const periodEnd = dateKey(endOfWeek(endOfMonth(addMonths(quarterStart, 2))));

  const { data } = useSuspenseQuery(
    queryFor(currentUser.id, periodStart, periodEnd),
  );

  const [hiddenOverride, setHiddenOverride] = useState<string[] | null>(null);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [calendarEditor, setCalendarEditor] = useState<{
    id?: string;
    name: string;
    color: CalendarColor;
    visible: boolean;
  } | null>(null);

  const [eventEditor, setEventEditor] = useState<CalendarEventInput | null>(null);
  const [detail, setDetail] = useState<CalendarEvent | null>(null);

  const [confirmation, setConfirmation] = useState<{
    type: "calendar" | "event";
    id: string;
    name: string;
    affectsMeetings: boolean;
  } | null>(null);

  const timeScroll = useRef<HTMLDivElement>(null);
  const lastScrollKey = useRef("");

  const hidden = hiddenOverride ?? data.hiddenIds;
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);

  const visible = useMemo(
    () => data.events.filter((e) => !hiddenSet.has(e.calendar_id)),
    [data.events, hiddenSet],
  );

  const calendarById = useMemo(
    () => new Map<string, Calendar>(data.calendars.map((c) => [c.id, c])),
    [data.calendars],
  );

  const visibleCalendarCount = data.calendars.filter(
    (c) => !hiddenSet.has(c.id),
  ).length;

  const color = (id: string) =>
    calendarColorClasses[
      (calendarById.get(id)?.color ?? "primary") as CalendarColor
    ];

  const displayEvents = (day: string) =>
    visible.filter((e) => eventOccursOn(e, day));

  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);

  const monthDays = eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(monthEnd),
  });

  const weekDays = eachDayOfInterval({
    start: startOfWeek(anchor),
    end: endOfWeek(anchor),
  });

  const agendaEvents = sortEvents(
    visible.filter((e) =>
      eventOverlapsRange(e, dateKey(monthStart), dateKey(monthEnd)),
    ),
  );

  const selectedDayEvents = sortEvents(displayEvents(selectedDate));

  // The number of week rows determines how much room each row receives.
  // In six-week months show one event preview; otherwise show up to two.
  const weekCount = monthDays.length / 7;
  const mobileEventsPerCell = weekCount === 6 ? 1 : 2;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (view !== "day" && view !== "week") return;

    const key = `${view}:${selectedDate}`;
    if (lastScrollKey.current === key) return;

    const starts = visible
      .filter(
        (e) =>
          !e.all_day &&
          e.start_date === selectedDate &&
          e.end_date === selectedDate,
      )
      .map((e) => minutes(e.start_time));

    const target = starts.length ? Math.min(...starts) : 8 * 60;

    if (timeScroll.current) {
      timeScroll.current.scrollTop = Math.max(
        0,
        ((target - 60) / 60) * HOUR_HEIGHT,
      );
      lastScrollKey.current = key;
    }
  }, [view, selectedDate, visible]);

  async function reload(affectsMeetings = false) {
    await queryClient.invalidateQueries({
      queryKey: queryKeyRoot(currentUser.id),
      refetchType: "active",
    });
    if (affectsMeetings) refresh();
  }

  async function perform(
    action: () => Promise<unknown>,
    message: string,
    affectsMeetings = false,
  ) {
    if (busy) return false;
    setBusy(true);

    try {
      await action();
      await reload(affectsMeetings);
      toast.success(message);
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save changes.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function jumpTo(key: string) {
    const date = fromKey(key);
    if (!Number.isNaN(date.getTime())) {
      setAnchor(date);
      setSelectedDate(key);
    }
  }

  function move(direction: number) {
    const date =
      view === "day"
        ? addDays(fromKey(selectedDate), direction)
        : view === "week"
          ? addWeeks(anchor, direction)
          : addMonths(anchor, direction);

    jumpTo(dateKey(date));
  }

  function openDay(day: Date) {
    jumpTo(dateKey(day));
    setView("day");
  }

  function changeView(next: View) {
    if (next === "day" || next === "week") {
      setAnchor(fromKey(selectedDate));
    }
    setView(next);
  }

  function newEvent(day = selectedDate, requestedTime?: string) {
    const calendar =
      data.calendars.find((c) => !hiddenSet.has(c.id)) ?? data.calendars[0];

    if (!calendar) {
      setCalendarEditor({
        name: "",
        color: "primary",
        visible: true,
      });
      return;
    }

    const current = new Date();
    const start = requestedTime
      ? minutes(requestedTime)
      : day === dateKey(current)
        ? Math.min(
            Math.ceil(
              (current.getHours() * 60 + current.getMinutes()) / 30,
            ) * 30,
            22 * 60,
          )
        : 9 * 60;

    jumpTo(day);

    setEventEditor({
      calendarId: calendar.id,
      title: "",
      description: "",
      location: "",
      startDate: day,
      endDate: day,
      startTime: requestedTime ?? toTime(start),
      endTime: toTime(start + 60),
      allDay: false,
      teamId: null,
      isMeeting: false,
    });
  }

  function editEvent(event: CalendarEvent) {
    setDetail(null);
    setEventEditor({
      id: event.id,
      calendarId: event.calendar_id,
      title: event.title,
      description: event.description,
      location: event.location,
      startDate: event.start_date,
      endDate: event.end_date,
      startTime: event.start_time,
      endTime: event.end_time,
      allDay: event.all_day,
      teamId: event.team_id,
      isMeeting: event.is_meeting,
    });
  }

  async function toggleCalendar(calendar: Calendar) {
    if (visibilityPending) return;

    const next = hiddenSet.has(calendar.id)
      ? hidden.filter((id) => id !== calendar.id)
      : [...hidden, calendar.id];

    setVisibilityPending(true);
    setHiddenOverride(next);

    try {
      await visibilityFn({
        data: {
          calendarId: calendar.id,
          hidden: next.includes(calendar.id),
        },
      });

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

  function eventRow(event: CalendarEvent, withDate = false) {
    const name = calendarById.get(event.calendar_id)?.name;

    return (
      <button
        key={event.id}
        type="button"
        onClick={() => setDetail(event)}
        className="flex min-h-14 w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={`Open ${event.title}`}
      >
        <span className="w-14 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {withDate
            ? format(fromKey(event.start_date), "MMM d")
            : event.all_day
              ? "All day"
              : event.start_time}
        </span>

        <span
          className={cn(
            "h-8 w-[3px] shrink-0 rounded-full",
            color(event.calendar_id).dot,
          )}
        />

        <span className="min-w-0 flex-1">
          <span dir="auto" className="block truncate text-sm font-semibold">
            {event.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {event.all_day
              ? "All day"
              : event.start_date !== event.end_date
                ? `${format(fromKey(event.start_date), "MMM d")} – ${format(fromKey(event.end_date), "MMM d")}`
                : `${event.start_time}–${event.end_time}`}
            {name ? ` · ${name}` : ""}
          </span>
        </span>

        {event.is_meeting && (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  function monthView() {
    return (
      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        role="region"
        aria-label={`Month view, ${format(anchor, "MMMM yyyy")}`}
      >
        <div className="grid shrink-0 grid-cols-7 border-b border-border bg-background text-center text-[11px] font-semibold text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span key={day} className="py-1.5">
              {day}
            </span>
          ))}
        </div>

        {/* All rows share the available height. No month-grid scrolling. */}
        <div
          className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden"
          style={{
            gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
          }}
        >
          {monthDays.map((day) => {
            const key = dateKey(day);
            const events = sortEvents(displayEvents(key));
            const current = key === dateKey(now);
            const inMonth = isSameMonth(day, anchor);

            return (
              <div
                key={key}
                className={cn(
                  "group relative min-h-0 min-w-0 overflow-hidden border-b border-r border-border bg-card px-[2px] pt-0.5 sm:px-1",
                  !inMonth && "bg-muted/20",
                  key === selectedDate && "bg-primary/5",
                )}
              >
                <button
                  type="button"
                  className="absolute inset-0 z-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  onClick={() => openDay(day)}
                  aria-label={`${format(day, "EEEE, MMMM d")}, ${events.length} events. Open day view.`}
                />

                <div className="pointer-events-none relative mb-0.5 flex justify-center sm:justify-start">
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full text-[11px] font-medium tabular-nums sm:size-6 sm:text-xs",
                      current && "bg-primary text-primary-foreground",
                      key === selectedDate &&
                        !current &&
                        "ring-1 ring-primary text-primary",
                      !inMonth && "text-muted-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                <div className="relative z-10 space-y-[2px]">
                  {events.slice(0, mobileEventsPerCell).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      dir="auto"
                      title={event.title}
                      aria-label={`Open ${event.title}`}
                      className={cn(
                        "block h-[17px] w-full min-w-0 truncate rounded-[2px] border-l-[2px] px-[2px] text-start text-[9px] font-medium leading-[17px] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:h-[19px] sm:text-[11px] sm:leading-[19px]",
                        color(event.calendar_id).event,
                      )}
                      onClick={() => setDetail(event)}
                    >
                      {event.title}
                    </button>
                  ))}

                  {events.length > mobileEventsPerCell && (
                    <button
                      type="button"
                      className="absolute right-0 top-0 z-20 rounded bg-background/90 px-0.5 text-[9px] font-medium text-muted-foreground hover:underline"
                      aria-label={`${events.length - mobileEventsPerCell} more events on ${format(day, "MMMM d")}`}
                      onClick={() => openDay(day)}
                    >
                      +{events.length - mobileEventsPerCell}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function allDayRow(day: string) {
    const events = sortEvents(
      displayEvents(day).filter((e) =>
        e.all_day || e.start_date !== e.end_date,
      ),
    );

    return events.length ? (
      <div className="flex flex-wrap gap-1 border-b border-border p-1.5">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => setDetail(event)}
            className={cn(
              "max-w-44 truncate rounded border-l-[3px] px-2 py-1 text-xs",
              color(event.calendar_id).event,
            )}
          >
            {event.title}
          </button>
        ))}
      </div>
    ) : null;
  }

  function timeView() {
    const days = view === "week" ? weekDays.map(dateKey) : [selectedDate];
    const week = view === "week";

    return (
      <div className="flex min-h-0 flex-1 flex-col bg-card">
        {view === "day" && (
          <div className="flex shrink-0 justify-between gap-2 border-b px-3 py-2 text-sm">
            <span className="font-medium">
              {format(fromKey(selectedDate), "EEEE, MMMM d")}
            </span>
            <span className="text-xs text-muted-foreground">
              {selectedDayEvents.length} events
            </span>
          </div>
        )}

        {!week && allDayRow(selectedDate)}

        <div
          ref={timeScroll}
          role="region"
          aria-label={week ? "Scrollable week timeline" : "Scrollable day timeline"}
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
        >
          <div className={cn(week && "min-w-[910px] lg:min-w-0")}>
            {week && (
              <div className="sticky top-0 z-20 grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))] border-b bg-background shadow-sm">
                <div className="border-r" />

                {days.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => openDay(fromKey(key))}
                    className="min-w-0 border-r px-1 py-2 text-center hover:bg-muted"
                    aria-label={`Open ${format(fromKey(key), "EEEE MMMM d")}`}
                  >
                    <span className="block text-[11px] text-muted-foreground">
                      {format(fromKey(key), "EEE")}
                    </span>
                    <span
                      className={cn(
                        "mx-auto grid size-7 place-items-center rounded-full text-sm font-semibold",
                        key === dateKey(now) &&
                          "bg-primary text-primary-foreground",
                      )}
                    >
                      {format(fromKey(key), "d")}
                    </span>

                    {displayEvents(key)
                      .filter((e) =>
                        e.all_day || e.start_date !== e.end_date,
                      )
                      .slice(0, 1)
                      .map((event) => (
                        <span
                          key={event.id}
                          dir="auto"
                          className={cn(
                            "mt-1 block truncate rounded border-l-2 px-0.5 text-[10px]",
                            color(event.calendar_id).event,
                          )}
                        >
                          {event.title}
                        </span>
                      ))}
                  </button>
                ))}
              </div>
            )}

            <div
              className={cn(
                "grid",
                week
                  ? "grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]"
                  : "grid-cols-[3.25rem_minmax(0,1fr)]",
              )}
            >
              <HourLabels />
              {days.map((day) => (
                <TimeGrid
                  key={day}
                  date={day}
                  events={visible}
                  colors={(id) => color(id).event}
                  now={now}
                  canManage={data.canManage}
                  onCreate={newEvent}
                  onOpen={setDetail}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function agendaView() {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 lg:px-6">
        <div className="mx-auto max-w-3xl divide-y divide-border">
          {agendaEvents.map((e) => eventRow(e, true))}
          {agendaEvents.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No events this month.
            </p>
          )}
        </div>
      </div>
    );
  }

  const periodTitle =
    view === "day"
      ? format(fromKey(selectedDate), "EEE, MMM d, yyyy")
      : view === "week"
        ? `${format(weekDays[0]!, "MMM d")} – ${format(weekDays[6]!, "MMM d")}`
        : format(anchor, "MMMM yyyy");

  return (
    <div className="-mx-4 -mb-28 -mt-6 flex h-[calc(100dvh-12rem)] min-h-0 flex-col overflow-hidden border-y border-border bg-card sm:mx-0 sm:mb-0 sm:mt-0 md:h-[calc(100dvh-8rem)] sm:rounded-xl sm:border">
      <header className="shrink-0 border-b border-border bg-background px-2 py-2 sm:px-3">
        <div className="flex min-w-0 items-center gap-1">
          {view === "month" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 shrink-0 px-2 text-xs"
              onClick={() => jumpTo(dateKey(new Date()))}
            >
              Today
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 shrink-0 gap-1 px-1.5 text-xs"
              aria-label="Back to month view"
              onClick={() => setView("month")}
            >
              <ArrowLeft className="size-4" />
              Month
            </Button>
          )}

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={() => move(-1)}
            aria-label="Previous period"
          >
            <ChevronLeft className="size-4" />
          </Button>

          <button
            type="button"
            onClick={() => setShowJump(true)}
            className="min-w-0 flex-1 truncate rounded px-0.5 text-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:text-lg"
            aria-label={`Go to date. Current view: ${periodTitle}`}
          >
            {periodTitle}
          </button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            onClick={() => move(1)}
            aria-label="Next period"
          >
            <ChevronRight className="size-4" />
          </Button>

          {data.canManage && (
            <Button
              type="button"
              size="icon"
              className="size-8 shrink-0 rounded-lg"
              aria-label="Create event"
              onClick={() => newEvent()}
            >
              <Plus className="size-4" />
            </Button>
          )}
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Calendar view"
            className="flex h-9 min-w-0 items-center rounded-lg bg-muted p-0.5"
          >
            {(["month", "week", "day", "agenda"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={view === item}
                className={cn(
                  "h-8 min-w-0 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:px-3",
                  view === item
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => changeView(item)}
              >
                {item === "agenda"
                  ? "List"
                  : item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>

          <Popover open={showFilters} onOpenChange={setShowFilters}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
                aria-label={`Filter calendars: ${visibleCalendarCount} of ${data.calendars.length} visible`}
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden min-[360px]:inline">Calendars</span>
                <span className="text-muted-foreground">
                  {visibleCalendarCount}/{data.calendars.length}
                </span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </Button>
            </PopoverTrigger>

            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-[min(310px,calc(100vw-24px))] max-h-[65dvh] overflow-y-auto rounded-xl p-2"
            >
              <div className="px-2 pb-2 text-sm font-semibold">
                Visible calendars
              </div>

              <div className="space-y-0.5">
                {data.calendars.map((calendar) => {
                  const shown = !hiddenSet.has(calendar.id);

                  return (
                    <div
                      key={calendar.id}
                      className="flex min-h-11 items-center gap-2 rounded-lg px-2 hover:bg-muted/50"
                    >
                      <span
                        className={cn(
                          "size-2.5 shrink-0 rounded-full",
                          color(calendar.id).dot,
                        )}
                      />

                      <label
                        htmlFor={`visible-${calendar.id}`}
                        className="min-w-0 flex-1 cursor-pointer truncate text-sm"
                        dir="auto"
                      >
                        {calendar.name}
                      </label>

                      {data.canManage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          aria-label={`Edit ${calendar.name}`}
                          onClick={() => {
                            setShowFilters(false);
                            setCalendarEditor({
                              id: calendar.id,
                              name: calendar.name,
                              color: calendar.color as CalendarColor,
                              visible: shown,
                            });
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      )}

                      <Switch
                        id={`visible-${calendar.id}`}
                        checked={shown}
                        disabled={visibilityPending}
                        onCheckedChange={() => void toggleCalendar(calendar)}
                        aria-label={`Show ${calendar.name}`}
                      />
                    </div>
                  );
                })}
              </div>

              {data.canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-9 w-full justify-start border-t pt-2 text-xs"
                  onClick={() => {
                    setShowFilters(false);
                    setCalendarEditor({
                      name: "",
                      color: "primary",
                      visible: true,
                    });
                  }}
                >
                  <Plus className="mr-2 size-4" />
                  Add calendar
                </Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>

      {data.calendars.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6 text-center">
          <div>
            <CalendarPlus className="mx-auto size-10 text-primary/45" />
            <h2 className="mt-3 text-lg font-semibold">
              A place for every plan
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a calendar to plan with your team.
            </p>
            {data.canManage && (
              <Button
                className="mt-4"
                onClick={() => setCalendarEditor({
                  name: "",
                  color: "primary",
                  visible: true,
                })}
              >
                <Plus className="mr-1 size-4" />
                Add calendar
              </Button>
            )}
          </div>
        </div>
      ) : view === "month" ? (
        monthView()
      ) : view === "agenda" ? (
        agendaView()
      ) : (
        timeView()
      )}

      <Dialog open={showJump} onOpenChange={setShowJump}>
        <DialogContent className="w-[calc(100%-2rem)] rounded-xl sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Go to date</DialogTitle>
            <DialogDescription>
              Select a day in your calendar.
            </DialogDescription>
          </DialogHeader>

          <Input
            type="date"
            aria-label="Select calendar date"
            value={selectedDate}
            onChange={(event) => {
              if (event.target.value) {
                jumpTo(event.target.value);
                setShowJump(false);
              }
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!calendarEditor}
        onOpenChange={(open) => !open && setCalendarEditor(null)}
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {calendarEditor?.id ? "Customize calendar" : "New calendar"}
            </DialogTitle>
            <DialogDescription>Name, color, and visibility.</DialogDescription>
          </DialogHeader>

          {calendarEditor && (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const { visible: isVisible, ...input } = calendarEditor;

                const saved = await perform(async () => {
                  const result = await saveCalendarFn({ data: input });
                  const wasVisible = calendarEditor.id
                    ? !hiddenSet.has(calendarEditor.id)
                    : true;
                  if (wasVisible !== isVisible) {
                    await visibilityFn({
                      data: {
                        calendarId: result.id,
                        hidden: !isVisible,
                      },
                    });
                  }
                }, "Calendar saved");

                if (saved) setCalendarEditor(null);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="calendar-name">Name</Label>
                <Input
                  id="calendar-name"
                  autoFocus
                  required
                  maxLength={80}
                  dir="auto"
                  placeholder="e.g. Electrical"
                  value={calendarEditor.name}
                  onChange={(event) =>
                    setCalendarEditor({
                      ...calendarEditor,
                      name: event.target.value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Color</Label>
                <div className="grid grid-cols-6 gap-2">
                  {CALENDAR_COLORS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-label={`${name} calendar color`}
                      aria-pressed={calendarEditor.color === name}
                      className={cn(
                        "grid size-9 place-items-center rounded-lg focus-visible:ring-2",
                        calendarColorClasses[name].dot,
                        calendarEditor.color === name &&
                          "ring-2 ring-ring ring-offset-2",
                      )}
                      onClick={() =>
                        setCalendarEditor({
                          ...calendarEditor,
                          color: name,
                        })
                      }
                    >
                      {calendarEditor.color === name && (
                        <Check className="size-4 text-white" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label htmlFor="calendar-visible">
                  Visible for me
                </Label>
                <Switch
                  id="calendar-visible"
                  checked={calendarEditor.visible}
                  onCheckedChange={(visible) =>
                    setCalendarEditor({
                      ...calendarEditor,
                      visible,
                    })
                  }
                />
              </div>

              <div className="flex justify-between">
                {calendarEditor.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="Delete calendar"
                    onClick={() =>
                      setConfirmation({
                        type: "calendar",
                        id: calendarEditor.id!,
                        name: calendarEditor.name,
                        affectsMeetings: true,
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : (
                  <span />
                )}

                <Button type="submit" disabled={busy}>
                  {busy && (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  )}
                  Save calendar
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!eventEditor}
        onOpenChange={(open) => !open && setEventEditor(null)}
      >
        <DialogContent className="max-h-[88dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl p-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {eventEditor?.id ? "Edit event" : "New event"}
            </DialogTitle>
            <DialogDescription>
              {eventEditor
                ? format(fromKey(eventEditor.startDate), "EEEE, MMMM d")
                : ""}
            </DialogDescription>
          </DialogHeader>

          {eventEditor && (
            <form
              className="space-y-3"
              onSubmit={async (event) => {
                event.preventDefault();
                const parsed = calendarEventSchema.safeParse(eventEditor);

                if (!parsed.success) {
                  toast.error(
                    parsed.error.issues[0]?.message ?? "Check event details.",
                  );
                  return;
                }

                const saved = await perform(
                  () => saveEventFn({ data: parsed.data }),
                  parsed.data.isMeeting
                    ? "Event and meeting saved"
                    : "Event saved",
                  parsed.data.isMeeting,
                );
                if (saved) setEventEditor(null);
              }}
            >
              <Input
                aria-label="Event title"
                autoFocus
                required
                maxLength={160}
                dir="auto"
                placeholder="Add title"
                value={eventEditor.title}
                onChange={(event) =>
                  setEventEditor({
                    ...eventEditor,
                    title: event.target.value,
                  })
                }
              />

              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <Select
                  value={eventEditor.calendarId}
                  onValueChange={(calendarId) =>
                    setEventEditor({ ...eventEditor, calendarId })
                  }
                >
                  <SelectTrigger aria-label="Calendar">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {data.calendars.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2 rounded-lg border border-border px-2">
                  <Label htmlFor="event-all-day">All day</Label>
                  <Switch
                    id="event-all-day"
                    checked={eventEditor.allDay}
                    onCheckedChange={(allDay) =>
                      setEventEditor({ ...eventEditor, allDay })
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="event-start-date">Start</Label>
                  <Input
                    id="event-start-date"
                    required
                    type="date"
                    value={eventEditor.startDate}
                    onChange={(event) => {
                      const startDate = event.target.value;
                      setEventEditor({
                        ...eventEditor,
                        startDate,
                        endDate:
                          eventEditor.endDate < startDate
                            ? startDate
                            : eventEditor.endDate,
                      });
                    }}
                  />

                  {!eventEditor.allDay && (
                    <Input
                      aria-label="Start time"
                      type="time"
                      required
                      value={eventEditor.startTime}
                      onChange={(event) => {
                        const startTime = event.target.value;
                        setEventEditor({
                          ...eventEditor,
                          startTime,
                          endTime:
                            eventEditor.startDate === eventEditor.endDate &&
                            minutes(eventEditor.endTime) <= minutes(startTime)
                              ? toTime(minutes(startTime) + 60)
                              : eventEditor.endTime,
                        });
                      }}
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="event-end-date">End</Label>
                  <Input
                    id="event-end-date"
                    required
                    type="date"
                    min={eventEditor.startDate}
                    value={eventEditor.endDate}
                    onChange={(event) =>
                      setEventEditor({
                        ...eventEditor,
                        endDate: event.target.value,
                      })
                    }
                  />

                  {!eventEditor.allDay && (
                    <Input
                      aria-label="End time"
                      type="time"
                      required
                      value={eventEditor.endTime}
                      onChange={(event) =>
                        setEventEditor({
                          ...eventEditor,
                          endTime: event.target.value,
                        })
                      }
                    />
                  )}
                </div>
              </div>

              <details
                className="rounded-lg border border-border bg-muted/20 p-3"
                defaultOpen={
                  !!(
                    eventEditor.location ||
                    eventEditor.description ||
                    eventEditor.isMeeting
                  )
                }
              >
                <summary className="cursor-pointer text-sm font-medium">
                  More options
                </summary>

                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      aria-label="Location"
                      dir="auto"
                      placeholder="Location"
                      maxLength={300}
                      value={eventEditor.location}
                      onChange={(event) =>
                        setEventEditor({
                          ...eventEditor,
                          location: event.target.value,
                        })
                      }
                    />
                  </div>

                  <Textarea
                    aria-label="Description"
                    dir="auto"
                    placeholder="Description"
                    maxLength={4000}
                    value={eventEditor.description}
                    onChange={(event) =>
                      setEventEditor({
                        ...eventEditor,
                        description: event.target.value,
                      })
                    }
                  />

                  <div className="space-y-1">
                    <Label>Team</Label>
                    <Select
                      value={eventEditor.teamId ?? "general"}
                      onValueChange={(teamId) =>
                        setEventEditor({
                          ...eventEditor,
                          teamId: teamId === "general" ? null : teamId,
                        })
                      }
                    >
                      <SelectTrigger aria-label="Event team">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">
                          General · All teams
                        </SelectItem>
                        {teams.map((team) => (
                          <SelectItem key={team.id} value={team.id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                    <div className="min-w-0">
                      <Label htmlFor="event-meeting">
                        Also create a meeting
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Appear in Meetings for RSVP
                      </p>
                    </div>

                    <Switch
                      id="event-meeting"
                      checked={eventEditor.isMeeting}
                      disabled={
                        !!eventEditor.id &&
                        !!data.events.find(
                          (e) => e.id === eventEditor.id,
                        )?.meeting_id
                      }
                      onCheckedChange={(isMeeting) =>
                        setEventEditor({
                          ...eventEditor,
                          isMeeting,
                        })
                      }
                    />
                  </div>
                </div>
              </details>

              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>
                  {busy && (
                    <Loader2 className="mr-1 size-4 animate-spin" />
                  )}
                  Save event
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle dir="auto">{detail?.title}</DialogTitle>
            <DialogDescription>
              {detail ? calendarById.get(detail.calendar_id)?.name : ""}
            </DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <div className="flex gap-3 text-sm">
                <Clock3 className="size-4 shrink-0 text-muted-foreground" />
                <span>
                  {format(fromKey(detail.start_date), "EEEE, MMMM d, yyyy")}
                  {detail.end_date !== detail.start_date &&
                    ` – ${format(fromKey(detail.end_date), "MMM d, yyyy")}`}
                  <span className="block text-muted-foreground">
                    {detail.all_day
                      ? "All day"
                      : `${detail.start_time}–${detail.end_time}`}
                  </span>
                </span>
              </div>

              {detail.location && (
                <div className="flex gap-3 text-sm">
                  <MapPin className="size-4 shrink-0" />
                  <span dir="auto">{detail.location}</span>
                </div>
              )}

              {detail.description && (
                <p dir="auto" className="whitespace-pre-wrap text-sm">
                  {detail.description}
                </p>
              )}

              {detail.is_meeting && (
                <Button variant="secondary" asChild>
                  <Link to="/meetings">
                    <Users className="mr-1 size-4" />
                    View in Meetings
                  </Link>
                </Button>
              )}

              {data.canManage && (
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label="Delete event"
                    onClick={() =>
                      setConfirmation({
                        type: "event",
                        id: detail.id,
                        name: detail.title,
                        affectsMeetings: detail.is_meeting,
                      })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => editEvent(detail)}
                  >
                    <Pencil className="mr-1 size-4" />
                    Edit
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <DialogContent className="w-[calc(100%-2rem)] rounded-xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {confirmation?.type}?</DialogTitle>
            <DialogDescription>
              “{confirmation?.name}”{" "}
              {confirmation?.type === "calendar"
                ? "and all its events and linked meetings will be deleted."
                : "will be deleted, including any linked meeting."}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!confirmation) return;

                const done = await perform(
                  () =>
                    confirmation.type === "calendar"
                      ? deleteCalendarFn({
                          data: { id: confirmation.id },
                        })
                      : deleteEventFn({
                          data: { id: confirmation.id },
                        }),
                  "Deleted",
                  confirmation.affectsMeetings,
                );

                if (done) {
                  setConfirmation(null);
                  setCalendarEditor(null);
                  setDetail(null);
                }
              }}
            >
              <Trash2 className="mr-1 size-4" />
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
