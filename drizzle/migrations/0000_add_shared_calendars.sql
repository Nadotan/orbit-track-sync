CREATE TABLE public.calendars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80), color text NOT NULL DEFAULT 'primary' CHECK (color IN ('primary','success','warning','destructive','chart-2')), created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.calendars TO authenticated;
GRANT ALL ON public.calendars TO service_role;
ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read calendars" ON public.calendars FOR SELECT TO authenticated USING (true);
CREATE TABLE public.calendar_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE, title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160), description text NOT NULL DEFAULT '', location text NOT NULL DEFAULT '', start_date date NOT NULL, end_date date NOT NULL, start_time text NOT NULL DEFAULT '09:00', end_time text NOT NULL DEFAULT '10:00', all_day boolean NOT NULL DEFAULT false, team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL, meeting_id uuid UNIQUE REFERENCES public.meetings(id) ON DELETE SET NULL, is_meeting boolean NOT NULL DEFAULT false, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), CHECK (end_date >= start_date)
);
GRANT SELECT ON public.calendar_events TO authenticated;
GRANT ALL ON public.calendar_events TO service_role;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read calendar events" ON public.calendar_events FOR SELECT TO authenticated USING (true);
CREATE INDEX calendar_events_range_idx ON public.calendar_events(start_date,end_date);
CREATE TABLE public.calendar_visibility (
 user_id uuid NOT NULL, calendar_id uuid NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE, hidden boolean NOT NULL DEFAULT false, PRIMARY KEY(user_id,calendar_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_visibility TO authenticated;
GRANT ALL ON public.calendar_visibility TO service_role;
ALTER TABLE public.calendar_visibility ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own calendar visibility" ON public.calendar_visibility FOR ALL TO authenticated USING (user_id=auth.uid()) WITH CHECK (user_id=auth.uid());
CREATE FUNCTION public.sync_calendar_meeting() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF OLD.meeting_id IS NOT NULL THEN DELETE FROM public.meetings WHERE id=OLD.meeting_id; END IF;
  RETURN OLD;
 END IF;
 IF NEW.is_meeting THEN
  IF NEW.meeting_id IS NULL THEN
   INSERT INTO public.meetings(title,date,time,team_id,recurrence,locked) VALUES(NEW.title,NEW.start_date,CASE WHEN NEW.all_day THEN '09:00' ELSE NEW.start_time END,NEW.team_id,'none',false) RETURNING id INTO NEW.meeting_id;
  ELSE
   UPDATE public.meetings SET title=NEW.title,date=NEW.start_date,time=CASE WHEN NEW.all_day THEN '09:00' ELSE NEW.start_time END,team_id=NEW.team_id WHERE id=NEW.meeting_id;
  END IF;
 ELSIF NEW.meeting_id IS NOT NULL THEN
  DELETE FROM public.meetings WHERE id=NEW.meeting_id;
  NEW.meeting_id := NULL;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_calendar_meeting() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_calendar_meeting() TO service_role;
CREATE TRIGGER calendar_event_meeting_sync BEFORE INSERT OR UPDATE OR DELETE ON public.calendar_events FOR EACH ROW EXECUTE FUNCTION public.sync_calendar_meeting();