import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Play, Square, NotebookPen, Clock, CalendarClock, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { formatDuration, formatHours, formatDateTime } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Time Tracker — Chrona" },
      {
        name: "description",
        content: "Clock in, clock out and log what you worked on with a live circular timer.",
      },
      { property: "og:title", content: "Time Tracker — Chrona" },
      {
        property: "og:description",
        content: "A live work timer with daily task notes and a timeline of recent entries.",
      },
    ],
  }),
  component: TrackerPage,
});

function TrackerPage() {
  const { currentUser, activeSession, startSession, stopSession, timeEntries } = useStore();
  const [now, setNow] = useState(() => Date.now());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [description, setDescription] = useState("");

  const running = activeSession?.userId === currentUser.id;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running ? now - new Date(activeSession!.startTime).getTime() : 0;

  const myEntries = useMemo(
    () => timeEntries.filter((e) => e.userId === currentUser.id),
    [timeEntries, currentUser.id],
  );

  const todayMs = myEntries
    .filter((e) => new Date(e.endTime).toDateString() === new Date().toDateString())
    .reduce((a, e) => a + e.durationMs, 0);
  const weekMs = myEntries
    .filter((e) => Date.now() - new Date(e.endTime).getTime() < 7 * 86400_000)
    .reduce((a, e) => a + e.durationMs, 0);

  function handleStop() {
    if (!description.trim()) return;
    stopSession(description.trim());
    setDescription("");
    setDialogOpen(false);
    toast.success("Time entry saved");
  }

  // circle progress: one full sweep per hour
  const R = 132;
  const CIRC = 2 * Math.PI * R;
  const progress = running ? ((elapsed / 1000) % 3600) / 3600 : 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <div className="text-center sm:text-left">
        <h1 className="text-2xl font-semibold sm:text-3xl">The Clock</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {running
            ? "You're on the clock. Tap stop when you're done."
            : "Tap start when you begin working."}
        </p>
      </div>

      <div className="surface-card flex flex-col items-center gap-6 rounded-[2rem] p-6 sm:p-10">
        <div className="relative grid place-items-center">
          <svg width="304" height="304" viewBox="0 0 304 304" className="max-w-full -rotate-90">
            <circle
              cx="152"
              cy="152"
              r={R}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="18"
            />
            <circle
              cx="152"
              cy="152"
              r={R}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="18"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - progress)}
              style={{ transition: "stroke-dashoffset 0.6s linear" }}
            />
          </svg>

          <div className="absolute flex flex-col items-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-widest ${
                running ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${running ? "animate-pulse bg-primary" : "bg-muted-foreground"}`}
              />
              {running ? "Working" : "Idle"}
            </span>
            <p className="tabular mt-3 font-mono text-4xl font-bold sm:text-5xl">
              {formatDuration(elapsed)}
            </p>
            <p className="mt-1 max-w-[12rem] text-center text-xs text-muted-foreground">
              {running
                ? `Started ${new Date(activeSession!.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : "Hours : minutes : seconds"}
            </p>
          </div>
        </div>

        {running ? (
          <Button
            size="lg"
            variant="destructive"
            className="h-14 w-full max-w-xs rounded-full text-base"
            onClick={() => setDialogOpen(true)}
          >
            <Square className="size-5" /> Stop work
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-14 w-full max-w-xs rounded-full text-base"
            onClick={() => {
              startSession();
              setNow(Date.now());
            }}
          >
            <Play className="size-5" /> Start work
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Clock} label="Today" value={formatHours(todayMs + elapsed)} />
        <StatCard icon={CalendarClock} label="Last 7 days" value={formatHours(weekMs)} />
        <StatCard icon={Flame} label="Entries logged" value={String(myEntries.length)} />
      </div>

      <Card className="surface-card rounded-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <NotebookPen className="size-4 text-primary" /> Your history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {myEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No time entries yet — start your first session above.
            </p>
          ) : (
            <ol className="relative space-y-5 border-l border-border pl-6">
              {myEntries.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background bg-primary" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{formatDateTime(e.startTime)}</span>
                    <Badge variant="secondary" className="tabular rounded-full">
                      {formatHours(e.durationMs)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-3xl">
          <DialogHeader>
            <DialogTitle>What did you work on?</DialogTitle>
            <DialogDescription>
              Session length {formatDuration(elapsed)} — add a short summary to save this entry.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={5}
            className="resize-none rounded-2xl bg-muted/50 p-4 text-base leading-relaxed shadow-inner focus-visible:ring-2"
            placeholder="e.g. Fixed the onboarding flow, reviewed PRs, planned next sprint…"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setDialogOpen(false)}
            >
              Keep tracking
            </Button>
            <Button className="rounded-full" onClick={handleStop} disabled={!description.trim()}>
              Save entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="surface-card flex items-center gap-3 rounded-2xl p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="tabular truncate text-xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
