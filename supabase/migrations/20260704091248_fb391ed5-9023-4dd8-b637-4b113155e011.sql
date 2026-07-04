-- Phase 6.1 — support Roles Management UI
--
-- Owners need to enumerate all users to grant/revoke roles. Non-owners
-- retain the existing "view your own profile only" policy.
DROP POLICY IF EXISTS "Owners can view all profiles" ON public.profiles;
CREATE POLICY "Owners can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner'));

-- Owner-only helper: list every user with their roles in one call.
-- SECURITY DEFINER so it bypasses profiles RLS after re-checking the caller
-- is an owner. Returns empty for anyone else.
CREATE OR REPLACE FUNCTION public.list_users_with_roles()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  roles public.app_role[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Only owners can list users.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.full_name,
           COALESCE(
             (SELECT array_agg(ur.role ORDER BY ur.role)
                FROM public.user_roles ur WHERE ur.user_id = p.id),
             ARRAY[]::public.app_role[]
           )
      FROM public.profiles p
     ORDER BY p.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_with_roles() TO authenticated;