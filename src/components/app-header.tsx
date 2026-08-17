import {
  Bell,
  ChevronDown,
  CircleCheck,
  CircleX,
  Info,
  LogOut,
  UserRound,
} from "lucide-react";

import {
  useNavigate,
} from "@tanstack/react-router";

import {
  SidebarTrigger,
} from "@/components/ui/sidebar";

import {
  Button,
} from "@/components/ui/button";

import {
  Badge,
} from "@/components/ui/badge";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  ScrollArea,
} from "@/components/ui/scroll-area";

import {
  PushToggle,
} from "@/components/push-toggle";

import {
  ClockPushMonitor,
} from "@/components/clock-push-monitor";

import {
  useStore,
} from "@/lib/store";

import {
  relativeTime,
} from "@/lib/format";

import {
  cn,
} from "@/lib/utils";

function initials(
  name: string,
) {
  return (
    name
      .split(" ")
      .map(
        (n) =>
          n[0],
      )
      .join("")
      .slice(
        0,
        2,
      )
      .toUpperCase() ||
    "?"
  );
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

  const unread =
    notifications.filter(
      (n) =>
        !n.read,
    ).length;

  const navigate =
    useNavigate();

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

          {currentUser.role ===
            "Admin" && (
            <Sheet
              onOpenChange={(
                o,
              ) =>
                o &&
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
                >
                  <Bell className="size-4" />

                  {unread >
                    0 && (
                    <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                      {
                        unread
                      }
                    </span>
                  )}
                </Button>
              </SheetTrigger>

              <SheetContent className="w-full sm:max-w-md">
                <SheetHeader>
                  <SheetTitle>
                    Admin notifications
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
                      (n) => {
                        const Icon =
                          n.tone ===
                          "positive"
                            ? CircleCheck
                            : n.tone ===
                                "negative"
                              ? CircleX
                              : Info;

                        return (
                          <div
                            key={
                              n.id
                            }
                            className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                          >
                            <Icon
                              className={cn(
                                "mt-0.5 size-4 shrink-0",

                                n.tone ===
                                  "positive" &&
                                  "text-success",

                                n.tone ===
                                  "negative" &&
                                  "text-destructive",

                                n.tone ===
                                  "neutral" &&
                                  "text-muted-foreground",
                              )}
                            />

                            <div className="min-w-0">
                              <p className="text-sm leading-snug">
                                {
                                  n.message
                                }
                              </p>

                              <p className="mt-1 text-xs text-muted-foreground">
                                {relativeTime(
                                  n.createdAt,
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
    </>
  );
}