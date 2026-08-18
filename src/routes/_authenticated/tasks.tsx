import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  parseISO,
  startOfDay,
} from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createTask,
  deleteTask,
  getTasksWorkspace,
  setTeamLeadRole,
  updateTask,
  updateTaskStatus,
} from "@/lib/tasks.functions";
import type {
  TaskItem,
  TaskPerson,
  TaskRole,
  TaskStatus,
  TasksWorkspace,
} from "@/lib/tasks.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — POM" },
      {
        name: "description",
        content: "POM team tasks and assignments.",
      },
    ],
  }),
  component: TasksPage,
});

type TaskTab =
  | "my"
  | "all"
  | "done";

interface TaskFormValue {
  title: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  teamId: string;
  assigneeIds: string[];
}

const STATUSES: TaskStatus[] = [
  "To Do",
  "In Progress",
  "Blocked",
  "Done",
];

function defaultTaskForm(
  role: TaskRole,
  teamIds: string[],
): TaskFormValue {
  return {
    title: "",
    description: "",
    deadline: format(
      addDays(
        new Date(),
        7,
      ),
      "yyyy-MM-dd",
    ),
    status: "To Do",
    teamId:
      role === "admin"
        ? "general"
        : teamIds[0] ?? "",
    assigneeIds: [],
  };
}

function taskToForm(
  task: TaskItem,
): TaskFormValue {
  return {
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    status: task.status,
    teamId:
      task.teamId ??
      "general",
    assigneeIds:
      task.assignees.map(
        (assignee) =>
          assignee.id,
      ),
  };
}

function statusClass(
  status: TaskStatus,
) {
  if (
    status ===
    "Done"
  ) {
    return "border-success/30 bg-success/10 text-success";
  }

  if (
    status ===
    "Blocked"
  ) {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (
    status ===
    "In Progress"
  ) {
    return "border-primary/30 bg-primary/10 text-primary";
  }

  return "border-border bg-muted text-muted-foreground";
}

function deadlineInfo(
  deadline: string,
  status: TaskStatus,
) {
  const date =
    parseISO(
      deadline,
    );

  const days =
    differenceInCalendarDays(
      date,
      startOfDay(
        new Date(),
      ),
    );

  if (
    status ===
    "Done"
  ) {
    return {
      text:
        `Due ${format(
          date,
          "MMM d",
        )}`,

      className:
        "text-muted-foreground",
    };
  }

  if (
    days <
    0
  ) {
    const overdue =
      Math.abs(
        days,
      );

    return {
      text:
        `${overdue} day${overdue === 1 ? "" : "s"} overdue`,

      className:
        "font-medium text-destructive",
    };
  }

  if (
    days ===
    0
  ) {
    return {
      text:
        "Due today",

      className:
        "font-medium text-warning",
    };
  }

  if (
    days ===
    1
  ) {
    return {
      text:
        "Due tomorrow",

      className:
        "font-medium text-warning",
    };
  }

  return {
    text:
      `${days} days left`,

    className:
      "text-muted-foreground",
  };
}

function roleLabel(
  role: TaskRole,
) {
  if (
    role ===
    "admin"
  ) {
    return "Admin";
  }

  if (
    role ===
    "team_lead"
  ) {
    return "Team Lead";
  }

  return "User";
}

function TasksPage() {
  const getWorkspace =
    useServerFn(
      getTasksWorkspace,
    );

  const create =
    useServerFn(
      createTask,
    );

  const update =
    useServerFn(
      updateTask,
    );

  const updateStatus =
    useServerFn(
      updateTaskStatus,
    );

  const remove =
    useServerFn(
      deleteTask,
    );

  const changeTeamLead =
    useServerFn(
      setTeamLeadRole,
    );

  const [
    workspace,
    setWorkspace,
  ] =
    useState<TasksWorkspace | null>(
      null,
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
    tab,
    setTab,
  ] =
    useState<TaskTab>(
      "my",
    );

  const [
    createOpen,
    setCreateOpen,
  ] =
    useState(
      false,
    );

  const [
    teamLeadsOpen,
    setTeamLeadsOpen,
  ] =
    useState(
      false,
    );

  const [
    selectedTaskId,
    setSelectedTaskId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    createForm,
    setCreateForm,
  ] =
    useState<TaskFormValue>(
      defaultTaskForm(
        "user",
        [],
      ),
    );

  const [
    editForm,
    setEditForm,
  ] =
    useState<TaskFormValue | null>(
      null,
    );

  const [
    leadBusyId,
    setLeadBusyId,
  ] =
    useState<string | null>(
      null,
    );

  const load =
    useCallback(
      async () => {
        try {
          const result =
            await getWorkspace();

          setWorkspace(
            result,
          );
        } catch (
          error
        ) {
          console.error(
            "Failed to load tasks:",
            error,
          );

          toast.error(
            "Could not load tasks.",
          );
        } finally {
          setLoading(
            false,
          );
        }
      },
      [
        getWorkspace,
      ],
    );

  useEffect(() => {
    void load();
  }, [
    load,
  ]);

  useEffect(() => {
    if (
      !workspace
    ) {
      return;
    }

    setCreateForm(
      defaultTaskForm(
        workspace.role,
        workspace.teamIds,
      ),
    );
  }, [
    workspace?.role,
    workspace?.teamIds.join(
      ",",
    ),
  ]);

  const selectedTask =
    workspace?.tasks.find(
      (
        task,
      ) =>
        task.id ===
        selectedTaskId,
    ) ??
    null;

  useEffect(() => {
    if (
      selectedTask
    ) {
      setEditForm(
        taskToForm(
          selectedTask,
        ),
      );
    } else {
      setEditForm(
        null,
      );
    }
  }, [
    selectedTask?.id,
    selectedTask?.updatedAt,
  ]);

  const myTasks =
    useMemo(
      () =>
        (
          workspace?.tasks ??
          []
        ).filter(
          (
            task,
          ) =>
            task.status !==
              "Done" &&
            task.assignees.some(
              (
                assignee,
              ) =>
                assignee.id ===
                workspace?.currentUserId,
            ),
        ),
      [
        workspace,
      ],
    );

  const allTasks =
    useMemo(
      () =>
        (
          workspace?.tasks ??
          []
        ).filter(
          (
            task,
          ) =>
            task.status !==
            "Done",
        ),
      [
        workspace,
      ],
    );

  const doneTasks =
    useMemo(
      () =>
        (
          workspace?.tasks ??
          []
        ).filter(
          (
            task,
          ) =>
            task.status ===
            "Done",
        ),
      [
        workspace,
      ],
    );

  if (
    loading
  ) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (
    !workspace
  ) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-warning" />

        <p className="mt-3 font-medium">
          Tasks could not be loaded.
        </p>
      </div>
    );
  }

  const managerTeams =
    workspace.role ===
    "admin"
      ? workspace.teams
      : workspace.teams.filter(
          (
            team,
          ) =>
            workspace.teamIds.includes(
              team.id,
            ),
        );

  const canCreate =
    workspace.role ===
      "admin" ||
    (
      workspace.role ===
        "team_lead" &&
      managerTeams.length >
        0
    );

  async function handleCreate() {
    if (
      !createForm.title.trim()
    ) {
      toast.error(
        "Task title is required.",
      );

      return;
    }

    if (
      !createForm.deadline
    ) {
      toast.error(
        "Choose a deadline.",
      );

      return;
    }

    if (
      createForm.assigneeIds.length ===
      0
    ) {
      toast.error(
        "Assign at least one person.",
      );

      return;
    }

    setSaving(
      true,
    );

    try {
      await create({
        data: {
          title:
            createForm.title,

          description:
            createForm.description,

          deadline:
            createForm.deadline,

          status:
            createForm.status,

          teamId:
            createForm.teamId ===
            "general"
              ? null
              : createForm.teamId,

          assigneeIds:
            createForm.assigneeIds,
        },
      });

      toast.success(
        "Task created",
      );

      setCreateOpen(
        false,
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleFullUpdate() {
    if (
      !selectedTask ||
      !editForm
    ) {
      return;
    }

    if (
      !editForm.title.trim()
    ) {
      toast.error(
        "Task title is required.",
      );

      return;
    }

    if (
      editForm.assigneeIds.length ===
      0
    ) {
      toast.error(
        "Assign at least one person.",
      );

      return;
    }

    setSaving(
      true,
    );

    try {
      await update({
        data: {
          taskId:
            selectedTask.id,

          title:
            editForm.title,

          description:
            editForm.description,

          deadline:
            editForm.deadline,

          status:
            editForm.status,

          teamId:
            editForm.teamId ===
            "general"
              ? null
              : editForm.teamId,

          assigneeIds:
            editForm.assigneeIds,
        },
      });

      toast.success(
        "Task updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleStatusUpdate() {
    if (
      !selectedTask ||
      !editForm
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await updateStatus({
        data: {
          taskId:
            selectedTask.id,

          status:
            editForm.status,
        },
      });

      toast.success(
        editForm.status ===
          "Done"
          ? "Task completed"
          : "Status updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update status.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleDelete() {
    if (
      !selectedTask
    ) {
      return;
    }

    if (
      !window.confirm(
        `Delete "${selectedTask.title}"?`,
      )
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await remove({
        data: {
          taskId:
            selectedTask.id,
        },
      });

      toast.success(
        "Task deleted",
      );

      setSelectedTaskId(
        null,
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not delete task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleLeadChange(
    person:
      TaskPerson,

    enabled:
      boolean,
  ) {
    if (
      enabled &&
      person.teamIds.length ===
        0
    ) {
      toast.error(
        "Assign this person to a team first.",
      );

      return;
    }

    setLeadBusyId(
      person.id,
    );

    try {
      await changeTeamLead({
        data: {
          userId:
            person.id,

          enabled,
        },
      });

      toast.success(
        enabled
          ? `${person.name} is now a Team Lead`
          : `${person.name} is now a User`,
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not change role.",
      );
    } finally {
      setLeadBusyId(
        null,
      );
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-24 md:pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Tasks
            </h1>

            <Badge
              variant="outline"
              className="rounded-full"
            >
              {roleLabel(
                workspace.role,
              )}
            </Badge>
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Team tasks, deadlines and ownership.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {workspace.role ===
            "admin" && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setTeamLeadsOpen(
                  true,
                )
              }
            >
              <ShieldCheck className="size-4" />
              Team Leads
            </Button>
          )}

          {canCreate && (
            <Button
              type="button"
              onClick={() => {
                setCreateForm(
                  defaultTaskForm(
                    workspace.role,
                    workspace.teamIds,
                  ),
                );

                setCreateOpen(
                  true,
                );
              }}
            >
              <Plus className="size-4" />
              New Task
            </Button>
          )}
        </div>
      </div>

      {workspace.role ===
        "team_lead" &&
        managerTeams.length ===
          0 && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />

              <p>
                You are a Team Lead, but you are not assigned to a team yet.
              </p>
            </div>
          </div>
        )}

      <Tabs
        value={tab}
        onValueChange={(
          value,
        ) =>
          setTab(
            value as TaskTab,
          )
        }
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="my">
            My Tasks
            <span className="ml-1 text-xs opacity-60">
              {myTasks.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="all">
            All Tasks
            <span className="ml-1 text-xs opacity-60">
              {allTasks.length}
            </span>
          </TabsTrigger>

          <TabsTrigger value="done">
            Done
            <span className="ml-1 text-xs opacity-60">
              {doneTasks.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="my"
          className="mt-4"
        >
          <TaskList
            tasks={
              myTasks
            }
            emptyTitle="No tasks assigned to you"
            emptyText="You're all caught up."
            onOpen={
              setSelectedTaskId
            }
          />
        </TabsContent>

        <TabsContent
          value="all"
          className="mt-4"
        >
          <TaskList
            tasks={
              allTasks
            }
            emptyTitle="No open tasks"
            emptyText="There are no active tasks in your workspace."
            onOpen={
              setSelectedTaskId
            }
          />
        </TabsContent>

        <TabsContent
          value="done"
          className="mt-4"
        >
          <TaskList
            tasks={
              doneTasks
            }
            emptyTitle="Nothing completed yet"
            emptyText="Completed tasks will appear here."
            onOpen={
              setSelectedTaskId
            }
          />
        </TabsContent>
      </Tabs>

      <Sheet
        open={
          createOpen
        }
        onOpenChange={
          setCreateOpen
        }
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              New Task
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6">
            <TaskForm
              value={
                createForm
              }
              onChange={
                setCreateForm
              }
              role={
                workspace.role
              }
              teams={
                managerTeams
              }
              people={
                workspace.people
              }
            />

            <Button
              type="button"
              className="mt-6 w-full"
              disabled={
                saving
              }
              onClick={() =>
                void handleCreate()
              }
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  Create Task
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={
          Boolean(
            selectedTask,
          )
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open
          ) {
            setSelectedTaskId(
              null,
            );
          }
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedTask &&
            editForm && (
              <>
                <SheetHeader>
                  <SheetTitle>
                    {selectedTask.title}
                  </SheetTitle>
                </SheetHeader>

                <div className="mt-5 space-y-6">
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Scope
                        </p>

                        <p className="mt-1 text-sm font-medium">
                          {selectedTask.teamName}
                        </p>
                      </div>

                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          statusClass(
                            selectedTask.status,
                          ),
                        )}
                      >
                        {selectedTask.status}
                      </Badge>
                    </div>

                    <p className="mt-4 text-xs text-muted-foreground">
                      Created by{" "}
                      {selectedTask.createdByName}
                    </p>
                  </div>

                  {selectedTask.canEditDetails ? (
                    <>
                      <TaskForm
                        value={
                          editForm
                        }
                        onChange={
                          setEditForm
                        }
                        role={
                          workspace.role
                        }
                        teams={
                          managerTeams
                        }
                        people={
                          workspace.people
                        }
                      />

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Button
                          type="button"
                          className="flex-1"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            void handleFullUpdate()
                          }
                        >
                          {saving ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Saving…
                            </>
                          ) : (
                            "Save Changes"
                          )}
                        </Button>

                        <Button
                          type="button"
                          variant="destructive"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            void handleDelete()
                          }
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      {selectedTask.description ? (
                        <div>
                          <Label>
                            Description
                          </Label>

                          <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm">
                            {selectedTask.description}
                          </p>
                        </div>
                      ) : null}

                      <div>
                        <Label>
                          Deadline
                        </Label>

                        <div className="mt-2 flex items-center gap-2 rounded-2xl bg-muted/50 p-4 text-sm">
                          <CalendarClock className="size-4 text-muted-foreground" />

                          {format(
                            parseISO(
                              selectedTask.deadline,
                            ),
                            "MMMM d, yyyy",
                          )}
                        </div>
                      </div>

                      <div>
                        <Label>
                          Assigned to
                        </Label>

                        <div className="mt-2 flex flex-wrap gap-2">
                          {selectedTask.assignees.map(
                            (
                              assignee,
                            ) => (
                              <Badge
                                key={
                                  assignee.id
                                }
                                variant="secondary"
                              >
                                {assignee.name}
                              </Badge>
                            ),
                          )}
                        </div>
                      </div>

                      {selectedTask.canEditStatus && (
                        <div className="space-y-3 border-t border-border pt-5">
                          <Label>
                            Status
                          </Label>

                          <Select
                            value={
                              editForm.status
                            }
                            onValueChange={(
                              value,
                            ) =>
                              setEditForm({
                                ...editForm,
                                status:
                                  value as TaskStatus,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>

                            <SelectContent>
                              {STATUSES.map(
                                (
                                  status,
                                ) => (
                                  <SelectItem
                                    key={
                                      status
                                    }
                                    value={
                                      status
                                    }
                                  >
                                    {status}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>

                          <Button
                            type="button"
                            className="w-full"
                            disabled={
                              saving ||
                              editForm.status ===
                                selectedTask.status
                            }
                            onClick={() =>
                              void handleStatusUpdate()
                            }
                          >
                            {saving
                              ? "Saving…"
                              : "Update Status"}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={
          teamLeadsOpen
        }
        onOpenChange={
          setTeamLeadsOpen
        }
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>
              Team Leads
            </SheetTitle>
          </SheetHeader>

          <p className="mt-3 text-sm text-muted-foreground">
            Team Leads can create and fully manage tasks for their own teams.
          </p>

          <div className="mt-6 space-y-2">
            {workspace.people
              .filter(
                (
                  person,
                ) =>
                  person.role !==
                  "admin",
              )
              .map(
                (
                  person,
                ) => {
                  const checked =
                    person.role ===
                    "team_lead";

                  const disabled =
                    leadBusyId ===
                      person.id ||
                    (
                      !checked &&
                      person.teamIds.length ===
                        0
                    );

                  return (
                    <label
                      key={
                        person.id
                      }
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border border-border p-4",
                        !disabled &&
                          "cursor-pointer hover:bg-muted/40",
                        disabled &&
                          "opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={
                          checked
                        }
                        disabled={
                          disabled
                        }
                        onCheckedChange={(
                          value,
                        ) =>
                          void handleLeadChange(
                            person,
                            value ===
                              true,
                          )
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {person.name}
                        </p>

                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {person.teamIds.length ===
                          0
                            ? "Assign a team first"
                            : person.teamIds
                                .map(
                                  (
                                    teamId,
                                  ) =>
                                    workspace.teams.find(
                                      (
                                        team,
                                      ) =>
                                        team.id ===
                                        teamId,
                                    )?.name,
                                )
                                .filter(
                                  Boolean,
                                )
                                .join(
                                  ", ",
                                )}
                        </p>
                      </div>

                      {leadBusyId ===
                        person.id && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                    </label>
                  );
                },
              )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TaskList({
  tasks,
  emptyTitle,
  emptyText,
  onOpen,
}: {
  tasks: TaskItem[];
  emptyTitle: string;
  emptyText: string;
  onOpen: (id: string) => void;
}) {
  if (
    tasks.length ===
    0
  ) {
    return (
      <div className="surface-card py-12 text-center">
        <ClipboardList className="mx-auto size-8 text-muted-foreground" />

        <p className="mt-3 font-medium">
          {emptyTitle}
        </p>

        <p className="mt-1 text-sm text-muted-foreground">
          {emptyText}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {tasks.map(
        (
          task,
        ) => (
          <TaskCard
            key={
              task.id
            }
            task={
              task
            }
            onClick={() =>
              onOpen(
                task.id,
              )
            }
          />
        ),
      )}
    </div>
  );
}

function TaskCard({
  task,
  onClick,
}: {
  task: TaskItem;
  onClick: () => void;
}) {
  const deadline =
    deadlineInfo(
      task.deadline,
      task.status,
    );

  return (
    <Card
      role="button"
      tabIndex={0}
      className="surface-card cursor-pointer transition-colors hover:bg-muted/30"
      onClick={
        onClick
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
          onClick();
        }
      }}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words font-semibold">
              {task.title}
            </h2>

            <p className="mt-1 text-xs text-muted-foreground">
              {task.teamName}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full",
                statusClass(
                  task.status,
                ),
              )}
            >
              {task.status}
            </Badge>

            <p
              className={cn(
                "mt-2 whitespace-nowrap text-xs",
                deadline.className,
              )}
            >
              {deadline.text}
            </p>
          </div>
        </div>

        {task.description && (
          <p className="mt-4 line-clamp-2 text-sm text-muted-foreground">
            {task.description}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Users className="size-4 shrink-0 text-muted-foreground" />

          {task.assignees.map(
            (
              assignee,
            ) => (
              <Badge
                key={
                  assignee.id
                }
                variant="secondary"
                className="rounded-full"
              >
                {assignee.name}
              </Badge>
            ),
          )}

          {task.status ===
            "Done" && (
            <CheckCircle2 className="ml-auto size-4 text-success" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskForm({
  value,
  onChange,
  role,
  teams,
  people,
}: {
  value: TaskFormValue;
  onChange: (value: TaskFormValue) => void;
  role: TaskRole;
  teams: {
    id: string;
    name: string;
  }[];
  people: TaskPerson[];
}) {
  const eligiblePeople =
    value.teamId ===
    "general"
      ? people
      : people.filter(
          (
            person,
          ) =>
            person.teamIds.includes(
              value.teamId,
            ),
        );

  function changeScope(
    teamId:
      string,
  ) {
    const allowed =
      new Set(
        (
          teamId ===
          "general"
            ? people
            : people.filter(
                (
                  person,
                ) =>
                  person.teamIds.includes(
                    teamId,
                  ),
              )
        ).map(
          (
            person,
          ) =>
            person.id,
        ),
      );

    onChange({
      ...value,

      teamId,

      assigneeIds:
        value.assigneeIds.filter(
          (
            userId,
          ) =>
            allowed.has(
              userId,
            ),
        ),
    });
  }

  function togglePerson(
    userId:
      string,

    enabled:
      boolean,
  ) {
    onChange({
      ...value,

      assigneeIds:
        enabled
          ? Array.from(
              new Set([
                ...value.assigneeIds,
                userId,
              ]),
            )
          : value.assigneeIds.filter(
              (
                id,
              ) =>
                id !==
                userId,
            ),
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>
          Title
        </Label>

        <Input
          maxLength={
            120
          }
          placeholder="Prepare kickoff presentation"
          value={
            value.title
          }
          onChange={(
            event,
          ) =>
            onChange({
              ...value,
              title:
                event.target.value,
            })
          }
        />
      </div>

      <div className="space-y-2">
        <Label>
          Description
        </Label>

        <Textarea
          rows={5}
          maxLength={
            2000
          }
          className="resize-none rounded-2xl"
          placeholder="Add details, requirements or useful links…"
          value={
            value.description
          }
          onChange={(
            event,
          ) =>
            onChange({
              ...value,
              description:
                event.target.value,
            })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Deadline
          </Label>

          <Input
            type="date"
            value={
              value.deadline
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...value,
                deadline:
                  event.target.value,
              })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>
            Status
          </Label>

          <Select
            value={
              value.status
            }
            onValueChange={(
              status,
            ) =>
              onChange({
                ...value,
                status:
                  status as TaskStatus,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {STATUSES.map(
                (
                  status,
                ) => (
                  <SelectItem
                    key={
                      status
                    }
                    value={
                      status
                    }
                  >
                    {status}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>
          Scope
        </Label>

        <Select
          value={
            value.teamId
          }
          onValueChange={
            changeScope
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            {role ===
              "admin" && (
              <SelectItem value="general">
                General — everyone
              </SelectItem>
            )}

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
                  {team.name}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label>
            Assigned people
          </Label>

          <span className="text-xs text-muted-foreground">
            {value.assigneeIds.length} selected
          </span>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
          {eligiblePeople.length ===
          0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No people are available for this scope.
            </p>
          ) : (
            eligiblePeople.map(
              (
                person,
              ) => {
                const checked =
                  value.assigneeIds.includes(
                    person.id,
                  );

                return (
                  <label
                    key={
                      person.id
                    }
                    className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted"
                  >
                    <Checkbox
                      checked={
                        checked
                      }
                      onCheckedChange={(
                        enabled,
                      ) =>
                        togglePerson(
                          person.id,
                          enabled ===
                            true,
                        )
                      }
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {person.name}
                      </p>

                      {person.role ===
                        "team_lead" && (
                        <p className="text-xs text-primary">
                          Team Lead
                        </p>
                      )}
                    </div>
                  </label>
                );
              },
            )
          )}
        </div>
      </div>
    </div>
  );
}