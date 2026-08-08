import type { ReactNode } from "react";
import { Timer, CalendarCheck, Clock3, BarChart3 } from "lucide-react";

const bullets = [
  { icon: Clock3, text: "Clock in with a live circular timer and log daily task notes." },
  { icon: CalendarCheck, text: "RSVP to meetings and see who's attending in real time." },
  { icon: BarChart3, text: "Give managers full visibility into hours and attendance." },
];

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen w-full lg:grid-cols-2">
      <div className="hero-panel relative hidden flex-col justify-between overflow-hidden p-10 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/15">
            <Timer className="size-5" />
          </div>
          <p className="font-display text-lg font-semibold">Chrona</p>
        </div>

        <div className="max-w-sm space-y-6">
          <p className="font-display text-3xl font-semibold leading-tight">
            Time tracking and team operations, in one clean workspace.
          </p>
          <ul className="space-y-4">
            {bullets.map((b) => (
              <li key={b.text} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/15">
                  <b.icon className="size-4" />
                </span>
                <span className="text-sm text-white/85">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-white/60">© {new Date().getFullYear()} Chrona. All rights reserved.</p>
      </div>

      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <Timer className="size-5" />
            </div>
            <p className="font-display text-lg font-semibold">Chrona</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">{title}</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}