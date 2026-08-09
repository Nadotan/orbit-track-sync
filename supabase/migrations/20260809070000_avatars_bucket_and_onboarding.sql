-- AVATARS BUCKET (Lovable stopped right before this step — the storage
-- policies in the first migration already assume this bucket exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ONBOARDING FLAG
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;