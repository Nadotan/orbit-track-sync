BEGIN;

CREATE TABLE IF NOT EXISTS public.workshop_status (
  id smallint PRIMARY KEY DEFAULT 1,

  is_open boolean NOT NULL DEFAULT true,

  updated_at timestamptz NOT NULL DEFAULT now(),

  updated_by uuid
    REFERENCES auth.users(id)
    ON DELETE SET NULL,

  CONSTRAINT workshop_status_single_row
    CHECK (id = 1)
);

INSERT INTO public.workshop_status (
  id,
  is_open
)
VALUES (
  1,
  true
)
ON CONFLICT (id)
DO NOTHING;

ALTER TABLE public.workshop_status
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.workshop_status
FROM anon, authenticated;

GRANT ALL
ON public.workshop_status
TO service_role;

COMMIT;