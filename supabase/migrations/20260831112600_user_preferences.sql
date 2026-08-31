BEGIN;

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (user_id, preference_key),

  CONSTRAINT user_preferences_key_valid CHECK (
    length(trim(preference_key)) BETWEEN 1 AND 80
  )
);

CREATE INDEX IF NOT EXISTS user_preferences_key_idx
ON public.user_preferences(preference_key, enabled);

ALTER TABLE public.user_preferences
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.user_preferences
FROM anon, authenticated;

GRANT ALL
ON public.user_preferences
TO service_role;

COMMIT;