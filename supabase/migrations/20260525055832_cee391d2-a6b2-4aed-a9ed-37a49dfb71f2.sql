
ALTER TABLE public.complaints
  ADD COLUMN category TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium',
  ADD COLUMN resolution_notes TEXT;

-- Ensure valid values only
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_category_check
  CHECK (category = ANY (ARRAY['technical','billing','service','other']));

ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_priority_check
  CHECK (priority = ANY (ARRAY['low','medium','high']));
