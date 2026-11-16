import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { addDays, format, isBefore, parseISO, startOfDay } from "date-fns";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, ChevronDown,
  ChevronRight, Circle, Loader2, Plus, RefreshCw, Pencil, Archive, Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  archiveTask, createTask, updateTask, updateTaskStatus,
  type TaskPriority, type TaskRole, type TaskStatus,
} from "@/lib/tasks.functions";

// Authenticated read-only task feed. Collocated to avoid an extra source file.
interface FeedTeam {
  id: string;
  name: string;
}

interface FeedPerson {
  id: string;
  name: string;
  teamIds: string[];
}

interface FeedTask {
  id: string;
  title: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  ownerName: string;
  assigneeIds: string[];
  teamId: string | null;
  projectId: string | null;
  blockedReason: string;
  createdAt: string;
  updatedAt: string;
  canEditStatus: boolean;
  canEditDetails: boolean;
}

interface SimpleTaskFeed {
  currentUserId: string;
  role: TaskRole;
  teamIds: string[];
  teams: FeedTeam[];
  people: FeedPerson[];
  tasks: FeedTask[];
  hasMore: boolean;
}

const MAX_TASKS = 750;

function highestRole(roles: string[]): TaskRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("team_lead")) return "team_lead";
  if (roles.includes("mentor")) return "mentor";
  return "user";
}

const getSimpleTaskFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SimpleTaskFeed> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const admin = supabaseAdmin as any;

    // One authenticated server request, with five parallel read operations.
    // Only the fields the UI actually needs are transmitted to the client.
    // Older completed work stays in the database, but is not downloaded here.
    const recentCompleted = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [teamsResult, peopleResult, membershipsResult, rolesResult, tasksResult] =
      await Promise.all([
        admin.from("teams").select("id, name").order("name"),
        admin.from("profiles").select("id, name, team_id").order("name"),
        admin.from("team_members").select("user_id, team_id"),
        admin.from("user_roles").select("role").eq("user_id", context.userId),
        admin
          .from("tasks")
          .select(
            "id, title, description, deadline, status, priority, owner_id, blocked_reason, team_id, project_id, created_at, updated_at",
          )
          .is("archived_at", null)
          .is("deleted_at", null)
          .or(`status.neq.Done,updated_at.gte.${recentCompleted}`)
          .order("updated_at", { ascending: false })
          .limit(MAX_TASKS + 1),
      ]);

    const error = [
      teamsResult.error,
      peopleResult.error,
      membershipsResult.error,
      rolesResult.error,
      tasksResult.error,
    ].find(Boolean);
    if (error) throw new Error("Unable to load tasks.");

    const rawTasks = tasksResult.data ?? [];
    const tasks = rawTasks.slice(0, MAX_TASKS);
    const taskIds: string[] = tasks.map((task: any) => task.id);

    // Scope assignments to the tasks actually visible on this board.
    // No full-table update-history scan and no project-history scan.
    let assignments: Array<{ task_id: string; user_id: string }> = [];
    if (taskIds.length) {
      // Avoid very long query URLs while preserving the full result.
      const BATCH_SIZE = 150;
      const batches: string[][] = [];
      for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
        batches.push(taskIds.slice(i, i + BATCH_SIZE));
      }
      const results = await Promise.all(
        batches.map((ids) =>
          admin
            .from("task_assignees")
            .select("task_id, user_id")
            .in("task_id", ids),
        ),
      );
      if (results.some((result) => result.error)) {
        throw new Error("Unable to load task assignments.");
      }
      assignments = results.flatMap((result) => result.data ?? []);
    }

    const memberTeams = new Map<string, string[]>();
    for (const row of membershipsResult.data ?? []) {
      const existing = memberTeams.get(row.user_id) ?? [];
      if (!existing.includes(row.team_id)) existing.push(row.team_id);
      memberTeams.set(row.user_id, existing);
    }

    const people: FeedPerson[] = (peopleResult.data ?? []).map((person: any) => {
      const teams = memberTeams.get(person.id) ?? [];
      return {
        id: person.id,
        name: person.name ?? "Member",
        teamIds: teams.length ? teams : person.team_id ? [person.team_id] : [],
      };
    });
    const personById = new Map(people.map((person) => [person.id, person]));
    const myTeamIds = personById.get(context.userId)?.teamIds ?? [];
    const role = highestRole((rolesResult.data ?? []).map((row: any) => row.role));

    const taskAssignees = new Map<string, string[]>();
    for (const row of assignments) {
      const current = taskAssignees.get(row.task_id) ?? [];
      if (!current.includes(row.user_id)) current.push(row.user_id);
      taskAssignees.set(row.task_id, current);
    }

    return {
      currentUserId: context.userId,
      role,
      teamIds: myTeamIds,
      teams: (teamsResult.data ?? []).map((team: any) => ({
        id: team.id,
        name: team.name,
      })),
      people,
      tasks: tasks.map((task: any) => {
        const assigneeIds = taskAssignees.get(task.id) ?? [];
        const mayManage =
          role === "admin" ||
          ((role === "team_lead" || role === "mentor") &&
            task.team_id !== null &&
            myTeamIds.includes(task.team_id));
        return {
          id: task.id,
          title: task.title,
          description: task.description ?? "",
          deadline: task.deadline,
          status: task.status as TaskStatus,
          priority: task.priority as TaskPriority,
          ownerId: task.owner_id,
          ownerName: personById.get(task.owner_id)?.name ?? "Member",
          assigneeIds,
          teamId: task.team_id,
          projectId: task.project_id,
          blockedReason: task.blocked_reason ?? "",
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          canEditDetails: mayManage,
          canEditStatus:
            mayManage || task.owner_id === context.userId ||
            assigneeIds.includes(context.userId),
        };
      }),
      hasMore: rawTasks.length > MAX_TASKS,
    };
  });

export const Route = createFileRoute("/_authenticated/tasks")({
  component: TasksPage,
  validateSearch: (search: Record<string, unknown>) => ({
    task: typeof search['task'] === "string" ? search['task'] : undefined,
    project: typeof search['project'] === "string" ? search['project'] : undefined,
  }),
  head: () => ({ meta: [{ title: "Tasks · POM" }] }),
});

type Page = "my" | "teams";
const GENERAL_ID = "general";
const initialDue = () => format(addDays(new Date(), 7), "yyyy-MM-dd");
const keyFor = (userId: string) => ["pom-simple-task-feed", userId] as const;

const labelFor = (status: TaskStatus): string => ({
  "To Do": "To do",
  "In Progress": "In progress",
  Blocked: "Needs help",
  Done: "Done",
})[status];

function dueText(day: string) {
  if (!day) return "No due date";
  try {
    const date = parseISO(day);
    const today = startOfDay(new Date());
    if (isBefore(date, today)) return "Overdue";
    if (day === format(today, "yyyy-MM-dd")) return "Today";
    return format(date, "MMM d");
  } catch {
    return day;
  }
}

function sortOpen(tasks: FeedTask[]) {
  const today = format(new Date(), "yyyy-MM-dd");
  const priority = (task: FeedTask) => {
    if (task.status === "Blocked") return 0;
    if (task.deadline && task.deadline < today) return 1;
    if (task.status === "In Progress") return 2;
    return 3;
  };
  return [...tasks].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.deadline.localeCompare(b.deadline) ||
      a.title.localeCompare(b.title),
  );
}

function StatusTag({ status }: { status: TaskStatus }) {
  if (status === "To Do") return null;
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
      status === "Blocked" && "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
      status === "In Progress" && "bg-primary/10 text-primary",
      status === "Done" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    )}>
      {status === "Blocked" && <AlertCircle className="size-3" />}
      {status === "Done" && <Check className="size-3" />}
      {labelFor(status)}
    </span>
  );
}

function TaskLine({
  task, mine, teamName, disabled, onOpen, onDone,
}: {
  task: FeedTask;
  mine: boolean;
  teamName: string;
  disabled: boolean;
  onOpen: (task: FeedTask) => void;
  onDone: (task: FeedTask) => void;
}) {
  const done = task.status === "Done";
  const overdue = !done && task.deadline && task.deadline < format(new Date(), "yyyy-MM-dd");
  return (
    <div className="flex min-h-[76px] items-center gap-3 border-b border-border/75 px-3 py-3 last:border-b-0 sm:px-4">
      {task.canEditStatus ? (
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-full border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
            done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 text-transparent hover:border-primary hover:text-primary",
          )}
          title={done ? "Reopen task" : new Set([task.ownerId, ...task.assigneeIds]).size > 1 ? "Mark done for all assigned people" : "Mark done"}
          aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
          onClick={() => onDone(task)}
        >
          <Check className="size-4" />
        </button>
      ) : (
        <Circle className="size-6 shrink-0 text-muted-foreground/25" aria-hidden />
      )}

      <button
        type="button"
        className="min-w-0 flex-1 py-0.5 text-left focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        onClick={() => onOpen(task)}
        aria-label={`Open task: ${task.title}`}
      >
        <span dir="auto" className={cn("block truncate text-sm font-semibold", done && "text-muted-foreground line-through")}>
          {task.title}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {mine ? teamName : task.ownerName}
          {new Set([task.ownerId, ...task.assigneeIds]).size > 1
            ? ` · ${new Set([task.ownerId, ...task.assigneeIds]).size} people`
            : ""}
          {task.status === "Blocked" && task.blockedReason ? ` · ${task.blockedReason}` : ""}
        </span>
      </button>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className={cn("whitespace-nowrap text-[11px] font-semibold", overdue ? "text-destructive" : "text-muted-foreground")}>
          {dueText(task.deadline)}
        </span>
        <StatusTag status={task.status} />
      </div>
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={`Details of ${task.title}`}
        onClick={() => onOpen(task)}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function TasksPage() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();
  const getFeed = useServerFn(getSimpleTaskFeed);
  const create = useServerFn(createTask);
  const edit = useServerFn(updateTask);
  const archive = useServerFn(archiveTask);
  const { task: linkedTask } = Route.useSearch();
  const saveStatus = useServerFn(updateTaskStatus);

  const [page, setPage] = useState<Page>("my");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const openedLinkRef = useRef<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  // A task has one lead and can have any number of additional assignees.
  const [additionalAssigneeIds, setAdditionalAssigneeIds] = useState<string[]>([]);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [personSearch, setPersonSearch] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState(initialDue);
  const [newDescription, setNewDescription] = useState("");
  // Empty means no team selected. "general" is an explicit admin-only choice.
  const [newTeamId, setNewTeamId] = useState("");
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [needHelp, setNeedHelp] = useState(false);
  const [blockReason, setBlockReason] = useState("");

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: keyFor(currentUser.id),
    queryFn: () => getFeed(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    // No request when returning after a few seconds. One stale refresh after 5min.
    refetchOnWindowFocus: (query) =>
      Date.now() - query.state.dataUpdatedAt >= 5 * 60_000,
    refetchOnReconnect: (query) =>
      Date.now() - query.state.dataUpdatedAt >= 5 * 60_000,
    retry: 1,
  });

  const people = data?.people ?? [];
  const teams = data?.teams ?? [];
  const tasks = data?.tasks ?? [];

  // Task links from existing notifications continue to open the right task.
  useEffect(() => {
    if (!linkedTask) {
      openedLinkRef.current = null;
    } else if (openedLinkRef.current !== linkedTask && tasks.some((task) => task.id === linkedTask)) {
      openedLinkRef.current = linkedTask;
      setSelectedTask(linkedTask);
    }
  }, [linkedTask, tasks]);
  const active = useMemo(() => tasks.filter((task) => task.status !== "Done"), [tasks]);
  const completed = useMemo(() => tasks.filter((task) => task.status === "Done"), [tasks]);
  const mine = useMemo(() =>
    active.filter((task) => task.ownerId === currentUser.id || task.assigneeIds.includes(currentUser.id)),
    [active, currentUser.id]);
  const mineCompleted = useMemo(() =>
    completed.filter((task) => task.ownerId === currentUser.id || task.assigneeIds.includes(currentUser.id)),
    [completed, currentUser.id]);
  const selected = tasks.find((task) => task.id === selectedTask) ?? null;
  const chosenTeam = teams.find((team) => team.id === teamId);
  const canCreate = data?.role === "admin" || data?.role === "team_lead" || data?.role === "mentor";

  const allowedPeople = useMemo(() => {
    if (!data) return [];
    if (data.role === "admin") return people;
    if (data.role === "team_lead" || data.role === "mentor") {
      return people.filter((person) => person.teamIds.some((id) => data.teamIds.includes(id)));
    }
    return [];
  }, [data, people]);

  // A task's team is always chosen explicitly before choosing the lead.
  // Never infer or silently change its team from the selected person's memberships.
  const teamOptions = data?.role === "admin"
    ? [{ id: GENERAL_ID, name: "General" }, ...teams]
    : teams.filter((team) => data?.teamIds.includes(team.id));
  const teamIsSelected = newTeamId !== "";
  const selectedScopeId = newTeamId === GENERAL_ID ? null : newTeamId || null;
  const peopleForTeam = teamIsSelected
    ? allowedPeople.filter((person) =>
        newTeamId === GENERAL_ID || person.teamIds.includes(newTeamId))
    : [];
  const selectedOwner = peopleForTeam.find((person) => person.id === ownerId);
  const assignableTeammates = peopleForTeam.filter((person) => person.id !== ownerId);
  const matchingTeammates = assignableTeammates.filter((person) =>
    person.name.toLocaleLowerCase().includes(personSearch.trim().toLocaleLowerCase()),
  );
  const personById = new Map(people.map((person) => [person.id, person]));
  const selectedAssignees = additionalAssigneeIds
    .map((id) => personById.get(id))
    .filter((person): person is FeedPerson => Boolean(person));
  const teamOf = (id: string | null) => id === null ? "General" : teams.find((team) => team.id === id)?.name ?? "Team";
  const participantIds = (task: FeedTask) => [...new Set([task.ownerId, ...task.assigneeIds])];

  function selectTaskTeam(nextTeamId: string) {
    // Choosing a new team retains only people who actually belong to it.
    // A manager can explicitly select General when creating a cross-team task.
    const isMember = (id: string) => allowedPeople.some((person) =>
      person.id === id && (nextTeamId === GENERAL_ID || person.teamIds.includes(nextTeamId)));
    setNewTeamId(nextTeamId);
    setOwnerId((id) => isMember(id) ? id : "");
    setAdditionalAssigneeIds((ids) => ids.filter((id) => isMember(id)));
    setShowAssigneePicker(false);
    setPersonSearch("");
  }

  function selectTaskLead(nextOwnerId: string) {
    setOwnerId(nextOwnerId);
    setAdditionalAssigneeIds((ids) => ids.filter((id) => id !== nextOwnerId));
  }

  function updateLocally(taskId: string, patch: Partial<FeedTask>) {
    queryClient.setQueryData<SimpleTaskFeed>(keyFor(currentUser.id), (old) =>
      old ? { ...old, tasks: old.tasks.map((task) => task.id === taskId ? { ...task, ...patch } : task) } : old,
    );
  }

  async function changeStatus(task: FeedTask, status: TaskStatus, reason = "") {
    if (!task.canEditStatus || workingId) return;
    const snapshot = queryClient.getQueryData<SimpleTaskFeed>(keyFor(currentUser.id));
    setWorkingId(task.id);
    updateLocally(task.id, {
      status,
      blockedReason: status === "Blocked" ? reason : "",
      updatedAt: new Date().toISOString(),
    });
    try {
      await saveStatus({ data: { taskId: task.id, status, blockedReason: reason } });
      toast.success(status === "Done" ? "Task completed" : "Task updated");
      setNeedHelp(false);
      setBlockReason("");
    } catch (failure) {
      if (snapshot) queryClient.setQueryData(keyFor(currentUser.id), snapshot);
      toast.error(failure instanceof Error ? failure.message : "Could not update task");
    } finally {
      setWorkingId(null);
    }
  }

  function showCreate() {
    setEditingId(null);
    if (teamOptions.length === 0) {
      toast.error("No teams are available for assigning tasks.");
      return;
    }
    setOwnerId("");
    setNewTeamId("");
    setAdditionalAssigneeIds([]);
    setShowAssigneePicker(false);
    setPersonSearch("");
    setNewDue(initialDue());
    setNewTitle("");
    setNewDescription("");
    setCreating(true);
  }

  function showEdit(task: FeedTask) {
    if (!task.canEditDetails) return;
    setEditingId(task.id);
    setOwnerId(task.ownerId);
    setNewTeamId(task.teamId ?? GENERAL_ID);
    setAdditionalAssigneeIds([...new Set(task.assigneeIds.filter((id) => id !== task.ownerId))]);
    setShowAssigneePicker(false);
    setPersonSearch("");
    setNewTitle(task.title);
    setNewDue(task.deadline);
    setNewDescription(task.description);
    setSelectedTask(null);
    setCreating(true);
  }

  async function archiveSelected(task: FeedTask) {
    if (!task.canEditDetails || archiving) return;
    if (!window.confirm(`Archive “${task.title}”? You can still find its history in the database.`)) return;
    setArchiving(true);
    try {
      await archive({ data: { taskId: task.id } });
      queryClient.setQueryData<SimpleTaskFeed>(keyFor(currentUser.id), (old) =>
        old ? { ...old, tasks: old.tasks.filter((item) => item.id !== task.id) } : old,
      );
      setSelectedTask(null);
      toast.success("Task archived");
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not archive task");
    } finally {
      setArchiving(false);
    }
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !canCreate || saving) return;
    if (!teamIsSelected || !teamOptions.some((team) => team.id === newTeamId)) {
      toast.error("Choose a team for this task.");
      return;
    }
    const assignedTeam = selectedScopeId;
    // The team is explicit; never fall back to one of the assignee's teams.
    if (data.role !== "admin" && (!assignedTeam || !data.teamIds.includes(assignedTeam))) {
      toast.error("You can only create tasks for your teams.");
      return;
    }
    const person = peopleForTeam.find((item) => item.id === ownerId);
    if (!person) {
      toast.error("Choose a task lead from the selected team.");
      return;
    }
    if (!newTitle.trim() || !newDue) return;
    if (additionalAssigneeIds.some((id) =>
      !peopleForTeam.some((candidate) => candidate.id === id))) {
      toast.error("All assigned people must belong to the selected team.");
      return;
    }
    setSaving(true);
    try {
      const editing = editingId ? tasks.find((task) => task.id === editingId) : undefined;
      // Keep the lead in task_assignees so every assigned person sees this in My Tasks.
      // The existing server validates membership and updates assignment notifications.
      const assigneeIds = Array.from(new Set([
        person.id,
        ...additionalAssigneeIds.filter((id) => {
          return peopleForTeam.some((candidate) => candidate.id === id);
        }),
      ]));

      if (editing) {
        await edit({
          data: {
            taskId: editing.id,
            title: newTitle.trim(),
            description: newDescription.trim(),
            deadline: newDue,
            status: editing.status,
            priority: editing.priority,
            ownerId: person.id,
            blockedReason: editing.blockedReason,
            projectId: editing.teamId === assignedTeam ? editing.projectId : null,
            teamId: assignedTeam,
            assigneeIds,
          },
        });
        updateLocally(editing.id, {
          title: newTitle.trim(),
          description: newDescription.trim(),
          deadline: newDue,
          ownerId: person.id,
          ownerName: person.name,
          teamId: assignedTeam,
          projectId: editing.teamId === assignedTeam ? editing.projectId : null,
          assigneeIds,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const result = await create({
          data: {
            title: newTitle.trim(),
            description: newDescription.trim(),
            deadline: newDue,
            status: "To Do",
            priority: "Medium",
            ownerId: person.id,
            blockedReason: "",
            projectId: null,
            teamId: assignedTeam,
            assigneeIds,
          },
        });
        const now = new Date().toISOString();
        const added: FeedTask = {
          id: result.id,
          title: newTitle.trim(),
          description: newDescription.trim(),
          deadline: newDue,
          status: "To Do",
          priority: "Medium",
          ownerId: person.id,
          ownerName: person.name,
          assigneeIds,
          teamId: assignedTeam,
          projectId: null,
          blockedReason: "",
          createdAt: now,
          updatedAt: now,
          canEditDetails: data.role === "admin" ||
            (assignedTeam !== null && data.teamIds.includes(assignedTeam)),
          canEditStatus: data.role === "admin" || assigneeIds.includes(currentUser.id) ||
            (assignedTeam !== null && data.teamIds.includes(assignedTeam)),
        };
        queryClient.setQueryData<SimpleTaskFeed>(keyFor(currentUser.id), (old) =>
          old ? { ...old, tasks: [added, ...old.tasks] } : old,
        );
      }
      setCreating(false);
      setEditingId(null);
      toast.success(editing ? "Task updated" : "Task created");
      if (!assigneeIds.includes(currentUser.id)) {
        setPage("teams");
        setTeamId(assignedTeam ?? GENERAL_ID);
      } else {
        setPage("my");
        setTeamId(null);
      }
      setShowCompleted(false);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not create task");
    } finally {
      setSaving(false);
    }
  }

  function tasksForTeam(id: string | null) {
    return tasks.filter((task) => task.teamId === id);
  }

  function renderList(items: FeedTask[], mineView: boolean) {
    return items.length ? (
      <div className="surface-card overflow-hidden rounded-2xl shadow-sm">
        {items.map((task) => (
          <TaskLine
            key={task.id}
            task={task}
            mine={mineView}
            teamName={teamOf(task.teamId)}
            disabled={workingId === task.id}
            onOpen={(item) => {
              setSelectedTask(item.id);
              setNeedHelp(false);
              setBlockReason("");
            }}
            onDone={(item) => void changeStatus(item, item.status === "Done" ? "To Do" : "Done")}
          />
        ))}
      </div>
    ) : (
      <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-10 text-center">
        <CheckCircle2 className="mx-auto mb-2 size-7 text-primary/60" />
        <p className="text-sm font-semibold">All caught up</p>
        <p className="mt-1 text-xs text-muted-foreground">Nothing to do here right now.</p>
      </div>
    );
  }

  const teamOpen = teamId !== null ? tasksForTeam(teamId === GENERAL_ID ? null : teamId).filter((task) => task.status !== "Done") : [];
  const teamDone = teamId !== null ? tasksForTeam(teamId === GENERAL_ID ? null : teamId).filter((task) => task.status === "Done") : [];
  const listedTeams: Array<FeedTeam & { symbol: string }> = [
    ...teams.map((team) => ({ ...team, symbol: team.name.slice(0, 1).toUpperCase() })),
    ...(tasks.some((task) => task.teamId === null) ? [{ id: GENERAL_ID, name: "General", symbol: "G" }] : []),
  ];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-28">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold sm:text-3xl">Tasks</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your work. Everyone's progress.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 rounded-xl"
            aria-label="Refresh tasks"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("size-4", isFetching && "animate-spin")} />
          </Button>
          {canCreate && (
            <Button type="button" className="h-9 gap-1.5 rounded-xl px-3" onClick={showCreate}>
              <Plus className="size-4" /> New Task
            </Button>
          )}
        </div>
      </div>

      <div className="flex max-w-sm gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Task sections">
        <button
          type="button" role="tab" aria-selected={page === "my"}
          onClick={() => { setPage("my"); setTeamId(null); setShowCompleted(false); }}
          className={cn("flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors", page === "my" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
        >My Tasks</button>
        <button
          type="button" role="tab" aria-selected={page === "teams"}
          onClick={() => { setPage("teams"); setTeamId(null); setShowCompleted(false); }}
          className={cn("flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors", page === "teams" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
        >All Teams</button>
      </div>

      {isPending ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Loading tasks…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/20 bg-card p-5 text-center">
          <p className="text-sm font-medium">Couldn't load tasks.</p>
          <Button variant="outline" className="mt-3" onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : (
        <>
          {data?.hasMore && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Showing the 750 most recently updated tasks. Older tasks are still safely stored.
            </p>
          )}

          {page === "my" ? (
            <section className="space-y-3" aria-label="My tasks">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">My open tasks</h2>
                <span className="text-xs text-muted-foreground">{mine.length} to do</span>
              </div>
              {renderList(sortOpen(mine), true)}
              {!!mineCompleted.length && (
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCompleted((current) => !current)}
                  >
                    <ChevronDown className={cn("size-4 transition-transform", showCompleted && "rotate-180")} />
                    {showCompleted ? "Hide" : "Show"} completed ({mineCompleted.length})
                  </button>
                  {showCompleted && renderList(mineCompleted, true)}
                </div>
              )}
            </section>
          ) : teamId === null ? (
            <section className="space-y-3" aria-label="All teams">
              <h2 className="text-sm font-semibold">What is everyone working on?</h2>
              <div className="space-y-2.5">
                {listedTeams.map((team, index) => {
                  const teamTasks = tasksForTeam(team.id === GENERAL_ID ? null : team.id);
                  const open = sortOpen(teamTasks.filter((task) => task.status !== "Done"));
                  const blocked = open.filter((task) => task.status === "Blocked").length;
                  const preview = open.find((task) => task.status === "In Progress") ?? open[0];
                  return (
                    <button
                      key={team.id}
                      type="button"
                      className="surface-card flex w-full min-h-[82px] items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:border-primary/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      onClick={() => { setTeamId(team.id); setShowCompleted(false); }}
                    >
                      <span className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-xl font-semibold",
                        index % 4 === 0 ? "bg-primary/10 text-primary" :
                        index % 4 === 1 ? "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300" :
                        index % 4 === 2 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" :
                        "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
                      )}>{team.symbol}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{team.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {preview?.title ?? "No active tasks"}
                          {blocked ? ` · ${blocked} needs help` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{open.length} active</span>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                Everyone can view team progress. Only responsible members can update tasks.
              </p>
            </section>
          ) : (
            <section className="space-y-3" aria-label="Team tasks">
              <div className="flex items-center gap-3">
                <Button
                  type="button" variant="outline" size="icon" className="size-9 rounded-xl"
                  onClick={() => { setTeamId(null); setShowCompleted(false); }} aria-label="Back to all teams"
                ><ArrowLeft className="size-4" /></Button>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold">{teamId === GENERAL_ID ? "General" : chosenTeam?.name ?? "Team"}</h2>
                  <p className="text-xs text-muted-foreground">{teamOpen.length} active · Visible to everyone</p>
                </div>
              </div>
              {renderList(sortOpen(teamOpen), false)}
              {!!teamDone.length && (
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCompleted((value) => !value)}
                  ><ChevronDown className={cn("size-4 transition-transform", showCompleted && "rotate-180")} />
                    {showCompleted ? "Hide" : "Show"} completed ({teamDone.length})
                  </button>
                  {showCompleted && renderList(teamDone, false)}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <Dialog open={creating} onOpenChange={(open) => !saving && setCreating(open)}>
        <DialogContent className="max-h-[88dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit task" : "New task"}</DialogTitle>
            <DialogDescription>{editingId ? "Update the essentials." : "Assign a task in a few seconds."}</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submitTask(event)}>
            <div className="space-y-1.5">
              <Label htmlFor="new-task-title">What needs to be done?</Label>
              <Input id="new-task-title" autoFocus required maxLength={120} dir="auto" placeholder="e.g. Check motor connections" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-task-team">Team</Label>
              <Select value={newTeamId} onValueChange={selectTaskTeam}>
                <SelectTrigger id="new-task-team" className="w-full"><SelectValue placeholder="Choose a team" /></SelectTrigger>
                <SelectContent>{teamOptions.map((team) => (
                  <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                ))}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="new-task-owner">Task lead</Label>
                <Select value={ownerId} onValueChange={selectTaskLead} disabled={!teamIsSelected}>
                  <SelectTrigger id="new-task-owner" className="min-w-0"><SelectValue placeholder={teamIsSelected ? "Choose person" : "Choose team first"} /></SelectTrigger>
                  <SelectContent>{peopleForTeam.map((person) => (
                    <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="new-task-date">Due date</Label>
                <Input id="new-task-date" type="date" required value={newDue} onChange={(event) => setNewDue(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Assigned people</p>
                  <p className="text-xs text-muted-foreground">{(ownerId ? 1 : 0) + additionalAssigneeIds.length} selected · all can update this task</p>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" disabled={!teamIsSelected || !ownerId} onClick={() => setShowAssigneePicker((open) => !open)}>
                  <Users className="mr-1.5 size-3.5" /> {showAssigneePicker ? "Done selecting" : "+ Add people"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedOwner && <span className="max-w-full truncate rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{selectedOwner.name} · lead</span>}
                {selectedAssignees.map((person) => (
                  <span key={person.id} dir="auto" className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs">{person.name}</span>
                ))}
              </div>
              {showAssigneePicker && (
                <div className="space-y-2 border-t border-border pt-3">
                  <p className="text-xs text-muted-foreground">Choose additional people from {teamOf(selectedScopeId)}.</p>
                  <Input aria-label="Search people to assign" placeholder="Search people…" value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} className="h-9" />
                  <div className="max-h-40 space-y-0.5 overflow-y-auto">
                    {matchingTeammates.map((person) => (
                      <label key={person.id} htmlFor={`assign-person-${person.id}`} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted/60">
                        <Checkbox
                          id={`assign-person-${person.id}`}
                          checked={additionalAssigneeIds.includes(person.id)}
                          onCheckedChange={(checked) => setAdditionalAssigneeIds((ids) => checked === true
                            ? [...new Set([...ids, person.id])]
                            : ids.filter((id) => id !== person.id))}
                        />
                        <span dir="auto" className="min-w-0 truncate text-sm">{person.name}</span>
                      </label>
                    ))}
                    {matchingTeammates.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">No matching team members.</p>}
                  </div>
                </div>
              )}
            </div>
            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer py-1 text-xs font-semibold text-primary">Add details (optional)</summary>
              <div className="mt-2 space-y-3">
                <Textarea placeholder="Helpful context or a link" dir="auto" maxLength={2000} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
              </div>
            </details>
            <Button type="submit" disabled={saving || !newTitle.trim() || !teamIsSelected || !ownerId || !newDue} className="h-11 w-full rounded-xl">
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              {editingId ? "Save changes" : "Create task"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedTask !== null} onOpenChange={(open) => {
        if (!open) { setSelectedTask(null); setNeedHelp(false); }
      }}>
        <DialogContent className="max-h-[88dvh] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogDescription>{teamOf(selected.teamId)}</DialogDescription>
                <DialogTitle dir="auto" className="text-left text-xl leading-snug">{selected.title}</DialogTitle>
              </DialogHeader>
              <div className="mt-1"><StatusTag status={selected.status} /></div>
              <div className="overflow-hidden rounded-xl border border-border text-sm">
                <div className="flex justify-between gap-4 border-b border-border px-3 py-3">
                  <span className="shrink-0 text-muted-foreground">Assigned to</span>
                  <div className="flex min-w-0 flex-wrap justify-end gap-1 text-right">
                    {participantIds(selected).map((id) => (
                      <span key={id} dir="auto" className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
                        {personById.get(id)?.name ?? (id === selected.ownerId ? selected.ownerName : "Member")}
                        {id === selected.ownerId && participantIds(selected).length > 1 ? " · lead" : ""}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex justify-between gap-4 border-b border-border px-3 py-3">
                  <span className="text-muted-foreground">Due</span><span className="font-medium">{dueText(selected.deadline)}</span>
                </div>
                <div className="flex justify-between gap-4 px-3 py-3">
                  <span className="text-muted-foreground">Team</span><span className="font-medium">{teamOf(selected.teamId)}</span>
                </div>
              </div>
              {selected.description && (
                <div className="rounded-xl bg-muted/60 p-3 text-sm">
                  <p className="mb-1 font-semibold">Details</p>
                  <p className="whitespace-pre-wrap" dir="auto">{selected.description}</p>
                </div>
              )}
              {selected.status === "Blocked" && selected.blockedReason && (
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="mb-1 font-semibold">Waiting for</p>
                  <p dir="auto">{selected.blockedReason}</p>
                </div>
              )}
              {selected.canEditDetails && (
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => showEdit(selected)}>
                    <Pencil className="mr-1.5 size-3.5" /> Edit
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={archiving} onClick={() => void archiveSelected(selected)}>
                    <Archive className="mr-1.5 size-3.5" /> Archive
                  </Button>
                </div>
              )}
              {selected.canEditStatus ? (
                <div className="space-y-3">
                  {participantIds(selected).length > 1 && (
                    <p className="text-xs text-muted-foreground">Shared task: changing its status updates it for everyone assigned.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {selected.status !== "In Progress" && (
                      <Button type="button" variant="outline" disabled={!!workingId} onClick={() => void changeStatus(selected, "In Progress")}>Start</Button>
                    )}
                    {selected.status !== "Blocked" && (
                      <Button type="button" variant="outline" disabled={!!workingId} onClick={() => setNeedHelp(true)}>Need help</Button>
                    )}
                    {selected.status !== "Done" ? (
                      <Button type="button" disabled={!!workingId} onClick={() => void changeStatus(selected, "Done")}> <Check className="mr-1.5 size-4" /> Done</Button>
                    ) : (
                      <Button type="button" variant="outline" disabled={!!workingId} onClick={() => void changeStatus(selected, "To Do")}>Reopen</Button>
                    )}
                  </div>
                  {needHelp && (
                    <form className="space-y-2 rounded-xl border border-border p-3" onSubmit={(event) => {
                      event.preventDefault();
                      if (blockReason.trim()) void changeStatus(selected, "Blocked", blockReason.trim());
                    }}>
                      <Label htmlFor="block-reason">What are you waiting for?</Label>
                      <Input id="block-reason" dir="auto" autoFocus required maxLength={500} placeholder="e.g. Parts, approval, measurements…" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={() => setNeedHelp(false)}>Cancel</Button>
                        <Button type="submit" size="sm" disabled={!!workingId || !blockReason.trim()}>Save</Button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Everyone can view team work. Piece And Love, Piece Of Mind💜.</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
