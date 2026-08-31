import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import {
  AlarmClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getOwnAvailability,
  setOwnAvailability,
} from "@/lib/availability.functions";
import {
  getAttendanceClockReminderSetting,
  setAttendanceClockReminderSetting,
} from "@/lib/attendance-clock.functions";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      {
        title: "Profile - POM",
      },
      {
        name: "description",
        content: "Manage your POM availability and Clock reminders.",
      },
    ],
  }),

  component: ProfilePage,
});

const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];

interface DragState {
  start: string;
  current: string;
  unavailable: boolean;
  before: Set<string>;
}

function keyFromDate(
  date: Date,
) {
  return format(
    date,
    "yyyy-MM-dd",
  );
}

function dateFromKey(
  key: string,
) {
  const [
    year,
    month,
    day,
  ] =
    key
      .split("-")
      .map(Number);

  return new Date(
    year!,
    month! - 1,
    day!,
  );
}

function keysBetween(
  first: string,
  second: string,
) {
  const firstDate =
    dateFromKey(
      first,
    );

  const secondDate =
    dateFromKey(
      second,
    );

  const start =
    firstDate <= secondDate
      ? firstDate
      : secondDate;

  const end =
    firstDate <= secondDate
      ? secondDate
      : firstDate;

  return eachDayOfInterval({
    start,
    end,
  }).map(
    keyFromDate,
  );
}

function ClockReminderSetting() {
  const loadSetting =
    useServerFn(
      getAttendanceClockReminderSetting,
    );

  const saveSetting =
    useServerFn(
      setAttendanceClockReminderSetting,
    );

  const [
    enabled,
    setEnabled,
  ] =
    useState(
      true,
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  useEffect(
    () => {
      let active =
        true;

      void loadSetting()
        .then(
          (
            result,
          ) => {
            if (
              active
            ) {
              setEnabled(
                result.enabled,
              );
            }
          },
        )
        .catch(
          (
            error,
          ) => {
            console.error(
              "Failed to load Clock reminder setting:",
              error,
            );

            if (
              active
            ) {
              toast.error(
                "Could not load your Clock reminder setting.",
              );
            }
          },
        )
        .finally(
          () => {
            if (
              active
            ) {
              setLoading(
                false,
              );
            }
          },
        );

      return () => {
        active =
          false;
      };
    },
    [
      loadSetting,
    ],
  );

  async function changeSetting(
    next: boolean,
  ) {
    if (
      loading ||
      saving
    ) {
      return;
    }

    const previous =
      enabled;

    setEnabled(
      next,
    );

    setSaving(
      true,
    );

    try {
      await saveSetting({
        data: {
          enabled:
            next,
        },
      });

      window.dispatchEvent(
        new Event(
          "pom:attendance-clock-setting-changed",
        ),
      );
    } catch (
      error
    ) {
      setEnabled(
        previous,
      );

      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update your Clock reminder setting.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <Card className="surface-card">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              <AlarmClock className="size-5" />
            </div>

            <div className="min-w-0">
              <p className="font-medium">
                Meeting Clock reminder
              </p>

              <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                If you marked Attending and your Clock is still off 15 minutes
                after the meeting starts, POM will remind you.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {saving && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}

            <Switch
              checked={
                enabled
              }
              disabled={
                loading ||
                saving
              }
              aria-label="Meeting Clock reminder"
              onCheckedChange={(
                next,
              ) =>
                void changeSetting(
                  next,
                )
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfilePage() {
  const loadAvailability =
    useServerFn(
      getOwnAvailability,
    );

  const saveAvailability =
    useServerFn(
      setOwnAvailability,
    );

  const [
    month,
    setMonth,
  ] =
    useState(
      () =>
        startOfMonth(
          new Date(),
        ),
    );

  const [
    selectedDates,
    setSelectedDates,
  ] =
    useState<Set<string>>(
      () =>
        new Set(),
    );

  const [
    loading,
    setLoading,
  ] =
    useState(
      true,
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  const [
    preview,
    setPreview,
  ] =
    useState<{
      start: string;
      current: string;
      unavailable: boolean;
    } | null>(
      null,
    );

  const dragRef =
    useRef<DragState | null>(
      null,
    );

  useEffect(
    () => {
      let active =
        true;

      void (async () => {
        try {
          const result =
            await loadAvailability();

          if (
            !active
          ) {
            return;
          }

          setSelectedDates(
            new Set(
              result.dates,
            ),
          );
        } catch (
          error
        ) {
          console.error(
            "Failed to load availability:",
            error,
          );

          toast.error(
            "Could not load your availability.",
          );
        } finally {
          if (
            active
          ) {
            setLoading(
              false,
            );
          }
        }
      })();

      return () => {
        active =
          false;
      };
    },
    [
      loadAvailability,
    ],
  );

  const days =
    useMemo(
      () =>
        eachDayOfInterval({
          start:
            startOfMonth(
              month,
            ),

          end:
            endOfMonth(
              month,
            ),
        }),
      [
        month,
      ],
    );

  const leadingSlots =
    startOfMonth(
      month,
    ).getDay();

  const previewKeys =
    useMemo(
      () =>
        new Set(
          preview
            ? keysBetween(
                preview.start,
                preview.current,
              )
            : [],
        ),
      [
        preview,
      ],
    );

  const persistChange =
    useCallback(
      async (
        dates: string[],
        unavailable: boolean,
        before: Set<string>,
      ) => {
        const next =
          new Set(
            before,
          );

        for (
          const date
          of dates
        ) {
          if (
            unavailable
          ) {
            next.add(
              date,
            );
          } else {
            next.delete(
              date,
            );
          }
        }

        setSelectedDates(
          next,
        );

        setSaving(
          true,
        );

        try {
          await saveAvailability({
            data: {
              dates,
              unavailable,
            },
          });
        } catch (
          error
        ) {
          console.error(
            "Failed to save availability:",
            error,
          );

          setSelectedDates(
            new Set(
              before,
            ),
          );

          toast.error(
            "Could not save your availability.",
          );
        } finally {
          setSaving(
            false,
          );
        }
      },
      [
        saveAvailability,
      ],
    );

  const finishDrag =
    useCallback(
      async () => {
        const drag =
          dragRef.current;

        if (
          !drag
        ) {
          return;
        }

        dragRef.current =
          null;

        setPreview(
          null,
        );

        const dates =
          keysBetween(
            drag.start,
            drag.current,
          );

        await persistChange(
          dates,
          drag.unavailable,
          drag.before,
        );
      },
      [
        persistChange,
      ],
    );

  useEffect(
    () => {
      const handlePointerUp =
        () => {
          void finishDrag();
        };

      const handlePointerCancel =
        () => {
          dragRef.current =
            null;

          setPreview(
            null,
          );
        };

      window.addEventListener(
        "pointerup",
        handlePointerUp,
      );

      window.addEventListener(
        "pointercancel",
        handlePointerCancel,
      );

      return () => {
        window.removeEventListener(
          "pointerup",
          handlePointerUp,
        );

        window.removeEventListener(
          "pointercancel",
          handlePointerCancel,
        );
      };
    },
    [
      finishDrag,
    ],
  );

  function beginDrag(
    event:
      ReactPointerEvent<HTMLButtonElement>,
    date: string,
  ) {
    if (
      saving ||
      loading
    ) {
      return;
    }

    if (
      event.pointerType ===
        "mouse" &&
      event.button !==
        0
    ) {
      return;
    }

    event.preventDefault();

    const unavailable =
      !selectedDates.has(
        date,
      );

    dragRef.current = {
      start:
        date,

      current:
        date,

      unavailable,

      before:
        new Set(
          selectedDates,
        ),
    };

    setPreview({
      start:
        date,

      current:
        date,

      unavailable,
    });
  }

  function moveDrag(
    clientX: number,
    clientY: number,
  ) {
    const drag =
      dragRef.current;

    if (
      !drag
    ) {
      return;
    }

    const element =
      document.elementFromPoint(
        clientX,
        clientY,
      );

    if (
      !element
    ) {
      return;
    }

    const button =
      element.closest<HTMLElement>(
        "[data-availability-date]",
      );

    const date =
      button
        ?.dataset
        .availabilityDate;

    if (
      !date ||
      date ===
        drag.current
    ) {
      return;
    }

    drag.current =
      date;

    setPreview({
      start:
        drag.start,

      current:
        date,

      unavailable:
        drag.unavailable,
    });
  }

  function toggleWithKeyboard(
    date: string,
  ) {
    if (
      saving ||
      loading
    ) {
      return;
    }

    const before =
      new Set(
        selectedDates,
      );

    void persistChange(
      [
        date,
      ],

      !before.has(
        date,
      ),

      before,
    );
  }

  function previousMonth() {
    setMonth(
      (
        current,
      ) =>
        new Date(
          current.getFullYear(),
          current.getMonth() -
            1,
          1,
        ),
    );
  }

  function nextMonth() {
    setMonth(
      (
        current,
      ) =>
        new Date(
          current.getFullYear(),
          current.getMonth() +
            1,
          1,
        ),
    );
  }

  const today =
    keyFromDate(
      new Date(),
    );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 pb-24 md:pb-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          Profile
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          Manage your availability and Clock reminders.
        </p>
      </div>

      <ClockReminderSetting />

      <Card className="surface-card overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={
                saving
              }
              onClick={
                previousMonth
              }
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>

            <div className="min-w-0 text-center">
              <CardTitle className="text-lg">
                {format(
                  month,
                  "MMMM yyyy",
                )}
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                Click a date or drag across several dates.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={
                saving
              }
              onClick={
                nextMonth
              }
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="grid min-h-72 place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div
                className="grid touch-none grid-cols-7 gap-y-2"
                onPointerMove={(
                  event,
                ) => {
                  if (
                    !dragRef.current
                  ) {
                    return;
                  }

                  event.preventDefault();

                  moveDrag(
                    event.clientX,
                    event.clientY,
                  );
                }}
              >
                {WEEKDAYS.map(
                  (
                    weekday,
                  ) => (
                    <div
                      key={
                        weekday
                      }
                      className="py-2 text-center text-xs font-medium text-muted-foreground"
                    >
                      {
                        weekday
                      }
                    </div>
                  ),
                )}

                {Array.from({
                  length:
                    leadingSlots,
                }).map(
                  (
                    _,
                    index,
                  ) => (
                    <div
                      key={`empty-${index}`}
                    />
                  ),
                )}

                {days.map(
                  (
                    day,
                  ) => {
                    const date =
                      keyFromDate(
                        day,
                      );

                    const inPreview =
                      previewKeys.has(
                        date,
                      );

                    const unavailable =
                      inPreview &&
                      preview
                        ? preview.unavailable
                        : selectedDates.has(
                            date,
                          );

                    const isToday =
                      date ===
                      today;

                    return (
                      <div
                        key={
                          date
                        }
                        className="grid place-items-center py-1"
                      >
                        <button
                          type="button"
                          data-availability-date={
                            date
                          }
                          aria-pressed={
                            unavailable
                          }
                          aria-label={`${format(
                            day,
                            "MMMM d, yyyy",
                          )}${
                            unavailable
                              ? ", unavailable"
                              : ", available"
                          }`}
                          disabled={
                            saving
                          }
                          className={cn(
                            "grid size-10 select-none place-items-center rounded-full border text-sm font-medium transition-colors sm:size-11",

                            unavailable
                              ? "border-destructive bg-destructive text-destructive-foreground"
                              : "border-border bg-background hover:bg-accent",

                            isToday &&
                              !unavailable &&
                              "ring-2 ring-primary/40",

                            inPreview &&
                              "ring-2 ring-offset-2",

                            saving &&
                              "cursor-not-allowed opacity-70",
                          )}
                          onPointerDown={(
                            event,
                          ) =>
                            beginDrag(
                              event,
                              date,
                            )
                          }
                          onKeyDown={(
                            event,
                          ) => {
                            if (
                              event.key ===
                                "Enter" ||
                              event.key ===
                                " "
                            ) {
                              event.preventDefault();

                              toggleWithKeyboard(
                                date,
                              );
                            }
                          }}
                        >
                          {format(
                            day,
                            "d",
                          )}
                        </button>
                      </div>
                    );
                  },
                )}
              </div>

              <div className="mt-6 flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="size-3 rounded-full bg-destructive" />
                  Unavailable
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {saving && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}

                  {saving
                    ? "Saving…"
                    : `${selectedDates.size} unavailable date${
                        selectedDates.size ===
                        1
                          ? ""
                          : "s"
                      }`}
                </div>
              </div>

              <div className="mt-4 rounded-2xl bg-muted/50 p-4">
                <div className="flex gap-3">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" />

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Start dragging from an available day to mark a range
                    unavailable. Start dragging from an unavailable day to make
                    the whole range available again.
                  </p>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}