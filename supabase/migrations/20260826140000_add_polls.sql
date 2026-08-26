-- Polls / Question of the Day
-- One migration: schema, constraints, grants and RLS.

CREATE TABLE public.polls (
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

CREATE INDEX polls_active_idx
  ON public.polls (closes_at, published_at DESC);

CREATE INDEX polls_created_at_idx
  ON public.polls (created_at DESC);


CREATE TABLE public.poll_options (
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

CREATE INDEX poll_options_poll_idx
  ON public.poll_options (poll_id, position);


CREATE TABLE public.poll_votes (
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

CREATE INDEX poll_votes_option_idx
  ON public.poll_votes (poll_id, option_id);


ALTER TABLE public.polls
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.poll_options
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.poll_votes
ENABLE ROW LEVEL SECURITY;


-- App writes go through authenticated TanStack server functions.
-- Normal authenticated clients only get read access.

GRANT SELECT
ON public.polls,
   public.poll_options,
   public.poll_votes
TO authenticated;

GRANT ALL
ON public.polls,
   public.poll_options,
   public.poll_votes
TO service_role;

REVOKE ALL
ON public.polls,
   public.poll_options,
   public.poll_votes
FROM anon;


CREATE POLICY "Signed in users can read published polls"
ON public.polls
FOR SELECT
TO authenticated
USING (
  published_at <= now()
);


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


CREATE POLICY "Users can read their own poll votes"
ON public.poll_votes
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
);