import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, Check, Clock3, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Welcome to Chrona" }],
  }),
  component: OnboardingPage,
});

const steps = ["Welcome", "Your team", "You're set"] as const;

function OnboardingPage() {
  const { currentUser, teams, completeOnboarding } = useStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(currentUser.name);
  const [teamId, setTeamId] = useState<string | null>(currentUser.teamId);

  const progress = ((step + 1) / steps.length) * 100;

  function next() {
    if (step === 0 && !name.trim()) {
      toast.error("Please enter your name to continue.");
      return;
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function finish() {
    completeOnboarding({ name, teamId });
    toast.success("You're all set — welcome to Chrona!");
    navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:px-6">
      <div className="surface-card w-full max-w-lg space-y-6 rounded-3xl p-6 sm:p-8">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>
              Step {step + 1} of {steps.length}
            </span>
            <span>{steps[step]}</span>
          </div>
          <Progress value={progress} />
        </div>

        {step === 0 && (
          <div className="space-y-5">
            <div className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Sparkles className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Welcome to Chrona</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Let's get your profile ready. This only takes a minute.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="onboard-name">What should we call you?</Label>
              <Input
                id="onboard-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">
              <Users className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Pick your team</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                You'll see meetings and updates for your team. An admin can always change this
                later.
              </p>
            </div>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setTeamId(null)}
                className={cn(
                  "flex items-center justify-between rounded-xl border p-3 text-left text-sm font-medium transition-colors",
                  teamId === null
                    ? "border-primary bg-accent text-accent-foreground"
                    : "border-border hover:bg-muted",
                )}
              >
                I'll wait for my admin to assign me
                {teamId === null && <Check className="size-4 text-primary" />}
              </button>
              {teams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeamId(t.id)}
                  className={cn(
                    "flex items-center justify-between rounded-xl border p-3 text-left text-sm font-medium transition-colors",
                    teamId === t.id
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border hover:bg-muted",
                  )}
                >
                  {t.name}
                  {teamId === t.id && <Check className="size-4 text-primary" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid size-12 place-items-center rounded-2xl bg-success/20 text-success">
              <Check className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">You're all set, {name.split(" ")[0] || "there"}</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Here's a quick look at what you can do in Chrona.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
              <Avatar className="size-10">
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2) || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{name || currentUser.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {teamId ? teams.find((t) => t.id === teamId)?.name : "Unassigned"}
                </p>
              </div>
            </div>

            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <Clock3 className="size-4" />
                </span>
                <span className="text-muted-foreground">
                  Clock in from the Time Tracker and log what you worked on each day.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <CalendarCheck className="size-4" />
                </span>
                <span className="text-muted-foreground">
                  RSVP to meetings from the Meetings Hub so your team knows you're in.
                </span>
              </li>
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {step > 0 ? (
            <Button type="button" variant="outline" className="rounded-full" onClick={back}>
              <ArrowLeft className="size-4" /> Back
            </Button>
          ) : (
            <span />
          )}
          {step < steps.length - 1 ? (
            <Button type="button" className="rounded-full" onClick={next}>
              Continue <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button type="button" className="rounded-full" onClick={finish}>
              Go to my workspace <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}