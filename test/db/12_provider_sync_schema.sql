-- pgTAP: Provider sync schema foundation (Phase 1).
-- Covers: can_sync_provider role gate, RLS isolation on the three new
-- tables, sync_policy defaults, vc_id uniqueness, the provider_sync enum
-- value, and immutability of committed import runs (INV-48).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(17);

-- -------------------------------------------------- attribution columns
SELECT has_column('public', 'provider_import_runs', 'committed_by',
  'provider_import_runs has a committed_by attribution column');
SELECT col_is_fk('public', 'provider_import_runs', 'imported_by',
  'imported_by references profiles(id)');
SELECT col_is_fk('public', 'provider_import_runs', 'committed_by',
  'committed_by references profiles(id)');

-- ---------------------------------------------------------------- role gate
\set owner_id  '''aaaaaaaa-0001-0000-0000-000000000001'''
\set admin_id  '''aaaaaaaa-0001-0000-0000-000000000002'''
\set agent_id  '''aaaaaaaa-0001-0000-0000-000000000003'''
\set tech_id   '''aaaaaaaa-0001-0000-0000-000000000004'''
\set norole_id '''aaaaaaaa-0001-0000-0000-000000000005'''

INSERT INTO public.user_roles (user_id, role) VALUES
  (:owner_id::uuid, 'owner'),
  (:admin_id::uuid, 'admin_office'),
  (:agent_id::uuid, 'collection_agent'),
  (:tech_id::uuid,  'technician');

SELECT ok( public.can_sync_provider(:owner_id::uuid),     'owner can sync provider');
SELECT ok( public.can_sync_provider(:admin_id::uuid),     'admin_office can sync provider');
SELECT ok(NOT public.can_sync_provider(:agent_id::uuid),  'collection_agent cannot sync provider');
SELECT ok(NOT public.can_sync_provider(:tech_id::uuid),   'technician cannot sync provider');
SELECT ok(NOT public.can_sync_provider(:norole_id::uuid), 'no-role user cannot sync provider');

-- --------------------------------------------------------------- enum value
SELECT ok(
  'provider_sync' = ANY (
    SELECT unnest(enum_range(NULL::public.transaction_source))::text
  ),
  'transaction_source has provider_sync'
);

-- ------------------------------------------------------- sync_policy default
DO $$
DECLARE
  v_user uuid := gen_random_uuid();
  v_prov uuid;
BEGIN
  INSERT INTO public.providers (user_id, name, service_type)
    VALUES (v_user, 'pgtap-provider', 'cable')
    RETURNING id INTO v_prov;
  PERFORM set_config('lovable.p1_user', v_user::text, true);
  PERFORM set_config('lovable.p1_prov', v_prov::text, true);
END $$;

SELECT is(
  (SELECT sync_policy->>'create_charges' FROM public.providers
    WHERE id = current_setting('lovable.p1_prov')::uuid),
  'true',
  'sync_policy defaults create_charges to true'
);

SELECT is(
  (SELECT sync_policy->>'update_identity_name' FROM public.providers
    WHERE id = current_setting('lovable.p1_prov')::uuid),
  'false',
  'sync_policy denies identity writes by default (INV-49)'
);

-- -------------------------------------------------------- vc_id uniqueness
DO $$
DECLARE
  v_user uuid := current_setting('lovable.p1_user')::uuid;
BEGIN
  INSERT INTO public.stb_inventory (user_id, serial_number, status, device_type, service_type, vc_id)
    VALUES (v_user, 'PGTAP-STB-1', 'available', 'stb', 'cable', 'VC-0001');
  -- NULL vc_id must not collide
  INSERT INTO public.stb_inventory (user_id, serial_number, status, device_type, service_type, vc_id)
    VALUES (v_user, 'PGTAP-STB-2', 'available', 'stb', 'cable', NULL);
  INSERT INTO public.stb_inventory (user_id, serial_number, status, device_type, service_type, vc_id)
    VALUES (v_user, 'PGTAP-STB-3', 'available', 'stb', 'cable', NULL);
END $$;

SELECT throws_ok(
  format(
    'INSERT INTO public.stb_inventory (user_id, serial_number, status, device_type, service_type, vc_id)
       VALUES (%L, %L, %L, %L, %L, %L)',
    current_setting('lovable.p1_user'), 'PGTAP-STB-4', 'available', 'stb', 'cable', 'VC-0001'
  ),
  '23505',
  NULL,
  'duplicate vc_id for the same operator is rejected'
);

-- -------------------------------------- committed import run immutability
DO $$
DECLARE
  v_user uuid := current_setting('lovable.p1_user')::uuid;
  v_prov uuid := current_setting('lovable.p1_prov')::uuid;
  v_draft uuid;
  v_done  uuid;
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (v_user, 'pgtap-p1@example.com')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.provider_import_runs (user_id, provider_id, report_type, status)
    VALUES (v_user, v_prov, 'customer_master', 'draft')
    RETURNING id INTO v_draft;

  INSERT INTO public.provider_import_runs (user_id, provider_id, report_type, status, committed_at)
    VALUES (v_user, v_prov, 'customer_master', 'committed', now())
    RETURNING id INTO v_done;

  PERFORM set_config('lovable.p1_draft', v_draft::text, true);
  PERFORM set_config('lovable.p1_done',  v_done::text,  true);
END $$;

SELECT lives_ok(
  format('UPDATE public.provider_import_runs SET results = ''{"a":1}''::jsonb WHERE id = %L',
         current_setting('lovable.p1_draft')),
  'a draft run can still be edited'
);

SELECT throws_ok(
  format('UPDATE public.provider_import_runs SET results = ''{"a":1}''::jsonb WHERE id = %L',
         current_setting('lovable.p1_done')),
  NULL,
  'Committed provider import runs are immutable',
  'a committed run cannot be rewritten (INV-48)'
);

SELECT throws_ok(
  format('DELETE FROM public.provider_import_runs WHERE id = %L',
         current_setting('lovable.p1_done')),
  NULL,
  'Committed provider import runs cannot be deleted',
  'a committed run cannot be deleted (INV-48)'
);

-- ------------------------------------------------------------ RLS isolation
DO $$
DECLARE
  v_user_b uuid := current_setting('lovable.p1_user')::uuid;
  v_user_a uuid := gen_random_uuid();
  v_sub_b  uuid;
BEGIN
  INSERT INTO public.subscribers (id, user_id, name, subscriber_id, services)
    VALUES (gen_random_uuid(), v_user_b, 'p1-sub-b', 'PGTAP-P1-B', ARRAY['cable'])
    RETURNING id INTO v_sub_b;

  INSERT INTO public.subscriber_provider_state (user_id, subscriber_id, provider_id, provider_status)
    VALUES (v_user_b, v_sub_b, current_setting('lovable.p1_prov')::uuid, 'ACTIVE');

  INSERT INTO public.provider_pack_mappings (user_id, provider_id, provider_plan_key)
    VALUES (v_user_b, current_setting('lovable.p1_prov')::uuid, 'KANNADA-BASIC');

  PERFORM set_config('lovable.p1_user_a', v_user_a::text, true);
END $$;

SET LOCAL role authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('lovable.p1_user_a'), 'role', 'authenticated')::text,
  true);

SELECT is(
  (SELECT count(*)::int FROM public.provider_import_runs),
  0,
  'RLS hides another operator''s import runs'
);

SELECT is(
  (SELECT count(*)::int FROM public.subscriber_provider_state),
  0,
  'RLS hides another operator''s subscriber provider state'
);

SELECT is(
  (SELECT count(*)::int FROM public.provider_pack_mappings),
  0,
  'RLS hides another operator''s pack mappings'
);

RESET role;

SELECT * FROM finish();
ROLLBACK;
