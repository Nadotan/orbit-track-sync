-- 1. Replace has_role() usage in policies with inline checks against user_roles

DROP POLICY IF EXISTS "Admins manage teams" ON public.teams;
CREATE POLICY "Admins manage teams" ON public.teams FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins update any profile" ON public.profiles;
CREATE POLICY "Admins update any profile" ON public.profiles FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins read all entries" ON public.time_entries;
CREATE POLICY "Admins read all entries" ON public.time_entries FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins manage meetings" ON public.meetings;
CREATE POLICY "Admins manage meetings" ON public.meetings FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins read active timers" ON public.active_timers;
CREATE POLICY "Admins read active timers" ON public.active_timers FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins read notifications" ON public.notifications;
CREATE POLICY "Admins read notifications" ON public.notifications FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Admins update notifications" ON public.notifications;
CREATE POLICY "Admins update notifications" ON public.notifications FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'));

DROP POLICY IF EXISTS "Users insert own rsvp on unlocked meetings" ON public.rsvps;
CREATE POLICY "Users insert own rsvp on unlocked meetings" ON public.rsvps FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = rsvps.meeting_id AND m.locked = false)
  )
);

DROP POLICY IF EXISTS "Users update own rsvp on unlocked meetings" ON public.rsvps;
CREATE POLICY "Users update own rsvp on unlocked meetings" ON public.rsvps FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
    OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = rsvps.meeting_id AND m.locked = false)
  )
);

-- 2. user_roles: own role only; admin role management moves to a secured server action
DROP POLICY IF EXISTS "Anyone signed in can read roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Users read own role" ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- 3. Remove the security definer helper that was executable by signed-in users
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);

-- 4. profiles: hide email from other members via column privileges
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, name, avatar_url, team_id, created_at) ON public.profiles TO authenticated;

-- 5. rsvps: scope reads to owner, admins, and members of the meeting's team
DROP POLICY IF EXISTS "Signed in can read rsvps" ON public.rsvps;
CREATE POLICY "Read rsvps for own team meetings" ON public.rsvps FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin')
  OR EXISTS (
    SELECT 1 FROM public.meetings m
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE m.id = rsvps.meeting_id AND (m.team_id IS NULL OR m.team_id = p.team_id)
  )
);

-- 6. notifications: tie creation to the acting user
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

DROP POLICY IF EXISTS "Signed in can create notifications" ON public.notifications;
CREATE POLICY "Users create notifications as themselves" ON public.notifications FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid());

DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated
USING (actor_id = auth.uid());