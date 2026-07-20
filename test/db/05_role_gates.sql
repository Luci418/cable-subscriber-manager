-- pgTAP: role-gate helper functions.
-- We seed a synthetic user per role and assert each helper returns the
-- expected boolean. The helpers only read public.user_roles, so we do not
-- need to touch auth.users.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

-- Synthetic user ids
\set owner_id     '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
\set admin_id     '''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'''
\set agent_id     '''cccccccc-cccc-cccc-cccc-cccccccccccc'''
\set tech_id      '''dddddddd-dddd-dddd-dddd-dddddddddddd'''
\set norole_id    '''eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'''

INSERT INTO public.user_roles (user_id, role) VALUES
  (:owner_id::uuid,     'owner'),
  (:admin_id::uuid,     'admin_office'),
  (:agent_id::uuid,     'collection_agent'),
  (:tech_id::uuid,      'technician');

-- can_void_transaction  → owner ✓, admin ✓, agent ✗, tech ✗, no-role ✗
SELECT ok( public.can_void_transaction(:owner_id::uuid),      'owner can void');
SELECT ok( public.can_void_transaction(:admin_id::uuid),      'admin_office can void');
SELECT ok(NOT public.can_void_transaction(:agent_id::uuid),   'collection_agent cannot void');
SELECT ok(NOT public.can_void_transaction(:tech_id::uuid),    'technician cannot void');
SELECT ok(NOT public.can_void_transaction(:norole_id::uuid),  'user with no role cannot void');

-- can_archive_customer  → same shape
SELECT ok( public.can_archive_customer(:owner_id::uuid),      'owner can archive');
SELECT ok( public.can_archive_customer(:admin_id::uuid),      'admin_office can archive');
SELECT ok(NOT public.can_archive_customer(:agent_id::uuid),   'collection_agent cannot archive');
SELECT ok(NOT public.can_archive_customer(:tech_id::uuid),    'technician cannot archive');
SELECT ok(NOT public.can_archive_customer(:norole_id::uuid),  'no-role cannot archive');

-- can_view_credentials  → owner ✓, admin ✓, tech ✓, agent ✗, no-role ✗
SELECT ok( public.can_view_credentials(:owner_id::uuid),      'owner can view credentials');
SELECT ok( public.can_view_credentials(:admin_id::uuid),      'admin_office can view credentials');
SELECT ok( public.can_view_credentials(:tech_id::uuid),       'technician can view credentials');
SELECT ok(NOT public.can_view_credentials(:agent_id::uuid),   'collection_agent cannot view credentials');
SELECT ok(NOT public.can_view_credentials(:norole_id::uuid),  'no-role cannot view credentials');

SELECT * FROM finish();
ROLLBACK;
