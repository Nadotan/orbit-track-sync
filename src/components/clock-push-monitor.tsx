import {
  useEffect,
  useRef,
} from "react";

import {
  useStore,
} from "@/lib/store";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  sendClockReminder,
} from "@/lib/push.functions";

const THREE_HOURS_MS =
  3 * 60 * 60 * 1000;

export function ClockPushMonitor() {
  const {
    activeSession,
  } =
    useStore();

  const accessTokenRef =
    useRef<
      string | null
    >(null);

  /*
   * Keep the current access token ready.
   *
   * We cannot wait for an async getSession()
   * after the page already started closing.
   */
  useEffect(() => {
    let mounted =
      true;

    void supabase.auth
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
      supabase.auth
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
  }, []);

  /*
   * ------------------------------------------------
   * 3-HOUR REMINDERS
   * ------------------------------------------------
   *
   * No polling and no cron.
   *
   * One local browser timer wakes up only when
   * the reminder becomes due. If the browser
   * suspended that timer while POM was hidden,
   * we do one local due-time check when POM
   * becomes visible again.
   */
  useEffect(() => {
    if (
      !activeSession
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
          timeoutId ===
          null
        ) {
          return;
        }

        window.clearTimeout(
          timeoutId,
        );

        timeoutId =
          null;
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

        const delay =
          Math.max(
            1_000,
            when -
              Date.now(),
          );

        timeoutId =
          window.setTimeout(
            () => {
              timeoutId =
                null;

              void runReminder();
            },

            delay,
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

          /*
           * Don't repeatedly hit the server when
           * something is wrong. Retry only at the
           * next normal 3-hour interval.
           */
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
        /*
         * This is a LOCAL check only.
         *
         * Returning to the app does not consume a
         * server run unless the reminder is actually due.
         */
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
  }, [
    activeSession?.startTime,
    activeSession?.userId,
  ]);

  /*
   * ------------------------------------------------
   * PAGE CLOSED WHILE CLOCK RUNS
   * ------------------------------------------------
   *
   * IMPORTANT:
   * Do NOT use visibilitychange here.
   *
   * A tab switch, app switch or phone lock makes a
   * page hidden even though POM was not closed. The
   * previous implementation therefore produced false
   * "You closed POM" pushes and spent a server run on
   * every hidden episode.
   *
   * pagehide is much narrower: it fires when this page
   * is actually being unloaded. This is event-driven,
   * has no polling, and costs at most one request for
   * this page lifecycle.
   */
  useEffect(() => {
    if (
      !activeSession
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
        /*
         * Do not treat the browser's back-forward
         * cache as a real page close.
         */
        if (
          event.persisted
        ) {
          return;
        }

        notifyClosed();
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
  }, [
    activeSession?.startTime,
    activeSession?.userId,
  ]);

  return null;
}