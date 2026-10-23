-- Keep the 15-minute reminder cadence, but avoid waking the Lovable backend
-- when Supabase can prove there is no reminder work to do.

CREATE OR REPLACE FUNCTION public.pom_meeting_occurs_on_date(
  base_date date,
  recurrence text,
  target_date date
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  cursor_date date := base_date;
  recurrence_value text := COALESCE(recurrence, 'none');
  guard integer := 0;
BEGIN
  IF cursor_date IS NULL OR target_date IS NULL OR cursor_date > target_date THEN
    RETURN false;
  END IF;

  IF recurrence_value = 'none' THEN
    RETURN cursor_date = target_date;
  END IF;

  WHILE cursor_date < target_date AND guard < 5000 LOOP
    guard := guard + 1;

    IF recurrence_value = 'daily' THEN
      cursor_date := cursor_date + 1;
    ELSIF recurrence_value = 'weekly' THEN
      cursor_date := cursor_date + 7;
    ELSIF recurrence_value = 'biweekly' THEN
      cursor_date := cursor_date + 14;
    ELSE
      -- Match JavaScript Date#setUTCMonth behavior used by the app, including
      -- overflow such as Jan 31 -> Mar 3 instead of clamping to February.
      cursor_date :=
        (date_trunc('month', cursor_date::timestamp) + interval '1 month')::date
        + (extract(day from cursor_date)::integer - 1);
    END IF;
  END LOOP;

  RETURN cursor_date = target_date;
END;
$$;

REVOKE ALL ON FUNCTION public.pom_meeting_occurs_on_date(date, text, date)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reminder_sweep_needed()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  utc_today date := (now() AT TIME ZONE 'UTC')::date;
  local_today date := (now() AT TIME ZONE 'Asia/Jerusalem')::date;
BEGIN
  -- Long-running Clock reminders.
  IF EXISTS (
    SELECT 1
    FROM public.active_timers timer
    LEFT JOIN public.user_preferences preference
      ON preference.user_id = timer.user_id
     AND preference.preference_key = 'clock_reminders'
    WHERE COALESCE(timer.last_reminded_at, timer.started_at)
            <= now() - interval '3 hours'
      AND COALESCE(preference.enabled, true)
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions subscription
        WHERE subscription.user_id = timer.user_id
      )
  ) THEN
    RETURN true;
  END IF;

  -- Overdue task reminders for mentioned users who have not been notified yet.
  IF EXISTS (
    SELECT 1
    FROM public.tasks task
    JOIN public.user_notifications notification
      ON notification.task_id = task.id
     AND notification.title = 'You were mentioned'
    WHERE task.deadline < utc_today
      AND task.status <> 'Done'
      AND task.deleted_at IS NULL
      AND task.archived_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions subscription
        WHERE subscription.user_id = notification.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_reminders_sent sent
        WHERE sent.user_id = notification.user_id
          AND sent.task_id = task.id
          AND sent.kind = 'task_overdue:' || task.id::text
      )
  ) THEN
    RETURN true;
  END IF;

  -- RSVP reminders. This mirrors the audience rules used by push.server.ts.
  IF EXISTS (
    SELECT 1
    FROM public.meetings meeting
    CROSS JOIN LATERAL (
      SELECT profile.id AS user_id
      FROM public.profiles profile
      WHERE meeting.team_id IS NULL

      UNION

      SELECT membership.user_id
      FROM public.team_members membership
      WHERE meeting.team_id IS NOT NULL
        AND membership.team_id = meeting.team_id
    ) audience
    WHERE meeting.locked IS NOT TRUE
      AND meeting.date BETWEEN utc_today AND utc_today + 1
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions subscription
        WHERE subscription.user_id = audience.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_roles role
        WHERE role.user_id = audience.user_id
          AND role.role = 'mentor'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.rsvps rsvp
        WHERE rsvp.meeting_id = meeting.id
          AND rsvp.user_id = audience.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_reminders_sent sent
        WHERE sent.meeting_id = meeting.id
          AND sent.user_id = audience.user_id
          AND sent.kind = 'rsvp_reminder'
      )
  ) THEN
    RETURN true;
  END IF;

  -- Attendance / "forgot to start Clock" reminders.
  IF EXISTS (
    SELECT 1
    FROM public.meetings meeting
    JOIN public.rsvps rsvp
      ON rsvp.meeting_id = meeting.id
     AND rsvp.status = 'Attending'
    JOIN public.profiles profile
      ON profile.id = rsvp.user_id
    WHERE public.pom_meeting_occurs_on_date(
            meeting.date,
            meeting.recurrence,
            local_today
          )
      AND now() >=
        ((local_today + meeting.time::time) AT TIME ZONE 'Asia/Jerusalem')
        + interval '15 minutes'
      AND now() <=
        ((local_today + meeting.time::time) AT TIME ZONE 'Asia/Jerusalem')
        + interval '2 hours'
      AND profile.attendance_clock_reminders IS NOT FALSE
      AND EXISTS (
        SELECT 1
        FROM public.push_subscriptions subscription
        WHERE subscription.user_id = rsvp.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_roles role
        WHERE role.user_id = rsvp.user_id
          AND role.role = 'mentor'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.active_timers timer
        WHERE timer.user_id = rsvp.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_reminders_sent sent
        WHERE sent.user_id = rsvp.user_id
          AND sent.kind = 'clock_start_reminder:' || local_today::text
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.reminder_sweep_needed()
FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'pom-reminder-sweep-every-15-minutes'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'pom-reminder-sweep-every-15-minutes',
  '*/15 * * * *',
  $schedule$
  SELECT net.http_post(
    url := 'https://project--c11935a5-ee7e-4587-be68-7b15386ac081.lovable.app/api/public/cron/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT secret
        FROM public.scheduler_secrets
        WHERE name = 'reminder_sweep'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id
  WHERE public.reminder_sweep_needed();
  $schedule$
);
