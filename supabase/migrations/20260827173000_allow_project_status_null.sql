-- Projects may exist without a workflow status.
-- Project deadline is already nullable.

ALTER TABLE public.projects
  ALTER COLUMN status DROP NOT NULL;

ALTER TABLE public.projects
  ALTER COLUMN status DROP DEFAULT;