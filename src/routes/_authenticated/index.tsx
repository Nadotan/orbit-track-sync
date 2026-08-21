import {
  createFileRoute,
} from "@tanstack/react-router";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useServerFn,
} from "@tanstack/react-start";

import {
  CalendarClock,
  Clock,
  Flame,
  Loader2,
  NotebookPen,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";

import {
  Button,
} from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Label,
} from "@/components/ui/label";

import {
  Textarea,
} from "@/components/ui/textarea";

import {
  Badge,
} from "@/components/ui/badge";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  useStore,
} from "@/lib/store";

import {
  getMyOpenTasks,
} from "@/lib/tasks.functions";

import type {
  ClockTaskOption,
} from "@/lib/tasks.functions";

import {
  formatDuration,
  formatHours,
  formatDateTime,
} from "@/lib/format";

import {
  toast,
} from "sonner";

export const Route =
  createFileRoute(
    "/_authenticated/",
  )({
    head: () => ({
      meta: [
        {
          title:
            "Time Tracker — POM",
        },
        {
          name:
            "description",
          content:
            "Clock in, clock out and log what you worked on with a live circular timer.",
        },
        {
          property:
            "og:title",
          content:
            "Time Tracker — POM",
        },
        {
          property:
            "og:description",
          content:
            "A live work timer with daily task notes and a timeline of recent entries.",
        },
      ],
    }),

    component:
      TrackerPage,
  });

function TrackerPage() {
  const {
    currentUser,
    activeSession,
    startSession,
    cancelSession,
    timeEntries,
    updateTimeEntry,
    deleteTimeEntry,
    refresh,
  } =
    useStore();

  const loadOpenTasks =
    useServerFn(
      getMyOpenTasks,
    );

  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.now(),
    );

  const [
    dialogOpen,
    setDialogOpen,
  ] =
    useState(
      false,
    );

  const [
    description,
    setDescription,
  ] =
    useState(
      "",
    );

  const [
    taskOptions,
    setTaskOptions,
  ] =
    useState<
      ClockTaskOption[]
    >(
      [],
    );

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] =
    useState(
      "none",
    );

  const [
    tasksLoading,
    setTasksLoading,
  ] =
    useState(
      false,
    );

  const [
    tasksLoaded,
    setTasksLoaded,
  ] =
    useState(
      false,
    );

  const [
    savingEntry,
    setSavingEntry,
  ] =
    useState(
      false,
    );

  const [
    editingId,
    setEditingId,
  ] =
    useState<
      string |
      null
    >(
      null,
    );

  const [
    editText,
    setEditText,
  ] =
    useState(
      "",
    );

  const [
    deletingId,
    setDeletingId,
  ] =
    useState<
      string |
      null
    >(
      null,
    );

  const running =
    activeSession?.userId ===
    currentUser.id;

  useEffect(() => {
    if (
      !running
    ) {
      return;
    }

    const timer =
      setInterval(
        () => {
          setNow(
            Date.now(),
          );
        },
        1000,
      );

    return () =>
      clearInterval(
        timer,
      );
  }, [
    running,
  ]);

  const elapsed =
    running
      ? now -
        new Date(
          activeSession!.startTime,
        ).getTime()
      : 0;

  const myEntries =
    useMemo(
      () =>
        timeEntries.filter(
          (
            entry,
          ) =>
            entry.userId ===
            currentUser.id,
        ),
      [
        timeEntries,
        currentUser.id,
      ],
    );

  const todayMs =
    myEntries
      .filter(
        (
          entry,
        ) =>
          new Date(
            entry.endTime,
          ).toDateString() ===
          new Date()
            .toDateString(),
      )
      .reduce(
        (
          total,
          entry,
        ) =>
          total +
          entry.durationMs,
        0,
      );

  const weekMs =
    myEntries
      .filter(
        (
          entry,
        ) =>
          Date.now() -
            new Date(
              entry.endTime,
            ).getTime() <
          7 *
            86400_000,
      )
      .reduce(
        (
          total,
          entry,
        ) =>
          total +
          entry.durationMs,
        0,
      );

  async function openStopDialog() {
    setDialogOpen(
      true,
    );

    if (
      tasksLoaded ||
      tasksLoading
    ) {
      return;
    }

    setTasksLoading(
      true,
    );

    try {
      const tasks =
        await loadOpenTasks();

      setTaskOptions(
        tasks,
      );

      setTasksLoaded(
        true,
      );
    } catch (
      error
    ) {
      console.error(
        "Failed to load assigned tasks:",
        error,
      );

      setTaskOptions(
        [],
      );

      setTasksLoaded(
        true,
      );

      toast.error(
        "Could not load your tasks. You can still save without a task.",
      );
    } finally {
      setTasksLoading(
        false,
      );
    }
  }

  async function handleStop() {
    if (
      !description.trim() ||
      !activeSession ||
      savingEntry
    ) {
      return;
    }

    setSavingEntry(
      true,
    );

    const end =
      new Date();

    const start =
      new Date(
        activeSession.startTime,
      );

    try {
      /*
       * Generated Supabase types do not yet include task_id.
       * Keep the cast local instead of modifying generated code.
       */
      const {
        error,
      } =
        await (
          supabase as any
        )
          .from(
            "time_entries",
          )
          .insert({
            user_id:
              currentUser.id,

            start_time:
              activeSession.startTime,

            end_time:
              end.toISOString(),

            duration_ms:
              end.getTime() -
              start.getTime(),

            description:
              description.trim(),

            task_id:
              selectedTaskId ===
              "none"
                ? null
                : selectedTaskId,
          });

      if (
        error
      ) {
        throw new Error(
          error.message,
        );
      }

      cancelSession();

      refresh();

      setDescription(
        "",
      );

      setSelectedTaskId(
        "none",
      );

      setTaskOptions(
        [],
      );

      setTasksLoaded(
        false,
      );

      setDialogOpen(
        false,
      );

      toast.success(
        "Time entry saved",
      );
    } catch (
      error
    ) {
      console.error(
        "Failed to save time entry:",
        error,
      );

      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save time entry.",
      );
    } finally {
      setSavingEntry(
        false,
      );
    }
  }

  function handleStart() {
    startSession();

    setNow(
      Date.now(),
    );

    setDescription(
      "",
    );

    setSelectedTaskId(
      "none",
    );

    setTaskOptions(
      [],
    );

    setTasksLoaded(
      false,
    );
  }

  const R =
    132;

  const CIRC =
    2 *
    Math.PI *
    R;

  const progress =
    running
      ? (
          (
            elapsed /
            1000
          ) %
          3600
        ) /
        3600
      : 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="text-center sm:text-left">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          The Clock
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          {running
            ? "You're on the clock. Tap stop when you're done."
            : "Tap start when you begin working."}
        </p>
      </div>

      <div className="surface-card flex flex-col items-center gap-6 rounded-[2rem] p-6 sm:p-10">
        <div className="relative grid place-items-center">
          <svg
            width="304"
            height="304"
            viewBox="0 0 304 304"
            className="max-w-full -rotate-90"
          >
            <circle
              cx="152"
              cy="152"
              r={
                R
              }
              fill="none"
              className="stroke-accent"
              strokeWidth="18"
            />

            <circle
              cx="152"
              cy="152"
              r={
                R
              }
              fill="none"
              className="stroke-primary"
              strokeWidth="18"
              strokeLinecap="round"
              strokeDasharray={
                CIRC
              }
              strokeDashoffset={
                CIRC *
                (
                  1 -
                  progress
                )
              }
              style={{
                transition:
                  "stroke-dashoffset 0.6s linear",
              }}
            />
          </svg>

          <div className="absolute flex flex-col items-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest ${
                running
                  ? "bg-accent text-accent-foreground"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  running
                    ? "animate-pulse bg-primary"
                    : "bg-muted-foreground"
                }`}
              />

              {running
                ? "Working"
                : "Idle"}
            </span>

            <p className="tabular mt-3 font-mono text-4xl font-bold sm:text-5xl">
              {formatDuration(
                elapsed,
              )}
            </p>

            <p className="mt-1 max-w-[12rem] text-center text-xs text-muted-foreground">
              {running
                ? `Started ${new Date(
                    activeSession!.startTime,
                  ).toLocaleTimeString(
                    [],
                    {
                      hour:
                        "2-digit",

                      minute:
                        "2-digit",
                    },
                  )}`
                : "Hours : minutes : seconds"}
            </p>
          </div>
        </div>

        {running ? (
          <Button
            size="lg"
            variant="destructive"
            className="h-14 w-full max-w-xs rounded-full text-base"
            onClick={() =>
              void openStopDialog()
            }
          >
            <Square className="size-5" />
            Stop work
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-14 w-full max-w-xs rounded-full text-base"
            onClick={
              handleStart
            }
          >
            <Play className="size-5" />
            Start work
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={
            Clock
          }
          label="Today"
          value={formatHours(
            todayMs +
              elapsed,
          )}
        />

        <StatCard
          icon={
            CalendarClock
          }
          label="Last 7 days"
          value={formatHours(
            weekMs,
          )}
        />

        <StatCard
          icon={
            Flame
          }
          label="Entries logged"
          value={String(
            myEntries.length,
          )}
        />
      </div>

      <Card className="surface-card rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <NotebookPen className="size-4 text-primary" />
            Your history
          </CardTitle>
        </CardHeader>

        <CardContent>
          {myEntries.length ===
          0 ? (
            <p className="text-sm text-muted-foreground">
              No time entries yet — start your first session above.
            </p>
          ) : (
            <ol className="relative space-y-5 border-l border-border pl-6">
              {myEntries.map(
                (
                  entry,
                ) => (
                  <li
                    key={
                      entry.id
                    }
                    className="relative"
                  >
                    <span className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background bg-primary" />

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">
                        {formatDateTime(
                          entry.startTime,
                        )}
                      </span>

                      <Badge
                        variant="secondary"
                        className="tabular rounded-full"
                      >
                        {formatHours(
                          entry.durationMs,
                        )}
                      </Badge>

                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-full"
                          aria-label="Edit entry"
                          onClick={() => {
                            setEditingId(
                              entry.id,
                            );

                            setEditText(
                              entry.description,
                            );
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 rounded-full"
                          aria-label="Delete entry"
                          onClick={() =>
                            setDeletingId(
                              entry.id,
                            )
                          }
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                      {
                        entry.description
                      }
                    </p>
                  </li>
                ),
              )}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={
          dialogOpen
        }
        onOpenChange={
          setDialogOpen
        }
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              What did you work on?
            </DialogTitle>

            <DialogDescription>
              Session length{" "}
              {formatDuration(
                elapsed,
              )}{" "}
              — add a short summary to save this entry.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            rows={
              5
            }
            className="resize-none rounded-2xl bg-muted/50 p-4 text-base leading-relaxed shadow-inner focus-visible:ring-2"
            placeholder="e.g. Fixed the onboarding flow, reviewed PRs, planned next sprint…"
            value={
              description
            }
            onChange={(
              event,
            ) =>
              setDescription(
                event.target.value,
              )
            }
          />

          <div className="space-y-2">
            <Label>
              Task
            </Label>

            {tasksLoading ? (
              <div className="flex h-10 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading your tasks…
              </div>
            ) : (
              <Select
                value={
                  selectedTaskId
                }
                onValueChange={
                  setSelectedTaskId
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="none">
                    No task
                  </SelectItem>

                  {taskOptions.map(
                    (
                      task,
                    ) => (
                      <SelectItem
                        key={
                          task.id
                        }
                        value={
                          task.id
                        }
                      >
                        {task.projectName
                          ? `${task.projectName} — ${task.title}`
                          : task.title}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            )}

            {!tasksLoading &&
              tasksLoaded &&
              taskOptions.length ===
                0 && (
                <p className="text-xs text-muted-foreground">
                  You have no open tasks assigned to you.
                </p>
              )}

            {!tasksLoading &&
              taskOptions.length >
                0 && (
                <p className="text-xs text-muted-foreground">
                  Optional — choose the task this work belongs to.
                </p>
              )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={
                savingEntry
              }
              onClick={() =>
                setDialogOpen(
                  false,
                )
              }
            >
              Keep tracking
            </Button>

            <Button
              className="rounded-full"
              onClick={() =>
                void handleStop()
              }
              disabled={
                !description.trim() ||
                savingEntry
              }
            >
              {savingEntry ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save entry"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          editingId !==
          null
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open
          ) {
            setEditingId(
              null,
            );
          }
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              Edit entry
            </DialogTitle>

            <DialogDescription>
              Update what you worked on during this session.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            autoFocus
            rows={
              5
            }
            className="resize-none rounded-2xl bg-muted/50 p-4 text-base leading-relaxed shadow-inner focus-visible:ring-2"
            value={
              editText
            }
            onChange={(
              event,
            ) =>
              setEditText(
                event.target.value,
              )
            }
          />

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() =>
                setEditingId(
                  null,
                )
              }
            >
              Cancel
            </Button>

            <Button
              className="rounded-full"
              disabled={
                !editText.trim()
              }
              onClick={() => {
                if (
                  !editingId
                ) {
                  return;
                }

                updateTimeEntry(
                  editingId,
                  editText.trim(),
                );

                setEditingId(
                  null,
                );

                toast.success(
                  "Entry updated",
                );
              }}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          deletingId !==
          null
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open
          ) {
            setDeletingId(
              null,
            );
          }
        }}
      >
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              Delete this entry?
            </DialogTitle>

            <DialogDescription>
              This removes the logged time permanently.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() =>
                setDeletingId(
                  null,
                )
              }
            >
              Keep it
            </Button>

            <Button
              variant="destructive"
              className="rounded-full"
              onClick={() => {
                if (
                  !deletingId
                ) {
                  return;
                }

                deleteTimeEntry(
                  deletingId,
                );

                setDeletingId(
                  null,
                );

                toast.success(
                  "Entry deleted",
                );
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon:
    Icon,
  label,
  value,
}: {
  icon:
    React.ElementType;

  label:
    string;

  value:
    string;
}) {
  return (
    <div className="surface-card flex items-center gap-3 rounded-2xl p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>

      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {
            label
          }
        </p>

        <p className="tabular truncate text-xl font-semibold">
          {
            value
          }
        </p>
      </div>
    </div>
  );
}