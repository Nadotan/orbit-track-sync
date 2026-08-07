import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarDays, Check, Clock, History, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Meeting } from "@/lib/types";

export const Route = createFileRoute("/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings Hub — Chrona" },
      {
        name: "description",
        content: "See who is attending your team meetings, RSVP in one tap and review history.",
      },
      { property: "og:title", content: "Meetings Hub — Chrona" },
      {
        property: "og:description",
        content: "Upcoming meetings filtered to your team, attendee lists and past meeting history.",
      },
    ],
  }),
  component: MeetingsPage,
});

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);
}

function MeetingsPage() {
  const { meetings, currentUser, setRsvp, rsvpFor, teamName, rsvps, profiles } = useStore();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const mineAll = meetings
    .filter((m) => m.teamId === "general" || m.teamId === currentUser.teamId)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));

  const upcoming = mineAll.filter((m) => new Date(`${m.date}T${m.time}`) >= startOfToday);
  const past = mineAll
    .filter((m) => new Date(`${m.date}T${m.time}`) < startOfToday)
    .reverse();

  const list = tab === "upcoming" ? upcoming : past;

  function respond(meetingId: string, status: "Attending" | "Declined") {
    setRsvp(meetingId, status);
    toast[status === "Attending" ? "success" : "warning"](
      status === "Attending" ? "You're marked as attending" : "Marked as can't attend",
    );
  }

  function peopleFor(meeting: Meeting, status: "Attending" | "Declined") {
    return rsvps
      .filter((r) => r.meetingId === meeting.id && r.status === status)
      .map((r) => profiles.find((p) => p.id === r.userId))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Meetings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          General meetings plus everything for {teamName(currentUser.teamId)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
        {(["upcoming", "past"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "bg-background text-foreground shadow-[var(--shadow-soft)]"
                : "text-muted-foreground",
            )}
          >
            {t === "upcoming" ? `Upcoming (${upcoming.length})` : `History (${past.length})`}
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <div className="surface-card rounded-3xl p-10 text-center">
          {tab === "upcoming" ? (
            <CalendarDays className="mx-auto size-8 text-muted-foreground" />
          ) : (
            <History className="mx-auto size-8 text-muted-foreground" />
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {tab === "upcoming"
              ? "No meetings for your team right now."
              : "No past meetings yet."}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((m) => {
          const mine = rsvpFor(m.id);
          const attending = peopleFor(m, "Attending");
          const declined = peopleFor(m, "Declined");
          return (
            <article key={m.id} className="surface-card flex flex-col gap-4 rounded-3xl p-5">
              <div className="min-w-0">
                <Badge
                  variant={m.teamId === "general" ? "secondary" : "outline"}
                  className="mb-2 rounded-full"
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
                </div>
              </div>

              <div className="rounded-2xl bg-muted/60 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="size-3.5" /> {attending.length} attending
                </p>
                {attending.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {attending.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center gap-1.5 rounded-full bg-background py-1 pl-1 pr-2.5 text-xs font-medium"
                      >
                        <Avatar className="size-5">
                          <AvatarFallback className="bg-primary text-[9px] text-primary-foreground">
                            {initials(p.name)}
                          </AvatarFallback>
                        </Avatar>
                        {p.name}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">No responses yet.</p>
                )}
                {declined.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Can't attend: {declined.map((p) => p.name).join(", ")}
                  </p>
                )}
              </div>

              {tab === "upcoming" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="rounded-full"
                    variant={mine?.status === "Attending" ? "default" : "outline"}
                    onClick={() => respond(m.id, "Attending")}
                  >
                    <Check className="size-4" /> Attending
                  </Button>
                  <Button
                    className="rounded-full"
                    variant={mine?.status === "Declined" ? "destructive" : "outline"}
                    onClick={() => respond(m.id, "Declined")}
                  >
                    <X className="size-4" /> Can't attend
                  </Button>
                </div>
              ) : (
                <p className="text-xs font-medium text-muted-foreground">
                  You:{" "}
                  <span
                    className={
                      mine?.status === "Attending"
                        ? "text-success"
                        : mine?.status === "Declined"
                          ? "text-destructive"
                          : ""
                    }
                  >
                    {mine ? (mine.status === "Attending" ? "Attended" : "Didn't attend") : "No response"}
                  </span>
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
