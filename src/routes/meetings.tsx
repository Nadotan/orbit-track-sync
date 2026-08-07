import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Check, Clock, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { toast } from "sonner";

export const Route = createFileRoute("/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings Hub — Chrona" },
      {
        name: "description",
        content: "See general and team meetings, and RSVP in one tap.",
      },
      { property: "og:title", content: "Meetings Hub — Chrona" },
      {
        property: "og:description",
        content: "Upcoming meetings filtered to your team, with instant RSVP.",
      },
    ],
  }),
  component: MeetingsPage,
});

function MeetingsPage() {
  const { meetings, currentUser, setRsvp, rsvpFor, teamName, rsvps } = useStore();

  const visible = meetings
    .filter((m) => m.teamId === "general" || m.teamId === currentUser.teamId)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  function respond(meetingId: string, status: "Attending" | "Declined") {
    setRsvp(meetingId, status);
    toast[status === "Attending" ? "success" : "warning"](
      status === "Attending" ? "You're marked as attending" : "Admin notified you can't attend",
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold sm:text-3xl">Meetings Hub</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            General meetings plus everything for {teamName(currentUser.teamId)}.
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {visible.length} upcoming
        </Badge>
      </div>

      {visible.length === 0 && (
        <div className="surface-card p-10 text-center">
          <CalendarDays className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No meetings for your team right now.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {visible.map((m) => {
          const mine = rsvpFor(m.id);
          const attending = rsvps.filter(
            (r) => r.meetingId === m.id && r.status === "Attending",
          ).length;
          return (
            <article key={m.id} className="surface-card flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Badge
                    variant={m.teamId === "general" ? "secondary" : "outline"}
                    className="mb-2"
                  >
                    {teamName(m.teamId === "general" ? "general" : m.teamId)}
                  </Badge>
                  <h2 className="truncate text-lg font-semibold">{m.title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-4" />
                      {new Date(`${m.date}T${m.time}`).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4" />
                      {m.time}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-4" />
                      {attending} attending
                    </span>
                  </div>
                </div>
              </div>

              {mine && (
                <p className="text-xs font-medium text-muted-foreground">
                  Your response:{" "}
                  <span className={mine.status === "Attending" ? "text-success" : "text-destructive"}>
                    {mine.status === "Attending" ? "Attending" : "Can't attend"}
                  </span>
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={mine?.status === "Attending" ? "default" : "outline"}
                  onClick={() => respond(m.id, "Attending")}
                >
                  <Check className="size-4" /> Attending
                </Button>
                <Button
                  variant={mine?.status === "Declined" ? "destructive" : "outline"}
                  onClick={() => respond(m.id, "Declined")}
                >
                  <X className="size-4" /> Can't Attend
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
