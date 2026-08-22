import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  BellOff,
  BellRing,
} from "lucide-react";

import {
  toast,
} from "sonner";

import {
  Button,
} from "@/components/ui/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  disablePush,
  enablePush,
  isPushSupported,
  syncPushClientStatus,
  type PushPermissionState,
} from "@/lib/push";

export function PushToggle() {
  const [
    supported,
    setSupported,
  ] =
    useState(
      false,
    );

  const [
    enabled,
    setEnabled,
  ] =
    useState(
      false,
    );

  const [
    busy,
    setBusy,
  ] =
    useState(
      false,
    );

  const [
    permission,
    setPermission,
  ] =
    useState<
      PushPermissionState |
      "unknown"
    >(
      "unknown",
    );

  const permissionRef =
    useRef<
      PushPermissionState |
      "unknown"
    >(
      "unknown",
    );

  const syncingRef =
    useRef(
      false,
    );

  useEffect(() => {
    let active =
      true;

    const applyPermission =
      (
        next:
          PushPermissionState,
      ) => {
        permissionRef.current =
          next;

        if (
          active
        ) {
          setPermission(
            next,
          );
        }
      };

    const sync =
      async () => {
        if (
          syncingRef.current
        ) {
          return;
        }

        syncingRef.current =
          true;

        try {
          const state =
            await syncPushClientStatus();

          if (
            !active
          ) {
            return;
          }

          setSupported(
            state.supported,
          );

          applyPermission(
            state.permission,
          );

          setEnabled(
            state.enabled,
          );
        } catch {
          if (
            !active
          ) {
            return;
          }

          const nextSupported =
            isPushSupported();

          setSupported(
            nextSupported,
          );

          if (
            nextSupported
          ) {
            applyPermission(
              Notification.permission,
            );
          }

          setEnabled(
            false,
          );
        } finally {
          syncingRef.current =
            false;
        }
      };

    /*
     * One server sync when this component mounts.
     * No polling.
     */
    void sync();

    const syncOnlyIfPermissionChanged =
      () => {
        if (
          !isPushSupported()
        ) {
          return;
        }

        const current =
          Notification.permission;

        /*
         * Focus/visibility events are common and should
         * not spend server runs. We only sync again if
         * Chrome's permission actually changed.
         */
        if (
          current ===
          permissionRef.current
        ) {
          return;
        }

        void sync();
      };

    window.addEventListener(
      "focus",
      syncOnlyIfPermissionChanged,
    );

    document.addEventListener(
      "visibilitychange",
      syncOnlyIfPermissionChanged,
    );

    return () => {
      active =
        false;

      window.removeEventListener(
        "focus",
        syncOnlyIfPermissionChanged,
      );

      document.removeEventListener(
        "visibilitychange",
        syncOnlyIfPermissionChanged,
      );
    };
  }, []);

  if (
    !supported
  ) {
    return null;
  }

  const toggle =
    async () => {
      setBusy(
        true,
      );

      try {
        if (
          enabled
        ) {
          await disablePush();

          const nextPermission =
            Notification.permission;

          permissionRef.current =
            nextPermission;

          setPermission(
            nextPermission,
          );

          setEnabled(
            false,
          );

          toast.success(
            "Push notifications turned off",
          );
        } else {
          await enablePush();

          permissionRef.current =
            "granted";

          setPermission(
            "granted",
          );

          setEnabled(
            true,
          );

          toast.success(
            "Push notifications are on for this device",
          );
        }
      } catch (
        error
      ) {
        if (
          isPushSupported()
        ) {
          const nextPermission =
            Notification.permission;

          permissionRef.current =
            nextPermission;

          setPermission(
            nextPermission,
          );
        }

        setEnabled(
          false,
        );

        toast.error(
          error instanceof
          Error
            ? error.message
            : "Could not update notifications",
        );
      } finally {
        setBusy(
          false,
        );
      }
    };

  const tooltipText =
    enabled
      ? "Push notifications on"
      : permission ===
          "denied"
        ? "Notifications blocked by browser"
        : permission ===
            "granted"
          ? "Push needs to be re-registered"
          : "Turn on push notifications";

  return (
    <TooltipProvider
      delayDuration={
        200
      }
    >
      <Tooltip>
        <TooltipTrigger
          asChild
        >
          <Button
            variant="outline"
            size="icon"
            disabled={
              busy
            }
            onClick={() =>
              void toggle()
            }
            aria-label={
              enabled
                ? "Turn off push notifications"
                : tooltipText
            }
          >
            {enabled ? (
              <BellRing className="size-4 text-primary" />
            ) : (
              <BellOff
                className={`size-4 ${
                  permission ===
                  "denied"
                    ? "text-destructive"
                    : ""
                }`}
              />
            )}
          </Button>
        </TooltipTrigger>

        <TooltipContent>
          {
            tooltipText
          }
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}