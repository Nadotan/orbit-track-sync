import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TaskRole =
  | "admin"
  | "team_lead"
  | "user";

export type TaskStatus =
  | "To Do"
  | "In Progress"
  | "Blocked"
  | "Done";

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

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  deadline: string;
  status: TaskStatus;
  teamId: string | null;
  teamName: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  assignees: TaskAssignee[];
  canEditDetails: boolean;
  canEditStatus: boolean;
}

export interface TasksWorkspace {
  currentUserId: string;
  role: TaskRole;
  teamIds: string[];

  teams: {
    id: string;
    name: string;
  }[];

  people: TaskPerson[];
  tasks: TaskItem[];
}

const taskStatusSchema =
  z.enum([
    "To Do",
    "In Progress",
    "Blocked",
    "Done",
  ]);

const dateSchema =
  z.string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
    );

const taskIdSchema =
  z.object({
    taskId:
      z.string()
        .uuid(),
  });

const createTaskSchema =
  z.object({
    title:
      z.string()
        .trim()
        .min(1)
        .max(120),

    description:
      z.string()
        .trim()
        .max(2000),

    deadline:
      dateSchema,

    status:
      taskStatusSchema,

    teamId:
      z.string()
        .uuid()
        .nullable(),

    assigneeIds:
      z.array(
        z.string()
          .uuid(),
      )
        .min(1)
        .max(100),
  });

const updateTaskSchema =
  createTaskSchema.extend({
    taskId:
      z.string()
        .uuid(),
  });

const updateStatusSchema =
  z.object({
    taskId:
      z.string()
        .uuid(),

    status:
      taskStatusSchema,
  });

const teamLeadSchema =
  z.object({
    userId:
      z.string()
        .uuid(),

    enabled:
      z.boolean(),
  });

function normalizeRole(
  role:
    | string
    | null
    | undefined,
): TaskRole {
  if (
    role ===
    "admin"
  ) {
    return "admin";
  }

  if (
    role ===
    "team_lead"
  ) {
    return "team_lead";
  }

  return "user";
}

function uniqueStrings(
  values:
    string[],
) {
  return Array.from(
    new Set(
      values,
    ),
  );
}

interface Access {
  role:
    TaskRole;

  teamIds:
    string[];
}

async function getAccess(
  admin:
    any,

  userId:
    string,
): Promise<Access> {
  const [
    {
      data:
        roleRow,
      error:
        roleError,
    },

    {
      data:
        memberships,
      error:
        membershipsError,
    },

    {
      data:
        profile,
      error:
        profileError,
    },
  ] =
    await Promise.all([
      admin
        .from(
          "user_roles",
        )
        .select(
          "role",
        )
        .eq(
          "user_id",
          userId,
        )
        .maybeSingle(),

      admin
        .from(
          "team_members",
        )
        .select(
          "team_id",
        )
        .eq(
          "user_id",
          userId,
        ),

      admin
        .from(
          "profiles",
        )
        .select(
          "team_id",
        )
        .eq(
          "id",
          userId,
        )
        .maybeSingle(),
    ]);

  if (
    roleError ||
    membershipsError ||
    profileError
  ) {
    throw new Error(
      "Unable to determine task permissions.",
    );
  }

  const membershipTeamIds =
    uniqueStrings(
      (
        memberships ??
        []
      ).map(
        (
          membership:
            any,
        ) =>
          membership.team_id,
      ),
    );

  const teamIds =
    membershipTeamIds.length >
    0
      ? membershipTeamIds
      : profile?.team_id
        ? [
            profile.team_id,
          ]
        : [];

  return {
    role:
      normalizeRole(
        roleRow?.role,
      ),

    teamIds,
  };
}

function canManageTask(
  access:
    Access,

  teamId:
    string |
    null,
) {
  if (
    access.role ===
    "admin"
  ) {
    return true;
  }

  return (
    access.role ===
      "team_lead" &&
    teamId !==
      null &&
    access.teamIds.includes(
      teamId,
    )
  );
}

async function validateTaskAudience(
  admin:
    any,

  access:
    Access,

  teamId:
    string |
    null,

  assigneeIds:
    string[],
) {
  const unique =
    uniqueStrings(
      assigneeIds,
    );

  if (
    unique.length ===
    0
  ) {
    throw new Error(
      "Assign at least one person.",
    );
  }

  if (
    access.role !==
      "admin" &&
    access.role !==
      "team_lead"
  ) {
    throw new Error(
      "Forbidden",
    );
  }

  if (
    access.role ===
      "team_lead"
  ) {
    if (
      !teamId ||
      !access.teamIds.includes(
        teamId,
      )
    ) {
      throw new Error(
        "Team Leads can only manage tasks for their own teams.",
      );
    }
  }

  const {
    data:
      profiles,
    error:
      profilesError,
  } =
    await admin
      .from(
        "profiles",
      )
      .select(
        "id, team_id",
      )
      .in(
        "id",
        unique,
      );

  if (
    profilesError
  ) {
    throw new Error(
      profilesError.message,
    );
  }

  if (
    (
      profiles ??
      []
    ).length !==
    unique.length
  ) {
    throw new Error(
      "One or more selected users do not exist.",
    );
  }

  if (
    teamId ===
    null
  ) {
    if (
      access.role !==
      "admin"
    ) {
      throw new Error(
        "Only admins can create General tasks.",
      );
    }

    return unique;
  }

  const {
    data:
      team,
    error:
      teamError,
  } =
    await admin
      .from(
        "teams",
      )
      .select(
        "id",
      )
      .eq(
        "id",
        teamId,
      )
      .maybeSingle();

  if (
    teamError ||
    !team
  ) {
    throw new Error(
      "Team not found.",
    );
  }

  const {
    data:
      memberships,
    error:
      membershipsError,
  } =
    await admin
      .from(
        "team_members",
      )
      .select(
        "user_id",
      )
      .eq(
        "team_id",
        teamId,
      )
      .in(
        "user_id",
        unique,
      );

  if (
    membershipsError
  ) {
    throw new Error(
      membershipsError.message,
    );
  }

  const members =
    new Set<string>(
      (
        memberships ??
        []
      ).map(
        (
          membership:
            any,
        ) =>
          membership.user_id,
      ),
    );

  for (
    const profile of
    profiles ??
    []
  ) {
    if (
      profile.team_id ===
      teamId
    ) {
      members.add(
        profile.id,
      );
    }
  }

  for (
    const userId of
    unique
  ) {
    if (
      !members.has(
        userId,
      )
    ) {
      throw new Error(
        "A team task can only be assigned to members of that team.",
      );
    }
  }

  return unique;
}

async function sendAssignmentPush(
  userIds:
    string[],

  task: {
    id:
      string;

    title:
      string;

    deadline:
      string;
  },

  actorUserId:
    string,
) {
  const targets =
    uniqueStrings(
      userIds,
    ).filter(
      (
        userId,
      ) =>
        userId !==
        actorUserId,
    );

  if (
    targets.length ===
    0
  ) {
    return;
  }

  try {
    const {
      sendPushToUsers,
    } =
      await import(
        "./push.server"
      );

    await sendPushToUsers(
      targets,
      {
        title:
          "New task assigned",

        body:
          `${task.title} — due ${task.deadline}.`,

        url:
          "/tasks",

        tag:
          `task-${task.id}`,
      },
    );
  } catch (
    error
  ) {
    /*
     * Task creation must not fail just because
     * a push provider is temporarily unavailable.
     */
    console.error(
      "[tasks] Failed to send assignment push",
      error,
    );
  }
}

export const getTasksWorkspace =
  createServerFn({
    method:
      "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(
      async ({
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

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
              roles,
            error:
              rolesError,
          },

          {
            data:
              memberships,
            error:
              membershipsError,
          },

          {
            data:
              teams,
            error:
              teamsError,
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
                "id, name, team_id",
              )
              .order(
                "name",
              ),

            admin
              .from(
                "user_roles",
              )
              .select(
                "user_id, role",
              ),

            admin
              .from(
                "team_members",
              )
              .select(
                "user_id, team_id",
              ),

            admin
              .from(
                "teams",
              )
              .select(
                "id, name",
              )
              .order(
                "name",
              ),

            admin
              .from(
                "tasks",
              )
              .select(
                "id, title, description, deadline, status, team_id, created_by, created_at, updated_at",
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
          rolesError ||
          membershipsError ||
          teamsError ||
          tasksError ||
          assignmentsError
        ) {
          throw new Error(
            "Unable to load tasks.",
          );
        }

        const roleMap =
          new Map<
            string,
            TaskRole
          >();

        for (
          const role of
          roles ??
          []
        ) {
          roleMap.set(
            role.user_id,
            normalizeRole(
              role.role,
            ),
          );
        }

        const membershipMap =
          new Map<
            string,
            string[]
          >();

        for (
          const membership of
          memberships ??
          []
        ) {
          const current =
            membershipMap.get(
              membership.user_id,
            ) ??
            [];

          current.push(
            membership.team_id,
          );

          membershipMap.set(
            membership.user_id,
            current,
          );
        }

        const profileMap =
          new Map<
            string,
            any
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
                profile,
              ],
            ),
          );

        const people:
          TaskPerson[] =
          (
            profiles ??
            []
          ).map(
            (
              profile:
                any,
            ) => {
              const memberTeams =
                membershipMap.get(
                  profile.id,
                ) ??
                [];

              return {
                id:
                  profile.id,

                name:
                  profile.name,

                teamIds:
                  memberTeams.length >
                  0
                    ? uniqueStrings(
                        memberTeams,
                      )
                    : profile.team_id
                      ? [
                          profile.team_id,
                        ]
                      : [],

                role:
                  roleMap.get(
                    profile.id,
                  ) ??
                  "user",
              };
            },
          );

        const currentPerson =
          people.find(
            (
              person,
            ) =>
              person.id ===
              context.userId,
          );

        const access:
          Access = {
          role:
            roleMap.get(
              context.userId,
            ) ??
            "user",

          teamIds:
            currentPerson
              ?.teamIds ??
            [],
        };

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

        const visibleTasks =
          (
            tasks ??
            []
          ).filter(
            (
              task:
                any,
            ) => {
              const taskAssignees =
                assigneeMap.get(
                  task.id,
                ) ??
                [];

              if (
                access.role ===
                "admin"
              ) {
                return true;
              }

              if (
                taskAssignees.includes(
                  context.userId,
                )
              ) {
                return true;
              }

              if (
                task.team_id ===
                null
              ) {
                return true;
              }

              return access.teamIds.includes(
                task.team_id,
              );
            },
          );

        const resultTasks:
          TaskItem[] =
          visibleTasks.map(
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

              const assignees =
                assigneeIds
                  .map(
                    (
                      userId,
                    ) => {
                      const profile =
                        profileMap.get(
                          userId,
                        );

                      if (
                        !profile
                      ) {
                        return null;
                      }

                      return {
                        id:
                          userId,

                        name:
                          profile.name,
                      };
                    },
                  )
                  .filter(
                    (
                      assignee,
                    ): assignee is TaskAssignee =>
                      Boolean(
                        assignee,
                      ),
                  )
                  .sort(
                    (
                      a,
                      b,
                    ) =>
                      a.name.localeCompare(
                        b.name,
                      ),
                  );

              const editDetails =
                canManageTask(
                  access,
                  task.team_id,
                );

              return {
                id:
                  task.id,

                title:
                  task.title,

                description:
                  task.description,

                deadline:
                  task.deadline,

                status:
                  task.status as TaskStatus,

                teamId:
                  task.team_id,

                teamName:
                  task.team_id
                    ? teamMap.get(
                        task.team_id,
                      ) ??
                      "Unknown team"
                    : "General",

                createdBy:
                  task.created_by,

                createdByName:
                  profileMap.get(
                    task.created_by,
                  )?.name ??
                  "Unknown member",

                createdAt:
                  task.created_at,

                updatedAt:
                  task.updated_at,

                assignees,

                canEditDetails:
                  editDetails,

                canEditStatus:
                  editDetails ||
                  assigneeIds.includes(
                    context.userId,
                  ),
              };
            },
          );

        return {
          currentUserId:
            context.userId,

          role:
            access.role,

          teamIds:
            access.teamIds,

          teams:
            (
              teams ??
              []
            ).map(
              (
                team:
                  any,
              ) => ({
                id:
                  team.id,

                name:
                  team.name,
              }),
            ),

          people,

          tasks:
            resultTasks,
        } satisfies TasksWorkspace;
      },
    );

export const createTask =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      createTaskSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const access =
          await getAccess(
            admin,
            context.userId,
          );

        if (
          access.role !==
            "admin" &&
          access.role !==
            "team_lead"
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const assigneeIds =
          await validateTaskAudience(
            admin,
            access,
            data.teamId,
            data.assigneeIds,
          );

        const {
          data:
            task,
          error:
            taskError,
        } =
          await admin
            .from(
              "tasks",
            )
            .insert({
              title:
                data.title.trim(),

              description:
                data.description.trim(),

              deadline:
                data.deadline,

              status:
                data.status,

              team_id:
                data.teamId,

              created_by:
                context.userId,
            })
            .select(
              "id, title, deadline",
            )
            .single();

        if (
          taskError ||
          !task
        ) {
          throw new Error(
            taskError?.message ??
            "Unable to create task.",
          );
        }

        const {
          error:
            assignmentError,
        } =
          await admin
            .from(
              "task_assignees",
            )
            .insert(
              assigneeIds.map(
                (
                  userId,
                ) => ({
                  task_id:
                    task.id,

                  user_id:
                    userId,
                }),
              ),
            );

        if (
          assignmentError
        ) {
          await admin
            .from(
              "tasks",
            )
            .delete()
            .eq(
              "id",
              task.id,
            );

          throw new Error(
            assignmentError.message,
          );
        }

        await sendAssignmentPush(
          assigneeIds,
          task,
          context.userId,
        );

        return {
          id:
            task.id,
        };
      },
    );

export const updateTaskStatus =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      updateStatusSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const access =
          await getAccess(
            admin,
            context.userId,
          );

        const {
          data:
            task,
          error:
            taskError,
        } =
          await admin
            .from(
              "tasks",
            )
            .select(
              "id, team_id",
            )
            .eq(
              "id",
              data.taskId,
            )
            .maybeSingle();

        if (
          taskError ||
          !task
        ) {
          throw new Error(
            "Task not found.",
          );
        }

        let allowed =
          canManageTask(
            access,
            task.team_id,
          );

        if (
          !allowed
        ) {
          const {
            data:
              assignment,
            error:
              assignmentError,
          } =
            await admin
              .from(
                "task_assignees",
              )
              .select(
                "task_id",
              )
              .eq(
                "task_id",
                data.taskId,
              )
              .eq(
                "user_id",
                context.userId,
              )
              .maybeSingle();

          if (
            assignmentError
          ) {
            throw new Error(
              assignmentError.message,
            );
          }

          allowed =
            Boolean(
              assignment,
            );
        }

        if (
          !allowed
        ) {
          throw new Error(
            "You are not assigned to this task.",
          );
        }

        const {
          error,
        } =
          await admin
            .from(
              "tasks",
            )
            .update({
              status:
                data.status,

              updated_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              data.taskId,
            );

        if (
          error
        ) {
          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const updateTask =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      updateTaskSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const access =
          await getAccess(
            admin,
            context.userId,
          );

        const {
          data:
            existing,
          error:
            existingError,
        } =
          await admin
            .from(
              "tasks",
            )
            .select(
              "id, team_id",
            )
            .eq(
              "id",
              data.taskId,
            )
            .maybeSingle();

        if (
          existingError ||
          !existing
        ) {
          throw new Error(
            "Task not found.",
          );
        }

        if (
          !canManageTask(
            access,
            existing.team_id,
          )
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const assigneeIds =
          await validateTaskAudience(
            admin,
            access,
            data.teamId,
            data.assigneeIds,
          );

        const {
          data:
            existingAssignments,
          error:
            assignmentsError,
        } =
          await admin
            .from(
              "task_assignees",
            )
            .select(
              "user_id",
            )
            .eq(
              "task_id",
              data.taskId,
            );

        if (
          assignmentsError
        ) {
          throw new Error(
            assignmentsError.message,
          );
        }

        const previousIds =
          uniqueStrings(
            (
              existingAssignments ??
              []
            ).map(
              (
                assignment:
                  any,
              ) =>
                assignment.user_id,
            ),
          );

        const previousSet =
          new Set(
            previousIds,
          );

        const nextSet =
          new Set(
            assigneeIds,
          );

        const added =
          assigneeIds.filter(
            (
              userId,
            ) =>
              !previousSet.has(
                userId,
              ),
          );

        const removed =
          previousIds.filter(
            (
              userId,
            ) =>
              !nextSet.has(
                userId,
              ),
          );

        const {
          error:
            updateError,
        } =
          await admin
            .from(
              "tasks",
            )
            .update({
              title:
                data.title.trim(),

              description:
                data.description.trim(),

              deadline:
                data.deadline,

              status:
                data.status,

              team_id:
                data.teamId,

              updated_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              data.taskId,
            );

        if (
          updateError
        ) {
          throw new Error(
            updateError.message,
          );
        }

        if (
          added.length >
          0
        ) {
          const {
            error:
              addError,
          } =
            await admin
              .from(
                "task_assignees",
              )
              .insert(
                added.map(
                  (
                    userId,
                  ) => ({
                    task_id:
                      data.taskId,

                    user_id:
                      userId,
                  }),
                ),
              );

          if (
            addError
          ) {
            throw new Error(
              addError.message,
            );
          }
        }

        if (
          removed.length >
          0
        ) {
          const {
            error:
              removeError,
          } =
            await admin
              .from(
                "task_assignees",
              )
              .delete()
              .eq(
                "task_id",
                data.taskId,
              )
              .in(
                "user_id",
                removed,
              );

          if (
            removeError
          ) {
            throw new Error(
              removeError.message,
            );
          }
        }

        if (
          added.length >
          0
        ) {
          await sendAssignmentPush(
            added,
            {
              id:
                data.taskId,

              title:
                data.title,

              deadline:
                data.deadline,
            },
            context.userId,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const deleteTask =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      taskIdSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const access =
          await getAccess(
            admin,
            context.userId,
          );

        const {
          data:
            task,
          error:
            taskError,
        } =
          await admin
            .from(
              "tasks",
            )
            .select(
              "team_id",
            )
            .eq(
              "id",
              data.taskId,
            )
            .maybeSingle();

        if (
          taskError ||
          !task
        ) {
          throw new Error(
            "Task not found.",
          );
        }

        if (
          !canManageTask(
            access,
            task.team_id,
          )
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const {
          error,
        } =
          await admin
            .from(
              "tasks",
            )
            .delete()
            .eq(
              "id",
              data.taskId,
            );

        if (
          error
        ) {
          throw new Error(
            error.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );

export const setTeamLeadRole =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      teamLeadSchema,
    )
    .handler(
      async ({
        data,
        context,
      }) => {
        const {
          supabaseAdmin,
        } =
          await import(
            "@/integrations/supabase/client.server"
          );

        const admin =
          supabaseAdmin as any;

        const caller =
          await getAccess(
            admin,
            context.userId,
          );

        if (
          caller.role !==
          "admin"
        ) {
          throw new Error(
            "Forbidden",
          );
        }

        const {
          data:
            currentRole,
          error:
            roleError,
        } =
          await admin
            .from(
              "user_roles",
            )
            .select(
              "role",
            )
            .eq(
              "user_id",
              data.userId,
            )
            .maybeSingle();

        if (
          roleError
        ) {
          throw new Error(
            roleError.message,
          );
        }

        if (
          currentRole?.role ===
          "admin"
        ) {
          throw new Error(
            "Admin roles must be changed from the Admin Dashboard.",
          );
        }

        if (
          data.enabled
        ) {
          const targetAccess =
            await getAccess(
              admin,
              data.userId,
            );

          if (
            targetAccess.teamIds.length ===
            0
          ) {
            throw new Error(
              "Assign this person to a team before making them a Team Lead.",
            );
          }
        }

        const {
          error:
            deleteError,
        } =
          await admin
            .from(
              "user_roles",
            )
            .delete()
            .eq(
              "user_id",
              data.userId,
            );

        if (
          deleteError
        ) {
          throw new Error(
            deleteError.message,
          );
        }

        const {
          error:
            insertError,
        } =
          await admin
            .from(
              "user_roles",
            )
            .insert({
              user_id:
                data.userId,

              role:
                data.enabled
                  ? "team_lead"
                  : "user",
            });

        if (
          insertError
        ) {
          throw new Error(
            insertError.message,
          );
        }

        return {
          ok:
            true,
        };
      },
    );