import { createFileRoute } from "@tanstack/react-router";
import { Fragment as FragmentRow, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BellOff,
  BellRing,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { AdminAvailability } from "@/components/admin-availability";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime, formatHours } from "@/lib/format";
import {
  broadcastPush,
  getPushAdminStatus,
  type PushAdminUserHealth,
} from "@/lib/push.functions";
import { useStore } from "@/lib/store";
import type { Meeting, Profile, Rsvp } from "@/lib/types";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — POM" },
      {
        name: "description",
        content:
          "Team management, meeting scheduling and workforce time analytics for admins.",
      },
      { property: "og:title", content: "Admin Dashboard — POM" },
      {
        property: "og:description",
        content:
          "Monitor hours worked, RSVP coverage and team assignments in one place.",
      },
    ],
  }),
  component: AdminPage,
});

type AdminTab =
  | "analytics"
  | "rsvp"
  | "people"
  | "meetings"
  | "availability"
  | "push";

type QueryMetric = "unanswered" | "attending";
type QueryRule = "all" | "none" | "at-least" | "at-most" | "less-than-half";
type QueryPeriod = "next7" | "next14" | "thisMonth" | "allUpcoming";

interface PersonMeetingSummary {
  id: string;
  name: string;
  teamIds: string[];
  total: number;
  answered: number;
  unanswered: number;
  attending: number;
  notAttending: number;
  cancelled: number;
}

function effectiveTeamIds(profile: Profile) {
  if (profile.teamIds.length > 0) return profile.teamIds;
  return profile.teamId ? [profile.teamId] : [];
}

function nextOccurrence(meeting: Meeting, from: Date) {
  const occurrence = new Date(`${meeting.date}T${meeting.time}`);
  const recurrence = meeting.recurrence ?? "none";

  if (recurrence === "none") return occurrence;

  let guard = 0;
  while (occurrence < from && guard++ < 500) {
    if (recurrence === "daily") {
      occurrence.setDate(occurrence.getDate() + 1);
    } else if (recurrence === "weekly") {
      occurrence.setDate(occurrence.getDate() + 7);
    } else if (recurrence === "biweekly") {
      occurrence.setDate(occurrence.getDate() + 14);
    } else {
      occurrence.setMonth(occurrence.getMonth() + 1);
    }
  }

  return occurrence;
}

function meetingMatchesPeriod(meeting: Meeting, period: QueryPeriod, now: Date) {
  const occurrence = nextOccurrence(meeting, now);

  if (occurrence < now) return false;
  if (period === "allUpcoming") return true;

  if (period === "next7") {
    return occurrence.getTime() <= now.getTime() + 7 * 86400_000;
  }

  if (period === "next14") {
    return occurrence.getTime() <= now.getTime() + 14 * 86400_000;
  }

  return (
    occurrence.getFullYear() === now.getFullYear() &&
    occurrence.getMonth() === now.getMonth()
  );
}

function buildMeetingSummaries(
  profiles: Profile[],
  meetings: Meeting[],
  rsvps: Rsvp[],
  teamFilter: string,
  cancelledRsvpIds: ReadonlySet<string>,
): PersonMeetingSummary[] {
  return profiles
    .filter((person) => {
      if (teamFilter === "all") return true;
      return effectiveTeamIds(person).includes(teamFilter);
    })
    .map((person) => {
      const personTeams = effectiveTeamIds(person);
      const relevantMeetings = meetings.filter((meeting) => {
        if (meeting.teamId === "general") return true;

        if (teamFilter !== "all") {
          return (
            meeting.teamId === teamFilter && personTeams.includes(meeting.teamId)
          );
        }

        return personTeams.includes(meeting.teamId);
      });

      let answered = 0;
      let attending = 0;
      let notAttending = 0;
      let cancelled = 0;

      for (const meeting of relevantMeetings) {
        const response = rsvps.find(
          (rsvp) =>
            rsvp.meetingId === meeting.id && rsvp.userId === person.id,
        );

        if (!response) continue;

        answered += 1;

        if (response.status === "Attending") {
          attending += 1;
        } else if (cancelledRsvpIds.has(response.id)) {
          cancelled += 1;
        } else {
          notAttending += 1;
        }
      }

      return {
        id: person.id,
        name: person.name,
        teamIds: personTeams,
        total: relevantMeetings.length,
        answered,
        unanswered: relevantMeetings.length - answered,
        attending,
        notAttending,
        cancelled,
      };
    });
}

function attendanceStats(
  rsvps: Rsvp[],
  userId: string,
  cancelledRsvpIds: ReadonlySet<string>,
) {
  let attended = 0;
  let notAttended = 0;
  let cancelled = 0;

  for (const rsvp of rsvps) {
    if (rsvp.userId !== userId) continue;

    if (rsvp.status === "Attending") {
      attended += 1;
    } else if (cancelledRsvpIds.has(rsvp.id)) {
      cancelled += 1;
    } else {
      notAttended += 1;
    }
  }

  return { attended, notAttended, cancelled };
}

function matchesQuery(
  summary: PersonMeetingSummary,
  metric: QueryMetric,
  rule: QueryRule,
  amount: number,
) {
  if (summary.total === 0) return false;

  const value = metric === "unanswered" ? summary.unanswered : summary.attending;

  if (rule === "all") return value === summary.total;
  if (rule === "none") return value === 0;
  if (rule === "at-least") return value >= amount;
  if (rule === "at-most") return value <= amount;

  return value / summary.total < 0.5;
}

function AdminPage() {
  const store = useStore();
  const {
    currentUser,
    profiles,
    teams,
    meetings,
    rsvps,
    timeEntries,
    teamName,
    setUserTeams,
    setRole,
    createTeam,
    createMeeting,
    deleteMeeting,
  } = store;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");
  const [adminTab, setAdminTab] = useState<AdminTab>("analytics");
  const [queryMetric, setQueryMetric] = useState<QueryMetric>("unanswered");
  const [queryRule, setQueryRule] = useState<QueryRule>("at-least");
  const [queryAmount, setQueryAmount] = useState(1);
  const [queryPeriod, setQueryPeriod] = useState<QueryPeriod>("next7");
  const [queryTeam, setQueryTeam] = useState("all");
  const [cancelledRsvpIds, setCancelledRsvpIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [form, setForm] = useState({
    title: "",
    date: "",
    time: "",
    teamId: "general",
  });

  useEffect(() => {
    if (currentUser.role !== "Admin") return;

    let active = true;

    void (async () => {
      const { data, error } = await supabase.from("rsvps").select("*");

      if (error) {
        console.error("Failed to load RSVP cancellation flags:", error);
        return;
      }

      const rows = (data ?? []) as Array<{
        id: string;
        cancelled?: boolean | null;
      }>;

      if (!active) return;

      setCancelledRsvpIds(
        new Set(
          rows
            .filter((row) => row.cancelled === true)
            .map((row) => row.id),
        ),
      );
    })();

    return () => {
      active = false;
    };
  }, [currentUser.role, rsvps]);

  const activeToday = useMemo(() => {
    const today = new Date().toDateString();
    const ids = new Set(
      timeEntries
        .filter((entry) => new Date(entry.endTime).toDateString() === today)
        .map((entry) => entry.userId),
    );

    if (store.activeSession) ids.add(store.activeSession.userId);
    return ids.size;
  }, [timeEntries, store.activeSession]);

  const now = new Date();
  const next7Meetings = meetings.filter((meeting) =>
    meetingMatchesPeriod(meeting, "next7", now),
  );
  const next7Summaries = buildMeetingSummaries(
    profiles,
    next7Meetings,
    rsvps,
    "all",
    cancelledRsvpIds,
  );
  const missingRsvpCount = next7Summaries.reduce(
    (total, person) => total + person.unanswered,
    0,
  );
  const missingPeopleCount = next7Summaries.filter(
    (person) => person.unanswered > 0,
  ).length;

  const queryMeetings = meetings.filter((meeting) =>
    meetingMatchesPeriod(meeting, queryPeriod, now),
  );
  const querySummaries = buildMeetingSummaries(
    profiles,
    queryMeetings,
    rsvps,
    queryTeam,
    cancelledRsvpIds,
  );
  const queryResults = querySummaries
    .filter((summary) =>
      matchesQuery(summary, queryMetric, queryRule, queryAmount),
    )
    .sort((a, b) => {
      if (queryMetric === "unanswered") {
        return b.unanswered - a.unanswered || a.name.localeCompare(b.name);
      }

      return a.attending - b.attending || a.name.localeCompare(b.name);
    });

  const totalHours = timeEntries.reduce(
    (total, entry) => total + entry.durationMs,
    0,
  );

  if (currentUser.role !== "Admin") {
    return (
      <div className="surface-card mx-auto mt-10 max-w-md p-10 text-center">
        <ShieldAlert className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Switch to an admin account from the user menu to view this dashboard.
        </p>
      </div>
    );
  }

  function submitMeeting(event: React.FormEvent) {
    event.preventDefault();

    if (!form.title || !form.date || !form.time) return;

    createMeeting(form);
    setForm({ title: "", date: "", time: "", teamId: "general" });
    toast.success("Meeting created");
  }

  function applyPreset(metric: QueryMetric, rule: QueryRule, amount = 1) {
    setQueryMetric(metric);
    setQueryRule(rule);
    setQueryAmount(amount);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-24 md:pb-8">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organisation-wide time, attendance and team operations.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active today" value={String(activeToday)} icon={Users} />
        <Stat
          label="Hours logged"
          value={formatHours(totalHours)}
          icon={Clock}
        />
        <Stat
          label="Next 7 days"
          value={String(next7Meetings.length)}
          icon={CalendarPlus}
        />
        <Stat
          label="Missing RSVPs"
          value={String(missingRsvpCount)}
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      <Tabs
        value={adminTab}
        onValueChange={(value) => setAdminTab(value as AdminTab)}
      >
        <div className="md:hidden">
          <Label
            htmlFor="admin-section"
            className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
          >
            Admin section
          </Label>

          <Select
            value={adminTab}
            onValueChange={(value) => setAdminTab(value as AdminTab)}
          >
            <SelectTrigger
              id="admin-section"
              className="h-12 w-full rounded-2xl bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="analytics">Analytics</SelectItem>
              <SelectItem value="rsvp">RSVP Insights</SelectItem>
              <SelectItem value="people">Teams &amp; Users</SelectItem>
              <SelectItem value="meetings">Meetings</SelectItem>
              <SelectItem value="availability">Availability</SelectItem>
              <SelectItem value="push">Admin Push</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsList className="hidden w-full grid-cols-6 md:grid">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="rsvp">RSVP Insights</TabsTrigger>
          <TabsTrigger value="people">Teams &amp; Users</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="push">Admin Push</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="mt-4">
          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">Employee tracking</CardTitle>
            </CardHeader>

            <CardContent className="md:px-0">
              <div className="space-y-3 md:hidden">
                {profiles.map((profile) => {
                  const entries = timeEntries.filter(
                    (entry) => entry.userId === profile.id,
                  );
                  const hours = entries.reduce(
                    (total, entry) => total + entry.durationMs,
                    0,
                  );
                  const { attended, notAttended, cancelled } = attendanceStats(
                    rsvps,
                    profile.id,
                    cancelledRsvpIds,
                  );
                  const open = expanded === profile.id;
                  const profileTeams = effectiveTeamIds(profile);

                  return (
                    <div
                      key={profile.id}
                      className="overflow-hidden rounded-2xl border border-border"
                    >
                      <button
                        type="button"
                        className="w-full p-4 text-left"
                        onClick={() => setExpanded(open ? null : profile.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{profile.name}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {profileTeams.length > 0
                                ? profileTeams
                                    .map((id) => teamName(id))
                                    .join(", ")
                                : "Unassigned"}
                            </p>
                          </div>

                          {open ? (
                            <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                          )}
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <MiniMetric
                            label="Hours"
                            value={formatHours(hours)}
                          />
                          <MiniMetric
                            label="Attended"
                            value={String(attended)}
                            tone="success"
                          />
                          <MiniMetric
                            label="Not attended"
                            value={String(notAttended)}
                            tone="warning"
                          />
                          <MiniMetric
                            label="Cancelled"
                            value={String(cancelled)}
                            tone="danger"
                          />
                        </div>
                      </button>

                      {open && (
                        <div className="border-t border-border bg-muted/30 p-4">
                          {entries.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              No work notes logged yet.
                            </p>
                          ) : (
                            <ul className="space-y-3">
                              {entries.map((entry) => (
                                <li key={entry.id} className="text-sm">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium">
                                      {formatDateTime(entry.startTime)}
                                    </span>
                                    <Badge variant="secondary">
                                      {formatHours(entry.durationMs)}
                                    </Badge>
                                  </div>
                                  <p className="mt-1 text-muted-foreground">
                                    {entry.description}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Employee</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead className="text-right">Attended</TableHead>
                      <TableHead className="text-right">Not attended</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {profiles.map((profile) => {
                      const entries = timeEntries.filter(
                        (entry) => entry.userId === profile.id,
                      );
                      const hours = entries.reduce(
                        (total, entry) => total + entry.durationMs,
                        0,
                      );
                      const { attended, notAttended, cancelled } =
                        attendanceStats(
                          rsvps,
                          profile.id,
                          cancelledRsvpIds,
                        );
                      const open = expanded === profile.id;
                      const profileTeams = effectiveTeamIds(profile);

                      return (
                        <FragmentRow key={profile.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpanded(open ? null : profile.id)
                            }
                          >
                            <TableCell>
                              {open ? (
                                <ChevronDown className="size-4" />
                              ) : (
                                <ChevronRight className="size-4" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              {profile.name}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {profileTeams.length > 0
                                ? profileTeams
                                    .map((id) => teamName(id))
                                    .join(", ")
                                : "Unassigned"}
                            </TableCell>
                            <TableCell className="tabular text-right">
                              {formatHours(hours)}
                            </TableCell>
                            <TableCell className="tabular text-right text-success">
                              {attended}
                            </TableCell>
                            <TableCell className="tabular text-right text-warning">
                              {notAttended}
                            </TableCell>
                            <TableCell className="tabular text-right text-destructive">
                              {cancelled}
                            </TableCell>
                          </TableRow>

                          {open && (
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                              <TableCell colSpan={7}>
                                {entries.length === 0 ? (
                                  <p className="py-2 text-sm text-muted-foreground">
                                    No work notes logged yet.
                                  </p>
                                ) : (
                                  <ul className="space-y-3 py-2">
                                    {entries.map((entry) => (
                                      <li key={entry.id} className="text-sm">
                                        <span className="font-medium">
                                          {formatDateTime(entry.startTime)}
                                        </span>
                                        <span className="tabular ml-2 text-muted-foreground">
                                          {formatHours(entry.durationMs)}
                                        </span>
                                        <p className="text-muted-foreground">
                                          {entry.description}
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </FragmentRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rsvp" className="mt-4">
          <RsvpInsightsPanel
            teams={teams}
            teamName={teamName}
            queryMetric={queryMetric}
            queryRule={queryRule}
            queryAmount={queryAmount}
            queryPeriod={queryPeriod}
            queryTeam={queryTeam}
            queryResults={queryResults}
            meetingsInScope={queryMeetings.length}
            missingRsvpCount={missingRsvpCount}
            missingPeopleCount={missingPeopleCount}
            setQueryMetric={setQueryMetric}
            setQueryRule={setQueryRule}
            setQueryAmount={setQueryAmount}
            setQueryPeriod={setQueryPeriod}
            setQueryTeam={setQueryTeam}
            applyPreset={applyPreset}
          />
        </TabsContent>

        <TabsContent
          value="people"
          className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]"
        >
          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">
                Assign users to teams
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {profiles.map((profile) => {
                const profileTeams = effectiveTeamIds(profile);

                return (
                  <div
                    key={profile.id}
                    className="flex flex-col gap-4 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">
                        {profile.name}
                      </p>
                      <p className="mt-0.5 break-all text-xs text-muted-foreground">
                        {profile.email}
                      </p>
                    </div>

                    <div className="grid w-full grid-cols-1 gap-3 sm:flex sm:w-auto sm:shrink-0 sm:items-end sm:gap-2">
                      <div className="space-y-1.5 sm:space-y-0">
                        <Label className="text-xs text-muted-foreground sm:sr-only">
                          Teams
                        </Label>

                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="w-full justify-between font-normal sm:w-44"
                            >
                              <span className="truncate">
                                {profileTeams.length === 0
                                  ? "Unassigned"
                                  : profileTeams.length === 1
                                    ? teamName(profileTeams[0]!)
                                    : `${profileTeams.length} teams`}
                              </span>
                              <ChevronDown className="size-4 opacity-60" />
                            </Button>
                          </PopoverTrigger>

                          <PopoverContent
                            align="start"
                            className="w-64 space-y-2 p-3"
                          >
                            <p className="text-xs font-medium text-muted-foreground">
                              Teams
                            </p>

                            {teams.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                No teams yet.
                              </p>
                            )}

                            {teams.map((team) => {
                              const checked = profileTeams.includes(team.id);

                              return (
                                <label
                                  key={team.id}
                                  className="flex cursor-pointer items-center gap-2 text-sm"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(value) =>
                                      setUserTeams(
                                        profile.id,
                                        value
                                          ? [...profileTeams, team.id]
                                          : profileTeams.filter(
                                              (id) => id !== team.id,
                                            ),
                                      )
                                    }
                                  />
                                  <span className="truncate">{team.name}</span>
                                </label>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-1.5 sm:space-y-0">
                        <Label className="text-xs text-muted-foreground sm:sr-only">
                          Role
                        </Label>

                        <Select
                          value={profile.role}
                          onValueChange={(value) =>
                            setRole(profile.id, value as "Admin" | "User")
                          }
                        >
                          <SelectTrigger className="w-full sm:w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="User">User</SelectItem>
                            <SelectItem value="Admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="surface-card h-fit">
            <CardHeader>
              <CardTitle className="text-base">Teams</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {teams.map((team) => (
                  <li
                    key={team.id}
                    className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-sm"
                  >
                    <span className="truncate">{team.name}</span>
                    <Badge variant="secondary">
                      {
                        profiles.filter((profile) =>
                          effectiveTeamIds(profile).includes(team.id),
                        ).length
                      }
                    </Badge>
                  </li>
                ))}
              </ul>

              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!newTeam.trim()) return;

                  createTeam(newTeam.trim());
                  setNewTeam("");
                  toast.success("Team created");
                }}
              >
                <Input
                  placeholder="New team name"
                  value={newTeam}
                  onChange={(event) => setNewTeam(event.target.value)}
                />
                <Button type="submit" className="sm:w-auto">
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent
          value="meetings"
          className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]"
        >
          <Card className="surface-card h-fit">
            <CardHeader>
              <CardTitle className="text-base">Create meeting</CardTitle>
            </CardHeader>

            <CardContent>
              <form className="space-y-4" onSubmit={submitMeeting}>
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={form.title}
                    onChange={(event) =>
                      setForm({ ...form, title: event.target.value })
                    }
                    placeholder="Quarterly planning"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="date">Date</Label>
                    <Input
                      id="date"
                      type="date"
                      value={form.date}
                      onChange={(event) =>
                        setForm({ ...form, date: event.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="time">Time</Label>
                    <Input
                      id="time"
                      type="time"
                      value={form.time}
                      onChange={(event) =>
                        setForm({ ...form, time: event.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select
                    value={form.teamId}
                    onValueChange={(value) =>
                      setForm({ ...form, teamId: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">
                        General (everyone)
                      </SelectItem>
                      {teams.map((team) => (
                        <SelectItem key={team.id} value={team.id}>
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button type="submit" className="w-full">
                  <CalendarPlus className="size-4" />
                  Schedule meeting
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">All meetings</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {meetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {meeting.title}
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {meeting.date} · {meeting.time} ·{" "}
                      {teamName(
                        meeting.teamId === "general"
                          ? "general"
                          : meeting.teamId,
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
                    <Badge variant="secondary">
                      {
                        rsvps.filter(
                          (rsvp) =>
                            rsvp.meetingId === meeting.id &&
                            rsvp.status === "Attending",
                        ).length
                      }{" "}
                      in
                    </Badge>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMeeting(meeting.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="availability" className="mt-4">
          <AdminAvailability />
        </TabsContent>

        <TabsContent value="push" className="mt-4">
          <AdminPushPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RsvpInsightsPanel({
  teams,
  teamName,
  queryMetric,
  queryRule,
  queryAmount,
  queryPeriod,
  queryTeam,
  queryResults,
  meetingsInScope,
  missingRsvpCount,
  missingPeopleCount,
  setQueryMetric,
  setQueryRule,
  setQueryAmount,
  setQueryPeriod,
  setQueryTeam,
  applyPreset,
}: {
  teams: { id: string; name: string }[];
  teamName: (id: string | null) => string;
  queryMetric: QueryMetric;
  queryRule: QueryRule;
  queryAmount: number;
  queryPeriod: QueryPeriod;
  queryTeam: string;
  queryResults: PersonMeetingSummary[];
  meetingsInScope: number;
  missingRsvpCount: number;
  missingPeopleCount: number;
  setQueryMetric: (value: QueryMetric) => void;
  setQueryRule: (value: QueryRule) => void;
  setQueryAmount: (value: number) => void;
  setQueryPeriod: (value: QueryPeriod) => void;
  setQueryTeam: (value: string) => void;
  applyPreset: (metric: QueryMetric, rule: QueryRule, amount?: number) => void;
}) {
  const usesAmount =
    queryRule === "at-least" ||
    queryRule === "at-most";

  return (
    <Card className="surface-card overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="size-5 text-primary" />
              RSVP Insights
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Find members by their RSVP and attendance status.
            </p>
          </div>

          <div className="rounded-2xl bg-warning/10 px-4 py-3 text-sm">
            <span className="font-semibold text-warning">
              {missingRsvpCount}
            </span>{" "}
            missing RSVPs from{" "}
            <span className="font-semibold">
              {missingPeopleCount}
            </span>{" "}
            people in the next 7 days
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div>
          <Label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Quick queries
          </Label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("unanswered", "all")}
            >
              No answers
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("unanswered", "at-least", 1)}
            >
              Missing 1+
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("unanswered", "at-least", 2)}
            >
              Missing 2+
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("unanswered", "none")}
            >
              Answered all
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("attending", "none")}
            >
              Attend none
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => applyPreset("attending", "at-most", 1)}
            >
              Attend ≤1
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() =>
                applyPreset("attending", "less-than-half")
              }
            >
              Attend &lt;50%
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-2">
            <Label>Period</Label>
            <Select
              value={queryPeriod}
              onValueChange={(value) =>
                setQueryPeriod(value as QueryPeriod)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="next7">Next 7 days</SelectItem>
                <SelectItem value="next14">Next 14 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="allUpcoming">All upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Team</Label>
            <Select value={queryTeam} onValueChange={setQueryTeam}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Metric</Label>
            <Select
              value={queryMetric}
              onValueChange={(value) =>
                setQueryMetric(value as QueryMetric)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unanswered">Unanswered</SelectItem>
                <SelectItem value="attending">Attending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Condition</Label>
            <Select
              value={queryRule}
              onValueChange={(value) =>
                setQueryRule(value as QueryRule)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {queryMetric === "unanswered"
                    ? "All meetings"
                    : "Attend all"}
                </SelectItem>

                <SelectItem value="none">
                  {queryMetric === "unanswered"
                    ? "None"
                    : "Attend none"}
                </SelectItem>

                <SelectItem value="at-least">At least</SelectItem>
                <SelectItem value="at-most">At most</SelectItem>
                <SelectItem value="less-than-half">
                  Less than 50%
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Number</Label>
            <Input
              type="number"
              min={0}
              disabled={!usesAmount}
              value={usesAmount ? queryAmount : ""}
              placeholder="—"
              onChange={(event) =>
                setQueryAmount(
                  Math.max(0, Number(event.target.value) || 0),
                )
              }
            />
          </div>
        </div>

        <div className="border-t border-border pt-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {queryResults.length}{" "}
                {queryResults.length === 1 ? "person" : "people"} found
              </p>

              <p className="mt-0.5 text-xs text-muted-foreground">
                {meetingsInScope} meeting
                {meetingsInScope === 1 ? "" : "s"} in scope
              </p>
            </div>

            {queryResults.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full gap-2 rounded-full sm:w-auto"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      queryResults
                        .map((person) => person.name)
                        .join("\n"),
                    );

                    toast.success("Names copied");
                  } catch {
                    toast.error("Could not copy names");
                  }
                }}
              >
                <Copy className="size-4" />
                Copy names
              </Button>
            )}
          </div>

          {queryResults.length === 0 ? (
            <div className="rounded-2xl bg-muted/50 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nobody matches this query.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {queryResults.map((person) => (
                <div
                  key={person.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">
                      {person.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {person.teamIds
                        .map((id) => teamName(id))
                        .join(", ") || "Unassigned"}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge
                      variant={
                        queryMetric === "unanswered"
                          ? "outline"
                          : "secondary"
                      }
                      className="rounded-full"
                    >
                      {queryMetric === "unanswered"
                        ? `${person.unanswered} / ${person.total} unanswered`
                        : `${person.attending} / ${person.total} attending`}
                    </Badge>

                    <span className="text-xs text-muted-foreground">
                      {person.attending} attending ·{" "}
                      {person.notAttending} not attending ·{" "}
                      {person.cancelled} cancelled
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-4 text-xs text-muted-foreground">
            Current meeting RSVPs are stored per meeting series, so a recurring
            meeting is counted once using its next occurrence.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  tone?: "warning";
}) {
  return (
    <div className="surface-card flex min-w-0 flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div
        className={`grid size-9 shrink-0 place-items-center rounded-xl sm:size-10 ${
          tone === "warning"
            ? "bg-warning/20 text-warning"
            : "bg-accent text-accent-foreground"
        }`}
      >
        <Icon className="size-4 sm:size-5" />
      </div>

      <div className="min-w-0">
        <p className="text-[10px] uppercase leading-tight tracking-wide text-muted-foreground sm:text-xs">
          {label}
        </p>
        <p className="tabular mt-1 truncate text-lg font-semibold sm:text-xl">
          {value}
        </p>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>

      <p
        className={`tabular mt-1 font-semibold ${
          tone === "success"
            ? "text-success"
            : tone === "warning"
              ? "text-warning"
              : tone === "danger"
                ? "text-destructive"
                : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function emptyPushHealth(
  userId: string,
): PushAdminUserHealth {
  return {
    userId,
    status: "no_push",
    registeredDevices: 0,
    workingDevices: 0,
    failingDevices: 0,
    untestedDevices: 0,
    reportingClients: 0,
    blockedClients: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureStatus: null,
    lastFailureMessage: null,
    lastPermission: null,
    lastPermissionAt: null,
  };
}

function visiblePushStatus(
  health: PushAdminUserHealth,
): PushAdminUserHealth["status"] {
  /*
   * Browser permission is newer/more authoritative
   * than an older successful delivery.
   */
  if (
    health.reportingClients > 0 &&
    health.blockedClients > 0 &&
    health.blockedClients === health.reportingClients &&
    health.lastPermission !== "granted"
  ) {
    return "blocked";
  }

  return health.status;
}

function pushStatusLabel(
  status: PushAdminUserHealth["status"],
) {
  if (status === "working") return "Working";
  if (status === "blocked") return "Blocked";
  if (status === "failing") return "Failing";
  if (status === "untested") return "Untested";

  return "No Push";
}

function pushStatusBadgeClass(
  status: PushAdminUserHealth["status"],
) {
  if (status === "working") {
    return "border-success/30 bg-success/10 text-success";
  }

  if (
    status === "blocked" ||
    status === "failing"
  ) {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }

  if (status === "untested") {
    return "border-warning/30 bg-warning/10 text-warning";
  }

  return "border-border bg-muted text-muted-foreground";
}

function pushStatusCardClass(
  status: PushAdminUserHealth["status"],
) {
  if (status === "working") {
    return "border-success/20 bg-success/[0.03]";
  }

  if (
    status === "blocked" ||
    status === "failing"
  ) {
    return "border-destructive/25 bg-destructive/[0.03]";
  }

  if (status === "untested") {
    return "border-warning/25 bg-warning/[0.03]";
  }

  return "border-border";
}

function healthTime(
  value: string | null,
) {
  return value
    ? formatDateTime(value)
    : "Never";
}

function AdminPushPanel() {
  const { profiles } =
    useStore();

  const [title, setTitle] =
    useState("");

  const [body, setBody] =
    useState("");

  const [sending, setSending] =
    useState(false);

  const [
    loadingStatus,
    setLoadingStatus,
  ] =
    useState(true);

  const [
    enabledUserIds,
    setEnabledUserIds,
  ] =
    useState<string[]>([]);

  const [
    userStatuses,
    setUserStatuses,
  ] =
    useState<PushAdminUserHealth[]>([]);

  const [
    workingWindowDays,
    setWorkingWindowDays,
  ] =
    useState(30);

  const [
    recipientMode,
    setRecipientMode,
  ] =
    useState<"all" | "selected">("all");

  const [
    selectedUserIds,
    setSelectedUserIds,
  ] =
    useState<string[]>([]);

  const send =
    useServerFn(broadcastPush);

  const getStatus =
    useServerFn(getPushAdminStatus);

  useEffect(() => {
    let active =
      true;

    setLoadingStatus(true);

    getStatus()
      .then((result) => {
        if (!active) return;

        setEnabledUserIds(
          result.enabledUserIds,
        );

        setUserStatuses(
          result.userStatuses,
        );

        setWorkingWindowDays(
          result.workingWindowDays,
        );
      })
      .catch(() => {
        if (!active) return;

        toast.error(
          "Could not load notification status",
        );
      })
      .finally(() => {
        if (active) {
          setLoadingStatus(false);
        }
      });

    return () => {
      active =
        false;
    };
  }, [getStatus]);

  const enabledSet =
    useMemo(
      () =>
        new Set(enabledUserIds),
      [enabledUserIds],
    );

  const healthByUser =
    useMemo(
      () =>
        new Map(
          userStatuses.map((status) => [
            status.userId,
            status,
          ]),
        ),
      [userStatuses],
    );

  const enabledProfiles =
    useMemo(
      () =>
        profiles
          .filter((profile) =>
            enabledSet.has(profile.id),
          )
          .sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
      [profiles, enabledSet],
    );

  const profileHealth =
    useMemo(() => {
      const priority:
        Record<
          PushAdminUserHealth["status"],
          number
        > = {
        blocked: 0,
        failing: 1,
        no_push: 2,
        untested: 3,
        working: 4,
      };

      return profiles
        .map((profile) => {
          const health =
            healthByUser.get(profile.id) ??
            emptyPushHealth(profile.id);

          const status =
            visiblePushStatus(health);

          return {
            profile,
            health,
            status,
          };
        })
        .sort(
          (a, b) =>
            priority[a.status] -
              priority[b.status] ||
            a.profile.name.localeCompare(
              b.profile.name,
            ),
        );
    }, [profiles, healthByUser]);

  const statusCounts =
    useMemo(() => {
      const result = {
        working: 0,
        blocked: 0,
        failing: 0,
        untested: 0,
        no_push: 0,
      };

      for (const item of profileHealth) {
        result[item.status] += 1;
      }

      return result;
    }, [profileHealth]);

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    !sending &&
    (
      recipientMode === "all" ||
      selectedUserIds.length > 0
    );

  function toggleUser(
    userId: string,
  ) {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter(
            (id) => id !== userId,
          )
        : [...current, userId],
    );
  }

  async function refreshStatus(
    showError = false,
  ) {
    setLoadingStatus(true);

    try {
      const result =
        await getStatus();

      setEnabledUserIds(
        result.enabledUserIds,
      );

      setUserStatuses(
        result.userStatuses,
      );

      setWorkingWindowDays(
        result.workingWindowDays,
      );

      const enabled =
        new Set(
          result.enabledUserIds,
        );

      setSelectedUserIds((current) =>
        current.filter((id) =>
          enabled.has(id),
        ),
      );
    } catch {
      if (showError) {
        toast.error(
          "Could not refresh notification status",
        );
      }
    } finally {
      setLoadingStatus(false);
    }
  }

  return (
    <Card className="surface-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4 text-primary" />
          Push notifications
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold">
                Push health
              </p>

              <p className="mt-1 text-sm text-muted-foreground">
                Browser permission, registration and recent Push delivery
                health for every user.
              </p>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full rounded-full sm:w-auto"
              disabled={loadingStatus}
              onClick={() =>
                void refreshStatus(true)
              }
            >
              {loadingStatus
                ? "Checking…"
                : "Refresh status"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-2xl border border-success/20 bg-success/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Working
              </p>
              <p className="mt-1 text-xl font-semibold text-success">
                {statusCounts.working}
              </p>
            </div>

            <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Blocked
              </p>
              <p className="mt-1 text-xl font-semibold text-destructive">
                {statusCounts.blocked}
              </p>
            </div>

            <div className="rounded-2xl border border-destructive/20 bg-destructive/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Failing
              </p>
              <p className="mt-1 text-xl font-semibold text-destructive">
                {statusCounts.failing}
              </p>
            </div>

            <div className="rounded-2xl border border-warning/20 bg-warning/[0.04] p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Untested
              </p>
              <p className="mt-1 text-xl font-semibold text-warning">
                {statusCounts.untested}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                No Push
              </p>
              <p className="mt-1 text-xl font-semibold">
                {statusCounts.no_push}
              </p>
            </div>
          </div>

          {loadingStatus &&
          userStatuses.length === 0 ? (
            <p className="rounded-2xl bg-muted/40 p-4 text-sm text-muted-foreground">
              Checking notification health…
            </p>
          ) : (
            <div className="space-y-2">
              {profileHealth.map(
                ({
                  profile,
                  health,
                  status,
                }) => {
                  const StatusIcon =
                    status === "working"
                      ? BellRing
                      : status === "blocked" ||
                          status === "no_push"
                        ? BellOff
                        : AlertTriangle;

                  return (
                    <div
                      key={profile.id}
                      className={`rounded-2xl border p-4 ${pushStatusCardClass(
                        status,
                      )}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-full ${
                              status === "working"
                                ? "bg-success/10 text-success"
                                : status === "blocked" ||
                                    status === "failing"
                                  ? "bg-destructive/10 text-destructive"
                                  : status === "untested"
                                    ? "bg-warning/10 text-warning"
                                    : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <StatusIcon className="size-4" />
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {profile.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {profile.email}
                            </p>
                          </div>
                        </div>

                        <Badge
                          variant="outline"
                          className={`w-fit rounded-full ${pushStatusBadgeClass(
                            status,
                          )}`}
                        >
                          {pushStatusLabel(status)}
                        </Badge>
                      </div>

                      <div className="mt-3 pl-12 text-xs text-muted-foreground">
                        {status === "working" && (
                          <>
                            <p>
                              Last successful Push:{" "}
                              <span className="font-medium text-foreground">
                                {healthTime(
                                  health.lastSuccessAt,
                                )}
                              </span>
                            </p>

                            <p className="mt-1">
                              {health.registeredDevices} registered device
                              {health.registeredDevices === 1
                                ? ""
                                : "s"}
                              {health.workingDevices > 0
                                ? ` · ${health.workingDevices} recently working`
                                : ""}
                            </p>
                          </>
                        )}

                        {status === "blocked" && (
                          <>
                            <p className="text-destructive">
                              Browser notifications are blocked or no longer
                              granted.
                            </p>

                            <p className="mt-1">
                              Permission:{" "}
                              <span className="font-medium">
                                {health.lastPermission ??
                                  "blocked"}
                              </span>
                              {" · "}
                              Last browser check:{" "}
                              {healthTime(
                                health.lastPermissionAt,
                              )}
                            </p>
                          </>
                        )}

                        {status === "failing" && (
                          <>
                            <p>
                              Last failed Push:{" "}
                              <span className="font-medium text-destructive">
                                {healthTime(
                                  health.lastFailureAt,
                                )}
                              </span>

                              {health.lastFailureStatus
                                ? ` · HTTP ${health.lastFailureStatus}`
                                : ""}
                            </p>

                            {health.lastFailureMessage && (
                              <p className="mt-1 break-words text-destructive/80">
                                {health.lastFailureMessage}
                              </p>
                            )}

                            <p className="mt-1">
                              {health.registeredDevices} registered device
                              {health.registeredDevices === 1
                                ? ""
                                : "s"}
                            </p>
                          </>
                        )}

                        {status === "untested" && (
                          <>
                            <p>
                              A device is registered, but there is no recent
                              successful Push delivery.
                            </p>

                            <p className="mt-1">
                              Last attempt:{" "}
                              {healthTime(
                                health.lastAttemptAt,
                              )}
                              {" · "}
                              {health.registeredDevices} registered device
                              {health.registeredDevices === 1
                                ? ""
                                : "s"}
                            </p>
                          </>
                        )}

                        {status === "no_push" && (
                          <>
                            <p>
                              No registered notification device.
                            </p>

                            {health.lastPermissionAt && (
                              <p className="mt-1">
                                Last browser check:{" "}
                                {healthTime(
                                  health.lastPermissionAt,
                                )}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Working means at least one registered device had a Push accepted
            successfully within the last {workingWindowDays} days. Browser
            permission is updated when POM detects that the permission changed.
          </p>
        </div>

        <div className="border-t border-border pt-6">
          <p className="font-semibold">
            Send push notification
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a notification and the health list above will refresh with
            the delivery result.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Recipients</Label>
          <Select
            value={recipientMode}
            onValueChange={(value) =>
              setRecipientMode(
                value as "all" | "selected",
              )
            }
          >
            <SelectTrigger className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>

            <SelectContent>
              <SelectItem value="all">
                Everyone with notifications
              </SelectItem>
              <SelectItem value="selected">
                Choose people
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {recipientMode === "selected" && (
          <div className="rounded-2xl border border-border p-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">
                  Choose people
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Only people with a registered notification device can be
                  selected.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setSelectedUserIds(
                      enabledProfiles.map(
                        (profile) => profile.id,
                      ),
                    )
                  }
                >
                  Select all
                </Button>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelectedUserIds([])
                  }
                >
                  Clear
                </Button>
              </div>
            </div>

            {loadingStatus &&
            enabledProfiles.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Loading notification status…
              </p>
            ) : enabledProfiles.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                Nobody currently has a registered notification device.
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {enabledProfiles.map((profile) => {
                  const checked =
                    selectedUserIds.includes(
                      profile.id,
                    );

                  const health =
                    healthByUser.get(
                      profile.id,
                    ) ??
                    emptyPushHealth(
                      profile.id,
                    );

                  const status =
                    visiblePushStatus(
                      health,
                    );

                  return (
                    <label
                      key={profile.id}
                      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() =>
                          toggleUser(profile.id)
                        }
                      />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {profile.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {profile.email}
                        </p>
                      </div>

                      <Badge
                        variant="outline"
                        className={`shrink-0 rounded-full text-[10px] ${pushStatusBadgeClass(
                          status,
                        )}`}
                      >
                        {pushStatusLabel(status)}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              {selectedUserIds.length} selected
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="push-title">Title</Label>
          <Input
            id="push-title"
            maxLength={80}
            placeholder="e.g. Office closed tomorrow"
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="push-body">Description</Label>
          <Textarea
            id="push-body"
            rows={4}
            maxLength={300}
            className="resize-none rounded-2xl"
            placeholder="What do you want them to know?"
            value={body}
            onChange={(event) =>
              setBody(event.target.value)
            }
          />
        </div>

        <Button
          className="w-full rounded-full sm:w-auto"
          disabled={!canSend}
          onClick={async () => {
            setSending(true);

            try {
              const result =
                await send({
                  data: {
                    title:
                      title.trim(),
                    body:
                      body.trim(),
                    ...(recipientMode === "selected"
                      ? {
                          userIds:
                            selectedUserIds,
                        }
                      : {}),
                  },
                });

              if (result.sent > 0) {
                toast.success(
                  `Push accepted by ${result.sent} registered device${
                    result.sent === 1 ? "" : "s"
                  }`,
                );

                setTitle("");
                setBody("");
              } else {
                toast.warning(
                  "The Push was not accepted by any registered device",
                );
              }

              await refreshStatus();
            } catch {
              toast.error(
                "Could not send the Push",
              );

              await refreshStatus();
            } finally {
              setSending(false);
            }
          }}
        >
          {sending
            ? "Sending…"
            : recipientMode === "selected"
              ? `Send to ${selectedUserIds.length} ${
                  selectedUserIds.length === 1
                    ? "person"
                    : "people"
                }`
              : "Send to everyone"}
        </Button>

        <p className="text-xs text-muted-foreground">
          One person can have more than one registered device, so the number
          of delivered devices can be higher than the number of selected
          people.
        </p>
      </CardContent>
    </Card>
  );
}