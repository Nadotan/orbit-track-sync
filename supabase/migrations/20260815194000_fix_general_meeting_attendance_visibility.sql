BEGIN;

ALTER TABLE public.rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed in can read rsvps" ON public.rsvps;
DROP POLICY IF EXISTS "Read rsvps for own team meetings" ON public.rsvps;
DROP POLICY IF EXISTS "Read rsvps scoped to team or self" ON public.rsvps;
DROP POLICY IF EXISTS "Read visible meeting rsvps" ON public.rsvps;

CREATE POLICY "Read visible meeting rsvps"
ON public.rsvps
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())

  OR

  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'admin'::public.app_role
  )

  OR

  (
    status = 'Attending'
    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = rsvps.meeting_id
        AND (
          m.team_id IS NULL

          OR

          EXISTS (
            SELECT 1
            FROM public.team_members viewer
            WHERE viewer.user_id = (SELECT auth.uid())
              AND viewer.team_id = m.team_id
          )
        )
    )
  )
);

COMMIT;