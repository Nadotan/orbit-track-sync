import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Check,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
  Vote,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  createPoll,
  getActivePolls,
  getAdminPolls,
  getPoll,
  voteInPoll,
  type ActivePollsWorkspace,
  type PollResult,
} from "@/lib/polls.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/polls")({
  validateSearch: (search: Record<string, unknown>) => ({
    poll: typeof search['poll'] === "string" ? search['poll'] : undefined,
  }),
  head: () => ({
    meta: [
      {
        title: "Polls - POM",
      },
      {
        name: "description",
        content: "Vote in active POM polls and see the current results.",
      },
    ],
  }),
  component: PollsPage,
});

interface PollDraft {
  label: string;
  question: string;
  description: string;
  closesLocal: string;
  options: string[];
}

const LABEL_PRESETS = [
  "Question of the Day",
  "Quick Vote",
  "Team Poll",
];

const CONFETTI = Array.from({ length: 30 }, (_, index) => ({
  left: `${(index * 37) % 96}%`,
  top: `${6 + ((index * 53) % 72)}%`,
  delay: `${-((index * 0.17) % 2.8)}s`,
  duration: `${3.2 + (((index * 19) % 18) / 10)}s`,
  rotation: `${(index * 43) % 180}deg`,
  color: [
    "#7c3aed",
    "#f59e0b",
    "#0ea5e9",
    "#22c55e",
    "#ec4899",
  ][index % 5],
}));

function toLocalDateTime(date: Date) {
  const local = new Date(
    date.getTime() -
      date.getTimezoneOffset() * 60_000,
  );

  return local
    .toISOString()
    .slice(0, 16);
}

function defaultDraft(): PollDraft {
  return {
    label: "Question of the Day",
    question: "",
    description: "",
    closesLocal: toLocalDateTime(
      new Date(
        Date.now() +
          2 * 60 * 60 * 1000,
      ),
    ),
    options: ["", ""],
  };
}

function countdownParts(target: string, now: number) {
  const remaining = Math.max(
    0,
    new Date(target).getTime() - now,
  );

  const totalSeconds = Math.floor(
    remaining / 1000,
  );

  return {
    remaining,
    days: Math.floor(
      totalSeconds / 86_400,
    ),
    hours: Math.floor(
      (totalSeconds % 86_400) /
        3_600,
    ),
    minutes: Math.floor(
      (totalSeconds % 3_600) /
        60,
    ),
    seconds: totalSeconds % 60,
  };
}

function PollsPage() {
  const loadActivePolls = useServerFn(
    getActivePolls,
  );

  const loadAdminPolls = useServerFn(
    getAdminPolls,
  );

  const loadOnePoll = useServerFn(
    getPoll,
  );

  const publishPoll = useServerFn(
    createPoll,
  );

  const castVote = useServerFn(
    voteInPoll,
  );

  const navigate = useNavigate();

  const {
    poll: requestedPollId,
  } = Route.useSearch();

  const [
    workspace,
    setWorkspace,
  ] = useState<ActivePollsWorkspace | null>(
    null,
  );

  const [
    adminPolls,
    setAdminPolls,
  ] = useState<PollResult[]>([]);

  const [
    extraPoll,
    setExtraPoll,
  ] = useState<PollResult | null>(
    null,
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    now,
    setNow,
  ] = useState(() => Date.now());

  const [
    votingKey,
    setVotingKey,
  ] = useState<string | null>(
    null,
  );

  const [
    createOpen,
    setCreateOpen,
  ] = useState(false);

  const [
    creating,
    setCreating,
  ] = useState(false);

  const [
    draft,
    setDraft,
  ] = useState<PollDraft>(
    () => defaultDraft(),
  );

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) {
        setRefreshing(true);
      }

      try {
        const active =
          await loadActivePolls();

        setWorkspace(active);

        if (active.isAdmin) {
          try {
            const history =
              await loadAdminPolls();

            setAdminPolls(
              history.polls,
            );
          } catch (error) {
            console.error(
              "[polls] Could not load admin poll history",
              error,
            );
          }
        } else {
          setAdminPolls([]);
        }

        if (
          requestedPollId &&
          !active.polls.some(
            (poll) =>
              poll.id ===
              requestedPollId,
          )
        ) {
          try {
            const requested =
              await loadOnePoll({
                data: {
                  pollId:
                    requestedPollId,
                },
              });

            setExtraPoll(
              requested,
            );
          } catch {
            setExtraPoll(null);
          }
        } else {
          setExtraPoll(null);
        }
      } catch (error) {
        console.error(
          "[polls] Could not load polls",
          error,
        );

        toast.error(
          "Could not load polls.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      loadActivePolls,
      loadAdminPolls,
      loadOnePoll,
      requestedPollId,
    ],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (
      !workspace?.polls.length &&
      !extraPoll
    ) {
      return;
    }

    const timer =
      window.setInterval(
        () =>
          setNow(Date.now()),
        1000,
      );

    return () =>
      window.clearInterval(
        timer,
      );
  }, [
    workspace?.polls.length,
    extraPoll,
  ]);

  useEffect(() => {
    const channel = supabase
      .channel("polls-page")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "polls",
        },
        () => {
          void load(true);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(
        channel,
      );
    };
  }, [load]);

  useEffect(() => {
    function refreshOnVisible() {
      if (
        document.visibilityState ===
        "visible"
      ) {
        void load(true);
      }
    }

    window.addEventListener(
      "focus",
      refreshOnVisible,
    );

    document.addEventListener(
      "visibilitychange",
      refreshOnVisible,
    );

    return () => {
      window.removeEventListener(
        "focus",
        refreshOnVisible,
      );

      document.removeEventListener(
        "visibilitychange",
        refreshOnVisible,
      );
    };
  }, [load]);

  const visiblePolls = useMemo(() => {
    const polls = [
      ...(workspace?.polls ?? []),
    ];

    if (
      extraPoll &&
      !polls.some(
        (poll) =>
          poll.id ===
          extraPoll.id,
      )
    ) {
      polls.unshift(extraPoll);
    }

    polls.sort((a, b) => {
      if (requestedPollId) {
        if (
          a.id ===
          requestedPollId
        ) {
          return -1;
        }

        if (
          b.id ===
          requestedPollId
        ) {
          return 1;
        }
      }

      return (
        new Date(
          a.closesAt,
        ).getTime() -
        new Date(
          b.closesAt,
        ).getTime()
      );
    });

    return polls;
  }, [
    workspace?.polls,
    extraPoll,
    requestedPollId,
  ]);

  const closedAdminPolls =
    useMemo(
      () =>
        adminPolls.filter(
          (poll) =>
            new Date(
              poll.closesAt,
            ).getTime() <= now,
        ),
      [adminPolls, now],
    );

  function replacePoll(
    updated: PollResult,
  ) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            polls:
              current.polls.map(
                (poll) =>
                  poll.id ===
                  updated.id
                    ? updated
                    : poll,
              ),
          }
        : current,
    );

    setExtraPoll((current) =>
      current?.id ===
      updated.id
        ? updated
        : current,
    );

    setAdminPolls((current) =>
      current.map((poll) =>
        poll.id === updated.id
          ? updated
          : poll,
      ),
    );
  }

  async function handleVote(
    poll: PollResult,
    optionId: string,
  ) {
    const closed =
      new Date(
        poll.closesAt,
      ).getTime() <=
      Date.now();

    if (
      closed ||
      votingKey ||
      poll.userOptionId ===
        optionId
    ) {
      return;
    }

    const previousVote =
      poll.userOptionId;

    setVotingKey(
      `${poll.id}:${optionId}`,
    );

    try {
      const updated =
        await castVote({
          data: {
            pollId: poll.id,
            optionId,
          },
        });

      replacePoll(updated);

      window.dispatchEvent(
        new Event(
          "pom:polls-changed",
        ),
      );

      toast.success(
        previousVote
          ? "Vote changed ✨"
          : "Vote counted 🎉",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not vote.",
      );
    } finally {
      setVotingKey(null);
    }
  }

  function setQuickClose(
    milliseconds: number,
  ) {
    setDraft((current) => ({
      ...current,
      closesLocal:
        toLocalDateTime(
          new Date(
            Date.now() +
              milliseconds,
          ),
        ),
    }));
  }

  function setTodayAt(
    hour: number,
  ) {
    const target =
      new Date();

    target.setHours(
      hour,
      0,
      0,
      0,
    );

    if (
      target.getTime() <=
      Date.now()
    ) {
      target.setDate(
        target.getDate() + 1,
      );
    }

    setDraft((current) => ({
      ...current,
      closesLocal:
        toLocalDateTime(
          target,
        ),
    }));
  }

  function updateOption(
    index: number,
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      options:
        current.options.map(
          (
            option,
            optionIndex,
          ) =>
            optionIndex ===
            index
              ? value
              : option,
        ),
    }));
  }

  function addOption() {
    setDraft((current) => ({
      ...current,
      options:
        current.options.length >= 10
          ? current.options
          : [
              ...current.options,
              "",
            ],
    }));
  }

  function removeOption(
    index: number,
  ) {
    setDraft((current) => ({
      ...current,
      options:
        current.options.length <= 2
          ? current.options
          : current.options.filter(
              (
                _,
                optionIndex,
              ) =>
                optionIndex !==
                index,
            ),
    }));
  }

  async function handleCreate() {
    const options =
      draft.options
        .map((option) =>
          option.trim(),
        )
        .filter(Boolean);

    if (
      !draft.question.trim()
    ) {
      toast.error(
        "Write a question first.",
      );
      return;
    }

    if (
      options.length < 2
    ) {
      toast.error(
        "Add at least two options.",
      );
      return;
    }

    if (!draft.closesLocal) {
      toast.error(
        "Choose when the poll closes.",
      );
      return;
    }

    const closesAt =
      new Date(
        draft.closesLocal,
      );

    if (
      !Number.isFinite(
        closesAt.getTime(),
      ) ||
      closesAt.getTime() <=
        Date.now() +
          60_000
    ) {
      toast.error(
        "Closing time must be at least one minute in the future.",
      );
      return;
    }

    setCreating(true);

    try {
      const result =
        await publishPoll({
          data: {
            label:
              draft.label.trim() ||
              "Question of the Day",

            question:
              draft.question.trim(),

            description:
              draft.description.trim(),

            closesAt:
              closesAt.toISOString(),

            options,
          },
        });

      setCreateOpen(false);
      setDraft(defaultDraft());

      window.dispatchEvent(
        new Event(
          "pom:polls-changed",
        ),
      );

      toast.success(
        result.pushSent > 0
          ? `Poll is live 🎉 · ${result.pushSent} push notification${result.pushSent === 1 ? "" : "s"} sent`
          : "Poll is live 🎉",
      );

      await load(true);

      navigate({
        to: "/polls",
        search: {
          poll:
            result.poll.id,
        },
        replace: true,
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create poll.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">
              Polls
            </h1>

            {(workspace?.polls.length ??
              0) >
              0 && (
              <Badge className="rounded-full bg-primary/10 text-primary hover:bg-primary/10">
                <Sparkles className="mr-1 size-3" />
                Live now
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            Pick a side, watch the
            results move, and change
            your vote until time runs
            out.
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={refreshing}
            onClick={() =>
              void load()
            }
          >
            <RefreshCw
              className={cn(
                "size-4",
                refreshing &&
                  "animate-spin",
              )}
            />
            Refresh
          </Button>

          {workspace?.isAdmin && (
            <Button
              type="button"
              className="rounded-xl"
              onClick={() => {
                setDraft(
                  defaultDraft(),
                );
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" />
              New Poll
            </Button>
          )}
        </div>
      </div>

      {visiblePolls.length === 0 ? (
        <div className="surface-card overflow-hidden rounded-3xl border border-dashed p-8 text-center sm:p-12">
          <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Vote className="size-6" />
          </div>

          <h2 className="mt-4 text-lg font-semibold">
            No poll is live right now
          </h2>

          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            When a new poll opens, a
            countdown button will appear
            across POM and users with
            push enabled will get a
            notification.
          </p>

          {workspace?.isAdmin && (
            <Button
              type="button"
              className="mt-5 rounded-xl"
              onClick={() =>
                setCreateOpen(true)
              }
            >
              <Sparkles className="size-4" />
              Create something fun
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {visiblePolls.map(
            (poll, index) => (
              <PollCard
                key={poll.id}
                poll={poll}
                now={now}
                featured={
                  index === 0 &&
                  new Date(
                    poll.closesAt,
                  ).getTime() > now
                }
                votingKey={votingKey}
                onVote={handleVote}
              />
            ),
          )}
        </div>
      )}

      {workspace?.isAdmin &&
        closedAdminPolls.length >
          0 && (
          <section className="space-y-3 pt-2">
            <div>
              <h2 className="text-base font-semibold">
                Recent polls
              </h2>

              <p className="mt-1 text-xs text-muted-foreground">
                Closed polls stay here so
                you can check the final
                result.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {closedAdminPolls
                .slice(0, 8)
                .map((poll) => {
                  const leader = [
                    ...poll.options,
                  ].sort(
                    (a, b) =>
                      b.votes -
                      a.votes,
                  )[0];

                  return (
                    <button
                      key={poll.id}
                      type="button"
                      className="surface-card min-w-0 rounded-2xl p-4 text-left transition-colors hover:bg-muted/30"
                      onClick={() =>
                        navigate({
                          to: "/polls",
                          search: {
                            poll:
                              poll.id,
                          },
                        })
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-primary">
                            {poll.label}
                          </p>

                          <p className="mt-1 line-clamp-2 text-sm font-semibold">
                            {poll.question}
                          </p>
                        </div>

                        <Badge
                          variant="outline"
                          className="shrink-0 rounded-full text-[10px]"
                        >
                          Closed
                        </Badge>
                      </div>

                      <p className="mt-3 text-xs text-muted-foreground">
                        {poll.totalVotes}{" "}
                        vote
                        {poll.totalVotes ===
                        1
                          ? ""
                          : "s"}

                        {leader &&
                        poll.totalVotes >
                          0
                          ? ` · ${leader.label} leads`
                          : ""}
                      </p>
                    </button>
                  );
                })}
            </div>
          </section>
        )}

      <CreatePollDialog
        open={createOpen}
        creating={creating}
        draft={draft}
        onOpenChange={
          setCreateOpen
        }
        onDraftChange={setDraft}
        onSetQuickClose={
          setQuickClose
        }
        onSetTodayAt={setTodayAt}
        onUpdateOption={
          updateOption
        }
        onAddOption={addOption}
        onRemoveOption={
          removeOption
        }
        onCreate={handleCreate}
      />
    </div>
  );
}

function CreatePollDialog({
  open,
  creating,
  draft,
  onOpenChange,
  onDraftChange,
  onSetQuickClose,
  onSetTodayAt,
  onUpdateOption,
  onAddOption,
  onRemoveOption,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  draft: PollDraft;

  onOpenChange: (
    open: boolean,
  ) => void;

  onDraftChange: (
    draft:
      | PollDraft
      | ((
          current: PollDraft,
        ) => PollDraft),
  ) => void;

  onSetQuickClose: (
    milliseconds: number,
  ) => void;

  onSetTodayAt: (
    hour: number,
  ) => void;

  onUpdateOption: (
    index: number,
    value: string,
  ) => void;

  onAddOption: () => void;

  onRemoveOption: (
    index: number,
  ) => void;

  onCreate: () => Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-3xl p-4 sm:max-w-xl sm:rounded-3xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            Create a Poll
          </DialogTitle>

          <DialogDescription>
            Publish it instantly.
            Everyone can vote,
            including admins, until
            the countdown reaches
            zero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Type</Label>

            <div className="flex flex-wrap gap-2">
              {LABEL_PRESETS.map(
                (label) => (
                  <Button
                    key={label}
                    type="button"
                    size="sm"
                    variant={
                      draft.label ===
                      label
                        ? "default"
                        : "outline"
                    }
                    className="rounded-full"
                    onClick={() =>
                      onDraftChange(
                        (current) => ({
                          ...current,
                          label,
                        }),
                      )
                    }
                  >
                    {label}
                  </Button>
                ),
              )}
            </div>

            <Input
              maxLength={40}
              value={draft.label}
              onChange={(event) =>
                onDraftChange(
                  (current) => ({
                    ...current,
                    label:
                      event.target
                        .value,
                  }),
                )
              }
              placeholder="Or write your own label"
            />
          </div>

          <div className="space-y-2">
            <Label>Question</Label>

            <Textarea
              rows={3}
              maxLength={240}
              className="resize-none rounded-2xl text-base"
              value={draft.question}
              onChange={(event) =>
                onDraftChange(
                  (current) => ({
                    ...current,
                    question:
                      event.target
                        .value,
                  }),
                )
              }
              placeholder="What should we build on Friday?"
            />
          </div>

          <div className="space-y-2">
            <Label>
              Description{" "}
              <span className="font-normal text-muted-foreground">
                · optional
              </span>
            </Label>

            <Textarea
              rows={2}
              maxLength={500}
              className="resize-none rounded-2xl"
              value={
                draft.description
              }
              onChange={(event) =>
                onDraftChange(
                  (current) => ({
                    ...current,
                    description:
                      event.target
                        .value,
                  }),
                )
              }
              placeholder="A little context makes a poll better…"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label>Options</Label>

              <span className="text-xs text-muted-foreground">
                {draft.options.length}
                /10
              </span>
            </div>

            <div className="space-y-2">
              {draft.options.map(
                (option, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>

                    <Input
                      maxLength={80}
                      value={option}
                      onChange={(
                        event,
                      ) =>
                        onUpdateOption(
                          index,
                          event.target
                            .value,
                        )
                      }
                      placeholder={`Option ${index + 1}`}
                    />

                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="shrink-0 rounded-full"
                      disabled={
                        draft.options
                          .length <= 2
                      }
                      onClick={() =>
                        onRemoveOption(
                          index,
                        )
                      }
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ),
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              disabled={
                draft.options.length >=
                10
              }
              onClick={onAddOption}
            >
              <Plus className="size-4" />
              Add option
            </Button>
          </div>

          <div className="space-y-3">
            <Label>Closes at</Label>

            <Input
              type="datetime-local"
              value={
                draft.closesLocal
              }
              min={toLocalDateTime(
                new Date(
                  Date.now() +
                    60_000,
                ),
              )}
              onChange={(event) =>
                onDraftChange(
                  (current) => ({
                    ...current,
                    closesLocal:
                      event.target
                        .value,
                  }),
                )
              }
            />

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  onSetQuickClose(
                    30 * 60_000,
                  )
                }
              >
                30 min
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  onSetQuickClose(
                    60 * 60_000,
                  )
                }
              >
                1 hour
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  onSetQuickClose(
                    3 *
                      60 *
                      60_000,
                  )
                }
              >
                3 hours
              </Button>

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  onSetTodayAt(20)
                }
              >
                20:00
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={creating}
            onClick={() =>
              onOpenChange(false)
            }
          >
            Cancel
          </Button>

          <Button
            type="button"
            disabled={creating}
            onClick={() =>
              void onCreate()
            }
          >
            {creating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}

            {creating
              ? "Publishing…"
              : "Publish Poll"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PollCard({
  poll,
  now,
  featured,
  votingKey,
  onVote,
}: {
  poll: PollResult;
  now: number;
  featured: boolean;
  votingKey: string | null;

  onVote: (
    poll: PollResult,
    optionId: string,
  ) => Promise<void>;
}) {
  const countdown =
    countdownParts(
      poll.closesAt,
      now,
    );

  const closed =
    countdown.remaining <= 0;

  const maxVotes = Math.max(
    0,
    ...poll.options.map(
      (option) => option.votes,
    ),
  );

  const hasVote =
    poll.userOptionId !== null;

  return (
    <Card className="relative isolate overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-slate-950 shadow-[0_18px_60px_-28px_rgba(15,23,42,0.35)]">
      {featured && (
        <PollConfetti />
      )}

      <CardContent className="relative z-10 p-4 sm:p-7">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full border-0 bg-violet-100 text-violet-700 hover:bg-violet-100">
                  <Sparkles className="mr-1 size-3" />
                  {poll.label}
                </Badge>

                {closed ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-slate-200 bg-slate-50 text-slate-600"
                  >
                    Closed
                  </Badge>
                ) : hasVote ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-emerald-200 bg-emerald-50 text-emerald-700"
                  >
                    <Check className="mr-1 size-3" />
                    You voted
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                  >
                    Your vote is
                    waiting
                  </Badge>
                )}
              </div>

              <h2 className="mt-4 break-words text-2xl font-bold tracking-tight sm:text-3xl">
                {poll.question}
              </h2>

              {poll.description && (
                <p className="mt-2 max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">
                  {poll.description}
                </p>
              )}
            </div>

            <CountdownBubble
              poll={poll}
              now={now}
            />
          </div>

          <div className="space-y-2.5">
            {poll.options.map(
              (option) => {
                const selected =
                  poll.userOptionId ===
                  option.id;

                const leading =
                  maxVotes > 0 &&
                  option.votes ===
                    maxVotes;

                const busy =
                  votingKey ===
                  `${poll.id}:${option.id}`;

                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={
                      selected
                    }
                    disabled={
                      closed ||
                      Boolean(
                        votingKey,
                      )
                    }
                    className={cn(
                      "group relative w-full overflow-hidden rounded-2xl border p-3.5 text-left transition-all sm:p-4",
                      selected
                        ? "border-violet-400 bg-violet-50 shadow-sm"
                        : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-sm",
                      closed &&
                        "cursor-default hover:translate-y-0",
                    )}
                    onClick={() =>
                      void onVote(
                        poll,
                        option.id,
                      )
                    }
                  >
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-500",
                        selected
                          ? "bg-violet-100/80"
                          : "bg-slate-100/80",
                      )}
                      style={{
                        width:
                          `${option.percentage}%`,
                      }}
                    />

                    <div className="relative flex items-center gap-3">
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold",
                          selected
                            ? "border-violet-500 bg-violet-600 text-white"
                            : "border-slate-200 bg-white text-slate-500",
                        )}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : selected ? (
                          <Check className="size-4" />
                        ) : (
                          option.position +
                          1
                        )}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-words text-sm font-semibold sm:text-base">
                            {option.label}
                          </span>

                          {selected && (
                            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                              Your vote
                            </span>
                          )}

                          {leading && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              <Trophy className="size-3" />
                              Leading
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span>
                            {option.votes}{" "}
                            vote
                            {option.votes ===
                            1
                              ? ""
                              : "s"}
                          </span>

                          {!closed &&
                            !selected && (
                              <span>
                                · tap to
                                vote
                              </span>
                            )}

                          {!closed &&
                            selected && (
                              <span>
                                · tap
                                another
                                option to
                                change
                              </span>
                            )}
                        </div>
                      </div>

                      <span className="shrink-0 text-lg font-bold tabular-nums text-slate-800 sm:text-xl">
                        {option.percentage}
                        %
                      </span>
                    </div>
                  </button>
                );
              },
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Users className="size-3.5" />
                {poll.totalVotes}{" "}
                vote
                {poll.totalVotes === 1
                  ? ""
                  : "s"}
              </span>

              <span className="inline-flex items-center gap-1.5">
                <BarChart3 className="size-3.5" />
                Current results
              </span>
            </div>

            <p className="text-xs font-medium text-slate-600">
              {closed
                ? "Final result"
                : hasVote
                  ? "You can change your vote until the poll closes."
                  : "Pick an option — results update after your vote."}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CountdownBubble({
  poll,
  now,
}: {
  poll: PollResult;
  now: number;
}) {
  const {
    remaining,
    days,
    hours,
    minutes,
    seconds,
  } = countdownParts(
    poll.closesAt,
    now,
  );

  if (remaining <= 0) {
    return (
      <div className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Poll closed
        </p>

        <p className="mt-1 text-sm font-bold text-slate-700">
          Final results
        </p>
      </div>
    );
  }

  return (
    <div className="w-full shrink-0 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-center shadow-sm sm:w-auto">
      <p className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-500">
        <Clock3 className="size-3" />
        Time left
      </p>

      <p className="mt-1 font-mono text-lg font-bold tabular-nums text-violet-800">
        {days > 0
          ? `${days}d `
          : ""}

        {String(hours).padStart(
          2,
          "0",
        )}
        :
        {String(minutes).padStart(
          2,
          "0",
        )}
        :
        {String(seconds).padStart(
          2,
          "0",
        )}
      </p>
    </div>
  );
}

function PollConfetti() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <style>
        {`
          @keyframes pomPollConfetti {
            0%, 100% {
              transform: translate3d(0, -4px, 0) rotate(var(--poll-rotation));
              opacity: .35;
            }

            50% {
              transform: translate3d(5px, 8px, 0) rotate(calc(var(--poll-rotation) + 110deg));
              opacity: .9;
            }
          }
        `}
      </style>

      {CONFETTI.map(
        (piece, index) => (
          <span
            key={index}
            className="absolute h-2.5 w-1.5 rounded-[2px] opacity-70"
            style={
              {
                left: piece.left,
                top: piece.top,
                backgroundColor:
                  piece.color,
                animation:
                  `pomPollConfetti ${piece.duration} ease-in-out ${piece.delay} infinite`,
                "--poll-rotation":
                  piece.rotation,
              } as CSSProperties
            }
          />
        ),
      )}
    </div>
  );
}