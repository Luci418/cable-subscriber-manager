-- Phase 6.1 — Bootstrap-only owner grant trigger
--
-- The previous trigger auto-granted 'owner' to EVERY new auth signup, which
-- defeats RBAC as soon as the operator invites a collection agent or
-- technician (they would silently become owners).
--
-- Correct behaviour: the trigger only self-provisions the FIRST user in the
-- system as owner. Every subsequent signup receives NO role automatically —
-- an existing owner must explicitly grant a role via the Roles Management
-- UI. This preserves single-command bootstrapping for a fresh install while
-- restoring the RBAC boundary for multi-user tenants.
--
-- TODO(pre-production): Once the operator has completed initial bootstrap
-- and any additional owners have been provisioned, drop this trigger
-- entirely and manage all role assignments manually via the Roles UI. See
-- docs/PRODUCTION_READINESS.md § RBAC.

CREATE OR REPLACE FUNCTION public.grant_owner_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Bootstrap only: grant owner to the very first user of the system.
  -- Any signup after user_roles is populated receives no role automatically.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles LIMIT 1) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;