DO $mig$
DECLARE
  src text;
  old_block text := E'        UPDATE public.transactions\n           SET source = ''provider_sync'',\n               description = description || '' \xc2\xb7 provider sync''\n         WHERE id = v_tx;';
  new_block text := E'        IF v_tx IS NOT NULL THEN\n          INSERT INTO public.transaction_notes (transaction_id, user_id, author_id, note)\n          VALUES (v_tx, v_uid, v_uid, ''Posted by provider sync run '' || p_run_id::text);\n        END IF;';
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'commit_provider_import';

  IF position('UPDATE public.transactions' in src) = 0 THEN
    RAISE NOTICE 'nothing to patch';
    RETURN;
  END IF;

  src := regexp_replace(
    src,
    'UPDATE public\.transactions\s+SET source = ''provider_sync'',\s+description = description \|\| ''[^'']*''\s+WHERE id = v_tx;',
    'IF v_tx IS NOT NULL THEN INSERT INTO public.transaction_notes (transaction_id, user_id, author_id, note) VALUES (v_tx, v_uid, v_uid, ''Posted by provider sync run '' || p_run_id::text); END IF;'
  );

  IF position('UPDATE public.transactions' in src) > 0 THEN
    RAISE EXCEPTION 'patch pattern did not match';
  END IF;

  EXECUTE 'CREATE OR REPLACE FUNCTION public.commit_provider_import(p_run_id uuid, p_decisions jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fnbody$' || src || '$fnbody$';
END
$mig$;