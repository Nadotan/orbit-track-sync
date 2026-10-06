-- lovable-cron-fallback-reviewed: 96 runs/day; time-based meeting, overdue-task and Clock reminders must arrive within ~15 minutes even when no one has the app open
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE public.scheduler_secrets (
  name text PRIMARY KEY,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.scheduler_secrets TO service_role;
ALTER TABLE public.scheduler_secrets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_scheduler_secrets_updated_at
BEFORE UPDATE ON public.scheduler_secrets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.scheduler_secrets (name, secret)
VALUES ('reminder_sweep', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

SELECT cron.schedule(
  'pom-reminder-sweep-every-15-minutes',
  '*/15 * * * *',
  $schedule$
  SELECT net.http_post(
    url := 'https://project--c11935a5-ee7e-4587-be68-7b15386ac081.lovable.app/api/public/cron/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT secret FROM public.scheduler_secrets WHERE name = 'reminder_sweep')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $schedule$
);