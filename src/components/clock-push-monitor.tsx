import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useServerFn,
} from "@tanstack/react-start";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  getUserPreferences,
} from "@/lib/profile.functions";

import {
  sendClockReminder,
} from "@/lib/push.functions";

import {
  useStore,
} from "@/lib/store";

const THREE_HOURS_MS =
  3 * 60 * 60 * 1000;

const PREFERENCE_EVENT =
  "pom:user-preference-changed";

interface PreferenceChangedDetail {
  key: string;
  enabled: boolean;
}

export function ClockPushMonitor() {
  const {
    activeSession,
  } =
    useStore();

  const loadPreferences =
    useServerFn(
      getUserPreferences,
    );

  const accessTokenRef =
    useRef<
      string | null
    >(
      null,
    );

  const [
    clockRemindersEnabled,
    setClockRemindersEnabled,
  ] =
    useState<
      boolean | null
    >(
      null,
    );

  useEffect(
    () => {
      let mounted =
        true;

      void supabase
        .auth
        .getSession()
        .then(
          ({
            data,
          }) => {
            if (
              mounted
            ) {
              accessTokenRef.current =
                data
                  .session
                  ?.access_token ??
                null;
            }
          },
        );

      const {
        data:
          authListener,
      } =
        supabase
          .auth
          .onAuthStateChange(
            (
              _event,
              session,
            ) => {
              accessTokenRef.current =
                session
                  ?.access_token ??
                null;
            },
          );

      return () => {
        mounted =
          false;

        authListener
          .subscription
          .unsubscribe();
      };
    },
    [],
  );

  useEffect(
    () => {
      let active =
        true;

      void loadPreferences()
        .then(
          (
            preferences,
          ) => {
            if (
              active
            ) {
              setClockRemindersEnabled(
                preferences.clock_reminders,
              );
            }
          },
        )
        .catch(
          (
            error,
          ) => {
            console.error(
              "[push] Failed to load Clock reminder preference",
              error,
            );

            if (
              active
            ) {
              /*
               * Fail closed:
               * don't send optional reminders
               * if preferences can't be read.
               */
              setClockRemindersEnabled(
                false,
              );
            }
          },
        );

      const handlePreferenceChange =
        (
          event:
            Event,
        ) => {
          const detail =
            (
              event as
                CustomEvent<PreferenceChangedDetail>
            ).detail;

          if (
            detail?.key ===
            "clock_reminders"
          ) {
            setClockRemindersEnabled(
              Boolean(
                detail.enabled,
              ),
            );
          }
        };

      window.addEventListener(
        PREFERENCE_EVENT,
        handlePreferenceChange,
      );

      return () => {
        active =
          false;

        window.removeEventListener(
          PREFERENCE_EVENT,
          handlePreferenceChange,
        );
      };
    },
    [
      loadPreferences,
    ],
  );

  /*
   * 3-hour Clock reminders.
   *
   * No polling:
   * one timer waits until the next due time.
   */
  useEffect(
    () => {
      if (
        !activeSession ||
        clockRemindersEnabled !==
          true
      ) {
        return;
      }

      const startedAt =
        new Date(
          activeSession.startTime,
        ).getTime();

      if (
        !Number.isFinite(
          startedAt,
        )
      ) {
        return;
      }

      let cancelled =
        false;

      let running =
        false;

      let monitoringActive =
        true;

      let timeoutId:
        | number
        | null =
        null;

      let nextDueAt =
        startedAt +
        THREE_HOURS_MS;

      const clearTimer =
        () => {
          if (
            timeoutId !==
            null
          ) {
            window.clearTimeout(
              timeoutId,
            );

            timeoutId =
              null;
          }
        };

      const scheduleAt =
        (
          when:
            number,
        ) => {
          if (
            cancelled ||
            !monitoringActive
          ) {
            return;
          }

          clearTimer();

          nextDueAt =
            when;

          timeoutId =
            window.setTimeout(
              () => {
                timeoutId =
                  null;

                void runReminder();
              },

              Math.max(
                1_000,
                when -
                  Date.now(),
              ),
            );
        };

      const runReminder =
        async () => {
          if (
            cancelled ||
            !monitoringActive ||
            running
          ) {
            return;
          }

          running =
            true;

          try {
            const result =
              await sendClockReminder();

            if (
              cancelled
            ) {
              return;
            }

            if (
              !result.active
            ) {
              monitoringActive =
                false;

              clearTimer();

              return;
            }

            const next =
              result.nextReminderAt
                ? new Date(
                    result.nextReminderAt,
                  ).getTime()
                : Date.now() +
                  THREE_HOURS_MS;

            scheduleAt(
              Number.isFinite(
                next,
              )
                ? next
                : Date.now() +
                  THREE_HOURS_MS,
            );
          } catch (
            error
          ) {
            console.error(
              "[push] Clock reminder failed",
              error,
            );

            scheduleAt(
              Date.now() +
                THREE_HOURS_MS,
            );
          } finally {
            running =
              false;
          }
        };

      if (
        Date.now() >=
        nextDueAt
      ) {
        void runReminder();
      } else {
        scheduleAt(
          nextDueAt,
        );
      }

      const handleVisibility =
        () => {
          if (
            monitoringActive &&
            document.visibilityState ===
              "visible" &&
            Date.now() >=
              nextDueAt
          ) {
            void runReminder();
          }
        };

      document.addEventListener(
        "visibilitychange",
        handleVisibility,
      );

      return () => {
        cancelled =
          true;

        clearTimer();

        document.removeEventListener(
          "visibilitychange",
          handleVisibility,
        );
      };
    },
    [
      activeSession?.startTime,
      activeSession?.userId,
      clockRemindersEnabled,
    ],
  );

  /*
   * Closed-app reminder.
   *
   * Only register pagehide when this
   * preference is actually enabled.
   */
  useEffect(
    () => {
      if (
        !activeSession ||
        clockRemindersEnabled !==
          true
      ) {
        return;
      }

      let notifiedForThisPage =
        false;

      const notifyClosed =
        () => {
          if (
            notifiedForThisPage
          ) {
            return;
          }

          const token =
            accessTokenRef.current;

          if (
            !token
          ) {
            return;
          }

          notifiedForThisPage =
            true;

          void fetch(
            "/api/timer-closed",
            {
              method:
                "POST",

              headers: {
                Authorization:
                  `Bearer ${token}`,
              },

              credentials:
                "same-origin",

              keepalive:
                true,
            },
          ).catch(
            () =>
              undefined,
          );
        };

      const handlePageHide =
        (
          event:
            PageTransitionEvent,
        ) => {
          if (
            !event.persisted
          ) {
            notifyClosed();
          }
        };

      window.addEventListener(
        "pagehide",
        handlePageHide,
      );

      return () => {
        window.removeEventListener(
          "pagehide",
          handlePageHide,
        );
      };
    },
    [
      activeSession?.startTime,
      activeSession?.userId,
      clockRemindersEnabled,
    ],
  );

  return null;
}