
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Make pgcrypto functions resolvable inside SECURITY DEFINER RPCs.
ALTER FUNCTION public._credentials_key() SET search_path = public, extensions;
ALTER FUNCTION public.save_isp_identity_credentials(uuid, text, text, text, boolean) SET search_path = public, extensions;
ALTER FUNCTION public.save_onu_credentials(uuid, text, text, text, text, boolean) SET search_path = public, extensions;

-- Rewrite read RPC: internet-only credentials block (WiFi lives on the router/ONU).
CREATE OR REPLACE FUNCTION public.get_subscriber_credentials(p_subscriber_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sub public.subscribers;
  v_key text;
  v_internet_dev public.stb_inventory;
  v_internet_log public.device_assignment_log;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_view_credentials(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to view credentials.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sub FROM public.subscribers WHERE id = p_subscriber_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  v_key := public._credentials_key();

  SELECT * INTO v_internet_dev FROM public.stb_inventory
   WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
     AND status = 'assigned' AND service_type = 'internet'
   ORDER BY updated_at DESC LIMIT 1;

  IF v_internet_dev.id IS NOT NULL THEN
    SELECT * INTO v_internet_log FROM public.device_assignment_log
     WHERE user_id = v_uid AND subscriber_id = p_subscriber_id
       AND device_serial = v_internet_dev.serial_number
       AND closed_at IS NULL
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'identity', jsonb_build_object(
      'assigned_telephone', v_sub.assigned_telephone,
      'pppoe_username',     v_sub.pppoe_username,
      'pppoe_password',
        CASE WHEN v_sub.pppoe_password_encrypted IS NULL THEN NULL
             ELSE convert_from(pgp_sym_decrypt(decode(v_sub.pppoe_password_encrypted,'base64'), v_key), 'utf8') END
    ),
    'internet', CASE WHEN v_internet_dev.id IS NULL THEN NULL ELSE jsonb_build_object(
      'device_id',       v_internet_dev.id,
      'serial_number',   v_internet_dev.serial_number,
      'mac_address',     v_internet_dev.mac_address,
      'assignment_id',   v_internet_log.id,
      'wifi_ssid',       v_internet_log.wifi_ssid,
      'wifi_password',
        CASE WHEN v_internet_log.wifi_password_encrypted IS NULL THEN NULL
             ELSE convert_from(pgp_sym_decrypt(decode(v_internet_log.wifi_password_encrypted,'base64'), v_key), 'utf8') END,
      'onu_username',    v_internet_log.onu_username,
      'onu_password',
        CASE WHEN v_internet_log.onu_password_encrypted IS NULL THEN NULL
             ELSE convert_from(pgp_sym_decrypt(decode(v_internet_log.onu_password_encrypted,'base64'), v_key), 'utf8') END,
      'vlan_id',         v_internet_log.vlan_id
    ) END
  );
END;
$function$;

-- Repoint WiFi save to the internet device (router/ONU provides WiFi).
CREATE OR REPLACE FUNCTION public.save_wifi_credentials(
  p_subscriber_id uuid,
  p_wifi_ssid text,
  p_wifi_password text,
  p_clear_password boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
  v_enc text;
  v_log_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_view_credentials(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to edit credentials.' USING ERRCODE = '42501';
  END IF;

  SELECT dal.id INTO v_log_id
    FROM public.device_assignment_log dal
    JOIN public.stb_inventory inv
      ON inv.user_id = dal.user_id
     AND inv.serial_number = dal.device_serial
   WHERE dal.user_id = v_uid
     AND dal.subscriber_id = p_subscriber_id
     AND dal.service_type = 'internet'
     AND dal.closed_at IS NULL
     AND inv.status = 'assigned'
   ORDER BY dal.created_at DESC LIMIT 1;

  IF v_log_id IS NULL THEN
    RAISE EXCEPTION 'No paired internet device — pair a router/ONU to configure WiFi credentials.';
  END IF;

  IF p_clear_password THEN
    v_enc := NULL;
  ELSIF p_wifi_password IS NULL OR p_wifi_password = '' THEN
    SELECT wifi_password_encrypted INTO v_enc FROM public.device_assignment_log WHERE id = v_log_id;
  ELSE
    v_key := public._credentials_key();
    v_enc := encode(pgp_sym_encrypt(p_wifi_password, v_key), 'base64');
  END IF;

  UPDATE public.device_assignment_log
     SET wifi_ssid = NULLIF(btrim(p_wifi_ssid), ''),
         wifi_password_encrypted = v_enc,
         updated_at = now()
   WHERE id = v_log_id;
END;
$function$;
