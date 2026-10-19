import { createFileRoute, redirect } from "@tanstack/react-router";

import { CLOCK_ENABLED } from "@/lib/feature-flags";

export const Route = createFileRoute(
  "/_authenticated/tracker",
)({
  head: () => ({ meta: [
    {"title": "Tracker access - POM"} ,
    {"name": "description", "content": "Return to the available POM workspace from the tracker."} ,
    {"property": "og:title", "content": "Tracker access - POM"} ,
    {"property": "og:description", "content": "Return to the available POM workspace from the tracker."} ,
    {"property": "og:type", "content": "website"} ,
    {"name": "twitter:card", "content": "summary"} ,
  ] }),
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
