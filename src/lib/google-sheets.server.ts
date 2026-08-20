import {
  supabaseAdmin,
} from "@/integrations/supabase/client.server";

interface GoogleSheetsProject {
  name: string;
  team: string;
  createdBy: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GoogleSheetsTask {
  project: string;
  title: string;
  team: string;
  owner: string;
  assignees: string;
  priority: string;
  status: string;
  deadline: string;
  blockedReason: string;
  archived: boolean;
  updatedAt: string;
}

interface GoogleSheetsResponse {
  ok?: boolean;
  error?: string;
  projects?: number;
  tasks?: number;
  syncedAt?: string;
}

export interface GoogleSheetsSyncResult {
  ok: true;
  projects: number;
  tasks: number;
}

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

      admin
        .from(
          "projects",
        )
        .select(
          "id, name, team_id, created_by, archived_at, created_at, updated_at",
        )
        .order(
          "name",
        ),

      admin
        .from(
          "tasks",
        )
        .select(
          "id, title, team_id, owner_id, project_id, priority, status, deadline, blocked_reason, archived_at, updated_at",
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
    ]);

  if (
    profilesError ||
    teamsError ||
    projectsError ||
    tasksError ||
    assignmentsError
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
      string
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
          project.name,
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

  const sheetProjects:
    GoogleSheetsProject[] =
    (
      projects ??
      []
    ).map(
      (
        project:
          any,
      ) => ({
        name:
          project.name,

        team:
          project.team_id
            ? teamMap.get(
                project.team_id,
              ) ??
              "Unknown team"
            : "General",

        createdBy:
          profileMap.get(
            project.created_by,
          ) ??
          "Unknown member",

        archived:
          Boolean(
            project.archived_at,
          ),

        createdAt:
          project.created_at,

        updatedAt:
          project.updated_at,
      }),
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

        return {
          project:
            task.project_id
              ? projectMap.get(
                  task.project_id,
                ) ??
                "Unknown project"
              : "",

          title:
            task.title,

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
            task.status,

          deadline:
            task.deadline,

          blockedReason:
            task.blocked_reason ??
            "",

          archived:
            Boolean(
              task.archived_at,
            ),

          updatedAt:
            task.updated_at,
        };
      },
    );

  const response =
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

            syncedAt:
              new Date()
                .toISOString(),
          }),
      },
    );

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
  };
}

/*
 * Automatic sync must never make a normal
 * POM task/project mutation fail.
 *
 * If Google is temporarily unavailable,
 * Admin can use the manual full-sync button later.
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