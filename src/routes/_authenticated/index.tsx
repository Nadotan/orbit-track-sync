import { createFileRoute, redirect } from "@tanstack/react-router";

import { CLOCK_ENABLED } from "@/lib/feature-flags";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [
    {"title": "Team workspace - POM"} ,
    {"name": "description", "content": "Open your POM team workspace, meetings and calendars."} ,
    {"property": "og:title", "content": "Team workspace - POM"} ,
    {"property": "og:description", "content": "Open your POM team workspace, meetings and calendars."} ,
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
