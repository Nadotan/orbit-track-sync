import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AtSign,
  CalendarClock,
  Check,
  Clock,
  Flame,
  Loader2,
  NotebookPen,
  Pencil,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  MentionText,
  MentionTextarea,
  extractMentionIds,
} from "@/components/mention-textarea";
import {
  CLOCK_UPDATE_MIN_WORDS,
  saveClockSession,
} from "@/lib/clock-session.functions";
import {
  formatDateTime,
  formatDuration,
  formatHours,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { getMyOpenTasks } from "@/lib/tasks.functions";
import type { ClockTaskOption } from "@/lib/tasks.functions";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      {
        title: "Time Tracker - POM",
      },
      {
        name: "description",
        content:
          "Clock in, clock out and log what you worked on with a live circular timer.",
      },
      {
        property: "og:title",
        content: "Time Tracker - POM",
      },
      {
        property: "og:description",
        content:
          "A live work timer with daily task notes and a timeline of recent entries.",
      },
    ],
  }),
  component: TrackerPage,
});

interface ClockTaskDraft {
  body: string;
  mentionedUserIds: string[];
}

function countWords(value: string) {
  const trimmed = value.trim();

  return trimmed
    ? trimmed.split(/\s+/u).length
    : 0;
}

function TrackerPage() {
  const {
    currentUser,
    profiles,
    activeSession,
    startSession,
    cancelSession,
    timeEntries,
    updateTimeEntry,
    deleteTimeEntry,
    refresh,
  } = useStore();

  const loadOpenTasks =
    useServerFn(
      getMyOpenTasks,
    );

  const saveSession =
    useServerFn(
      saveClockSession,
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
    generalUpdate,
    setGeneralUpdate,
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
    selectedTaskIds,
    setSelectedTaskIds,
  ] =
    useState<
      string[]
    >(
      [],
    );

  const [
    activeTaskId,
    setActiveTaskId,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const [
    taskDrafts,
    setTaskDrafts,
  ] =
    useState<
      Record<
        string,
        ClockTaskDraft
      >
    >(
      {},
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
      string | null
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
      string | null
    >(
      null,
    );

  const running =
    activeSession
      ?.userId ===
    currentUser.id;

  useEffect(
    () => {
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
    },
    [
      running,
    ],
  );

  const elapsed =
    running
      ? now -
        new Date(
          activeSession!
            .startTime,
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

  const mentionablePeople =
    useMemo(
      () =>
        profiles
          .filter(
            (
              profile,
            ) =>
              profile.id !==
              currentUser.id,
          )
          .sort(
            (
              a,
              b,
            ) =>
              a.name.localeCompare(
                b.name,
              ),
          ),
      [
        profiles,
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

  const selectedTasks =
    selectedTaskIds
      .map(
        (
          taskId,
        ) =>
          taskOptions.find(
            (
              task,
            ) =>
              task.id ===
              taskId,
          ),
      )
      .filter(
        (
          task,
        ): task is ClockTaskOption =>
          Boolean(task),
      );

  const generalWordCount =
    countWords(
      generalUpdate,
    );

  const editWordCount =
    countWords(
      editText,
    );

  const updatesValid =
    selectedTaskIds.length ===
    0
      ? generalWordCount >=
        CLOCK_UPDATE_MIN_WORDS
      : selectedTaskIds.every(
          (
            taskId,
          ) =>
            countWords(
              taskDrafts[
                taskId
              ]?.body ??
                "",
            ) >=
            CLOCK_UPDATE_MIN_WORDS,
        );

  function resetStopForm() {
    setGeneralUpdate(
      "",
    );

    setSelectedTaskIds(
      [],
    );

    setTaskDrafts(
      {},
    );

    setTaskOptions(
      [],
    );

    setTasksLoaded(
      false,
    );
  }

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
        "Could not load your tasks. You can still save a general work update.",
      );
    } finally {
      setTasksLoading(
        false,
      );
    }
  }

  function toggleTask(
    taskId:
      string,
  ) {
    setSelectedTaskIds(
      (
        current,
      ) => {
        if (
          current.includes(
            taskId,
          )
        ) {
          return current.filter(
            (
              id,
            ) =>
              id !==
              taskId,
          );
        }

        return [
          ...current,
          taskId,
        ];
      },
    );

    setTaskDrafts(
      (
        current,
      ) =>
        current[
          taskId
        ]
          ? current
          : {
              ...current,

              [taskId]: {
                body:
                  "",

                mentionedUserIds:
                  [],
              },
            },
    );
  }

  function setTaskBody(
    taskId:
      string,

    body:
      string,
  ) {
    setTaskDrafts(
      (
        current,
      ) => ({
        ...current,

        [taskId]: {
          body,

          mentionedUserIds:
            current[
              taskId
            ]?.mentionedUserIds ??
            [],
        },
      }),
    );
  }


  async function handleStop() {
    if (
      !activeSession ||
      savingEntry ||
      !updatesValid
    ) {
      return;
    }

    setSavingEntry(
      true,
    );

    try {
      await saveSession({
        data: {
          startedAt:
            activeSession.startTime,

          generalBody:
            selectedTaskIds.length ===
            0
              ? generalUpdate.trim()
              : null,

          generalMentionedUserIds:
            selectedTaskIds.length ===
            0
              ? extractMentionIds(
                  generalUpdate,
                  mentionablePeople,
                )
              : [],



          updates:
            selectedTaskIds.map(
              (
                taskId,
              ) => ({
                taskId,

                body:
                  taskDrafts[
                    taskId
                  ]?.body.trim() ??
                  "",

                mentionedUserIds:
                  extractMentionIds(
                    taskDrafts[
                      taskId
                    ]?.body ??
                      "",
                    mentionablePeople,
                  ),
              }),
            ),
        },
      });

      cancelSession();


      refresh();

      resetStopForm();

      setDialogOpen(
        false,
      );

      toast.success(
        selectedTaskIds.length >
        1
          ? `Time entry saved with ${selectedTaskIds.length} task updates`
          : "Time entry saved",
      );
    } catch (
      error
    ) {
      console.error(
        "Failed to save time entry:",
        error,
      );

      toast.error(
        error instanceof
          Error
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

    resetStopForm();
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
              No time entries yet - start your first session above.
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
                      <MentionText
                        text={
                          entry.description
                        }
                        people={
                          mentionablePeople
                        }
                      />
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
        <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto rounded-3xl p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              What did you work on?
            </DialogTitle>

            <DialogDescription>
              Session length{" "}
              {formatDuration(
                elapsed,
              )}
              . Select every task you worked on and write a separate update for
              each one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Tasks worked on
              </Label>

              {selectedTaskIds.length > 0 && (
                <Badge variant="secondary" className="rounded-full text-[11px]">
                  {selectedTaskIds.length} selected
                </Badge>
              )}
            </div>

            {tasksLoading ? (
              <div className="flex h-10 items-center gap-2 rounded-full border border-input px-4 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Loading your tasks…
              </div>
            ) : taskOptions.length > 0 ? (
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                {taskOptions.map((task) => {
                  const checked = selectedTaskIds.includes(task.id);

                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        toggleTask(task.id);
                        setActiveTaskId(checked ? null : task.id);
                      }}
                      className={cn(
                        "max-w-full truncate rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {task.projectName
                        ? `${task.projectName} · ${task.title}`
                        : task.title}
                    </button>
                  );
                })}
              </div>
            ) : tasksLoaded ? (
              <p className="rounded-2xl bg-muted/50 p-3 text-xs text-muted-foreground">
                No open tasks assigned to you — write one general update below.
              </p>
            ) : null}
          </div>

          {selectedTasks.length === 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label
                  htmlFor="general-clock-update"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  General work update
                </Label>

                <WordCounter value={generalUpdate} />
              </div>

              <MentionTextarea
                id="general-clock-update"
                autoFocus
                rows={4}
                people={mentionablePeople}
                className="bg-muted/50 p-3 pb-11 text-sm leading-relaxed shadow-inner focus-visible:ring-2"
                placeholder="What did you work on? Type @ to tag a teammate."
                value={generalUpdate}
                onChange={setGeneralUpdate}
              />
            </div>
          ) : (
            (() => {
              const active =
                selectedTasks.find((task) => task.id === activeTaskId) ??
                selectedTasks[0]!;

              const draft = taskDrafts[active.id] ?? {
                body: "",
                mentionedUserIds: [],
              };

              const words = countWords(draft.body);

              return (
                <div className="space-y-2">
                  {selectedTasks.length > 1 && (
                    <div className="flex gap-1 overflow-x-auto rounded-full bg-muted/60 p-1">
                      {selectedTasks.map((task, index) => {
                        const done =
                          countWords(taskDrafts[task.id]?.body ?? "") >=
                          CLOCK_UPDATE_MIN_WORDS;

                        return (
                          <button
                            key={task.id}
                            type="button"
                            onClick={() => setActiveTaskId(task.id)}
                            className={cn(
                              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                              task.id === active.id
                                ? "bg-background text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {done && (
                              <Check className="size-3 text-success" />
                            )}
                            Task {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold">
                      {active.projectName
                        ? `${active.projectName} · ${active.title}`
                        : active.title}
                    </p>

                    <WordCounter value={draft.body} />
                  </div>

                  <MentionTextarea
                    key={active.id}
                    autoFocus
                    rows={4}
                    people={mentionablePeople}
                    className="bg-muted/50 p-3 pb-11 text-sm leading-relaxed shadow-inner focus-visible:ring-2"
                    placeholder="What did you do on this task, and what is next? Type @ to tag a teammate."
                    value={draft.body}
                    onChange={(next) => setTaskBody(active.id, next)}
                  />

                  {words >= CLOCK_UPDATE_MIN_WORDS && (
                    <p className="flex items-center gap-1.5 text-xs text-success">
                      <Check className="size-3.5" />
                      Minimum length reached
                    </p>
                  )}
                </div>
              );
            })()
          )

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
                !updatesValid ||
                savingEntry
              }
            >
              {savingEntry ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : selectedTaskIds.length >
                1 ? (
                `Save ${selectedTaskIds.length} task updates`
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
              Update what you worked on during this session. Work updates must
              contain at least{" "}
              {
                CLOCK_UPDATE_MIN_WORDS
              }{" "}
              words.
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

          <div className="flex justify-end">
            <WordCounter
              value={
                editText
              }
            />
          </div>

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
                editWordCount <
                CLOCK_UPDATE_MIN_WORDS
              }
              onClick={() => {
                if (
                  !editingId ||
                  editWordCount <
                    CLOCK_UPDATE_MIN_WORDS
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

function WordCounter({
  value,
}: {
  value:
    string;
}) {
  const words =
    countWords(
      value,
    );

  const complete =
    words >=
    CLOCK_UPDATE_MIN_WORDS;

  return (
    <span
      className={`shrink-0 text-xs font-medium ${
        complete
          ? "text-success"
          : "text-muted-foreground"
      }`}
    >
      {
        words
      }{" "}
      /{" "}
      {
        CLOCK_UPDATE_MIN_WORDS
      }{" "}
      words
    </span>
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