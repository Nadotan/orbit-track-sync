import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TaskRole = "admin" | "team_lead" | "user";
export type TaskStatus = "To Do" | "In Progress" | "Blocked" | "Done";
export type TaskPriority = "Low" | "Medium" | "High" | "Critical";
export type WorkUpdateSource = "manual" | "clock";

export interface TaskPerson {
  id: string;
  name: string;
  teamIds: string[];
  role: TaskRole;
}

export interface TaskAssignee {
  id: string;
  name: string;
}

export interface WorkUpdate {
  id: string;
  body: string;
  source: WorkUpdateSource;
  authorId: string | null;
  authorName: string;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProject {
  id: string;
  name: string;
  description: string;
  deadline: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  ownerName: string;
  blockedReason: string;
  teamId: string | null;
  teamName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  updates: WorkUpdate[];
  canEditDetails: boolean;
  canEditStatus: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  priority: TaskPriority;
  ownerId: string;
  ownerName: string;
  blockedReason: string;
  projectId: string | null;
  projectName: string | null;
  teamId: string | null;
  teamName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssignee[];
  updates: WorkUpdate[];
  canEditDetails: boolean;
  canEditStatus: boolean;
}

export interface TasksWorkspace {
  currentUserId: string;
  role: TaskRole;
  teamIds: string[];
  teams: { id: string; name: string }[];
  people: TaskPerson[];
  projects: TaskProject[];
  tasks: TaskItem[];
}

export interface ClockTaskOption {
  id: string;
  title: string;
  deadline: string;
  projectName: string | null;
}

const taskStatusSchema = z.enum(["To Do", "In Progress", "Blocked", "Done"]);
const taskPrioritySchema = z.enum(["Low", "Medium", "High", "Critical"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const taskIdSchema = z.object({ taskId: z.string().uuid() });
const projectIdSchema = z.object({ projectId: z.string().uuid() });

const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  deadline: dateSchema,
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  ownerId: z.string().uuid(),
  blockedReason: z.string().trim().max(500),
  projectId: z.string().uuid().nullable(),
  teamId: z.string().uuid().nullable(),
  assigneeIds: z.array(z.string().uuid()).min(1).max(100),
});

const createTaskSchema = taskFieldsSchema;
const updateTaskSchema = taskFieldsSchema.extend({ taskId: z.string().uuid() });

const updateStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  blockedReason: z.string().trim().max(500).optional(),
});

const projectFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000),
  deadline: dateSchema.nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  ownerId: z.string().uuid(),
  blockedReason: z.string().trim().max(500),
  teamId: z.string().uuid().nullable(),
});

const createProjectSchema = projectFieldsSchema;
const updateProjectSchema = projectFieldsSchema.extend({
  projectId: z.string().uuid(),
});

const updateProjectStatusSchema = z.object({
  projectId: z.string().uuid(),
  status: taskStatusSchema,
  blockedReason: z.string().trim().max(500).optional(),
});

const addWorkUpdateSchema = z
  .object({
    taskId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    body: z.string().trim().min(1).max(2000),
  })
  .refine(
    (value) => Boolean(value.taskId) !== Boolean(value.projectId),
    "Choose exactly one task or project.",
  );

const teamLeadSchema = z.object({
  userId: z.string().uuid(),
  enabled: z.boolean(),
});

function normalizeRole(role: string | null | undefined): TaskRole {
  if (role === "admin") return "admin";
  if (role === "team_lead") return "team_lead";
  return "user";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

interface Access {
  role: TaskRole;
  teamIds: string[];
}

async function getAccess(admin: any, userId: string): Promise<Access> {
  const [roleResult, membershipsResult, profileResult] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId).maybeSingle(),
    admin.from("team_members").select("team_id").eq("user_id", userId),
    admin.from("profiles").select("team_id").eq("id", userId).maybeSingle(),
  ]);

  if (roleResult.error || membershipsResult.error || profileResult.error) {
    throw new Error("Unable to determine task permissions.");
  }

  const membershipTeamIds = uniqueStrings(
    (membershipsResult.data ?? []).map((membership: any) => membership.team_id),
  );

  return {
    role: normalizeRole(roleResult.data?.role),
    teamIds:
      membershipTeamIds.length > 0
        ? membershipTeamIds
        : profileResult.data?.team_id
          ? [profileResult.data.team_id]
          : [],
  };
}

function canManageScope(access: Access, teamId: string | null) {
  if (access.role === "admin") return true;

  return (
    access.role === "team_lead" &&
    teamId !== null &&
    access.teamIds.includes(teamId)
  );
}

function assertCanManageScope(access: Access, teamId: string | null) {
  if (canManageScope(access, teamId)) return;

  if (access.role === "team_lead" && teamId === null) {
    throw new Error("Only admins can manage General tasks and projects.");
  }

  throw new Error("Forbidden");
}

async function peopleInScope(
  admin: any,
  teamId: string | null,
  peopleIds: string[],
) {
  const ids = uniqueStrings(peopleIds);

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, team_id")
    .in("id", ids);

  if (profilesError) throw new Error(profilesError.message);

  if ((profiles ?? []).length !== ids.length) {
    throw new Error("One or more selected people do not exist.");
  }

  if (teamId === null) return;

  const { data: memberships, error: membershipsError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .in("user_id", ids);

  if (membershipsError) throw new Error(membershipsError.message);

  const members = new Set<string>(
    (memberships ?? []).map((membership: any) => membership.user_id),
  );

  for (const profile of profiles ?? []) {
    if (profile.team_id === teamId) members.add(profile.id);
  }

  for (const userId of ids) {
    if (!members.has(userId)) {
      throw new Error("Owners and assignees must belong to the selected team.");
    }
  }
}

async function validateTaskPeople(
  admin: any,
  access: Access,
  teamId: string | null,
  assigneeIds: string[],
  ownerId: string,
) {
  const assignees = uniqueStrings(assigneeIds);

  if (assignees.length === 0) {
    throw new Error("Assign at least one person.");
  }

  assertCanManageScope(access, teamId);
  await peopleInScope(admin, teamId, [...assignees, ownerId]);

  return assignees;
}

async function validateProjectOwner(
  admin: any,
  access: Access,
  teamId: string | null,
  ownerId: string,
) {
  assertCanManageScope(access, teamId);
  await peopleInScope(admin, teamId, [ownerId]);
}

async function validateProjectSelection(
  admin: any,
  projectId: string | null,
  teamId: string | null,
) {
  if (projectId === null) return;

  const { data: project, error } = await admin
    .from("projects")
    .select("id, team_id, archived_at, deleted_at")
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) throw new Error("Project not found.");

  if (project.archived_at || project.deleted_at) {
    throw new Error("Archived projects cannot receive new tasks.");
  }

  if (project.team_id !== teamId) {
    throw new Error("The task and project must use the same scope.");
  }
}

function normalizeBlockedReason(
  status: TaskStatus,
  blockedReason: string | undefined,
) {
  if (status !== "Blocked") return "";

  const reason = blockedReason?.trim() ?? "";

  if (!reason) {
    throw new Error("Add a reason before marking this item as Blocked.");
  }

  return reason;
}

async function safeTaskPush(
  userIds: string[],
  actorUserId: string,
  payload: { title: string; body: string; url: string; tag: string },
) {
  const targets = uniqueStrings(userIds).filter((id) => id !== actorUserId);
  if (targets.length === 0) return;

  try {
    const { sendPushToUsers } = await import("./push.server");
    await sendPushToUsers(targets, payload);
  } catch (error) {
    console.error("[tasks] Failed to send task push", error);
  }
}

async function sendAssignmentPush(
  userIds: string[],
  task: { id: string; title: string; deadline: string },
  actorUserId: string,
) {
  await safeTaskPush(userIds, actorUserId, {
    title: "New task assigned",
    body: `${task.title} — due ${task.deadline}.`,
    url: "/tasks",
    tag: `task-assigned-${task.id}`,
  });
}

async function sendDeadlinePush(
  userIds: string[],
  task: { id: string; title: string; deadline: string },
  actorUserId: string,
) {
  await safeTaskPush(userIds, actorUserId, {
    title: "Task deadline changed",
    body: `${task.title} — new deadline ${task.deadline}.`,
    url: "/tasks",
    tag: `task-deadline-${task.id}`,
  });
}

async function sendBlockedOwnerPush(
  ownerId: string,
  task: { id: string; title: string; reason: string },
  actorUserId: string,
) {
  await safeTaskPush([ownerId], actorUserId, {
    title: "Task blocked",
    body: `${task.title} — ${task.reason}`,
    url: "/tasks",
    tag: `task-blocked-${task.id}`,
  });
}

async function syncSheetsAfterMutation() {
  try {
    const { safeSyncGoogleSheetsSnapshot } = await import("./google-sheets.server");
    await safeSyncGoogleSheetsSnapshot();
  } catch (error) {
    console.error("[tasks] Google Sheets sync failed", error);
  }
}

export const getTasksWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const [
      profilesResult,
      rolesResult,
      membershipsResult,
      teamsResult,
      projectsResult,
      tasksResult,
      assignmentsResult,
      updatesResult,
    ] = await Promise.all([
      admin.from("profiles").select("id, name, team_id").order("name"),
      admin.from("user_roles").select("user_id, role"),
      admin.from("team_members").select("user_id, team_id"),
      admin.from("teams").select("id, name").order("name"),
      admin
        .from("projects")
        .select(
          "id, name, description, deadline, status, priority, owner_id, blocked_reason, team_id, created_by, archived_at, deleted_at, created_at, updated_at",
        )
        .order("name"),
      admin
        .from("tasks")
        .select(
          "id, title, description, deadline, status, priority, owner_id, blocked_reason, project_id, team_id, created_by, archived_at, deleted_at, created_at, updated_at",
        )
        .is("archived_at", null)
        .is("deleted_at", null)
        .order("deadline", { ascending: true }),
      admin.from("task_assignees").select("task_id, user_id"),
      admin
        .from("work_updates")
        .select(
          "id, task_id, project_id, author_id, body, source, duration_ms, created_at, updated_at",
        )
        .order("created_at", { ascending: false }),
    ]);

    const errors = [
      profilesResult.error,
      rolesResult.error,
      membershipsResult.error,
      teamsResult.error,
      projectsResult.error,
      tasksResult.error,
      assignmentsResult.error,
      updatesResult.error,
    ].filter(Boolean);

    if (errors.length > 0) throw new Error("Unable to load tasks.");

    const profiles = profilesResult.data ?? [];
    const roles = rolesResult.data ?? [];
    const memberships = membershipsResult.data ?? [];
    const teams = teamsResult.data ?? [];
    const projects = projectsResult.data ?? [];
    const tasks = tasksResult.data ?? [];
    const assignments = assignmentsResult.data ?? [];
    const updates = updatesResult.data ?? [];

    const roleMap = new Map<string, TaskRole>();
    for (const role of roles) {
      roleMap.set(role.user_id, normalizeRole(role.role));
    }

    const membershipMap = new Map<string, string[]>();
    for (const membership of memberships) {
      const current = membershipMap.get(membership.user_id) ?? [];
      current.push(membership.team_id);
      membershipMap.set(membership.user_id, current);
    }

    const profileMap = new Map<string, any>(
      profiles.map((profile: any) => [profile.id, profile]),
    );

    const people: TaskPerson[] = profiles.map((profile: any) => {
      const memberTeams = membershipMap.get(profile.id) ?? [];
      return {
        id: profile.id,
        name: profile.name,
        teamIds:
          memberTeams.length > 0
            ? uniqueStrings(memberTeams)
            : profile.team_id
              ? [profile.team_id]
              : [],
        role: roleMap.get(profile.id) ?? "user",
      };
    });

    const currentPerson = people.find((person) => person.id === context.userId);
    const access: Access = {
      role: roleMap.get(context.userId) ?? "user",
      teamIds: currentPerson?.teamIds ?? [],
    };

    const teamMap = new Map<string, string>(
      teams.map((team: any) => [team.id, team.name]),
    );

    const projectMap = new Map<string, any>(
      projects.map((project: any) => [project.id, project]),
    );

    const assigneeMap = new Map<string, string[]>();
    for (const assignment of assignments) {
      const current = assigneeMap.get(assignment.task_id) ?? [];
      current.push(assignment.user_id);
      assigneeMap.set(assignment.task_id, current);
    }

    const updateForRow = (row: any): WorkUpdate => ({
      id: row.id,
      body: row.body,
      source: row.source as WorkUpdateSource,
      authorId: row.author_id,
      authorName: row.author_id
        ? profileMap.get(row.author_id)?.name ?? "Unknown member"
        : "Former member",
      durationMs:
        row.duration_ms === null || row.duration_ms === undefined
          ? null
          : Number(row.duration_ms),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });

    const taskUpdates = new Map<string, WorkUpdate[]>();
    const projectUpdates = new Map<string, WorkUpdate[]>();

    for (const row of updates) {
      if (row.task_id) {
        const current = taskUpdates.get(row.task_id) ?? [];
        current.push(updateForRow(row));
        taskUpdates.set(row.task_id, current);
      } else if (row.project_id) {
        const current = projectUpdates.get(row.project_id) ?? [];
        current.push(updateForRow(row));
        projectUpdates.set(row.project_id, current);
      }
    }

    const visibleProjects: TaskProject[] = projects
      .filter((project: any) => {
        if (project.archived_at || project.deleted_at) return false;
        if (access.role === "admin") return true;
        if (project.team_id === null) return true;
        return access.teamIds.includes(project.team_id);
      })
      .map((project: any) => {
        const editDetails = canManageScope(access, project.team_id);

        return {
          id: project.id,
          name: project.name,
          description: project.description ?? "",
          deadline: project.deadline,
          status: project.status as TaskStatus,
          priority: project.priority as TaskPriority,
          ownerId: project.owner_id,
          ownerName:
            profileMap.get(project.owner_id)?.name ?? "Unknown member",
          blockedReason: project.blocked_reason ?? "",
          teamId: project.team_id,
          teamName: project.team_id
            ? teamMap.get(project.team_id) ?? "Unknown team"
            : "General",
          createdBy: project.created_by,
          createdByName:
            profileMap.get(project.created_by)?.name ?? "Unknown member",
          createdAt: project.created_at,
          updatedAt: project.updated_at,
          updates: projectUpdates.get(project.id) ?? [],
          canEditDetails: editDetails,
          canEditStatus: editDetails || project.owner_id === context.userId,
        };
      });

    const visibleTasks = tasks.filter((task: any) => {
      const taskAssignees = assigneeMap.get(task.id) ?? [];
      if (access.role === "admin") return true;
      if (taskAssignees.includes(context.userId)) return true;
      if (task.owner_id === context.userId) return true;
      if (task.team_id === null) return true;
      return access.teamIds.includes(task.team_id);
    });

    const resultTasks: TaskItem[] = visibleTasks.map((task: any) => {
      const assigneeIds = uniqueStrings(assigneeMap.get(task.id) ?? []);
      const assignees = assigneeIds
        .map((userId) => {
          const profile = profileMap.get(userId);
          return profile ? { id: userId, name: profile.name } : null;
        })
        .filter((assignee): assignee is TaskAssignee => Boolean(assignee))
        .sort((a, b) => a.name.localeCompare(b.name));

      const project = task.project_id ? projectMap.get(task.project_id) : null;
      const editDetails = canManageScope(access, task.team_id);

      return {
        id: task.id,
        title: task.title,
        description: task.description,
        deadline: task.deadline,
        status: task.status as TaskStatus,
        priority: task.priority as TaskPriority,
        ownerId: task.owner_id,
        ownerName: profileMap.get(task.owner_id)?.name ?? "Unknown member",
        blockedReason: task.blocked_reason ?? "",
        projectId: task.project_id,
        projectName: project?.name ?? null,
        teamId: task.team_id,
        teamName: task.team_id
          ? teamMap.get(task.team_id) ?? "Unknown team"
          : "General",
        createdBy: task.created_by,
        createdByName:
          profileMap.get(task.created_by)?.name ?? "Unknown member",
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        assignees,
        updates: taskUpdates.get(task.id) ?? [],
        canEditDetails: editDetails,
        canEditStatus:
          editDetails ||
          assigneeIds.includes(context.userId) ||
          task.owner_id === context.userId,
      };
    });

    return {
      currentUserId: context.userId,
      role: access.role,
      teamIds: access.teamIds,
      teams: teams.map((team: any) => ({ id: team.id, name: team.name })),
      people,
      projects: visibleProjects,
      tasks: resultTasks,
    } satisfies TasksWorkspace;
  });

export const getMyOpenTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: assignments, error: assignmentsError } = await admin
      .from("task_assignees")
      .select("task_id")
      .eq("user_id", context.userId);

    if (assignmentsError) throw new Error("Unable to load your tasks.");

    const taskIds = uniqueStrings(
      (assignments ?? []).map((assignment: any) => assignment.task_id),
    );

    const { data: ownedTasks, error: ownedError } = await admin
      .from("tasks")
      .select("id")
      .eq("owner_id", context.userId)
      .neq("status", "Done")
      .is("archived_at", null)
      .is("deleted_at", null);

    if (ownedError) throw new Error("Unable to load your tasks.");

    const relevantIds = uniqueStrings([
      ...taskIds,
      ...(ownedTasks ?? []).map((task: any) => task.id),
    ]);

    if (relevantIds.length === 0) return [] as ClockTaskOption[];

    const { data: tasks, error: tasksError } = await admin
      .from("tasks")
      .select("id, title, deadline, project_id")
      .in("id", relevantIds)
      .neq("status", "Done")
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("deadline", { ascending: true });

    if (tasksError) throw new Error("Unable to load your tasks.");

    const projectIds = uniqueStrings(
      (tasks ?? [])
        .map((task: any) => task.project_id)
        .filter((projectId: string | null): projectId is string => Boolean(projectId)),
    );

    const projectMap = new Map<string, string>();

    if (projectIds.length > 0) {
      const { data: projects, error: projectsError } = await admin
        .from("projects")
        .select("id, name")
        .in("id", projectIds);

      if (projectsError) throw new Error("Unable to load your tasks.");

      for (const project of projects ?? []) {
        projectMap.set(project.id, project.name);
      }
    }

    return (tasks ?? []).map((task: any) => ({
      id: task.id,
      title: task.title,
      deadline: task.deadline,
      projectName: task.project_id
        ? projectMap.get(task.project_id) ?? null
        : null,
    })) satisfies ClockTaskOption[];
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createProjectSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    await validateProjectOwner(admin, access, data.teamId, data.ownerId);
    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);

    const { data: project, error } = await admin
      .from("projects")
      .insert({
        name: data.name.trim(),
        description: data.description.trim(),
        deadline: data.deadline,
        status: data.status,
        priority: data.priority,
        owner_id: data.ownerId,
        blocked_reason: blockedReason,
        team_id: data.teamId,
        created_by: context.userId,
      })
      .select("id")
      .single();

    if (error || !project) {
      throw new Error(error?.message ?? "Unable to create project.");
    }

    await syncSheetsAfterMutation();
    return { id: project.id };
  });

export const updateProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateProjectSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: existing, error: existingError } = await admin
      .from("projects")
      .select("id, team_id, archived_at, deleted_at")
      .eq("id", data.projectId)
      .maybeSingle();

    if (existingError || !existing || existing.archived_at || existing.deleted_at) {
      throw new Error("Project not found.");
    }

    assertCanManageScope(access, existing.team_id);
    await validateProjectOwner(admin, access, data.teamId, data.ownerId);

    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("projects")
      .update({
        name: data.name.trim(),
        description: data.description.trim(),
        deadline: data.deadline,
        status: data.status,
        priority: data.priority,
        owner_id: data.ownerId,
        blocked_reason: blockedReason,
        team_id: data.teamId,
        updated_at: now,
      })
      .eq("id", data.projectId);

    if (error) throw new Error(error.message);

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const updateProjectStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateProjectStatusSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, team_id, owner_id, archived_at, deleted_at")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError || !project || project.archived_at || project.deleted_at) {
      throw new Error("Project not found.");
    }

    const allowed =
      canManageScope(access, project.team_id) || project.owner_id === context.userId;

    if (!allowed) throw new Error("You cannot update this project.");

    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);

    const { error } = await admin
      .from("projects")
      .update({
        status: data.status,
        blocked_reason: blockedReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.projectId);

    if (error) throw new Error(error.message);

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const archiveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(projectIdSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, team_id, archived_at, deleted_at")
      .eq("id", data.projectId)
      .maybeSingle();

    if (projectError || !project || project.archived_at || project.deleted_at) {
      throw new Error("Project not found.");
    }

    assertCanManageScope(access, project.team_id);

    const { count, error: countError } = await admin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", data.projectId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .neq("status", "Done");

    if (countError) throw new Error(countError.message);

    if ((count ?? 0) > 0) {
      throw new Error("Complete or archive the open tasks in this project first.");
    }

    const now = new Date().toISOString();
    const { error } = await admin
      .from("projects")
      .update({ archived_at: now, updated_at: now })
      .eq("id", data.projectId);

    if (error) throw new Error(error.message);

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(createTaskSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const assigneeIds = await validateTaskPeople(
      admin,
      access,
      data.teamId,
      data.assigneeIds,
      data.ownerId,
    );

    await validateProjectSelection(admin, data.projectId, data.teamId);
    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        title: data.title.trim(),
        description: data.description.trim(),
        deadline: data.deadline,
        status: data.status,
        priority: data.priority,
        owner_id: data.ownerId,
        blocked_reason: blockedReason,
        project_id: data.projectId,
        team_id: data.teamId,
        created_by: context.userId,
      })
      .select("id, title, deadline")
      .single();

    if (taskError || !task) {
      throw new Error(taskError?.message ?? "Unable to create task.");
    }

    const { error: assignmentError } = await admin
      .from("task_assignees")
      .insert(
        assigneeIds.map((userId) => ({ task_id: task.id, user_id: userId })),
      );

    if (assignmentError) {
      await admin.from("tasks").delete().eq("id", task.id);
      throw new Error(assignmentError.message);
    }

    await sendAssignmentPush(assigneeIds, task, context.userId);

    if (data.status === "Blocked") {
      await sendBlockedOwnerPush(
        data.ownerId,
        { id: task.id, title: data.title.trim(), reason: blockedReason },
        context.userId,
      );
    }

    await syncSheetsAfterMutation();
    return { id: task.id };
  });

export const updateTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateStatusSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id, title, team_id, status, owner_id, archived_at, deleted_at")
      .eq("id", data.taskId)
      .maybeSingle();

    if (taskError || !task || task.archived_at || task.deleted_at) {
      throw new Error("Task not found.");
    }

    let allowed =
      canManageScope(access, task.team_id) || task.owner_id === context.userId;

    if (!allowed) {
      const { data: assignment, error: assignmentError } = await admin
        .from("task_assignees")
        .select("task_id")
        .eq("task_id", data.taskId)
        .eq("user_id", context.userId)
        .maybeSingle();

      if (assignmentError) throw new Error(assignmentError.message);
      allowed = Boolean(assignment);
    }

    if (!allowed) throw new Error("You are not assigned to this task.");

    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("tasks")
      .update({
        status: data.status,
        blocked_reason: blockedReason,
        updated_at: now,
      })
      .eq("id", data.taskId);

    if (error) throw new Error(error.message);

    if (task.status !== "Blocked" && data.status === "Blocked") {
      await sendBlockedOwnerPush(
        task.owner_id,
        { id: task.id, title: task.title, reason: blockedReason },
        context.userId,
      );
    }

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateTaskSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: existing, error: existingError } = await admin
      .from("tasks")
      .select(
        "id, title, team_id, deadline, status, owner_id, archived_at, deleted_at",
      )
      .eq("id", data.taskId)
      .maybeSingle();

    if (existingError || !existing || existing.archived_at || existing.deleted_at) {
      throw new Error("Task not found.");
    }

    if (!canManageScope(access, existing.team_id)) throw new Error("Forbidden");

    const assigneeIds = await validateTaskPeople(
      admin,
      access,
      data.teamId,
      data.assigneeIds,
      data.ownerId,
    );

    await validateProjectSelection(admin, data.projectId, data.teamId);
    const blockedReason = normalizeBlockedReason(data.status, data.blockedReason);

    const { data: existingAssignments, error: assignmentsError } = await admin
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", data.taskId);

    if (assignmentsError) throw new Error(assignmentsError.message);

    const previousIds = uniqueStrings(
      (existingAssignments ?? []).map((assignment: any) => assignment.user_id),
    );
    const previousSet = new Set(previousIds);
    const nextSet = new Set(assigneeIds);
    const added = assigneeIds.filter((id) => !previousSet.has(id));
    const removed = previousIds.filter((id) => !nextSet.has(id));
    const now = new Date().toISOString();

    const { error: updateError } = await admin
      .from("tasks")
      .update({
        title: data.title.trim(),
        description: data.description.trim(),
        deadline: data.deadline,
        status: data.status,
        priority: data.priority,
        owner_id: data.ownerId,
        blocked_reason: blockedReason,
        project_id: data.projectId,
        team_id: data.teamId,
        updated_at: now,
      })
      .eq("id", data.taskId);

    if (updateError) throw new Error(updateError.message);

    if (added.length > 0) {
      const { error } = await admin
        .from("task_assignees")
        .insert(added.map((id) => ({ task_id: data.taskId, user_id: id })));
      if (error) throw new Error(error.message);
    }

    if (removed.length > 0) {
      const { error } = await admin
        .from("task_assignees")
        .delete()
        .eq("task_id", data.taskId)
        .in("user_id", removed);
      if (error) throw new Error(error.message);
    }

    if (added.length > 0) {
      await sendAssignmentPush(
        added,
        { id: data.taskId, title: data.title.trim(), deadline: data.deadline },
        context.userId,
      );
    }

    if (existing.deadline !== data.deadline) {
      const addedSet = new Set(added);
      await sendDeadlinePush(
        assigneeIds.filter((id) => !addedSet.has(id)),
        { id: data.taskId, title: data.title.trim(), deadline: data.deadline },
        context.userId,
      );
    }

    if (existing.status !== "Blocked" && data.status === "Blocked") {
      await sendBlockedOwnerPush(
        data.ownerId,
        { id: data.taskId, title: data.title.trim(), reason: blockedReason },
        context.userId,
      );
    }

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const archiveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(taskIdSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("team_id, archived_at, deleted_at")
      .eq("id", data.taskId)
      .maybeSingle();

    if (taskError || !task || task.deleted_at) throw new Error("Task not found.");
    if (task.archived_at) return { ok: true };

    assertCanManageScope(access, task.team_id);

    const now = new Date().toISOString();
    const { error } = await admin
      .from("tasks")
      .update({ archived_at: now, updated_at: now })
      .eq("id", data.taskId);

    if (error) throw new Error(error.message);

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const duplicateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(taskIdSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const [sourceResult, assignmentsResult] = await Promise.all([
      admin
        .from("tasks")
        .select(
          "id, title, description, deadline, priority, owner_id, project_id, team_id, archived_at, deleted_at",
        )
        .eq("id", data.taskId)
        .maybeSingle(),
      admin
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", data.taskId),
    ]);

    const source = sourceResult.data;
    if (sourceResult.error || !source || source.archived_at || source.deleted_at) {
      throw new Error("Task not found.");
    }
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

    assertCanManageScope(access, source.team_id);

    const assigneeIds = uniqueStrings(
      (assignmentsResult.data ?? []).map((assignment: any) => assignment.user_id),
    );

    await validateTaskPeople(
      admin,
      access,
      source.team_id,
      assigneeIds,
      source.owner_id,
    );
    await validateProjectSelection(admin, source.project_id, source.team_id);

    const suffix = " (copy)";
    const copyTitle = `${source.title.slice(0, 120 - suffix.length)}${suffix}`;

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        title: copyTitle,
        description: source.description,
        deadline: source.deadline,
        status: "To Do",
        priority: source.priority,
        owner_id: source.owner_id,
        blocked_reason: "",
        project_id: source.project_id,
        team_id: source.team_id,
        created_by: context.userId,
      })
      .select("id, title, deadline")
      .single();

    if (taskError || !task) {
      throw new Error(taskError?.message ?? "Unable to duplicate task.");
    }

    const { error: assignmentError } = await admin
      .from("task_assignees")
      .insert(
        assigneeIds.map((id) => ({ task_id: task.id, user_id: id })),
      );

    if (assignmentError) {
      await admin.from("tasks").delete().eq("id", task.id);
      throw new Error(assignmentError.message);
    }

    await sendAssignmentPush(assigneeIds, task, context.userId);
    await syncSheetsAfterMutation();

    return { id: task.id };
  });

/**
 * "Delete" is intentionally a soft delete.
 * The row stays in Supabase so the Google Sheets snapshot
 * can keep the historical record instead of removing it.
 */
export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(taskIdSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    if (access.role !== "admin") {
      throw new Error("Only admins can delete tasks.");
    }

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id, deleted_at")
      .eq("id", data.taskId)
      .maybeSingle();

    if (taskError || !task) throw new Error("Task not found.");
    if (task.deleted_at) return { ok: true };

    const now = new Date().toISOString();
    const { error } = await admin
      .from("tasks")
      .update({ deleted_at: now, updated_at: now })
      .eq("id", data.taskId);

    if (error) throw new Error(error.message);

    await syncSheetsAfterMutation();
    return { ok: true };
  });

export const addWorkUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(addWorkUpdateSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const access = await getAccess(admin, context.userId);

    const taskId = data.taskId ?? null;
    const projectId = data.projectId ?? null;

    if (taskId) {
      const { data: task, error } = await admin
        .from("tasks")
        .select("id, team_id, owner_id, archived_at, deleted_at")
        .eq("id", taskId)
        .maybeSingle();

      if (error || !task || task.archived_at || task.deleted_at) {
        throw new Error("Task not found.");
      }

      let allowed =
        canManageScope(access, task.team_id) || task.owner_id === context.userId;

      if (!allowed) {
        const { data: assignment, error: assignmentError } = await admin
          .from("task_assignees")
          .select("task_id")
          .eq("task_id", taskId)
          .eq("user_id", context.userId)
          .maybeSingle();

        if (assignmentError) throw new Error(assignmentError.message);
        allowed = Boolean(assignment);
      }

      if (!allowed) throw new Error("You cannot add an update to this task.");
    } else if (projectId) {
      const { data: project, error } = await admin
        .from("projects")
        .select("id, team_id, owner_id, archived_at, deleted_at")
        .eq("id", projectId)
        .maybeSingle();

      if (error || !project || project.archived_at || project.deleted_at) {
        throw new Error("Project not found.");
      }

      const allowed =
        canManageScope(access, project.team_id) ||
        project.owner_id === context.userId;

      if (!allowed) throw new Error("You cannot add an update to this project.");
    }

    const { data: update, error } = await admin
      .from("work_updates")
      .insert({
        task_id: taskId,
        project_id: projectId,
        author_id: context.userId,
        body: data.body.trim(),
        source: "manual",
      })
      .select("id")
      .single();

    if (error || !update) {
      throw new Error(error?.message ?? "Unable to add update.");
    }

    return { id: update.id };
  });

export const setTeamLeadRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(teamLeadSchema)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const caller = await getAccess(admin, context.userId);

    if (caller.role !== "admin") throw new Error("Forbidden");

    const { data: currentRole, error: roleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (roleError) throw new Error(roleError.message);

    if (currentRole?.role === "admin") {
      throw new Error("Admin roles must be changed from the Admin Dashboard.");
    }

    if (data.enabled) {
      const targetAccess = await getAccess(admin, data.userId);
      if (targetAccess.teamIds.length === 0) {
        throw new Error("Assign this person to a team before making them a Team Lead.");
      }
    }

    const { error: deleteError } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);

    if (deleteError) throw new Error(deleteError.message);

    const { error: insertError } = await admin.from("user_roles").insert({
      user_id: data.userId,
      role: data.enabled ? "team_lead" : "user",
    });

    if (insertError) throw new Error(insertError.message);

    return { ok: true };
  });