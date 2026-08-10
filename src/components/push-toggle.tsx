import { useEffect, useState } from "react";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  disablePush,
  enablePush,
  getPushSubscription,
  isPushSupported,
} from "@/lib/push";

export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(isPushSupported());

    void getPushSubscription()
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => setEnabled(false));
  }, []);

  if (!supported) return null;

  const toggle = async () => {
    setBusy(true);

    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        toast.success("Push notifications turned off");
      } else {
        await enablePush();
        setEnabled(true);
        toast.success("Push notifications are on for this device");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update notifications",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          disabled={busy}
          onClick={() => void toggle()}
          aria-label={enabled ? "Turn off push notifications" : "Turn on push notifications"}
        >
          {enabled ? (
            <BellRing className="size-4 text-primary" />
          ) : (
            <BellOff className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {enabled ? "Push notifications on" : "Turn on push notifications"}
      </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
