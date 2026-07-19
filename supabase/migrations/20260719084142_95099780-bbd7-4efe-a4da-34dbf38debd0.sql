
CREATE OR REPLACE FUNCTION public.save_wifi_credentials(p_subscriber_id uuid, p_wifi_ssid text, p_wifi_password text, p_clear_password boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
  v_enc text;
  v_log_id uuid;
  v_dev public.stb_inventory;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_view_credentials(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to edit credentials.' USING ERRCODE = '42501';
  END IF;

  SELECT dal.id INTO v_log_id
    FROM public.device_assignment_log dal
    JOIN public.stb_inventory inv ON inv.user_id=dal.user_id AND inv.serial_number=dal.device_serial
   WHERE dal.user_id=v_uid AND dal.subscriber_id=p_subscriber_id
     AND dal.service_type='internet' AND dal.closed_at IS NULL AND inv.status='assigned'
   ORDER BY dal.created_at DESC LIMIT 1;

  IF v_log_id IS NULL THEN
    SELECT * INTO v_dev FROM public.stb_inventory
     WHERE user_id=v_uid AND subscriber_id=p_subscriber_id
       AND service_type='internet' AND status='assigned'
     ORDER BY updated_at DESC LIMIT 1;
    IF v_dev.id IS NULL THEN
      RAISE EXCEPTION 'No paired internet device — pair a router/ONU to configure WiFi credentials.';
    END IF;
    INSERT INTO public.device_assignment_log
      (user_id, subscriber_id, device_serial, device_type, service_type, opened_at, opened_by, open_reason)
    VALUES
      (v_uid, p_subscriber_id, v_dev.serial_number, v_dev.device_type, 'internet', now(), v_uid, 'legacy_assignment')
    RETURNING id INTO v_log_id;
  END IF;

  IF p_clear_password THEN
    v_enc := NULL;
  ELSIF p_wifi_password IS NULL OR p_wifi_password = '' THEN
    SELECT wifi_password_encrypted INTO v_enc FROM public.device_assignment_log WHERE id=v_log_id AND user_id=v_uid;
  ELSE
    v_key := public._credentials_key();
    v_enc := encode(extensions.pgp_sym_encrypt(p_wifi_password, v_key), 'base64');
  END IF;

  UPDATE public.device_assignment_log
     SET wifi_ssid = NULLIF(btrim(p_wifi_ssid), ''),
         wifi_password_encrypted = v_enc,
         updated_at = now()
   WHERE id=v_log_id AND user_id=v_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_onu_credentials(p_subscriber_id uuid, p_mac_address text, p_onu_username text, p_onu_password text, p_vlan_id text, p_clear_password boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
  v_enc text;
  v_log_id uuid;
  v_device_id uuid;
  v_dev public.stb_inventory;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_view_credentials(v_uid) THEN
    RAISE EXCEPTION 'You do not have permission to edit credentials.' USING ERRCODE = '42501';
  END IF;

  SELECT dal.id, inv.id INTO v_log_id, v_device_id
    FROM public.device_assignment_log dal
    JOIN public.stb_inventory inv ON inv.user_id=dal.user_id AND inv.serial_number=dal.device_serial
   WHERE dal.user_id=v_uid AND dal.subscriber_id=p_subscriber_id
     AND dal.service_type='internet' AND dal.closed_at IS NULL AND inv.status='assigned'
   ORDER BY dal.created_at DESC LIMIT 1;

  IF v_log_id IS NULL THEN
    SELECT * INTO v_dev FROM public.stb_inventory
     WHERE user_id=v_uid AND subscriber_id=p_subscriber_id
       AND service_type='internet' AND status='assigned'
     ORDER BY updated_at DESC LIMIT 1;
    IF v_dev.id IS NULL THEN
      RAISE EXCEPTION 'No paired internet device — pair a device to configure ONU credentials.';
    END IF;
    v_device_id := v_dev.id;
    INSERT INTO public.device_assignment_log
      (user_id, subscriber_id, device_serial, device_type, service_type, opened_at, opened_by, open_reason)
    VALUES
      (v_uid, p_subscriber_id, v_dev.serial_number, v_dev.device_type, 'internet', now(), v_uid, 'legacy_assignment')
    RETURNING id INTO v_log_id;
  END IF;

  IF p_clear_password THEN
    v_enc := NULL;
  ELSIF p_onu_password IS NULL OR p_onu_password = '' THEN
    SELECT onu_password_encrypted INTO v_enc FROM public.device_assignment_log WHERE id=v_log_id AND user_id=v_uid;
  ELSE
    v_key := public._credentials_key();
    v_enc := encode(extensions.pgp_sym_encrypt(p_onu_password, v_key), 'base64');
  END IF;

  UPDATE public.stb_inventory
     SET mac_address = NULLIF(btrim(p_mac_address), ''), updated_at = now()
   WHERE id=v_device_id AND user_id=v_uid;

  UPDATE public.device_assignment_log
     SET onu_username = NULLIF(btrim(p_onu_username), ''),
         onu_password_encrypted = v_enc,
         vlan_id = NULLIF(btrim(p_vlan_id), ''),
         updated_at = now()
   WHERE id=v_log_id AND user_id=v_uid;
END;
$function$;
