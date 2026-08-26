import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import {
  useServerFn,
} from "@tanstack/react-start";

import {
  Clock3,
  Sparkles,
  Vote,
} from "lucide-react";

import {
  Button,
} from "@/components/ui/button";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  getActivePolls,
  type ActivePollsWorkspace,
} from "@/lib/polls.functions";

import {
  cn,
} from "@/lib/utils";

function countdownText(
  target: string,
  now: number,
) {
  const remaining =
    Math.max(
      0,
      new Date(
        target,
      ).getTime() -
        now,
    );

  const totalSeconds =
    Math.floor(
      remaining /
        1000,
    );

  const days =
    Math.floor(
      totalSeconds /
        86_400,
    );

  const hours =
    Math.floor(
      (
        totalSeconds %
        86_400
      ) /
        3_600,
    );

  const minutes =
    Math.floor(
      (
        totalSeconds %
        3_600
      ) /
        60,
    );

  const seconds =
    totalSeconds %
    60;

  const clock =
    [
      hours,
      minutes,
      seconds,
    ]
      .map(
        (
          value,
        ) =>
          String(
            value,
          ).padStart(
            2,
            "0",
          ),
      )
      .join(
        ":",
      );

  return days >
    0
    ? `${days}d ${clock}`
    : clock;
}

export function ActivePollButton() {
  const loadActivePolls =
    useServerFn(
      getActivePolls,
    );

  const navigate =
    useNavigate();

  const pathname =
    useRouterState({
      select:
        (
          state,
        ) =>
          state.location
            .pathname,
    });

  const [
    workspace,
    setWorkspace,
  ] =
    useState<
      ActivePollsWorkspace | null
    >(
      null,
    );

  const [
    now,
    setNow,
  ] =
    useState(
      () =>
        Date.now(),
    );

  const load =
    useCallback(
      async () => {
        try {
          setWorkspace(
            await loadActivePolls(),
          );
        } catch (
          error
        ) {
          console.error(
            "[polls] Could not load active poll button",
            error,
          );
        }
      },
      [
        loadActivePolls,
      ],
    );

  useEffect(
    () => {
      void load();
    },
    [
      load,
    ],
  );

  useEffect(
    () => {
      const timer =
        window.setInterval(
          () =>
            setNow(
              Date.now(),
            ),
          1000,
        );

      return () =>
        window.clearInterval(
          timer,
        );
    },
    [],
  );

  useEffect(
    () => {
      const channel =
        supabase
          .channel(
            "active-poll-button",
          )
          .on(
            "postgres_changes",
            {
              event:
                "*",
              schema:
                "public",
              table:
                "polls",
            },
            () => {
              void load();
            },
          )
          .subscribe();

      return () => {
        void supabase
          .removeChannel(
            channel,
          );
      };
    },
    [
      load,
    ],
  );

  useEffect(
    () => {
      function refreshOnFocus() {
        void load();
      }

      function refreshOnVisible() {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void load();
        }
      }

      window.addEventListener(
        "focus",
        refreshOnFocus,
      );

      document.addEventListener(
        "visibilitychange",
        refreshOnVisible,
      );

      return () => {
        window.removeEventListener(
          "focus",
          refreshOnFocus,
        );

        document.removeEventListener(
          "visibilitychange",
          refreshOnVisible,
        );
      };
    },
    [
      load,
    ],
  );

  const activePolls =
    useMemo(
      () =>
        (
          workspace
            ?.polls ??
          []
        )
          .filter(
            (
              poll,
            ) =>
              new Date(
                poll.closesAt,
              ).getTime() >
              now,
          )
          .sort(
            (
              a,
              b,
            ) =>
              new Date(
                a.closesAt,
              ).getTime() -
              new Date(
                b.closesAt,
              ).getTime(),
          ),
      [
        workspace
          ?.polls,
        now,
      ],
    );

  if (
    pathname ===
      "/polls" ||
    activePolls.length ===
      0
  ) {
    return null;
  }

  const poll =
    activePolls.find(
      (
        item,
      ) =>
        item.userOptionId ===
        null,
    ) ??
    activePolls[0];

  const needsVote =
    poll.userOptionId ===
    null;

  return (
    <div className="fixed bottom-24 left-4 z-40 max-w-[calc(100vw-2rem)] md:bottom-6 md:left-6">
      <div className="relative">
        {needsVote && (
          <span className="pointer-events-none absolute -inset-1 rounded-full bg-primary/20 blur-md" />
        )}

        <Button
          type="button"
          className={cn(
            "relative h-auto min-h-12 max-w-full gap-3 rounded-full border border-primary/20 bg-background/95 px-3.5 py-2.5 text-foreground shadow-xl backdrop-blur transition-transform hover:scale-[1.02] hover:bg-background",

            needsVote &&
              "ring-2 ring-primary/20",
          )}
          onClick={() =>
            navigate({
              to:
                "/polls",

              search: {
                poll:
                  poll.id,
              },
            })
          }
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
            {needsVote ? (
              <Sparkles className="size-4" />
            ) : (
              <Vote className="size-4" />
            )}
          </span>

          <span className="min-w-0 text-left">
            <span className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold sm:text-sm">
                {needsVote
                  ? "New poll"
                  : "Poll is live"}
              </span>

              {activePolls.length >
                1 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  +
                  {activePolls.length -
                    1}
                </span>
              )}
            </span>

            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground sm:text-xs">
              <Clock3 className="size-3" />

              <span className="font-mono tabular-nums">
                {countdownText(
                  poll.closesAt,
                  now,
                )}
              </span>

              <span>
                left
              </span>
            </span>
          </span>
        </Button>
      </div>
    </div>
  );
}