import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";

import {
  CountdownStage,
  type CountdownItem,
} from "@/components/countdown-stage";

export const Route =
  createFileRoute(
    "/_authenticated/countdowns",
  )({
    head: () => ({
      meta: [
        {
          title:
            "Countdown — POM",
        },
        {
          name:
            "description",
          content:
            "POM countdown",
        },
      ],
    }),

    component:
      CountdownsPage,
  });

/*
 * ------------------------------------------------
 * POM GLOBAL COUNTDOWN
 * ------------------------------------------------
 *
 * January 9, 2027
 * 12:00 PM Eastern Time
 *
 * January = EST = UTC-5
 *
 * Same moment in Israel:
 * January 9, 2027 at 19:00
 *
 * IMPORTANT:
 * Keep the timezone offset (-05:00).
 * Do not replace this with a local datetime.
 */
const GLOBAL_COUNTDOWN:
  CountdownItem = {
  id:
    "pom-global-countdown",

  title:
    "Kickoff 2027🥳💜",

  subtitle:
    "Piece Of Mind",

  targetAt:
    "2027-01-09T12:00:00-05:00",

  createdAt:
    "2026-08-11T00:00:00Z",
};

function CountdownsPage() {
  const navigate =
    useNavigate();

  return (
    <CountdownStage
      countdown={
        GLOBAL_COUNTDOWN
      }
      onClose={() =>
        navigate({
          to: "/",
        })
      }
    />
  );
}