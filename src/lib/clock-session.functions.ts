import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  WORK_UPDATE_MIN_WORDS,
  containsNamedMention,
  countWorkUpdateWords,
} from "./work-update-text";

const clockTaskUpdateSchema =
  z
    .object({
      taskId:
        z
          .string()
          .uuid(),

      body:
        z
          .string()
          .trim()
          .max(
            2000,
          ),
    })
    .superRefine(
      (
        value,
        context,
      ) => {
        if (
          countWorkUpdateWords(
            value.body,
          ) <
          WORK_UPDATE_MIN_WORDS
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "body",
            ],

            message:
              `Write at least ${WORK_UPDATE_MIN_WORDS} words for every task update.`,
          });
        }
      },
    );

const saveClockSessionSchema =
  z
    .object({
      startedAt:
        z
          .string()
          .datetime(),

      generalBody:
        z
          .string()
          .trim()
          .max(
            4000,
          )
          .nullable()
          .optional(),

      updates:
        z
          .array(
            clockTaskUpdateSchema,
          )
          .max(
            20,
          ),
    })
    .superRefine(
      (
        value,
        context,
      ) => {
        const taskIds =
          value.updates.map(
            (
              update,
            ) =>
              update.taskId,
          );

        if (
          new Set(
            taskIds,
          ).size !==
          taskIds.length
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "updates",
            ],

            message:
              "Each task can only be selected once.",
          });
        }

        if (
          value.updates.length ===
            0 &&
          countWorkUpdateWords(
            value.generalBody ??
              "",
          ) <
            WORK_UPDATE_MIN_WORDS
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "generalBody",
            ],

            message:
              `Write at least ${WORK_UPDATE_MIN_WORDS} words before saving the session.`,
          });
        }
      },
    );

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

export const saveClockSession =
  createServerFn({
    method:
      "POST",
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
              (
                update,
              ) =>
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
                  row:
                    any,
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

                    return `${task?.title ?? "Task"}\n${update.body.trim()}`;
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
               * Task updates are written directly below.
               * Keeping task_id NULL prevents the legacy
               * one-task trigger from creating a duplicate.
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
                  update.body.trim(),

                source:
                  "clock",

                /*
                 * source_time_entry_id is UNIQUE in
                 * the current schema. One Clock
                 * session can now create several
                 * task updates, so this stays NULL.
                 */
                source_time_entry_id:
                  null,

                /*
                 * Do not duplicate the full Clock
                 * duration across several tasks.
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

        let mentionCount =
          0;

        /*
         * Mentions are derived from the actual text.
         * There is no second list of tags to keep in sync.
         */
        if (
          data.updates.some(
            (
              update,
            ) =>
              update.body.includes(
                "@",
              ),
          )
        ) {
          try {
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
                  "id, name",
                );

            if (
              profilesError
            ) {
              throw profilesError;
            }

            const actorName =
              (
                profiles ??
                []
              ).find(
                (
                  profile:
                    any,
                ) =>
                  profile.id ===
                  context.userId,
              )?.name ??
              "A team member";

            const otherPeople =
              (
                profiles ??
                []
              ).filter(
                (
                  profile:
                    any,
                ) =>
                  profile.id !==
                  context.userId,
              );

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

                  return otherPeople
                    .filter(
                      (
                        profile:
                          any,
                      ) =>
                        containsNamedMention(
                          update.body,
                          profile.name,
                        ),
                    )
                    .map(
                      (
                        profile:
                          any,
                      ) => ({
                        user_id:
                          profile.id,

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

                        requires_ack:
                          true,
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
                console.error(
                  "[clock] Failed to create mention notifications",
                  notificationError,
                );
              } else {
                mentionCount =
                  mentionNotifications.length;
              }
            }
          } catch (
            error
          ) {
            /*
             * Notification failure must never
             * lose a saved work log.
             */
            console.error(
              "[clock] Failed to resolve mention notifications",
              error,
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
            mentionCount,
        };
      },
    );