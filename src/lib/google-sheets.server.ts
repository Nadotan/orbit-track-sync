import {
  supabaseAdmin,
} from "@/integrations/supabase/client.server";

interface GoogleSheetsProject {
  id: string;
  type: "PROJECT";
  name: string;
  description: string;
  team: string;
  owner: string;
  priority: string;
  status: string;
  deadline: string;
  progressPercent: number;
  completedSubtasks: number;
  subtaskCount: number;
  updateCount: number;
  latestUpdate: string;
  latestUpdateAt: string;
  blockedReason: string;
  archived: boolean;
  deleted: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface GoogleSheetsTask {
  id: string;
  type: "SUBTASK" | "TASK";
  project: string;
  title: string;
  description: string;
  team: string;
  owner: string;
  assignees: string;
  priority: string;
  status: string;
  deadline: string;
  loggedHours: number;
  updateCount: number;
  latestUpdate: string;
  latestUpdateAt: string;
  blockedReason: string;
  archived: boolean;
  deleted: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface GoogleSheetsUpdate {
  id: string;
  type: "PROJECT" | "SUBTASK" | "TASK";
  project: string;
  workItem: string;
  source: "Manual" | "Clock";
  author: string;
  body: string;
  loggedHours: number;
  createdAt: string;
  updatedAt: string;
}

interface GoogleSheetsResponse {
  ok?: boolean;
  error?: string;
  projects?: number;
  tasks?: number;
  updates?: number;
  syncedAt?: string;
}

export interface GoogleSheetsSyncResult {
  ok: true;
  projects: number;
  tasks: number;
  updates: number;
}

const GOOGLE_SHEETS_TIMEOUT_MS =
  10 * 1000;

function uniqueStrings(
  values: string[],
) {
  return Array.from(
    new Set(
      values,
    ),
  );
}

function sheetsConfig() {
  const url =
    process.env[
      "GOOGLE_SHEETS_WEBHOOK_URL"
    ];

  const secret =
    process.env[
      "GOOGLE_SHEETS_SYNC_SECRET"
    ];

  return {
    url,
    secret,
  };
}

export function googleSheetsConfigured() {
  const {
    url,
    secret,
  } =
    sheetsConfig();

  return Boolean(
    url &&
      secret,
  );
}

function latestByCreatedAt(
  updates: any[],
) {
  if (
    updates.length ===
    0
  ) {
    return null;
  }

  return updates.reduce(
    (
      latest,
      update,
    ) =>
      new Date(
        update.created_at,
      ).getTime() >
      new Date(
        latest.created_at,
      ).getTime()
        ? update
        : latest,
  );
}

function loggedHoursForUpdates(
  updates: any[],
) {
  const durationMs =
    updates.reduce(
      (
        total,
        update,
      ) =>
        total +
        (
          Number(
            update.duration_ms,
          ) ||
          0
        ),
      0,
    );

  return Number(
    (
      durationMs /
      3_600_000
    ).toFixed(
      2,
    ),
  );
}

export async function syncGoogleSheetsSnapshot():
  Promise<GoogleSheetsSyncResult> {
  const {
    url,
    secret,
  } =
    sheetsConfig();

  if (
    !url ||
    !secret
  ) {
    throw new Error(
      "Google Sheets sync is not configured.",
    );
  }

  /*
   * Generated Supabase types are currently behind
   * the real database schema, so keep the cast local.
   */
  const admin =
    supabaseAdmin as any;

  const [
    {
      data:
        profiles,
      error:
        profilesError,
    },

    {
      data:
        teams,
      error:
        teamsError,
    },

    {
      data:
        projects,
      error:
        projectsError,
    },

    {
      data:
        tasks,
      error:
        tasksError,
    },

    {
      data:
        assignments,
      error:
        assignmentsError,
    },

    {
      data:
        updates,
      error:
        updatesError,
    },
  ] =
    await Promise.all([
      admin
        .from(
          "profiles",
        )
        .select(
          "id, name",
        ),

      admin
        .from(
          "teams",
        )
        .select(
          "id, name",
        ),

      /*
       * Never filter archived/deleted work items here.
       * Google Sheets doubles as the historical record.
       */
      admin
        .from(
          "projects",
        )
        .select(
          "id, name, description, team_id, owner_id, priority, status, deadline, blocked_reason, created_by, archived_at, deleted_at, created_at, updated_at",
        )
        .order(
          "name",
        ),

      admin
        .from(
          "tasks",
        )
        .select(
          "id, title, description, team_id, owner_id, project_id, priority, status, deadline, blocked_reason, created_by, archived_at, deleted_at, created_at, updated_at",
        )
        .order(
          "deadline",
          {
            ascending:
              true,
          },
        ),

      admin
        .from(
          "task_assignees",
        )
        .select(
          "task_id, user_id",
        ),

      admin
        .from(
          "work_updates",
        )
        .select(
          "id, task_id, project_id, author_id, body, source, duration_ms, created_at, updated_at",
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        ),
    ]);

  if (
    profilesError ||
    teamsError ||
    projectsError ||
    tasksError ||
    assignmentsError ||
    updatesError
  ) {
    throw new Error(
      "Unable to prepare Google Sheets data.",
    );
  }

  const profileMap =
    new Map<
      string,
      string
    >(
      (
        profiles ??
        []
      ).map(
        (
          profile:
            any,
        ) => [
          profile.id,
          profile.name,
        ],
      ),
    );

  const teamMap =
    new Map<
      string,
      string
    >(
      (
        teams ??
        []
      ).map(
        (
          team:
            any,
        ) => [
          team.id,
          team.name,
        ],
      ),
    );

  const projectMap =
    new Map<
      string,
      any
    >(
      (
        projects ??
        []
      ).map(
        (
          project:
            any,
        ) => [
          project.id,
          project,
        ],
      ),
    );

  const taskMap =
    new Map<
      string,
      any
    >(
      (
        tasks ??
        []
      ).map(
        (
          task:
            any,
        ) => [
          task.id,
          task,
        ],
      ),
    );

  const assigneeMap =
    new Map<
      string,
      string[]
    >();

  for (
    const assignment of
    assignments ??
    []
  ) {
    const current =
      assigneeMap.get(
        assignment.task_id,
      ) ??
      [];

    current.push(
      assignment.user_id,
    );

    assigneeMap.set(
      assignment.task_id,
      current,
    );
  }

  const taskUpdatesMap =
    new Map<
      string,
      any[]
    >();

  const projectUpdatesMap =
    new Map<
      string,
      any[]
    >();

  for (
    const update of
    updates ??
    []
  ) {
    if (
      update.task_id
    ) {
      const current =
        taskUpdatesMap.get(
          update.task_id,
        ) ??
        [];

      current.push(
        update,
      );

      taskUpdatesMap.set(
        update.task_id,
        current,
      );
    }

    if (
      update.project_id
    ) {
      const current =
        projectUpdatesMap.get(
          update.project_id,
        ) ??
        [];

      current.push(
        update,
      );

      projectUpdatesMap.set(
        update.project_id,
        current,
      );
    }
  }

  const sheetProjects:
    GoogleSheetsProject[] =
    (
      projects ??
      []
    ).map(
      (
        project:
          any,
      ) => {
        const projectTasks =
          (
            tasks ??
            []
          ).filter(
            (
              task:
                any,
            ) =>
              task.project_id ===
                project.id &&
              !task.archived_at &&
              !task.deleted_at,
          );

        const completedSubtasks =
          projectTasks.filter(
            (
              task:
                any,
            ) =>
              task.status ===
              "Done",
          ).length;

        const progressPercent =
          projectTasks.length ===
          0
            ? 0
            : Math.round(
                (
                  completedSubtasks /
                  projectTasks.length
                ) *
                  100,
              );

        const projectUpdates =
          projectUpdatesMap.get(
            project.id,
          ) ??
          [];

        const latest =
          latestByCreatedAt(
            projectUpdates,
          );

        return {
          id:
            project.id,

          type:
            "PROJECT",

          name:
            project.name,

          description:
            project.description ??
            "",

          team:
            project.team_id
              ? teamMap.get(
                  project.team_id,
                ) ??
                "Unknown team"
              : "General",

          owner:
            profileMap.get(
              project.owner_id,
            ) ??
            "Unknown member",

          priority:
            project.priority,

          status:
            project.deleted_at
              ? "Deleted"
              : project.status,

          deadline:
            project.deadline ??
            "",

          progressPercent,

          completedSubtasks,

          subtaskCount:
            projectTasks.length,

          updateCount:
            projectUpdates.length,

          latestUpdate:
            latest?.body ??
            "",

          latestUpdateAt:
            latest?.created_at ??
            "",

          blockedReason:
            project.blocked_reason ??
            "",

          archived:
            Boolean(
              project.archived_at,
            ),

          deleted:
            Boolean(
              project.deleted_at,
            ),

          createdBy:
            profileMap.get(
              project.created_by,
            ) ??
            "Unknown member",

          createdAt:
            project.created_at,

          updatedAt:
            project.updated_at,
        };
      },
    );

  const sheetTasks:
    GoogleSheetsTask[] =
    (
      tasks ??
      []
    ).map(
      (
        task:
          any,
      ) => {
        const assigneeIds =
          uniqueStrings(
            assigneeMap.get(
              task.id,
            ) ??
              [],
          );

        const assigneeNames =
          assigneeIds
            .map(
              (
                userId,
              ) =>
                profileMap.get(
                  userId,
                ) ??
                "Unknown member",
            )
            .sort(
              (
                a,
                b,
              ) =>
                a.localeCompare(
                  b,
                ),
            );

        const taskUpdates =
          taskUpdatesMap.get(
            task.id,
          ) ??
          [];

        const latest =
          latestByCreatedAt(
            taskUpdates,
          );

        const project =
          task.project_id
            ? projectMap.get(
                task.project_id,
              )
            : null;

        return {
          id:
            task.id,

          type:
            task.project_id
              ? "SUBTASK"
              : "TASK",

          project:
            project?.name ??
            "",

          title:
            task.title,

          description:
            task.description ??
            "",

          team:
            task.team_id
              ? teamMap.get(
                  task.team_id,
                ) ??
                "Unknown team"
              : "General",

          owner:
            profileMap.get(
              task.owner_id,
            ) ??
            "Unknown member",

          assignees:
            assigneeNames.join(
              ", ",
            ),

          priority:
            task.priority,

          status:
            task.deleted_at
              ? "Deleted"
              : task.status,

          deadline:
            task.deadline,

          loggedHours:
            loggedHoursForUpdates(
              taskUpdates.filter(
                (
                  update,
                ) =>
                  update.source ===
                  "clock",
              ),
            ),

          updateCount:
            taskUpdates.length,

          latestUpdate:
            latest?.body ??
            "",

          latestUpdateAt:
            latest?.created_at ??
            "",

          blockedReason:
            task.blocked_reason ??
            "",

          archived:
            Boolean(
              task.archived_at,
            ),

          deleted:
            Boolean(
              task.deleted_at,
            ),

          createdBy:
            profileMap.get(
              task.created_by,
            ) ??
            "Unknown member",

          createdAt:
            task.created_at,

          updatedAt:
            task.updated_at,
        };
      },
    );

  const sheetUpdates:
    GoogleSheetsUpdate[] =
    (
      updates ??
      []
    ).map(
      (
        update:
          any,
      ) => {
        const task =
          update.task_id
            ? taskMap.get(
                update.task_id,
              )
            : null;

        const project =
          update.project_id
            ? projectMap.get(
                update.project_id,
              )
            : task?.project_id
              ? projectMap.get(
                  task.project_id,
                )
              : null;

        const type:
          GoogleSheetsUpdate["type"] =
          update.project_id
            ? "PROJECT"
            : task?.project_id
              ? "SUBTASK"
              : "TASK";

        return {
          id:
            update.id,

          type,

          project:
            project?.name ??
            "",

          workItem:
            update.project_id
              ? project?.name ??
                "Unknown project"
              : task?.title ??
                "Unknown task",

          source:
            update.source ===
            "clock"
              ? "Clock"
              : "Manual",

          author:
            update.author_id
              ? profileMap.get(
                  update.author_id,
                ) ??
                "Unknown member"
              : "Unknown member",

          body:
            update.body,

          loggedHours:
            update.duration_ms
              ? Number(
                  (
                    Number(
                      update.duration_ms,
                    ) /
                    3_600_000
                  ).toFixed(
                    2,
                  ),
                )
              : 0,

          createdAt:
            update.created_at,

          updatedAt:
            update.updated_at,
        };
      },
    );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      GOOGLE_SHEETS_TIMEOUT_MS,
    );

  let response:
    Response;

  try {
    response =
      await fetch(
        url,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              secret,

              projects:
                sheetProjects,

              tasks:
                sheetTasks,

              updates:
                sheetUpdates,

              syncedAt:
                new Date()
                  .toISOString(),
            }),

          signal:
            controller.signal,
        },
      );
  } finally {
    clearTimeout(
      timeout,
    );
  }

  if (
    !response.ok
  ) {
    throw new Error(
      `Google Sheets returned HTTP ${response.status}.`,
    );
  }

  let result:
    GoogleSheetsResponse;

  try {
    result =
      await response.json() as
        GoogleSheetsResponse;
  } catch {
    throw new Error(
      "Google Sheets returned an invalid response.",
    );
  }

  if (
    !result.ok
  ) {
    throw new Error(
      result.error ??
      "Google Sheets sync failed.",
    );
  }

  return {
    ok:
      true,

    projects:
      sheetProjects.length,

    tasks:
      sheetTasks.length,

    updates:
      sheetUpdates.length,
  };
}

/*
 * Automatic sync must never make a normal
 * POM task/project mutation fail.
 *
 * Updates from Clock/manual notes are included in the
 * next normal snapshot, but they do NOT trigger a new
 * Google Sheets sync on their own. This keeps usage cheap.
 * Admin can always use the manual Sync Sheets button.
 */
export async function safeSyncGoogleSheetsSnapshot() {
  if (
    !googleSheetsConfigured()
  ) {
    return;
  }

  try {
    await syncGoogleSheetsSnapshot();
  } catch (
    error
  ) {
    console.error(
      "[google-sheets] Automatic sync failed",
      error,
    );
  }
}