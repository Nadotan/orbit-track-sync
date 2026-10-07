CREATE POLICY "Mentors read all rsvps"
ON public.rsvps
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = 'mentor'::public.app_role
  )
);