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
  ChevronDown,
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

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MentionTextarea } from "@/components/mention-textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { syncGoogleSheetsNow } from "@/lib/google-sheets.functions";
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
import type {
  ProjectStatus,
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
    project:
      typeof search.project === "string"
        ? search.project
        : undefined,

    task:
      typeof search.task === "string"
        ? search.task
        : undefined,
  }),

  head: () => ({
    meta: [
      {
        title: "Tasks - POM",
      },
      {
        name: "description",
        content: "POM projects, tasks and assignments.",
      },
    ],
  }),

  component: TasksPage,
});

type MainView = "tasks" | "projects";
type TaskTab = "my" | "team" | "all" | "done";

type DeadlineFilter =
  | "all"
  | "overdue"
  | "today"
  | "soon"
  | "later";

type TaskGroupKey =
  | "attention"
  | "next"
  | "later"
  | "done";

type ProjectCompletionMode =
  | "quick"
  | "full";

type BlockedPrompt =
  | {
      kind: "task";
      id: string;
      title: string;
    }
  | {
      kind: "project";
      id: string;
      title: string;
    };

interface PendingProjectCompletion {
  mode: ProjectCompletionMode;
  projectId: string;
}

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
  status: ProjectStatus;
  priority: TaskPriority;
  ownerId: string;
  blockedReason: string;
  teamId: string;
}

interface TaskCardActions {
  busyKey: string | null;

  onStatusChange: (
    task: TaskItem,
    status: TaskStatus,
  ) => void;

  onPriorityChange: (
    task: TaskItem,
    priority: TaskPriority,
  ) => void;

  onDeadlineChange: (
    task: TaskItem,
    deadline: string,
  ) => Promise<void>;
}

interface ProjectCardActions {
  busyKey: string | null;

  onStatusChange: (
    project: TaskProject,
    status: ProjectStatus,
  ) => void;

  onPriorityChange: (
    project: TaskProject,
    priority: TaskPriority,
  ) => void;

  onDeadlineChange: (
    project: TaskProject,
    deadline: string,
  ) => Promise<void>;
}

const STATUSES: TaskStatus[] = [
  "To Do",
  "In Progress",
  "Blocked",
  "Done",
];

const PRIORITIES: TaskPriority[] = [
  "Low",
  "Medium",
  "High",
  "Critical",
];

function defaultTaskForm(
  role: TaskRole,
  teamIds: string[],
  currentUserId: string,
): TaskFormValue {
  return {
    title: "",
    description: "",
    deadline: format(
      addDays(new Date(), 7),
      "yyyy-MM-dd",
    ),
    status: "To Do",
    priority: "Medium",
    ownerId: currentUserId,
    blockedReason: "",
    projectId: "none",

    teamId:
      role === "admin"
        ? "general"
        : teamIds[0] ?? "",

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
    status: null,
    priority: "Medium",
    ownerId: currentUserId,
    blockedReason: "",

    teamId:
      role === "admin"
        ? "general"
        : teamIds[0] ?? "",
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
    priority: task.priority,
    ownerId: task.ownerId,
    blockedReason: task.blockedReason,
    projectId: task.projectId ?? "none",
    teamId: task.teamId ?? "general",

    assigneeIds:
      task.assignees.map(
        (assignee) => assignee.id,
      ),
  };
}

function projectToForm(
  project: TaskProject,
): ProjectFormValue {
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

function taskUpdateData(
  task: TaskItem,
  patch: Partial<
    Pick<
      TaskFormValue,
      "priority" | "deadline"
    >
  > = {},
) {
  const form = {
    ...taskToForm(task),
    ...patch,
  };

  return {
    taskId: task.id,
    title: form.title,
    description: form.description,
    deadline: form.deadline,
    status: form.status,
    priority: form.priority,
    ownerId: form.ownerId,
    blockedReason: form.blockedReason,

    projectId:
      form.projectId === "none"
        ? null
        : form.projectId,

    teamId:
      form.teamId === "general"
        ? null
        : form.teamId,

    assigneeIds: form.assigneeIds,
  };
}

function projectUpdateData(
  project: TaskProject,
  patch: Partial<
    Pick<
      ProjectFormValue,
      "priority" | "deadline"
    >
  > = {},
) {
  const form = {
    ...projectToForm(project),
    ...patch,
  };

  return {
    projectId: project.id,
    name: form.name,
    description: form.description,

    deadline:
      form.deadline || null,

    status: form.status,
    priority: form.priority,
    ownerId: form.ownerId,
    blockedReason: form.blockedReason,

    teamId:
      form.teamId === "general"
        ? null
        : form.teamId,
  };
}

function roleLabel(
  role: TaskRole,
) {
  if (role === "admin") {
    return "Admin";
  }

  if (role === "team_lead") {
    return "Team Lead";
  }

  return "User";
}

function statusClass(
  status: TaskStatus,
) {
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

function projectStatusClass(
  status: ProjectStatus,
) {
  if (status === null) {
    return "border-border bg-muted text-muted-foreground";
  }

  return statusClass(status);
}

function priorityClass(
  priority: TaskPriority,
) {
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

function deadlineDays(
  deadline: string,
) {
  return differenceInCalendarDays(
    parseISO(deadline),
    startOfDay(new Date()),
  );
}

function shortDeadlineDate(
  deadline: string,
) {
  const date =
    parseISO(deadline);

  const pattern =
    date.getFullYear() ===
    new Date().getFullYear()
      ? "MMM d"
      : "MMM d, yyyy";

  return format(
    date,
    pattern,
  );
}

function deadlineInfo(
  deadline: string,
  status: TaskStatus | null,
) {
  const exactDate =
    shortDeadlineDate(deadline);

  const days =
    deadlineDays(deadline);

  if (status === "Done") {
    return {
      shortText: exactDate,
      text: `Due ${exactDate}`,
      className:
        "text-muted-foreground",
    };
  }

  if (days < 0) {
    const overdue =
      Math.abs(days);

    return {
      shortText:
        `${overdue}d overdue`,

      text:
        `${exactDate} · ${overdue} day${
          overdue === 1
            ? ""
            : "s"
        } overdue`,

      className:
        "font-medium text-destructive",
    };
  }

  if (days === 0) {
    return {
      shortText:
        "Due today",

      text:
        `${exactDate} · Due today`,

      className:
        "font-medium text-warning",
    };
  }

  if (days === 1) {
    return {
      shortText:
        "Tomorrow",

      text:
        `${exactDate} · Due tomorrow`,

      className:
        "font-medium text-warning",
    };
  }

  if (days <= 7) {
    return {
      shortText:
        `${days}d left`,

      text:
        `${exactDate} · ${days} days left`,

      className:
        "text-muted-foreground",
    };
  }

  return {
    shortText: exactDate,
    text:
      `${exactDate} · ${days} days left`,
    className:
      "text-muted-foreground",
  };
}

function optionalDeadlineInfo(
  deadline: string | null,
  status: ProjectStatus,
) {
  if (!deadline) {
    return {
      shortText:
        "No deadline",

      text:
        "No deadline",

      className:
        "text-muted-foreground",
    };
  }

  return deadlineInfo(
    deadline,
    status,
  );
}

function deadlinePillClass(
  deadline: string,
  status: TaskStatus | null,
) {
  if (!deadline) {
    return "border-border bg-muted text-muted-foreground";
  }

  if (status !== "Done") {
    const days =
      deadlineDays(
        deadline,
      );

    if (days < 0) {
      return "border-destructive/30 bg-destructive/10 text-destructive";
    }

    if (days <= 1) {
      return "border-warning/30 bg-warning/10 text-warning";
    }
  }

  return "border-border bg-muted text-muted-foreground";
}

function smartTaskRank(
  task: TaskItem,
) {
  const days =
    deadlineDays(
      task.deadline,
    );

  if (
    task.status !== "Done" &&
    days < 0
  ) {
    return 0;
  }

  if (
    task.status === "Blocked"
  ) {
    return 1;
  }

  if (
    task.priority === "Critical"
  ) {
    return 2;
  }

  if (
    task.status !== "Done" &&
    days >= 0 &&
    days <= 7
  ) {
    return 3;
  }

  return 4;
}

function smartSortTasks(
  tasks: TaskItem[],
) {
  return [...tasks].sort(
    (
      a,
      b,
    ) => {
      const rankDifference =
        smartTaskRank(a) -
        smartTaskRank(b);

      if (
        rankDifference !== 0
      ) {
        return rankDifference;
      }

      const deadlineDifference =
        parseISO(
          a.deadline,
        ).getTime() -
        parseISO(
          b.deadline,
        ).getTime();

      if (
        deadlineDifference !== 0
      ) {
        return deadlineDifference;
      }

      return a.title.localeCompare(
        b.title,
      );
    },
  );
}

function sortProjectTasks(
  tasks: TaskItem[],
) {
  const open =
    smartSortTasks(
      tasks.filter(
        (task) =>
          task.status !==
          "Done",
      ),
    );

  const done =
    [...tasks]
      .filter(
        (task) =>
          task.status ===
          "Done",
      )
      .sort(
        (
          a,
          b,
        ) =>
          b.updatedAt.localeCompare(
            a.updatedAt,
          ),
      );

  return [
    ...open,
    ...done,
  ];
}

function groupTasks(
  tasks: TaskItem[],
): Array<{
  key: TaskGroupKey;
  label: string;
  subtitle: string;
  tasks: TaskItem[];
}> {
  const attention:
    TaskItem[] = [];

  const next:
    TaskItem[] = [];

  const later:
    TaskItem[] = [];

  const done:
    TaskItem[] = [];

  for (
    const task
    of tasks
  ) {
    if (
      task.status ===
      "Done"
    ) {
      done.push(task);
      continue;
    }

    const days =
      deadlineDays(
        task.deadline,
      );

    if (
      days < 0 ||
      task.status ===
        "Blocked" ||
      task.priority ===
        "Critical"
    ) {
      attention.push(
        task,
      );

      continue;
    }

    if (
      days <= 7
    ) {
      next.push(
        task,
      );

      continue;
    }

    later.push(
      task,
    );
  }

  const groups:
    Array<{
      key: TaskGroupKey;
      label: string;
      subtitle: string;
      tasks: TaskItem[];
    }> = [];

  if (
    attention.length >
    0
  ) {
    groups.push({
      key:
        "attention",

      label:
        "Needs attention",

      subtitle:
        "Overdue, blocked or critical",

      tasks:
        smartSortTasks(
          attention,
        ),
    });
  }

  if (
    next.length >
    0
  ) {
    groups.push({
      key:
        "next",

      label:
        "Next 7 days",

      subtitle:
        "Upcoming work",

      tasks:
        smartSortTasks(
          next,
        ),
    });
  }

  if (
    later.length >
    0
  ) {
    groups.push({
      key:
        "later",

      label:
        "Later",

      subtitle:
        "Not urgent yet",

      tasks:
        smartSortTasks(
          later,
        ),
    });
  }

  if (
    done.length >
    0
  ) {
    groups.push({
      key:
        "done",

      label:
        "Completed",

      subtitle:
        "Finished work",

      tasks:
        done,
    });
  }

  return groups;
}

function LinkifiedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts =
    text.split(
      /(https?:\/\/[^\s]+|www\.[^\s]+)/gi,
    );

  return (
    <span
      className={cn(
        "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
        className,
      )}
    >
      {parts.map(
        (
          part,
          index,
        ) => {
          if (
            !/^(https?:\/\/|www\.)/i.test(
              part,
            )
          ) {
            return (
              <span
                key={`${index}-${part.slice(0, 12)}`}
              >
                {part}
              </span>
            );
          }

          let url =
            part;

          let suffix =
            "";

          while (
            url &&
            /[.,!?;:)\]]$/.test(
              url,
            )
          ) {
            suffix =
              url.slice(-1) +
              suffix;

            url =
              url.slice(
                0,
                -1,
              );
          }

          const href =
            /^www\./i.test(
              url,
            )
              ? `https://${url}`
              : url;

          return (
            <span
              key={`${index}-${part.slice(0, 12)}`}
            >
              <a
                href={
                  href
                }
                target="_blank"
                rel="noreferrer noopener"
                className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary [overflow-wrap:anywhere]"
                onClick={(
                  event,
                ) =>
                  event.stopPropagation()
                }
              >
                {url}
              </a>

              {suffix}
            </span>
          );
        },
      )}
    </span>
  );
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

    task:
      taskPageId,
  } =
    Route.useSearch();

  const [
    workspace,
    setWorkspace,
  ] =
    useState<
      TasksWorkspace | null
    >(
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
    quickBusyKey,
    setQuickBusyKey,
  ] =
    useState<
      string | null
    >(
      null,
    );

  const [
    syncingSheets,
    setSyncingSheets,
  ] =
    useState(
      false,
    );

  const [
    mainView,
    setMainView,
  ] =
    useState<MainView>(
      "tasks",
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
    taskEditOpen,
    setTaskEditOpen,
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
    useState<
      TaskFormValue | null
    >(
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
    useState<
      ProjectFormValue | null
    >(
      null,
    );

  const [
    blockedPrompt,
    setBlockedPrompt,
  ] =
    useState<
      BlockedPrompt | null
    >(
      null,
    );

  const [
    blockedReasonDraft,
    setBlockedReasonDraft,
  ] =
    useState(
      "",
    );

  const [
    pendingProjectCompletion,
    setPendingProjectCompletion,
  ] =
    useState<
      PendingProjectCompletion | null
    >(
      null,
    );

  const [
    leadBusyId,
    setLeadBusyId,
  ] =
    useState<
      string | null
    >(
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
    projectSearch,
    setProjectSearch,
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
      function refresh() {
        void load();
      }

      function refreshVisible() {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void load();
        }
      }

      window.addEventListener(
        "focus",
        refresh,
      );

      document.addEventListener(
        "visibilitychange",
        refreshVisible,
      );

      return () => {
        window.removeEventListener(
          "focus",
          refresh,
        );

        document.removeEventListener(
          "visibilitychange",
          refreshVisible,
        );
      };
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
      workspace,
    ],
  );

  const selectedTask =
    workspace?.tasks.find(
      (
        task,
      ) =>
        task.id ===
        taskPageId,
    ) ??
    null;

  const selectedProject =
    workspace?.projects.find(
      (
        project,
      ) =>
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

      setTaskEditOpen(
        false,
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

  const myTasks =
    useMemo(
      () =>
        openTasks.filter(
          (
            task,
          ) =>
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
          (
            task,
          ) =>
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
            days < 0
          ) {
            overdue +=
              1;
          } else if (
            days <= 7
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
          tab === "my"
        ) {
          return myTasks;
        }

        if (
          tab === "team"
        ) {
          return teamTasks;
        }

        if (
          tab === "done"
        ) {
          return doneTasks;
        }

        return allTasks;
      },
      [
        tab,
        myTasks,
        teamTasks,
        doneTasks,
        allTasks,
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
                          entry,
                        ) =>
                          entry.body,
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
                  days >= 0
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "today" &&
                  days !== 0
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "soon" &&
                  (
                    days < 0 ||
                    days > 7
                  )
                ) {
                  return false;
                }

                if (
                  deadlineFilter ===
                    "later" &&
                  days <= 7
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

  const visibleProjects =
    useMemo(
      () => {
        const query =
          projectSearch
            .trim()
            .toLowerCase();

        if (
          !query
        ) {
          return workspace?.projects ??
            [];
        }

        return (
          workspace?.projects ??
          []
        ).filter(
          (
            project,
          ) =>
            [
              project.name,
              project.description,
              project.teamName,
              project.ownerName,
            ]
              .join(
                " ",
              )
              .toLowerCase()
              .includes(
                query,
              ),
        );
      },
      [
        workspace?.projects,
        projectSearch,
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
    setSearch("");
    setTeamFilter("all");
    setProjectFilter("all");
    setStatusFilter("all");
    setPriorityFilter("all");
    setOwnerFilter("all");
    setAssigneeFilter("all");
    setDeadlineFilter("all");
  }

  function openTask(
    taskId: string,
  ) {
    void navigate({
      search:
        (
          previous,
        ) => ({
          ...previous,
          task: taskId,
        }),
    });
  }

  function closeTask() {
    setTaskEditOpen(
      false,
    );

    void navigate({
      search:
        (
          previous,
        ) => {
          const next = {
            ...previous,
          };

          delete next.task;

          return next;
        },
    });
  }

  function openProject(
    projectId: string,
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
          task:
            undefined,
        }),
    });
  }

  function closeProjectPage() {
    setProjectEditOpen(
      false,
    );

    setMainView(
      "projects",
    );

    void navigate({
      search:
        (
          previous,
        ) => {
          const next = {
            ...previous,
          };

          delete next.project;
          delete next.task;

          return next;
        },
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
      <div className="surface-card mx-auto max-w-lg rounded-2xl p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-warning" />

        <p className="mt-3 font-medium">
          Tasks could not be loaded.
        </p>
      </div>
    );
  }

  const currentWorkspace =
    workspace;

  const managerTeams =
    currentWorkspace.role ===
    "admin"
      ? currentWorkspace.teams
      : currentWorkspace.teams.filter(
          (
            team,
          ) =>
            currentWorkspace.teamIds.includes(
              team.id,
            ),
        );

  const canCreate =
    currentWorkspace.role ===
      "admin" ||
    (
      currentWorkspace.role ===
        "team_lead" &&
      managerTeams.length >
        0
    );

  const filteredProject =
    projectFilter !==
      "all" &&
    projectFilter !==
      "none"
      ? currentWorkspace.projects.find(
          (
            project,
          ) =>
            project.id ===
            projectFilter,
        ) ??
        null
      : null;

  const projectPageTasks =
    selectedProject
      ? currentWorkspace.tasks.filter(
          (
            task,
          ) =>
            task.projectId ===
            selectedProject.id,
        )
      : [];

  function incompleteProjectTaskCount(
    projectId: string,
  ) {
    return currentWorkspace.tasks.filter(
      (
        task,
      ) =>
        task.projectId ===
          projectId &&
        task.status !==
          "Done",
    ).length;
  }

  function openNewTask(
    project?: TaskProject,
  ) {
    const base =
      defaultTaskForm(
        currentWorkspace.role,
        currentWorkspace.teamIds,
        currentWorkspace.currentUserId,
      );

    if (
      !project
    ) {
      setCreateForm(
        base,
      );

      setCreateOpen(
        true,
      );

      return;
    }

    const teamId =
      project.teamId ??
      "general";

    const eligiblePeople =
      project.teamId ===
      null
        ? currentWorkspace.people
        : currentWorkspace.people.filter(
            (
              person,
            ) =>
              person.teamIds.includes(
                project.teamId!,
              ),
          );

    const ownerId =
      eligiblePeople.some(
        (
          person,
        ) =>
          person.id ===
          project.ownerId,
      )
        ? project.ownerId
        : eligiblePeople.some(
              (
                person,
              ) =>
                person.id ===
                currentWorkspace.currentUserId,
            )
          ? currentWorkspace.currentUserId
          : eligiblePeople[0]
              ?.id ??
            "";

    const today =
      format(
        new Date(),
        "yyyy-MM-dd",
      );

    const defaultDeadline =
      project.deadline &&
      project.deadline >=
        today
        ? project.deadline
        : base.deadline;

    setCreateForm({
      ...base,
      teamId,
      projectId:
        project.id,
      ownerId,

      assigneeIds:
        ownerId
          ? [
              ownerId,
            ]
          : [],

      deadline:
        defaultDeadline,
    });

    setCreateOpen(
      true,
    );
  }

  function openNewProject() {
    setProjectForm(
      defaultProjectForm(
        currentWorkspace.role,
        currentWorkspace.teamIds,
        currentWorkspace.currentUserId,
      ),
    );

    setCreateProjectOpen(
      true,
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
      const result =
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

      openTask(
        result.id,
      );
    } catch (
      error
    ) {
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
    } catch (
      error
    ) {
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
      !editForm.deadline
    ) {
      toast.error(
        "Choose a deadline.",
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

      setTaskEditOpen(
        false,
      );

      await load();
    } catch (
      error
    ) {
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

  async function performQuickTaskStatus(
    task: TaskItem,
    status: TaskStatus,
    blockedReason = "",
  ) {
    const key =
      `task:${task.id}:status`;

    setQuickBusyKey(
      key,
    );

    try {
      await updateStatus({
        data: {
          taskId:
            task.id,

          status,
          blockedReason,
        },
      });

      toast.success(
        status ===
          "Done"
          ? "Task completed"
          : "Status updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update status.",
      );
    } finally {
      setQuickBusyKey(
        null,
      );
    }
  }

  function handleQuickTaskStatus(
    task: TaskItem,
    status: TaskStatus,
  ) {
    if (
      !task.canEditStatus ||
      task.status ===
        status
    ) {
      return;
    }

    if (
      status ===
      "Blocked"
    ) {
      setBlockedReasonDraft(
        task.blockedReason,
      );

      setBlockedPrompt({
        kind:
          "task",

        id:
          task.id,

        title:
          task.title,
      });

      return;
    }

    void performQuickTaskStatus(
      task,
      status,
    );
  }

  async function handleQuickTaskPriority(
    task: TaskItem,
    priority: TaskPriority,
  ) {
    if (
      !task.canEditDetails ||
      task.priority ===
        priority
    ) {
      return;
    }

    const key =
      `task:${task.id}:priority`;

    setQuickBusyKey(
      key,
    );

    try {
      await update({
        data:
          taskUpdateData(
            task,
            {
              priority,
            },
          ),
      });

      toast.success(
        "Priority updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update priority.",
      );
    } finally {
      setQuickBusyKey(
        null,
      );
    }
  }

  async function handleQuickTaskDeadline(
    task: TaskItem,
    deadline: string,
  ) {
    if (
      !task.canEditDetails ||
      !deadline ||
      task.deadline ===
        deadline
    ) {
      return;
    }

    const key =
      `task:${task.id}:deadline`;

    setQuickBusyKey(
      key,
    );

    try {
      await update({
        data:
          taskUpdateData(
            task,
            {
              deadline,
            },
          ),
      });

      toast.success(
        "Deadline updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update deadline.",
      );

      throw error;
    } finally {
      setQuickBusyKey(
        null,
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

      closeTask();

      await load();
    } catch (
      error
    ) {
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
      const result =
        await duplicate({
          data: {
            taskId:
              selectedTask.id,
          },
        });

      toast.success(
        "Task duplicated",
      );

      await load();

      openTask(
        result.id,
      );
    } catch (
      error
    ) {
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

      closeTask();

      await load();
    } catch (
      error
    ) {
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

  async function performProjectUpdate() {
    if (
      !selectedProject ||
      !projectEditForm
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

      setProjectEditOpen(
        false,
      );

      await load();
    } catch (
      error
    ) {
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
      projectEditForm.status ===
        "Done" &&
      selectedProject.status !==
        "Done" &&
      incompleteProjectTaskCount(
        selectedProject.id,
      ) >
        0
    ) {
      setPendingProjectCompletion({
        mode:
          "full",

        projectId:
          selectedProject.id,
      });

      return;
    }

    await performProjectUpdate();
  }

  async function performQuickProjectStatus(
    project: TaskProject,
    status: ProjectStatus,
    blockedReason = "",
  ) {
    const key =
      `project:${project.id}:status`;

    setQuickBusyKey(
      key,
    );

    try {
      await saveProjectStatus({
        data: {
          projectId:
            project.id,

          status,
          blockedReason,
        },
      });

      toast.success(
        status === "Done"
          ? "Project completed"
          : status === null
            ? "Project status cleared"
            : "Project status updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update project status.",
      );
    } finally {
      setQuickBusyKey(
        null,
      );
    }
  }

  function handleQuickProjectStatus(
    project: TaskProject,
    status: ProjectStatus,
  ) {
    if (
      !project.canEditStatus ||
      project.status ===
        status
    ) {
      return;
    }

    if (
      status ===
      "Blocked"
    ) {
      setBlockedReasonDraft(
        project.blockedReason,
      );

      setBlockedPrompt({
        kind:
          "project",

        id:
          project.id,

        title:
          project.name,
      });

      return;
    }

    if (
      status ===
        "Done" &&
      project.status !==
        "Done" &&
      incompleteProjectTaskCount(
        project.id,
      ) >
        0
    ) {
      setPendingProjectCompletion({
        mode:
          "quick",

        projectId:
          project.id,
      });

      return;
    }

    void performQuickProjectStatus(
      project,
      status,
    );
  }

  async function handleQuickProjectPriority(
    project: TaskProject,
    priority: TaskPriority,
  ) {
    if (
      !project.canEditDetails ||
      project.priority ===
        priority
    ) {
      return;
    }

    const key =
      `project:${project.id}:priority`;

    setQuickBusyKey(
      key,
    );

    try {
      await saveProject({
        data:
          projectUpdateData(
            project,
            {
              priority,
            },
          ),
      });

      toast.success(
        "Project priority updated",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update project priority.",
      );
    } finally {
      setQuickBusyKey(
        null,
      );
    }
  }

  async function handleQuickProjectDeadline(
    project: TaskProject,
    deadline: string,
  ) {
    if (
      !project.canEditDetails
    ) {
      return;
    }

    if (
      (
        project.deadline ??
        ""
      ) ===
      deadline
    ) {
      return;
    }

    const key =
      `project:${project.id}:deadline`;

    setQuickBusyKey(
      key,
    );

    try {
      await saveProject({
        data:
          projectUpdateData(
            project,
            {
              deadline,
            },
          ),
      });

      toast.success(
        deadline
          ? "Project deadline updated"
          : "Project deadline cleared",
      );

      await load();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not update project deadline.",
      );

      throw error;
    } finally {
      setQuickBusyKey(
        null,
      );
    }
  }

  async function submitBlockedPrompt() {
    if (
      !blockedPrompt
    ) {
      return;
    }

    const reason =
      blockedReasonDraft.trim();

    if (
      !reason
    ) {
      toast.error(
        "Add a reason before marking this item as Blocked.",
      );

      return;
    }

    const prompt =
      blockedPrompt;

    setBlockedPrompt(
      null,
    );

    setBlockedReasonDraft(
      "",
    );

    if (
      prompt.kind ===
      "task"
    ) {
      const task =
        currentWorkspace.tasks.find(
          (
            item,
          ) =>
            item.id ===
            prompt.id,
        );

      if (
        task
      ) {
        await performQuickTaskStatus(
          task,
          "Blocked",
          reason,
        );
      }

      return;
    }

    const project =
      currentWorkspace.projects.find(
        (
          item,
        ) =>
          item.id ===
          prompt.id,
      );

    if (
      project
    ) {
      await performQuickProjectStatus(
        project,
        "Blocked",
        reason,
      );
    }
  }

  async function confirmProjectCompletion() {
    if (
      !pendingProjectCompletion
    ) {
      return;
    }

    const pending =
      pendingProjectCompletion;

    const project =
      currentWorkspace.projects.find(
        (
          item,
        ) =>
          item.id ===
          pending.projectId,
      );

    setPendingProjectCompletion(
      null,
    );

    if (
      !project
    ) {
      return;
    }

    if (
      pending.mode ===
      "quick"
    ) {
      await performQuickProjectStatus(
        project,
        "Done",
      );

      return;
    }

    await performProjectUpdate();
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
    } catch (
      error
    ) {
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
    body: string,
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
    body: string,
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
      currentWorkspace.role !==
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
        `Google Sheets synced - ${result.projects} projects, ${result.tasks} tasks, ${result.updates} updates`,
      );
    } catch (
      error
    ) {
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
    person: TaskPerson,
    enabled: boolean,
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

  const taskCardActions:
    TaskCardActions = {
      busyKey:
        quickBusyKey,

      onStatusChange:
        handleQuickTaskStatus,

      onPriorityChange:
        (
          task,
          priority,
        ) =>
          void handleQuickTaskPriority(
            task,
            priority,
          ),

      onDeadlineChange:
        handleQuickTaskDeadline,
    };

  const projectCardActions:
    ProjectCardActions = {
      busyKey:
        quickBusyKey,

      onStatusChange:
        handleQuickProjectStatus,

      onPriorityChange:
        (
          project,
          priority,
        ) =>
          void handleQuickProjectPriority(
            project,
            priority,
          ),

      onDeadlineChange:
        handleQuickProjectDeadline,
    };

  const incompleteForConfirmation =
    pendingProjectCompletion
      ? incompleteProjectTaskCount(
          pendingProjectCompletion.projectId,
        )
      : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-28 md:pb-10">
      {projectPageId ? (
        selectedProject ? (
          <ProjectWorkspaceView
            project={
              selectedProject
            }
            tasks={
              projectPageTasks
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
              openTask
            }
            onAddUpdate={
              handleAddProjectUpdate
            }
            taskActions={
              taskCardActions
            }
            projectActions={
              projectCardActions
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
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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
                    currentWorkspace.role,
                  )}
                </Badge>
              </div>

              <p className="mt-1 text-sm text-muted-foreground">
                See what needs attention and update work quickly.
              </p>
            </div>

            {currentWorkspace.role ===
              "admin" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  size="sm"
                  onClick={() =>
                    setTeamLeadsOpen(
                      true,
                    )
                  }
                >
                  <ShieldCheck className="size-4" />
                  Team Leads
                </Button>
              </div>
            )}
          </div>

          {currentWorkspace.role ===
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

          <div className="grid grid-cols-4 gap-2">
            <SummaryCard
              label="Open"
              value={
                summary.open
              }
            />

            <SummaryCard
              label="Soon"
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

          <Tabs
            value={
              mainView
            }
            onValueChange={(
              value,
            ) =>
              setMainView(
                value as MainView,
              )
            }
          >
            <TabsList className="grid w-full grid-cols-2 rounded-2xl">
              <TabsTrigger
                value="tasks"
                className="rounded-xl"
              >
                <ClipboardList className="mr-2 size-4" />
                Tasks
              </TabsTrigger>

              <TabsTrigger
                value="projects"
                className="rounded-xl"
              >
                <FolderKanban className="mr-2 size-4" />
                Projects
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {mainView ===
          "tasks" ? (
            <section className="space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                    <Input
                      className="pl-9"
                      placeholder="Search tasks…"
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
                    size="icon"
                    className="shrink-0"
                    aria-label="Filters"
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
                  </Button>

                  {(
                    activeFilterCount >
                      0 ||
                    search
                  ) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label="Clear filters"
                      onClick={
                        clearFilters
                      }
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </div>

                {activeFilterCount >
                  0 && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {activeFilterCount} filter
                    {activeFilterCount ===
                    1
                      ? ""
                      : "s"}{" "}
                    active
                  </p>
                )}
              </div>

              {filtersOpen && (
                <div className="surface-card grid gap-3 rounded-2xl p-3 sm:grid-cols-2 lg:grid-cols-4">
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

                      ...currentWorkspace.teams.map(
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

                      ...currentWorkspace.projects.map(
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

                      ...currentWorkspace.people.map(
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

                      ...currentWorkspace.people.map(
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
                        value as DeadlineFilter,
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

              <Tabs
                value={
                  tab
                }
                onValueChange={(
                  value,
                ) =>
                  setTab(
                    value as TaskTab,
                  )
                }
              >
                <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-2xl p-1 sm:grid sm:grid-cols-4">
                  <TabsTrigger
                    value="my"
                    className="min-w-[6.5rem] shrink-0 rounded-xl sm:min-w-0"
                  >
                    My
                    <span className="ml-1 text-[10px] opacity-60">
                      {myTasks.length}
                    </span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="team"
                    className="min-w-[6.5rem] shrink-0 rounded-xl sm:min-w-0"
                  >
                    Team
                    <span className="ml-1 text-[10px] opacity-60">
                      {teamTasks.length}
                    </span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="all"
                    className="min-w-[6.5rem] shrink-0 rounded-xl sm:min-w-0"
                  >
                    All
                    <span className="ml-1 text-[10px] opacity-60">
                      {allTasks.length}
                    </span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="done"
                    className="min-w-[6.5rem] shrink-0 rounded-xl sm:min-w-0"
                  >
                    Done
                    <span className="ml-1 text-[10px] opacity-60">
                      {doneTasks.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {filteredProject && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Project filter
                    </p>

                    <p className="truncate text-xs font-medium">
                      {
                        filteredProject.name
                      }
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 rounded-lg px-2 text-xs"
                    onClick={() =>
                      setProjectFilter(
                        "all",
                      )
                    }
                  >
                    <X className="size-3.5" />
                    Clear
                  </Button>
                </div>
              )}

              <TaskList
                tasks={
                  filteredTasks
                }
                emptyTitle={
                  tab ===
                  "my"
                    ? "No tasks assigned to you"
                    : tab ===
                        "team"
                      ? "No team tasks"
                      : tab ===
                          "done"
                        ? "Nothing completed yet"
                        : "No open tasks"
                }
                emptyText={
                  tab ===
                  "my"
                    ? "You're all caught up."
                    : tab ===
                        "team"
                      ? "There are no open tasks for your teams."
                      : tab ===
                          "done"
                        ? "Completed tasks will appear here."
                        : "There are no active tasks matching these filters."
                }
                onOpen={
                  openTask
                }
                actions={
                  taskCardActions
                }
              />
            </section>
          ) : (
            <section className="space-y-4">
              <div>
                <h2 className="flex items-center gap-2 font-semibold">
                  <FolderKanban className="size-4 text-primary" />
                  Projects
                </h2>

                <p className="mt-1 text-xs text-muted-foreground">
                  Open a project for its tasks, progress and updates.
                </p>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />

                <Input
                  className="pl-9"
                  placeholder="Search projects…"
                  value={
                    projectSearch
                  }
                  onChange={(
                    event,
                  ) =>
                    setProjectSearch(
                      event.target.value,
                    )
                  }
                />
              </div>

              {visibleProjects.length ===
              0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <FolderKanban className="mx-auto size-7 text-muted-foreground" />

                  <p className="mt-3 font-medium">
                    No projects found
                  </p>

                  <p className="mt-1 text-sm text-muted-foreground">
                    Try another search or create a new project.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2 lg:grid-cols-2">
                  {visibleProjects.map(
                    (
                      project,
                    ) => (
                      <ProjectRow
                        key={
                          project.id
                        }
                        project={
                          project
                        }
                        tasks={currentWorkspace.tasks.filter(
                          (
                            task,
                          ) =>
                            task.projectId ===
                            project.id,
                        )}
                        onOpen={() =>
                          openProject(
                            project.id,
                          )
                        }
                        actions={
                          projectCardActions
                        }
                      />
                    ),
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}

      {canCreate && (
        <FloatingCreateMenu
          onNewTask={() =>
            openNewTask(
              projectPageId &&
                selectedProject
                ?.canEditDetails
                ? selectedProject
                : undefined,
            )
          }
          onNewProject={
            openNewProject
          }
        />
      )}

      <Dialog
        open={
          createProjectOpen
        }
        onOpenChange={
          setCreateProjectOpen
        }
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-3xl p-4 sm:max-w-xl sm:p-6">
          <DialogHeader>
            <DialogTitle>
              New Project
            </DialogTitle>

            <DialogDescription>
              Create a project and choose who owns it.
            </DialogDescription>
          </DialogHeader>

          <ProjectForm
            value={
              projectForm
            }
            onChange={
              setProjectForm
            }
            role={
              currentWorkspace.role
            }
            currentUserId={
              currentWorkspace.currentUserId
            }
            teams={
              managerTeams
            }
            people={
              currentWorkspace.people
            }
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={
                saving
              }
              onClick={() =>
                setCreateProjectOpen(
                  false,
                )
              }
            >
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                saving
              }
              onClick={() =>
                void handleCreateProject()
              }
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderPlus className="size-4" />
              )}

              {saving
                ? "Creating…"
                : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          createOpen
        }
        onOpenChange={
          setCreateOpen
        }
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-3xl p-4 sm:max-w-xl sm:p-6">
          <DialogHeader>
            <DialogTitle>
              New Task
            </DialogTitle>

            <DialogDescription>
              Add the work, owner, assignees and deadline.
            </DialogDescription>
          </DialogHeader>

          <TaskForm
            value={
              createForm
            }
            onChange={
              setCreateForm
            }
            role={
              currentWorkspace.role
            }
            currentUserId={
              currentWorkspace.currentUserId
            }
            teams={
              managerTeams
            }
            projects={
              currentWorkspace.projects
            }
            people={
              currentWorkspace.people
            }
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={
                saving
              }
              onClick={() =>
                setCreateOpen(
                  false,
                )
              }
            >
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                saving
              }
              onClick={() =>
                void handleCreate()
              }
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}

              {saving
                ? "Creating…"
                : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
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
            closeTask();
          }
        }}
      >
        <DialogContent className="max-h-[80dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-x-hidden overflow-y-auto rounded-3xl p-4 sm:p-5">
          {selectedTask &&
            editForm && (
              <>
                <DialogHeader className="pr-8 text-left">
                  <DialogTitle className="break-words text-left text-base leading-snug sm:text-lg">
                    {
                      selectedTask.title
                    }
                  </DialogTitle>

                  <DialogDescription className="text-left">
                    {taskEditOpen
                      ? "Edit task details."
                      : selectedTask.projectName ??
                        selectedTask.teamName}
                  </DialogDescription>
                </DialogHeader>

                {taskEditOpen &&
                selectedTask.canEditDetails ? (
                  <div className="space-y-4">
                    <TaskForm
                      value={
                        editForm
                      }
                      onChange={
                        setEditForm
                      }
                      role={
                        currentWorkspace.role
                      }
                      currentUserId={
                        currentWorkspace.currentUserId
                      }
                      teams={
                        managerTeams
                      }
                      projects={
                        currentWorkspace.projects
                      }
                      people={
                        currentWorkspace.people
                      }
                    />

                    <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-5 sm:px-5">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 rounded-xl"
                        disabled={
                          saving
                        }
                        onClick={() => {
                          setEditForm(
                            taskToForm(
                              selectedTask,
                            ),
                          );

                          setTaskEditOpen(
                            false,
                          );
                        }}
                      >
                        Cancel
                      </Button>

                      <Button
                        type="button"
                        className="flex-1 rounded-xl"
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
                          "Save"
                        )}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
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
                        size="sm"
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

                    {currentWorkspace.role ===
                      "admin" && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="w-full"
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
                ) : (
                  <TaskQuickView
  task={
    selectedTask
  }
  people={
    currentWorkspace.people.filter(
      (
        person,
      ) =>
        person.id !==
        currentWorkspace.currentUserId,
    )
  }
  actions={
    taskCardActions
  }
  onEdit={
    selectedTask.canEditDetails
      ? () =>
          setTaskEditOpen(
            true,
          )
      : undefined
  }
  onDone={
    selectedTask.canEditStatus &&
    selectedTask.status !==
      "Done"
      ? () =>
          handleQuickTaskStatus(
            selectedTask,
            "Done",
          )
      : undefined
  }
  onAddUpdate={
    handleAddTaskUpdate
  }
/>
            )}
        </DialogContent>
      </Dialog>

      <Sheet
        open={
          Boolean(
            selectedProject,
          ) &&
          projectEditOpen
        }
        onOpenChange={
          setProjectEditOpen
        }
      >
        <SheetContent className="w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] overflow-y-auto rounded-l-3xl p-4 sm:w-full sm:max-w-xl sm:p-6">
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

                <p className="mt-2 text-sm text-muted-foreground">
                  Edit project details.
                </p>

                <div className="mt-5 space-y-5">
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
                          currentWorkspace.role
                        }
                        currentUserId={
                          currentWorkspace.currentUserId
                        }
                        teams={
                          managerTeams
                        }
                        people={
                          currentWorkspace.people
                        }
                      />

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
                          : "Save Project"}
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
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
                    </>
                  ) : (
                    <>
                      <ProjectReadOnlyDetails
                        project={
                          selectedProject
                        }
                      />

                      {selectedProject.canEditStatus && (
                        <div className="space-y-2">
                          <Label>
                            Status
                          </Label>

                          <InlineProjectStatusEditor
                            status={
                              selectedProject.status
                            }
                            canEdit
                            saving={
                              quickBusyKey ===
                              `project:${selectedProject.id}:status`
                            }
                            onChange={(
                              status,
                            ) =>
                              handleQuickProjectStatus(
                                selectedProject,
                                status,
                              )
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={
          Boolean(
            blockedPrompt,
          )
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open
          ) {
            setBlockedPrompt(
              null,
            );

            setBlockedReasonDraft(
              "",
            );
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Mark as Blocked?
            </DialogTitle>

            <DialogDescription>
              {blockedPrompt
                ? `Add a blocker for “${blockedPrompt.title}”.`
                : "Add a blocker."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="quick-blocked-reason">
              Why is this blocked?
            </Label>

            <Textarea
              id="quick-blocked-reason"
              rows={4}
              maxLength={500}
              className="resize-none rounded-2xl"
              placeholder="Waiting for supplier approval…"
              value={
                blockedReasonDraft
              }
              onChange={(
                event,
              ) =>
                setBlockedReasonDraft(
                  event.target.value,
                )
              }
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setBlockedPrompt(
                  null,
                )
              }
            >
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                !blockedReasonDraft.trim() ||
                Boolean(
                  quickBusyKey,
                )
              }
              onClick={() =>
                void submitBlockedPrompt()
              }
            >
              Mark Blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={
          Boolean(
            pendingProjectCompletion,
          )
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open
          ) {
            setPendingProjectCompletion(
              null,
            );
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Complete project?
            </AlertDialogTitle>

            <AlertDialogDescription>
              {incompleteForConfirmation} task
              {incompleteForConfirmation ===
              1
                ? " is"
                : "s are"}{" "}
              still incomplete.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={
                saving ||
                Boolean(
                  quickBusyKey,
                )
              }
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              disabled={
                saving ||
                Boolean(
                  quickBusyKey,
                )
              }
              onClick={() =>
                void confirmProjectCompletion()
              }
            >
              Mark Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
            Team Leads can create and manage tasks and projects for their teams.
          </p>

          <div className="mt-6 space-y-2">
            {currentWorkspace.people
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
                                    currentWorkspace.teams.find(
                                      (
                                        team,
                                      ) =>
                                        team.id ===
                                        teamId,
                                    )
                                      ?.name,
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
  actions,
}: {
  tasks: TaskItem[];
  emptyTitle: string;
  emptyText: string;
  onOpen: (id: string) => void;
  actions: TaskCardActions;
}) {
  if (
    tasks.length ===
    0
  ) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-10 text-center">
        <ClipboardList className="mx-auto size-7 text-muted-foreground" />

        <p className="mt-3 font-medium">
          {emptyTitle}
        </p>

        <p className="mt-1 px-4 text-sm text-muted-foreground">
          {emptyText}
        </p>
      </div>
    );
  }

  const groups =
    groupTasks(
      tasks,
    );

  return (
    <div className="space-y-5">
      {groups.map(
        (
          group,
        ) => (
          <section
            key={
              group.key
            }
            className="space-y-2"
          >
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <p
                  className={cn(
                    "text-xs font-semibold uppercase tracking-wide",

                    group.key ===
                      "attention"
                      ? "text-destructive"
                      : "text-foreground",
                  )}
                >
                  {group.label} ·{" "}
                  {
                    group.tasks
                      .length
                  }
                </p>

                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {
                    group.subtitle
                  }
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              {group.tasks.map(
                (
                  task,
                ) => (
                  <TaskRow
                    key={
                      task.id
                    }
                    task={
                      task
                    }
                    onOpen={() =>
                      onOpen(
                        task.id,
                      )
                    }
                    actions={
                      actions
                    }
                  />
                ),
              )}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

function TaskRow({
  task,
  onOpen,
  actions,
}: {
  task: TaskItem;
  onOpen: () => void;
  actions: TaskCardActions;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group min-w-0 cursor-pointer rounded-xl border bg-card px-3 py-2.5 shadow-sm transition-colors hover:bg-muted/30 sm:px-3.5",

        task.status !==
          "Done" &&
          deadlineDays(
            task.deadline,
          ) <
            0 &&
          "border-destructive/25",

        task.status ===
          "Done" &&
          "opacity-70",
      )}
      onClick={
        onOpen
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

          onOpen();
        }
      }}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p
            className={cn(
              "min-w-0 flex-1 break-words text-sm font-semibold leading-5",

              task.status ===
                "Done" &&
                "line-through decoration-muted-foreground/40",
            )}
          >
            {
              task.title
            }
          </p>

          <div
            className="shrink-0"
            onClick={
              stopInteractiveEvent
            }
            onPointerDown={
              stopInteractiveEvent
            }
          >
            <InlinePriorityEditor
              priority={
                task.priority
              }
              canEdit={
                task.canEditDetails
              }
              saving={
                actions.busyKey ===
                `task:${task.id}:priority`
              }
              onChange={(
                priority,
              ) =>
                actions.onPriorityChange(
                  task,
                  priority,
                )
              }
            />
          </div>
        </div>

        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground sm:text-[11px]">
          {task.projectName ? (
            <span className="inline-flex max-w-[11rem] items-center gap-1 truncate">
              <FolderKanban className="size-3 shrink-0" />

              {
                task.projectName
              }
            </span>
          ) : (
            <span className="truncate">
              {
                task.teamName
              }
            </span>
          )}

          <span className="text-border">
            ·
          </span>

          <span className="min-w-0 truncate">
            <span className="font-medium text-foreground">
              {
                task.ownerName
              }
            </span>

            {task.assignees.length >
              1 &&
              ` +${task.assignees.length - 1}`}
          </span>
        </div>

        <div
          className="mt-2 flex flex-wrap items-center gap-1.5"
          onClick={
            stopInteractiveEvent
          }
          onPointerDown={
            stopInteractiveEvent
          }
        >
          <InlineDeadlineEditor
            deadline={
              task.deadline
            }
            status={
              task.status
            }
            canEdit={
              task.canEditDetails
            }
            saving={
              actions.busyKey ===
              `task:${task.id}:deadline`
            }
            compact
            onChange={(
              value,
            ) =>
              actions.onDeadlineChange(
                task,
                value,
              )
            }
          />

          <InlineStatusEditor
            status={
              task.status
            }
            canEdit={
              task.canEditStatus
            }
            saving={
              actions.busyKey ===
              `task:${task.id}:status`
            }
            onChange={(
              status,
            ) =>
              actions.onStatusChange(
                task,
                status,
              )
            }
          />
        </div>

        {task.status ===
          "Blocked" &&
          task.blockedReason && (
            <p className="mt-1.5 line-clamp-1 text-[10px] text-destructive">
              {
                task.blockedReason
              }
            </p>
          )}
      </div>
    </div>
  );
}

function TaskQuickView({
  task,
  people,
  actions,
  onEdit,
  onDone,
  onAddUpdate,
}: {
  task: TaskItem;
  people: TaskPerson[];
  actions: TaskCardActions;
  onEdit?: () => void;
  onDone?: () => void;
  onAddUpdate: (
    body: string,
  ) => Promise<void>;
}) {
  const deadline =
    deadlineInfo(
      task.deadline,
      task.status,
    );

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <InlineStatusEditor
            status={
              task.status
            }
            canEdit={
              task.canEditStatus
            }
            saving={
              actions.busyKey ===
              `task:${task.id}:status`
            }
            onChange={(
              status,
            ) =>
              actions.onStatusChange(
                task,
                status,
              )
            }
          />

          <InlinePriorityEditor
            priority={
              task.priority
            }
            canEdit={
              task.canEditDetails
            }
            saving={
              actions.busyKey ===
              `task:${task.id}:priority`
            }
            onChange={(
              priority,
            ) =>
              actions.onPriorityChange(
                task,
                priority,
              )
            }
          />

          <InlineDeadlineEditor
            deadline={
              task.deadline
            }
            status={
              task.status
            }
            canEdit={
              task.canEditDetails
            }
            saving={
              actions.busyKey ===
              `task:${task.id}:deadline`
            }
            onChange={(
              value,
            ) =>
              actions.onDeadlineChange(
                task,
                value,
              )
            }
          />
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <QuickMeta
            label="Owner"
            value={
              task.ownerName
            }
            icon={
              <UserRound className="size-3.5" />
            }
          />

          <QuickMeta
            label="Team"
            value={
              task.teamName
            }
            icon={
              <Users className="size-3.5" />
            }
          />

          {task.projectName && (
            <QuickMeta
              label="Project"
              value={
                task.projectName
              }
              icon={
                <FolderKanban className="size-3.5" />
              }
            />
          )}

          <QuickMeta
            label="Deadline"
            value={
              deadline.text
            }
            valueClassName={
              deadline.className
            }
            icon={
              <CalendarClock className="size-3.5" />
            }
          />
        </div>

        {task.status ===
          "Blocked" &&
          task.blockedReason && (
            <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                Blocked
              </p>

              <p className="mt-1 text-xs">
                <LinkifiedText
                  text={
                    task.blockedReason
                  }
                />
              </p>
            </div>
          )}
      </div>

      {task.description && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Description
          </p>

          <div className="mt-1.5 text-sm leading-relaxed">
            <LinkifiedText
              text={
                task.description
              }
            />
          </div>
        </div>
      )}

      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Assigned
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {task.assignees.length ===
          0 ? (
            <span className="text-xs text-muted-foreground">
              No assignees
            </span>
          ) : (
            task.assignees.map(
              (
                assignee,
              ) => (
                <Badge
                  key={
                    assignee.id
                  }
                  variant="secondary"
                  className="rounded-full font-normal"
                >
                  {
                    assignee.name
                  }
                </Badge>
              ),
            )
          )}
        </div>
      </div>

      <WorkUpdatesPanel
        title="Updates"
        description="Progress, notes and work logged from The Clock."
        updates={
          task.updates
        }
        people={
          people
        }
        canAdd={
          task.canEditStatus
        }
        onAdd={
          onAddUpdate
        }
        emptyText="No updates yet."
        compact
      />

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t bg-background/95 px-4 pb-1 pt-3 backdrop-blur sm:-mx-5 sm:px-5">
        {onDone && (
          <Button
            type="button"
            className="flex-1 rounded-xl"
            disabled={
              actions.busyKey ===
              `task:${task.id}:status`
            }
            onClick={
              onDone
            }
          >
            <CheckCircle2 className="size-4" />
            Done
          </Button>
        )}

        {onEdit && (
          <Button
            type="button"
            variant={
              onDone
                ? "outline"
                : "default"
            }
            className="flex-1 rounded-xl"
            onClick={
              onEdit
            }
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

function QuickMeta({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>

      <div
        className={cn(
          "mt-0.5 truncate text-xs font-medium",
          valueClassName,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ProjectRow({
  project,
  tasks,
  onOpen,
  actions,
}: {
  project: TaskProject;
  tasks: TaskItem[];
  onOpen: () => void;
  actions: ProjectCardActions;
}) {
  const done =
    tasks.filter(
      (
        task,
      ) =>
        task.status ===
        "Done",
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

  const blocked =
    tasks.filter(
      (
        task,
      ) =>
        task.status ===
        "Blocked",
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

  return (
    <div
      role="button"
      tabIndex={0}
      className="cursor-pointer rounded-xl border bg-card px-3 py-3 shadow-sm transition-colors hover:bg-muted/30"
      onClick={
        onOpen
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
          onOpen();
        }
      }}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {
              project.name
            }
          </p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span>
              {progress}% complete
            </span>

            {overdue >
              0 && (
              <>
                <span>
                  ·
                </span>

                <span className="font-medium text-destructive">
                  {overdue} overdue
                </span>
              </>
            )}

            {blocked >
              0 && (
              <>
                <span>
                  ·
                </span>

                <span className="font-medium text-destructive">
                  {blocked} blocked
                </span>
              </>
            )}
          </div>
        </div>

        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{
            width:
              `${progress}%`,
          }}
        />
      </div>

      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
        <div
          onClick={
            stopInteractiveEvent
          }
          onPointerDown={
            stopInteractiveEvent
          }
        >
          <InlineDeadlineEditor
            deadline={
              project.deadline ??
              ""
            }
            status={
              project.status
            }
            optional
            compact
            canEdit={
              project.canEditDetails
            }
            saving={
              actions.busyKey ===
              `project:${project.id}:deadline`
            }
            onChange={(
              deadline,
            ) =>
              actions.onDeadlineChange(
                project,
                deadline,
              )
            }
          />
        </div>

        <div
          onClick={
            stopInteractiveEvent
          }
          onPointerDown={
            stopInteractiveEvent
          }
        >
          <InlinePriorityEditor
            priority={
              project.priority
            }
            canEdit={
              project.canEditDetails
            }
            saving={
              actions.busyKey ===
              `project:${project.id}:priority`
            }
            onChange={(
              priority,
            ) =>
              actions.onPriorityChange(
                project,
                priority,
              )
            }
          />
        </div>

        <div
          onClick={
            stopInteractiveEvent
          }
          onPointerDown={
            stopInteractiveEvent
          }
        >
          <InlineProjectStatusEditor
            status={
              project.status
            }
            canEdit={
              project.canEditStatus
            }
            saving={
              actions.busyKey ===
              `project:${project.id}:status`
            }
            onChange={(
              status,
            ) =>
              actions.onStatusChange(
                project,
                status,
              )
            }
          />
        </div>
      </div>

      <p className="mt-2 min-w-0 truncate text-[10px] text-muted-foreground">
        {
          project.ownerName
        }{" "}
        ·{" "}
        {
          project.teamName
        }{" "}
        ·{" "}
        {
          tasks.length
        }{" "}
        task
        {tasks.length ===
        1
          ? ""
          : "s"}
      </p>
    </div>
  );
}

function ProjectWorkspaceView({
  project,
  tasks,
  onBack,
  onEdit,
  onOpenTask,
  onAddUpdate,
  taskActions,
  projectActions,
}: {
  project: TaskProject;
  tasks: TaskItem[];
  onBack: () => void;
  onEdit: () => void;
  onOpenTask: (id: string) => void;
  onAddUpdate: (body: string) => Promise<void>;
  taskActions: TaskCardActions;
  projectActions: ProjectCardActions;
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

  const canOpenEditor =
    project.canEditDetails ||
    project.canEditStatus;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={
            onBack
          }
        >
          <ChevronLeft className="size-4" />
          Projects
        </Button>

        {canOpenEditor && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={
              onEdit
            }
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <div>
          <h1 className="break-words text-xl font-semibold sm:text-3xl">
            {
              project.name
            }
          </h1>

          {project.description && (
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              <LinkifiedText
                text={
                  project.description
                }
              />
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <InlineProjectStatusEditor
            status={
              project.status
            }
            canEdit={
              project.canEditStatus
            }
            saving={
              projectActions.busyKey ===
              `project:${project.id}:status`
            }
            onChange={(
              status,
            ) =>
              projectActions.onStatusChange(
                project,
                status,
              )
            }
          />

          <InlinePriorityEditor
            priority={
              project.priority
            }
            canEdit={
              project.canEditDetails
            }
            saving={
              projectActions.busyKey ===
              `project:${project.id}:priority`
            }
            onChange={(
              priority,
            ) =>
              projectActions.onPriorityChange(
                project,
                priority,
              )
            }
          />

          <InlineDeadlineEditor
            deadline={
              project.deadline ??
              ""
            }
            status={
              project.status
            }
            optional
            canEdit={
              project.canEditDetails
            }
            saving={
              projectActions.busyKey ===
              `project:${project.id}:deadline`
            }
            onChange={(
              deadline,
            ) =>
              projectActions.onDeadlineChange(
                project,
                deadline,
              )
            }
          />
        </div>

        <div className="rounded-2xl border bg-card p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <p className="font-medium">
                {progress}% complete
              </p>

              <p className="mt-0.5 truncate text-muted-foreground">
                {done} of{" "}
                {
                  tasks.length
                }{" "}
                tasks done
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {overdue >
                0 && (
                <Badge
                  variant="outline"
                  className="rounded-full border-destructive/30 bg-destructive/5 text-[10px] text-destructive"
                >
                  {overdue} overdue
                </Badge>
              )}

              {blocked >
                0 && (
                <Badge
                  variant="outline"
                  className="rounded-full border-destructive/30 bg-destructive/5 text-[10px] text-destructive"
                >
                  {blocked} blocked
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{
                width:
                  `${progress}%`,
              }}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3" />
              {
                project.ownerName
              }
            </span>

            <span className="inline-flex items-center gap-1">
              <Users className="size-3" />
              {
                project.teamName
              }
            </span>
          </div>

          {project.status ===
            "Blocked" &&
            project.blockedReason && (
              <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
                  Blocked
                </p>

                <p className="mt-1 text-xs">
                  <LinkifiedText
                    text={
                      project.blockedReason
                    }
                  />
                </p>
              </div>
            )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <ClipboardList className="size-4 text-primary" />
              Tasks
            </h2>

            <p className="mt-0.5 text-xs text-muted-foreground">
              Work linked to this project.
            </p>
          </div>
        </div>

        <TaskList
          tasks={
            sortedTasks
          }
          emptyTitle="No tasks yet"
          emptyText="Use the + button to create the first task in this project."
          onOpen={
            onOpenTask
          }
          actions={
            taskActions
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
        Back to Projects
      </Button>
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
  onAdd: (
    body: string,
  ) => Promise<void>;
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
    useMemo(
      () => {
        const items =
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

      setText("");

      toast.success(
        "Project update added",
      );
    } catch (
      error
    ) {
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
          Activity
        </h2>

        <p className="mt-0.5 text-xs text-muted-foreground">
          Project and task updates.
        </p>
      </div>

      {canAdd && (
        <div className="rounded-xl border bg-card p-3">
          <Textarea
            rows={2}
            maxLength={2000}
            className="resize-none rounded-xl"
            placeholder="Add an update…"
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
                : "Add update"}
            </Button>
          </div>
        </div>
      )}

      {activity.length ===
      0 ? (
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          No project or task updates yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {activity.map(
            (
              update,
            ) => (
              <div
                key={`${update.context}-${update.id}`}
                className="rounded-xl border bg-card p-3"
              >
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {
                      update.authorName
                    }
                  </span>

                  <span>
                    ·
                  </span>

                  <span className="max-w-[10rem] truncate">
                    {
                      update.context
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
                      className="rounded-full px-1.5 py-0 text-[9px]"
                    >
                      <Timer className="mr-1 size-2.5" />
                      Clock
                    </Badge>
                  )}
                </div>

                <p className="mt-1.5 text-xs sm:text-sm">
                  <LinkifiedText
                    text={
                      update.body
                    }
                  />
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </section>
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
    <div className="rounded-2xl bg-muted/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
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
            projectStatusClass(
              project.status,
            ),
          )}
        >
          {project.status ??
            "No status"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <QuickMeta
          label="Owner"
          value={
            project.ownerName
          }
          icon={
            <UserRound className="size-3.5" />
          }
        />

        <QuickMeta
          label="Deadline"
          value={
            deadline.text
          }
          valueClassName={
            deadline.className
          }
          icon={
            <CalendarClock className="size-3.5" />
          }
        />

        <QuickMeta
          label="Team"
          value={
            project.teamName
          }
          icon={
            <Users className="size-3.5" />
          }
        />

        <QuickMeta
          label="Progress"
          value={
            tasks.length ===
            0
              ? "No tasks"
              : `${done}/${tasks.length} · ${progress}%`
          }
          icon={
            <CheckCircle2 className="size-3.5" />
          }
        />
      </div>
    </div>
  );
}

function ProjectReadOnlyDetails({
  project,
}: {
  project: TaskProject;
}) {
  const deadline =
    optionalDeadlineInfo(
      project.deadline,
      project.status,
    );

  return (
    <div className="space-y-4">
      {project.description && (
        <div>
          <Label>
            Description
          </Label>

          <div className="mt-2 rounded-2xl bg-muted/50 p-3 text-sm">
            <LinkifiedText
              text={
                project.description
              }
            />
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>
            Owner
          </Label>

          <p className="mt-2 rounded-xl bg-muted/50 p-3 text-sm">
            {
              project.ownerName
            }
          </p>
        </div>

        <div>
          <Label>
            Deadline
          </Label>

          <p
            className={cn(
              "mt-2 rounded-xl bg-muted/50 p-3 text-sm",
              deadline.className,
            )}
          >
            {
              deadline.text
            }
          </p>
        </div>
      </div>
    </div>
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
    <div
      className={cn(
        "rounded-xl border bg-card px-2 py-2.5 text-center shadow-sm sm:px-3 sm:py-3",

        danger &&
          "border-destructive/25 bg-destructive/[0.03]",
      )}
    >
      <p
        className={cn(
          "text-lg font-semibold leading-none sm:text-xl",

          danger &&
            "text-destructive",
        )}
      >
        {value}
      </p>

      <p className="mt-1 truncate text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">
        {label}
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
  onChange: (
    value: string,
  ) => void;
  items: {
    value: string;
    label: string;
  }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">
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
        <SelectTrigger className="h-9">
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

function stopInteractiveEvent(
  event: {
    stopPropagation: () => void;
  },
) {
  event.stopPropagation();
}

function InlineStatusEditor({
  status,
  canEdit,
  saving,
  onChange,
}: {
  status: TaskStatus;
  canEdit: boolean;
  saving: boolean;
  onChange: (
    status: TaskStatus,
  ) => void;
}) {
  if (
    !canEdit
  ) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-6 rounded-full px-2 py-0 text-[9px] font-medium sm:text-[10px]",
          statusClass(
            status,
          ),
        )}
      >
        {status}
      </Badge>
    );
  }

  return (
    <div
      onClick={
        stopInteractiveEvent
      }
      onPointerDown={
        stopInteractiveEvent
      }
      onKeyDown={
        stopInteractiveEvent
      }
    >
      <Select
        value={
          status
        }
        disabled={
          saving
        }
        onValueChange={(
          value,
        ) =>
          onChange(
            value as TaskStatus,
          )
        }
      >
        <SelectTrigger
          aria-label="Change status"
          className={cn(
            "h-6 w-auto min-w-0 gap-1 rounded-full px-2 py-0 text-[9px] font-medium shadow-none sm:text-[10px] [&>svg]:size-3",
            statusClass(
              status,
            ),
          )}
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <SelectValue />
          )}
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
                {item}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineProjectStatusEditor({
  status,
  canEdit,
  saving,
  onChange,
}: {
  status: ProjectStatus;
  canEdit: boolean;
  saving: boolean;
  onChange: (
    status: ProjectStatus,
  ) => void;
}) {
  if (
    !canEdit
  ) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-6 rounded-full px-2 py-0 text-[9px] font-medium sm:text-[10px]",
          projectStatusClass(
            status,
          ),
        )}
      >
        {status ??
          "No status"}
      </Badge>
    );
  }

  return (
    <div
      onClick={
        stopInteractiveEvent
      }
      onPointerDown={
        stopInteractiveEvent
      }
      onKeyDown={
        stopInteractiveEvent
      }
    >
      <Select
        value={
          status ??
          "none"
        }
        disabled={
          saving
        }
        onValueChange={(
          value,
        ) =>
          onChange(
            value === "none"
              ? null
              : value as TaskStatus,
          )
        }
      >
        <SelectTrigger
          aria-label="Change project status"
          className={cn(
            "h-6 w-auto min-w-0 gap-1 rounded-full px-2 py-0 text-[9px] font-medium shadow-none sm:text-[10px] [&>svg]:size-3",
            projectStatusClass(
              status,
            ),
          )}
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>

        <SelectContent>
          <SelectItem value="none">
            No status
          </SelectItem>

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
                {item}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlinePriorityEditor({
  priority,
  canEdit,
  saving,
  onChange,
}: {
  priority: TaskPriority;
  canEdit: boolean;
  saving: boolean;
  onChange: (
    priority: TaskPriority,
  ) => void;
}) {
  if (
    !canEdit
  ) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "h-6 rounded-full px-2 py-0 text-[9px] font-medium sm:text-[10px]",
          priorityClass(
            priority,
          ),
        )}
      >
        {priority}
      </Badge>
    );
  }

  return (
    <div
      onClick={
        stopInteractiveEvent
      }
      onPointerDown={
        stopInteractiveEvent
      }
      onKeyDown={
        stopInteractiveEvent
      }
    >
      <Select
        value={
          priority
        }
        disabled={
          saving
        }
        onValueChange={(
          value,
        ) =>
          onChange(
            value as TaskPriority,
          )
        }
      >
        <SelectTrigger
          aria-label="Change priority"
          className={cn(
            "h-6 w-auto min-w-0 gap-1 rounded-full px-2 py-0 text-[9px] font-medium shadow-none sm:text-[10px] [&>svg]:size-3",
            priorityClass(
              priority,
            ),
          )}
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>

        <SelectContent>
          {PRIORITIES.map(
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
                {item}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineDeadlineEditor({
  deadline,
  status,
  canEdit,
  saving,
  optional = false,
  compact = false,
  onChange,
}: {
  deadline: string;
  status: TaskStatus | null;
  canEdit: boolean;
  saving: boolean;
  optional?: boolean;
  compact?: boolean;
  onChange: (
    deadline: string,
  ) => Promise<void>;
}) {
  const [
    open,
    setOpen,
  ] =
    useState(
      false,
    );

  const info =
    deadline
      ? deadlineInfo(
          deadline,
          status,
        )
      : {
          shortText:
            "No deadline",

          text:
            "No deadline",

          className:
            "text-muted-foreground",
        };

  const shownText =
    compact
      ? info.shortText
      : info.text;

  const pillClass =
    deadlinePillClass(
      deadline,
      status,
    );

  if (
    !canEdit
  ) {
    return (
      <span
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[9px] font-medium sm:text-[10px]",
          pillClass,
        )}
      >
        <CalendarClock className="size-3 shrink-0" />

        {shownText}
      </span>
    );
  }

  return (
    <div
      onClick={
        stopInteractiveEvent
      }
      onPointerDown={
        stopInteractiveEvent
      }
      onKeyDown={
        stopInteractiveEvent
      }
    >
      <Popover
        open={
          open
        }
        onOpenChange={
          setOpen
        }
      >
        <PopoverTrigger
          asChild
        >
          <button
            type="button"
            disabled={
              saving
            }
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[9px] font-medium shadow-none transition-colors sm:text-[10px]",
              pillClass,
            )}
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CalendarClock className="size-3 shrink-0" />
            )}

            <span>
              {shownText}
            </span>

            <ChevronDown className="size-3 opacity-50" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-64 rounded-2xl"
          onClick={
            stopInteractiveEvent
          }
          onPointerDown={
            stopInteractiveEvent
          }
        >
          <div className="space-y-2">
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
              ) => {
                const value =
                  event.target.value;

                if (
                  !optional &&
                  !value
                ) {
                  return;
                }

                void onChange(
                  value,
                )
                  .then(
                    () =>
                      setOpen(
                        false,
                      ),
                  )
                  .catch(
                    () =>
                      undefined,
                  );
              }}
            />

            {optional &&
              deadline && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() =>
                    void onChange(
                      "",
                    )
                      .then(
                        () =>
                          setOpen(
                            false,
                          ),
                      )
                      .catch(
                        () =>
                          undefined,
                      )
                  }
                >
                  Remove deadline
                </Button>
              )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FloatingCreateMenu({
  onNewTask,
  onNewProject,
}: {
  onNewTask: () => void;
  onNewProject: () => void;
}) {
  return (
    <div className="fixed bottom-24 right-4 z-40 md:bottom-6 md:right-6">
      <DropdownMenu>
        <DropdownMenuTrigger
          asChild
        >
          <Button
            type="button"
            size="icon"
            className="size-13 rounded-full shadow-lg sm:size-14"
            aria-label="Create"
          >
            <Plus className="size-5 sm:size-6" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          side="top"
          className="mb-2 w-48"
        >
          <DropdownMenuItem
            onSelect={
              onNewTask
            }
          >
            <Plus className="size-4" />
            New Task
          </DropdownMenuItem>

          <DropdownMenuItem
            onSelect={
              onNewProject
            }
          >
            <FolderPlus className="size-4" />
            New Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function WorkUpdatesPanel({
  title,
  description,
  updates,
  canAdd,
  onAdd,
  emptyText,
  compact = false,
}: {
  title: string;
  description: string;
  updates: WorkUpdate[];
  canAdd: boolean;
  onAdd: (
    body: string,
  ) => Promise<void>;
  emptyText: string;
  compact?: boolean;
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

  const [
    showAll,
    setShowAll,
  ] =
    useState(
      false,
    );

  const visibleUpdates =
    compact &&
    !showAll
      ? updates.slice(
          0,
          3,
        )
      : updates;

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

      setText("");

      toast.success(
        "Update added",
      );
    } catch (
      error
    ) {
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
    <section className="space-y-3 border-t pt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText className="size-4 text-primary" />

            <p className="text-sm font-semibold">
              {title}
            </p>
          </div>

          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {description}
          </p>
        </div>

        {updates.length >
          3 &&
          compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px]"
              onClick={() =>
                setShowAll(
                  (
                    current,
                  ) =>
                    !current,
                )
              }
            >
              {showAll
                ? "Show less"
                : `All ${updates.length}`}
            </Button>
          )}
      </div>

      {canAdd && (
        <div className="space-y-2">
          <Textarea
            rows={2}
            maxLength={2000}
            className="resize-none rounded-xl text-sm"
            placeholder="Add an update…"
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
              className="h-8"
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
        <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visibleUpdates.map(
            (
              entry,
            ) => (
              <div
                key={
                  entry.id
                }
                className="rounded-xl bg-muted/40 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-1 text-[9px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {
                      entry.authorName
                    }
                  </span>

                  <span>
                    ·
                  </span>

                  <span>
                    {formatDateTime(
                      entry.createdAt,
                    )}
                  </span>

                  {entry.source ===
                    "clock" && (
                    <Badge
                      variant="secondary"
                      className="rounded-full px-1.5 py-0 text-[8px]"
                    >
                      <Timer className="mr-1 size-2.5" />
                      {entry.durationMs
                        ? formatHours(
                            entry.durationMs,
                          )
                        : "Clock"}
                    </Badge>
                  )}
                </div>

                <p className="mt-1 text-xs leading-relaxed">
                  <LinkifiedText
                    text={
                      entry.body
                    }
                  />
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </section>
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

  onChange: (
    value: TaskFormValue,
  ) => void;

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
    teamId: string,
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
          : nextPeople[0]
              ?.id ??
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
    userId: string,
    enabled: boolean,
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
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>
          Title
        </Label>

        <Input
          maxLength={120}
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

      <div className="space-y-1.5">
        <Label>
          Description
        </Label>

        <Textarea
          rows={4}
          maxLength={2000}
          className="resize-none rounded-xl"
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
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
                statusValue as TaskStatus;

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

        <div className="space-y-1.5">
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
                  priority as TaskPriority,
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

      {value.status ===
        "Blocked" && (
        <div className="space-y-1.5">
          <Label>
            Why is this blocked?
          </Label>

          <Textarea
            rows={3}
            maxLength={500}
            className="resize-none rounded-xl"
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
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

        <div className="space-y-1.5">
          <Label>
            Team
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
                  General - everyone
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
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

        <div className="space-y-1.5">
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
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <Label>
            Assignees
          </Label>

          <span className="text-[10px] text-muted-foreground">
            {
              value.assigneeIds.length
            }{" "}
            selected
          </span>
        </div>

        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl border p-1.5">
          {eligiblePeople.length ===
          0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No people are available for this team.
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
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-muted"
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
                      <p className="truncate text-sm">
                        {
                          person.name
                        }
                      </p>

                      {person.role ===
                        "team_lead" && (
                        <p className="text-[10px] text-primary">
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

  onChange: (
    value: ProjectFormValue,
  ) => void;

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
    teamId: string,
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
            : nextPeople[0]
                ?.id ??
              "",
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>
          Name
        </Label>

        <Input
          maxLength={120}
          placeholder="Robot Integration"
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

      <div className="space-y-1.5">
        <Label>
          Description
        </Label>

        <Textarea
          rows={4}
          maxLength={2000}
          className="resize-none rounded-xl"
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>
            Status
          </Label>

          <Select
            value={
              value.status ??
              "none"
            }
            onValueChange={(
              statusValue,
            ) => {
              const status:
                ProjectStatus =
                statusValue ===
                "none"
                  ? null
                  : statusValue as TaskStatus;

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
              <SelectItem value="none">
                No status
              </SelectItem>

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

        <div className="space-y-1.5">
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
                  priority as TaskPriority,
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

      {value.status ===
        "Blocked" && (
        <div className="space-y-1.5">
          <Label>
            Why is this blocked?
          </Label>

          <Textarea
            rows={3}
            maxLength={500}
            className="resize-none rounded-xl"
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
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

          <p className="text-[10px] text-muted-foreground">
            Optional - leave empty for no deadline.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label>
            Team
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
                  General - everyone
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

      <div className="space-y-1.5">
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