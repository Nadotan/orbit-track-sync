-- Push delivery health + browser permission reporting.
-- Safe to run even if the earlier push health columns were already added manually.

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_success_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS last_failure_status integer,
  ADD COLUMN IF NOT EXISTS last_failure_message text;

CREATE INDEX IF NOT EXISTS push_subscriptions_user_health_idx
ON public.push_subscriptions (
  user_id,
  last_success_at DESC,
  last_failure_at DESC
);

CREATE TABLE IF NOT EXISTS public.push_clients (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  endpoint text,
  permission text NOT NULL CHECK (
    permission IN ('granted', 'denied', 'default', 'unsupported')
  ),
  ever_registered_at timestamp with time zone,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS push_clients_user_idx
ON public.push_clients (user_id);

CREATE INDEX IF NOT EXISTS push_clients_last_seen_idx
ON public.push_clients (last_seen_at DESC);

ALTER TABLE public.push_clients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_clients FROM anon, authenticated;
GRANT ALL ON public.push_clients TO service_role;