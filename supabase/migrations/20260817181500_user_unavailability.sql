BEGIN;

CREATE TABLE IF NOT EXISTS public.user_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

ALTER TABLE public.user_unavailability ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE
ON public.user_unavailability
TO authenticated;

GRANT ALL
ON public.user_unavailability
TO service_role;

DROP POLICY IF EXISTS "Users read own unavailability"
ON public.user_unavailability;

DROP POLICY IF EXISTS "Admins read all unavailability"
ON public.user_unavailability;

DROP POLICY IF EXISTS "Users insert own unavailability"
ON public.user_unavailability;

DROP POLICY IF EXISTS "Users delete own unavailability"
ON public.user_unavailability;

CREATE POLICY "Users read own unavailability"
ON public.user_unavailability
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
);

CREATE POLICY "Admins read all unavailability"
ON public.user_unavailability
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'admin'::public.app_role
  )
);

CREATE POLICY "Users insert own unavailability"
ON public.user_unavailability
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
);

CREATE POLICY "Users delete own unavailability"
ON public.user_unavailability
FOR DELETE
TO authenticated
USING (
  user_id = (SELECT auth.uid())
);

CREATE INDEX IF NOT EXISTS user_unavailability_date_idx
ON public.user_unavailability(date);

COMMIT;