-- Tighten RSVP visibility: general (team_id IS NULL) meetings no longer expose
-- every member's attendance to every signed-in user.
DROP POLICY IF EXISTS "Read rsvps for own team meetings" ON public.rsvps;

CREATE POLICY "Read rsvps scoped to team or self"
ON public.rsvps
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role
  )
  OR EXISTS (
    SELECT 1
    FROM public.meetings m
    JOIN public.profiles viewer ON viewer.id = auth.uid()
    WHERE m.id = rsvps.meeting_id
      AND m.team_id IS NOT NULL
      AND m.team_id = viewer.team_id
  )
  OR EXISTS (
    SELECT 1
    FROM public.meetings m
    JOIN public.profiles viewer ON viewer.id = auth.uid()
    JOIN public.profiles owner ON owner.id = rsvps.user_id
    WHERE m.id = rsvps.meeting_id
      AND m.team_id IS NULL
      AND viewer.team_id IS NOT NULL
      AND owner.team_id = viewer.team_id
  )
);

-- Emails stay unreadable by ordinary signed-in users (column-level privileges).
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, name, avatar_url, team_id, created_at) ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;