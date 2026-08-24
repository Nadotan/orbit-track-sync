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
import { Card, CardContent } from "@/components/ui/card";
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
  TabsContent,
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
type ProjectCompletionMode = "quick" | "details" | "full";

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
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  blockedReason: string;
  teamId: string;
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

function taskUpdateData(
  task: TaskItem,
  patch: Partial<Pick<TaskFormValue, "priority" | "deadline">> = {},
) {
  const form = { ...taskToForm(task), ...patch };

  return {
    taskId: task.id,
    title: form.title,
    description: form.description,
    deadline: form.deadline,
    status: form.status,
    priority: form.priority,
    ownerId: form.ownerId,
    blockedReason: form.blockedReason,
    projectId: form.projectId === "none" ? null : form.projectId,
    teamId: form.teamId === "general" ? null : form.teamId,
    assigneeIds: form.assigneeIds,
  };
}

function projectUpdateData(
  project: TaskProject,
  patch: Partial<Pick<ProjectFormValue, "priority" | "deadline">> = {},
) {
  const form = { ...projectToForm(project), ...patch };

  return {
    projectId: project.id,
    name: form.name,
    description: form.description,
    deadline: form.deadline || null,
    status: form.status,
    priority: form.priority,
    ownerId: form.ownerId,
    blockedReason: form.blockedReason,
    teamId: form.teamId === "general" ? null : form.teamId,
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
  return differenceInCalendarDays(parseISO(deadline), startOfDay(new Date()));
}

function shortDeadlineDate(deadline: string) {
  const date = parseISO(deadline);
  const pattern =
    date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy";

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

function optionalDeadlineInfo(deadline: string | null, status: TaskStatus) {
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
    const rankDifference = smartTaskRank(a) - smartTaskRank(b);
    if (rankDifference !== 0) return rankDifference;

    const deadlineDifference =
      parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime();
    if (deadlineDifference !== 0) return deadlineDifference;

    return a.title.localeCompare(b.title);
  });
}

function sortProjectTasks(tasks: TaskItem[]) {
  const open = smartSortTasks(tasks.filter((task) => task.status !== "Done"));
  const done = [...tasks]
    .filter((task) => task.status === "Done")
    .sort((a, b) => {
      const deadlineDifference =
        parseISO(a.deadline).getTime() - parseISO(b.deadline).getTime();
      if (deadlineDifference !== 0) return deadlineDifference;
      return a.title.localeCompare(b.title);
    });

  return [...open, ...done];
}

function roleLabel(role: TaskRole) {
  if (role === "admin") return "Admin";
  if (role === "team_lead") return "Team Lead";
  return "User";
}

function TasksPage() {
  const getWorkspace = useServerFn(getTasksWorkspace);
  const create = useServerFn(createTask);
  const update = useServerFn(updateTask);
  const updateStatus = useServerFn(updateTaskStatus);
  const archive = useServerFn(archiveTask);
  const duplicate = useServerFn(duplicateTask);
  const remove = useServerFn(deleteTask);
  const createNewProject = useServerFn(createProject);
  const saveProject = useServerFn(updateProject);
  const saveProjectStatus = useServerFn(updateProjectStatus);
  const archiveExistingProject = useServerFn(archiveProject);
  const addUpdate = useServerFn(addWorkUpdate);
  const changeTeamLead = useServerFn(setTeamLeadRole);
  const syncSheets = useServerFn(syncGoogleSheetsNow);

  const navigate = Route.useNavigate();
  const { project: projectPageId } = Route.useSearch();

  const [workspace, setWorkspace] = useState<TasksWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [quickBusyKey, setQuickBusyKey] = useState<string | null>(null);
  const [syncingSheets, setSyncingSheets] = useState(false);
  const [tab, setTab] = useState<TaskTab>("my");

  const [createOpen, setCreateOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectEditOpen, setProjectEditOpen] = useState(false);
  const [teamLeadsOpen, setTeamLeadsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState<TaskFormValue>(
    defaultTaskForm("user", [], ""),
  );
  const [editForm, setEditForm] = useState<TaskFormValue | null>(null);
  const [projectForm, setProjectForm] = useState<ProjectFormValue>(
    defaultProjectForm("user", [], ""),
  );
  const [projectEditForm, setProjectEditForm] =
    useState<ProjectFormValue | null>(null);

  const [blockedPrompt, setBlockedPrompt] = useState<BlockedPrompt | null>(null);
  const [blockedReasonDraft, setBlockedReasonDraft] = useState("");
  const [pendingProjectCompletion, setPendingProjectCompletion] =
    useState<PendingProjectCompletion | null>(null);
  const [leadBusyId, setLeadBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [teamFilter, setTeamFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [deadlineFilter, setDeadlineFilter] =
    useState<DeadlineFilter>("all");

  const load = useCallback(async () => {
    try {
      const result = await getWorkspace();
      setWorkspace(result);
    } catch (error) {
      console.error("Failed to load tasks:", error);
      toast.error("Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [getWorkspace]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!workspace) return;

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
  }, [
    workspace?.role,
    workspace?.currentUserId,
    workspace?.teamIds.join(","),
  ]);

  const selectedTask =
    workspace?.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedProject =
    workspace?.projects.find((project) => project.id === projectPageId) ?? null;

  useEffect(() => {
    setEditForm(selectedTask ? taskToForm(selectedTask) : null);
  }, [selectedTask?.id, selectedTask?.updatedAt]);

  useEffect(() => {
    setProjectEditForm(selectedProject ? projectToForm(selectedProject) : null);
    setProjectEditOpen(false);
  }, [selectedProject?.id, selectedProject?.updatedAt]);

  const openTasks = useMemo(
    () => (workspace?.tasks ?? []).filter((task) => task.status !== "Done"),
    [workspace],
  );

  const myTasks = useMemo(
    () =>
      openTasks.filter(
        (task) =>
          task.ownerId === workspace?.currentUserId ||
          task.assignees.some(
            (assignee) => assignee.id === workspace?.currentUserId,
          ),
      ),
    [openTasks, workspace?.currentUserId],
  );

  const teamTasks = useMemo(
    () =>
      openTasks.filter(
        (task) =>
          task.teamId !== null &&
          (workspace?.teamIds ?? []).includes(task.teamId),
      ),
    [openTasks, workspace?.teamIds],
  );

  const allTasks = openTasks;
  const doneTasks = useMemo(
    () => (workspace?.tasks ?? []).filter((task) => task.status === "Done"),
    [workspace],
  );

  const summary = useMemo(() => {
    let dueSoon = 0;
    let overdue = 0;
    let blocked = 0;

    for (const task of openTasks) {
      const days = deadlineDays(task.deadline);
      if (days < 0) overdue += 1;
      else if (days <= 7) dueSoon += 1;
      if (task.status === "Blocked") blocked += 1;
    }

    return {
      open: openTasks.length,
      dueSoon,
      overdue,
      blocked,
    };
  }, [openTasks]);

  const currentTabTasks = useMemo(() => {
    if (tab === "my") return myTasks;
    if (tab === "team") return teamTasks;
    if (tab === "done") return doneTasks;
    return allTasks;
  }, [tab, myTasks, teamTasks, allTasks, doneTasks]);

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase();

    const result = currentTabTasks.filter((task) => {
      if (query) {
        const haystack = [
          task.title,
          task.description,
          task.teamName,
          task.projectName ?? "",
          task.ownerName,
          ...task.assignees.map((assignee) => assignee.name),
          ...task.updates.slice(0, 10).map((entry) => entry.body),
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) return false;
      }

      if (teamFilter !== "all") {
        if (teamFilter === "general") {
          if (task.teamId !== null) return false;
        } else if (task.teamId !== teamFilter) {
          return false;
        }
      }

      if (projectFilter !== "all") {
        if (projectFilter === "none") {
          if (task.projectId !== null) return false;
        } else if (task.projectId !== projectFilter) {
          return false;
        }
      }

      if (statusFilter !== "all" && task.status !== statusFilter) return false;
      if (priorityFilter !== "all" && task.priority !== priorityFilter)
        return false;
      if (ownerFilter !== "all" && task.ownerId !== ownerFilter) return false;
      if (
        assigneeFilter !== "all" &&
        !task.assignees.some((assignee) => assignee.id === assigneeFilter)
      ) {
        return false;
      }

      if (deadlineFilter !== "all") {
        const days = deadlineDays(task.deadline);
        if (deadlineFilter === "overdue" && days >= 0) return false;
        if (deadlineFilter === "today" && days !== 0) return false;
        if (deadlineFilter === "soon" && (days < 0 || days > 7)) return false;
        if (deadlineFilter === "later" && days <= 7) return false;
      }

      return true;
    });

    return smartSortTasks(result);
  }, [
    currentTabTasks,
    search,
    teamFilter,
    projectFilter,
    statusFilter,
    priorityFilter,
    ownerFilter,
    assigneeFilter,
    deadlineFilter,
  ]);

  const activeFilterCount = [
    teamFilter,
    projectFilter,
    statusFilter,
    priorityFilter,
    ownerFilter,
    assigneeFilter,
    deadlineFilter,
  ].filter((value) => value !== "all").length;

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

  function openProject(projectId: string) {
    setProjectEditOpen(false);
    void navigate({
      search: (previous) => ({
        ...previous,
        project: projectId,
      }),
    });
  }

  function closeProjectPage() {
    setSelectedTaskId(null);
    setProjectEditOpen(false);
    void navigate({
      search: (previous) => {
        const next = { ...previous };
        delete next.project;
        return next;
      },
    });
  }

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="surface-card mx-auto max-w-lg p-8 text-center">
        <AlertTriangle className="mx-auto size-8 text-warning" />
        <p className="mt-3 font-medium">Tasks could not be loaded.</p>
      </div>
    );
  }

  const currentWorkspace = workspace;

  const managerTeams =
    currentWorkspace.role === "admin"
      ? currentWorkspace.teams
      : currentWorkspace.teams.filter((team) => currentWorkspace.teamIds.includes(team.id));

  const canCreate =
    currentWorkspace.role === "admin" ||
    (currentWorkspace.role === "team_lead" && managerTeams.length > 0);

  const filteredProject =
    projectFilter !== "all" && projectFilter !== "none"
      ? currentWorkspace.projects.find((project) => project.id === projectFilter) ?? null
      : null;

  const projectPageTasks = selectedProject
    ? currentWorkspace.tasks.filter((task) => task.projectId === selectedProject.id)
    : [];

  function incompleteProjectTaskCount(projectId: string) {
    return currentWorkspace.tasks.filter(
      (task) => task.projectId === projectId && task.status !== "Done",
    ).length;
  }

  function openNewTask(project?: TaskProject) {
    const base = defaultTaskForm(
      currentWorkspace.role,
      currentWorkspace.teamIds,
      currentWorkspace.currentUserId,
    );

    if (!project) {
      setCreateForm(base);
      setCreateOpen(true);
      return;
    }

    const teamId = project.teamId ?? "general";
    const eligiblePeople =
      project.teamId === null
        ? currentWorkspace.people
        : currentWorkspace.people.filter((person) =>
            person.teamIds.includes(project.teamId!),
          );

    const ownerId = eligiblePeople.some((person) => person.id === project.ownerId)
      ? project.ownerId
      : eligiblePeople.some((person) => person.id === currentWorkspace.currentUserId)
        ? currentWorkspace.currentUserId
        : eligiblePeople[0]?.id ?? "";

    const today = format(new Date(), "yyyy-MM-dd");
    const defaultDeadline =
      project.deadline && project.deadline >= today
        ? project.deadline
        : base.deadline;

    setCreateForm({
      ...base,
      teamId,
      projectId: project.id,
      ownerId,
      assigneeIds: ownerId ? [ownerId] : [],
      deadline: defaultDeadline,
    });
    setCreateOpen(true);
  }

  function openNewProject() {
    setProjectForm(
      defaultProjectForm(
        currentWorkspace.role,
        currentWorkspace.teamIds,
        currentWorkspace.currentUserId,
      ),
    );
    setCreateProjectOpen(true);
  }

  async function handleCreate() {
    if (!createForm.title.trim()) {
      toast.error("Task title is required.");
      return;
    }
    if (!createForm.deadline) {
      toast.error("Choose a deadline.");
      return;
    }
    if (!createForm.ownerId) {
      toast.error("Choose an owner.");
      return;
    }
    if (createForm.assigneeIds.length === 0) {
      toast.error("Assign at least one person.");
      return;
    }
    if (createForm.status === "Blocked" && !createForm.blockedReason.trim()) {
      toast.error("Add a reason for the blocked task.");
      return;
    }

    setSaving(true);
    try {
      await create({
        data: {
          title: createForm.title,
          description: createForm.description,
          deadline: createForm.deadline,
          status: createForm.status,
          priority: createForm.priority,
          ownerId: createForm.ownerId,
          blockedReason: createForm.blockedReason,
          projectId:
            createForm.projectId === "none" ? null : createForm.projectId,
          teamId: createForm.teamId === "general" ? null : createForm.teamId,
          assigneeIds: createForm.assigneeIds,
        },
      });

      toast.success("Task created");
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProject() {
    if (!projectForm.name.trim()) {
      toast.error("Project name is required.");
      return;
    }
    if (!projectForm.ownerId) {
      toast.error("Choose a project owner.");
      return;
    }
    if (!projectForm.teamId) {
      toast.error("Choose a project scope.");
      return;
    }
    if (projectForm.status === "Blocked" && !projectForm.blockedReason.trim()) {
      toast.error("Add a reason for the blocked project.");
      return;
    }

    setSaving(true);
    try {
      const result = await createNewProject({
        data: {
          name: projectForm.name,
          description: projectForm.description,
          deadline: projectForm.deadline || null,
          status: projectForm.status,
          priority: projectForm.priority,
          ownerId: projectForm.ownerId,
          blockedReason: projectForm.blockedReason,
          teamId: projectForm.teamId === "general" ? null : projectForm.teamId,
        },
      });

      toast.success("Project created");
      setCreateProjectOpen(false);
      await load();
      openProject(result.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create project.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleFullUpdate() {
    if (!selectedTask || !editForm) return;

    if (!editForm.title.trim()) {
      toast.error("Task title is required.");
      return;
    }
    if (!editForm.deadline) {
      toast.error("Choose a deadline.");
      return;
    }
    if (!editForm.ownerId) {
      toast.error("Choose an owner.");
      return;
    }
    if (editForm.assigneeIds.length === 0) {
      toast.error("Assign at least one person.");
      return;
    }
    if (editForm.status === "Blocked" && !editForm.blockedReason.trim()) {
      toast.error("Add a reason for the blocked task.");
      return;
    }

    setSaving(true);
    try {
      await update({
        data: {
          taskId: selectedTask.id,
          title: editForm.title,
          description: editForm.description,
          deadline: editForm.deadline,
          status: editForm.status,
          priority: editForm.priority,
          ownerId: editForm.ownerId,
          blockedReason: editForm.blockedReason,
          projectId: editForm.projectId === "none" ? null : editForm.projectId,
          teamId: editForm.teamId === "general" ? null : editForm.teamId,
          assigneeIds: editForm.assigneeIds,
        },
      });

      toast.success("Task updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusUpdate() {
    if (!selectedTask || !editForm) return;

    if (editForm.status === "Blocked" && !editForm.blockedReason.trim()) {
      toast.error("Add a reason for the blocked task.");
      return;
    }

    setSaving(true);
    try {
      await updateStatus({
        data: {
          taskId: selectedTask.id,
          status: editForm.status,
          blockedReason: editForm.blockedReason,
        },
      });

      toast.success(editForm.status === "Done" ? "Task completed" : "Status updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update status.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function performQuickTaskStatus(
    task: TaskItem,
    status: TaskStatus,
    blockedReason = "",
  ) {
    const key = `task:${task.id}:status`;
    setQuickBusyKey(key);

    try {
      await updateStatus({
        data: {
          taskId: task.id,
          status,
          blockedReason,
        },
      });
      toast.success(status === "Done" ? "Task completed" : "Status updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update status.",
      );
    } finally {
      setQuickBusyKey(null);
    }
  }

  function handleQuickTaskStatus(task: TaskItem, status: TaskStatus) {
    if (!task.canEditStatus || task.status === status) return;

    if (status === "Blocked") {
      setBlockedReasonDraft("");
      setBlockedPrompt({ kind: "task", id: task.id, title: task.title });
      return;
    }

    void performQuickTaskStatus(task, status);
  }

  async function handleQuickTaskPriority(task: TaskItem, priority: TaskPriority) {
    if (!task.canEditDetails || task.priority === priority) return;

    const key = `task:${task.id}:priority`;
    setQuickBusyKey(key);
    try {
      await update({ data: taskUpdateData(task, { priority }) });
      toast.success("Priority updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update priority.",
      );
    } finally {
      setQuickBusyKey(null);
    }
  }

  async function handleQuickTaskDeadline(task: TaskItem, deadline: string) {
    if (!task.canEditDetails || !deadline || task.deadline === deadline) return;

    const key = `task:${task.id}:deadline`;
    setQuickBusyKey(key);
    try {
      await update({ data: taskUpdateData(task, { deadline }) });
      toast.success("Deadline updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update deadline.",
      );
      throw error;
    } finally {
      setQuickBusyKey(null);
    }
  }

  async function handleArchive() {
    if (!selectedTask) return;
    if (!window.confirm(`Archive "${selectedTask.title}"?`)) return;

    setSaving(true);
    try {
      await archive({ data: { taskId: selectedTask.id } });
      toast.success("Task archived");
      setSelectedTaskId(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (!selectedTask) return;

    setSaving(true);
    try {
      await duplicate({ data: { taskId: selectedTask.id } });
      toast.success("Task duplicated");
      setSelectedTaskId(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not duplicate task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedTask) return;
    if (
      !window.confirm(
        `Delete "${selectedTask.title}" from POM? It will stay in Google Sheets as a historical Deleted task.`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      await remove({ data: { taskId: selectedTask.id } });
      toast.success("Task deleted from POM and kept in Google Sheets");
      setSelectedTaskId(null);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete task.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function performProjectUpdate() {
    if (!selectedProject || !projectEditForm) return;

    setSaving(true);
    try {
      await saveProject({
        data: {
          projectId: selectedProject.id,
          name: projectEditForm.name,
          description: projectEditForm.description,
          deadline: projectEditForm.deadline || null,
          status: projectEditForm.status,
          priority: projectEditForm.priority,
          ownerId: projectEditForm.ownerId,
          blockedReason: projectEditForm.blockedReason,
          teamId:
            projectEditForm.teamId === "general" ? null : projectEditForm.teamId,
        },
      });

      toast.success("Project updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update project.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleProjectUpdate() {
    if (!selectedProject || !projectEditForm) return;

    if (!projectEditForm.name.trim()) {
      toast.error("Project name is required.");
      return;
    }
    if (!projectEditForm.ownerId) {
      toast.error("Choose a project owner.");
      return;
    }
    if (
      projectEditForm.status === "Blocked" &&
      !projectEditForm.blockedReason.trim()
    ) {
      toast.error("Add a reason for the blocked project.");
      return;
    }

    if (
      projectEditForm.status === "Done" &&
      selectedProject.status !== "Done" &&
      incompleteProjectTaskCount(selectedProject.id) > 0
    ) {
      setPendingProjectCompletion({ mode: "full", projectId: selectedProject.id });
      return;
    }

    await performProjectUpdate();
  }

  async function performProjectStatusUpdate() {
    if (!selectedProject || !projectEditForm) return;

    setSaving(true);
    try {
      await saveProjectStatus({
        data: {
          projectId: selectedProject.id,
          status: projectEditForm.status,
          blockedReason: projectEditForm.blockedReason,
        },
      });
      toast.success("Project status updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update project status.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleProjectStatusUpdate() {
    if (!selectedProject || !projectEditForm) return;

    if (
      projectEditForm.status === "Blocked" &&
      !projectEditForm.blockedReason.trim()
    ) {
      toast.error("Add a reason for the blocked project.");
      return;
    }

    if (
      projectEditForm.status === "Done" &&
      selectedProject.status !== "Done" &&
      incompleteProjectTaskCount(selectedProject.id) > 0
    ) {
      setPendingProjectCompletion({
        mode: "details",
        projectId: selectedProject.id,
      });
      return;
    }

    await performProjectStatusUpdate();
  }

  async function performQuickProjectStatus(
    project: TaskProject,
    status: TaskStatus,
    blockedReason = "",
  ) {
    const key = `project:${project.id}:status`;
    setQuickBusyKey(key);

    try {
      await saveProjectStatus({
        data: {
          projectId: project.id,
          status,
          blockedReason,
        },
      });
      toast.success(status === "Done" ? "Project completed" : "Project status updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update project status.",
      );
    } finally {
      setQuickBusyKey(null);
    }
  }

  function handleQuickProjectStatus(project: TaskProject, status: TaskStatus) {
    if (!project.canEditStatus || project.status === status) return;

    if (status === "Blocked") {
      setBlockedReasonDraft("");
      setBlockedPrompt({ kind: "project", id: project.id, title: project.name });
      return;
    }

    if (
      status === "Done" &&
      project.status !== "Done" &&
      incompleteProjectTaskCount(project.id) > 0
    ) {
      setPendingProjectCompletion({ mode: "quick", projectId: project.id });
      return;
    }

    void performQuickProjectStatus(project, status);
  }

  async function handleQuickProjectPriority(
    project: TaskProject,
    priority: TaskPriority,
  ) {
    if (!project.canEditDetails || project.priority === priority) return;

    const key = `project:${project.id}:priority`;
    setQuickBusyKey(key);
    try {
      await saveProject({ data: projectUpdateData(project, { priority }) });
      toast.success("Project priority updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update project priority.",
      );
    } finally {
      setQuickBusyKey(null);
    }
  }

  async function handleQuickProjectDeadline(
    project: TaskProject,
    deadline: string,
  ) {
    if (!project.canEditDetails) return;
    if ((project.deadline ?? "") === deadline) return;

    const key = `project:${project.id}:deadline`;
    setQuickBusyKey(key);
    try {
      await saveProject({ data: projectUpdateData(project, { deadline }) });
      toast.success("Project deadline updated");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update project deadline.",
      );
      throw error;
    } finally {
      setQuickBusyKey(null);
    }
  }

  async function submitBlockedPrompt() {
    if (!blockedPrompt) return;

    const reason = blockedReasonDraft.trim();
    if (!reason) {
      toast.error("Add a reason before marking this item as Blocked.");
      return;
    }

    const prompt = blockedPrompt;
    setBlockedPrompt(null);

    if (prompt.kind === "task") {
      const task = currentWorkspace.tasks.find((item) => item.id === prompt.id);
      if (task) await performQuickTaskStatus(task, "Blocked", reason);
      return;
    }

    const project = currentWorkspace.projects.find((item) => item.id === prompt.id);
    if (project) await performQuickProjectStatus(project, "Blocked", reason);
  }

  async function confirmProjectCompletion() {
    if (!pendingProjectCompletion) return;

    const pending = pendingProjectCompletion;
    const project = currentWorkspace.projects.find(
      (item) => item.id === pending.projectId,
    );
    setPendingProjectCompletion(null);

    if (!project) return;

    if (pending.mode === "quick") {
      await performQuickProjectStatus(project, "Done");
      return;
    }

    if (pending.mode === "details") {
      await performProjectStatusUpdate();
      return;
    }

    await performProjectUpdate();
  }

  async function handleProjectArchive() {
    if (!selectedProject) return;
    if (!window.confirm(`Archive "${selectedProject.name}"?`)) return;

    setSaving(true);
    try {
      await archiveExistingProject({ data: { projectId: selectedProject.id } });
      toast.success("Project archived");
      setProjectFilter("all");
      closeProjectPage();
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive project.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTaskUpdate(body: string) {
    if (!selectedTask) return;
    await addUpdate({
      data: {
        taskId: selectedTask.id,
        projectId: null,
        body,
      },
    });
    await load();
  }

  async function handleAddProjectUpdate(body: string) {
    if (!selectedProject) return;
    await addUpdate({
      data: {
        taskId: null,
        projectId: selectedProject.id,
        body,
      },
    });
    await load();
  }

  async function handleGoogleSheetsSync() {
    if (currentWorkspace.role !== "admin" || syncingSheets) return;

    setSyncingSheets(true);
    try {
      const result = await syncSheets();
      toast.success(
        `Google Sheets synced — ${result.projects} projects, ${result.tasks} tasks, ${result.updates} updates`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not sync Google Sheets.",
      );
    } finally {
      setSyncingSheets(false);
    }
  }

  async function handleLeadChange(person: TaskPerson, enabled: boolean) {
    if (enabled && person.teamIds.length === 0) {
      toast.error("Assign this person to a team first.");
      return;
    }

    setLeadBusyId(person.id);
    try {
      await changeTeamLead({ data: { userId: person.id, enabled } });
      toast.success(
        enabled
          ? `${person.name} is now a Team Lead`
          : `${person.name} is now a User`,
      );
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not change role.",
      );
    } finally {
      setLeadBusyId(null);
    }
  }

  const taskCardActions: TaskCardActions = {
    busyKey: quickBusyKey,
    onStatusChange: handleQuickTaskStatus,
    onPriorityChange: (task, priority) =>
      void handleQuickTaskPriority(task, priority),
    onDeadlineChange: handleQuickTaskDeadline,
  };

  const projectCardActions: ProjectCardActions = {
    busyKey: quickBusyKey,
    onStatusChange: handleQuickProjectStatus,
    onPriorityChange: (project, priority) =>
      void handleQuickProjectPriority(project, priority),
    onDeadlineChange: handleQuickProjectDeadline,
  };

  const incompleteForConfirmation = pendingProjectCompletion
    ? incompleteProjectTaskCount(pendingProjectCompletion.projectId)
    : 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-28 md:pb-10">
      {projectPageId ? (
        selectedProject ? (
          <ProjectWorkspaceView
            project={selectedProject}
            tasks={projectPageTasks}
            onBack={closeProjectPage}
            onEdit={() => setProjectEditOpen(true)}
            onOpenTask={setSelectedTaskId}
            onAddUpdate={handleAddProjectUpdate}
            taskActions={taskCardActions}
            projectActions={projectCardActions}
          />
        ) : (
          <ProjectNotFound onBack={closeProjectPage} />
        )
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold sm:text-3xl">Tasks</h1>
                <Badge variant="outline" className="rounded-full">
                  {roleLabel(currentWorkspace.role)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Projects and tasks in one currentWorkspace. Edit common fields directly
                from their cards.
              </p>
            </div>

            {currentWorkspace.role === "admin" && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={syncingSheets}
                  onClick={() => void handleGoogleSheetsSync()}
                >
                  <RefreshCw
                    className={cn("size-4", syncingSheets && "animate-spin")}
                  />
                  {syncingSheets ? "Syncing…" : "Sync Sheets"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setTeamLeadsOpen(true)}
                >
                  <ShieldCheck className="size-4" />
                  Team Leads
                </Button>
              </div>
            )}
          </div>

          {currentWorkspace.role === "team_lead" && managerTeams.length === 0 && (
            <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4 text-sm">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>You are a Team Lead, but you are not assigned to a team yet.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCard label="Open" value={summary.open} />
            <SummaryCard label="Due Soon" value={summary.dueSoon} />
            <SummaryCard
              label="Overdue"
              value={summary.overdue}
              danger={summary.overdue > 0}
            />
            <SummaryCard
              label="Blocked"
              value={summary.blocked}
              danger={summary.blocked > 0}
            />
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold">
                <FolderKanban className="size-4 text-primary" />
                Projects
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a project for its overview, tasks and project updates.
              </p>
            </div>

            {currentWorkspace.projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                No projects yet. Tasks can still exist without a project.
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {currentWorkspace.projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    tasks={currentWorkspace.tasks.filter(
                      (task) => task.projectId === project.id,
                    )}
                    onOpen={() => openProject(project.id)}
                    actions={projectCardActions}
                  />
                ))}
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
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => setFiltersOpen((current) => !current)}
              >
                <SlidersHorizontal className="size-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-1 rounded-full px-1.5"
                  >
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>

              {(activeFilterCount > 0 || search) && (
                <Button type="button" variant="ghost" onClick={clearFilters}>
                  Clear
                </Button>
              )}
            </div>

            {filtersOpen && (
              <div className="surface-card grid gap-3 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-4">
                <FilterSelect
                  label="Team"
                  value={teamFilter}
                  onChange={setTeamFilter}
                  items={[
                    { value: "all", label: "All teams" },
                    { value: "general", label: "General" },
                    ...currentWorkspace.teams.map((team) => ({
                      value: team.id,
                      label: team.name,
                    })),
                  ]}
                />

                <FilterSelect
                  label="Project"
                  value={projectFilter}
                  onChange={setProjectFilter}
                  items={[
                    { value: "all", label: "All projects" },
                    { value: "none", label: "No project" },
                    ...currentWorkspace.projects.map((project) => ({
                      value: project.id,
                      label: project.name,
                    })),
                  ]}
                />

                <FilterSelect
                  label="Status"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  items={[
                    { value: "all", label: "All statuses" },
                    ...STATUSES.map((status) => ({ value: status, label: status })),
                  ]}
                />

                <FilterSelect
                  label="Priority"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  items={[
                    { value: "all", label: "All priorities" },
                    ...PRIORITIES.map((priority) => ({
                      value: priority,
                      label: priority,
                    })),
                  ]}
                />

                <FilterSelect
                  label="Owner"
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  items={[
                    { value: "all", label: "All owners" },
                    ...currentWorkspace.people.map((person) => ({
                      value: person.id,
                      label: person.name,
                    })),
                  ]}
                />

                <FilterSelect
                  label="Assignee"
                  value={assigneeFilter}
                  onChange={setAssigneeFilter}
                  items={[
                    { value: "all", label: "All assignees" },
                    ...currentWorkspace.people.map((person) => ({
                      value: person.id,
                      label: person.name,
                    })),
                  ]}
                />

                <FilterSelect
                  label="Deadline"
                  value={deadlineFilter}
                  onChange={(value) =>
                    setDeadlineFilter(value as DeadlineFilter)
                  }
                  items={[
                    { value: "all", label: "Any deadline" },
                    { value: "overdue", label: "Overdue" },
                    { value: "today", label: "Due today" },
                    { value: "soon", label: "Next 7 days" },
                    { value: "later", label: "Later" },
                  ]}
                />
              </div>
            )}
          </div>

          <Tabs value={tab} onValueChange={(value) => setTab(value as TaskTab)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="my">
                My Tasks
                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {myTasks.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="team">
                Team Tasks
                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {teamTasks.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="all">
                All Tasks
                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {allTasks.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="done">
                Done
                <span className="ml-1 hidden text-xs opacity-60 sm:inline">
                  {doneTasks.length}
                </span>
              </TabsTrigger>
            </TabsList>

            {filteredProject && (
              <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Project</p>
                  <p className="truncate text-sm font-medium">
                    {filteredProject.name}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setProjectFilter("all")}
                >
                  <X className="size-4" />
                  Show all
                </Button>
              </div>
            )}

            {(["my", "team", "all", "done"] as TaskTab[]).map((value) => (
              <TabsContent key={value} value={value} className="mt-4">
                <TaskList
                  tasks={filteredTasks}
                  emptyTitle={
                    value === "my"
                      ? "No tasks assigned to you"
                      : value === "team"
                        ? "No team tasks"
                        : value === "done"
                          ? "Nothing completed yet"
                          : "No open tasks"
                  }
                  emptyText={
                    value === "my"
                      ? "You're all caught up."
                      : value === "team"
                        ? "There are no open tasks for your teams."
                        : value === "done"
                          ? "Completed tasks will appear here."
                          : "There are no active tasks matching these filters."
                  }
                  onOpen={setSelectedTaskId}
                  actions={taskCardActions}
                />
              </TabsContent>
            ))}
          </Tabs>
        </>
      )}

      {canCreate && (
        <FloatingCreateMenu
          onNewTask={() =>
            openNewTask(
              projectPageId && selectedProject?.canEditDetails
                ? selectedProject
                : undefined,
            )
          }
          onNewProject={openNewProject}
        />
      )}

      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>
              Create a project with the same core fields used by tasks.
            </DialogDescription>
          </DialogHeader>

          <ProjectForm
            value={projectForm}
            onChange={setProjectForm}
            role={currentWorkspace.role}
            currentUserId={currentWorkspace.currentUserId}
            teams={managerTeams}
            people={currentWorkspace.people}
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setCreateProjectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleCreateProject()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderPlus className="size-4" />
              )}
              {saving ? "Creating…" : "Create Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
            <DialogDescription>
              Create a task. If you opened this from a project, that project and its scope are already selected.
            </DialogDescription>
          </DialogHeader>

          <TaskForm
            value={createForm}
            onChange={setCreateForm}
            role={currentWorkspace.role}
            currentUserId={currentWorkspace.currentUserId}
            teams={managerTeams}
            projects={currentWorkspace.projects}
            people={currentWorkspace.people}
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleCreate()}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {saving ? "Creating…" : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={Boolean(selectedTask)}
        onOpenChange={(open) => {
          if (!open) setSelectedTaskId(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedTask && editForm && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedTask.title}</SheetTitle>
              </SheetHeader>
              <p className="mt-2 text-sm text-muted-foreground">
                Task details, assignment and updates.
              </p>

              <div className="space-y-6">
                <TaskSummary task={selectedTask} />

                {selectedTask.canEditDetails ? (
                  <>
                    <TaskForm
                      value={editForm}
                      onChange={setEditForm}
                      role={currentWorkspace.role}
                      currentUserId={currentWorkspace.currentUserId}
                      teams={managerTeams}
                      projects={currentWorkspace.projects}
                      people={currentWorkspace.people}
                    />

                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        className="w-full"
                        disabled={saving}
                        onClick={() => void handleFullUpdate()}
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
                          disabled={saving}
                          onClick={() => void handleDuplicate()}
                        >
                          <Copy className="size-4" />
                          Duplicate
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={saving}
                          onClick={() => void handleArchive()}
                        >
                          <Archive className="size-4" />
                          Archive
                        </Button>
                      </div>

                      {currentWorkspace.role === "admin" && (
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={saving}
                          onClick={() => void handleDelete()}
                        >
                          <Trash2 className="size-4" />
                          Delete from POM
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <TaskReadOnlyDetails task={selectedTask} />
                    {selectedTask.canEditStatus && (
                      <StatusEditor
                        status={editForm.status}
                        blockedReason={editForm.blockedReason}
                        onChange={(status, blockedReason) =>
                          setEditForm({ ...editForm, status, blockedReason })
                        }
                        saving={saving}
                        onSave={() => void handleStatusUpdate()}
                        disabled={
                          editForm.status === selectedTask.status &&
                          editForm.blockedReason === selectedTask.blockedReason
                        }
                        label="Task status"
                      />
                    )}
                  </>
                )}

                <WorkUpdatesPanel
                  title="Updates"
                  description="Manual notes and work logged from The Clock are kept together here."
                  updates={selectedTask.updates}
                  canAdd={selectedTask.canEditStatus}
                  onAdd={handleAddTaskUpdate}
                  emptyText="No task updates yet. Clock entries linked to this task will appear here automatically."
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(selectedProject) && projectEditOpen}
        onOpenChange={setProjectEditOpen}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selectedProject && projectEditForm && (
            <>
              <SheetHeader>
                <SheetTitle>{selectedProject.name}</SheetTitle>
              </SheetHeader>
              <p className="mt-2 text-sm text-muted-foreground">
                Edit project details.
              </p>

              <div className="space-y-6">
                <ProjectSummary project={selectedProject} tasks={projectPageTasks} />

                {selectedProject.canEditDetails ? (
                  <>
                    <ProjectForm
                      value={projectEditForm}
                      onChange={setProjectEditForm}
                      role={currentWorkspace.role}
                      currentUserId={currentWorkspace.currentUserId}
                      teams={managerTeams}
                      people={currentWorkspace.people}
                    />

                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        className="w-full"
                        disabled={saving}
                        onClick={() => void handleProjectUpdate()}
                      >
                        {saving ? "Saving…" : "Save Project Changes"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={saving}
                        onClick={() => void handleProjectArchive()}
                      >
                        <Archive className="size-4" />
                        Archive Project
                      </Button>
                    </div>
                  </>
                ) : (
                  <ProjectReadOnlyDetails project={selectedProject} />
                )}

                {!selectedProject.canEditDetails &&
                  selectedProject.canEditStatus && (
                    <StatusEditor
                      status={projectEditForm.status}
                      blockedReason={projectEditForm.blockedReason}
                      onChange={(status, blockedReason) =>
                        setProjectEditForm({
                          ...projectEditForm,
                          status,
                          blockedReason,
                        })
                      }
                      saving={saving}
                      onSave={() => void handleProjectStatusUpdate()}
                      disabled={
                        projectEditForm.status === selectedProject.status &&
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

      <Dialog
        open={Boolean(blockedPrompt)}
        onOpenChange={(open) => {
          if (!open) {
            setBlockedPrompt(null);
            setBlockedReasonDraft("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark as Blocked?</DialogTitle>
            <DialogDescription>
              {blockedPrompt
                ? `Add a blocker for “${blockedPrompt.title}”.`
                : "Add a blocker."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="quick-blocked-reason">Why is this blocked?</Label>
            <Textarea
              id="quick-blocked-reason"
              rows={4}
              maxLength={500}
              className="resize-none rounded-2xl"
              placeholder="Waiting for supplier approval…"
              value={blockedReasonDraft}
              onChange={(event) => setBlockedReasonDraft(event.target.value)}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockedPrompt(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!blockedReasonDraft.trim() || Boolean(quickBusyKey)}
              onClick={() => void submitBlockedPrompt()}
            >
              Mark Blocked
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingProjectCompletion)}
        onOpenChange={(open) => {
          if (!open) setPendingProjectCompletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete project?</AlertDialogTitle>
            <AlertDialogDescription>
              {incompleteForConfirmation} task
              {incompleteForConfirmation === 1 ? " is" : "s are"} still incomplete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving || Boolean(quickBusyKey)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={saving || Boolean(quickBusyKey)}
              onClick={() => void confirmProjectCompletion()}
            >
              Mark Done
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={teamLeadsOpen} onOpenChange={setTeamLeadsOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Team Leads</SheetTitle>
          </SheetHeader>

          <p className="mt-3 text-sm text-muted-foreground">
            Team Leads can create and fully manage tasks and projects for their
            own teams.
          </p>

          <div className="mt-6 space-y-2">
            {currentWorkspace.people
              .filter((person) => person.role !== "admin")
              .map((person) => {
                const checked = person.role === "team_lead";
                const disabled =
                  leadBusyId === person.id ||
                  (!checked && person.teamIds.length === 0);

                return (
                  <label
                    key={person.id}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border border-border p-4",
                      !disabled && "cursor-pointer hover:bg-muted/40",
                      disabled && "opacity-60",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(value) =>
                        void handleLeadChange(person, value === true)
                      }
                    />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{person.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {person.teamIds.length === 0
                          ? "Assign a team first"
                          : person.teamIds
                              .map(
                                (teamId) =>
                                  currentWorkspace.teams.find((team) => team.id === teamId)
                                    ?.name,
                              )
                              .filter(Boolean)
                              .join(", ")}
                      </p>
                    </div>

                    {leadBusyId === person.id && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                  </label>
                );
              })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

interface TaskCardActions {
  busyKey: string | null;
  onStatusChange: (task: TaskItem, status: TaskStatus) => void;
  onPriorityChange: (task: TaskItem, priority: TaskPriority) => void;
  onDeadlineChange: (task: TaskItem, deadline: string) => Promise<void>;
}

interface ProjectCardActions {
  busyKey: string | null;
  onStatusChange: (project: TaskProject, status: TaskStatus) => void;
  onPriorityChange: (project: TaskProject, priority: TaskPriority) => void;
  onDeadlineChange: (project: TaskProject, deadline: string) => Promise<void>;
}

function ProjectNotFound({ onBack }: { onBack: () => void }) {
  return (
    <div className="surface-card mx-auto max-w-lg rounded-2xl p-8 text-center">
      <AlertTriangle className="mx-auto size-8 text-warning" />
      <p className="mt-3 font-medium">Project not available</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This project may have been archived, deleted, or is outside your scope.
      </p>
      <Button type="button" variant="outline" className="mt-5" onClick={onBack}>
        <ChevronLeft className="size-4" />
        Back to Tasks
      </Button>
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
  const sortedTasks = useMemo(() => sortProjectTasks(tasks), [tasks]);
  const done = tasks.filter((task) => task.status === "Done").length;
  const blocked = tasks.filter((task) => task.status === "Blocked").length;
  const overdue = tasks.filter(
    (task) => task.status !== "Done" && deadlineDays(task.deadline) < 0,
  ).length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  const canOpenEditor = project.canEditDetails || project.canEditStatus;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <button type="button" className="hover:text-foreground" onClick={onBack}>
          Tasks
        </button>
        <ChevronRight className="size-4" />
        <span className="max-w-[18rem] truncate font-medium text-foreground">
          {project.name}
        </span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2"
            onClick={onBack}
          >
            <ChevronLeft className="size-4" />
            Back to Tasks
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-2xl font-semibold sm:text-3xl">
              {project.name}
            </h1>
            <InlinePriorityEditor
              priority={project.priority}
              canEdit={project.canEditDetails}
              saving={projectActions.busyKey === `project:${project.id}:priority`}
              onChange={(priority) =>
                projectActions.onPriorityChange(project, priority)
              }
            />
            <InlineStatusEditor
              status={project.status}
              canEdit={project.canEditStatus}
              saving={projectActions.busyKey === `project:${project.id}:status`}
              onChange={(status) => projectActions.onStatusChange(project, status)}
            />
          </div>

          {project.description && (
            <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </div>

        {canOpenEditor && (
          <Button type="button" variant="outline" onClick={onEdit}>
            <Pencil className="size-4" />
            Edit project
          </Button>
        )}
      </div>

      <div className="surface-card rounded-2xl p-4 sm:p-5">
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <ProjectMeta
            label="Owner"
            value={project.ownerName}
            icon={<UserRound className="size-4" />}
          />
          <ProjectMeta
            label="Team"
            value={project.teamName}
            icon={<Users className="size-4" />}
          />
          <ProjectMeta
            label="Deadline"
            value={
              <InlineDeadlineEditor
                deadline={project.deadline ?? ""}
                status={project.status}
                optional
                canEdit={project.canEditDetails}
                saving={
                  projectActions.busyKey === `project:${project.id}:deadline`
                }
                onChange={(deadline) =>
                  projectActions.onDeadlineChange(project, deadline)
                }
              />
            }
            icon={<CalendarClock className="size-4" />}
          />
          <ProjectMeta
            label="Progress"
            value={`${done}/${tasks.length} done · ${progress}%`}
            icon={<CheckCircle2 className="size-4" />}
          />
        </div>

        <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Tasks" value={tasks.length} />
        <SummaryCard label="Done" value={done} />
        <SummaryCard label="Overdue" value={overdue} danger={overdue > 0} />
        <SummaryCard label="Blocked" value={blocked} danger={blocked > 0} />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="size-4 text-primary" />
            Tasks
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These are regular tasks linked to this project. Use the + button to add one.
          </p>
        </div>

        <ProjectTasksTable
          tasks={sortedTasks}
          onOpen={onOpenTask}
          actions={taskActions}
        />
      </section>

      <ProjectActivityPanel
        project={project}
        tasks={tasks}
        canAdd={project.canEditStatus}
        onAdd={onAddUpdate}
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
  value: ReactNode;
  icon: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 font-medium", valueClassName)}>{value}</div>
    </div>
  );
}

function ProjectTasksTable({
  tasks,
  onOpen,
  actions,
}: {
  tasks: TaskItem[];
  onOpen: (id: string) => void;
  actions: TaskCardActions;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <ClipboardList className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No tasks yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Use the + button to create the first task in this project.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="hidden grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_8rem_7rem_12rem] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
        <span>Task</span>
        <span>Assignee</span>
        <span>Status</span>
        <span>Priority</span>
        <span>Deadline</span>
      </div>

      <div className="divide-y divide-border">
        {tasks.map((task) => {
          const assignees = task.assignees
            .map((assignee) => assignee.name)
            .join(", ");

          return (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              className="grid cursor-pointer gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_8rem_7rem_12rem] md:items-center md:gap-3"
              onClick={() => onOpen(task.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(task.id);
                }
              }}
            >
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    task.status === "Done" && "line-through opacity-70",
                  )}
                >
                  {task.title}
                </p>
                {task.description && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">
                    {task.description}
                  </p>
                )}
              </div>

              <div className="min-w-0 text-xs text-muted-foreground">
                <span className="md:hidden">Assignee: </span>
                <span className="truncate">{assignees || task.ownerName}</span>
              </div>

              <div>
                <InlineStatusEditor
                  status={task.status}
                  canEdit={task.canEditStatus}
                  saving={actions.busyKey === `task:${task.id}:status`}
                  onChange={(status) => actions.onStatusChange(task, status)}
                />
              </div>

              <div>
                <InlinePriorityEditor
                  priority={task.priority}
                  canEdit={task.canEditDetails}
                  saving={actions.busyKey === `task:${task.id}:priority`}
                  onChange={(priority) => actions.onPriorityChange(task, priority)}
                />
              </div>

              <InlineDeadlineEditor
                deadline={task.deadline}
                status={task.status}
                canEdit={task.canEditDetails}
                saving={actions.busyKey === `task:${task.id}:deadline`}
                onChange={(deadline) => actions.onDeadlineChange(task, deadline)}
              />
            </div>
          );
        })}
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
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const activity = useMemo<ProjectActivityItem[]>(() => {
    const items: ProjectActivityItem[] = [
      ...project.updates.map((update) => ({ ...update, context: "Project" })),
      ...tasks.flatMap((task) =>
        task.updates.map((update) => ({ ...update, context: task.title })),
      ),
    ];

    return items.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [project.updates, tasks]);

  async function submit() {
    const body = text.trim();
    if (!body || saving) return;

    setSaving(true);
    try {
      await onAdd(body);
      setText("");
      toast.success("Project update added");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add update.",
      );
    } finally {
      setSaving(false);
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
          Project notes plus updates and clock entries from its tasks.
        </p>
      </div>

      {canAdd && (
        <div className="surface-card rounded-2xl p-3">
          <Textarea
            rows={3}
            maxLength={2000}
            className="resize-none rounded-xl"
            placeholder="Add project progress, a decision, a blocker or a handoff…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!text.trim() || saving}
              onClick={() => void submit()}
            >
              {saving ? "Adding…" : "Add project update"}
            </Button>
          </div>
        </div>
      )}

      {activity.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          No project or task updates yet.
        </div>
      ) : (
        <div className="space-y-2">
          {activity.map((update) => (
            <div
              key={`${update.context}-${update.id}`}
              className="surface-card rounded-2xl p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {update.authorName}
                </span>
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  {update.context}
                </Badge>
                <span>·</span>
                <span>{formatDateTime(update.createdAt)}</span>
                {update.source === "clock" && (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    <Timer className="mr-1 size-3" />
                    Clock
                    {update.durationMs
                      ? ` · ${formatHours(update.durationMs)}`
                      : ""}
                  </Badge>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{update.body}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  tasks,
  onOpen,
  actions,
  overview = false,
}: {
  project: TaskProject;
  tasks: TaskItem[];
  onOpen?: () => void;
  actions: ProjectCardActions;
  overview?: boolean;
}) {
  const doneCount = tasks.filter((task) => task.status === "Done").length;
  const progress =
    tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100);
  return (
    <Card
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      className={cn(
        "surface-card transition-colors",
        onOpen && "cursor-pointer hover:bg-muted/30",
        overview && "rounded-2xl",
      )}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <CardContent className={cn("px-3.5 py-3 sm:px-4", overview && "sm:p-5")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {!overview && (
              <h3 className="break-words text-sm font-semibold sm:text-base">
                {project.name}
              </h3>
            )}

            <div
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs",
                !overview && "mt-1.5",
              )}
            >
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {project.ownerName}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" />
                {project.teamName}
              </span>
              <InlineDeadlineEditor
                deadline={project.deadline ?? ""}
                status={project.status}
                optional
                canEdit={project.canEditDetails}
                saving={actions.busyKey === `project:${project.id}:deadline`}
                onChange={(value) => actions.onDeadlineChange(project, value)}
              />
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <InlinePriorityEditor
              priority={project.priority}
              canEdit={project.canEditDetails}
              saving={actions.busyKey === `project:${project.id}:priority`}
              onChange={(priority) => actions.onPriorityChange(project, priority)}
            />
            <InlineStatusEditor
              status={project.status}
              canEdit={project.canEditStatus}
              saving={actions.busyKey === `project:${project.id}:status`}
              onChange={(status) => actions.onStatusChange(project, status)}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5" />
          {tasks.length === 0 ? (
            <span>No tasks yet</span>
          ) : (
            <span>
              {doneCount} / {tasks.length} completed · {progress}%
            </span>
          )}
        </div>

        {tasks.length > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {overview && project.status === "Blocked" && project.blockedReason && (
          <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive">Blocked</p>
            <p className="mt-1 text-sm">{project.blockedReason}</p>
          </div>
        )}

      </CardContent>
    </Card>
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
      <p className={cn("mt-1 text-2xl font-semibold", danger && "text-destructive")}>
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
  items: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
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
  actions,
}: {
  tasks: TaskItem[];
  emptyTitle: string;
  emptyText: string;
  onOpen: (id: string) => void;
  actions: TaskCardActions;
}) {
  if (tasks.length === 0) {
    return (
      <div className="surface-card py-12 text-center">
        <ClipboardList className="mx-auto size-8 text-muted-foreground" />
        <p className="mt-3 font-medium">{emptyTitle}</p>
        <p className="mt-1 text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClick={() => onOpen(task.id)}
          actions={actions}
        />
      ))}
    </div>
  );
}

function TaskCard({
  task,
  onClick,
  actions,
}: {
  task: TaskItem;
  onClick: () => void;
  actions: TaskCardActions;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      className="surface-card cursor-pointer transition-colors hover:bg-muted/30"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <CardContent className="px-3.5 py-3 sm:px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "break-words text-sm font-semibold sm:text-base",
                task.status === "Done" && "opacity-70",
              )}
            >
              {task.title}
            </h3>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:text-xs">
              <span className="inline-flex items-center gap-1">
                <UserRound className="size-3" />
                {task.ownerName}
              </span>

              <InlineDeadlineEditor
                deadline={task.deadline}
                status={task.status}
                canEdit={task.canEditDetails}
                saving={actions.busyKey === `task:${task.id}:deadline`}
                onChange={(value) => actions.onDeadlineChange(task, value)}
              />

              {task.projectName && (
                <span className="inline-flex max-w-[14rem] items-center gap-1 truncate">
                  <FolderKanban className="size-3" />
                  {task.projectName}
                </span>
              )}

              {task.assignees.length > 1 && (
                <span className="inline-flex items-center gap-1">
                  <Users className="size-3" />
                  {task.assignees.length} assigned
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <InlinePriorityEditor
              priority={task.priority}
              canEdit={task.canEditDetails}
              saving={actions.busyKey === `task:${task.id}:priority`}
              onChange={(priority) => actions.onPriorityChange(task, priority)}
            />
            <InlineStatusEditor
              status={task.status}
              canEdit={task.canEditStatus}
              saving={actions.busyKey === `task:${task.id}:status`}
              onChange={(status) => actions.onStatusChange(task, status)}
            />
          </div>
        </div>

        {task.status === "Blocked" && task.blockedReason && (
          <p className="mt-2 line-clamp-2 text-xs text-destructive">
            {task.blockedReason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function stopInteractiveEvent(event: {
  stopPropagation: () => void;
}) {
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
  onChange: (status: TaskStatus) => void;
}) {
  if (!canEdit) {
    return (
      <Badge
        variant="outline"
        className={cn("rounded-full px-2 py-0 text-[10px]", statusClass(status))}
      >
        {status}
      </Badge>
    );
  }

  return (
    <div
      onClick={stopInteractiveEvent}
      onPointerDown={stopInteractiveEvent}
      onKeyDown={stopInteractiveEvent}
    >
      <Select
        value={status}
        disabled={saving}
        onValueChange={(value) => onChange(value as TaskStatus)}
      >
        <SelectTrigger
          aria-label="Change status"
          className={cn(
            "h-6 w-auto min-w-0 gap-1 rounded-full px-2 py-0 text-[10px] font-medium shadow-none [&>svg]:size-3",
            statusClass(status),
          )}
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <SelectValue />}
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
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
  onChange: (priority: TaskPriority) => void;
}) {
  if (!canEdit) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-full px-2 py-0 text-[10px]",
          priorityClass(priority),
        )}
      >
        {priority}
      </Badge>
    );
  }

  return (
    <div
      onClick={stopInteractiveEvent}
      onPointerDown={stopInteractiveEvent}
      onKeyDown={stopInteractiveEvent}
    >
      <Select
        value={priority}
        disabled={saving}
        onValueChange={(value) => onChange(value as TaskPriority)}
      >
        <SelectTrigger
          aria-label="Change priority"
          className={cn(
            "h-6 w-auto min-w-0 gap-1 rounded-full px-2 py-0 text-[10px] font-medium shadow-none [&>svg]:size-3",
            priorityClass(priority),
          )}
        >
          {saving ? <Loader2 className="size-3 animate-spin" /> : <SelectValue />}
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
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
  onChange,
}: {
  deadline: string;
  status: TaskStatus;
  canEdit: boolean;
  saving: boolean;
  optional?: boolean;
  onChange: (deadline: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const info = deadline
    ? deadlineInfo(deadline, status)
    : { text: "No deadline", className: "text-muted-foreground" };

  if (!canEdit) {
    return (
      <span className={cn("inline-flex items-center gap-1", info.className)}>
        <CalendarClock className="size-3" />
        {info.text}
      </span>
    );
  }

  return (
    <div
      onClick={stopInteractiveEvent}
      onPointerDown={stopInteractiveEvent}
      onKeyDown={stopInteractiveEvent}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted",
              info.className,
            )}
          >
            {saving ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <CalendarClock className="size-3" />
            )}
            {info.text}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64"
          onClick={stopInteractiveEvent}
          onPointerDown={stopInteractiveEvent}
        >
          <div className="space-y-2">
            <Label className="text-xs">Deadline</Label>
            <Input
              type="date"
              value={deadline}
              onChange={(event) => {
                const value = event.target.value;
                if (!optional && !value) return;
                void onChange(value)
                  .then(() => setOpen(false))
                  .catch(() => undefined);
              }}
            />
            {optional && deadline && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() =>
                  void onChange("")
                    .then(() => setOpen(false))
                    .catch(() => undefined)
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
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            className="size-14 rounded-full shadow-lg"
            aria-label="Create"
          >
            <Plus className="size-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="mb-2 w-48">
          <DropdownMenuItem onSelect={onNewTask}>
            <Plus className="size-4" />
            New Task
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewProject}>
            <FolderPlus className="size-4" />
            New Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TaskSummary({ task }: { task: TaskItem }) {
  const deadline = deadlineInfo(task.deadline, task.status);

  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Scope
          </p>
          <p className="mt-1 text-sm font-medium">{task.teamName}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge
            variant="outline"
            className={cn("rounded-full", priorityClass(task.priority))}
          >
            {task.priority}
          </Badge>
          <Badge
            variant="outline"
            className={cn("rounded-full", statusClass(task.status))}
          >
            {task.status}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p>
          Owner: <span className="font-medium text-foreground">{task.ownerName}</span>
        </p>
        {task.projectName && (
          <p>
            Project:{" "}
            <span className="font-medium text-foreground">{task.projectName}</span>
          </p>
        )}
        <p className={deadline.className}>Deadline: {deadline.text}</p>
        <p>
          Created by{" "}
          <span className="font-medium text-foreground">{task.createdByName}</span>
        </p>
      </div>

      {task.status === "Blocked" && task.blockedReason && (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Blocked</p>
          <p className="mt-1 text-sm">{task.blockedReason}</p>
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
  const done = tasks.filter((task) => task.status === "Done").length;
  const progress = tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100);
  const deadline = optionalDeadlineInfo(project.deadline, project.status);

  return (
    <div className="rounded-2xl bg-muted/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Scope
          </p>
          <p className="mt-1 text-sm font-medium">{project.teamName}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Badge
            variant="outline"
            className={cn("rounded-full", priorityClass(project.priority))}
          >
            {project.priority}
          </Badge>
          <Badge
            variant="outline"
            className={cn("rounded-full", statusClass(project.status))}
          >
            {project.status}
          </Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p>
          Owner:{" "}
          <span className="font-medium text-foreground">{project.ownerName}</span>
        </p>
        <p className={deadline.className}>Deadline: {deadline.text}</p>
        <p>
          Progress:{" "}
          <span className="font-medium text-foreground">
            {tasks.length === 0
              ? "No tasks yet"
              : `${done} / ${tasks.length} completed · ${progress}%`}
          </span>
        </p>
        <p>
          Created by{" "}
          <span className="font-medium text-foreground">
            {project.createdByName}
          </span>
        </p>
      </div>

      {tasks.length > 0 && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {project.status === "Blocked" && project.blockedReason && (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
          <p className="text-xs font-medium text-destructive">Blocked</p>
          <p className="mt-1 text-sm">{project.blockedReason}</p>
        </div>
      )}
    </div>
  );
}

function TaskReadOnlyDetails({ task }: { task: TaskItem }) {
  return (
    <div className="space-y-4">
      {task.description && (
        <div>
          <Label>Description</Label>
          <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm">
            {task.description}
          </p>
        </div>
      )}

      <div>
        <Label>Assigned to</Label>
        <div className="mt-2 flex flex-wrap gap-2">
          {task.assignees.map((assignee) => (
            <Badge key={assignee.id} variant="secondary">
              {assignee.name}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProjectReadOnlyDetails({ project }: { project: TaskProject }) {
  const deadline = optionalDeadlineInfo(project.deadline, project.status);

  return (
    <div className="space-y-4">
      {project.description && (
        <div>
          <Label>Description</Label>
          <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-muted/50 p-4 text-sm">
            {project.description}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Owner</Label>
          <p className="mt-2 rounded-2xl bg-muted/50 p-3 text-sm">
            {project.ownerName}
          </p>
        </div>
        <div>
          <Label>Deadline</Label>
          <p className={cn("mt-2 rounded-2xl bg-muted/50 p-3 text-sm", deadline.className)}>
            {deadline.text}
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
      <Label>{label}</Label>
      <Select
        value={status}
        onValueChange={(value) => {
          const nextStatus = value as TaskStatus;
          onChange(
            nextStatus,
            nextStatus === "Blocked" ? blockedReason : "",
          );
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {status === "Blocked" && (
        <div className="space-y-2">
          <Label>Why is this blocked?</Label>
          <Textarea
            rows={3}
            maxLength={500}
            className="resize-none rounded-2xl"
            placeholder="Waiting for supplier approval…"
            value={blockedReason}
            onChange={(event) => onChange(status, event.target.value)}
          />
        </div>
      )}

      <Button
        type="button"
        className="w-full"
        disabled={saving || disabled}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Update Status"}
      </Button>
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
  standalone = false,
}: {
  title: string;
  description: string;
  updates: WorkUpdate[];
  canAdd: boolean;
  onAdd: (body: string) => Promise<void>;
  emptyText: string;
  standalone?: boolean;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const body = text.trim();
    if (!body || saving) return;

    setSaving(true);
    try {
      await onAdd(body);
      setText("");
      toast.success("Update added");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add update.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className={cn(
        "space-y-4",
        !standalone && "border-t border-border pt-5",
      )}
    >
      <div>
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-primary" />
          <Label>{title}</Label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>

      {canAdd && (
        <div className="surface-card space-y-2 rounded-2xl p-3">
          <Textarea
            rows={3}
            maxLength={2000}
            className="resize-none rounded-xl"
            placeholder="Add progress, a decision, a blocker or a handoff…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!text.trim() || saving}
              onClick={() => void submit()}
            >
              {saving ? "Adding…" : "Add update"}
            </Button>
          </div>
        </div>
      )}

      {updates.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">
          {updates.map((entry) => (
            <div key={entry.id} className="surface-card rounded-2xl p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {entry.authorName}
                </span>
                <span>·</span>
                <span>{formatDateTime(entry.createdAt)}</span>
                {entry.source === "clock" && (
                  <Badge variant="secondary" className="rounded-full text-[10px]">
                    <Timer className="mr-1 size-3" />
                    Clock
                    {entry.durationMs ? ` · ${formatHours(entry.durationMs)}` : ""}
                  </Badge>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{entry.body}</p>
            </div>
          ))}
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
  onChange: (value: TaskFormValue) => void;
  role: TaskRole;
  currentUserId: string;
  teams: { id: string; name: string }[];
  projects: TaskProject[];
  people: TaskPerson[];
}) {
  const eligiblePeople =
    value.teamId === "general"
      ? people
      : people.filter((person) => person.teamIds.includes(value.teamId));

  const eligibleProjects = projects.filter((project) =>
    value.teamId === "general"
      ? project.teamId === null
      : project.teamId === value.teamId,
  );

  function changeScope(teamId: string) {
    const nextPeople =
      teamId === "general"
        ? people
        : people.filter((person) => person.teamIds.includes(teamId));
    const allowed = new Set(nextPeople.map((person) => person.id));
    const nextOwner = allowed.has(value.ownerId)
      ? value.ownerId
      : allowed.has(currentUserId)
        ? currentUserId
        : nextPeople[0]?.id ?? "";

    const selectedProject = projects.find(
      (project) => project.id === value.projectId,
    );
    const projectStillValid = selectedProject
      ? teamId === "general"
        ? selectedProject.teamId === null
        : selectedProject.teamId === teamId
      : value.projectId === "none";

    onChange({
      ...value,
      teamId,
      ownerId: nextOwner,
      projectId: projectStillValid ? value.projectId : "none",
      assigneeIds: value.assigneeIds.filter((userId) => allowed.has(userId)),
    });
  }

  function togglePerson(userId: string, enabled: boolean) {
    onChange({
      ...value,
      assigneeIds: enabled
        ? Array.from(new Set([...value.assigneeIds, userId]))
        : value.assigneeIds.filter((id) => id !== userId),
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Title</Label>
        <Input
          maxLength={120}
          placeholder="Prepare kickoff presentation"
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          rows={5}
          maxLength={2000}
          className="resize-none rounded-2xl"
          placeholder="Add details or requirements…"
          value={value.description}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={value.status}
            onValueChange={(statusValue) => {
              const status = statusValue as TaskStatus;
              onChange({
                ...value,
                status,
                blockedReason: status === "Blocked" ? value.blockedReason : "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select
            value={value.priority}
            onValueChange={(priority) =>
              onChange({ ...value, priority: priority as TaskPriority })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.status === "Blocked" && (
        <div className="space-y-2">
          <Label>Why is this blocked?</Label>
          <Textarea
            rows={3}
            maxLength={500}
            className="resize-none rounded-2xl"
            placeholder="Waiting for supplier approval…"
            value={value.blockedReason}
            onChange={(event) =>
              onChange({ ...value, blockedReason: event.target.value })
            }
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Deadline</Label>
          <Input
            type="date"
            value={value.deadline}
            onChange={(event) =>
              onChange({ ...value, deadline: event.target.value })
            }
          />
        </div>

        <div className="space-y-2">
          <Label>Team</Label>
          <Select value={value.teamId} onValueChange={changeScope}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {role === "admin" && (
                <SelectItem value="general">General — everyone</SelectItem>
              )}
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Owner</Label>
          <Select
            value={value.ownerId}
            onValueChange={(ownerId) => onChange({ ...value, ownerId })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose an owner" />
            </SelectTrigger>
            <SelectContent>
              {eligiblePeople.map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Project</Label>
          <Select
            value={value.projectId}
            onValueChange={(projectId) => onChange({ ...value, projectId })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No project</SelectItem>
              {eligibleProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {eligibleProjects.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No projects exist for this team yet.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label>Assignees</Label>
          <span className="text-xs text-muted-foreground">
            {value.assigneeIds.length} selected
          </span>
        </div>

        <div className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
          {eligiblePeople.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No people are available for this team.
            </p>
          ) : (
            eligiblePeople.map((person) => {
              const checked = value.assigneeIds.includes(person.id);
              return (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-muted"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(enabled) =>
                      togglePerson(person.id, enabled === true)
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{person.name}</p>
                    {person.role === "team_lead" && (
                      <p className="text-xs text-primary">Team Lead</p>
                    )}
                  </div>
                </label>
              );
            })
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
  teams: { id: string; name: string }[];
  people: TaskPerson[];
}) {
  const eligiblePeople =
    value.teamId === "general"
      ? people
      : people.filter((person) => person.teamIds.includes(value.teamId));

  function changeScope(teamId: string) {
    const nextPeople =
      teamId === "general"
        ? people
        : people.filter((person) => person.teamIds.includes(teamId));
    const allowed = new Set(nextPeople.map((person) => person.id));

    onChange({
      ...value,
      teamId,
      ownerId: allowed.has(value.ownerId)
        ? value.ownerId
        : allowed.has(currentUserId)
          ? currentUserId
          : nextPeople[0]?.id ?? "",
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Name</Label>
        <Input
          maxLength={120}
          placeholder="Global 7500 Installation"
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          rows={5}
          maxLength={2000}
          className="resize-none rounded-2xl"
          placeholder="What is this project trying to achieve?"
          value={value.description}
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Status</Label>
          <Select
            value={value.status}
            onValueChange={(statusValue) => {
              const status = statusValue as TaskStatus;
              onChange({
                ...value,
                status,
                blockedReason: status === "Blocked" ? value.blockedReason : "",
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Priority</Label>
          <Select
            value={value.priority}
            onValueChange={(priority) =>
              onChange({ ...value, priority: priority as TaskPriority })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.status === "Blocked" && (
        <div className="space-y-2">
          <Label>Why is this blocked?</Label>
          <Textarea
            rows={3}
            maxLength={500}
            className="resize-none rounded-2xl"
            placeholder="Waiting for approval…"
            value={value.blockedReason}
            onChange={(event) =>
              onChange({ ...value, blockedReason: event.target.value })
            }
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Deadline</Label>
          <Input
            type="date"
            value={value.deadline}
            onChange={(event) =>
              onChange({ ...value, deadline: event.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">Optional for projects.</p>
        </div>

        <div className="space-y-2">
          <Label>Team</Label>
          <Select value={value.teamId} onValueChange={changeScope}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {role === "admin" && (
                <SelectItem value="general">General — everyone</SelectItem>
              )}
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Owner</Label>
        <Select
          value={value.ownerId}
          onValueChange={(ownerId) => onChange({ ...value, ownerId })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose an owner" />
          </SelectTrigger>
          <SelectContent>
            {eligiblePeople.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}