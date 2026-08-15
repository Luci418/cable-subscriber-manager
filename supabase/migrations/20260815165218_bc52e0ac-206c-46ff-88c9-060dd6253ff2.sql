CREATE UNIQUE INDEX subscriber_provider_state_account_number_uniq
  ON public.subscriber_provider_state (user_id, provider_id, upper(btrim(provider_customer_number)))
  WHERE provider_customer_number IS NOT NULL AND btrim(provider_customer_number) <> '';