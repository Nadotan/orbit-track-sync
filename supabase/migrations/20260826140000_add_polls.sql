-- Polls / Question of the Day
--
-- Safe to run on a clean database and safe to reconcile a database where this
-- schema was created manually before the migration file was committed.

CREATE TABLE IF NOT EXISTS public.polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  label text NOT NULL DEFAULT 'Question of the Day',
  question text NOT NULL,
  description text NOT NULL DEFAULT '',

  closes_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),

  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT polls_label_length
    CHECK (char_length(label) BETWEEN 1 AND 40),

  CONSTRAINT polls_question_length
    CHECK (char_length(question) BETWEEN 1 AND 240),

  CONSTRAINT polls_description_length
    CHECK (char_length(description) <= 500),

  CONSTRAINT polls_close_after_publish
    CHECK (closes_at > published_at)
);

CREATE INDEX IF NOT EXISTS polls_active_idx
  ON public.polls (closes_at, published_at DESC);

CREATE INDEX IF NOT EXISTS polls_created_at_idx
  ON public.polls (created_at DESC);


CREATE TABLE IF NOT EXISTS public.poll_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  poll_id uuid NOT NULL
    REFERENCES public.polls(id)
    ON DELETE CASCADE,

  label text NOT NULL,
  position integer NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT poll_options_label_length
    CHECK (char_length(label) BETWEEN 1 AND 80),

  CONSTRAINT poll_options_position_nonnegative
    CHECK (position >= 0),

  CONSTRAINT poll_options_poll_position_unique
    UNIQUE (poll_id, position),

  CONSTRAINT poll_options_poll_id_id_unique
    UNIQUE (poll_id, id)
);

CREATE INDEX IF NOT EXISTS poll_options_poll_idx
  ON public.poll_options (poll_id, position);


CREATE TABLE IF NOT EXISTS public.poll_votes (
  poll_id uuid NOT NULL
    REFERENCES public.polls(id)
    ON DELETE CASCADE,

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  option_id uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (poll_id, user_id),

  CONSTRAINT poll_votes_option_belongs_to_poll
    FOREIGN KEY (poll_id, option_id)
    REFERENCES public.poll_options(poll_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS poll_votes_option_idx
  ON public.poll_votes (poll_id, option_id);


ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes ENABLE ROW LEVEL SECURITY;


-- Writes are performed by authenticated TanStack server functions after
-- permission checks. Authenticated browser clients only need SELECT.
GRANT SELECT
ON TABLE
  public.polls,
  public.poll_options,
  public.poll_votes
TO authenticated;

GRANT ALL
ON TABLE
  public.polls,
  public.poll_options,
  public.poll_votes
TO service_role;

REVOKE ALL
ON TABLE
  public.polls,
  public.poll_options,
  public.poll_votes
FROM anon;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'polls'
      AND policyname = 'Signed in users can read published polls'
  ) THEN
    CREATE POLICY "Signed in users can read published polls"
    ON public.polls
    FOR SELECT
    TO authenticated
    USING (
      published_at <= now()
    );
  END IF;
END
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'poll_options'
      AND policyname = 'Signed in users can read published poll options'
  ) THEN
    CREATE POLICY "Signed in users can read published poll options"
    ON public.poll_options
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.polls p
        WHERE p.id = poll_options.poll_id
          AND p.published_at <= now()
      )
    );
  END IF;
END
$$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'poll_votes'
      AND policyname = 'Users can read their own poll votes'
  ) THEN
    CREATE POLICY "Users can read their own poll votes"
    ON public.poll_votes
    FOR SELECT
    TO authenticated
    USING (
      auth.uid() = user_id
    );
  END IF;
END
$$;