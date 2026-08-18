BEGIN;

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  deadline date NOT NULL,
  status text NOT NULL DEFAULT 'To Do',
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tasks_title_not_empty
    CHECK (length(trim(title)) > 0),

  CONSTRAINT tasks_status_valid
    CHECK (
      status IN (
        'To Do',
        'In Progress',
        'Blocked',
        'Done'
      )
    )
);

CREATE TABLE IF NOT EXISTS public.task_assignees (
  task_id uuid NOT NULL
    REFERENCES public.tasks(id)
    ON DELETE CASCADE,

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  assigned_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS tasks_team_id_idx
ON public.tasks(team_id);

CREATE INDEX IF NOT EXISTS tasks_deadline_idx
ON public.tasks(deadline);

CREATE INDEX IF NOT EXISTS tasks_status_idx
ON public.tasks(status);

CREATE INDEX IF NOT EXISTS task_assignees_user_id_idx
ON public.task_assignees(user_id);

ALTER TABLE public.tasks
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.task_assignees
ENABLE ROW LEVEL SECURITY;

/*
 * Tasks are intentionally accessed only through
 * authenticated server functions.
 *
 * The service-role client performs the database work
 * after the server has checked the caller's permissions.
 */
REVOKE ALL
ON public.tasks
FROM anon, authenticated;

REVOKE ALL
ON public.task_assignees
FROM anon, authenticated;

GRANT ALL
ON public.tasks
TO service_role;

GRANT ALL
ON public.task_assignees
TO service_role;

COMMIT;