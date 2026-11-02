
import { useEffect, useRef, useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import {
  clearPushSyncCache,
  disablePush,
  enablePush,
  isPushSupported,
  syncPushClientStatus,
  type PushPermissionState,
} from "@/lib/push";

export function PushToggle() {
  const { currentUser } = useStore();
  const userId = currentUser.id;
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<PushPermissionState | "unknown">("unknown");
  const permissionRef = useRef<PushPermissionState | "unknown">("unknown");
  useEffect(() => {
    let active = true;
    let syncing = false;
    const applyPermission = (next: PushPermissionState) => {
      permissionRef.current = next;
      if (active) setPermission(next);
    };

    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        // Cache is per user: switching accounts must not reuse push health.
        const state = await syncPushClientStatus(userId);
        if (!active) return;
        setSupported(state.supported);
        applyPermission(state.permission);
        setEnabled(state.enabled);
      } catch {
        if (!active) return;
        const nextSupported = isPushSupported();
        setSupported(nextSupported);
        if (nextSupported) applyPermission(Notification.permission);
        setEnabled(false);
      } finally {
        syncing = false;
      }
    };

    void sync();

    // Focus/visibility alone does not do database work. We only resync if
    // the browser permission actually changed.
    const syncOnlyIfPermissionChanged = () => {
      if (!isPushSupported() || Notification.permission === permissionRef.current) return;
      clearPushSyncCache(userId);
      void sync();
    };
    window.addEventListener("focus", syncOnlyIfPermissionChanged);
    document.addEventListener("visibilitychange", syncOnlyIfPermissionChanged);
    return () => {
      active = false;
      window.removeEventListener("focus", syncOnlyIfPermissionChanged);
      document.removeEventListener("visibilitychange", syncOnlyIfPermissionChanged);
    };
  }, [userId]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush();
        clearPushSyncCache(userId);
        const nextPermission = Notification.permission;
        permissionRef.current = nextPermission;
        setPermission(nextPermission);
        setEnabled(false);
        toast.success("Push notifications turned off");
      } else {
        await enablePush();
        clearPushSyncCache(userId);
        permissionRef.current = "granted";
        setPermission("granted");
        setEnabled(true);
        toast.success("Push notifications are on for this device");
      }
    } catch (error) {
      if (isPushSupported()) {
        const nextPermission = Notification.permission;
        permissionRef.current = nextPermission;
        setPermission(nextPermission);
      }
      setEnabled(false);
      toast.error(error instanceof Error ? error.message : "Could not update notifications");
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;

  const tooltipText = enabled
    ? "Push notifications on"
    : permission === "denied"
      ? "Notifications blocked by browser"
      : permission === "granted"
        ? "Push needs to be re-registered"
        : "Turn on push notifications";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            disabled={busy}
            onClick={() => void toggle()}
            aria-label={enabled ? "Turn off push notifications" : tooltipText}
          >
            {enabled ? (
              <BellRing className="size-4 text-primary" />
            ) : (
              <BellOff className={`size-4 ${permission === "denied" ? "text-destructive" : ""}`} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
