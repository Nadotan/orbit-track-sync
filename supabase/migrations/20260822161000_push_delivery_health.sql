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