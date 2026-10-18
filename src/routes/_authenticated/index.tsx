import { createFileRoute, redirect } from "@tanstack/react-router";

import { CLOCK_ENABLED } from "@/lib/feature-flags";

export const Route = createFileRoute("/_authenticated/")({
  beforeLoad: () => {
    if (CLOCK_ENABLED) {
      throw redirect({
        to: "/clock",
        replace: true,
      });
    }

    throw redirect({
      to: "/meetings",
      replace: true,
    });
  },
});
