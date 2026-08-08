import { Bell, ChevronDown, CircleCheck, CircleX, Info } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStore } from "@/lib/store";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AppHeader() {
  const {
    currentUser,
    profiles,
    setCurrentUserId,
    notifications,
    markNotificationsRead,
    teamName,
  } = useStore();
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <header className="sticky top-0 z-20 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">Welcome back, {currentUser.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {teamName(currentUser.teamId)} team workspace
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {currentUser.role === "Admin" && (
          <Sheet onOpenChange={(o) => o && markNotificationsRead()}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="relative">
                <Bell className="size-4" />
                {unread > 0 && (
                  <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                    {unread}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Admin notifications</SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-6rem)] px-4 pb-6">
                <div className="space-y-2">
                  {notifications.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nothing here yet.</p>
                  )}
                  {notifications.map((n) => {
                    const Icon =
                      n.tone === "positive" ? CircleCheck : n.tone === "negative" ? CircleX : Info;
                    return (
                      <div
                        key={n.id}
                        className="flex items-start gap-3 rounded-xl border border-border bg-card p-3"
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            n.tone === "positive" && "text-success",
                            n.tone === "negative" && "text-destructive",
                            n.tone === "neutral" && "text-muted-foreground",
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm leading-snug">{n.message}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {relativeTime(n.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {currentUser.role}
              </Badge>
              <span className="max-w-28 truncate text-sm">{currentUser.name}</span>
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Switch signed-in user (demo)</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {profiles.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => setCurrentUserId(p.id)}>
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-xs text-muted-foreground">{p.role}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
