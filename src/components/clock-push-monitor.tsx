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
   * No polling.
   *
   * One local browser timer wakes up only
   * when the next reminder becomes due.
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

    let timeoutId:
      | number
      | null =
      null;

    const scheduleAt =
      (
        when:
          number,
      ) => {
        if (
          cancelled
        ) {
          return;
        }

        if (
          timeoutId !==
          null
        ) {
          window.clearTimeout(
            timeoutId,
          );
        }

        const delay =
          Math.max(
            1_000,
            when -
              Date.now(),
          );

        timeoutId =
          window.setTimeout(
            () => {
              void runReminder();
            },

            delay,
          );
      };

    const runReminder =
      async () => {
        if (
          cancelled
        ) {
          return;
        }

        try {
          const result =
            await sendClockReminder();

          if (
            cancelled ||
            !result.active
          ) {
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
           * Don't repeatedly hit the server
           * when something is wrong.
           */
          scheduleAt(
            Date.now() +
              THREE_HOURS_MS,
          );
        }
      };

    const firstReminder =
      startedAt +
      THREE_HOURS_MS;

    if (
      Date.now() >=
      firstReminder
    ) {
      /*
       * Example:
       *
       * Clock started 4 hours ago,
       * POM was closed,
       * user opens it now.
       *
       * Ask the server if a reminder is due.
       */
      void runReminder();
    } else {
      scheduleAt(
        firstReminder,
      );
    }

    return () => {
      cancelled =
        true;

      if (
        timeoutId !==
        null
      ) {
        window.clearTimeout(
          timeoutId,
        );
      }
    };
  }, [
    activeSession?.startTime,
    activeSession?.userId,
  ]);

  /*
   * ------------------------------------------------
   * APP CLOSED WHILE CLOCK RUNS
   * ------------------------------------------------
   */
  useEffect(() => {
    if (
      !activeSession
    ) {
      return;
    }

    /*
     * Phones almost never fire "pagehide" when the
     * app is swiped away or the screen locks, but
     * they do fire "visibilitychange" first.
     *
     * Fire once per hidden episode.
     */
    let notifiedWhileHidden =
      false;

    const notifyClosed =
      () => {
        if (
          notifiedWhileHidden
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

        notifiedWhileHidden =
          true;

        /*
         * keepalive allows this small request
         * to continue while the page is
         * unloading or backgrounded.
         */
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

    const handleVisibility =
      () => {
        if (
          document.visibilityState ===
          "hidden"
        ) {
          notifyClosed();
        } else {
          notifiedWhileHidden =
            false;
        }
      };

    const handlePageHide =
      (
        event:
          PageTransitionEvent,
      ) => {
        /*
         * Don't treat the browser's
         * back-forward cache as a real close.
         */
        if (
          event.persisted
        ) {
          return;
        }

        notifyClosed();
      };

    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );

    window.addEventListener(
      "pagehide",
      handlePageHide,
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );

      window.removeEventListener(
        "pagehide",
        handlePageHide,
      );
    };
  }, [
    activeSession,
  ]);

  return null;
}