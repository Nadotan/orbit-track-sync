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
        content: "Clock in, clock out and log what you worked on with a live visual timer.",
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

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">The Clock</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track your working session and note what you accomplished.
        </p>
      </div>

      <div className="hero-panel overflow-hidden rounded-3xl p-8 text-center shadow-[var(--shadow-soft)] sm:p-12">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-widest">
          <span
            className={`size-2 rounded-full ${running ? "animate-pulse bg-primary" : "bg-white/40"}`}
          />
          {running ? "Session running" : "Idle"}
        </div>

        <p className="tabular mt-6 font-mono text-5xl font-bold sm:text-7xl">
          {formatDuration(elapsed)}
        </p>
        <p className="mt-2 text-sm text-white/60">
          {running
            ? `Started at ${new Date(activeSession!.startTime).toLocaleTimeString()}`
            : "Press start when you begin working"}
        </p>

        <div className="mt-8">
          {running ? (
            <Button
              size="lg"
              variant="destructive"
              className="h-14 rounded-full px-10 text-base"
              onClick={() => setDialogOpen(true)}
            >
              <Square className="size-5" /> Stop Work
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-14 rounded-full px-10 text-base"
              onClick={() => {
                startSession();
                setNow(Date.now());
              }}
            >
              <Play className="size-5" /> Start Work
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Clock} label="Today" value={formatHours(todayMs + elapsed)} />
        <StatCard icon={CalendarClock} label="Last 7 days" value={formatHours(weekMs)} />
        <StatCard icon={Flame} label="Entries logged" value={String(myEntries.length)} />
      </div>

      <Card className="surface-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <NotebookPen className="size-4 text-primary" /> Recent entries
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
                    <Badge variant="secondary" className="tabular">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>What did you work on today?</DialogTitle>
            <DialogDescription>
              Session length {formatDuration(elapsed)} — add a short summary to save this entry.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={5}
            placeholder="e.g. Fixed the onboarding flow, reviewed PRs, planned next sprint…"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Keep tracking
            </Button>
            <Button onClick={handleStop} disabled={!description.trim()}>
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
    <div className="surface-card flex items-center gap-3 p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="tabular truncate text-xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
