BEGIN;

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT projects_name_not_empty
    CHECK (length(trim(name)) > 0)
);

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS blocked_reason text NOT NULL DEFAULT '';

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.tasks
SET owner_id = created_by
WHERE owner_id IS NULL;

ALTER TABLE public.tasks
ALTER COLUMN owner_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tasks_priority_valid'
  ) THEN
    ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_priority_valid
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
    WHERE conname = 'tasks_blocked_reason_required'
  ) THEN
    ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_blocked_reason_required
      CHECK (
        status <> 'Blocked'
        OR length(trim(blocked_reason)) > 0
      );
  END IF;
END $$;

ALTER TABLE public.time_entries
ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_team_id_idx
ON public.projects(team_id);

CREATE INDEX IF NOT EXISTS projects_archived_at_idx
ON public.projects(archived_at);

CREATE INDEX IF NOT EXISTS tasks_priority_idx
ON public.tasks(priority);

CREATE INDEX IF NOT EXISTS tasks_owner_id_idx
ON public.tasks(owner_id);

CREATE INDEX IF NOT EXISTS tasks_project_id_idx
ON public.tasks(project_id);

CREATE INDEX IF NOT EXISTS tasks_archived_at_idx
ON public.tasks(archived_at);

CREATE INDEX IF NOT EXISTS time_entries_task_id_idx
ON public.time_entries(task_id);

ALTER TABLE public.projects
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON public.projects
FROM anon, authenticated;

GRANT ALL
ON public.projects
TO service_role;

COMMIT;
