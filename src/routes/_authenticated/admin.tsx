import { createFileRoute } from "@tanstack/react-router";
import { Fragment as FragmentRow } from "react";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  Clock,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useStore } from "@/lib/store";
import { formatDateTime, formatHours } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — Chrona" },
      {
        name: "description",
        content: "Team management, meeting scheduling and workforce time analytics for admins.",
      },
      { property: "og:title", content: "Admin Dashboard — Chrona" },
      {
        property: "og:description",
        content: "Monitor hours worked, RSVP coverage and team assignments in one place.",
      },
    ],
  }),
  component: AdminPage,
});

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
    assignTeam,
    setRole,
    createTeam,
    createMeeting,
    deleteMeeting,
  } = store;

  const [expanded, setExpanded] = useState<string | null>(null);
  const [newTeam, setNewTeam] = useState("");
  const [form, setForm] = useState({ title: "", date: "", time: "", teamId: "general" });

  const activeToday = useMemo(() => {
    const today = new Date().toDateString();
    const ids = new Set(
      timeEntries.filter((e) => new Date(e.endTime).toDateString() === today).map((e) => e.userId),
    );
    if (store.activeSession) ids.add(store.activeSession.userId);
    return ids.size;
  }, [timeEntries, store.activeSession]);

  const weekMeetings = useMemo(
    () =>
      meetings.filter((m) => {
        const t = new Date(`${m.date}T${m.time}`).getTime();
        return t >= Date.now() - 86400_000 && t <= Date.now() + 7 * 86400_000;
      }),
    [meetings],
  );

  const nonResponders = useMemo(
    () =>
      profiles.filter((p) =>
        weekMeetings.some(
          (m) =>
            (m.teamId === "general" || m.teamId === p.teamId) &&
            !rsvps.some((r) => r.meetingId === m.id && r.userId === p.id),
        ),
      ),
    [profiles, weekMeetings, rsvps],
  );

  const totalHours = timeEntries.reduce((a, e) => a + e.durationMs, 0);

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

  function submitMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.date || !form.time) return;
    createMeeting(form);
    setForm({ title: "", date: "", time: "", teamId: "general" });
    toast.success("Meeting created");
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Organisation-wide time, attendance and team operations.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active users today" value={String(activeToday)} icon={Users} />
        <Stat label="Total hours logged" value={formatHours(totalHours)} icon={Clock} />
        <Stat label="Meetings this week" value={String(weekMeetings.length)} icon={CalendarPlus} />
        <Stat
          label="Awaiting RSVP"
          value={String(nonResponders.length)}
          icon={AlertTriangle}
          tone="warning"
        />
      </div>

      {nonResponders.length > 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-medium">No RSVP for open meetings this week</p>
              <p className="mt-1 text-sm text-muted-foreground">
                These people haven't responded to at least one meeting they can see.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {nonResponders.map((p) => (
                  <Badge key={p.id} variant="outline" className="bg-background">
                    {p.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="analytics">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="people">Teams &amp; Users</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="mt-4">
          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">Employee tracking</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Employee</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Attended</TableHead>
                    <TableHead className="text-right">Cancelled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.map((p) => {
                    const entries = timeEntries.filter((e) => e.userId === p.id);
                    const hours = entries.reduce((a, e) => a + e.durationMs, 0);
                    const attended = rsvps.filter(
                      (r) => r.userId === p.id && r.status === "Attending",
                    ).length;
                    const declined = rsvps.filter(
                      (r) => r.userId === p.id && r.status === "Declined",
                    ).length;
                    const open = expanded === p.id;
                    return (
                      <FragmentRow key={p.id}>
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : p.id)}
                        >
                          <TableCell>
                            {open ? (
                              <ChevronDown className="size-4" />
                            ) : (
                              <ChevronRight className="size-4" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {teamName(p.teamId)}
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {formatHours(hours)}
                          </TableCell>
                          <TableCell className="tabular text-right text-success">
                            {attended}
                          </TableCell>
                          <TableCell className="tabular text-right text-destructive">
                            {declined}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow key={`${p.id}-notes`} className="bg-muted/40 hover:bg-muted/40">
                            <TableCell colSpan={6}>
                              {entries.length === 0 ? (
                                <p className="py-2 text-sm text-muted-foreground">
                                  No work notes logged yet.
                                </p>
                              ) : (
                                <ul className="space-y-3 py-2">
                                  {entries.map((e) => (
                                    <li key={e.id} className="text-sm">
                                      <span className="font-medium">
                                        {formatDateTime(e.startTime)}
                                      </span>
                                      <span className="tabular ml-2 text-muted-foreground">
                                        {formatHours(e.durationMs)}
                                      </span>
                                      <p className="text-muted-foreground">{e.description}</p>
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="people" className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">Assign users to teams</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border p-3 sm:flex sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Select
                      value={p.teamId ?? "none"}
                      onValueChange={(v) => assignTeam(p.id, v === "none" ? null : v)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {teams.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={p.role}
                      onValueChange={(v) => setRole(p.id, v as "Admin" | "User")}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="User">User</SelectItem>
                        <SelectItem value="Admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="surface-card h-fit">
            <CardHeader>
              <CardTitle className="text-base">Teams</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ul className="space-y-2">
                {teams.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
                  >
                    <span className="truncate">{t.name}</span>
                    <Badge variant="secondary">
                      {profiles.filter((p) => p.teamId === t.id).length}
                    </Badge>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTeam.trim()) return;
                  createTeam(newTeam.trim());
                  setNewTeam("");
                  toast.success("Team created");
                }}
              >
                <Input
                  placeholder="New team name"
                  value={newTeam}
                  onChange={(e) => setNewTeam(e.target.value)}
                />
                <Button type="submit">Add</Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="meetings" className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
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
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
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
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="time">Time</Label>
                    <Input
                      id="time"
                      type="time"
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Audience</Label>
                  <Select
                    value={form.teamId}
                    onValueChange={(v) => setForm({ ...form, teamId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General (everyone)</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" className="w-full">
                  <CalendarPlus className="size-4" /> Schedule meeting
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="surface-card">
            <CardHeader>
              <CardTitle className="text-base">All meetings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {meetings.map((m) => (
                <div
                  key={m.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.date} · {m.time} · {teamName(m.teamId === "general" ? "general" : m.teamId)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">
                      {rsvps.filter((r) => r.meetingId === m.id && r.status === "Attending").length}{" "}
                      in
                    </Badge>
                    <Button variant="ghost" size="icon" onClick={() => deleteMeeting(m.id)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
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
    <div className="surface-card flex items-center gap-3 p-4">
      <div
        className={`grid size-10 shrink-0 place-items-center rounded-xl ${
          tone === "warning" ? "bg-warning/20 text-warning" : "bg-accent text-accent-foreground"
        }`}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="tabular truncate text-xl font-semibold">{value}</p>
      </div>
    </div>
  );
}
