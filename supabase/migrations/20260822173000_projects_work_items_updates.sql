BEGIN;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS deadline date;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'To Do';

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium';

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS blocked_reason text NOT NULL DEFAULT '';

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE public.projects
SET owner_id = created_by
WHERE owner_id IS NULL;

ALTER TABLE public.projects
ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_status_valid'
  ) THEN
    ALTER TABLE public.projects
    ADD CONSTRAINT projects_status_valid
      CHECK (
        status IN (
          'To Do',
          'In Progress',
          'Blocked',
          'Done'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_priority_valid'
  ) THEN
    ALTER TABLE public.projects
    ADD CONSTRAINT projects_priority_valid
      CHECK (
        priority IN (
          'Low',
          'Medium',
          'High',
          'Critical'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_blocked_reason_required'
  ) THEN
    ALTER TABLE public.projects
    ADD CONSTRAINT projects_blocked_reason_required
      CHECK (
        status <> 'Blocked'
        OR length(trim(blocked_reason)) > 0
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_owner_id_idx
ON public.projects(owner_id);

CREATE INDEX IF NOT EXISTS projects_deadline_idx
ON public.projects(deadline);

CREATE INDEX IF NOT EXISTS projects_status_idx
ON public.projects(status);

CREATE INDEX IF NOT EXISTS projects_deleted_at_idx
ON public.projects(deleted_at);

CREATE INDEX IF NOT EXISTS tasks_deleted_at_idx
ON public.tasks(deleted_at);

CREATE TABLE IF NOT EXISTS public.work_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_time_entry_id uuid UNIQUE REFERENCES public.time_entries(id) ON DELETE SET NULL,
  duration_ms bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT work_updates_one_parent
    CHECK (
      (task_id IS NOT NULL AND project_id IS NULL)
      OR
      (task_id IS NULL AND project_id IS NOT NULL)
    ),

  CONSTRAINT work_updates_body_not_empty
    CHECK (length(trim(body)) > 0),

  CONSTRAINT work_updates_source_valid
    CHECK (source IN ('manual', 'clock'))
);

CREATE INDEX IF NOT EXISTS work_updates_task_id_created_at_idx
ON public.work_updates(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS work_updates_project_id_created_at_idx
ON public.work_updates(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS work_updates_author_id_idx
ON public.work_updates(author_id);

ALTER TABLE public.work_updates
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.work_updates
FROM anon, authenticated;

GRANT ALL
ON public.work_updates
TO service_role;

CREATE OR REPLACE FUNCTION public.sync_work_update_from_time_entry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.task_id IS NULL OR length(trim(COALESCE(NEW.description, ''))) = 0 THEN
    DELETE FROM public.work_updates
    WHERE source_time_entry_id = NEW.id;

    RETURN NEW;
  END IF;

  INSERT INTO public.work_updates (
    task_id,
    project_id,
    author_id,
    body,
    source,
    source_time_entry_id,
    duration_ms,
    created_at,
    updated_at
  )
  VALUES (
    NEW.task_id,
    NULL,
    NEW.user_id,
    trim(NEW.description),
    'clock',
    NEW.id,
    NEW.duration_ms,
    NEW.end_time,
    now()
  )
  ON CONFLICT (source_time_entry_id)
  DO UPDATE SET
    task_id = EXCLUDED.task_id,
    project_id = NULL,
    author_id = EXCLUDED.author_id,
    body = EXCLUDED.body,
    source = 'clock',
    duration_ms = EXCLUDED.duration_ms,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_work_update_from_time_entry_trigger
ON public.time_entries;

CREATE TRIGGER sync_work_update_from_time_entry_trigger
AFTER INSERT OR UPDATE OF description, task_id, duration_ms
ON public.time_entries
FOR EACH ROW
EXECUTE FUNCTION public.sync_work_update_from_time_entry();

INSERT INTO public.work_updates (
  task_id,
  project_id,
  author_id,
  body,
  source,
  source_time_entry_id,
  duration_ms,
  created_at,
  updated_at
)
SELECT
  entry.task_id,
  NULL,
  entry.user_id,
  trim(entry.description),
  'clock',
  entry.id,
  entry.duration_ms,
  entry.end_time,
  entry.end_time
FROM public.time_entries AS entry
WHERE entry.task_id IS NOT NULL
  AND length(trim(COALESCE(entry.description, ''))) > 0
ON CONFLICT (source_time_entry_id) DO NOTHING;

COMMIT;
