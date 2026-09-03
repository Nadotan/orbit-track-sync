import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Inbox,
  Info,
  Loader2,
  LogOut,
  Megaphone,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserRound,
  Vote,
} from "lucide-react";
import {
  useNavigate,
} from "@tanstack/react-router";
import {
  useServerFn,
} from "@tanstack/react-start";
import {
  toast,
} from "sonner";

import {
  ClockPushMonitor,
} from "@/components/clock-push-monitor";
import {
  PushToggle,
} from "@/components/push-toggle";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Input,
} from "@/components/ui/input";
import {
  Label,
} from "@/components/ui/label";
import {
  ScrollArea,
} from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Textarea,
} from "@/components/ui/textarea";
import {
  supabase,
} from "@/integrations/supabase/client";
import {
  createPopupAnnouncement,
} from "@/lib/admin.functions";
import {
  relativeTime,
} from "@/lib/format";
import {
  useStore,
} from "@/lib/store";
import {
  cn,
} from "@/lib/utils";

type UserNotificationKind =
  | "announcement"
  | "meeting"
  | "task_assigned"
  | "task_changed"
  | "task_update";

interface UserNotification {
  id: string;
  kind: UserNotificationKind;
  title: string;
  message: string;
  taskId: string | null;
  requiresAck: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
  popupDismissedAt: string | null;
  createdAt: string;
}

function initials(
  name: string,
) {
  return (
    name
      .split(" ")
      .map(
        (part) =>
          part[0],
      )
      .join("")
      .slice(0, 2)
      .toUpperCase() ||
    "?"
  );
}

function mapUserNotification(
  row: any,
): UserNotification {
  return {
    id: row.id,

    kind:
      row.kind as UserNotificationKind,

    title:
      row.title,

    message:
      row.message,

    taskId:
      row.task_id,

    requiresAck:
      Boolean(
        row.requires_ack,
      ),

    readAt:
      row.read_at,

    acknowledgedAt:
      row.acknowledged_at,

    popupDismissedAt:
      row.popup_dismissed_at,

    createdAt:
      row.created_at,
  };
}

function userNotificationIcon(
  kind: UserNotificationKind,
) {
  if (
    kind ===
    "announcement"
  ) {
    return Megaphone;
  }

  if (
    kind ===
    "meeting"
  ) {
    return CalendarDays;
  }

  if (
    kind ===
    "task_assigned"
  ) {
    return ClipboardCheck;
  }

  if (
    kind ===
    "task_update"
  ) {
    return MessageSquareText;
  }

  return RefreshCw;
}

export function AppHeader() {
  const {
    currentUser,
    notifications,
    markNotificationsRead,
    teamName,
    signOut,
  } =
    useStore();

  const navigate =
    useNavigate();

  const publishPopup =
    useServerFn(
      createPopupAnnouncement,
    );

  const adminUnread =
    notifications.filter(
      (
        notification,
      ) =>
        !notification.read,
    ).length;

  const [
    userNotifications,
    setUserNotifications,
  ] =
    useState<
      UserNotification[]
    >(
      [],
    );

  const [
    userNotificationsLoading,
    setUserNotificationsLoading,
  ] =
    useState(
      true,
    );

  const [
    notificationPanelOpen,
    setNotificationPanelOpen,
  ] =
    useState(
      false,
    );

  const [
    createPopupOpen,
    setCreatePopupOpen,
  ] =
    useState(
      false,
    );

  const [
    popupTitle,
    setPopupTitle,
  ] =
    useState(
      "",
    );

  const [
    popupMessage,
    setPopupMessage,
  ] =
    useState(
      "",
    );

  const [
    publishingPopup,
    setPublishingPopup,
  ] =
    useState(
      false,
    );

  const [
    hiddenPopupRevision,
    setHiddenPopupRevision,
  ] =
    useState(
      0,
    );

  const hiddenTaskPopupIds =
    useRef(
      new Set<string>(),
    );

  const loadUserNotifications =
    useCallback(
      async () => {
        const client =
          supabase as any;

        const {
          data,
          error,
        } =
          await client
            .from(
              "user_notifications",
            )
            .select(
              "id, kind, title, message, task_id, requires_ack, read_at, acknowledged_at, popup_dismissed_at, created_at",
            )
            .eq(
              "user_id",
              currentUser.id,
            )
            .order(
              "created_at",
              {
                ascending:
                  false,
              },
            )
            .limit(
              100,
            );

        if (
          error
        ) {
          console.error(
            "Failed to load user notifications:",
            error,
          );

          return;
        }

        setUserNotifications(
          (
            data ??
            []
          ).map(
            mapUserNotification,
          ),
        );
      },
      [
        currentUser.id,
      ],
    );

  useEffect(
    () => {
      let active =
        true;

      void loadUserNotifications()
        .finally(
          () => {
            if (
              active
            ) {
              setUserNotificationsLoading(
                false,
              );
            }
          },
        );

      const channel =
        supabase
          .channel(
            `user-notifications-${currentUser.id}`,
          )
          .on(
            "postgres_changes",
            {
              event:
                "INSERT",

              schema:
                "public",

              table:
                "user_notifications",

              filter:
                `user_id=eq.${currentUser.id}`,
            },

            () => {
              void loadUserNotifications();
            },
          )
          .subscribe();

      return () => {
        active =
          false;

        void supabase
          .removeChannel(
            channel,
          );
      };
    },
    [
      currentUser.id,
      loadUserNotifications,
    ],
  );

  const userUnread =
    useMemo(
      () =>
        userNotifications
          .filter(
            (
              notification,
            ) =>
              !notification.readAt,
          )
          .length,
      [
        userNotifications,
      ],
    );

  const pendingPopup =
    useMemo(
      () => {
        void hiddenPopupRevision;

        return (
          [
            ...userNotifications,
          ]
            .reverse()
            .find(
              (
                notification,
              ) => {
                if (
                  notification.requiresAck &&
                  hiddenTaskPopupIds.current.has(
                    notification.id,
                  )
                ) {
                  return false;
                }

                if (
                  notification.requiresAck
                ) {
                  return (
                    !notification.acknowledgedAt
                  );
                }

                return (
                  !notification.popupDismissedAt
                );
              },
            ) ??
          null
        );
      },
      [
        hiddenPopupRevision,
        userNotifications,
      ],
    );

  const patchUserNotification =
    useCallback(
      (
        id: string,
        patch:
          Partial<UserNotification>,
      ) => {
        setUserNotifications(
          (
            current,
          ) =>
            current.map(
              (
                notification,
              ) =>
                notification.id ===
                id
                  ? {
                      ...notification,
                      ...patch,
                    }
                  : notification,
            ),
        );
      },
      [],
    );

  const markUserNotificationsRead =
    useCallback(
      async () => {
        const unreadIds =
          userNotifications
            .filter(
              (
                notification,
              ) =>
                !notification.readAt,
            )
            .map(
              (
                notification,
              ) =>
                notification.id,
            );

        if (
          unreadIds.length ===
          0
        ) {
          return;
        }

        const now =
          new Date()
            .toISOString();

        setUserNotifications(
          (
            current,
          ) =>
            current.map(
              (
                notification,
              ) =>
                unreadIds.includes(
                  notification.id,
                )
                  ? {
                      ...notification,
                      readAt:
                        now,
                    }
                  : notification,
            ),
        );

        const client =
          supabase as any;

        const {
          error,
        } =
          await client
            .from(
              "user_notifications",
            )
            .update({
              read_at:
                now,
            })
            .eq(
              "user_id",
              currentUser.id,
            )
            .in(
              "id",
              unreadIds,
            );

        if (
          error
        ) {
          console.error(
            "Failed to mark user notifications read:",
            error,
          );

          void loadUserNotifications();
        }
      },
      [
        currentUser.id,
        loadUserNotifications,
        userNotifications,
      ],
    );

  useEffect(
    () => {
      if (
        notificationPanelOpen &&
        userUnread >
          0
      ) {
        void markUserNotificationsRead();
      }
    },
    [
      notificationPanelOpen,
      userUnread,
      markUserNotificationsRead,
    ],
  );

  async function markOneUserNotificationRead(
    notification:
      UserNotification,
  ) {
    if (
      notification.readAt
    ) {
      return;
    }

    const now =
      new Date()
        .toISOString();

    patchUserNotification(
      notification.id,
      {
        readAt:
          now,
      },
    );

    const client =
      supabase as any;

    const {
      error,
    } =
      await client
        .from(
          "user_notifications",
        )
        .update({
          read_at:
            now,
        })
        .eq(
          "id",
          notification.id,
        )
        .eq(
          "user_id",
          currentUser.id,
        );

    if (
      error
    ) {
      console.error(
        "Failed to mark user notification read:",
        error,
      );

      void loadUserNotifications();
    }
  }

  async function acknowledgeTaskNotification(
    notification:
      UserNotification,
  ) {
    const now =
      new Date()
        .toISOString();

    patchUserNotification(
      notification.id,
      {
        readAt:
          notification.readAt ??
          now,

        acknowledgedAt:
          now,

        popupDismissedAt:
          now,
      },
    );

    hiddenTaskPopupIds.current
      .delete(
        notification.id,
      );

    const client =
      supabase as any;

    const {
      error,
    } =
      await client
        .from(
          "user_notifications",
        )
        .update({
          read_at:
            notification.readAt ??
            now,

          acknowledged_at:
            now,

          popup_dismissed_at:
            now,
        })
        .eq(
          "id",
          notification.id,
        )
        .eq(
          "user_id",
          currentUser.id,
        );

    if (
      error
    ) {
      toast.error(
        "Could not acknowledge the notification.",
      );

      void loadUserNotifications();
    }
  }

  async function dismissAnnouncement(
    notification:
      UserNotification,
  ) {
    const now =
      new Date()
        .toISOString();

    patchUserNotification(
      notification.id,
      {
        readAt:
          notification.readAt ??
          now,

        popupDismissedAt:
          now,
      },
    );

    const client =
      supabase as any;

    const {
      error,
    } =
      await client
        .from(
          "user_notifications",
        )
        .update({
          read_at:
            notification.readAt ??
            now,

          popup_dismissed_at:
            now,
        })
        .eq(
          "id",
          notification.id,
        )
        .eq(
          "user_id",
          currentUser.id,
        );

    if (
      error
    ) {
      toast.error(
        "Could not dismiss the notification.",
      );

      void loadUserNotifications();
    }
  }

  function hideTaskPopupForSession(
    notificationId:
      string,
  ) {
    hiddenTaskPopupIds.current
      .add(
        notificationId,
      );

    setHiddenPopupRevision(
      (
        value,
      ) =>
        value +
        1,
    );
  }

  function dismissPopup(
    notification:
      UserNotification,
  ) {
    if (
      notification.requiresAck
    ) {
      hideTaskPopupForSession(
        notification.id,
      );

      return;
    }

    void dismissAnnouncement(
      notification,
    );
  }

  function openTaskFromNotification(
    notification:
      UserNotification,
  ) {
    if (
      !notification.taskId
    ) {
      return;
    }

    if (
      notification.requiresAck &&
      !notification.acknowledgedAt
    ) {
      hideTaskPopupForSession(
        notification.id,
      );
    }

    setNotificationPanelOpen(
      false,
    );

    void markOneUserNotificationRead(
      notification,
    );

    navigate({
      to:
        "/tasks",

      search: {
        task:
          notification.taskId,
        project:
          undefined,
      },
    });
  }

  function openMeetingNotification(
    notification:
      UserNotification,
  ) {
    setNotificationPanelOpen(
      false,
    );

    void markOneUserNotificationRead(
      notification,
    );

    navigate({
      to:
        "/meetings",
    });
  }

  async function createAnnouncement() {
    const title =
      popupTitle.trim();

    const message =
      popupMessage.trim();

    if (
      !title ||
      !message ||
      publishingPopup
    ) {
      return;
    }

    setPublishingPopup(
      true,
    );

    try {
      const result =
        await publishPopup({
          data: {
            title,
            message,
          },
        });

      setPopupTitle(
        "",
      );

      setPopupMessage(
        "",
      );

      setCreatePopupOpen(
        false,
      );

      toast.success(
        result.sent ===
          1
          ? "Pop-up sent to 1 member"
          : `Pop-up sent to ${result.sent} members`,
      );

      await loadUserNotifications();
    } catch (
      error
    ) {
      toast.error(
        error instanceof
          Error
          ? error.message
          : "Could not publish the pop-up.",
      );
    } finally {
      setPublishingPopup(
        false,
      );
    }
  }

  return (
    <>
      <ClockPushMonitor />

      <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <SidebarTrigger />

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              Welcome back,{" "}
              {
                currentUser.name
              }
            </p>

            <p className="truncate text-xs text-muted-foreground">
              {teamName(
                currentUser.teamId,
              )}{" "}
              team workspace
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <PushToggle />

          <Sheet
            open={
              notificationPanelOpen
            }
            onOpenChange={
              setNotificationPanelOpen
            }
          >
            <SheetTrigger
              asChild
            >
              <Button
                variant="outline"
                size="icon"
                className="relative"
                aria-label="Open notifications"
              >
                <Inbox className="size-4" />

                {userUnread >
                  0 && (
                  <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                    {userUnread >
                    9
                      ? "9+"
                      : userUnread}
                  </span>
                )}
              </Button>
            </SheetTrigger>

            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <div className="flex items-center justify-between gap-3 pr-8">
                  <SheetTitle>
                    Notifications
                  </SheetTitle>

                  {currentUser.role ===
                    "Admin" && (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={() =>
                        setCreatePopupOpen(
                          true,
                        )
                      }
                    >
                      <Plus className="size-4" />
                      New pop-up
                    </Button>
                  )}
                </div>
              </SheetHeader>

              <ScrollArea className="h-[calc(100vh-6rem)] px-4 pb-6">
                <div className="space-y-2">
                  {userNotificationsLoading && (
                    <div className="grid min-h-28 place-items-center">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {!userNotificationsLoading &&
                    userNotifications.length ===
                      0 && (
                      <div className="rounded-2xl border border-dashed p-6 text-center">
                        <Inbox className="mx-auto size-6 text-muted-foreground" />

                        <p className="mt-2 text-sm text-muted-foreground">
                          Nothing here yet.
                        </p>
                      </div>
                    )}

                  {userNotifications.map(
                    (
                      notification,
                    ) => {
                      const Icon =
                        userNotificationIcon(
                          notification.kind,
                        );

                      const needsAck =
                        notification.requiresAck &&
                        !notification.acknowledgedAt;

                      return (
                        <div
                          key={
                            notification.id
                          }
                          className={cn(
                            "rounded-2xl border bg-card p-3",

                            !notification.readAt &&
                              "border-primary/30 bg-primary/[0.03]",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                              <Icon className="size-4" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold leading-snug">
                                  {
                                    notification.title
                                  }
                                </p>

                                {needsAck && (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full text-[10px]"
                                  >
                                    Needs acknowledgment
                                  </Badge>
                                )}
                              </div>

                              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                                {
                                  notification.message
                                }
                              </p>

                              <p className="mt-2 text-xs text-muted-foreground">
                                {relativeTime(
                                  notification.createdAt,
                                )}
                              </p>

                              {(notification.taskId ||
                                notification.kind ===
                                  "meeting" ||
                                needsAck) && (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  {notification.kind ===
                                    "meeting" && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        openMeetingNotification(
                                          notification,
                                        )
                                      }
                                    >
                                      Open meetings
                                    </Button>
                                  )}

                                  {notification.taskId && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        openTaskFromNotification(
                                          notification,
                                        )
                                      }
                                    >
                                      Open task
                                    </Button>
                                  )}

                                  {needsAck && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="gap-1.5"
                                      onClick={() =>
                                        void acknowledgeTaskNotification(
                                          notification,
                                        )
                                      }
                                    >
                                      <Check className="size-4" />
                                      Got it
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>

          {currentUser.role ===
            "Admin" && (
            <Sheet
              onOpenChange={(
                open,
              ) =>
                open &&
                markNotificationsRead()
              }
            >
              <SheetTrigger
                asChild
              >
                <Button
                  variant="outline"
                  size="icon"
                  className="relative"
                  aria-label="Open admin activity"
                >
                  <ShieldAlert className="size-4" />

                  {adminUnread >
                    0 && (
                    <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                      {adminUnread >
                      9
                        ? "9+"
                        : adminUnread}
                    </span>
                  )}
                </Button>
              </SheetTrigger>

              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>
                    Admin activity
                  </SheetTitle>
                </SheetHeader>

                <ScrollArea className="h-[calc(100vh-6rem)] px-4 pb-6">
                  <div className="space-y-2">
                    {notifications.length ===
                      0 && (
                      <p className="text-sm text-muted-foreground">
                        Nothing here yet.
                      </p>
                    )}

                    {notifications.map(
                      (
                        notification,
                      ) => {
                        const Icon =
                          notification.tone ===
                          "positive"
                            ? CircleCheck
                            : notification.tone ===
                                "negative"
                              ? CircleX
                              : Info;

                        return (
                          <div
                            key={
                              notification.id
                            }
                            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                          >
                            <Icon
                              className={cn(
                                "mt-0.5 size-4 shrink-0",

                                notification.tone ===
                                  "positive" &&
                                  "text-success",

                                notification.tone ===
                                  "negative" &&
                                  "text-destructive",

                                notification.tone ===
                                  "neutral" &&
                                  "text-muted-foreground",
                              )}
                            />

                            <div className="min-w-0">
                              <p className="text-sm leading-snug">
                                {
                                  notification.message
                                }
                              </p>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {relativeTime(
                                  notification.createdAt,
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </ScrollArea>
              </SheetContent>
            </Sheet>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              asChild
            >
              <Button
                variant="outline"
                className="gap-2"
              >
                <Avatar className="size-6">
                  {currentUser.avatarUrl && (
                    <AvatarImage
                      src={
                        currentUser.avatarUrl
                      }
                      alt={
                        currentUser.name
                      }
                    />
                  )}

                  <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                    {initials(
                      currentUser.name,
                    )}
                  </AvatarFallback>
                </Avatar>

                <Badge
                  variant="secondary"
                  className="hidden sm:inline-flex"
                >
                  {
                    currentUser.role
                  }
                </Badge>

                <span className="max-w-28 truncate text-sm">
                  {
                    currentUser.name
                  }
                </span>

                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              className="w-56"
            >
              <DropdownMenuLabel className="truncate">
                {
                  currentUser.email
                }
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={() => {
                  navigate({
                    to:
                      "/profile",
                  });
                }}
              >
                <UserRound className="size-4" />
                Profile
              </DropdownMenuItem>

              {currentUser.role ===
                "Admin" && (
                <DropdownMenuItem
                  onSelect={() => {
                    navigate({
                      to:
                        "/polls",
                      search: {
                        poll: undefined,
                      },
                    });
                  }}
                >
                  <Vote className="size-4" />
                  Polls
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={() => {
                  void signOut();

                  navigate({
                    to:
                      "/sign-in",
                  });
                }}
              >
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Dialog
        open={
          Boolean(
            pendingPopup,
          )
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !open &&
            pendingPopup
          ) {
            dismissPopup(
              pendingPopup,
            );
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl">
          {pendingPopup &&
            (() => {
              const Icon =
                userNotificationIcon(
                  pendingPopup.kind,
                );

              return (
                <>
                  <DialogHeader className="text-left">
                    <div className="mb-2 grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>

                    <DialogTitle>
                      {
                        pendingPopup.title
                      }
                    </DialogTitle>

                    <DialogDescription className="whitespace-pre-wrap text-sm leading-relaxed">
                      {
                        pendingPopup.message
                      }
                    </DialogDescription>
                  </DialogHeader>

                  <DialogFooter className="flex-col gap-2 sm:flex-col">
                    {pendingPopup.taskId && (
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() =>
                          openTaskFromNotification(
                            pendingPopup,
                          )
                        }
                      >
                        Open task
                      </Button>
                    )}

                    {pendingPopup.requiresAck ? (
                      <>
                        <Button
                          type="button"
                          className="w-full gap-1.5"
                          onClick={() =>
                            void acknowledgeTaskNotification(
                              pendingPopup,
                            )
                          }
                        >
                          <Check className="size-4" />
                          Got it
                        </Button>

                        <Button
                          type="button"
                          variant="ghost"
                          className="w-full"
                          onClick={() =>
                            dismissPopup(
                              pendingPopup,
                            )
                          }
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() =>
                          void dismissAnnouncement(
                            pendingPopup,
                          )
                        }
                      >
                        Dismiss
                      </Button>
                    )}
                  </DialogFooter>
                </>
              );
            })()}
        </DialogContent>
      </Dialog>

      <Dialog
        open={
          createPopupOpen
        }
        onOpenChange={(
          open,
        ) => {
          if (
            !publishingPopup
          ) {
            setCreatePopupOpen(
              open,
            );
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>
              Create pop-up
            </DialogTitle>

            <DialogDescription>
              The pop-up appears once for every member and is also saved in
              their notification panel.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="popup-title">
                Headline
              </Label>

              <Input
                id="popup-title"
                value={
                  popupTitle
                }
                maxLength={
                  120
                }
                disabled={
                  publishingPopup
                }
                onChange={(
                  event,
                ) =>
                  setPopupTitle(
                    event.target.value,
                  )
                }
                placeholder="Important announcement"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="popup-message">
                Text
              </Label>

              <Textarea
                id="popup-message"
                value={
                  popupMessage
                }
                maxLength={
                  2000
                }
                rows={
                  6
                }
                disabled={
                  publishingPopup
                }
                onChange={(
                  event,
                ) =>
                  setPopupMessage(
                    event.target.value,
                  )
                }
                placeholder="Write the announcement..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={
                publishingPopup
              }
              onClick={() =>
                setCreatePopupOpen(
                  false,
                )
              }
            >
              Cancel
            </Button>

            <Button
              type="button"
              disabled={
                publishingPopup ||
                !popupTitle.trim() ||
                !popupMessage.trim()
              }
              onClick={() =>
                void createAnnouncement()
              }
            >
              {publishingPopup && (
                <Loader2 className="size-4 animate-spin" />
              )}

              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}