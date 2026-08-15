ALTER TABLE public.rsvps
ADD COLUMN IF NOT EXISTS cancelled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_rsvp_cancelled_flag()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- First response: Declined means "Not attended", not "Cancelled".
  IF TG_OP = 'INSERT' THEN
    NEW.cancelled := false;
    RETURN NEW;
  END IF;

  -- If the RSVP status did not change, preserve the current classification.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.cancelled := OLD.cancelled;
    RETURN NEW;
  END IF;

  -- Attending -> Declined is a cancellation.
  IF OLD.status = 'Attending' AND NEW.status = 'Declined' THEN
    NEW.cancelled := true;
  ELSE
    NEW.cancelled := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_rsvp_cancelled_flag ON public.rsvps;

CREATE TRIGGER set_rsvp_cancelled_flag
BEFORE INSERT OR UPDATE ON public.rsvps
FOR EACH ROW
EXECUTE FUNCTION public.set_rsvp_cancelled_flag();