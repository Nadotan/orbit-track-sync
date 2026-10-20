ALTER TABLE public.calendars DROP CONSTRAINT IF EXISTS calendars_color_check;
ALTER TABLE public.calendars ADD CONSTRAINT calendars_color_check CHECK (color IN ('primary','success','warning','destructive','chart-2','chart-3','chart-4','chart-5'));
