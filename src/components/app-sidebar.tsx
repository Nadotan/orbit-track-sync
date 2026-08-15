import {
  Link,
  useRouterState,
} from "@tanstack/react-router";

import {
  CalendarDays,
  Clock3,
  Hourglass,
  LayoutDashboard,
  Timer,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import {
  useStore,
} from "@/lib/store";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

const items = [
  {
    title:
      "Time Tracker",

    url:
      "/",

    icon:
      Clock3,

    admin:
      false,
  },

  {
    title:
      "Meetings Hub",

    url:
      "/meetings",

    icon:
      CalendarDays,

    admin:
      false,
  },

  {
    title:
      "Countdowns",

    url:
      "/countdowns",

    icon:
      Hourglass,

    admin:
      false,
  },

  {
    title:
      "Admin Dashboard",

    url:
      "/admin",

    icon:
      LayoutDashboard,

    admin:
      true,
  },
];

export function AppSidebar() {
  const {
    currentUser,
    teamName,
  } =
    useStore();

  const currentPath =
    useRouterState({
      select:
        (router) =>
          router
            .location
            .pathname,
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Timer className="size-5" />
          </div>

          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate font-display text-base font-semibold">
              POM
            </p>

            <p className="truncate text-xs text-sidebar-foreground/60">
              version 1.2
            </p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            Workspace
          </SidebarGroupLabel>

          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter(
                  (
                    item,
                  ) =>
                    !item.admin ||
                    currentUser.role ===
                      "Admin",
                )
                .map(
                  (
                    item,
                  ) => (
                    <SidebarMenuItem
                      key={
                        item.title
                      }
                    >
                      <SidebarMenuButton
                        asChild
                        isActive={
                          currentPath ===
                          item.url
                        }
                      >
                        <Link
                          to={
                            item.url
                          }
                          className="flex items-center gap-2"
                        >
                          <item.icon className="size-4 shrink-0" />

                          <span>
                            {
                              item.title
                            }
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div className="flex min-w-0 items-center gap-2.5 rounded-xl bg-sidebar-accent px-2.5 py-2">
          <Avatar className="size-8 shrink-0">
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

            <AvatarFallback className="bg-sidebar-primary text-xs text-sidebar-primary-foreground">
              {currentUser.name
                .split(" ")
                .map(
                  (
                    name,
                  ) =>
                    name[0],
                )
                .join("")}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
              {
                currentUser.name
              }
            </p>

            <p className="truncate text-xs text-sidebar-foreground/60">
              {
                currentUser.role
              }{" "}
              ·{" "}
              {teamName(
                currentUser.teamId,
              )}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}