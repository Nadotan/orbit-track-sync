import { createFileRoute, Link } from "@tanstack/react-router";
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
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
  PanelLeft,
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

type CalendarData = Awaited<
  ReturnType<typeof getCalendarData>
>;

type CalendarEvent =
  CalendarData["events"][number];

type Calendar =
  CalendarData["calendars"][number];

const dateKey = (date: Date) =>
  format(date, "yyyy-MM-dd");

const fromKey = (key: string) =>
  new Date(`${key}T12:00:00`);

const WEEK_START_HOUR = 6;
const WEEK_END_HOUR = 24;
const HOUR_HEIGHT = 56;

const WEEK_HOURS = Array.from(
  {
    length:
      WEEK_END_HOUR -
      WEEK_START_HOUR,
  },
  (_, index) =>
    WEEK_START_HOUR +
    index,
);

const timeMinutes = (
  time: string,
) => {
  const [
    hours,
    minutes,
  ] =
    time
      .split(":")
      .map(Number);

  return (
    hours * 60 +
    minutes
  );
};

const minutesTime = (
  minutes: number,
) => {
  const safe =
    Math.max(
      0,
      Math.min(
        minutes,
        23 * 60 + 59,
      ),
    );

  return `${String(
    Math.floor(
      safe / 60,
    ),
  ).padStart(
    2,
    "0",
  )}:${String(
    safe % 60,
  ).padStart(
    2,
    "0",
  )}`;
};

export const Route =
  createFileRoute(
    "/_authenticated/calendar",
  )({
    head: () => ({
      meta: [
        {
          title:
            "Calendar · POM",
        },
        {
          name:
            "description",
          content:
            "Your POM calendars, events, and team meetings in one place.",
        },
        {
          property:
            "og:title",
          content:
            "Calendar · POM",
        },
        {
          property:
            "og:description",
          content:
            "Plan together with shared calendars and connected team meetings.",
        },
        {
          property:
            "og:type",
          content:
            "website",
        },
        {
          name:
            "twitter:card",
          content:
            "summary",
        },
      ],
    }),

    component:
      CalendarRoute,
  });

function CalendarRoute() {
  return (
    <Suspense
      fallback={
        <div className="grid h-full place-items-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      }
    >
      <CalendarPage />
    </Suspense>
  );
}

function CalendarPage() {
  const {
    data,
  } =
    useSuspenseQuery(
      calendarQuery,
    );

  const queryClient =
    useQueryClient();

  const {
    teams,
    refresh,
  } =
    useStore();

  const saveCalendarFn =
    useServerFn(
      saveCalendar,
    );

  const deleteCalendarFn =
    useServerFn(
      deleteCalendar,
    );

  const saveEventFn =
    useServerFn(
      saveCalendarEvent,
    );

  const deleteEventFn =
    useServerFn(
      deleteCalendarEvent,
    );

  const visibilityFn =
    useServerFn(
      setCalendarVisibility,
    );

  const [
    anchor,
    setAnchor,
  ] =
    useState(
      () =>
        new Date(),
    );

  const [
    selectedDate,
    setSelectedDate,
  ] =
    useState(
      () =>
        dateKey(
          new Date(),
        ),
    );

  const [
    view,
    setView,
  ] =
    useState<
      | "month"
      | "week"
      | "agenda"
    >(
      "month",
    );

  const [
    desktopSidebarOpen,
    setDesktopSidebarOpen,
  ] =
    useState(
      false,
    );

  const [
    mobileSidebarOpen,
    setMobileSidebarOpen,
  ] =
    useState(
      false,
    );

  const [
    calendarEditor,
    setCalendarEditor,
  ] =
    useState<{
      id?: string;
      name: string;
      color:
        CalendarColor;
    } | null>(
      null,
    );

  const [
    eventEditor,
    setEventEditor,
  ] =
    useState<
      CalendarEventInput | null
    >(
      null,
    );

  const [
    detail,
    setDetail,
  ] =
    useState<
      CalendarEvent | null
    >(
      null,
    );

  const [
    busy,
    setBusy,
  ] =
    useState(
      false,
    );

  const [
    confirmation,
    setConfirmation,
  ] =
    useState<{
      type:
        | "calendar"
        | "event";
      id: string;
      name: string;
    } | null>(
      null,
    );

  const [
    hiddenOverride,
    setHiddenOverride,
  ] =
    useState<
      string[] | null
    >(
      null,
    );

  const hidden =
    hiddenOverride ??
    data.hiddenIds;

  const visibleEvents =
    data.events.filter(
      (
        event,
      ) =>
        !hidden.includes(
          event.calendar_id,
        ),
    );

  const calendarOf = (
    id: string,
  ) =>
    data.calendars.find(
      (
        calendar,
      ) =>
        calendar.id ===
        id,
    );

  const colorOf = (
    id: string,
  ) =>
    calendarColorClasses[
      (
        calendarOf(
          id,
        )?.color ??
        "primary"
      ) as CalendarColor
    ];

  const monthDays =
    eachDayOfInterval({
      start:
        startOfWeek(
          startOfMonth(
            anchor,
          ),
        ),

      end:
        endOfWeek(
          endOfMonth(
            anchor,
          ),
        ),
    });

  const weekDays =
    eachDayOfInterval({
      start:
        startOfWeek(
          anchor,
        ),

      end:
        endOfWeek(
          anchor,
        ),
    });

  const agendaEvents =
    visibleEvents
      .filter(
        (
          event,
        ) =>
          event.end_date >=
            dateKey(
              startOfMonth(
                anchor,
              ),
            ) &&
          event.start_date <=
            dateKey(
              endOfMonth(
                anchor,
              ),
            ),
      )
      .sort(
        (
          a,
          b,
        ) =>
          `${a.start_date}-${a.start_time}`.localeCompare(
            `${b.start_date}-${b.start_time}`,
          ),
      );

  const selectedEvents =
    visibleEvents.filter(
      (
        event,
      ) =>
        eventOccursOn(
          event,
          selectedDate,
        ),
    );

  const periodTitle =
    view ===
    "week"
      ? `${format(
          startOfWeek(
            anchor,
          ),
          "MMM d",
        )} – ${format(
          endOfWeek(
            anchor,
          ),
          "MMM d, yyyy",
        )}`
      : format(
          anchor,
          "MMMM yyyy",
        );

  async function reload() {
    await queryClient
      .invalidateQueries({
        queryKey:
          calendarQuery.queryKey,
      });

    refresh();
  }

  async function perform(
    action:
      () =>
        Promise<unknown>,
    success:
      string,
  ) {
    if (
      busy
    ) {
      return;
    }

    setBusy(
      true,
    );

    try {
      await action();

      await reload();

      toast.success(
        success,
      );

      return true;
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not save your changes.",
      );

      return false;
    } finally {
      setBusy(
        false,
      );
    }
  }

  function newEvent(
    day =
      selectedDate,
    requestedStartTime?:
      string,
  ) {
    const calendar =
      data.calendars.find(
        (
          item,
        ) =>
          !hidden.includes(
            item.id,
          ),
      ) ??
      data.calendars[0];

    if (
      !calendar
    ) {
      setCalendarEditor({
        name:
          "",
        color:
          "primary",
      });

      return;
    }

    const now =
      new Date();

    const smartHour =
      day ===
      dateKey(
        now,
      )
        ? Math.min(
            Math.max(
              now.getHours() +
                1,
              7,
            ),
            22,
          )
        : 9;

    const startTime =
      requestedStartTime ??
      `${String(
        smartHour,
      ).padStart(
        2,
        "0",
      )}:00`;

    const endTime =
      minutesTime(
        timeMinutes(
          startTime,
        ) +
          60,
      );

    setSelectedDate(
      day,
    );

    setEventEditor({
      calendarId:
        calendar.id,

      title:
        "",

      description:
        "",

      location:
        "",

      startDate:
        day,

      endDate:
        day,

      startTime,

      endTime,

      allDay:
        false,

      teamId:
        null,

      isMeeting:
        false,
    });
  }

  function editEvent(
    event:
      CalendarEvent,
  ) {
    setDetail(
      null,
    );

    setEventEditor({
      id:
        event.id,

      calendarId:
        event.calendar_id,

      title:
        event.title,

      description:
        event.description,

      location:
        event.location,

      startDate:
        event.start_date,

      endDate:
        event.end_date,

      startTime:
        event.start_time,

      endTime:
        event.end_time,

      allDay:
        event.all_day,

      teamId:
        event.team_id,

      isMeeting:
        event.is_meeting,
    });
  }

  function move(
    direction:
      number,
  ) {
    const next =
      view ===
      "week"
        ? addWeeks(
            anchor,
            direction,
          )
        : addMonths(
            anchor,
            direction,
          );

    setAnchor(
      next,
    );

    setSelectedDate(
      dateKey(
        next,
      ),
    );
  }

  async function toggleCalendar(
    calendar:
      Calendar,
  ) {
    const next =
      hidden.includes(
        calendar.id,
      )
        ? hidden.filter(
            (
              id,
            ) =>
              id !==
              calendar.id,
          )
        : [
            ...hidden,
            calendar.id,
          ];

    setHiddenOverride(
      next,
    );

    try {
      await visibilityFn({
        data: {
          calendarId:
            calendar.id,

          hidden:
            next.includes(
              calendar.id,
            ),
        },
      });

      await queryClient
        .invalidateQueries({
          queryKey:
            calendarQuery.queryKey,
        });
    } catch {
      toast.error(
        "Could not save calendar visibility.",
      );
    } finally {
      setHiddenOverride(
        null,
      );
    }
  }

  function EventRow({
    event,
  }: {
    event:
      CalendarEvent;
  }) {
    return (
      <Button
        variant="ghost"
        className="h-auto w-full justify-start gap-3 rounded-xl px-2 py-2.5 text-left"
        onClick={() =>
          setDetail(
            event,
          )
        }
      >
        <span
          className={cn(
            "h-9 w-1 shrink-0 rounded-full",
            colorOf(
              event.calendar_id,
            ).dot,
          )}
        />

        <span className="min-w-0 flex-1">
          <span
            dir="auto"
            className="block truncate font-medium"
          >
            {
              event.title
            }
          </span>

          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {event.all_day
              ? "All day"
              : `${event.start_time} – ${event.end_time}`}{" "}
            ·{" "}
            {
              calendarOf(
                event.calendar_id,
              )?.name
            }
          </span>
        </span>

        {event.is_meeting && (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}
      </Button>
    );
  }

  function calendarSidebar(
    closeOnSelect =
      false,
  ) {
    const miniDays =
      eachDayOfInterval({
        start:
          startOfWeek(
            startOfMonth(
              anchor,
            ),
          ),

        end:
          endOfWeek(
            endOfMonth(
              anchor,
            ),
          ),
      });

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">
              {format(
                anchor,
                "MMMM yyyy",
              )}
            </span>

            <div className="flex">
              <Button
                size="icon"
                variant="ghost"
                className="size-8 rounded-full"
                aria-label="Previous mini-calendar month"
                onClick={() =>
                  setAnchor(
                    addMonths(
                      anchor,
                      -1,
                    ),
                  )
                }
              >
                <ChevronLeft />
              </Button>

              <Button
                size="icon"
                variant="ghost"
                className="size-8 rounded-full"
                aria-label="Next mini-calendar month"
                onClick={() =>
                  setAnchor(
                    addMonths(
                      anchor,
                      1,
                    ),
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
            ].map(
              (
                day,
                index,
              ) => (
                <span
                  key={
                    index
                  }
                  className="py-1 text-center text-[10px] text-muted-foreground"
                >
                  {
                    day
                  }
                </span>
              ),
            )}

            {miniDays.map(
              (
                day,
              ) => {
                const key =
                  dateKey(
                    day,
                  );

                return (
                  <Button
                    key={
                      key
                    }
                    variant="ghost"
                    className={cn(
                      "h-7 w-full rounded-full p-0 text-xs",

                      !isSameMonth(
                        day,
                        anchor,
                      ) &&
                        "text-muted-foreground/40",

                      selectedDate ===
                        key &&
                        "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                    )}
                    onClick={() => {
                      setSelectedDate(
                        key,
                      );

                      setAnchor(
                        day,
                      );

                      if (
                        closeOnSelect
                      ) {
                        setMobileSidebarOpen(
                          false,
                        );
                      }
                    }}
                  >
                    {format(
                      day,
                      "d",
                    )}
                  </Button>
                );
              },
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border px-3 py-4">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              My calendars
            </h2>

            {data.canManage && (
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Add calendar"
                onClick={() =>
                  setCalendarEditor({
                    name:
                      "",
                    color:
                      "primary",
                  })
                }
              >
                <Plus className="size-4" />
              </Button>
            )}
          </div>

          <div className="space-y-1">
            {data.calendars.map(
              (
                calendar,
              ) => (
                <div
                  key={
                    calendar.id
                  }
                  className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted/60"
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
                      "size-2.5 shrink-0 rounded-full",

                      colorOf(
                        calendar.id,
                      ).dot,
                    )}
                  />

                  <span
                    dir="auto"
                    className="min-w-0 flex-1 truncate text-sm"
                  >
                    {
                      calendar.name
                    }
                  </span>

                  {data.canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 shrink-0"
                      aria-label={`Edit ${calendar.name}`}
                      onClick={() =>
                        setCalendarEditor({
                          id:
                            calendar.id,

                          name:
                            calendar.name,

                          color:
                            calendar.color as CalendarColor,
                        })
                      }
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  )}
                </div>
              ),
            )}

            {!data.calendars.length && (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                No calendars yet.
              </p>
            )}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <div className="mb-1 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold">
                {format(
                  fromKey(
                    selectedDate,
                  ),
                  "EEE, MMM d",
                )}
              </h2>

              <span className="text-xs text-muted-foreground">
                {
                  selectedEvents.length
                }
              </span>
            </div>

            {selectedEvents.map(
              (
                event,
              ) => (
                <EventRow
                  key={
                    event.id
                  }
                  event={
                    event
                  }
                />
              ),
            )}

            {!selectedEvents.length && (
              <p className="px-2 py-4 text-xs text-muted-foreground">
                No events on this day.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  function monthView() {
    return (
      <div className="flex h-full min-h-0 flex-col bg-card">
        <div className="grid h-8 shrink-0 grid-cols-7 border-b border-border">
          {[
            "Sun",
            "Mon",
            "Tue",
            "Wed",
            "Thu",
            "Fri",
            "Sat",
          ].map(
            (
              day,
            ) => (
              <div
                key={
                  day
                }
                className="grid place-items-center text-[10px] font-medium text-muted-foreground sm:text-xs"
              >
                {
                  day
                }
              </div>
            ),
          )}
        </div>

        <div
          className="grid min-h-0 flex-1 grid-cols-7"
          style={{
            gridTemplateRows:
              `repeat(${monthDays.length / 7}, minmax(0, 1fr))`,
          }}
        >
          {monthDays.map(
            (
              day,
            ) => {
              const key =
                dateKey(
                  day,
                );

              const events =
                visibleEvents.filter(
                  (
                    event,
                  ) =>
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
                  key={
                    key
                  }
                  className={cn(
                    "group min-h-0 min-w-0 overflow-hidden border-b border-r border-border p-1 transition-colors last:border-r-0 sm:p-1.5",

                    !isSameMonth(
                      day,
                      anchor,
                    ) &&
                      "bg-muted/20",

                    key ===
                      selectedDate &&
                      "bg-accent/20",
                  )}
                >
                  <div className="mb-0.5 flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={format(
                        day,
                        "MMMM d, yyyy",
                      )}
                      className={cn(
                        "size-6 rounded-full p-0 text-[10px] sm:size-7 sm:text-xs",

                        today &&
                          "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",

                        !isSameMonth(
                          day,
                          anchor,
                        ) &&
                          "text-muted-foreground/45",
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
                        className="hidden size-5 rounded-full text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 sm:inline-flex"
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

                  <div className="hidden space-y-0.5 sm:block">
                    {events
                      .slice(
                        0,
                        3,
                      )
                      .map(
                        (
                          event,
                        ) => (
                          <Button
                            key={
                              event.id
                            }
                            variant="ghost"
                            title={
                              event.title
                            }
                            className={cn(
                              "h-5 w-full justify-start overflow-hidden rounded-md border-l-[3px] px-1.5 py-0 text-left text-[10px] font-medium",

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
                              className="truncate"
                              dir="auto"
                            >
                              {!event.all_day && (
                                <span className="font-normal">
                                  {
                                    event.start_time
                                  }{" "}
                                </span>
                              )}

                              {
                                event.title
                              }
                            </span>
                          </Button>
                        ),
                      )}

                    {events.length >
                      3 && (
                      <Button
                        variant="ghost"
                        className="h-4 w-full justify-start p-0 text-[10px] text-muted-foreground"
                        onClick={() => {
                          setSelectedDate(
                            key,
                          );

                          setAnchor(
                            day,
                          );

                          setView(
                            "week",
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

                  <div className="flex flex-wrap gap-0.5 px-0.5 sm:hidden">
                    {events
                      .slice(
                        0,
                        5,
                      )
                      .map(
                        (
                          event,
                        ) => (
                          <button
                            key={
                              event.id
                            }
                            type="button"
                            aria-label={
                              event.title
                            }
                            className={cn(
                              "h-1.5 min-w-3 flex-1 rounded-full",

                              colorOf(
                                event.calendar_id,
                              ).dot,
                            )}
                            onClick={() =>
                              setDetail(
                                event,
                              )
                            }
                          />
                        ),
                      )}
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>
    );
  }

  function weekView() {
    const gridHeight =
      (
        WEEK_END_HOUR -
        WEEK_START_HOUR
      ) *
      HOUR_HEIGHT;

    return (
      <div className="h-full overflow-auto bg-card">
        <div className="min-w-[760px]">
          <div className="sticky top-0 z-20 bg-card">
            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
              <div className="border-r border-border" />

              {weekDays.map(
                (
                  day,
                ) => {
                  const key =
                    dateKey(
                      day,
                    );

                  const today =
                    key ===
                    dateKey(
                      new Date(),
                    );

                  return (
                    <button
                      key={
                        key
                      }
                      type="button"
                      className={cn(
                        "border-r border-border py-2 text-center last:border-r-0",

                        key ===
                          selectedDate &&
                          "bg-accent/20",
                      )}
                      onClick={() =>
                        setSelectedDate(
                          key,
                        )
                      }
                    >
                      <span className="block text-[10px] uppercase text-muted-foreground">
                        {format(
                          day,
                          "EEE",
                        )}
                      </span>

                      <span
                        className={cn(
                          "mx-auto mt-1 grid size-8 place-items-center rounded-full text-sm font-semibold",

                          today &&
                            "bg-primary text-primary-foreground",
                        )}
                      >
                        {format(
                          day,
                          "d",
                        )}
                      </span>
                    </button>
                  );
                },
              )}
            </div>

            <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-border">
              <div className="border-r border-border px-1 py-2 text-right text-[9px] text-muted-foreground">
                all-day
              </div>

              {weekDays.map(
                (
                  day,
                ) => {
                  const key =
                    dateKey(
                      day,
                    );

                  const allDayEvents =
                    visibleEvents.filter(
                      (
                        event,
                      ) =>
                        eventOccursOn(
                          event,
                          key,
                        ) &&
                        (
                          event.all_day ||
                          event.start_date !==
                            event.end_date
                        ),
                    );

                  return (
                    <div
                      key={
                        key
                      }
                      className="min-h-9 space-y-0.5 border-r border-border p-1 last:border-r-0"
                    >
                      {allDayEvents
                        .slice(
                          0,
                          2,
                        )
                        .map(
                          (
                            event,
                          ) => (
                            <Button
                              key={
                                event.id
                              }
                              variant="ghost"
                              className={cn(
                                "h-5 w-full justify-start truncate rounded-md border-l-[3px] px-1 text-[10px]",

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
                              {
                                event.title
                              }
                            </Button>
                          ),
                        )}

                      {allDayEvents.length >
                        2 && (
                        <span className="block px-1 text-[9px] text-muted-foreground">
                          +
                          {allDayEvents.length -
                            2}
                        </span>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          </div>

          <div
            className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]"
            style={{
              height:
                gridHeight,
            }}
          >
            <div className="relative border-r border-border">
              {WEEK_HOURS.map(
                (
                  hour,
                ) => (
                  <span
                    key={
                      hour
                    }
                    className="absolute right-2 -translate-y-1/2 text-[9px] text-muted-foreground"
                    style={{
                      top:
                        (
                          hour -
                          WEEK_START_HOUR
                        ) *
                        HOUR_HEIGHT,
                    }}
                  >
                    {`${String(
                      hour,
                    ).padStart(
                      2,
                      "0",
                    )}:00`}
                  </span>
                ),
              )}
            </div>

            {weekDays.map(
              (
                day,
              ) => {
                const key =
                  dateKey(
                    day,
                  );

                const timedEvents =
                  visibleEvents.filter(
                    (
                      event,
                    ) =>
                      !event.all_day &&
                      event.start_date ===
                        key &&
                      event.end_date ===
                        key,
                  );

                return (
                  <div
                    key={
                      key
                    }
                    className={cn(
                      "relative border-r border-border last:border-r-0",

                      key ===
                        selectedDate &&
                        "bg-accent/10",
                    )}
                    onClick={(
                      event,
                    ) => {
                      if (
                        !data.canManage
                      ) {
                        return;
                      }

                      const rect =
                        event.currentTarget
                          .getBoundingClientRect();

                      const offset =
                        Math.max(
                          0,
                          Math.min(
                            event.clientY -
                              rect.top,
                            gridHeight -
                              1,
                          ),
                        );

                      const halfHours =
                        Math.floor(
                          offset /
                            (
                              HOUR_HEIGHT /
                              2
                            ),
                        );

                      const minutes =
                        WEEK_START_HOUR *
                          60 +
                        halfHours *
                          30;

                      newEvent(
                        key,
                        minutesTime(
                          minutes,
                        ),
                      );
                    }}
                  >
                    {WEEK_HOURS.map(
                      (
                        hour,
                      ) => (
                        <div
                          key={
                            hour
                          }
                          className="absolute inset-x-0 border-t border-border/80"
                          style={{
                            top:
                              (
                                hour -
                                WEEK_START_HOUR
                              ) *
                              HOUR_HEIGHT,
                          }}
                        />
                      ),
                    )}

                    {timedEvents.map(
                      (
                        event,
                      ) => {
                        const start =
                          Math.max(
                            timeMinutes(
                              event.start_time,
                            ),
                            WEEK_START_HOUR *
                              60,
                          );

                        const end =
                          Math.min(
                            timeMinutes(
                              event.end_time,
                            ),
                            WEEK_END_HOUR *
                              60,
                          );

                        if (
                          end <=
                          start
                        ) {
                          return null;
                        }

                        const top =
                          (
                            (
                              start -
                              WEEK_START_HOUR *
                                60
                            ) /
                            60
                          ) *
                          HOUR_HEIGHT;

                        const height =
                          Math.max(
                            (
                              (
                                end -
                                start
                              ) /
                              60
                            ) *
                              HOUR_HEIGHT,
                            24,
                          );

                        return (
                          <Button
                            key={
                              event.id
                            }
                            variant="ghost"
                            className={cn(
                              "absolute inset-x-1 z-10 h-auto justify-start overflow-hidden rounded-lg border-l-[3px] px-1.5 py-1 text-left text-[10px] shadow-sm",

                              colorOf(
                                event.calendar_id,
                              ).event,
                            )}
                            style={{
                              top,
                              height,
                            }}
                            onClick={(
                              click,
                            ) => {
                              click.stopPropagation();

                              setDetail(
                                event,
                              );
                            }}
                          >
                            <span className="min-w-0">
                              <span
                                className="block truncate font-semibold"
                                dir="auto"
                              >
                                {
                                  event.title
                                }
                              </span>

                              <span className="block truncate text-[9px] font-normal opacity-80">
                                {
                                  event.start_time
                                }{" "}
                                –{" "}
                                {
                                  event.end_time
                                }
                              </span>
                            </span>
                          </Button>
                        );
                      },
                    )}
                  </div>
                );
              },
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background px-2 sm:gap-2 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="hidden rounded-full lg:inline-flex"
          aria-label={
            desktopSidebarOpen
              ? "Hide calendars"
              : "Show calendars"
          }
          onClick={() =>
            setDesktopSidebarOpen(
              (
                open,
              ) =>
                !open,
            )
          }
        >
          <PanelLeft className="size-5" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="rounded-full lg:hidden"
          aria-label="Show calendars"
          onClick={() =>
            setMobileSidebarOpen(
              true,
            )
          }
        >
          <PanelLeft className="size-5" />
        </Button>

        <div className="hidden items-center gap-2 sm:flex">
          <div className="grid size-8 place-items-center rounded-lg bg-accent text-primary">
            <CalendarDays className="size-4" />
          </div>

          <span className="font-display text-base font-semibold">
            Calendar
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="ml-1 h-8 rounded-lg px-2.5"
          onClick={() => {
            const today =
              new Date();

            setAnchor(
              today,
            );

            setSelectedDate(
              dateKey(
                today,
              ),
            );
          }}
        >
          Today
        </Button>

        <div className="flex">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Previous period"
            onClick={() =>
              move(
                -1,
              )
            }
          >
            <ChevronLeft className="size-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            aria-label="Next period"
            onClick={() =>
              move(
                1,
              )
            }
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <h1 className="min-w-0 flex-1 truncate px-1 text-sm font-semibold sm:text-lg">
          {
            periodTitle
          }
        </h1>

        <div className="hidden rounded-xl border border-border bg-muted/35 p-1 sm:flex">
          {(
            [
              "month",
              "week",
              "agenda",
            ] as const
          ).map(
            (
              mode,
            ) => (
              <Button
                key={
                  mode
                }
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 rounded-lg px-3 capitalize",

                  view ===
                    mode &&
                    "bg-background text-foreground shadow-sm",
                )}
                onClick={() =>
                  setView(
                    mode,
                  )
                }
              >
                {mode ===
                "agenda"
                  ? "Schedule"
                  : mode}
              </Button>
            ),
          )}
        </div>

        <Select
          value={
            view
          }
          onValueChange={(
            value,
          ) =>
            setView(
              value as typeof view,
            )
          }
        >
          <SelectTrigger
            className="h-8 w-[94px] rounded-lg sm:hidden"
            aria-label="Calendar view"
          >
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="month">
              Month
            </SelectItem>

            <SelectItem value="week">
              Week
            </SelectItem>

            <SelectItem value="agenda">
              Schedule
            </SelectItem>
          </SelectContent>
        </Select>
      </header>

      <div className="flex min-h-0 flex-1">
        {desktopSidebarOpen && (
          <aside className="hidden w-64 shrink-0 border-r border-border bg-background lg:block">
            {calendarSidebar()}
          </aside>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {!data.calendars.length ? (
            <div className="grid h-full place-items-center bg-card p-6 text-center">
              <div>
                <CalendarPlus className="mx-auto size-12 text-primary/45" />

                <h2 className="mt-4 text-lg font-semibold">
                  A place for every plan
                </h2>

                <p className="mt-1 text-sm text-muted-foreground">
                  Create a calendar to start planning with your team.
                </p>

                {data.canManage && (
                  <Button
                    className="mt-4"
                    onClick={() =>
                      setCalendarEditor({
                        name:
                          "",
                        color:
                          "primary",
                      })
                    }
                  >
                    <Plus />
                    Add calendar
                  </Button>
                )}
              </div>
            </div>
          ) : view ===
            "month" ? (
            monthView()
          ) : view ===
            "week" ? (
            weekView()
          ) : (
            <div className="h-full overflow-y-auto bg-card">
              <div className="mx-auto max-w-3xl divide-y divide-border px-3 sm:px-6">
                {agendaEvents.map(
                  (
                    event,
                  ) => (
                    <div
                      key={
                        event.id
                      }
                      className="flex items-center gap-3 py-2"
                    >
                      <div className="w-12 shrink-0 text-center">
                        <span className="block text-[10px] uppercase text-muted-foreground">
                          {format(
                            fromKey(
                              event.start_date,
                            ),
                            "EEE",
                          )}
                        </span>

                        <span className="text-xl font-semibold">
                          {format(
                            fromKey(
                              event.start_date,
                            ),
                            "d",
                          )}
                        </span>
                      </div>

                      <EventRow
                        event={
                          event
                        }
                      />
                    </div>
                  ),
                )}

                {!agendaEvents.length && (
                  <p className="py-16 text-center text-sm text-muted-foreground">
                    No events this month.
                  </p>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {data.canManage && (
        <Button
          size="icon"
          aria-label="Create event"
          className="fixed bottom-24 right-4 z-30 size-14 rounded-2xl shadow-lg md:bottom-5 md:right-5"
          onClick={() =>
            newEvent()
          }
        >
          <Plus className="size-6" />
        </Button>
      )}

      <Sheet
        open={
          mobileSidebarOpen
        }
        onOpenChange={
          setMobileSidebarOpen
        }
      >
        <SheetContent
          side="left"
          className="w-[86vw] max-w-sm p-0"
        >
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>
              Calendars
            </SheetTitle>
          </SheetHeader>

          <div className="h-[calc(100dvh-57px)]">
            {calendarSidebar(
              true,
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={
          !!calendarEditor
        }
        onOpenChange={(
          open,
        ) =>
          !open &&
          setCalendarEditor(
            null,
          )
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
                    (
                      color,
                    ) => (
                      <Button
                        key={
                          color
                        }
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
                  disabled={
                    busy
                  }
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
        open={
          !!eventEditor
        }
        onOpenChange={(
          open,
        ) =>
          !open &&
          setEventEditor(
            null,
          )
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

                if (
                  !parsed.success
                ) {
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
                onChange={(
                  event,
                ) =>
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
                      (
                        calendar,
                      ) => (
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

              <details className="rounded-xl border border-border bg-muted/20 p-3">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
                  More options
                </summary>

                <div className="mt-4 space-y-4">
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
                            (
                              event,
                            ) =>
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
                            (
                              team,
                            ) => (
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
                </div>
              </details>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={
                    busy
                  }
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
                  disabled={
                    busy
                  }
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
        open={
          !!detail
        }
        onOpenChange={(
          open,
        ) =>
          !open &&
          setDetail(
            null,
          )
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
                  {
                    detail.title
                  }
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
        open={
          !!confirmation
        }
        onOpenChange={(
          open,
        ) =>
          !open &&
          setConfirmation(
            null,
          )
        }
      >
        <DialogContent className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete{" "}
              {
                confirmation?.type
              }
              ?
            </DialogTitle>

            <DialogDescription>
              “
              {
                confirmation?.name
              }
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
              disabled={
                busy
              }
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
              disabled={
                busy
              }
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