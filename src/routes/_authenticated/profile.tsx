import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  startOfMonth,
} from "date-fns";
import {
  AlarmClock,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  getOwnAvailability,
  setOwnAvailability,
} from "@/lib/availability.functions";
import {
  PREFERENCE_DEFINITIONS,
  PREFERENCE_KEYS,
  defaultUserPreferences,
  type UserPreferenceKey,
  type UserPreferences,
} from "@/lib/preferences";
import {
  getUserPreferences,
  setUserPreference,
} from "@/lib/profile.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      {
        title: "Profile - POM",
      },
      {
        name: "description",
        content: "Manage your POM availability and notification preferences.",
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

const PREFERENCE_EVENT = "pom:user-preference-changed";

interface DragState {
  start: string;
  current: string;
  unavailable: boolean;
  before: Set<string>;
}

function keyFromDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);

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
  const firstDate = dateFromKey(first);
  const secondDate = dateFromKey(second);

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
  }).map(keyFromDate);
}

function preferenceIcon(
  key: UserPreferenceKey,
) {
  if (
    key === "clock_reminders"
  ) {
    return AlarmClock;
  }

  if (
    key === "workshop_clock_start_reminder"
  ) {
    return BellRing;
  }

  return CalendarDays;
}

function PreferencesCard() {
  const loadPreferences =
    useServerFn(
      getUserPreferences,
    );

  const savePreference =
    useServerFn(
      setUserPreference,
    );

  const [
    preferences,
    setPreferences,
  ] =
    useState<UserPreferences>(
      () =>
        defaultUserPreferences(),
    );

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    savingKey,
    setSavingKey,
  ] =
    useState<
      UserPreferenceKey | null
    >(null);

  useEffect(() => {
    let active = true;

    void loadPreferences()
      .then((result) => {
        if (active) {
          setPreferences(result);
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load preferences:",
          error,
        );

        if (active) {
          toast.error(
            "Could not load your preferences.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    loadPreferences,
  ]);

  async function changePreference(
    key: UserPreferenceKey,
    enabled: boolean,
  ) {
    if (
      loading ||
      savingKey
    ) {
      return;
    }

    const previous =
      preferences[key];

    setPreferences(
      (current) => ({
        ...current,
        [key]: enabled,
      }),
    );

    setSavingKey(key);

    try {
      await savePreference({
        data: {
          key,
          enabled,
        },
      });

      window.dispatchEvent(
        new CustomEvent(
          PREFERENCE_EVENT,
          {
            detail: {
              key,
              enabled,
            },
          },
        ),
      );
    } catch (error) {
      setPreferences(
        (current) => ({
          ...current,
          [key]: previous,
        }),
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update your preference.",
      );
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Card className="surface-card">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
            <SlidersHorizontal className="size-5" />
          </div>

          <div>
            <CardTitle className="text-lg">
              Preferences
            </CardTitle>

            <p className="mt-1 text-sm text-muted-foreground">
              Choose which optional reminders POM should send you.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="divide-y divide-border p-0">
        {PREFERENCE_KEYS.map(
          (key) => {
            const definition =
              PREFERENCE_DEFINITIONS[key];

            const Icon =
              preferenceIcon(key);

            const saving =
              savingKey === key;

            return (
              <div
                key={key}
                className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6"
              >
                <div className="flex min-w-0 gap-3">
                  <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Icon className="size-4" />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {definition.title}
                    </p>

                    <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                      {definition.description}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 pt-1">
                  {saving && (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}

                  <Switch
                    checked={
                      preferences[key]
                    }
                    disabled={
                      loading ||
                      savingKey !== null
                    }
                    aria-label={
                      definition.title
                    }
                    onCheckedChange={(
                      enabled,
                    ) =>
                      void changePreference(
                        key,
                        enabled,
                      )
                    }
                  />
                </div>
              </div>
            );
          },
        )}
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
    useState(true);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

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

  useEffect(() => {
    let active = true;

    void loadAvailability()
      .then((result) => {
        if (active) {
          setSelectedDates(
            new Set(
              result.dates,
            ),
          );
        }
      })
      .catch((error) => {
        console.error(
          "Failed to load availability:",
          error,
        );

        if (active) {
          toast.error(
            "Could not load your availability.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    loadAvailability,
  ]);

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
          new Set(before);

        for (
          const date
          of dates
        ) {
          if (unavailable) {
            next.add(date);
          } else {
            next.delete(date);
          }
        }

        setSelectedDates(next);
        setSaving(true);

        try {
          await saveAvailability({
            data: {
              dates,
              unavailable,
            },
          });
        } catch (error) {
          console.error(
            "Failed to save availability:",
            error,
          );

          setSelectedDates(
            new Set(before),
          );

          toast.error(
            "Could not save your availability.",
          );
        } finally {
          setSaving(false);
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

        if (!drag) {
          return;
        }

        dragRef.current = null;
        setPreview(null);

        await persistChange(
          keysBetween(
            drag.start,
            drag.current,
          ),
          drag.unavailable,
          drag.before,
        );
      },
      [
        persistChange,
      ],
    );

  useEffect(() => {
    const handlePointerUp =
      () => {
        void finishDrag();
      };

    const handlePointerCancel =
      () => {
        dragRef.current = null;
        setPreview(null);
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
  }, [
    finishDrag,
  ]);

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
      event.button !== 0
    ) {
      return;
    }

    event.preventDefault();

    const unavailable =
      !selectedDates.has(date);

    dragRef.current = {
      start: date,
      current: date,
      unavailable,
      before:
        new Set(
          selectedDates,
        ),
    };

    setPreview({
      start: date,
      current: date,
      unavailable,
    });
  }

  function moveDrag(
    clientX: number,
    clientY: number,
  ) {
    const drag =
      dragRef.current;

    if (!drag) {
      return;
    }

    const element =
      document.elementFromPoint(
        clientX,
        clientY,
      );

    const button =
      element?.closest<HTMLElement>(
        "[data-availability-date]",
      );

    const date =
      button
        ?.dataset
        .availabilityDate;

    if (
      !date ||
      date === drag.current
    ) {
      return;
    }

    drag.current = date;

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
      [date],
      !before.has(date),
      before,
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
          Manage your availability and notification preferences.
        </p>
      </div>

      <PreferencesCard />

      <Card className="surface-card overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={saving}
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(
                      current.getFullYear(),
                      current.getMonth() -
                        1,
                      1,
                    ),
                )
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
              disabled={saving}
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(
                      current.getFullYear(),
                      current.getMonth() +
                        1,
                      1,
                    ),
                )
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
                      {weekday}
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
                      keyFromDate(day);

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
                      date === today;

                    return (
                      <div
                        key={date}
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