-- Drop old vulnerable versions
DROP FUNCTION IF EXISTS public.is_region_in_use(text, uuid);
DROP FUNCTION IF EXISTS public.is_pack_in_use(text, uuid);

-- Recreate with SECURITY INVOKER and auth.uid()
CREATE OR REPLACE FUNCTION public.is_region_in_use(region_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
    WHERE region = region_name AND user_id = auth.uid()
  )
$$;

CREATE OR REPLACE FUNCTION public.is_pack_in_use(pack_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
    WHERE current_pack = pack_name AND user_id = auth.uid()
  )
$$;

-- Lock down execution to authenticated users only
REVOKE ALL ON FUNCTION public.is_region_in_use(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_pack_in_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_region_in_use(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_pack_in_use(text) TO authenticated;