import {
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

export interface CountdownItem {
  id: string;
  title: string;
  subtitle: string;
  targetAt: string;
  createdAt: string;
}

interface CountdownStageProps {
  countdown: CountdownItem;
  onClose: () => void;
}

const DAY_MS =
  24 * 60 * 60 * 1000;

const HOUR_MS =
  60 * 60 * 1000;

const MINUTE_MS =
  60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function countdownParts(
  targetAt: string,
  now: number,
) {
  const target =
    new Date(targetAt).getTime();

  const remaining =
    Math.max(
      0,
      target - now,
    );

  const complete =
    remaining <= 0;

  if (
    remaining >= DAY_MS
  ) {
    const days =
      Math.floor(
        remaining /
          DAY_MS,
      );

    const hours =
      Math.floor(
        (
          remaining %
          DAY_MS
        ) /
          HOUR_MS,
      );

    const minutes =
      Math.floor(
        (
          remaining %
          HOUR_MS
        ) /
          MINUTE_MS,
      );

    return {
      values: [
        pad(days),
        pad(hours),
        pad(minutes),
      ],

      labels: [
        "DAYS",
        "HOURS",
        "MIN",
      ],

      remaining,
      complete,
      finalHour:
        false,

      finalTen:
        false,
    };
  }

  const hours =
    Math.floor(
      remaining /
        HOUR_MS,
    );

  const minutes =
    Math.floor(
      (
        remaining %
        HOUR_MS
      ) /
        MINUTE_MS,
    );

  const seconds =
    Math.floor(
      (
        remaining %
        MINUTE_MS
      ) /
        1000,
    );

  return {
    values: [
      pad(hours),
      pad(minutes),
      pad(seconds),
    ],

    labels: [
      "HOURS",
      "MIN",
      "SEC",
    ],

    remaining,
    complete,

    finalHour:
      remaining <=
      HOUR_MS,

    finalTen:
      remaining <=
      10 * MINUTE_MS,
  };
}

const particles =
  Array.from(
    { length: 28 },
    (_, index) => ({
      id: index,

      left:
        (index * 37) %
        100,

      top:
        (index * 61) %
        100,

      delay:
        -(
          (index * 0.47) %
          8
        ),

      duration:
        7 +
        (index % 8),

      size:
        2 +
        (index % 4),
    }),
  );

export function CountdownStage({
  countdown,
  onClose,
}: CountdownStageProps) {
  const [
    now,
    setNow,
  ] =
    useState(() =>
      Date.now(),
    );

  const [
    fullscreen,
    setFullscreen,
  ] =
    useState(false);

  useEffect(() => {
    const timer =
      window.setInterval(
        () => {
          setNow(
            Date.now(),
          );
        },
        1000,
      );

    return () => {
      window.clearInterval(
        timer,
      );
    };
  }, []);

  useEffect(() => {
    const handleChange =
      () => {
        setFullscreen(
          Boolean(
            document.fullscreenElement,
          ),
        );
      };

    document.addEventListener(
      "fullscreenchange",
      handleChange,
    );

    return () => {
      document.removeEventListener(
        "fullscreenchange",
        handleChange,
      );
    };
  }, []);

  useEffect(() => {
    const handleKeyDown =
      (
        event:
          KeyboardEvent,
      ) => {
        if (
          event.key ===
            "Escape" &&
          !document.fullscreenElement
        ) {
          onClose();
        }
      };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [onClose]);

  const state =
    useMemo(
      () =>
        countdownParts(
          countdown.targetAt,
          now,
        ),

      [
        countdown.targetAt,
        now,
      ],
    );

  const targetText =
    new Date(
      countdown.targetAt,
    ).toLocaleString(
      [],
      {
        weekday:
          "short",

        day:
          "2-digit",

        month:
          "short",

        year:
          "numeric",

        hour:
          "2-digit",

        minute:
          "2-digit",
      },
    );

  async function toggleFullscreen() {
    try {
      if (
        document.fullscreenElement
      ) {
        await document.exitFullscreen();

        return;
      }

      await document.documentElement.requestFullscreen();
    } catch {
      // Fullscreen is not available
      // on every browser/PWA.
    }
  }

  return (
    <div
      className={`fixed inset-0 z-[100] overflow-hidden bg-[#02040a] text-white ${
        state.finalTen
          ? "countdown-final-ten"
          : state.finalHour
            ? "countdown-final-hour"
            : ""
      }`}
    >
      <style>{`
        @keyframes pom-orb-one {
          0%, 100% {
            transform: translate3d(-8%, -6%, 0) scale(1);
          }

          50% {
            transform: translate3d(18%, 14%, 0) scale(1.18);
          }
        }

        @keyframes pom-orb-two {
          0%, 100% {
            transform: translate3d(5%, 8%, 0) scale(1.05);
          }

          50% {
            transform: translate3d(-18%, -15%, 0) scale(1.25);
          }
        }

        @keyframes pom-orb-three {
          0%, 100% {
            transform: translate3d(0, 0, 0) scale(1);
          }

          50% {
            transform: translate3d(10%, -18%, 0) scale(1.2);
          }
        }

        @keyframes pom-particle {
          0% {
            opacity: 0;
            transform: translate3d(0, 20px, 0) scale(.6);
          }

          20% {
            opacity: .65;
          }

          80% {
            opacity: .25;
          }

          100% {
            opacity: 0;
            transform: translate3d(0, -100px, 0) scale(1.3);
          }
        }

        @keyframes pom-pulse {
          0%, 100% {
            transform: scale(.94);
            opacity: .16;
          }

          50% {
            transform: scale(1.12);
            opacity: .38;
          }
        }

        @keyframes pom-grid {
          from {
            transform: translateY(0);
          }

          to {
            transform: translateY(48px);
          }
        }

        @keyframes pom-separator {
          0%, 100% {
            opacity: .45;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes pom-complete {
          0%, 100% {
            filter: brightness(1);
          }

          50% {
            filter: brightness(1.45);
          }
        }

        .pom-countdown-orb-one {
          animation:
            pom-orb-one
            17s
            ease-in-out
            infinite;
        }

        .pom-countdown-orb-two {
          animation:
            pom-orb-two
            21s
            ease-in-out
            infinite;
        }

        .pom-countdown-orb-three {
          animation:
            pom-orb-three
            13s
            ease-in-out
            infinite;
        }

        .pom-countdown-pulse {
          animation:
            pom-pulse
            5s
            ease-in-out
            infinite;
        }

        .pom-countdown-grid {
          animation:
            pom-grid
            8s
            linear
            infinite;
        }

        .pom-countdown-separator {
          animation:
            pom-separator
            2s
            ease-in-out
            infinite;
        }

        .countdown-final-hour
        .pom-countdown-pulse {
          animation-duration:
            2.4s;
        }

        .countdown-final-ten
        .pom-countdown-pulse {
          animation-duration:
            1.15s;
        }

        .countdown-final-ten
        .pom-countdown-separator {
          animation-duration:
            .8s;
        }

        .pom-countdown-complete {
          animation:
            pom-complete
            1.5s
            ease-in-out
            infinite;
        }
      `}</style>

      {/* Background */}
      <div className="absolute inset-0">
        <div
          className="
            pom-countdown-orb-one
            absolute
            -left-[18vw]
            -top-[28vh]
            h-[75vh]
            w-[75vh]
            rounded-full
            bg-indigo-600/25
            blur-[110px]
          "
        />

        <div
          className="
            pom-countdown-orb-two
            absolute
            -bottom-[30vh]
            -right-[18vw]
            h-[80vh]
            w-[80vh]
            rounded-full
            bg-cyan-500/20
            blur-[120px]
          "
        />

        <div
          className="
            pom-countdown-orb-three
            absolute
            left-[38%]
            top-[35%]
            h-[45vh]
            w-[45vh]
            rounded-full
            bg-violet-500/15
            blur-[100px]
          "
        />

        <div
          className="
            pom-countdown-pulse
            absolute
            left-1/2
            top-1/2
            h-[70vw]
            max-h-[850px]
            w-[70vw]
            max-w-[850px]
            -translate-x-1/2
            -translate-y-1/2
            rounded-full
            border
            border-white/10
            bg-cyan-400/5
            blur-sm
          "
        />

        <div
          className="
            absolute
            inset-0
            bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,4,10,0.2)_55%,rgba(2,4,10,0.92)_100%)]
          "
        />

        <div
          className="
            pom-countdown-grid
            absolute
            -inset-16
            opacity-[0.055]
            [background-image:linear-gradient(rgba(255,255,255,.65)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.65)_1px,transparent_1px)]
            [background-size:48px_48px]
            [mask-image:radial-gradient(circle_at_center,black,transparent_75%)]
          "
        />

        {particles.map(
          (
            particle,
          ) => (
            <span
              key={
                particle.id
              }
              className="absolute rounded-full bg-white"
              style={{
                left:
                  `${particle.left}%`,

                top:
                  `${particle.top}%`,

                width:
                  particle.size,

                height:
                  particle.size,

                animation:
                  `pom-particle ${particle.duration}s linear ${particle.delay}s infinite`,
              }}
            />
          ),
        )}
      </div>

      {/* Top controls */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-4 sm:p-6">
        <div className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs font-medium tracking-[0.22em] text-white/60 backdrop-blur-xl">
          POM COUNTDOWN
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={
              toggleFullscreen
            }
            className="border-white/15 bg-black/20 text-white hover:bg-white/10 hover:text-white"
          >
            {fullscreen ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={
              onClose
            }
            className="border-white/15 bg-black/20 text-white hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex min-h-full flex-col items-center justify-center px-4 py-24 text-center">
        <div className="mx-auto max-w-5xl">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.36em] text-cyan-200/55 sm:text-sm">
            Countdown to
          </p>

          <h1
            className="
              text-balance
              text-3xl
              font-semibold
              tracking-tight
              sm:text-5xl
              md:text-6xl
            "
          >
            {countdown.title}
          </h1>

          {countdown.subtitle && (
            <p className="mx-auto mt-4 max-w-2xl text-sm text-white/50 sm:text-lg">
              {countdown.subtitle}
            </p>
          )}
        </div>

        <div
          className={`
            relative
            my-10
            sm:my-14
            ${
              state.complete
                ? "pom-countdown-complete"
                : ""
            }
          `}
        >
          <div
            className="
              absolute
              inset-0
              -z-10
              scale-110
              rounded-[3rem]
              bg-cyan-300/10
              blur-[70px]
            "
          />

          <div className="flex items-start justify-center">
            {state.values.map(
              (
                value,
                index,
              ) => (
                <div
                  key={
                    state.labels[
                      index
                    ]
                  }
                  className="flex items-start"
                >
                  <div className="min-w-[4.5rem] sm:min-w-[8rem] md:min-w-[11rem] lg:min-w-[14rem]">
                    <div
                      className="
                        select-none
                        font-mono
                        text-[clamp(3.1rem,11vw,10rem)]
                        font-semibold
                        leading-none
                        tracking-[-0.08em]
                        text-white
                        [text-shadow:0_0_35px_rgba(103,232,249,.18)]
                      "
                    >
                      {value}
                    </div>

                    <p
                      className="
                        mt-4
                        text-[9px]
                        font-semibold
                        tracking-[0.28em]
                        text-white/35
                        sm:text-xs
                      "
                    >
                      {
                        state.labels[
                          index
                        ]
                      }
                    </p>
                  </div>

                  {index <
                    state.values.length -
                      1 && (
                    <div
                      className="
                        pom-countdown-separator
                        px-1
                        font-mono
                        text-[clamp(3rem,9vw,8rem)]
                        font-light
                        leading-none
                        text-cyan-200
                        sm:px-3
                      "
                    >
                      :
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </div>

        {state.complete ? (
          <div>
            <p className="text-lg font-semibold uppercase tracking-[0.3em] text-cyan-200 sm:text-2xl">
              Time reached
            </p>
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-[0.26em] text-white/30">
              Target
            </p>

            <p className="mt-2 text-sm font-medium text-white/60 sm:text-base">
              {targetText}
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 text-center text-[10px] uppercase tracking-[0.32em] text-white/20">
        Piece Of Mind
      </div>
    </div>
  );
}