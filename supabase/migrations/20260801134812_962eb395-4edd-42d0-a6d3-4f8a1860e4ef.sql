ALTER TABLE public.provider_import_runs
  ADD COLUMN IF NOT EXISTS committed_by uuid;

-- Clean any orphaned references before adding FKs
UPDATE public.provider_import_runs r
  SET imported_by = NULL
  WHERE imported_by IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = r.imported_by);

ALTER TABLE public.provider_import_runs
  ADD CONSTRAINT provider_import_runs_imported_by_fkey
  FOREIGN KEY (imported_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.provider_import_runs
  ADD CONSTRAINT provider_import_runs_committed_by_fkey
  FOREIGN KEY (committed_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.provider_import_runs.imported_by IS 'Profile that uploaded/created this import run.';
COMMENT ON COLUMN public.provider_import_runs.committed_by IS 'Profile that approved/committed this import run (can_sync_provider gated); may differ from imported_by.';