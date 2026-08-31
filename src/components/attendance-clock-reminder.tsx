import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlarmClock,
  History,
  Loader2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  dismissAttendanceClockPrompt,
  getAttendanceClockPrompt,
  logAttendanceClockCatchUp,
} from "@/lib/attendance-clock.functions";
import { useStore } from "@/lib/store";

interface ClockPrompt {
  meetingId: string;
  title: string;
  date: string;
  time: string;
  meetingStartAt: string;
}

function toLocalInputValue(
  iso: string,
) {
  const date = new Date(
    iso,
  );

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    return "";
  }

  const local = new Date(
    date.getTime() -
      date.getTimezoneOffset() *
        60_000,
  );

  return local
    .toISOString()
    .slice(0, 16);
}

function nextLocalMidnightCheck() {
  const next = new Date();

  next.setDate(
    next.getDate() + 1,
  );

  next.setHours(
    0,
    1,
    0,
    0,
  );

  return next.getTime();
}

export function AttendanceClockReminder() {
  const {
    activeSession,
    currentUser,
    rsvps,
    startSession,
    refresh,
  } = useStore();

  const checkPrompt = useServerFn(
    getAttendanceClockPrompt,
  );

  const dismissPrompt = useServerFn(
    dismissAttendanceClockPrompt,
  );

  const logCatchUp = useServerFn(
    logAttendanceClockCatchUp,
  );

  const [
    prompt,
    setPrompt,
  ] =
    useState<ClockPrompt | null>(
      null,
    );

  const [
    showEarlier,
    setShowEarlier,
  ] =
    useState(
      false,
    );

  const [
    earlierStart,
    setEarlierStart,
  ] =
    useState(
      "",
    );

  const [
    busy,
    setBusy,
  ] =
    useState(
      false,
    );

  const [
    checkRevision,
    setCheckRevision,
  ] =
    useState(
      0,
    );

  const nextCheckAtRef =
    useRef(
      0,
    );

  const attendanceKey =
    useMemo(
      () =>
        rsvps
          .filter(
            (rsvp) =>
              rsvp.userId ===
                currentUser.id &&
              rsvp.status ===
                "Attending",
          )
          .map(
            (rsvp) =>
              rsvp.meetingId,
          )
          .sort()
          .join("|"),

      [
        rsvps,
        currentUser.id,
      ],
    );

  useEffect(
    () => {
      if (
        activeSession
      ) {
        setPrompt(
          null,
        );

        return;
      }

      let cancelled =
        false;

      let timeoutId:
        | number
        | null =
        null;

      let checking =
        false;

      const clearTimer =
        () => {
          if (
            timeoutId ===
            null
          ) {
            return;
          }

          window.clearTimeout(
            timeoutId,
          );

          timeoutId =
            null;
        };

      const scheduleAt =
        (
          when: number,
        ) => {
          if (
            cancelled
          ) {
            return;
          }

          clearTimer();

          nextCheckAtRef.current =
            when;

          timeoutId =
            window.setTimeout(
              () => {
                timeoutId =
                  null;

                void runCheck();
              },

              Math.max(
                1_000,
                when -
                  Date.now(),
              ),
            );
        };

      const runCheck =
        async () => {
          if (
            cancelled ||
            checking
          ) {
            return;
          }

          checking =
            true;

          clearTimer();

          try {
            const result =
              await checkPrompt();

            if (
              cancelled
            ) {
              return;
            }

            const nextPrompt =
              (
                result.prompt ??
                null
              ) as ClockPrompt | null;

            setPrompt(
              nextPrompt,
            );

            if (
              nextPrompt
            ) {
              nextCheckAtRef.current =
                Number.POSITIVE_INFINITY;

              setShowEarlier(
                false,
              );

              setEarlierStart(
                toLocalInputValue(
                  nextPrompt.meetingStartAt,
                ),
              );

              return;
            }

            if (
              result.nextCheckAt
            ) {
              const nextMs =
                new Date(
                  result.nextCheckAt,
                ).getTime();

              if (
                Number.isFinite(
                  nextMs,
                )
              ) {
                scheduleAt(
                  nextMs,
                );

                return;
              }
            }

            scheduleAt(
              nextLocalMidnightCheck(),
            );
          } catch (
            error
          ) {
            console.error(
              "Failed to check attendance Clock reminder:",
              error,
            );

            scheduleAt(
              nextLocalMidnightCheck(),
            );
          } finally {
            checking =
              false;
          }
        };

      void runCheck();

      const checkIfDue =
        () => {
          if (
            Date.now() >=
            nextCheckAtRef.current
          ) {
            void runCheck();
          }
        };

      const handleVisibility =
        () => {
          if (
            document.visibilityState ===
            "visible"
          ) {
            checkIfDue();
          }
        };

      const handleFocus =
        () => {
          checkIfDue();
        };

      const handleSettingChanged =
        () => {
          void runCheck();
        };

      document.addEventListener(
        "visibilitychange",
        handleVisibility,
      );

      window.addEventListener(
        "focus",
        handleFocus,
      );

      window.addEventListener(
        "pom:attendance-clock-setting-changed",
        handleSettingChanged,
      );

      return () => {
        cancelled =
          true;

        clearTimer();

        document.removeEventListener(
          "visibilitychange",
          handleVisibility,
        );

        window.removeEventListener(
          "focus",
          handleFocus,
        );

        window.removeEventListener(
          "pom:attendance-clock-setting-changed",
          handleSettingChanged,
        );
      };
    },
    [
      activeSession?.startTime,
      currentUser.id,
      attendanceKey,
      checkRevision,
      checkPrompt,
    ],
  );

  async function dismissForToday() {
    if (
      !prompt ||
      busy
    ) {
      return;
    }

    const current =
      prompt;

    setPrompt(
      null,
    );

    setShowEarlier(
      false,
    );

    setBusy(
      true,
    );

    try {
      await dismissPrompt({
        data: {
          meetingId:
            current.meetingId,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "Failed to dismiss attendance Clock reminder:",
        error,
      );
    } finally {
      setBusy(
        false,
      );

      setCheckRevision(
        (value) =>
          value + 1,
      );
    }
  }

  async function startNow() {
    if (
      !prompt ||
      busy
    ) {
      return;
    }

    const current =
      prompt;

    setBusy(
      true,
    );

    setPrompt(
      null,
    );

    setShowEarlier(
      false,
    );

    startSession();

    try {
      await dismissPrompt({
        data: {
          meetingId:
            current.meetingId,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "Failed to record attendance Clock reminder dismissal:",
        error,
      );
    } finally {
      setBusy(
        false,
      );
    }

    toast.success(
      "Clock started",
    );
  }

  async function startFromEarlier() {
    if (
      !prompt ||
      busy
    ) {
      return;
    }

    const parsed =
      new Date(
        earlierStart,
      );

    const startMs =
      parsed.getTime();

    if (
      !earlierStart ||
      !Number.isFinite(
        startMs,
      )
    ) {
      toast.error(
        "Choose when you started.",
      );

      return;
    }

    if (
      startMs >=
      Date.now()
    ) {
      toast.error(
        "Choose a time earlier than now.",
      );

      return;
    }

    setBusy(
      true,
    );

    try {
      await logCatchUp({
        data: {
          meetingId:
            prompt.meetingId,

          startedAt:
            parsed.toISOString(),
        },
      });

      startSession();

      refresh();

      setPrompt(
        null,
      );

      setShowEarlier(
        false,
      );

      toast.success(
        "Missed time logged and Clock started",
      );
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not log the missed time.",
      );
    } finally {
      setBusy(
        false,
      );
    }
  }

  return (
    <Dialog
      open={
        Boolean(
          prompt,
        )
      }
      onOpenChange={(
        open,
      ) => {
        if (
          !open &&
          prompt &&
          !busy
        ) {
          void dismissForToday();
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl">
        {prompt && (
          <>
            <DialogHeader className="text-left">
              <div className="mb-2 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                <AlarmClock className="size-5" />
              </div>

              <DialogTitle>
                Forgot to start your Clock?
              </DialogTitle>

              <DialogDescription className="leading-relaxed">
                You marked yourself Attending for{" "}
                <span className="font-medium text-foreground">
                  {
                    prompt.title
                  }
                </span>
                , but your Clock is still off.
              </DialogDescription>
            </DialogHeader>

            {showEarlier && (
              <div className="space-y-3 rounded-2xl border bg-muted/30 p-3">
                <div>
                  <Label htmlFor="attendance-clock-catch-up">
                    When did you start?
                  </Label>

                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    POM will log the missed time up to now, then continue with a
                    running Clock.
                  </p>
                </div>

                <Input
                  id="attendance-clock-catch-up"
                  type="datetime-local"
                  value={
                    earlierStart
                  }
                  max={
                    toLocalInputValue(
                      new Date().toISOString(),
                    )
                  }
                  disabled={
                    busy
                  }
                  onChange={(
                    event,
                  ) =>
                    setEarlierStart(
                      event.target.value,
                    )
                  }
                />
              </div>
            )}

            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {showEarlier ? (
                <>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={
                      busy ||
                      !earlierStart
                    }
                    onClick={() =>
                      void startFromEarlier()
                    }
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <History className="size-4" />
                    )}

                    Log missed time & start
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      setShowEarlier(
                        false,
                      )
                    }
                  >
                    Back
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    className="w-full"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      void startNow()
                    }
                  >
                    <AlarmClock className="size-4" />
                    Start now
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      setShowEarlier(
                        true,
                      )
                    }
                  >
                    <History className="size-4" />
                    I started earlier
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    disabled={
                      busy
                    }
                    onClick={() =>
                      void dismissForToday()
                    }
                  >
                    Dismiss for today
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}