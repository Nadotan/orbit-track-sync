import { createFileRoute } from "@tanstack/react-router";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createServerFn,
  useServerFn,
} from "@tanstack/react-start";
import {
  CalendarDays,
  Check,
  Clock,
  History,
  Lock,
  Pencil,
  Plus,
  Repeat,
  Unlock,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  Meeting,
  Profile,
  Recurrence,
} from "@/lib/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/*
 * General meetings are organisation-wide.
 *
 * Normal Supabase RLS may intentionally hide some RSVP rows
 * from normal users, so we expose ONLY Attending users for
 * General meetings through this authenticated server function.
 *
 * Declined and unanswered information is never returned here.
 */
const getGeneralMeetingAttendees =
  createServerFn({
    method: "GET",
  })
    .middleware([
      requireSupabaseAuth,
    ])
    .handler(async () => {
      const {
        supabaseAdmin,
      } =
        await import(
          "@/integrations/supabase/client.server"
        );

      const {
        data: generalMeetings,
        error: meetingsError,
      } =
        await supabaseAdmin
          .from("meetings")
          .select("id")
          .is("team_id", null);

      if (meetingsError) {
        throw new Error(
          meetingsError.message,
        );
      }

      const meetingIds =
        (
          generalMeetings ??
          []
        ).map(
          (meeting) =>
            meeting.id,
        );

      if (
        meetingIds.length ===
        0
      ) {
        return {
          attendees: [],
        };
      }

      const {
        data: attendingRsvps,
        error: rsvpsError,
      } =
        await supabaseAdmin
          .from("rsvps")
          .select(
            "meeting_id, user_id",
          )
          .eq(
            "status",
            "Attending",
          )
          .in(
            "meeting_id",
            meetingIds,
          );

      if (rsvpsError) {
        throw new Error(
          rsvpsError.message,
        );
      }

      const userIds =
        Array.from(
          new Set(
            (
              attendingRsvps ??
              []
            ).map(
              (rsvp) =>
                rsvp.user_id,
            ),
          ),
        );

      if (
        userIds.length ===
        0
      ) {
        return {
          attendees: [],
        };
      }

      const {
        data: profiles,
        error: profilesError,
      } =
        await supabaseAdmin
          .from("profiles")
          .select("id, name")
          .in("id", userIds);

      if (profilesError) {
        throw new Error(
          profilesError.message,
        );
      }

      const nameById =
        new Map(
          (
            profiles ??
            []
          ).map(
            (profile) => [
              profile.id,
              profile.name,
            ],
          ),
        );

      return {
        attendees:
          (
            attendingRsvps ??
            []
          ).map(
            (rsvp) => ({
              meetingId:
                rsvp.meeting_id,

              userId:
                rsvp.user_id,

              name:
                nameById.get(
                  rsvp.user_id,
                ) ??
                "Unknown member",
            }),
          ),
      };
    });

type GeneralAttendee = {
  meetingId: string;
  userId: string;
  name: string;
};

type MeetingPerson =
  Pick<
    Profile,
    "id" | "name"
  >;

type MeetingGroups = {
  attending:
    MeetingPerson[];
  declined:
    MeetingPerson[];
  pending:
    MeetingPerson[];
};

export const Route =
  createFileRoute(
    "/_authenticated/meetings",
  )({
    head: () => ({
      meta: [
        {
          title:
            "Meetings Hub — POM",
        },
        {
          name: "description",
          content:
            "See who is attending your team meetings, RSVP in one tap and review history.",
        },
        {
          property:
            "og:title",
          content:
            "Meetings Hub — POM",
        },
        {
          property:
            "og:description",
          content:
            "Upcoming meetings filtered to your team, attendee lists and past meeting history.",
        },
      ],
    }),
    component:
      MeetingsPage,
  });

const RECURRENCE_LABEL: Record<
  Recurrence,
  string
> = {
  none: "One-off",
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
};

function initials(
  name: string,
) {
  return name
    .split(" ")
    .map(
      (part) =>
        part[0],
    )
    .join("")
    .slice(0, 2);
}

/*
 * Next occurrence of a possibly recurring meeting.
 */
function occurrenceOf(
  meeting: Meeting,
  from: Date,
) {
  const date =
    new Date(
      `${meeting.date}T${meeting.time}`,
    );

  const recurrence =
    meeting.recurrence ??
    "none";

  if (
    recurrence ===
    "none"
  ) {
    return date;
  }

  let guard = 0;

  while (
    date < from &&
    guard++ < 500
  ) {
    if (
      recurrence ===
      "daily"
    ) {
      date.setDate(
        date.getDate() +
          1,
      );
    } else if (
      recurrence ===
      "weekly"
    ) {
      date.setDate(
        date.getDate() +
          7,
      );
    } else if (
      recurrence ===
      "biweekly"
    ) {
      date.setDate(
        date.getDate() +
          14,
      );
    } else {
      date.setMonth(
        date.getMonth() +
          1,
      );
    }
  }

  return date;
}

function emptyForm() {
  return {
    title: "",
    date: "",
    time: "",
    teamId:
      "general",
    recurrence:
      "none" as Recurrence,
    locked: false,
  };
}

function MeetingsPage() {
  const {
    meetings,
    currentUser,
    setRsvp,
    rsvpFor,
    teamName,
    rsvps,
    profiles,
    teams,
    createMeeting,
    updateMeeting,
    toggleMeetingLock,
  } = useStore();

  const [
    tab,
    setTab,
  ] =
    useState<
      | "upcoming"
      | "past"
    >("upcoming");

  const [
    openId,
    setOpenId,
  ] =
    useState<
      string | null
    >(null);

  const [
    editing,
    setEditing,
  ] =
    useState<
      Meeting | null
    >(null);

  const [
    formOpen,
    setFormOpen,
  ] =
    useState(false);

  const [
    form,
    setForm,
  ] =
    useState(
      emptyForm(),
    );

  const [
    generalAttendees,
    setGeneralAttendees,
  ] =
    useState<
      GeneralAttendee[]
    >([]);

  const loadGeneralAttendees =
    useServerFn(
      getGeneralMeetingAttendees,
    );

  const isAdmin =
    currentUser.role ===
    "Admin";

  /*
   * Load organisation-wide Attending users
   * for General meetings.
   *
   * This runs once when the Meetings page opens.
   * No polling or background loop.
   */
  useEffect(() => {
    let active = true;

    void loadGeneralAttendees()
      .then(
        (result) => {
          if (!active) {
            return;
          }

          setGeneralAttendees(
            result.attendees,
          );
        },
      )
      .catch(
        (error) => {
          console.error(
            "Failed to load general meeting attendees:",
            error,
          );
        },
      );

    return () => {
      active = false;
    };
  }, [
    loadGeneralAttendees,
  ]);

  const startOfToday =
    new Date();

  startOfToday.setHours(
    0,
    0,
    0,
    0,
  );

  const {
    upcoming,
    past,
  } =
    useMemo(() => {
      const mine =
        meetings.filter(
          (meeting) =>
            meeting.teamId ===
              "general" ||
            currentUser.teamIds.includes(
              meeting.teamId,
            ),
        );

      const upcomingItems: {
        m: Meeting;
        when: Date;
      }[] = [];

      const pastItems: {
        m: Meeting;
        when: Date;
      }[] = [];

      for (
        const meeting
        of mine
      ) {
        const when =
          occurrenceOf(
            meeting,
            startOfToday,
          );

        if (
          when >=
          startOfToday
        ) {
          upcomingItems.push({
            m: meeting,
            when,
          });
        } else {
          pastItems.push({
            m: meeting,
            when,
          });
        }
      }

      upcomingItems.sort(
        (a, b) =>
          a.when.getTime() -
          b.when.getTime(),
      );

      pastItems.sort(
        (a, b) =>
          b.when.getTime() -
          a.when.getTime(),
      );

      return {
        upcoming:
          upcomingItems,
        past:
          pastItems,
      };

      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      meetings,
      currentUser.teamIds,
    ]);

  const list =
    tab === "upcoming"
      ? upcoming
      : past;

  const openMeeting =
    meetings.find(
      (meeting) =>
        meeting.id ===
        openId,
    ) ?? null;

  function respond(
    meetingId: string,
    status:
      | "Attending"
      | "Declined",
  ) {
    const meeting =
      meetings.find(
        (candidate) =>
          candidate.id ===
          meetingId,
      );

    if (
      meeting?.locked &&
      !isAdmin
    ) {
      toast.error(
        "This meeting is locked — responses are final.",
      );

      return;
    }

    /*
     * Keep the organisation-wide General attendance
     * display immediately in sync for the current user.
     */
    if (
      meeting?.teamId ===
      "general"
    ) {
      setGeneralAttendees(
        (current) => {
          const withoutCurrentUser =
            current.filter(
              (entry) =>
                !(
                  entry.meetingId ===
                    meetingId &&
                  entry.userId ===
                    currentUser.id
                ),
            );

          if (
            status ===
            "Attending"
          ) {
            return [
              ...withoutCurrentUser,
              {
                meetingId,
                userId:
                  currentUser.id,
                name:
                  currentUser.name,
              },
            ];
          }

          return withoutCurrentUser;
        },
      );
    }

    setRsvp(
      meetingId,
      status,
    );

    toast[
      status ===
      "Attending"
        ? "success"
        : "warning"
    ](
      status ===
        "Attending"
        ? "You're marked as attending"
        : "Marked as can't attend",
    );
  }

  function breakdown(
    meeting: Meeting,
  ): MeetingGroups {
    const audience =
      profiles.filter(
        (profile) =>
          meeting.teamId ===
            "general" ||
          profile.teamIds.includes(
            meeting.teamId,
          ),
      );

    const status = (
      profile: Profile,
    ) =>
      rsvps.find(
        (rsvp) =>
          rsvp.meetingId ===
            meeting.id &&
          rsvp.userId ===
            profile.id,
      )?.status;

    /*
     * Admins already have access to the full RSVP picture.
     */
    if (isAdmin) {
      return {
        attending:
          audience.filter(
            (profile) =>
              status(
                profile,
              ) ===
              "Attending",
          ),

        declined:
          audience.filter(
            (profile) =>
              status(
                profile,
              ) ===
              "Declined",
          ),

        pending:
          audience.filter(
            (profile) =>
              !status(
                profile,
              ),
          ),
      };
    }

    /*
     * Team-specific meetings:
     * preserve the existing behaviour.
     *
     * Normal members see only Attending people.
     */
    if (
      meeting.teamId !==
      "general"
    ) {
      return {
        attending:
          audience.filter(
            (profile) =>
              status(
                profile,
              ) ===
              "Attending",
          ),

        declined: [],
        pending: [],
      };
    }

    /*
     * General meeting:
     *
     * Use the authenticated server result rather than
     * the RLS-filtered RSVP rows in the normal client.
     *
     * This allows every user to see everyone who is
     * attending, regardless of team.
     */
    const attending =
      generalAttendees
        .filter(
          (entry) =>
            entry.meetingId ===
            meeting.id,
        )
        .map(
          (entry) => ({
            id:
              entry.userId,
            name:
              entry.name,
          }),
        );

    return {
      attending,
      declined: [],
      pending: [],
    };
  }

  function openCreate() {
    setEditing(null);

    setForm(
      emptyForm(),
    );

    setFormOpen(true);
  }

  function openEdit(
    meeting: Meeting,
  ) {
    setEditing(
      meeting,
    );

    setForm({
      title:
        meeting.title,

      date:
        meeting.date,

      time:
        meeting.time,

      teamId:
        meeting.teamId,

      recurrence:
        meeting.recurrence ??
        "none",

      locked:
        Boolean(
          meeting.locked,
        ),
    });

    setFormOpen(true);
  }

  function submitForm(
    event:
      React.FormEvent,
  ) {
    event.preventDefault();

    if (
      !form.title ||
      !form.date ||
      !form.time
    ) {
      toast.error(
        "Title, date and time are required.",
      );

      return;
    }

    if (editing) {
      updateMeeting(
        editing.id,
        form,
      );

      toast.success(
        "Meeting updated",
      );
    } else {
      createMeeting(
        form,
      );

      toast.success(
        "Meeting created",
      );
    }

    setFormOpen(false);
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">
          Meetings
        </h1>

        <p className="mt-1 text-sm text-muted-foreground">
          General meetings plus
          everything for{" "}
          {currentUser.teamIds
            .length >
          0
            ? currentUser.teamIds
                .map(
                  (id) =>
                    teamName(
                      id,
                    ),
                )
                .join(", ")
            : teamName(
                currentUser.teamId,
              )}
          .
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
        {(
          [
            "upcoming",
            "past",
          ] as const
        ).map(
          (currentTab) => (
            <button
              key={
                currentTab
              }
              onClick={() =>
                setTab(
                  currentTab,
                )
              }
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors",

                tab ===
                  currentTab
                  ? "bg-background text-foreground shadow-[var(--shadow-soft)]"
                  : "text-muted-foreground",
              )}
            >
              {currentTab ===
              "upcoming"
                ? `Upcoming (${upcoming.length})`
                : `History (${past.length})`}
            </button>
          ),
        )}
      </div>

      {list.length ===
        0 && (
        <div className="surface-card rounded-3xl p-10 text-center">
          {tab ===
          "upcoming" ? (
            <CalendarDays className="mx-auto size-8 text-muted-foreground" />
          ) : (
            <History className="mx-auto size-8 text-muted-foreground" />
          )}

          <p className="mt-3 text-sm text-muted-foreground">
            {tab ===
            "upcoming"
              ? "No meetings for your team right now."
              : "No past meetings yet."}
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {list.map(
          ({
            m,
            when,
          }) => {
            const mine =
              rsvpFor(
                m.id,
              );

            const {
              attending,
            } =
              breakdown(
                m,
              );

            const recurrence =
              m.recurrence ??
              "none";

            return (
              <article
                key={m.id}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setOpenId(
                    m.id,
                  )
                }
                onKeyDown={(
                  event,
                ) =>
                  event.key ===
                    "Enter" &&
                  setOpenId(
                    m.id,
                  )
                }
                className="surface-card flex cursor-pointer flex-col gap-4 rounded-3xl p-5 transition-shadow hover:shadow-[var(--shadow-glow)]"
              >
                <div className="min-w-0">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge
                        variant={
                          m.teamId ===
                          "general"
                            ? "secondary"
                            : "outline"
                        }
                        className="rounded-full"
                      >
                        {teamName(
                          m.teamId ===
                            "general"
                            ? "general"
                            : m.teamId,
                        )}
                      </Badge>

                      {recurrence !==
                        "none" && (
                        <Badge
                          variant="outline"
                          className="rounded-full"
                        >
                          <Repeat className="size-3" />{" "}
                          {
                            RECURRENCE_LABEL[
                              recurrence
                            ]
                          }
                        </Badge>
                      )}

                      {m.locked && (
                        <Badge
                          variant="outline"
                          className="rounded-full text-muted-foreground"
                        >
                          <Lock className="size-3" />{" "}
                          Locked
                        </Badge>
                      )}
                    </div>

                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-1 shrink-0 rounded-full"
                        aria-label="Edit meeting"
                        onClick={(
                          event,
                        ) => {
                          event.stopPropagation();

                          openEdit(
                            m,
                          );
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )}
                  </div>

                  <h2 className="truncate text-lg font-semibold">
                    {
                      m.title
                    }
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="size-4" />

                      {when.toLocaleDateString(
                        undefined,
                        {
                          weekday:
                            "short",
                          month:
                            "short",
                          day: "numeric",
                        },
                      )}
                    </span>

                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-4" />

                      {
                        m.time
                      }
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl bg-muted/60 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Users className="size-3.5" />{" "}
                    {
                      attending.length
                    }{" "}
                    attending
                  </p>

                  {attending.length >
                  0 ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {attending
                        .slice(
                          0,
                          4,
                        )
                        .map(
                          (
                            person,
                          ) => (
                            <li
                              key={
                                person.id
                              }
                              className="flex items-center gap-1.5 rounded-full bg-background py-1 pl-1 pr-2.5 text-xs font-medium"
                            >
                              <Avatar className="size-5">
                                <AvatarFallback className="bg-primary text-[9px] text-primary-foreground">
                                  {initials(
                                    person.name,
                                  )}
                                </AvatarFallback>
                              </Avatar>

                              {
                                person.name
                              }
                            </li>
                          ),
                        )}

                      {attending.length >
                        4 && (
                        <li className="self-center text-xs text-muted-foreground">
                          +
                          {attending.length -
                            4}{" "}
                          more
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No responses
                      yet.
                    </p>
                  )}
                </div>

                {tab ===
                "upcoming" ? (
                  <div
                    className="grid grid-cols-2 gap-2"
                    onClick={(
                      event,
                    ) =>
                      event.stopPropagation()
                    }
                  >
                    <Button
                      className="rounded-full"
                      disabled={
                        Boolean(
                          m.locked,
                        ) &&
                        !isAdmin
                      }
                      variant={
                        mine?.status ===
                        "Attending"
                          ? "default"
                          : "outline"
                      }
                      onClick={() =>
                        respond(
                          m.id,
                          "Attending",
                        )
                      }
                    >
                      <Check className="size-4" />{" "}
                      Attending
                    </Button>

                    <Button
                      className="rounded-full"
                      disabled={
                        Boolean(
                          m.locked,
                        ) &&
                        !isAdmin
                      }
                      variant={
                        mine?.status ===
                        "Declined"
                          ? "destructive"
                          : "outline"
                      }
                      onClick={() =>
                        respond(
                          m.id,
                          "Declined",
                        )
                      }
                    >
                      <X className="size-4" />{" "}
                      Can't attend
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs font-medium text-muted-foreground">
                    You:{" "}
                    <span
                      className={
                        mine?.status ===
                        "Attending"
                          ? "text-success"
                          : mine?.status ===
                              "Declined"
                            ? "text-destructive"
                            : ""
                      }
                    >
                      {mine
                        ? mine.status ===
                          "Attending"
                          ? "Attended"
                          : "Didn't attend"
                        : "No response"}
                    </span>
                  </p>
                )}
              </article>
            );
          },
        )}
      </div>

      {isAdmin && (
        <Button
          onClick={
            openCreate
          }
          aria-label="Create meeting"
          className="fixed bottom-24 right-5 z-40 size-14 rounded-full shadow-[var(--shadow-glow)] md:bottom-8 md:right-8"
        >
          <Plus className="size-6" />
        </Button>
      )}

      {/* Slide-up detail modal */}
      <Sheet
        open={Boolean(
          openMeeting,
        )}
        onOpenChange={(
          open,
        ) =>
          !open &&
          setOpenId(null)
        }
      >
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto rounded-t-3xl px-5 pb-8"
        >
          {openMeeting && (
            <MeetingDetail
              meeting={
                openMeeting
              }
              isAdmin={
                isAdmin
              }
              when={occurrenceOf(
                openMeeting,
                startOfToday,
              )}
              teamLabel={teamName(
                openMeeting.teamId ===
                  "general"
                  ? "general"
                  : openMeeting.teamId,
              )}
              groups={breakdown(
                openMeeting,
              )}
              onToggleLock={() => {
                toggleMeetingLock(
                  openMeeting.id,
                );

                toast.success(
                  openMeeting.locked
                    ? "Meeting unlocked"
                    : "Meeting locked",
                );
              }}
              onEdit={() => {
                setOpenId(
                  null,
                );

                openEdit(
                  openMeeting,
                );
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Create / edit meeting */}
      <Dialog
        open={formOpen}
        onOpenChange={
          setFormOpen
        }
      >
        <DialogContent className="rounded-3xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Edit meeting"
                : "New meeting"}
            </DialogTitle>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={
              submitForm
            }
          >
            <div className="space-y-2">
              <Label htmlFor="m-title">
                Title
              </Label>

              <Input
                id="m-title"
                className="rounded-xl"
                value={
                  form.title
                }
                onChange={(
                  event,
                ) =>
                  setForm({
                    ...form,
                    title:
                      event
                        .target
                        .value,
                  })
                }
                placeholder="Quarterly planning"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="m-date">
                  Date
                </Label>

                <Input
                  id="m-date"
                  type="date"
                  className="rounded-xl"
                  value={
                    form.date
                  }
                  onChange={(
                    event,
                  ) =>
                    setForm({
                      ...form,
                      date:
                        event
                          .target
                          .value,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="m-time">
                  Time
                </Label>

                <Input
                  id="m-time"
                  type="time"
                  className="rounded-xl"
                  value={
                    form.time
                  }
                  onChange={(
                    event,
                  ) =>
                    setForm({
                      ...form,
                      time:
                        event
                          .target
                          .value,
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                Audience
              </Label>

              <Select
                value={
                  form.teamId
                }
                onValueChange={(
                  value,
                ) =>
                  setForm({
                    ...form,
                    teamId:
                      value,
                  })
                }
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  <SelectItem value="general">
                    General
                    (everyone)
                  </SelectItem>

                  {teams.map(
                    (team) => (
                      <SelectItem
                        key={
                          team.id
                        }
                        value={
                          team.id
                        }
                      >
                        {
                          team.name
                        }
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>
                Repeats
              </Label>

              <Select
                value={
                  form.recurrence
                }
                onValueChange={(
                  value,
                ) =>
                  setForm({
                    ...form,
                    recurrence:
                      value as Recurrence,
                  })
                }
              >
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>

                <SelectContent>
                  {(
                    Object.keys(
                      RECURRENCE_LABEL,
                    ) as Recurrence[]
                  ).map(
                    (
                      recurrence,
                    ) => (
                      <SelectItem
                        key={
                          recurrence
                        }
                        value={
                          recurrence
                        }
                      >
                        {
                          RECURRENCE_LABEL[
                            recurrence
                          ]
                        }
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">
                  Lock meeting
                </p>

                <p className="text-xs text-muted-foreground">
                  Members can no
                  longer change
                  their RSVP.
                </p>
              </div>

              <Switch
                checked={
                  form.locked
                }
                onCheckedChange={(
                  value,
                ) =>
                  setForm({
                    ...form,
                    locked:
                      value,
                  })
                }
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                className="w-full rounded-full"
              >
                {editing
                  ? "Save changes"
                  : "Create meeting"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PersonList({
  title,
  people,
  tone,
}: {
  title: string;

  people:
    MeetingPerson[];

  tone:
    | "success"
    | "destructive"
    | "muted";
}) {
  const dot =
    tone === "success"
      ? "bg-success"
      : tone ===
          "destructive"
        ? "bg-destructive"
        : "bg-border";

  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span
          className={cn(
            "size-2 rounded-full",
            dot,
          )}
        />{" "}
        {title} (
        {people.length})
      </p>

      {people.length ===
      0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nobody here.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {people.map(
            (person) => (
              <li
                key={
                  person.id
                }
                className="flex items-center gap-2 text-sm"
              >
                <Avatar className="size-6">
                  <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                    {initials(
                      person.name,
                    )}
                  </AvatarFallback>
                </Avatar>

                <span className="truncate">
                  {
                    person.name
                  }
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function MeetingDetail({
  meeting,
  isAdmin,
  when,
  teamLabel,
  groups,
  onToggleLock,
  onEdit,
}: {
  meeting: Meeting;

  isAdmin: boolean;

  when: Date;

  teamLabel: string;

  groups:
    MeetingGroups;

  onToggleLock:
    () => void;

  onEdit:
    () => void;
}) {
  const recurrence =
    meeting.recurrence ??
    "none";

  return (
    <>
      <SheetHeader className="px-0 text-left">
        <SheetTitle className="text-xl">
          {
            meeting.title
          }
        </SheetTitle>
      </SheetHeader>

      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant="secondary"
          className="rounded-full"
        >
          {teamLabel}
        </Badge>

        {recurrence !==
          "none" && (
          <Badge
            variant="outline"
            className="rounded-full"
          >
            <Repeat className="size-3" />{" "}
            {
              RECURRENCE_LABEL[
                recurrence
              ]
            }
          </Badge>
        )}

        {meeting.locked && (
          <Badge
            variant="outline"
            className="rounded-full"
          >
            <Lock className="size-3" />{" "}
            Locked
          </Badge>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="size-4" />

          {when.toLocaleDateString(
            undefined,
            {
              weekday:
                "long",
              month:
                "long",
              day: "numeric",
            },
          )}
        </span>

        <span className="inline-flex items-center gap-1.5">
          <Clock className="size-4" />

          {
            meeting.time
          }
        </span>
      </div>

      <div className="mt-5 space-y-3">
        <PersonList
          title="Attending"
          people={
            groups.attending
          }
          tone="success"
        />

        {isAdmin && (
          <>
            <PersonList
              title="Not attending"
              people={
                groups.declined
              }
              tone="destructive"
            />

            <PersonList
              title="Unmarked"
              people={
                groups.pending
              }
              tone="muted"
            />
          </>
        )}
      </div>

      {isAdmin && (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={
              onEdit
            }
          >
            <Pencil className="size-4" />{" "}
            Edit
          </Button>

          <Button
            variant={
              meeting.locked
                ? "secondary"
                : "default"
            }
            className="rounded-full"
            onClick={
              onToggleLock
            }
          >
            {meeting.locked ? (
              <Unlock className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}

            {meeting.locked
              ? "Unlock"
              : "Lock meeting"}
          </Button>
        </div>
      )}
    </>
  );
}