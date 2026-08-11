import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck,
  Camera,
  Check,
  Clock3,
  Loader2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useStore } from "@/lib/store";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [{ title: "Welcome to POM" }],
  }),
  component: OnboardingPage,
});

const steps = ["Welcome", "Your team", "You're set"] as const;

function initials(name: string) {
  return (
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function OnboardingPage() {
  const { currentUser, teams, completeOnboarding } = useStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState(currentUser.name);
  const [teamId, setTeamId] = useState<string | null>(currentUser.teamId);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const progress = ((step + 1) / steps.length) * 100;

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Images must be under 5MB.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${currentUser.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, cacheControl: "3600" });
    setUploading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    toast.success("Photo uploaded");
  }

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

  async function finish() {
  setFinishing(true);

  try {
    await completeOnboarding({
      name: name.trim() || currentUser.name,
      teamId,
      avatarUrl,
    });

    toast.success("You're all set — welcome to POM!");
    navigate({ to: "/" });
  } catch (error) {
    console.error("Failed to complete onboarding:", error);

    toast.error(
      error instanceof Error
        ? error.message
        : "Could not save your profile. Please try again.",
    );
  } finally {
    setFinishing(false);
  }
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
            <div>
              <h1 className="text-2xl font-semibold">Welcome to POM</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Let's get your profile ready. This only takes a minute.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative shrink-0"
                disabled={uploading}
              >
                <Avatar className="size-16">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={name || currentUser.name} />}
                  <AvatarFallback className="bg-primary text-base text-primary-foreground">
                    {initials(name || currentUser.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin text-white" />
                  ) : (
                    <Camera className="size-5 text-white" />
                  )}
                </span>
              </button>
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "Upload photo"}
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">PNG or JPG, up to 5MB.</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
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
              <h1 className="text-2xl font-semibold">
                You're all set, {name.split(" ")[0] || "there"}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Here's a quick look at what you can do in POM.
              </p>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3">
              <Avatar className="size-10">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={name || currentUser.name} />}
                <AvatarFallback className="bg-primary text-primary-foreground">
                  {initials(name || currentUser.name)}
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
            <Button type="button" className="rounded-full" onClick={finish} disabled={finishing}>
              {finishing ? "Finishing…" : "Go to my workspace"} <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}