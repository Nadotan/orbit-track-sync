ALTER POLICY "Users read own entries" ON public.time_entries USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Admins read all entries" ON public.time_entries USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'::public.app_role));
ALTER POLICY "Admins read notifications" ON public.notifications USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'::public.app_role));
ALTER POLICY "Users read own notifications" ON public.notifications USING (actor_id = (SELECT auth.uid()));
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON public.notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_user_start_idx ON public.time_entries (user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS time_entries_start_idx ON public.time_entries (start_time DESC);
CREATE INDEX IF NOT EXISTS rsvps_meeting_id_idx ON public.rsvps (meeting_id);
CREATE INDEX IF NOT EXISTS user_roles_user_role_idx ON public.user_roles (user_id, role);