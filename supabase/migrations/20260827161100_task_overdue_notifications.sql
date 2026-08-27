-- Task overdue notification history.
--
-- We already use push_reminders_sent for one-time RSVP reminders.
-- Extend that table instead of creating a parallel reminder system.

ALTER TABLE public.push_reminders_sent
  ADD COLUMN IF NOT EXISTS task_id uuid
    REFERENCES public.tasks(id)
    ON DELETE CASCADE;

ALTER TABLE public.push_reminders_sent
  ADD COLUMN IF NOT EXISTS task_deadline date;

CREATE INDEX IF NOT EXISTS push_reminders_sent_task_idx
  ON public.push_reminders_sent (task_id);

CREATE UNIQUE INDEX IF NOT EXISTS push_reminders_sent_task_overdue_unique
  ON public.push_reminders_sent (
    user_id,
    task_id,
    task_deadline,
    kind
  );