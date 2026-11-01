-- Replace the expensive 15-minute reminder sweep with one cheap daily
-- day-before RSVP check.
--
-- After this migration:
--   * no Clock reminder polling
--   * no overdue-task reminder polling
--   * no 15-minute DB reminder sweep
--   * one DB guard per day
--   * Lovable is called only when a user with a push subscription is actually
--     missing an RSVP for a meeting occurring on the next Israel-local date

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

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
  IF cursor_date IS NULL
     OR target_date IS NULL
     OR cursor_date > target_date THEN
    RETURN false;
  END IF;

  IF recurrence_value = 'none' THEN
    RETURN cursor_date = target_date;
  END IF;

  WHILE cursor_date < target_date
    AND guard < 5000
  LOOP
    guard := guard + 1;

    IF recurrence_value = 'daily' THEN
      cursor_date := cursor_date + 1;
    ELSIF recurrence_value = 'weekly' THEN
      cursor_date := cursor_date + 7;
    ELSIF recurrence_value = 'biweekly' THEN
      cursor_date := cursor_date + 14;
    ELSE
      -- Match JavaScript Date#setUTCMonth overflow behavior used by the app.
      cursor_date :=
        (
          date_trunc(
            'month',
            cursor_date::timestamp
          )
          + interval '1 month'
        )::date
        + (
          extract(
            day
            FROM cursor_date
          )::integer
          - 1
        );
    END IF;
  END LOOP;

  RETURN cursor_date = target_date;
END;
$$;

REVOKE ALL
ON FUNCTION public.pom_meeting_occurs_on_date(
  date,
  text,
  date
)
FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rsvp_reminder_needed()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      (
        (
          now()
          AT TIME ZONE 'Asia/Jerusalem'
        )::date
        + 1
      ) AS target_date
  ),
  due_meetings AS (
    SELECT
      meeting.id,
      meeting.team_id
    FROM
      public.meetings AS meeting,
      params
    WHERE
      meeting.locked IS NOT TRUE
      AND meeting.date <= params.target_date
      AND public.pom_meeting_occurs_on_date(
        meeting.date,
        meeting.recurrence,
        params.target_date
      )
  )
  SELECT EXISTS (
    SELECT 1
    FROM due_meetings AS meeting
    CROSS JOIN LATERAL (
      SELECT
        profile.id AS user_id
      FROM
        public.profiles AS profile
      WHERE
        meeting.team_id IS NULL

      UNION

      SELECT
        membership.user_id
      FROM
        public.team_members AS membership
      WHERE
        meeting.team_id IS NOT NULL
        AND membership.team_id = meeting.team_id
    ) AS audience
    WHERE
      EXISTS (
        SELECT 1
        FROM public.push_subscriptions AS subscription
        WHERE
          subscription.user_id = audience.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_roles AS role
        WHERE
          role.user_id = audience.user_id
          AND role.role = 'mentor'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.rsvps AS rsvp
        WHERE
          rsvp.meeting_id = meeting.id
          AND rsvp.user_id = audience.user_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.push_reminders_sent AS sent
        WHERE
          sent.meeting_id = meeting.id
          AND sent.user_id = audience.user_id
          AND sent.kind = 'rsvp_reminder'
      )
  );
$$;

REVOKE ALL
ON FUNCTION public.rsvp_reminder_needed()
FROM PUBLIC, anon, authenticated;

-- Remove the previous general-purpose guard. It is intentionally no longer
-- part of the scheduling architecture.
DROP FUNCTION IF EXISTS public.reminder_sweep_needed();

-- Remove both the old 15-minute job and any previous copy of the new daily job.
DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'pom-reminder-sweep-every-15-minutes',
      'pom-rsvp-reminder-daily'
    )
  LOOP
    PERFORM cron.unschedule(
      existing_job.jobid
    );
  END LOOP;
END;
$$;

-- Run once per day at 16:00 UTC:
-- 18:00 Israel winter time / 19:00 Israel summer time.
--
-- The SQL WHERE guard means the Lovable endpoint is NOT called unless there
-- is at least one pending day-before RSVP reminder with a registered push
-- subscription.
SELECT cron.schedule(
  'pom-rsvp-reminder-daily',
  '0 16 * * *',
  $schedule$
  SELECT net.http_post(
    url :=
      'https://project--c11935a5-ee7e-4587-be68-7b15386ac081.lovable.app/api/public/cron/reminders',
    headers :=
      jsonb_build_object(
        'Content-Type',
        'application/json',
        'x-cron-secret',
        (
          SELECT secret
          FROM public.scheduler_secrets
          WHERE name = 'reminder_sweep'
        )
      ),
    body :=
      '{}'::jsonb
  ) AS request_id
  WHERE public.rsvp_reminder_needed();
  $schedule$
);