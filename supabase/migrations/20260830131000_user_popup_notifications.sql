BEGIN;

CREATE TABLE IF NOT EXISTS public.user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  message text NOT NULL DEFAULT '',
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requires_ack boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  acknowledged_at timestamptz,
  popup_dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_notifications_kind_valid
    CHECK (
      kind IN (
        'announcement',
        'meeting',
        'task_assigned',
        'task_changed',
        'task_update'
      )
    ),

  CONSTRAINT user_notifications_title_valid
    CHECK (
      length(trim(title)) > 0
      AND length(title) <= 120
    ),

  CONSTRAINT user_notifications_message_valid
    CHECK (length(message) <= 2000)
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
ON public.user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
ON public.user_notifications(user_id, created_at DESC)
WHERE read_at IS NULL;

ALTER TABLE public.user_notifications
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.user_notifications
FROM anon, authenticated;

GRANT SELECT
ON public.user_notifications
TO authenticated;

GRANT UPDATE (
  read_at,
  acknowledged_at,
  popup_dismissed_at
)
ON public.user_notifications
TO authenticated;

GRANT ALL
ON public.user_notifications
TO service_role;

DROP POLICY IF EXISTS "Users read own user notifications"
ON public.user_notifications;

CREATE POLICY "Users read own user notifications"
ON public.user_notifications
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own user notification state"
ON public.user_notifications;

CREATE POLICY "Users update own user notification state"
ON public.user_notifications
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_notifications'
  ) THEN
    EXECUTE
      'ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications';
  END IF;
END
$$;

COMMIT;