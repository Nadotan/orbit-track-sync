import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CLOCK_UPDATE_MIN_WORDS = 30;

function countWords(value: string) {
  const trimmed = value.trim();

  return trimmed
    ? trimmed.split(/\s+/u).length
    : 0;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

const clockTaskUpdateSchema = z
  .object({
    taskId: z.string().uuid(),

    body: z
      .string()
      .trim()
      .max(2000),

    mentionedUserIds: z
      .array(z.string().uuid())
      .max(100)
      .default([]),
  })
  .superRefine((value, context) => {
    if (
      countWords(value.body) <
      CLOCK_UPDATE_MIN_WORDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: `Write at least ${CLOCK_UPDATE_MIN_WORDS} words for every task update.`,
      });
    }
  });

const saveClockSessionSchema = z
  .object({
    startedAt: z
      .string()
      .datetime(),

    generalBody: z
      .string()
      .trim()
      .max(4000)
      .nullable()
      .optional(),

    generalMentionedUserIds: z
      .array(z.string().uuid())
      .max(100)
      .default([]),

    updates: z
      .array(clockTaskUpdateSchema)
      .max(20),
  })
  .superRefine((value, context) => {
    const taskIds =
      value.updates.map(
        (update) => update.taskId,
      );

    if (
      new Set(taskIds).size !==
      taskIds.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updates"],
        message:
          "Each task can only be selected once.",
      });
    }

    if (
      value.updates.length === 0 &&
      countWords(
        value.generalBody ?? "",
      ) <
        CLOCK_UPDATE_MIN_WORDS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["generalBody"],
        message: `Write at least ${CLOCK_UPDATE_MIN_WORDS} words before saving the session.`,
      });
    }
  });

export const saveClockSession =
  createServerFn({
    method: "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      saveClockSessionSchema,
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

        const start =
          new Date(
            data.startedAt,
          );

        const end =
          new Date();

        if (
          !Number.isFinite(
            start.getTime(),
          )
        ) {
          throw new Error(
            "Invalid Clock start time.",
          );
        }

        if (
          start.getTime() >
          end.getTime() +
            60_000
        ) {
          throw new Error(
            "The Clock start time cannot be in the future.",
          );
        }

        const durationMs =
          Math.max(
            1,
            end.getTime() -
              start.getTime(),
          );

        const taskIds =
          uniqueStrings(
            data.updates.map(
              (update) =>
                update.taskId,
            ),
          );

        const taskMap =
          new Map<
            string,
            any
          >();

        if (
          taskIds.length >
          0
        ) {
          const [
            tasksResult,
            assignmentsResult,
          ] =
            await Promise.all([
              admin
                .from(
                  "tasks",
                )
                .select(
                  "id, title, owner_id, status, archived_at, deleted_at",
                )
                .in(
                  "id",
                  taskIds,
                ),

              admin
                .from(
                  "task_assignees",
                )
                .select(
                  "task_id",
                )
                .eq(
                  "user_id",
                  context.userId,
                )
                .in(
                  "task_id",
                  taskIds,
                ),
            ]);

          if (
            tasksResult.error ||
            assignmentsResult.error
          ) {
            throw new Error(
              "Unable to validate the selected tasks.",
            );
          }

          for (
            const task
            of tasksResult.data ??
            []
          ) {
            taskMap.set(
              task.id,
              task,
            );
          }

          const assignedTaskIds =
            new Set<string>(
              (
                assignmentsResult.data ??
                []
              ).map(
                (
                  row: any,
                ) =>
                  row.task_id,
              ),
            );

          for (
            const taskId
            of taskIds
          ) {
            const task =
              taskMap.get(
                taskId,
              );

            if (
              !task ||
              task.status ===
                "Done" ||
              task.archived_at ||
              task.deleted_at
            ) {
              throw new Error(
                "One of the selected tasks is no longer open.",
              );
            }

            if (
              task.owner_id !==
                context.userId &&
              !assignedTaskIds.has(
                taskId,
              )
            ) {
              throw new Error(
                "You are no longer assigned to one of these tasks.",
              );
            }
          }
        }

        const requestedMentionIds =
          uniqueStrings(
            [
              ...data.updates.flatMap(
                (update) =>
                  update.mentionedUserIds,
              ),
              ...(data.generalMentionedUserIds ??
                []),
            ].filter(
              (userId) =>
                userId !==
                context.userId,
            ),
          );


        const mentionNameMap =
          new Map<
            string,
            string
          >();

        if (
          requestedMentionIds.length >
          0
        ) {
          const {
            data: profiles,
            error:
              profilesError,
          } =
            await admin
              .from(
                "profiles",
              )
              .select(
                "id, name",
              )
              .in(
                "id",
                requestedMentionIds,
              );

          if (
            profilesError
          ) {
            throw new Error(
              "Unable to validate tagged people.",
            );
          }

          for (
            const profile
            of profiles ?? []
          ) {
            mentionNameMap.set(
              profile.id,
              profile.name,
            );
          }
        }

        const {
          data:
            actorProfile,
        } =
          await admin
            .from(
              "profiles",
            )
            .select(
              "name",
            )
            .eq(
              "id",
              context.userId,
            )
            .maybeSingle();

        const actorName =
          actorProfile?.name ??
          "A team member";

        const bodyWithMentions =
          (
            body: string,
            mentionedUserIds:
              string[],
          ) => {
            const tags =
              uniqueStrings(
                mentionedUserIds,
              )
                .filter(
                  (userId) =>
                    userId !==
                    context.userId,
                )
                .map(
                  (userId) =>
                    mentionNameMap.get(
                      userId,
                    ),
                )
                .filter(
                  (
                    name,
                  ): name is string =>
                    Boolean(name),
                )
                /*
                 * Inline @Name mentions are already
                 * written in the body, so only append
                 * tags that are missing from the text.
                 */
                .filter(
                  (name) =>
                    !body
                      .toLowerCase()
                      .includes(
                        `@${name.toLowerCase()}`,
                      ),
                )
                .map(
                  (name) =>
                    `@${name}`,
                );


            return tags.length >
              0
              ? `${body.trim()}\n\n${tags.join(" ")}`
              : body.trim();
          };

        const historyDescription =
          data.updates.length ===
          0
            ? (
                data.generalBody ??
                ""
              ).trim()
            : data.updates
                .map(
                  (
                    update,
                  ) => {
                    const task =
                      taskMap.get(
                        update.taskId,
                      );

                    const body =
                      bodyWithMentions(
                        update.body,
                        update.mentionedUserIds,
                      );

                    return `${task?.title ?? "Task"}\n${body}`;
                  },
                )
                .join(
                  "\n\n",
                );

        const {
          data:
            timeEntry,
          error:
            timeEntryError,
        } =
          await admin
            .from(
              "time_entries",
            )
            .insert({
              user_id:
                context.userId,

              start_time:
                data.startedAt,

              end_time:
                end.toISOString(),

              duration_ms:
                durationMs,

              description:
                historyDescription,

              /*
               * New Clock sessions write
               * their Task updates directly
               * to work_updates.
               *
               * task_id remains NULL so the
               * legacy one-task trigger does
               * not create a duplicate update.
               */
              task_id:
                null,
            })
            .select(
              "id",
            )
            .single();

        if (
          timeEntryError ||
          !timeEntry
        ) {
          throw new Error(
            timeEntryError
              ?.message ??
              "Unable to save the time entry.",
          );
        }

        if (
          data.updates.length >
          0
        ) {
          const workUpdateRows =
            data.updates.map(
              (
                update,
              ) => ({
                task_id:
                  update.taskId,

                project_id:
                  null,

                author_id:
                  context.userId,

                body:
                  bodyWithMentions(
                    update.body,
                    update.mentionedUserIds,
                  ),

                source:
                  "clock",

                /*
                 * The existing column is UNIQUE,
                 * so it cannot represent several
                 * Task updates from one Clock
                 * session. We intentionally leave
                 * it NULL rather than changing the
                 * current database schema.
                 */
                source_time_entry_id:
                  null,

                /*
                 * If one task was selected, all
                 * Clock time belongs to that task.
                 *
                 * With several tasks we do NOT
                 * duplicate the full session time
                 * onto every task.
                 */
                duration_ms:
                  data.updates.length ===
                  1
                    ? durationMs
                    : null,

                created_at:
                  end.toISOString(),

                updated_at:
                  end.toISOString(),
              }),
            );

          const {
            error:
              workUpdateError,
          } =
            await admin
              .from(
                "work_updates",
              )
              .insert(
                workUpdateRows,
              );

          if (
            workUpdateError
          ) {
            await admin
              .from(
                "time_entries",
              )
              .delete()
              .eq(
                "id",
                timeEntry.id,
              );

            throw new Error(
              workUpdateError
                .message ??
                "Unable to save the task updates.",
            );
          }
        }

        const mentionNotifications =
          data.updates.flatMap(
            (
              update,
            ) => {
              const task =
                taskMap.get(
                  update.taskId,
                );

              const excerpt =
                update.body
                  .trim()
                  .replace(
                    /\s+/gu,
                    " ",
                  )
                  .slice(
                    0,
                    180,
                  );

              return uniqueStrings(
                update.mentionedUserIds,
              )
                .filter(
                  (
                    userId,
                  ) =>
                    userId !==
                      context.userId &&
                    mentionNameMap.has(
                      userId,
                    ),
                )
                .map(
                  (
                    userId,
                  ) => ({
                    user_id:
                      userId,

                    kind:
                      "task_update",

                    title:
                      "You were mentioned",

                    message:
                      `${actorName} mentioned you in an update on ${task?.title ?? "a task"}: ${excerpt}`,

                    task_id:
                      update.taskId,

                    created_by:
                      context.userId,

                    /*
                     * Mention notifications
                     * appear as a normal popup,
                     * but do not require Got it.
                     */
                    requires_ack:
                      false,
                  }),
                );
            },
          );

        if (
          mentionNotifications.length >
          0
        ) {
          const {
            error:
              notificationError,
          } =
            await admin
              .from(
                "user_notifications",
              )
              .insert(
                mentionNotifications,
              );

          if (
            notificationError
          ) {
            /*
             * A notification failure should
             * never lose the user's work log.
             */
            console.error(
              "[clock] Failed to create mention notifications",
              notificationError,
            );
          }
        }

        await admin
          .from(
            "active_timers",
          )
          .delete()
          .eq(
            "user_id",
            context.userId,
          );

        try {
          const {
            safeSyncGoogleSheetsSnapshot,
          } =
            await import(
              "./google-sheets.server"
            );

          await safeSyncGoogleSheetsSnapshot();
        } catch (
          error
        ) {
          console.error(
            "[clock] Google Sheets sync failed",
            error,
          );
        }

        return {
          id:
            timeEntry.id,

          durationMs,

          taskUpdates:
            data.updates.length,

          mentions:
            mentionNotifications.length,
        };
      },
    );