import {
  useEffect,
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

  useEffect(() => {
    let active =
      true;

    let syncing =
      false;

    let lastSyncAt =
      0;

    async function refresh(
      force =
        false,
    ) {
      const now =
        Date.now();

      if (
        syncing
      ) {
        return;
      }

      if (
        !force &&
        now -
          lastSyncAt <
          1500
      ) {
        return;
      }

      syncing =
        true;

      lastSyncAt =
        now;

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

        setPermission(
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

        setSupported(
          isPushSupported(),
        );

        setEnabled(
          false,
        );
      } finally {
        syncing =
          false;
      }
    }

    void refresh(
      true,
    );

    const onFocus =
      () => {
        void refresh();
      };

    const onVisibilityChange =
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          void refresh();
        }
      };

    window.addEventListener(
      "focus",
      onFocus,
    );

    document.addEventListener(
      "visibilitychange",
      onVisibilityChange,
    );

    return () => {
      active =
        false;

      window.removeEventListener(
        "focus",
        onFocus,
      );

      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
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

          const state =
            await syncPushClientStatus();

          setPermission(
            state.permission,
          );

          setEnabled(
            state.enabled,
          );

          toast.success(
            "Push notifications turned off",
          );
        } else {
          await enablePush();

          const state =
            await syncPushClientStatus();

          setPermission(
            state.permission,
          );

          setEnabled(
            state.enabled,
          );

          if (
            !state.enabled
          ) {
            throw new Error(
              "Push registration could not be verified on the server.",
            );
          }

          toast.success(
            "Push notifications are on for this device",
          );
        }
      } catch (
        error
      ) {
        const state =
          await syncPushClientStatus()
            .catch(
              () =>
                null,
            );

        if (
          state
        ) {
          setSupported(
            state.supported,
          );

          setPermission(
            state.permission,
          );

          setEnabled(
            state.enabled,
          );
        }

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