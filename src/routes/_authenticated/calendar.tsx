import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Suspense, useState } from "react";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import {
  deleteCalendar,
  deleteCalendarEvent,
  getCalendarData,
  saveCalendar,
  saveCalendarEvent,
  setCalendarVisibility,
} from "@/lib/calendar.functions";
import {
  CALENDAR_COLORS,
  calendarColorClasses,
  calendarEventSchema,
  eventOccursOn,
  type CalendarColor,
  type CalendarEventInput,
} from "@/lib/calendar";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const calendarQuery = queryOptions({
  queryKey: ["pom-calendar"],
  queryFn: () => getCalendarData(),
});

type CalendarData = Awaited<ReturnType<typeof getCalendarData>>;
type CalendarEvent = CalendarData["events"][number];
type Calendar = CalendarData["calendars"][number];

const dateKey = (date: Date) => format(date, "yyyy-MM-dd");

const fromKey = (key: string) => new Date(`${key}T12:00:00`);

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({
    meta: [
      {
        title: "Calendar · POM",
      },
      {
        name: "description",
        content: "Your POM calendars, events, and team meetings in one place.",
      },
      {
        property: "og:title",
        content: "Calendar · POM",
      },
      {
        property: "og:description",
        content: "Plan together with shared calendars and connected team meetings.",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
    ],
  }),

  component: CalendarRoute,
});

function CalendarRoute() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-96 place-items-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      }
    >
      <CalendarPage />
    </Suspense>
  );
}

function CalendarPage() {
  const { data } = useSuspenseQuery(calendarQuery);

  const queryClient = useQueryClient();

  const { teams, refresh } = useStore();

  const saveCalendarFn = useServerFn(saveCalendar);
  const deleteCalendarFn = useServerFn(deleteCalendar);
  const saveEventFn = useServerFn(saveCalendarEvent);
  const deleteEventFn = useServerFn(deleteCalendarEvent);
  const visibilityFn = useServerFn(setCalendarVisibility);

  const [anchor, setAnchor] = useState(() => new Date());

  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));

  const [view, setView] = useState<"month" | "week" | "agenda">("month");

  const [calendarEditor, setCalendarEditor] = useState<{
    id?: string;
    name: string;
    color: CalendarColor;
  } | null>(null);

  const [eventEditor, setEventEditor] = useState<CalendarEventInput | null>(null);

  const [detail, setDetail] = useState<CalendarEvent | null>(null);

  const [busy, setBusy] = useState(false);

  const [confirmation, setConfirmation] = useState<{
    type: "calendar" | "event";
    id: string;
    name: string;
  } | null>(null);

  const [hiddenOverride, setHiddenOverride] = useState<string[] | null>(null);

  const hidden = hiddenOverride ?? data.hiddenIds;

  const visibleEvents = data.events.filter(
    (event) => !hidden.includes(event.calendar_id),
  );

  const calendarOf = (id: string) =>
    data.calendars.find((calendar) => calendar.id === id);

  const colorOf = (id: string) =>
    calendarColorClasses[
      (calendarOf(id)?.color ?? "primary") as CalendarColor
    ];

  const days =
    view === "week"
      ? eachDayOfInterval({
          start: startOfWeek(anchor, {
            weekStartsOn: 0,
          }),
          end: endOfWeek(anchor, {
            weekStartsOn: 0,
          }),
        })
      : eachDayOfInterval({
          start: startOfWeek(startOfMonth(anchor)),
          end: endOfWeek(endOfMonth(anchor)),
        });

  const agendaEvents = visibleEvents.filter(
    (event) =>
      event.end_date >= dateKey(startOfMonth(anchor)) &&
      event.start_date <= dateKey(endOfMonth(anchor)),
  );

  const selectedEvents = visibleEvents.filter((event) =>
    eventOccursOn(event, selectedDate),
  );

  const periodTitle =
    view === "week"
      ? `${format(startOfWeek(anchor), "MMM d")} – ${format(
          endOfWeek(anchor),
          "MMM d, yyyy",
        )}`
      : format(anchor, "MMMM yyyy");

  async function reload() {
    await queryClient.invalidateQueries({
      queryKey: calendarQuery.queryKey,
    });

    refresh();
  }

  async function perform(
    action: () => Promise<unknown>,
    success: string,
  ) {
    if (busy) {
      return;
    }

    setBusy(true);

    try {
      await action();

      await reload();

      toast.success(success);

      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save your changes.",
      );

      return false;
    } finally {
      setBusy(false);
    }
  }

  function newEvent(day = selectedDate) {
    const calendar =
      data.calendars.find((item) => !hidden.includes(item.id)) ??
      data.calendars[0];

    if (!calendar) {
      setCalendarEditor({
        name: "",
        color: "primary",
      });

      return;
    }

    const now = new Date();

    const startHour =
      day === dateKey(now)
        ? Math.min(
            Math.max(now.getHours() + 1, 7),
            22,
          )
        : 9;

    const startTime = `${String(startHour).padStart(2, "0")}:00`;

    const endTime = `${String(
      Math.min(startHour + 1, 23),
    ).padStart(2, "0")}:00`;

    setSelectedDate(day);

    setEventEditor({
      calendarId: calendar.id,
      title: "",
      description: "",
      location: "",
      startDate: day,
      endDate: day,
      startTime,
      endTime,
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

  function move(direction: number) {
    const next =
      view === "week"
        ? addWeeks(anchor, direction)
        : addMonths(anchor, direction);

    setAnchor(next);
    setSelectedDate(dateKey(next));
  }

  async function toggleCalendar(calendar: Calendar) {
    const next = hidden.includes(calendar.id)
      ? hidden.filter((id) => id !== calendar.id)
      : [...hidden, calendar.id];

    setHiddenOverride(next);

    try {
      await visibilityFn({
        data: {
          calendarId: calendar.id,
          hidden: next.includes(calendar.id),
        },
      });

      await queryClient.invalidateQueries({
        queryKey: calendarQuery.queryKey,
      });
    } catch {
      toast.error("Could not save calendar visibility.");
    } finally {
      setHiddenOverride(null);
    }
  }

  function EventRow({
    event,
  }: {
    event: CalendarEvent;
  }) {
    return (
      <Button
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-xl px-2 py-3 text-left"
        onClick={() => setDetail(event)}
      >
        <span
          className={cn(
            "h-10 w-1 shrink-0 rounded-full",
            colorOf(event.calendar_id).dot,
          )}
        />

        <span className="min-w-0 flex-1">
          <span
            dir="auto"
            className="block truncate font-medium"
          >
            {event.title}
          </span>

          <span className="mt-1 block text-xs font-normal text-muted-foreground">
            {event.all_day
              ? "All day"
              : `${event.start_time} – ${event.end_time}`}{" "}
            · {calendarOf(event.calendar_id)?.name}
          </span>
        </span>

        {event.is_meeting && (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}
      </Button>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <div className="mr-1 flex items-center gap-2">
            <div className="grid size-10 place-items-center rounded-xl bg-accent text-primary">
              <CalendarDays className="size-5" />
            </div>

            <h1 className="hidden text-xl font-semibold sm:block">
              Calendar
            </h1>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            onClick={() => {
              setAnchor(new Date());
              setSelectedDate(dateKey(new Date()));
            }}
          >
            Today
          </Button>

          <div className="flex">
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Previous period"
              onClick={() => move(-1)}
            >
              <ChevronLeft />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label="Next period"
              onClick={() => move(1)}
            >
              <ChevronRight />
            </Button>
          </div>

          <h2 className="min-w-0 text-lg font-semibold sm:text-2xl">
            {periodTitle}
          </h2>
        </div>

        <div className="ml-auto flex rounded-xl border border-border bg-background p-1">
          {(["month", "week", "agenda"] as const).map((mode) => (
            <Button
              key={mode}
              variant="ghost"
              size="sm"
              className={cn(
                "rounded-lg capitalize",
                view === mode &&
                  "bg-accent text-accent-foreground shadow-sm",
              )}
              onClick={() => setView(mode)}
            >
              {mode === "agenda"
                ? "Schedule"
                : mode}
            </Button>
          ))}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <div className="hidden lg:block">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold">
                {format(anchor, "MMMM yyyy")}
              </span>

              <div className="flex">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Previous mini-calendar month"
                  onClick={() =>
                    setAnchor(
                      addMonths(anchor, -1),
                    )
                  }
                >
                  <ChevronLeft />
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Next mini-calendar month"
                  onClick={() =>
                    setAnchor(
                      addMonths(anchor, 1),
                    )
                  }
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-y-1">
              {[
                "S",
                "M",
                "T",
                "W",
                "T",
                "F",
                "S",
              ].map((day, index) => (
                <span
                  key={index}
                  className="py-1 text-center text-[10px] text-muted-foreground"
                >
                  {day}
                </span>
              ))}

              {eachDayOfInterval({
                start: startOfWeek(
                  startOfMonth(anchor),
                ),
                end: endOfWeek(
                  endOfMonth(anchor),
                ),
              }).map((day) => (
                <Button
                  key={dateKey(day)}
                  variant="ghost"
                  className={cn(
                    "h-7 w-full rounded-full p-0 text-xs",
                    !isSameMonth(
                      day,
                      anchor,
                    ) &&
                      "text-muted-foreground/40",
                    selectedDate ===
                      dateKey(day) &&
                      "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                  )}
                  onClick={() => {
                    setSelectedDate(
                      dateKey(day),
                    );

                    setAnchor(day);
                  }}
                >
                  {format(day, "d")}
                </Button>
              ))}
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                My calendars
              </h2>

              {data.canManage && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Add calendar"
                  onClick={() =>
                    setCalendarEditor({
                      name: "",
                      color: "primary",
                    })
                  }
                >
                  <Plus />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-2 lg:block lg:space-y-1">
              {data.calendars.map(
                (calendar) => (
                  <div
                    key={calendar.id}
                    className="flex min-w-0 items-center gap-2 rounded-xl border border-border px-2 py-2 transition-colors hover:bg-muted/50 lg:border-0"
                  >
                    <Checkbox
                      checked={
                        !hidden.includes(
                          calendar.id,
                        )
                      }
                      aria-label={`Show ${calendar.name}`}
                      onCheckedChange={() =>
                        void toggleCalendar(
                          calendar,
                        )
                      }
                    />

                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        colorOf(
                          calendar.id,
                        ).dot,
                      )}
                    />

                    <span
                      dir="auto"
                      className="min-w-0 flex-1 truncate text-sm"
                    >
                      {calendar.name}
                    </span>

                    {data.canManage && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0"
                        aria-label={`Edit ${calendar.name}`}
                        onClick={() =>
                          setCalendarEditor({
                            id: calendar.id,
                            name:
                              calendar.name,
                            color:
                              calendar.color as CalendarColor,
                          })
                        }
                      >
                        <MoreHorizontal />
                      </Button>
                    )}
                  </div>
                ),
              )}
            </div>

            {!data.calendars.length && (
              <p className="py-2 text-sm text-muted-foreground">
                No calendars yet.
              </p>
            )}
          </section>

          <section className="hidden border-t border-border pt-5 lg:block">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {format(
                  fromKey(selectedDate),
                  "EEE, MMM d",
                )}
              </h2>

              <span className="text-xs text-muted-foreground">
                {selectedEvents.length} events
              </span>
            </div>

            {selectedEvents.map(
              (event) => (
                <EventRow
                  key={event.id}
                  event={event}
                />
              ),
            )}

            {!selectedEvents.length && (
              <p className="py-4 text-xs text-muted-foreground">
                A clear day.
              </p>
            )}
          </section>
        </aside>

        <section className="surface-card min-w-0 overflow-hidden">
          {!data.calendars.length ? (
            <div className="flex min-h-[460px] flex-col items-center justify-center gap-4 p-6 text-center">
              <CalendarPlus className="size-12 text-primary/50" />

              <h3 className="text-lg font-semibold">
                A place for every plan
              </h3>

              {data.canManage ? (
                <Button
                  onClick={() =>
                    setCalendarEditor({
                      name: "",
                      color: "primary",
                    })
                  }
                >
                  <Plus />
                  Add your first calendar
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Your team's calendars will appear here.
                </p>
              )}
            </div>
          ) : view === "agenda" ? (
            <div className="min-h-[460px] divide-y divide-border px-4 sm:px-6">
              {agendaEvents.map(
                (event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-4 py-2"
                  >
                    <div className="w-14 shrink-0 text-center">
                      <span className="block text-xs text-muted-foreground">
                        {format(
                          fromKey(
                            event.start_date,
                          ),
                          "EEE",
                        )}
                      </span>

                      <span className="text-2xl font-semibold">
                        {format(
                          fromKey(
                            event.start_date,
                          ),
                          "d",
                        )}
                      </span>
                    </div>

                    <EventRow event={event} />
                  </div>
                ),
              )}

              {!agendaEvents.length && (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  No events this month.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 border-b border-border">
                {[
                  "Sun",
                  "Mon",
                  "Tue",
                  "Wed",
                  "Thu",
                  "Fri",
                  "Sat",
                ].map((day) => (
                  <div
                    key={day}
                    className="py-3 text-center text-[10px] font-medium text-muted-foreground sm:text-xs"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div
                className={cn(
                  "grid grid-cols-7",
                  view === "week" &&
                    "min-h-[480px]",
                )}
              >
                {days.map((day) => {
                  const key =
                    dateKey(day);

                  const events =
                    visibleEvents.filter(
                      (event) =>
                        eventOccursOn(
                          event,
                          key,
                        ),
                    );

                  const today =
                    key ===
                    dateKey(
                      new Date(),
                    );

                  return (
                    <div
                      key={key}
                      className={cn(
                        "group min-w-0 border-b border-r border-border p-1 transition-colors last:border-r-0 sm:p-2",

                        view === "month"
                          ? "min-h-[96px] sm:min-h-[132px]"
                          : "min-h-[420px]",

                        !isSameMonth(
                          day,
                          anchor,
                        ) &&
                          "bg-muted/20",

                        key ===
                          selectedDate &&
                          "bg-accent/15",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={format(
                            day,
                            "MMMM d, yyyy",
                          )}
                          className={cn(
                            "size-7 rounded-full p-0 text-xs",

                            today &&
                              "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",

                            !isSameMonth(
                              day,
                              anchor,
                            ) &&
                              "text-muted-foreground/50",
                          )}
                          onClick={() =>
                            setSelectedDate(
                              key,
                            )
                          }
                          onDoubleClick={() =>
                            data.canManage &&
                            newEvent(
                              key,
                            )
                          }
                        >
                          {format(
                            day,
                            "d",
                          )}
                        </Button>

                        {data.canManage && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hidden size-5 rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 sm:inline-flex"
                            aria-label={`Add event on ${format(
                              day,
                              "MMMM d",
                            )}`}
                            onClick={() =>
                              newEvent(
                                key,
                              )
                            }
                          >
                            <Plus className="size-3" />
                          </Button>
                        )}
                      </div>

                      <div className="space-y-1">
                        {events
                          .slice(
                            0,
                            view === "week"
                              ? 20
                              : 3,
                          )
                          .map(
                            (event) => (
                              <Button
                                key={
                                  event.id
                                }
                                variant="ghost"
                                title={
                                  event.title
                                }
                                className={cn(
                                  "h-auto min-h-5 w-full justify-start gap-1 overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left text-[9px] font-medium sm:text-[11px]",
                                  colorOf(
                                    event.calendar_id,
                                  ).event,
                                )}
                                onClick={() =>
                                  setDetail(
                                    event,
                                  )
                                }
                              >
                                <span
                                  className="min-w-0 truncate"
                                  dir="auto"
                                >
                                  {!event.all_day && (
                                    <span className="hidden font-normal sm:inline">
                                      {
                                        event.start_time
                                      }{" "}
                                    </span>
                                  )}

                                  {
                                    event.title
                                  }
                                </span>

                                {event.is_meeting && (
                                  <Users className="hidden size-3 shrink-0 lg:inline" />
                                )}
                              </Button>
                            ),
                          )}

                        {view ===
                          "month" &&
                          events.length >
                            3 && (
                            <Button
                              variant="ghost"
                              className="h-5 w-full p-0 text-[9px] text-muted-foreground sm:text-xs"
                              onClick={() => {
                                setSelectedDate(
                                  key,
                                );

                                setView(
                                  "week",
                                );

                                setAnchor(
                                  day,
                                );
                              }}
                            >
                              +
                              {events.length -
                                3}{" "}
                              more
                            </Button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {view !== "agenda" && (
        <section className="border-t border-border pt-4 lg:hidden">
          <h2 className="mb-2 text-sm font-semibold">
            {format(
              fromKey(selectedDate),
              "EEEE, MMMM d",
            )}
          </h2>

          {selectedEvents.map(
            (event) => (
              <EventRow
                key={event.id}
                event={event}
              />
            ),
          )}

          {!selectedEvents.length && (
            <p className="py-4 text-sm text-muted-foreground">
              No events on this day.
            </p>
          )}
        </section>
      )}

      {data.canManage && (
        <Button
          size="icon"
          aria-label="Create event"
          className="fixed bottom-24 right-4 z-40 size-14 rounded-2xl shadow-lg md:bottom-6 md:right-6"
          onClick={() => newEvent()}
        >
          <Plus className="size-6" />
        </Button>
      )}

      <Dialog
        open={!!calendarEditor}
        onOpenChange={(open) =>
          !open &&
          setCalendarEditor(null)
        }
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {calendarEditor?.id
                ? "Customize calendar"
                : "New calendar"}
            </DialogTitle>

            <DialogDescription>
              Choose how this calendar appears in POM.
            </DialogDescription>
          </DialogHeader>

          {calendarEditor && (
            <form
              className="space-y-4"
              onSubmit={async (
                event,
              ) => {
                event.preventDefault();

                if (
                  await perform(
                    () =>
                      saveCalendarFn({
                        data:
                          calendarEditor,
                      }),
                    "Calendar saved",
                  )
                ) {
                  setCalendarEditor(
                    null,
                  );
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="calendar-name">
                  Name
                </Label>

                <Input
                  id="calendar-name"
                  dir="auto"
                  autoFocus
                  required
                  maxLength={80}
                  placeholder="e.g. Team plans"
                  value={
                    calendarEditor.name
                  }
                  onChange={(
                    event,
                  ) =>
                    setCalendarEditor({
                      ...calendarEditor,
                      name:
                        event.target
                          .value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>
                  Color
                </Label>

                <div className="flex flex-wrap gap-3 rounded-xl bg-muted/40 p-3">
                  {CALENDAR_COLORS.map(
                    (color) => (
                      <Button
                        key={color}
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`${color} calendar color`}
                        aria-pressed={
                          calendarEditor.color ===
                          color
                        }
                        className={cn(
                          "size-9 rounded-full",

                          calendarColorClasses[
                            color
                          ].dot,

                          calendarEditor.color ===
                            color &&
                            "ring-2 ring-ring ring-offset-2 ring-offset-background",
                        )}
                        onClick={() =>
                          setCalendarEditor({
                            ...calendarEditor,
                            color,
                          })
                        }
                      >
                        {calendarEditor.color ===
                          color && (
                          <Check className="text-background" />
                        )}
                      </Button>
                    ),
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {calendarEditor.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete calendar"
                    className="text-destructive"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      setConfirmation({
                        type:
                          "calendar",
                        id:
                          calendarEditor.id ??
                          "",
                        name:
                          calendarEditor.name,
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                ) : (
                  <span />
                )}

                <Button
                  disabled={busy}
                  type="submit"
                >
                  {busy && (
                    <Loader2 className="animate-spin" />
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
        onOpenChange={(open) =>
          !open &&
          setEventEditor(null)
        }
      >
        <DialogContent className="max-h-[88dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {eventEditor?.id
                ? "Edit event"
                : "New event"}
            </DialogTitle>

            <DialogDescription>
              {format(
                fromKey(
                  eventEditor?.startDate ??
                    selectedDate,
                ),
                "EEEE, MMMM d",
              )}
            </DialogDescription>
          </DialogHeader>

          {eventEditor && (
            <form
              className="space-y-4"
              onSubmit={async (
                event,
              ) => {
                event.preventDefault();

                const parsed =
                  calendarEventSchema.safeParse(
                    eventEditor,
                  );

                if (!parsed.success) {
                  toast.error(
                    parsed.error
                      .issues[0]
                      ?.message ??
                      "Check the event details.",
                  );

                  return;
                }

                if (
                  await perform(
                    () =>
                      saveEventFn({
                        data:
                          parsed.data,
                      }),
                    eventEditor.isMeeting
                      ? "Event and meeting saved"
                      : "Event saved",
                  )
                ) {
                  setEventEditor(
                    null,
                  );
                }
              }}
            >
              <Input
                aria-label="Event title"
                dir="auto"
                className="h-12 rounded-xl text-lg font-semibold"
                placeholder="Add a title"
                required
                autoFocus
                maxLength={160}
                value={
                  eventEditor.title
                }
                onChange={(event) =>
                  setEventEditor({
                    ...eventEditor,
                    title:
                      event.target
                        .value,
                  })
                }
              />

              <div className="flex items-center gap-3">
                <CalendarDays className="size-4 text-muted-foreground" />

                <Select
                  value={
                    eventEditor.calendarId
                  }
                  onValueChange={(
                    value,
                  ) =>
                    setEventEditor({
                      ...eventEditor,
                      calendarId:
                        value,
                    })
                  }
                >
                  <SelectTrigger aria-label="Calendar">
                    <SelectValue />
                  </SelectTrigger>

                  <SelectContent>
                    {data.calendars.map(
                      (calendar) => (
                        <SelectItem
                          key={
                            calendar.id
                          }
                          value={
                            calendar.id
                          }
                        >
                          {
                            calendar.name
                          }
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="all-day">
                  All day
                </Label>

                <Switch
                  id="all-day"
                  checked={
                    eventEditor.allDay
                  }
                  onCheckedChange={(
                    value,
                  ) =>
                    setEventEditor({
                      ...eventEditor,
                      allDay:
                        value,
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="event-start">
                    Starts
                  </Label>

                  <Input
                    className="min-w-0"
                    id="event-start"
                    type="date"
                    required
                    value={
                      eventEditor.startDate
                    }
                    onChange={(
                      event,
                    ) =>
                      setEventEditor({
                        ...eventEditor,
                        startDate:
                          event.target
                            .value,
                        endDate:
                          eventEditor.endDate <
                          event.target
                            .value
                            ? event.target
                                .value
                            : eventEditor.endDate,
                      })
                    }
                  />

                  {!eventEditor.allDay && (
                    <Input
                      aria-label="Start time"
                      type="time"
                      required
                      value={
                        eventEditor.startTime
                      }
                      onChange={(
                        event,
                      ) =>
                        setEventEditor({
                          ...eventEditor,
                          startTime:
                            event.target
                              .value,
                        })
                      }
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="event-end">
                    Ends
                  </Label>

                  <Input
                    className="min-w-0"
                    id="event-end"
                    type="date"
                    required
                    min={
                      eventEditor.startDate
                    }
                    value={
                      eventEditor.endDate
                    }
                    onChange={(
                      event,
                    ) =>
                      setEventEditor({
                        ...eventEditor,
                        endDate:
                          event.target
                            .value,
                      })
                    }
                  />

                  {!eventEditor.allDay && (
                    <Input
                      aria-label="End time"
                      type="time"
                      required
                      value={
                        eventEditor.endTime
                      }
                      onChange={(
                        event,
                      ) =>
                        setEventEditor({
                          ...eventEditor,
                          endTime:
                            event.target
                              .value,
                        })
                      }
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <MapPin className="size-4 shrink-0 text-muted-foreground" />

                <Input
                  aria-label="Location"
                  placeholder="Location"
                  dir="auto"
                  maxLength={300}
                  value={
                    eventEditor.location
                  }
                  onChange={(
                    event,
                  ) =>
                    setEventEditor({
                      ...eventEditor,
                      location:
                        event.target
                          .value,
                    })
                  }
                />
              </div>

              <Textarea
                aria-label="Event description"
                placeholder="Description"
                dir="auto"
                maxLength={4000}
                value={
                  eventEditor.description
                }
                onChange={(
                  event,
                ) =>
                  setEventEditor({
                    ...eventEditor,
                    description:
                      event.target
                        .value,
                  })
                }
              />

              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3">
                  <Label
                    htmlFor="also-meeting"
                    className="flex items-center gap-2"
                  >
                    <Users className="size-4 text-primary" />
                    Also create a meeting
                  </Label>

                  <Switch
                    id="also-meeting"
                    checked={
                      eventEditor.isMeeting
                    }
                    disabled={
                      !!eventEditor.id &&
                      !!data.events.find(
                        (event) =>
                          event.id ===
                          eventEditor.id,
                      )?.meeting_id
                    }
                    onCheckedChange={(
                      value,
                    ) =>
                      setEventEditor({
                        ...eventEditor,
                        isMeeting:
                          value,
                      })
                    }
                  />
                </div>

                {eventEditor.isMeeting && (
                  <Select
                    value={
                      eventEditor.teamId ??
                      "general"
                    }
                    onValueChange={(
                      value,
                    ) =>
                      setEventEditor({
                        ...eventEditor,
                        teamId:
                          value ===
                          "general"
                            ? null
                            : value,
                      })
                    }
                  >
                    <SelectTrigger aria-label="Meeting team">
                      <SelectValue />
                    </SelectTrigger>

                    <SelectContent>
                      <SelectItem value="general">
                        General · Everyone
                      </SelectItem>

                      {teams.map(
                        (team) => (
                          <SelectItem
                            key={
                              team.id
                            }
                            value={
                              team.id
                            }
                          >
                            {
                              team.name
                            }
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    setEventEditor(
                      null,
                    )
                  }
                >
                  Cancel
                </Button>

                <Button
                  type="submit"
                  disabled={busy}
                >
                  {busy && (
                    <Loader2 className="animate-spin" />
                  )}

                  Save event
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!detail}
        onOpenChange={(open) =>
          !open &&
          setDetail(null)
        }
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
          {detail && (
            <>
              <DialogHeader>
                <span
                  className={cn(
                    "mb-3 h-1 w-12 rounded-full",
                    colorOf(
                      detail.calendar_id,
                    ).dot,
                  )}
                />

                <DialogTitle
                  dir="auto"
                  className="pr-5 text-xl leading-snug"
                >
                  {detail.title}
                </DialogTitle>

                <DialogDescription>
                  {
                    calendarOf(
                      detail.calendar_id,
                    )?.name
                  }
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                <div className="flex gap-3">
                  <Clock3 className="mt-0.5 size-4 text-muted-foreground" />

                  <div className="text-sm">
                    <p>
                      {format(
                        fromKey(
                          detail.start_date,
                        ),
                        "EEEE, MMMM d, yyyy",
                      )}

                      {detail.end_date !==
                        detail.start_date &&
                        ` – ${format(
                          fromKey(
                            detail.end_date,
                          ),
                          "MMM d, yyyy",
                        )}`}
                    </p>

                    <p className="mt-1 text-muted-foreground">
                      {detail.all_day
                        ? "All day"
                        : `${detail.start_time} – ${detail.end_time}`}
                    </p>
                  </div>
                </div>

                {detail.location && (
                  <div className="flex gap-3 text-sm">
                    <MapPin className="size-4 shrink-0 text-muted-foreground" />

                    <span dir="auto">
                      {
                        detail.location
                      }
                    </span>
                  </div>
                )}

                {detail.description && (
                  <p
                    dir="auto"
                    className="whitespace-pre-wrap text-sm leading-relaxed"
                  >
                    {
                      detail.description
                    }
                  </p>
                )}

                {detail.is_meeting && (
                  <Button
                    variant="secondary"
                    asChild
                  >
                    <Link to="/meetings">
                      <Users />
                      View in Meetings
                    </Link>
                  </Button>
                )}
              </div>

              {data.canManage && (
                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete event"
                    className="text-destructive"
                    onClick={() =>
                      setConfirmation({
                        type:
                          "event",
                        id:
                          detail.id,
                        name:
                          detail.title,
                      })
                    }
                  >
                    <Trash2 />
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() =>
                      editEvent(
                        detail,
                      )
                    }
                  >
                    <Pencil />
                    Edit event
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmation}
        onOpenChange={(open) =>
          !open &&
          setConfirmation(null)
        }
      >
        <DialogContent className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete{" "}
              {confirmation?.type}
              ?
            </DialogTitle>

            <DialogDescription>
              “
              {confirmation?.name}
              ”{" "}
              {confirmation?.type ===
              "calendar"
                ? "and all its events and linked meetings will be deleted."
                : "will be deleted, including its linked meeting."}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                setConfirmation(
                  null,
                )
              }
            >
              Cancel
            </Button>

            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirmation
                ) {
                  return;
                }

                if (
                  await perform(
                    () =>
                      confirmation.type ===
                      "calendar"
                        ? deleteCalendarFn({
                            data: {
                              id:
                                confirmation.id,
                            },
                          })
                        : deleteEventFn({
                            data: {
                              id:
                                confirmation.id,
                            },
                          }),
                    "Deleted",
                  )
                ) {
                  setConfirmation(
                    null,
                  );

                  setCalendarEditor(
                    null,
                  );

                  setDetail(
                    null,
                  );
                }
              }}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}