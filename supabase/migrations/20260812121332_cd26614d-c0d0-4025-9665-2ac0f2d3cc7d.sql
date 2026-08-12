CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, team_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed in can read team members"
ON public.team_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage team members"
ON public.team_members FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role));

INSERT INTO public.team_members (user_id, team_id)
SELECT p.id, p.team_id FROM public.profiles p
WHERE p.team_id IS NOT NULL
ON CONFLICT (user_id, team_id) DO NOTHING;

DROP POLICY IF EXISTS "Read rsvps scoped to team or self" ON public.rsvps;

CREATE POLICY "Read rsvps scoped to team or self"
ON public.rsvps FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role)
  OR EXISTS (
    SELECT 1 FROM public.meetings m
    JOIN public.team_members viewer ON viewer.user_id = auth.uid()
    WHERE m.id = rsvps.meeting_id AND m.team_id IS NOT NULL AND m.team_id = viewer.team_id
  )
  OR EXISTS (
    SELECT 1 FROM public.meetings m
    JOIN public.team_members viewer ON viewer.user_id = auth.uid()
    JOIN public.team_members owner ON owner.user_id = rsvps.user_id AND owner.team_id = viewer.team_id
    WHERE m.id = rsvps.meeting_id AND m.team_id IS NULL
  )
);