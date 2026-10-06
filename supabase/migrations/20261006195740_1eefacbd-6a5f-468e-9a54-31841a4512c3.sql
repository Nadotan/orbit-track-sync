CREATE TABLE public.push_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 80),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 300),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.push_templates TO service_role;
ALTER TABLE public.push_templates ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER update_push_templates_updated_at
BEFORE UPDATE ON public.push_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();