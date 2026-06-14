
-- View: latest active subscription per (subscriber, service) in JSONB-blob shape.
CREATE OR REPLACE VIEW public.v_subscriber_active_subscription
WITH (security_invoker = true) AS
SELECT DISTINCT ON (s.subscriber_id, s.service_type)
  s.user_id,
  s.subscriber_id,
  s.service_type,
  s.id            AS subscription_id,
  s.pack_id,
  s.provider_id,
  s.device_id,
  s.device_serial_snapshot,
  s.start_date,
  s.end_date,
  s.duration,
  s.total_days,
  s.total_charged,
  s.pack_name_snapshot   AS pack_name,
  s.pack_price_snapshot  AS pack_price,
  s.billing_type_snapshot,
  s.status,
  s.created_at,
  jsonb_build_object(
    'subscriptionId', s.id,
    'packId',         s.pack_id,
    'packName',       s.pack_name_snapshot,
    'packPrice',      s.pack_price_snapshot,
    'billingType',    s.billing_type_snapshot,
    'validityDays',   s.validity_days_snapshot,
    'duration',       s.duration,
    'totalDays',      s.total_days,
    'totalCharged',   s.total_charged,
    'startDate',      s.start_date,
    'endDate',        s.end_date,
    'status',         s.status,
    'providerId',     s.provider_id,
    'providerName',   p.name,
    'deviceId',       s.device_id,
    'stbNumber',      s.device_serial_snapshot,
    'subscribedAt',   s.created_at,
    'previousSubscriptionId', s.previous_subscription_id
  ) AS blob
FROM public.subscriptions s
LEFT JOIN public.providers p ON p.id = s.provider_id
WHERE s.status = 'active'
  AND s.end_date > CURRENT_DATE
ORDER BY s.subscriber_id, s.service_type, s.start_date DESC, s.created_at DESC;

GRANT SELECT ON public.v_subscriber_active_subscription TO authenticated;

-- View: full timeline per subscriber/service (active + history) in blob shape.
CREATE OR REPLACE VIEW public.v_subscriber_subscription_timeline
WITH (security_invoker = true) AS
SELECT
  s.user_id,
  s.subscriber_id,
  s.service_type,
  s.id AS subscription_id,
  s.status,
  s.start_date,
  s.end_date,
  s.cancelled_at,
  s.refund_amount,
  s.previous_subscription_id,
  jsonb_build_object(
    'subscriptionId', s.id,
    'packId',         s.pack_id,
    'packName',       s.pack_name_snapshot,
    'packPrice',      s.pack_price_snapshot,
    'billingType',    s.billing_type_snapshot,
    'validityDays',   s.validity_days_snapshot,
    'duration',       s.duration,
    'totalDays',      s.total_days,
    'totalCharged',   s.total_charged,
    'startDate',      s.start_date,
    'endDate',        s.end_date,
    'status',         s.status,
    'cancelledAt',    s.cancelled_at,
    'refundAmount',   s.refund_amount,
    'cancelReasonCode', s.cancel_reason_code,
    'cancelReasonNote', s.cancel_reason_note,
    'providerId',     s.provider_id,
    'providerName',   p.name,
    'deviceId',       s.device_id,
    'stbNumber',      s.device_serial_snapshot,
    'subscribedAt',   s.created_at,
    'previousSubscriptionId', s.previous_subscription_id
  ) AS blob
FROM public.subscriptions s
LEFT JOIN public.providers p ON p.id = s.provider_id;

GRANT SELECT ON public.v_subscriber_subscription_timeline TO authenticated;

COMMENT ON VIEW public.v_subscriber_active_subscription IS
  'Phase 4b read helper: current active sub per (subscriber, service) in legacy JSONB-blob shape. UI cutover target.';
COMMENT ON VIEW public.v_subscriber_subscription_timeline IS
  'Phase 4b read helper: full subscription timeline per (subscriber, service) in legacy JSONB-blob shape.';
