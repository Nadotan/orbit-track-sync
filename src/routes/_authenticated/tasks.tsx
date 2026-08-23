import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
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
  Archive,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  FolderKanban,
  FolderPlus,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  addWorkUpdate,
  archiveProject,
  archiveTask,
  createProject,
  createTask,
  deleteTask,
  duplicateTask,
  getTasksWorkspace,
  setTeamLeadRole,
  updateProject,
  updateProjectStatus,
  updateTask,
  updateTaskStatus,
} from "@/lib/tasks.functions";
import { syncGoogleSheetsNow } from "@/lib/google-sheets.functions";
import type {
  TaskItem,
  TaskPerson,
  TaskPriority,
  TaskProject,
  TaskRole,
  TaskStatus,
  TasksWorkspace,
  WorkUpdate,
} from "@/lib/tasks.functions";
import { formatDateTime, formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/tasks")({
  validateSearch: (search: Record<string, unknown>) => ({
    project: typeof search.project === "string" ? search.project : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Tasks — POM" },
      {
        name: "description",
        content: "POM projects, tasks and assignments.",
      },
    ],
  }),
  component: TasksPage,
});

type TaskTab = "my" | "team" | "all" | "done";
type DeadlineFilter = "all" | "overdue" | "today" | "soon" | "later";

interface TaskFormValue {
  title: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  blockedReason: string;
  projectId: string;
  teamId: string;
  assigneeIds: string[];
}

interface ProjectFormValue {
  name: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  blockedReason: string;
  teamId: string;
}

interface QuickSubtaskInput {
  title: string;
  assigneeId: string;
  deadline: string;
}

interface ProjectActivityItem extends WorkUpdate {
  context: string;
}

const STATUSES: TaskStatus[] = ["To Do", "In Progress", "Blocked", "Done"];
const PRIORITIES: TaskPriority[] = ["Low", "Medium", "High", "Critical"];

function defaultTaskForm(
  role: TaskRole,
  teamIds: string[],
  currentUserId: string,
): TaskFormValue {
  return {
    title: "",
    description: "",
    deadline: format(addDays(new Date(), 7), "yyyy-MM-dd"),
    status: "To Do",
    priority: "Medium",
    ownerId: currentUserId,
    blockedReason: "",
    projectId: "none",
    teamId: role === "admin" ? "general" : teamIds[0] ?? "",
    assigneeIds: [],
  };
}

function defaultProjectForm(
  role: TaskRole,
  teamIds: string[],
  currentUserId: string,
): ProjectFormValue {
  return {
    name: "",
    description: "",
    deadline: "",
    status: "To Do",
    priority: "Medium",
    ownerId: currentUserId,
    blockedReason: "",
    teamId: role === "admin" ? "general" : teamIds[0] ?? "",
  };
}

function taskToForm(task: TaskItem): TaskFormValue {
  return {
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    status: task.status,
    priority: task.priority,
    ownerId: task.ownerId,
    blockedReason: task.blockedReason,
    projectId: task.projectId ?? "none",
    teamId: task.teamId ?? "general",
    assigneeIds: task.assignees.map((assignee) => assignee.id),
  };
}

function projectToForm(project: TaskProject): ProjectFormValue {
  return {
    name: project.name,
    description: project.description,
    deadline: project.deadline ?? "",
    status: project.status,
    priority: project.priority,
    ownerId: project.ownerId,
    blockedReason: project.blockedReason,
    teamId: project.teamId ?? "general",
  };
}

function statusClass(status: TaskStatus) {
  if (status === "Done") {
    return "border-success/30 bg-success/10 text-success";
  }

  if (status === "Blocked") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (status === "In Progress") {
    return "border-primary/30 bg-primary/10 text-primary";
  }

  return "border-border bg-muted text-muted-foreground";
}

function priorityClass(priority: TaskPriority) {
  if (priority === "Critical") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (priority === "High") {
    return "border-warning/30 bg-warning/10 text-warning";
  }

  if (priority === "Low") {
    return "border-border bg-muted text-muted-foreground";
  }

  return "border-primary/20 bg-primary/5 text-primary";
}

function deadlineDays(deadline: string) {
  return differenceInCalendarDays(
    parseISO(deadline),
    startOfDay(new Date()),
  );
}

function shortDeadlineDate(deadline: string) {
  const date = parseISO(deadline);

  const pattern =
    date.getFullYear() === new Date().getFullYear()
      ? "MMM d"
      : "MMM d, yyyy";

  return format(date, pattern);
}

function deadlineInfo(deadline: string, status: TaskStatus) {
  const exactDate = shortDeadlineDate(deadline);
  const days = deadlineDays(deadline);

  if (status === "Done") {
    return {
      text: `Due ${exactDate}`,
      className: "text-muted-foreground",
    };
  }

  if (days < 0) {
    const overdue = Math.abs(days);

    return {
      text: `${exactDate} · ${overdue} day${overdue === 1 ? "" : "s"} overdue`,
      className: "font-medium text-destructive",
    };
  }

  if (days === 0) {
    return {
      text: `${exactDate} · Due today`,
      className: "font-medium text-warning",
    };
  }

  if (days === 1) {
    return {
      text: `${exactDate} · Due tomorrow`,
      className: "font-medium text-warning",
    };
  }

  return {
    text: `${exactDate} · ${days} days left`,
    className: "text-muted-foreground",
  };
}

function optionalDeadlineInfo(
  deadline: string | null,
  status: TaskStatus,
) {
  if (!deadline) {
    return {
      text: "No deadline",
      className: "text-muted-foreground",
    };
  }

  return deadlineInfo(deadline, status);
}

function smartTaskRank(task: TaskItem) {
  const days = deadlineDays(task.deadline);

  if (task.status !== "Done" && days < 0) return 0;
  if (task.priority === "Critical") return 1;
  if (task.status === "Blocked") return 2;
  if (task.status !== "Done" && days >= 0 && days <= 7) return 3;

  return 4;
}

function smartSortTasks(tasks: TaskItem[]) {
  return [...tasks].sort((a, b) => {
    const rankDifference =
      smartTaskRank(a) -
      smartTaskRank(b);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    const deadlineDifference =
      parseISO(a.deadline).getTime() -
      parseISO(b.deadline).getTime();

    if (deadlineDifference !== 0) {
      return deadlineDifference;
    }

    return a.title.localeCompare(b.title);
  });
}

function sortProjectTasks(tasks: TaskItem[]) {
  const open = smartSortTasks(
    tasks.filter(
      (task) =>
        task.status !== "Done",
    ),
  );

  const done = [...tasks]
    .filter(
      (task) =>
        task.status === "Done",
    )
    .sort((a, b) => {
      const deadlineDifference =
        parseISO(a.deadline).getTime() -
        parseISO(b.deadline).getTime();

      if (deadlineDifference !== 0) {
        return deadlineDifference;
      }

      return a.title.localeCompare(
        b.title,
      );
    });

  return [...open, ...done];
}

function roleLabel(role: TaskRole) {
  if (role === "admin") return "Admin";
  if (role === "team_lead") return "Team Lead";

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

  const archive =
    useServerFn(
      archiveTask,
    );

  const duplicate =
    useServerFn(
      duplicateTask,
    );

  const remove =
    useServerFn(
      deleteTask,
    );

  const createNewProject =
    useServerFn(
      createProject,
    );

  const saveProject =
    useServerFn(
      updateProject,
    );

  const saveProjectStatus =
    useServerFn(
      updateProjectStatus,
    );

  const archiveExistingProject =
    useServerFn(
      archiveProject,
    );

  const addUpdate =
    useServerFn(
      addWorkUpdate,
    );

  const changeTeamLead =
    useServerFn(
      setTeamLeadRole,
    );

  const syncSheets =
    useServerFn(
      syncGoogleSheetsNow,
    );

  const navigate =
    Route.useNavigate();

  const {
    project:
      projectPageId,
  } =
    Route.useSearch();

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
    syncingSheets,
    setSyncingSheets,
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
    createProjectOpen,
    setCreateProjectOpen,
  ] =
    useState(
      false,
    );

  const [
    projectEditOpen,
    setProjectEditOpen,
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
        "",
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
    projectForm,
    setProjectForm,
  ] =
    useState<ProjectFormValue>(
      defaultProjectForm(
        "user",
        [],
        "",
      ),
    );

  const [
    projectEditForm,
    setProjectEditForm,
  ] =
    useState<ProjectFormValue | null>(
      null,
    );

  const [
    leadBusyId,
    setLeadBusyId,
  ] =
    useState<string | null>(
      null,
    );

  const [
    search,
    setSearch,
  ] =
    useState(
      "",
    );

  const [
    filtersOpen,
    setFiltersOpen,
  ] =
    useState(
      false,
    );

  const [
    teamFilter,
    setTeamFilter,
  ] =
    useState(
      "all",
    );

  const [
    projectFilter,
    setProjectFilter,
  ] =
    useState(
      "all",
    );

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState(
      "all",
    );

  const [
    priorityFilter,
    setPriorityFilter,
  ] =
    useState(
      "all",
    );

  const [
    ownerFilter,
    setOwnerFilter,
  ] =
    useState(
      "all",
    );

  const [
    assigneeFilter,
    setAssigneeFilter,
  ] =
    useState(
      "all",
    );

  const [
    deadlineFilter,
    setDeadlineFilter,
  ] =
    useState<DeadlineFilter>(
      "all",
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
        } catch (error) {
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

  useEffect(
    () => {
      void load();
    },
    [
      load,
    ],
  );

  useEffect(
    () => {
      if (
        !workspace
      ) {
        return;
      }

      setCreateForm(
        defaultTaskForm(
          workspace.role,
          workspace.teamIds,
          workspace.currentUserId,
        ),
      );

      setProjectForm(
        defaultProjectForm(
          workspace.role,
          workspace.teamIds,
          workspace.currentUserId,
        ),
      );
    },
    [
      workspace?.role,
      workspace?.currentUserId,
      workspace?.teamIds.join(
        ",",
      ),
    ],
  );

  const selectedTask =
    workspace?.tasks.find(
      (task) =>
        task.id ===
        selectedTaskId,
    ) ??
    null;

  const selectedProject =
    workspace?.projects.find(
      (project) =>
        project.id ===
        projectPageId,
    ) ??
    null;

  useEffect(
    () => {
      setEditForm(
        selectedTask
          ? taskToForm(
              selectedTask,
            )
          : null,
      );
    },
    [
      selectedTask?.id,
      selectedTask?.updatedAt,
    ],
  );

  useEffect(
    () => {
      setProjectEditForm(
        selectedProject
          ? projectToForm(
              selectedProject,
            )
          : null,
      );

      setProjectEditOpen(
        false,
      );
    },
    [
      selectedProject?.id,
      selectedProject?.updatedAt,
    ],
  );

  const openTasks =
    useMemo(
      () =>
        (
          workspace?.tasks ??
          []
        ).filter(
          (task) =>
            task.status !==
            "Done",
        ),
      [
        workspace,
      ],
    );

  const myTasks =
    useMemo(
      () =>
        openTasks.filter(
          (task) =>
            task.ownerId ===
              workspace?.currentUserId ||
            task.assignees.some(
              (
                assignee,
              ) =>
                assignee.id ===
                workspace?.currentUserId,
            ),
        ),
      [
        openTasks,
        workspace?.currentUserId,
      ],
    );

  const teamTasks =
    useMemo(
      () =>
        openTasks.filter(
          (task) =>
            task.teamId !==
              null &&
            (
              workspace?.teamIds ??
              []
            ).includes(
              task.teamId,
            ),
        ),
      [
        openTasks,
        workspace?.teamIds,
      ],
    );

  const allTasks =
    openTasks;

  const doneTasks =
    useMemo(
      () =>
        (
          workspace?.tasks ??
          []
        ).filter(
          (task) =>
            task.status ===
            "Done",
        ),
      [
        workspace,
      ],
    );

  const summary =
    useMemo(
      () => {
        let dueSoon =
          0;

        let overdue =
          0;

        let blocked =
          0;

        for (
          const task
          of openTasks
        ) {
          const days =
            deadlineDays(
              task.deadline,
            );

          if (
            days <
            0
          ) {
            overdue +=
              1;
          } else if (
            days <=
            7
          ) {
            dueSoon +=
              1;
          }

          if (
            task.status ===
            "Blocked"
          ) {
            blocked +=
              1;
          }
        }

        return {
          open:
            openTasks.length,
          dueSoon,
          overdue,
          blocked,
        };
      },
      [
        openTasks,
      ],
    );

  const currentTabTasks =
    useMemo(
      () => {
        if (
          tab ===
          "my"
        ) {
          return myTasks;
        }

        if (
          tab ===
          "team"
        ) {
          return teamTasks;
        }

        if (
          tab ===
          "done"
        ) {
          return doneTasks;
        }

        return allTasks;
      },
      [
        tab,
        myTasks,
        teamTasks,
        allTasks,
        doneTasks,
      ],
    );

  const filteredTasks =
    useMemo(
      () => {
        const query =
          search
            .trim()
            .toLowerCase();

        const result =
          currentTabTasks.filter(
            (
              task,
            ) => {
              if (
                query
              ) {
                const haystack =
                  [
                    task.title,
                    task.description,
                    task.teamName,
                    task.projectName ??
                      "",
                    task.ownerName,
                    ...task.assignees.map(
                      (
                        assignee,
                      ) =>
                        assignee.name,
                    ),
                    ...task.updates
                      .slice(
                        0,
                        10,
                      )
                      .map(
                        (
                          update,
                        ) =>
                          update.body,
                      ),
                  ]
                    .join(
                      " ",
                    )
                    .toLowerCase();

                if (
                  !haystack.includes(
                    query,
                  )
                ) {
                  return false;
                }
              }

              if (
                teamFilter !==
                "all"
              ) {
                if (
                  teamFilter ===
                  "general"
                ) {
                  if (
                    task.teamId !==
                    null
                  ) {
                    return false;
                  }
                } else if (
                  task.teamId !==
                  teamFilter
                ) {
                  return false;
                }
              }

              if (
                projectFilter !==
                "all"
              ) {
                if (
                  projectFilter ===
                  "none"
                ) {
                  if (
                    task.projectId !==
                    null
                  ) {
                    return false;
                  }
                } else if (
                  task.projectId !==
                  projectFilter
                ) {
                  return false;
                }
              }

              if (
                statusFilter !==
                  "all" &&
                task.status !==
                  statusFilter
              ) {
                return false;
              }

              if (
                priorityFilter !==
                  "all" &&
                task.priority !==
                  priorityFilter
              ) {
                return false;
              }

              if (
                ownerFilter !==
                  "all" &&
                task.ownerId !==
                  ownerFilter
              ) {
                return false;
              }

              if (
                assigneeFilter !==
                  "all" &&
                !task.assignees.some(
                  (
                    assignee,
                  ) =>
                    assignee.id ===
                    assigneeFilter,
                )
              ) {
                return false;
              }

              if (
                deadlineFilter !==
                "all"
              ) {
                const days =
                  deadlineDays(
                    task.deadline,
                  );

                if (
                  deadlineFilter ===
                    "overdue" &&
                  days >=
                    0
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "today" &&
                  days !==
                    0
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "soon" &&
                  (
                    days <
                      0 ||
                    days >
                      7
                  )
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "later" &&
                  days <=
                    7
                ) {
                  return false;
                }
              }

              return true;
            },
          );

        return smartSortTasks(
          result,
        );
      },
      [
        currentTabTasks,
        search,
        teamFilter,
        projectFilter,
        statusFilter,
        priorityFilter,
        ownerFilter,
        assigneeFilter,
        deadlineFilter,
      ],
    );

  const activeFilterCount =
    [
      teamFilter,
      projectFilter,
      statusFilter,
      priorityFilter,
      ownerFilter,
      assigneeFilter,
      deadlineFilter,
    ].filter(
      (
        value,
      ) =>
        value !==
        "all",
    ).length;

  function clearFilters() {
    setSearch(
      "",
    );

    setTeamFilter(
      "all",
    );

    setProjectFilter(
      "all",
    );

    setStatusFilter(
      "all",
    );

    setPriorityFilter(
      "all",
    );

    setOwnerFilter(
      "all",
    );

    setAssigneeFilter(
      "all",
    );

    setDeadlineFilter(
      "all",
    );
  }

  function openProject(
    projectId:
      string,
  ) {
    setProjectEditOpen(
      false,
    );

    void navigate({
      search:
        (
          previous,
        ) => ({
          ...previous,
          project:
            projectId,
        }),
    });
  }

  function closeProjectPage() {
    setSelectedTaskId(
      null,
    );

    setProjectEditOpen(
      false,
    );

    void navigate({
      search:
        (
          previous,
        ) => ({
          ...previous,
          project:
            undefined,
        }),
    });
  }

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

  const filteredProject =
    projectFilter !==
      "all" &&
    projectFilter !==
      "none"
      ? workspace.projects.find(
          (
            project,
          ) =>
            project.id ===
            projectFilter,
        ) ??
        null
      : null;

  function confirmProjectCompletion(
    nextStatus:
      TaskStatus,
  ) {
    if (
      !selectedProject ||
      nextStatus !==
        "Done" ||
      selectedProject.status ===
        "Done"
    ) {
      return true;
    }

    const incompleteCount =
      workspace.tasks.filter(
        (
          task,
        ) =>
          task.projectId ===
            selectedProject.id &&
          task.status !==
            "Done",
      ).length;

    if (
      incompleteCount ===
      0
    ) {
      return true;
    }

    return window.confirm(
      `${incompleteCount} subtask${incompleteCount === 1 ? " is" : "s are"} still incomplete. Mark this project Done anyway?`,
    );
  }

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
      !createForm.ownerId
    ) {
      toast.error(
        "Choose an owner.",
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

    if (
      createForm.status ===
        "Blocked" &&
      !createForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked task.",
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

          priority:
            createForm.priority,

          ownerId:
            createForm.ownerId,

          blockedReason:
            createForm.blockedReason,

          projectId:
            createForm.projectId ===
            "none"
              ? null
              : createForm.projectId,

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
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not create task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleQuickSubtaskCreate(
    input:
      QuickSubtaskInput,
  ) {
    if (
      !selectedProject
    ) {
      throw new Error(
        "Project not found.",
      );
    }

    await create({
      data: {
        title:
          input.title,

        description:
          "",

        deadline:
          input.deadline,

        status:
          "To Do",

        priority:
          "Medium",

        ownerId:
          input.assigneeId,

        blockedReason:
          "",

        projectId:
          selectedProject.id,

        teamId:
          selectedProject.teamId,

        assigneeIds: [
          input.assigneeId,
        ],
      },
    });

    await load();
  }

  async function handleCreateProject() {
    if (
      !projectForm.name.trim()
    ) {
      toast.error(
        "Project name is required.",
      );

      return;
    }

    if (
      !projectForm.ownerId
    ) {
      toast.error(
        "Choose a project owner.",
      );

      return;
    }

    if (
      !projectForm.teamId
    ) {
      toast.error(
        "Choose a project scope.",
      );

      return;
    }

    if (
      projectForm.status ===
        "Blocked" &&
      !projectForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked project.",
      );

      return;
    }

    setSaving(
      true,
    );

    try {
      const result =
        await createNewProject({
          data: {
            name:
              projectForm.name,

            description:
              projectForm.description,

            deadline:
              projectForm.deadline ||
              null,

            status:
              projectForm.status,

            priority:
              projectForm.priority,

            ownerId:
              projectForm.ownerId,

            blockedReason:
              projectForm.blockedReason,

            teamId:
              projectForm.teamId ===
              "general"
                ? null
                : projectForm.teamId,
          },
        });

      toast.success(
        "Project created",
      );

      setCreateProjectOpen(
        false,
      );

      await load();

      openProject(
        result.id,
      );
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not create project.",
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
      !editForm.ownerId
    ) {
      toast.error(
        "Choose an owner.",
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

    if (
      editForm.status ===
        "Blocked" &&
      !editForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked task.",
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

          priority:
            editForm.priority,

          ownerId:
            editForm.ownerId,

          blockedReason:
            editForm.blockedReason,

          projectId:
            editForm.projectId ===
            "none"
              ? null
              : editForm.projectId,

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
    } catch (error) {
      toast.error(
        error instanceof
          Error
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

    if (
      editForm.status ===
        "Blocked" &&
      !editForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked task.",
      );

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

          blockedReason:
            editForm.blockedReason,
        },
      });

      toast.success(
        editForm.status ===
          "Done"
          ? "Task completed"
          : "Status updated",
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update status.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleArchive() {
    if (
      !selectedTask
    ) {
      return;
    }

    if (
      !window.confirm(
        `Archive "${selectedTask.title}"?`,
      )
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await archive({
        data: {
          taskId:
            selectedTask.id,
        },
      });

      toast.success(
        "Task archived",
      );

      setSelectedTaskId(
        null,
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not archive task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleDuplicate() {
    if (
      !selectedTask
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await duplicate({
        data: {
          taskId:
            selectedTask.id,
        },
      });

      toast.success(
        "Task duplicated",
      );

      setSelectedTaskId(
        null,
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not duplicate task.",
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
        `Delete "${selectedTask.title}" from POM? It will stay in Google Sheets as a historical Deleted task.`,
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
        "Task deleted from POM and kept in Google Sheets",
      );

      setSelectedTaskId(
        null,
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not delete task.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleProjectUpdate() {
    if (
      !selectedProject ||
      !projectEditForm
    ) {
      return;
    }

    if (
      !projectEditForm.name.trim()
    ) {
      toast.error(
        "Project name is required.",
      );

      return;
    }

    if (
      !projectEditForm.ownerId
    ) {
      toast.error(
        "Choose a project owner.",
      );

      return;
    }

    if (
      projectEditForm.status ===
        "Blocked" &&
      !projectEditForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked project.",
      );

      return;
    }

    if (
      !confirmProjectCompletion(
        projectEditForm.status,
      )
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await saveProject({
        data: {
          projectId:
            selectedProject.id,

          name:
            projectEditForm.name,

          description:
            projectEditForm.description,

          deadline:
            projectEditForm.deadline ||
            null,

          status:
            projectEditForm.status,

          priority:
            projectEditForm.priority,

          ownerId:
            projectEditForm.ownerId,

          blockedReason:
            projectEditForm.blockedReason,

          teamId:
            projectEditForm.teamId ===
            "general"
              ? null
              : projectEditForm.teamId,
        },
      });

      toast.success(
        "Project updated",
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update project.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleProjectStatusUpdate() {
    if (
      !selectedProject ||
      !projectEditForm
    ) {
      return;
    }

    if (
      projectEditForm.status ===
        "Blocked" &&
      !projectEditForm.blockedReason.trim()
    ) {
      toast.error(
        "Add a reason for the blocked project.",
      );

      return;
    }

    if (
      !confirmProjectCompletion(
        projectEditForm.status,
      )
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await saveProjectStatus({
        data: {
          projectId:
            selectedProject.id,

          status:
            projectEditForm.status,

          blockedReason:
            projectEditForm.blockedReason,
        },
      });

      toast.success(
        "Project status updated",
      );

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update project status.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleProjectArchive() {
    if (
      !selectedProject
    ) {
      return;
    }

    if (
      !window.confirm(
        `Archive "${selectedProject.name}"?`,
      )
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await archiveExistingProject({
        data: {
          projectId:
            selectedProject.id,
        },
      });

      toast.success(
        "Project archived",
      );

      setProjectFilter(
        "all",
      );

      closeProjectPage();

      await load();
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not archive project.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  async function handleAddTaskUpdate(
    body:
      string,
  ) {
    if (
      !selectedTask
    ) {
      return;
    }

    await addUpdate({
      data: {
        taskId:
          selectedTask.id,

        projectId:
          null,

        body,
      },
    });

    await load();
  }

  async function handleAddProjectUpdate(
    body:
      string,
  ) {
    if (
      !selectedProject
    ) {
      return;
    }

    await addUpdate({
      data: {
        taskId:
          null,

        projectId:
          selectedProject.id,

        body,
      },
    });

    await load();
  }

  async function handleGoogleSheetsSync() {
    if (
      workspace.role !==
        "admin" ||
      syncingSheets
    ) {
      return;
    }

    setSyncingSheets(
      true,
    );

    try {
      const result =
        await syncSheets();

      toast.success(
        `Google Sheets synced — ${result.projects} projects, ${result.tasks} tasks, ${result.updates} updates`,
      );
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not sync Google Sheets.",
      );
    } finally {
      setSyncingSheets(
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
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not change role.",
      );
    } finally {
      setLeadBusyId(
        null,
      );
    }
  }

  const projectPageTasks =
    selectedProject
      ? workspace.tasks.filter(
          (
            task,
          ) =>
            task.projectId ===
            selectedProject.id,
        )
      : [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-24 md:pb-8">
      {projectPageId ? (
        selectedProject ? (
          <ProjectWorkspaceView
            project={
              selectedProject
            }
            tasks={
              projectPageTasks
            }
            people={
              workspace.people
            }
            onBack={
              closeProjectPage
            }
            onEdit={() =>
              setProjectEditOpen(
                true,
              )
            }
            onOpenTask={
              setSelectedTaskId
            }
            onCreateSubtask={
              handleQuickSubtaskCreate
            }
            onAddUpdate={
              handleAddProjectUpdate
            }
          />
        ) : (
          <ProjectNotFound
            onBack={
              closeProjectPage
            }
          />
        )
      ) : (
        <>
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
                Projects are parent work items with their own owner, status,
                priority, optional deadline and subtasks.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {workspace.role ===
                "admin" && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      syncingSheets
                    }
                    onClick={() =>
                      void handleGoogleSheetsSync()
                    }
                  >
                    <RefreshCw
                      className={cn(
                        "size-4",
                        syncingSheets &&
                          "animate-spin",
                      )}
                    />

                    {syncingSheets
                      ? "Syncing…"
                      : "Sync Sheets"}
                  </Button>

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
                </>
              )}

              {canCreate && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setProjectForm(
                        defaultProjectForm(
                          workspace.role,
                          workspace.teamIds,
                          workspace.currentUserId,
                        ),
                      );

                      setCreateProjectOpen(
                        true,
                      );
                    }}
                  >
                    <FolderPlus className="size-4" />
                    New Project
                  </Button>

                  <Button
                    type="button"
                    onClick={() => {
                      setCreateForm(
                        defaultTaskForm(
                          workspace.role,
                          workspace.teamIds,
                          workspace.currentUserId,
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
                </>
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard
              label="Open"
              value={
                summary.open
              }
            />

            <SummaryCard
              label="Due Soon"
              value={
                summary.dueSoon
              }
            />

            <SummaryCard
              label="Overdue"
              value={
                summary.overdue
              }
              danger={
                summary.overdue >
                0
              }
            />

            <SummaryCard
              label="Blocked"
              value={
                summary.blocked
              }
              danger={
                summary.blocked >
                0
              }
            />
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <FolderKanban className="size-4 text-primary" />
                Projects
              </h2>

              <p className="mt-1 text-xs text-muted-foreground">
                Open a project to see its details, progress, updates and
                subtasks.
              </p>
            </div>

            {workspace.projects.length ===
            0 ? (
              <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No projects yet. Tasks can still exist without a project.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {workspace.projects.map(
                  (
                    project,
                  ) => {
                    const projectTasks =
                      workspace.tasks.filter(
                        (
                          task,
                        ) =>
                          task.projectId ===
                          project.id,
                      );

                    const doneCount =
                      projectTasks.filter(
                        (
                          task,
                        ) =>
                          task.status ===
                          "Done",
                      ).length;

                    const progress =
                      projectTasks.length ===
                      0
                        ? 0
                        : Math.round(
                            (
                              doneCount /
                              projectTasks.length
                            ) *
                              100,
                          );

                    const deadline =
                      optionalDeadlineInfo(
                        project.deadline,
                        project.status,
                      );

                    return (
                      <button
                        key={
                          project.id
                        }
                        type="button"
                        className="surface-card rounded-xl border border-border px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
                        onClick={() =>
                          openProject(
                            project.id,
                          )
                        }
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {
                                project.name
                              }
                            </p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span className="inline-flex items-center gap-1">
                                <UserRound className="size-3" />
                                {
                                  project.ownerName
                                }
                              </span>

                              <span
                                className={cn(
                                  "inline-flex items-center gap-1",
                                  deadline.className,
                                )}
                              >
                                <CalendarClock className="size-3" />
                                {
                                  deadline.text
                                }
                              </span>

                              <span>
                                {
                                  doneCount
                                }
                                /
                                {
                                  projectTasks.length
                                }{" "}
                                subtasks
                              </span>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full px-2 py-0 text-[10px]",
                                priorityClass(
                                  project.priority,
                                ),
                              )}
                            >
                              {
                                project.priority
                              }
                            </Badge>

                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full px-2 py-0 text-[10px]",
                                statusClass(
                                  project.status,
                                ),
                              )}
                            >
                              {
                                project.status
                              }
                            </Badge>
                          </div>
                        </div>

                        {projectTasks.length >
                          0 && (
                          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width]"
                              style={{
                                width: `${progress}%`,
                              }}
                            />
                          </div>
                        )}
                      </button>
                    );
                  },
                )}
              </div>
            )}
          </section>

          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  className="pl-9"
                  placeholder="Search tasks and updates…"
                  value={
                    search
                  }
                  onChange={(
                    event,
                  ) =>
                    setSearch(
                      event.target.value,
                    )
                  }
                />
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setFiltersOpen(
                    (
                      current,
                    ) =>
                      !current,
                  )
                }
              >
                <SlidersHorizontal className="size-4" />

                Filters

                {activeFilterCount >
                  0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 rounded-full px-1.5"
                  >
                    {
                      activeFilterCount
                    }
                  </Badge>
                )}
              </Button>

              {(activeFilterCount >
                0 ||
                search) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={
                    clearFilters
                  }
                >
                  Clear
                </Button>
              )}
            </div>

            {filtersOpen && (
              <div className="surface-card grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-4">
                <FilterSelect
                  label="Team"
                  value={
                    teamFilter
                  }
                  onChange={
                    setTeamFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All teams",
                    },
                    {
                      value:
                        "general",
                      label:
                        "General",
                    },
                    ...workspace.teams.map(
                      (
                        team,
                      ) => ({
                        value:
                          team.id,
                        label:
                          team.name,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Project"
                  value={
                    projectFilter
                  }
                  onChange={
                    setProjectFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All projects",
                    },
                    {
                      value:
                        "none",
                      label:
                        "No project",
                    },
                    ...workspace.projects.map(
                      (
                        project,
                      ) => ({
                        value:
                          project.id,
                        label:
                          project.name,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Status"
                  value={
                    statusFilter
                  }
                  onChange={
                    setStatusFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All statuses",
                    },
                    ...STATUSES.map(
                      (
                        status,
                      ) => ({
                        value:
                          status,
                        label:
                          status,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Priority"
                  value={
                    priorityFilter
                  }
                  onChange={
                    setPriorityFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All priorities",
                    },
                    ...PRIORITIES.map(
                      (
                        priority,
                      ) => ({
                        value:
                          priority,
                        label:
                          priority,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Owner"
                  value={
                    ownerFilter
                  }
                  onChange={
                    setOwnerFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All owners",
                    },
                    ...workspace.people.map(
                      (
                        person,
                      ) => ({
                        value:
                          person.id,
                        label:
                          person.name,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Assignee"
                  value={
                    assigneeFilter
                  }
                  onChange={
                    setAssigneeFilter
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "All assignees",
                    },
                    ...workspace.people.map(
                      (
                        person,
                      ) => ({
                        value:
                          person.id,
                        label:
                          person.name,
                      }),
                    ),
                  ]}
                />

                <FilterSelect
                  label="Deadline"
                  value={
                    deadlineFilter
                  }
                  onChange={(
                    value,
                  ) =>
                    setDeadlineFilter(
                      value as
                        DeadlineFilter,
                    )
                  }
                  items={[
                    {
                      value:
                        "all",
                      label:
                        "Any deadline",
                    },
                    {
                      value:
                        "overdue",
                      label:
                        "Overdue",
                    },
                    {
                      value:
                        "today",
                      label:
                        "Due today",
                    },
                    {
                      value:
                        "soon",
                      label:
                        "Next 7 days",
                    },
                    {
                      value:
                        "later",
                      label:
                        "Later",
                    },
                  ]}
                />
              </div>
            )}
          </div>

          <Tabs
            value={
              tab
            }
            onValueChange={(
              value,
            ) =>
              setTab(
                value as
                  TaskTab,
              )
            }
          >
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="my">
                My Tasks

                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {
                    myTasks.length
                  }
                </span>
              </TabsTrigger>

              <TabsTrigger value="team">
                Team Tasks

                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {
                    teamTasks.length
                  }
                </span>
              </TabsTrigger>

              <TabsTrigger value="all">
                All Tasks

                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {
                    allTasks.length
                  }
                </span>
              </TabsTrigger>

              <TabsTrigger value="done">
                Done

                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {
                    doneTasks.length
                  }
                </span>
              </TabsTrigger>
            </TabsList>

            {filteredProject && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">
                    Project
                  </p>

                  <p className="truncate text-sm font-medium">
                    {
                      filteredProject.name
                    }
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setProjectFilter(
                      "all",
                    )
                  }
                >
                  <X className="size-4" />
                  Show all
                </Button>
              </div>
            )}

            <TabsContent
              value="my"
              className="mt-4"
            >
              <TaskList
                tasks={
                  filteredTasks
                }
                emptyTitle="No tasks assigned to you"
                emptyText="You're all caught up."
                onOpen={
                  setSelectedTaskId
                }
              />
            </TabsContent>

            <TabsContent
              value="team"
              className="mt-4"
            >
              <TaskList
                tasks={
                  filteredTasks
                }
                emptyTitle="No team tasks"
                emptyText="There are no open tasks for your teams."
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
                  filteredTasks
                }
                emptyTitle="No open tasks"
                emptyText="There are no active tasks matching these filters."
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
                  filteredTasks
                }
                emptyTitle="Nothing completed yet"
                emptyText="Completed tasks will appear here."
                onOpen={
                  setSelectedTaskId
                }
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <Sheet
        open={
          createProjectOpen
        }
        onOpenChange={
          setCreateProjectOpen
        }
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>
              New Project
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6">
            <ProjectForm
              value={
                projectForm
              }
              onChange={
                setProjectForm
              }
              role={
                workspace.role
              }
              currentUserId={
                workspace.currentUserId
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
                void handleCreateProject()
              }
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <FolderPlus className="size-4" />
                  Create Project
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        open={
          Boolean(
            selectedProject,
          ) &&
          projectEditOpen
        }
        onOpenChange={(
          open,
        ) =>
          setProjectEditOpen(
            open,
          )
        }
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedProject &&
            projectEditForm && (
              <>
                <SheetHeader>
                  <SheetTitle>
                    {
                      selectedProject.name
                    }
                  </SheetTitle>
                </SheetHeader>

                <div className="mt-5 space-y-6">
                  <ProjectSummary
                    project={
                      selectedProject
                    }
                    tasks={
                      projectPageTasks
                    }
                  />

                  {selectedProject.canEditDetails ? (
                    <>
                      <ProjectForm
                        value={
                          projectEditForm
                        }
                        onChange={
                          setProjectEditForm
                        }
                        role={
                          workspace.role
                        }
                        currentUserId={
                          workspace.currentUserId
                        }
                        teams={
                          managerTeams
                        }
                        people={
                          workspace.people
                        }
                      />

                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          className="w-full"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            void handleProjectUpdate()
                          }
                        >
                          {saving
                            ? "Saving…"
                            : "Save Project Changes"}
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          disabled={
                            saving
                          }
                          onClick={() =>
                            void handleProjectArchive()
                          }
                        >
                          <Archive className="size-4" />
                          Archive Project
                        </Button>
                      </div>
                    </>
                  ) : (
                    <ProjectReadOnlyDetails
                      project={
                        selectedProject
                      }
                    />
                  )}

                  {!selectedProject.canEditDetails &&
                    selectedProject.canEditStatus && (
                      <StatusEditor
                        status={
                          projectEditForm.status
                        }
                        blockedReason={
                          projectEditForm.blockedReason
                        }
                        onChange={(
                          status,
                          blockedReason,
                        ) =>
                          setProjectEditForm(
                            {
                              ...projectEditForm,
                              status,
                              blockedReason,
                            },
                          )
                        }
                        saving={
                          saving
                        }
                        onSave={() =>
                          void handleProjectStatusUpdate()
                        }
                        disabled={
                          projectEditForm.status ===
                            selectedProject.status &&
                          projectEditForm.blockedReason ===
                            selectedProject.blockedReason
                        }
                        label="Project status"
                      />
                    )}
                </div>
              </>
            )}
        </SheetContent>
      </Sheet>

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
              currentUserId={
                workspace.currentUserId
              }
              teams={
                managerTeams
              }
              projects={
                workspace.projects
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
                    {
                      selectedTask.title
                    }
                  </SheetTitle>
                </SheetHeader>

                <div className="mt-5 space-y-6">
                  <TaskSummary
                    task={
                      selectedTask
                    }
                  />

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
                        currentUserId={
                          workspace.currentUserId
                        }
                        teams={
                          managerTeams
                        }
                        projects={
                          workspace.projects
                        }
                        people={
                          workspace.people
                        }
                      />

                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          className="w-full"
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

                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              saving
                            }
                            onClick={() =>
                              void handleDuplicate()
                            }
                          >
                            <Copy className="size-4" />
                            Duplicate
                          </Button>

                          <Button
                            type="button"
                            variant="outline"
                            disabled={
                              saving
                            }
                            onClick={() =>
                              void handleArchive()
                            }
                          >
                            <Archive className="size-4" />
                            Archive
                          </Button>
                        </div>

                        {workspace.role ===
                          "admin" && (
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
                            Delete from POM
                          </Button>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <TaskReadOnlyDetails
                        task={
                          selectedTask
                        }
                      />

                      {selectedTask.canEditStatus && (
                        <StatusEditor
                          status={
                            editForm.status
                          }
                          blockedReason={
                            editForm.blockedReason
                          }
                          onChange={(
                            status,
                            blockedReason,
                          ) =>
                            setEditForm(
                              {
                                ...editForm,
                                status,
                                blockedReason,
                              },
                            )
                          }
                          saving={
                            saving
                          }
                          onSave={() =>
                            void handleStatusUpdate()
                          }
                          disabled={
                            editForm.status ===
                              selectedTask.status &&
                            editForm.blockedReason ===
                              selectedTask.blockedReason
                          }
                          label="Task status"
                        />
                      )}
                    </>
                  )}

                  <WorkUpdatesPanel
                    updates={
                      selectedTask.updates
                    }
                    canAdd={
                      selectedTask.canEditStatus
                    }
                    onAdd={
                      handleAddTaskUpdate
                    }
                    emptyText="No task updates yet. Clock entries linked to this task will appear here automatically."
                  />
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
            Team Leads can create and fully manage tasks and projects for their
            own teams.
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
                          {
                            person.name
                          }
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

function ProjectNotFound({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <div className="surface-card mx-auto max-w-lg rounded-2xl p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-warning" />

      <p className="mt-3 font-medium">
        Project not available
      </p>

      <p className="mt-1 text-sm text-muted-foreground">
        This project may have been archived, deleted, or is outside your scope.
      </p>

      <Button
        type="button"
        variant="outline"
        className="mt-5"
        onClick={
          onBack
        }
      >
        <ChevronLeft className="size-4" />
        Back to Tasks
      </Button>
    </div>
  );
}

function ProjectWorkspaceView({
  project,
  tasks,
  people,
  onBack,
  onEdit,
  onOpenTask,
  onCreateSubtask,
  onAddUpdate,
}: {
  project: TaskProject;
  tasks: TaskItem[];
  people: TaskPerson[];
  onBack: () => void;
  onEdit: () => void;
  onOpenTask: (id: string) => void;
  onCreateSubtask: (input: QuickSubtaskInput) => Promise<void>;
  onAddUpdate: (body: string) => Promise<void>;
}) {
  const sortedTasks =
    useMemo(
      () =>
        sortProjectTasks(
          tasks,
        ),
      [
        tasks,
      ],
    );

  const done =
    tasks.filter(
      (
        task,
      ) =>
        task.status ===
        "Done",
    ).length;

  const blocked =
    tasks.filter(
      (
        task,
      ) =>
        task.status ===
        "Blocked",
    ).length;

  const overdue =
    tasks.filter(
      (
        task,
      ) =>
        task.status !==
          "Done" &&
        deadlineDays(
          task.deadline,
        ) <
          0,
    ).length;

  const progress =
    tasks.length ===
    0
      ? 0
      : Math.round(
          (
            done /
            tasks.length
          ) *
            100,
        );

  const deadline =
    optionalDeadlineInfo(
      project.deadline,
      project.status,
    );

  const canOpenEditor =
    project.canEditDetails ||
    project.canEditStatus;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button
          type="button"
          className="hover:text-foreground"
          onClick={
            onBack
          }
        >
          Tasks
        </button>

        <ChevronRight className="size-4" />

        <span className="max-w-[18rem] truncate font-medium text-foreground">
          {
            project.name
          }
        </span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2"
            onClick={
              onBack
            }
          >
            <ChevronLeft className="size-4" />
            Back to Tasks
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-semibold sm:text-3xl">
              {
                project.name
              }
            </h1>

            <Badge
              variant="outline"
              className={cn(
                "rounded-full",
                priorityClass(
                  project.priority,
                ),
              )}
            >
              {
                project.priority
              }
            </Badge>

            <Badge
              variant="outline"
              className={cn(
                "rounded-full",
                statusClass(
                  project.status,
                ),
              )}
            >
              {
                project.status
              }
            </Badge>
          </div>

          {project.description && (
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
              {
                project.description
              }
            </p>
          )}
        </div>

        {canOpenEditor && (
          <Button
            type="button"
            variant="outline"
            onClick={
              onEdit
            }
          >
            <Pencil className="size-4" />
            Edit project
          </Button>
        )}
      </div>

      <div className="surface-card rounded-2xl p-4 sm:p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <ProjectMeta
            label="Owner"
            value={
              project.ownerName
            }
            icon={
              <UserRound className="size-4" />
            }
          />

          <ProjectMeta
            label="Team"
            value={
              project.teamName
            }
            icon={
              <Users className="size-4" />
            }
          />

          <ProjectMeta
            label="Deadline"
            value={
              deadline.text
            }
            valueClassName={
              deadline.className
            }
            icon={
              <CalendarClock className="size-4" />
            }
          />

          <ProjectMeta
            label="Progress"
            value={`${done}/${tasks.length} done · ${progress}%`}
            icon={
              <CheckCircle2 className="size-4" />
            }
          />
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{
              width: `${progress}%`,
            }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Subtasks"
          value={
            tasks.length
          }
        />

        <SummaryCard
          label="Done"
          value={
            done
          }
        />

        <SummaryCard
          label="Overdue"
          value={
            overdue
          }
          danger={
            overdue >
            0
          }
        />

        <SummaryCard
          label="Blocked"
          value={
            blocked
          }
          danger={
            blocked >
            0
          }
        />
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <ClipboardList className="size-4 text-primary" />
              Subtasks
            </h2>

            <p className="mt-1 text-xs text-muted-foreground">
              Open a subtask to edit its details, status and updates.
            </p>
          </div>
        </div>

        {project.canEditDetails && (
          <QuickSubtaskComposer
            project={
              project
            }
            people={
              people
            }
            onCreate={
              onCreateSubtask
            }
          />
        )}

        <ProjectSubtasksTable
          tasks={
            sortedTasks
          }
          onOpen={
            onOpenTask
          }
        />
      </section>

      <ProjectActivityPanel
        project={
          project
        }
        tasks={
          tasks
        }
        canAdd={
          project.canEditStatus
        }
        onAdd={
          onAddUpdate
        }
      />
    </div>
  );
}

function ProjectMeta({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>

      <p
        className={cn(
          "mt-1 truncate font-medium",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}

function defaultQuickSubtaskDeadline(
  projectDeadline:
    string | null,
) {
  const today =
    format(
      new Date(),
      "yyyy-MM-dd",
    );

  const inSevenDays =
    format(
      addDays(
        new Date(),
        7,
      ),
      "yyyy-MM-dd",
    );

  if (
    projectDeadline &&
    projectDeadline >=
      today &&
    projectDeadline <
      inSevenDays
  ) {
    return projectDeadline;
  }

  return inSevenDays;
}

function QuickSubtaskComposer({
  project,
  people,
  onCreate,
}: {
  project: TaskProject;
  people: TaskPerson[];
  onCreate: (input: QuickSubtaskInput) => Promise<void>;
}) {
  const eligiblePeople =
    useMemo(
      () =>
        project.teamId ===
        null
          ? people
          : people.filter(
              (
                person,
              ) =>
                person.teamIds.includes(
                  project.teamId!,
                ),
            ),
      [
        people,
        project.teamId,
      ],
    );

  const defaultAssignee =
    eligiblePeople.some(
      (
        person,
      ) =>
        person.id ===
        project.ownerId,
    )
      ? project.ownerId
      : eligiblePeople[0]?.id ??
        "";

  const [
    title,
    setTitle,
  ] =
    useState(
      "",
    );

  const [
    assigneeId,
    setAssigneeId,
  ] =
    useState(
      defaultAssignee,
    );

  const [
    deadline,
    setDeadline,
  ] =
    useState(
      defaultQuickSubtaskDeadline(
        project.deadline,
      ),
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
      setTitle(
        "",
      );

      setAssigneeId(
        defaultAssignee,
      );

      setDeadline(
        defaultQuickSubtaskDeadline(
          project.deadline,
        ),
      );
    },
    [
      project.id,
      project.ownerId,
      project.deadline,
      defaultAssignee,
    ],
  );

  async function submit() {
    const cleanTitle =
      title.trim();

    if (
      !cleanTitle
    ) {
      toast.error(
        "Subtask title is required.",
      );

      return;
    }

    if (
      !assigneeId
    ) {
      toast.error(
        "Choose an assignee.",
      );

      return;
    }

    if (
      !deadline
    ) {
      toast.error(
        "Choose a deadline.",
      );

      return;
    }

    setSaving(
      true,
    );

    try {
      await onCreate({
        title:
          cleanTitle,

        assigneeId,

        deadline,
      });

      setTitle(
        "",
      );

      toast.success(
        "Subtask created",
      );
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not create subtask.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <div className="surface-card rounded-2xl border border-dashed border-border p-3">
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_14rem_11rem_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">
            New subtask
          </Label>

          <Input
            maxLength={
              120
            }
            placeholder="Add a subtask…"
            value={
              title
            }
            onChange={(
              event,
            ) =>
              setTitle(
                event.target.value,
              )
            }
            onKeyDown={(
              event,
            ) => {
              if (
                event.key ===
                "Enter"
              ) {
                event.preventDefault();

                void submit();
              }
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Assignee
          </Label>

          <Select
            value={
              assigneeId
            }
            onValueChange={
              setAssigneeId
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose person" />
            </SelectTrigger>

            <SelectContent>
              {eligiblePeople.map(
                (
                  person,
                ) => (
                  <SelectItem
                    key={
                      person.id
                    }
                    value={
                      person.id
                    }
                  >
                    {
                      person.name
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Deadline
          </Label>

          <Input
            type="date"
            value={
              deadline
            }
            onChange={(
              event,
            ) =>
              setDeadline(
                event.target.value,
              )
            }
          />
        </div>

        <Button
          type="button"
          disabled={
            saving ||
            !title.trim() ||
            !assigneeId ||
            !deadline
          }
          onClick={() =>
            void submit()
          }
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}

          Add
        </Button>
      </div>
    </div>
  );
}

function ProjectSubtasksTable({
  tasks,
  onOpen,
}: {
  tasks: TaskItem[];
  onOpen: (id: string) => void;
}) {
  if (
    tasks.length ===
    0
  ) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <ClipboardList className="mx-auto size-7 text-muted-foreground" />

        <p className="mt-3 text-sm font-medium">
          No subtasks yet
        </p>

        <p className="mt-1 text-xs text-muted-foreground">
          Add the first subtask above when this project is ready to break down.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_8rem_7rem_12rem] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
        <span>
          Task
        </span>

        <span>
          Assignee
        </span>

        <span>
          Status
        </span>

        <span>
          Priority
        </span>

        <span>
          Deadline
        </span>
      </div>

      <div className="divide-y divide-border">
        {tasks.map(
          (
            task,
          ) => {
            const deadline =
              deadlineInfo(
                task.deadline,
                task.status,
              );

            const assignees =
              task.assignees
                .map(
                  (
                    assignee,
                  ) =>
                    assignee.name,
                )
                .join(
                  ", ",
                );

            return (
              <button
                key={
                  task.id
                }
                type="button"
                className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_8rem_7rem_12rem] md:items-center md:gap-3"
                onClick={() =>
                  onOpen(
                    task.id,
                  )
                }
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      task.status ===
                        "Done" &&
                        "line-through opacity-70",
                    )}
                  >
                    {
                      task.title
                    }
                  </p>

                  {task.description && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                      {
                        task.description
                      }
                    </p>
                  )}
                </div>

                <div className="min-w-0 text-xs text-muted-foreground">
                  <span className="md:hidden">
                    Assignee:{" "}
                  </span>

                  <span className="truncate">
                    {assignees ||
                      task.ownerName}
                  </span>
                </div>

                <div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-2 py-0 text-[10px]",
                      statusClass(
                        task.status,
                      ),
                    )}
                  >
                    {
                      task.status
                    }
                  </Badge>
                </div>

                <div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full px-2 py-0 text-[10px]",
                      priorityClass(
                        task.priority,
                      ),
                    )}
                  >
                    {
                      task.priority
                    }
                  </Badge>
                </div>

                <div
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    deadline.className,
                  )}
                >
                  <CalendarClock className="size-3" />

                  {
                    deadline.text
                  }
                </div>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}

function ProjectActivityPanel({
  project,
  tasks,
  canAdd,
  onAdd,
}: {
  project: TaskProject;
  tasks: TaskItem[];
  canAdd: boolean;
  onAdd: (body: string) => Promise<void>;
}) {
  const [
    text,
    setText,
  ] =
    useState(
      "",
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  const activity =
    useMemo<ProjectActivityItem[]>(
      () => {
        const items:
          ProjectActivityItem[] =
          [
            ...project.updates.map(
              (
                update,
              ) => ({
                ...update,
                context:
                  "Project",
              }),
            ),

            ...tasks.flatMap(
              (
                task,
              ) =>
                task.updates.map(
                  (
                    update,
                  ) => ({
                    ...update,
                    context:
                      task.title,
                  }),
                ),
            ),
          ];

        return items.sort(
          (
            a,
            b,
          ) =>
            new Date(
              b.createdAt,
            ).getTime() -
            new Date(
              a.createdAt,
            ).getTime(),
        );
      },
      [
        project.updates,
        tasks,
      ],
    );

  async function submit() {
    const body =
      text.trim();

    if (
      !body ||
      saving
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await onAdd(
        body,
      );

      setText(
        "",
      );

      toast.success(
        "Project update added",
      );
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not add update.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <MessageSquareText className="size-4 text-primary" />
          Activity & updates
        </h2>

        <p className="mt-1 text-xs text-muted-foreground">
          Project notes plus updates and clock entries from its subtasks.
        </p>
      </div>

      {canAdd && (
        <div className="surface-card rounded-2xl p-3">
          <Textarea
            rows={
              3
            }
            maxLength={
              2000
            }
            className="resize-none rounded-xl"
            placeholder="Add project progress, a decision, a blocker or a handoff…"
            value={
              text
            }
            onChange={(
              event,
            ) =>
              setText(
                event.target.value,
              )
            }
          />

          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={
                !text.trim() ||
                saving
              }
              onClick={() =>
                void submit()
              }
            >
              {saving
                ? "Adding…"
                : "Add project update"}
            </Button>
          </div>
        </div>
      )}

      {activity.length ===
      0 ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          No project or subtask updates yet.
        </div>
      ) : (
        <div className="space-y-2">
          {activity.map(
            (
              update,
            ) => (
              <div
                key={`${update.context}-${update.id}`}
                className="surface-card rounded-2xl p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {
                      update.authorName
                    }
                  </span>

                  <Badge
                    variant="secondary"
                    className="rounded-full text-[10px]"
                  >
                    {
                      update.context
                    }
                  </Badge>

                  <span>
                    ·
                  </span>

                  <span>
                    {formatDateTime(
                      update.createdAt,
                    )}
                  </span>

                  {update.source ===
                    "clock" && (
                    <Badge
                      variant="secondary"
                      className="rounded-full text-[10px]"
                    >
                      <Timer className="mr-1 size-3" />

                      Clock

                      {update.durationMs
                        ? ` · ${formatHours(update.durationMs)}`
                        : ""}
                    </Badge>
                  )}
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {
                    update.body
                  }
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="surface-card rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p
        className={cn(
          "mt-1 text-2xl font-semibold",
          danger &&
            "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: {
    value: string;
    label: string;
  }[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">
        {label}
      </Label>

      <Select
        value={
          value
        }
        onValueChange={
          onChange
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          {items.map(
            (
              item,
            ) => (
              <SelectItem
                key={
                  item.value
                }
                value={
                  item.value
                }
              >
                {
                  item.label
                }
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
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
    <div className="grid gap-2">
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
      tabIndex={
        0
      }
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
      <CardContent className="px-3.5 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-sm font-semibold sm:text-base">
              {
                task.title
              }
            </h2>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />

                {
                  task.ownerName
                }
              </span>

              <span
                className={cn(
                  "inline-flex items-center gap-1",
                  deadline.className,
                )}
              >
                <CalendarClock className="size-3" />

                {
                  deadline.text
                }
              </span>

              {task.projectName && (
                <span className="inline-flex max-w-[14rem] items-center gap-1 truncate">
                  <FolderKanban className="size-3" />

                  {
                    task.projectName
                  }
                </span>
              )}

              {task.assignees.length >
                1 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />

                  {
                    task.assignees.length
                  }{" "}
                  assigned
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0 text-[10px]",
                priorityClass(
                  task.priority,
                ),
              )}
            >
              {
                task.priority
              }
            </Badge>

            <Badge
              variant="outline"
              className={cn(
                "rounded-full px-2 py-0 text-[10px]",
                statusClass(
                  task.status,
                ),
              )}
            >
              {
                task.status
              }
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskSummary({
  task,
}: {
  task: TaskItem;
}) {
  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Scope
          </p>

          <p className="mt-1 text-sm font-medium">
            {
              task.teamName
            }
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              priorityClass(
                task.priority,
              ),
            )}
          >
            {
              task.priority
            }
          </Badge>

          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              statusClass(
                task.status,
              ),
            )}
          >
            {
              task.status
            }
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p>
          Owner:{" "}
          <span className="font-medium text-foreground">
            {
              task.ownerName
            }
          </span>
        </p>

        {task.projectName && (
          <p>
            Project:{" "}
            <span className="font-medium text-foreground">
              {
                task.projectName
              }
            </span>
          </p>
        )}

        <p>
          Deadline:{" "}
          <span className="font-medium text-foreground">
            {format(
              parseISO(
                task.deadline,
              ),
              "MMMM d, yyyy",
            )}
          </span>
        </p>

        <p>
          Created by{" "}
          <span className="font-medium text-foreground">
            {
              task.createdByName
            }
          </span>
        </p>
      </div>

      {task.status ===
        "Blocked" &&
        task.blockedReason && (
          <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              Blocked
            </p>

            <p className="mt-1 text-sm">
              {
                task.blockedReason
              }
            </p>
          </div>
        )}
    </div>
  );
}

function ProjectSummary({
  project,
  tasks,
}: {
  project: TaskProject;
  tasks: TaskItem[];
}) {
  const done =
    tasks.filter(
      (
        task,
      ) =>
        task.status ===
        "Done",
    ).length;

  const progress =
    tasks.length ===
    0
      ? 0
      : Math.round(
          (
            done /
            tasks.length
          ) *
            100,
        );

  const deadline =
    optionalDeadlineInfo(
      project.deadline,
      project.status,
    );

  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Scope
          </p>

          <p className="mt-1 text-sm font-medium">
            {
              project.teamName
            }
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              priorityClass(
                project.priority,
              ),
            )}
          >
            {
              project.priority
            }
          </Badge>

          <Badge
            variant="outline"
            className={cn(
              "rounded-full",
              statusClass(
                project.status,
              ),
            )}
          >
            {
              project.status
            }
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p>
          Owner:{" "}
          <span className="font-medium text-foreground">
            {
              project.ownerName
            }
          </span>
        </p>

        <p
          className={
            deadline.className
          }
        >
          Deadline:{" "}
          {
            deadline.text
          }
        </p>

        <p>
          Subtasks:{" "}
          <span className="font-medium text-foreground">
            {done}/
            {
              tasks.length
            }{" "}
            done
          </span>
        </p>

        <p>
          Created by{" "}
          <span className="font-medium text-foreground">
            {
              project.createdByName
            }
          </span>
        </p>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${progress}%`,
          }}
        />
      </div>

      {project.status ===
        "Blocked" &&
        project.blockedReason && (
          <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">
              Blocked
            </p>

            <p className="mt-1 text-sm">
              {
                project.blockedReason
              }
            </p>
          </div>
        )}
    </div>
  );
}

function TaskReadOnlyDetails({
  task,
}: {
  task: TaskItem;
}) {
  return (
    <div className="space-y-4">
      {task.description && (
        <div>
          <Label>
            Description
          </Label>

          <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm">
            {
              task.description
            }
          </p>
        </div>
      )}

      <div>
        <Label>
          Assigned to
        </Label>

        <div className="mt-2 flex flex-wrap gap-2">
          {task.assignees.map(
            (
              assignee,
            ) => (
              <Badge
                key={
                  assignee.id
                }
                variant="secondary"
              >
                {
                  assignee.name
                }
              </Badge>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectReadOnlyDetails({
  project,
}: {
  project: TaskProject;
}) {
  return (
    <div className="space-y-4">
      {project.description && (
        <div>
          <Label>
            Description
          </Label>

          <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm">
            {
              project.description
            }
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>
            Owner
          </Label>

          <p className="mt-2 rounded-2xl bg-muted/50 p-3 text-sm">
            {
              project.ownerName
            }
          </p>
        </div>

        <div>
          <Label>
            Deadline
          </Label>

          <p className="mt-2 rounded-2xl bg-muted/50 p-3 text-sm">
            {project.deadline
              ? format(
                  parseISO(
                    project.deadline,
                  ),
                  "MMMM d, yyyy",
                )
              : "No deadline"}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusEditor({
  status,
  blockedReason,
  onChange,
  saving,
  onSave,
  disabled,
  label,
}: {
  status: TaskStatus;
  blockedReason: string;
  onChange: (status: TaskStatus, blockedReason: string) => void;
  saving: boolean;
  onSave: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="space-y-3 border-t border-border pt-5">
      <Label>
        {label}
      </Label>

      <Select
        value={
          status
        }
        onValueChange={(
          value,
        ) => {
          const nextStatus =
            value as
              TaskStatus;

          onChange(
            nextStatus,
            nextStatus ===
              "Blocked"
              ? blockedReason
              : "",
          );
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>

        <SelectContent>
          {STATUSES.map(
            (
              item,
            ) => (
              <SelectItem
                key={
                  item
                }
                value={
                  item
                }
              >
                {
                  item
                }
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>

      {status ===
        "Blocked" && (
        <div className="space-y-2">
          <Label>
            Why is this blocked?
          </Label>

          <Textarea
            rows={
              3
            }
            maxLength={
              500
            }
            className="resize-none rounded-2xl"
            placeholder="Waiting for supplier approval…"
            value={
              blockedReason
            }
            onChange={(
              event,
            ) =>
              onChange(
                status,
                event.target.value,
              )
            }
          />
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={
          saving ||
          disabled
        }
        onClick={
          onSave
        }
      >
        {saving
          ? "Saving…"
          : "Update Status"}
      </Button>
    </div>
  );
}

function WorkUpdatesPanel({
  updates,
  canAdd,
  onAdd,
  emptyText,
}: {
  updates: WorkUpdate[];
  canAdd: boolean;
  onAdd: (body: string) => Promise<void>;
  emptyText: string;
}) {
  const [
    text,
    setText,
  ] =
    useState(
      "",
    );

  const [
    saving,
    setSaving,
  ] =
    useState(
      false,
    );

  async function submit() {
    const body =
      text.trim();

    if (
      !body ||
      saving
    ) {
      return;
    }

    setSaving(
      true,
    );

    try {
      await onAdd(
        body,
      );

      setText(
        "",
      );

      toast.success(
        "Update added",
      );
    } catch (error) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not add update.",
      );
    } finally {
      setSaving(
        false,
      );
    }
  }

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div>
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-primary" />

          <Label>
            Updates
          </Label>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          Manual notes and work logged from The Clock are kept together here.
        </p>
      </div>

      {canAdd && (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <Textarea
            rows={
              3
            }
            maxLength={
              2000
            }
            className="resize-none rounded-xl"
            placeholder="Add progress, a decision, a blocker, a handoff…"
            value={
              text
            }
            onChange={(
              event,
            ) =>
              setText(
                event.target.value,
              )
            }
          />

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={
                !text.trim() ||
                saving
              }
              onClick={() =>
                void submit()
              }
            >
              {saving
                ? "Adding…"
                : "Add update"}
            </Button>
          </div>
        </div>
      )}

      {updates.length ===
      0 ? (
        <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {updates.map(
            (
              update,
            ) => (
              <div
                key={
                  update.id
                }
                className="rounded-2xl border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {
                      update.authorName
                    }
                  </span>

                  <span>
                    ·
                  </span>

                  <span>
                    {formatDateTime(
                      update.createdAt,
                    )}
                  </span>

                  {update.source ===
                    "clock" && (
                    <Badge
                      variant="secondary"
                      className="rounded-full text-[10px]"
                    >
                      <Timer className="mr-1 size-3" />

                      Clock

                      {update.durationMs
                        ? ` · ${formatHours(update.durationMs)}`
                        : ""}
                    </Badge>
                  )}
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {
                    update.body
                  }
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function TaskForm({
  value,
  onChange,
  role,
  currentUserId,
  teams,
  projects,
  people,
}: {
  value: TaskFormValue;
  onChange: (value: TaskFormValue) => void;
  role: TaskRole;
  currentUserId: string;
  teams: {
    id: string;
    name: string;
  }[];
  projects: TaskProject[];
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

  const eligibleProjects =
    projects.filter(
      (
        project,
      ) =>
        value.teamId ===
        "general"
          ? project.teamId ===
            null
          : project.teamId ===
            value.teamId,
    );

  function changeScope(
    teamId:
      string,
  ) {
    const nextPeople =
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
          );

    const allowed =
      new Set(
        nextPeople.map(
          (
            person,
          ) =>
            person.id,
        ),
      );

    const nextOwner =
      allowed.has(
        value.ownerId,
      )
        ? value.ownerId
        : allowed.has(
              currentUserId,
            )
          ? currentUserId
          : nextPeople[0]?.id ??
            "";

    const selectedProject =
      projects.find(
        (
          project,
        ) =>
          project.id ===
          value.projectId,
      );

    const projectStillValid =
      selectedProject
        ? teamId ===
          "general"
          ? selectedProject.teamId ===
            null
          : selectedProject.teamId ===
            teamId
        : value.projectId ===
          "none";

    onChange({
      ...value,
      teamId,
      ownerId:
        nextOwner,
      projectId:
        projectStillValid
          ? value.projectId
          : "none",
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
          rows={
            5
          }
          maxLength={
            2000
          }
          className="resize-none rounded-2xl"
          placeholder="Add details or requirements…"
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
            Priority
          </Label>

          <Select
            value={
              value.priority
            }
            onValueChange={(
              priority,
            ) =>
              onChange({
                ...value,
                priority:
                  priority as
                    TaskPriority,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {PRIORITIES.map(
                (
                  priority,
                ) => (
                  <SelectItem
                    key={
                      priority
                    }
                    value={
                      priority
                    }
                  >
                    {
                      priority
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Status
          </Label>

          <Select
            value={
              value.status
            }
            onValueChange={(
              statusValue,
            ) => {
              const status =
                statusValue as
                  TaskStatus;

              onChange({
                ...value,
                status,
                blockedReason:
                  status ===
                  "Blocked"
                    ? value.blockedReason
                    : "",
              });
            }}
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
                    {
                      status
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
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
                    {
                      team.name
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.status ===
        "Blocked" && (
        <div className="space-y-2">
          <Label>
            Why is this blocked?
          </Label>

          <Textarea
            rows={
              3
            }
            maxLength={
              500
            }
            className="resize-none rounded-2xl"
            placeholder="Waiting for supplier approval…"
            value={
              value.blockedReason
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...value,
                blockedReason:
                  event.target.value,
              })
            }
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>
          Project
        </Label>

        <Select
          value={
            value.projectId
          }
          onValueChange={(
            projectId,
          ) =>
            onChange({
              ...value,
              projectId,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="none">
              No project
            </SelectItem>

            {eligibleProjects.map(
              (
                project,
              ) => (
                <SelectItem
                  key={
                    project.id
                  }
                  value={
                    project.id
                  }
                >
                  {
                    project.name
                  }
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>

        {eligibleProjects.length ===
          0 && (
          <p className="text-xs text-muted-foreground">
            No projects exist for this scope yet.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          Owner
        </Label>

        <Select
          value={
            value.ownerId
          }
          onValueChange={(
            ownerId,
          ) =>
            onChange({
              ...value,
              ownerId,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose an owner" />
          </SelectTrigger>

          <SelectContent>
            {eligiblePeople.map(
              (
                person,
              ) => (
                <SelectItem
                  key={
                    person.id
                  }
                  value={
                    person.id
                  }
                >
                  {
                    person.name
                  }
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
            {
              value.assigneeIds.length
            }{" "}
            selected
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
                        {
                          person.name
                        }
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

function ProjectForm({
  value,
  onChange,
  role,
  currentUserId,
  teams,
  people,
}: {
  value: ProjectFormValue;
  onChange: (value: ProjectFormValue) => void;
  role: TaskRole;
  currentUserId: string;
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
    const nextPeople =
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
          );

    const allowed =
      new Set(
        nextPeople.map(
          (
            person,
          ) =>
            person.id,
        ),
      );

    onChange({
      ...value,
      teamId,
      ownerId:
        allowed.has(
          value.ownerId,
        )
          ? value.ownerId
          : allowed.has(
                currentUserId,
              )
            ? currentUserId
            : nextPeople[0]?.id ??
              "",
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>
          Project name
        </Label>

        <Input
          maxLength={
            120
          }
          placeholder="Kickoff 2027"
          value={
            value.name
          }
          onChange={(
            event,
          ) =>
            onChange({
              ...value,
              name:
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
          rows={
            5
          }
          maxLength={
            2000
          }
          className="resize-none rounded-2xl"
          placeholder="What is this project trying to achieve?"
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
            Deadline (optional)
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
            Priority
          </Label>

          <Select
            value={
              value.priority
            }
            onValueChange={(
              priority,
            ) =>
              onChange({
                ...value,
                priority:
                  priority as
                    TaskPriority,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              {PRIORITIES.map(
                (
                  priority,
                ) => (
                  <SelectItem
                    key={
                      priority
                    }
                    value={
                      priority
                    }
                  >
                    {
                      priority
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>
            Status
          </Label>

          <Select
            value={
              value.status
            }
            onValueChange={(
              statusValue,
            ) => {
              const status =
                statusValue as
                  TaskStatus;

              onChange({
                ...value,
                status,
                blockedReason:
                  status ===
                  "Blocked"
                    ? value.blockedReason
                    : "",
              });
            }}
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
                    {
                      status
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
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
                    {
                      team.name
                    }
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.status ===
        "Blocked" && (
        <div className="space-y-2">
          <Label>
            Why is this blocked?
          </Label>

          <Textarea
            rows={
              3
            }
            maxLength={
              500
            }
            className="resize-none rounded-2xl"
            placeholder="Waiting for approval…"
            value={
              value.blockedReason
            }
            onChange={(
              event,
            ) =>
              onChange({
                ...value,
                blockedReason:
                  event.target.value,
              })
            }
          />
        </div>
      )}

      <div className="space-y-2">
        <Label>
          Owner
        </Label>

        <Select
          value={
            value.ownerId
          }
          onValueChange={(
            ownerId,
          ) =>
            onChange({
              ...value,
              ownerId,
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose an owner" />
          </SelectTrigger>

          <SelectContent>
            {eligiblePeople.map(
              (
                person,
              ) => (
                <SelectItem
                  key={
                    person.id
                  }
                  value={
                    person.id
                  }
                >
                  {
                    person.name
                  }
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}