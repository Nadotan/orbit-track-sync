import { Link, useRouterState } from "@tanstack/react-router";
import { Clock3, CalendarDays, LayoutDashboard } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const items = [
  { title: "Clock", url: "/", icon: Clock3, admin: false },
  { title: "Meetings", url: "/meetings", icon: CalendarDays, admin: false },
  { title: "Admin", url: "/admin", icon: LayoutDashboard, admin: true },
];

export function BottomNav() {
  const { currentUser } = useStore();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });
  const visible = items.filter((i) => !i.admin || currentUser.role === "Admin");

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
      >
        {visible.map((item) => {
          const active = currentPath === item.url;
          return (
            <li key={item.url}>
              <Link
                to={item.url}
                className={cn(
                  "flex flex-col items-center gap-1 px-2 py-2.5 text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-14 place-items-center rounded-full transition-colors",
                    active && "bg-accent text-accent-foreground",
                  )}
                >
                  <item.icon className="size-5" />
                </span>
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
