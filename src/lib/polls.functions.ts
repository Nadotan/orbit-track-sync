import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface PollOptionResult {
  id: string;
  label: string;
  position: number;
  votes: number;
  percentage: number;
}

export interface PollResult {
  id: string;
  label: string;
  question: string;
  description: string;
  closesAt: string;
  publishedAt: string;
  createdAt: string;
  totalVotes: number;
  userOptionId: string | null;
  isClosed: boolean;
  options: PollOptionResult[];
}

export interface ActivePollsWorkspace {
  currentUserId: string;
  isAdmin: boolean;
  polls: PollResult[];
}

export interface AdminPollsWorkspace {
  currentUserId: string;
  polls: PollResult[];
}

const createPollSchema = z.object({
  label: z.string().trim().min(1).max(40),

  question: z.string().trim().min(1).max(240),

  description: z.string().trim().max(500),

  closesAt: z.string().datetime({
    offset: true,
  }),

  options: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(80),
    )
    .min(2)
    .max(10),
});

const voteSchema = z.object({
  pollId: z.string().uuid(),
  optionId: z.string().uuid(),
});

const pollIdSchema = z.object({
  pollId: z.string().uuid(),
});

interface PollRow {
  id: string;

  label: string;
  question: string;
  description: string;

  closes_at: string;
  published_at: string;
  created_at: string;
}

interface PollOptionRow {
  id: string;
  poll_id: string;
  label: string;
  position: number;
}

interface PollVoteRow {
  poll_id: string;
  user_id: string;
  option_id: string;
}

function uniqueOptions(
  options: string[],
) {
  const seen =
    new Set<string>();

  const clean:
    string[] = [];

  for (
    const raw
    of options
  ) {
    const label =
      raw.trim();

    const key =
      label.toLocaleLowerCase();

    if (
      !label ||
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    clean.push(label);
  }

  return clean;
}

async function requireAdmin(
  admin: any,
  userId: string,
) {
  const {
    data,
    error,
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
        userId,
      )
      .eq(
        "role",
        "admin",
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      "Unable to verify admin permissions.",
    );
  }

  if (!data) {
    throw new Error(
      "Forbidden",
    );
  }
}

async function isAdmin(
  admin: any,
  userId: string,
) {
  const {
    data,
    error,
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
        userId,
      )
      .eq(
        "role",
        "admin",
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      "Unable to determine poll permissions.",
    );
  }

  return Boolean(data);
}

function buildPollResults(
  polls: PollRow[],
  options: PollOptionRow[],
  votes: PollVoteRow[],
  currentUserId: string,
): PollResult[] {
  const now =
    Date.now();

  const optionsByPoll =
    new Map<
      string,
      PollOptionRow[]
    >();

  const countsByPoll =
    new Map<
      string,
      Map<
        string,
        number
      >
    >();

  const userVoteByPoll =
    new Map<
      string,
      string
    >();

  const totalByPoll =
    new Map<
      string,
      number
    >();

  for (
    const option
    of options
  ) {
    const list =
      optionsByPoll.get(
        option.poll_id,
      ) ?? [];

    list.push(
      option,
    );

    optionsByPoll.set(
      option.poll_id,
      list,
    );
  }

  for (
    const vote
    of votes
  ) {
    const counts =
      countsByPoll.get(
        vote.poll_id,
      ) ??
      new Map<
        string,
        number
      >();

    counts.set(
      vote.option_id,
      (
        counts.get(
          vote.option_id,
        ) ?? 0
      ) + 1,
    );

    countsByPoll.set(
      vote.poll_id,
      counts,
    );

    totalByPoll.set(
      vote.poll_id,
      (
        totalByPoll.get(
          vote.poll_id,
        ) ?? 0
      ) + 1,
    );

    if (
      vote.user_id ===
      currentUserId
    ) {
      userVoteByPoll.set(
        vote.poll_id,
        vote.option_id,
      );
    }
  }

  return polls.map(
    (poll) => {
      const totalVotes =
        totalByPoll.get(
          poll.id,
        ) ?? 0;

      const counts =
        countsByPoll.get(
          poll.id,
        ) ??
        new Map<
          string,
          number
        >();

      const pollOptions =
        [
          ...(
            optionsByPoll.get(
              poll.id,
            ) ?? []
          ),
        ].sort(
          (
            a,
            b,
          ) =>
            a.position -
            b.position,
        );

      return {
        id:
          poll.id,

        label:
          poll.label,

        question:
          poll.question,

        description:
          poll.description,

        closesAt:
          poll.closes_at,

        publishedAt:
          poll.published_at,

        createdAt:
          poll.created_at,

        totalVotes,

        userOptionId:
          userVoteByPoll.get(
            poll.id,
          ) ?? null,

        isClosed:
          new Date(
            poll.closes_at,
          ).getTime() <=
          now,

        options:
          pollOptions.map(
            (
              option,
            ) => {
              const optionVotes =
                counts.get(
                  option.id,
                ) ?? 0;

              return {
                id:
                  option.id,

                label:
                  option.label,

                position:
                  option.position,

                votes:
                  optionVotes,

                percentage:
                  totalVotes ===
                  0
                    ? 0
                    : Math.round(
                        (
                          optionVotes /
                          totalVotes
                        ) *
                          100,
                      ),
              };
            },
          ),
      };
    },
  );
}

async function hydratePolls(
  admin: any,
  polls: PollRow[],
  currentUserId: string,
): Promise<PollResult[]> {
  if (
    polls.length ===
    0
  ) {
    return [];
  }

  const pollIds =
    polls.map(
      (
        poll,
      ) =>
        poll.id,
    );

  const [
    optionsResult,
    votesResult,
  ] =
    await Promise.all(
      [
        admin
          .from(
            "poll_options",
          )
          .select(
            "id, poll_id, label, position",
          )
          .in(
            "poll_id",
            pollIds,
          ),

        admin
          .from(
            "poll_votes",
          )
          .select(
            "poll_id, user_id, option_id",
          )
          .in(
            "poll_id",
            pollIds,
          ),
      ],
    );

  if (
    optionsResult.error
  ) {
    throw new Error(
      optionsResult
        .error
        .message,
    );
  }

  if (
    votesResult.error
  ) {
    throw new Error(
      votesResult
        .error
        .message,
    );
  }

  return buildPollResults(
    polls,

    (
      optionsResult.data ??
      []
    ) as PollOptionRow[],

    (
      votesResult.data ??
      []
    ) as PollVoteRow[],

    currentUserId,
  );
}

async function loadPollById(
  admin: any,
  pollId: string,
  currentUserId: string,
) {
  const {
    data,
    error,
  } =
    await admin
      .from(
        "polls",
      )
      .select(
        "id, label, question, description, closes_at, published_at, created_at",
      )
      .eq(
        "id",
        pollId,
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      error.message,
    );
  }

  if (!data) {
    throw new Error(
      "Poll not found.",
    );
  }

  const [
    poll,
  ] =
    await hydratePolls(
      admin,

      [
        data as PollRow,
      ],

      currentUserId,
    );

  if (!poll) {
    throw new Error(
      "Poll not found.",
    );
  }

  return poll;
}

export const getActivePolls =
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

        const nowIso =
          new Date()
            .toISOString();

        const {
          data,
          error,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "polls",
            )
            .select(
              "id, label, question, description, closes_at, published_at, created_at",
            )
            .lte(
              "published_at",
              nowIso,
            )
            .gt(
              "closes_at",
              nowIso,
            )
            .order(
              "closes_at",
              {
                ascending:
                  true,
              },
            );

        if (error) {
          throw new Error(
            error.message,
          );
        }

        return {
          currentUserId:
            context.userId,

          isAdmin:
            await isAdmin(
              supabaseAdmin,
              context.userId,
            ),

          polls:
            await hydratePolls(
              supabaseAdmin,

              (
                data ??
                []
              ) as PollRow[],

              context.userId,
            ),
        } satisfies ActivePollsWorkspace;
      },
    );

export const getAdminPolls =
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

        await requireAdmin(
          supabaseAdmin,
          context.userId,
        );

        const {
          data,
          error,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "polls",
            )
            .select(
              "id, label, question, description, closes_at, published_at, created_at",
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              },
            )
            .limit(
              30,
            );

        if (error) {
          throw new Error(
            error.message,
          );
        }

        return {
          currentUserId:
            context.userId,

          polls:
            await hydratePolls(
              supabaseAdmin,

              (
                data ??
                []
              ) as PollRow[],

              context.userId,
            ),
        } satisfies AdminPollsWorkspace;
      },
    );

export const getPoll =
  createServerFn({
    method:
      "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      pollIdSchema,
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

        const poll =
          await loadPollById(
            supabaseAdmin,
            data.pollId,
            context.userId,
          );

        if (
          new Date(
            poll.publishedAt,
          ).getTime() >
            Date.now() &&
          !(
            await isAdmin(
              supabaseAdmin,
              context.userId,
            )
          )
        ) {
          throw new Error(
            "Poll not found.",
          );
        }

        return poll;
      },
    );

export const createPoll =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      createPollSchema,
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

        await requireAdmin(
          supabaseAdmin,
          context.userId,
        );

        const options =
          uniqueOptions(
            data.options,
          );

        if (
          options.length <
          2
        ) {
          throw new Error(
            "Add at least two different options.",
          );
        }

        const closesAtMs =
          new Date(
            data.closesAt,
          ).getTime();

        if (
          !Number.isFinite(
            closesAtMs,
          ) ||
          closesAtMs <=
            Date.now() +
              60_000
        ) {
          throw new Error(
            "Closing time must be at least one minute in the future.",
          );
        }

        const nowIso =
          new Date()
            .toISOString();

        const {
          data:
            poll,
          error:
            pollError,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "polls",
            )
            .insert({
              label:
                data.label,

              question:
                data.question,

              description:
                data.description,

              closes_at:
                data.closesAt,

              published_at:
                nowIso,

              created_by:
                context.userId,

              updated_at:
                nowIso,
            })
            .select(
              "id, label, question, description, closes_at, published_at, created_at",
            )
            .single();

        if (
          pollError ||
          !poll
        ) {
          throw new Error(
            pollError
              ?.message ??
              "Could not create poll.",
          );
        }

        const {
          error:
            optionsError,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "poll_options",
            )
            .insert(
              options.map(
                (
                  label,
                  position,
                ) => ({
                  poll_id:
                    poll.id,

                  label,

                  position,
                }),
              ),
            );

        if (
          optionsError
        ) {
          await (
            supabaseAdmin as any
          )
            .from(
              "polls",
            )
            .delete()
            .eq(
              "id",
              poll.id,
            );

          throw new Error(
            optionsError
              .message,
          );
        }

        let pushSent =
          0;

        try {
          const {
            data:
              profiles,
            error:
              profilesError,
          } =
            await (
              supabaseAdmin as any
            )
              .from(
                "profiles",
              )
              .select(
                "id",
              );

          if (
            profilesError
          ) {
            throw profilesError;
          }

          const audience =
            (
              profiles ??
              []
            )
              .map(
                (
                  profile: {
                    id: string;
                  },
                ) =>
                  profile.id,
              )
              .filter(
                (
                  id: string,
                ) =>
                  id !==
                  context.userId,
              );

          if (
            audience.length >
            0
          ) {
            const {
              sendPushToUsers,
            } =
              await import(
                "./push.server"
              );

            pushSent =
              await sendPushToUsers(
                audience,
                {
                  title:
                    `${data.label} 🎉`,

                  body:
                    data.question,

                  url:
                    `/polls?poll=${poll.id}`,

                  tag:
                    `poll-${poll.id}`,
                },
              );
          }
        } catch (
          pushError
        ) {
          console.error(
            "[polls] Poll created but push notification failed",
            pushError,
          );
        }

        return {
          poll:
            await loadPollById(
              supabaseAdmin,
              poll.id,
              context.userId,
            ),

          pushSent,
        };
      },
    );

export const voteInPoll =
  createServerFn({
    method:
      "POST",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .validator(
      voteSchema,
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

        const [
          pollResult,
          optionResult,
        ] =
          await Promise.all(
            [
              (
                supabaseAdmin as any
              )
                .from(
                  "polls",
                )
                .select(
                  "id, closes_at, published_at",
                )
                .eq(
                  "id",
                  data.pollId,
                )
                .maybeSingle(),

              (
                supabaseAdmin as any
              )
                .from(
                  "poll_options",
                )
                .select(
                  "id, poll_id",
                )
                .eq(
                  "id",
                  data.optionId,
                )
                .eq(
                  "poll_id",
                  data.pollId,
                )
                .maybeSingle(),
            ],
          );

        if (
          pollResult.error
        ) {
          throw new Error(
            pollResult
              .error
              .message,
          );
        }

        if (
          optionResult.error
        ) {
          throw new Error(
            optionResult
              .error
              .message,
          );
        }

        if (
          !pollResult.data
        ) {
          throw new Error(
            "Poll not found.",
          );
        }

        if (
          !optionResult.data
        ) {
          throw new Error(
            "That option does not belong to this poll.",
          );
        }

        const nowMs =
          Date.now();

        const publishedAtMs =
          new Date(
            pollResult
              .data
              .published_at,
          ).getTime();

        const closesAtMs =
          new Date(
            pollResult
              .data
              .closes_at,
          ).getTime();

        if (
          publishedAtMs >
          nowMs
        ) {
          throw new Error(
            "This poll is not open yet.",
          );
        }

        if (
          closesAtMs <=
          nowMs
        ) {
          throw new Error(
            "This poll is closed.",
          );
        }

        const {
          error:
            voteError,
        } =
          await (
            supabaseAdmin as any
          )
            .from(
              "poll_votes",
            )
            .upsert(
              {
                poll_id:
                  data.pollId,

                user_id:
                  context.userId,

                option_id:
                  data.optionId,

                updated_at:
                  new Date()
                    .toISOString(),
              },

              {
                onConflict:
                  "poll_id,user_id",
              },
            );

        if (
          voteError
        ) {
          throw new Error(
            voteError.message,
          );
        }

        return loadPollById(
          supabaseAdmin,
          data.pollId,
          context.userId,
        );
      },
    );