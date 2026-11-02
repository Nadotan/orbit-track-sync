
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Clock3, Sparkles, Vote } from "lucide-react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface ActivePollSummary {
  id: string;
  closesAt: string;
  userOptionId: string | null;
}

const POLL_CACHE_MS = 5 * 60_000;

async function fetchActivePollSummary(): Promise<ActivePollSummary[]> {
  const nowIso = new Date().toISOString();
  const { data: activeRows, error: pollsError } = await supabase
    .from("polls")
    .select("id, closes_at")
    .lte("published_at", nowIso)
    .gt("closes_at", nowIso)
    .order("closes_at", { ascending: true });

  if (pollsError) throw pollsError;
  if (!activeRows?.length) return [];

  const { data: voteRows, error: votesError } = await supabase
    .from("poll_votes")
    .select("poll_id, option_id")
    .in("poll_id", activeRows.map((poll) => poll.id));

  if (votesError) throw votesError;

  const ownVotes = new Map(
    (voteRows ?? []).map((vote) => [vote.poll_id, vote.option_id]),
  );

  return activeRows.map((poll) => ({
    id: poll.id,
    closesAt: poll.closes_at,
    userOptionId: ownVotes.get(poll.id) ?? null,
  }));
}

function countdownText(target: string, now: number) {
  const remaining = Math.max(0, new Date(target).getTime() - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");

  return days > 0 ? `${days}d ${clock}` : clock;
}

export function ActivePollButton() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { currentUser } = useStore();
  const queryClient = useQueryClient();
  const onPollsPage = pathname === "/polls";
  const queryKey = ["pom-active-poll-button", currentUser.id];
  const [now, setNow] = useState(() => Date.now());

  // Query caching avoids re-reading the same two tables on every route change.
  // The user ID in the key prevents data reuse after account changes.
  const { data: polls = [], error } = useQuery({
    queryKey,
    queryFn: fetchActivePollSummary,
    enabled: !onPollsPage,
    staleTime: POLL_CACHE_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  useEffect(() => {
    if (error) console.error("[polls] Could not load active poll button", error);
  }, [error]);

  const hasActivePolls = polls.some(
    (poll) => new Date(poll.closesAt).getTime() > now,
  );

  // Poll expiry updates the countdown locally, with no database requests.
  useEffect(() => {
    if (onPollsPage || !hasActivePolls) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [onPollsPage, hasActivePolls]);

  useEffect(() => {
    if (onPollsPage) return;

    let refreshTimer: number | null = null;
    const refresh = () => {
      // A local mutation and a realtime event can arrive together. Reload once.
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void queryClient.invalidateQueries({
          queryKey: ["pom-active-poll-button", currentUser.id],
        });
      }, 300);
    };

    const channel = supabase
      .channel("active-poll-button")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "polls" },
        refresh,
      )
      .subscribe();

    window.addEventListener("pom:polls-changed", refresh);
    return () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("pom:polls-changed", refresh);
      void supabase.removeChannel(channel);
    };
  }, [onPollsPage, currentUser.id, queryClient]);

  // A vote can be cast while the Polls page hides this button. Mark its cached
  // summary stale so it refetches on return only when something changed.
  useEffect(() => {
    if (!onPollsPage) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: ["pom-active-poll-button", currentUser.id],
        refetchType: "none",
      });
    };
    window.addEventListener("pom:polls-changed", invalidate);
    return () => window.removeEventListener("pom:polls-changed", invalidate);
  }, [onPollsPage, currentUser.id, queryClient]);

  const activePolls = useMemo(
    () => polls
      .filter((poll) => new Date(poll.closesAt).getTime() > now)
      .sort((a, b) =>
        new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime(),
      ),
    [polls, now],
  );

  if (onPollsPage || activePolls.length === 0) return null;

  const poll = activePolls.find((item) => item.userOptionId === null) ?? activePolls[0];
  if (!poll) return null;
  const needsVote = poll.userOptionId === null;

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
            needsVote && "ring-2 ring-primary/20",
          )}
          onClick={() => navigate({ to: "/polls", search: { poll: poll.id } })}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm">
            {needsVote ? <Sparkles className="size-4" /> : <Vote className="size-4" />}
          </span>
          <span className="min-w-0 text-left">
            <span className="flex items-center gap-2">
              <span className="truncate text-xs font-semibold sm:text-sm">
                {needsVote ? "New poll" : "Poll is live"}
              </span>
              {activePolls.length > 1 && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  +{activePolls.length - 1}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground sm:text-xs">
              <Clock3 className="size-3" />
              <span className="font-mono tabular-nums">{countdownText(poll.closesAt, now)}</span>
              <span>left</span>
            </span>
          </span>
        </Button>
      </div>
    </div>
  );
}
