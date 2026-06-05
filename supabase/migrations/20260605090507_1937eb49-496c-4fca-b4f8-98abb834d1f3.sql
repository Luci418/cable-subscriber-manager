
-- 1. providers table
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  service_type text NOT NULL CHECK (service_type IN ('cable','internet')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_type, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.providers TO authenticated;
GRANT ALL ON public.providers TO service_role;

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own providers"
  ON public.providers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own providers"
  ON public.providers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own providers"
  ON public.providers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own providers"
  ON public.providers FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_providers_updated_at
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Add provider_id columns (nullable; backfill below)
ALTER TABLE public.packs        ADD COLUMN provider_id uuid;
ALTER TABLE public.transactions ADD COLUMN provider_id uuid;
ALTER TABLE public.subscribers  ADD COLUMN cable_provider_id uuid;
ALTER TABLE public.subscribers  ADD COLUMN internet_provider_id uuid;

-- 3. Backfill default providers for every user that has any pack/sub/txn
WITH user_services AS (
  SELECT DISTINCT user_id, 'cable'::text AS service_type FROM public.subscribers WHERE 'cable' = ANY(services)
  UNION
  SELECT DISTINCT user_id, 'internet'::text FROM public.subscribers WHERE 'internet' = ANY(services)
  UNION
  SELECT DISTINCT user_id, COALESCE(service_type,'cable') FROM public.packs
  UNION
  SELECT DISTINCT user_id, COALESCE(service_type,'cable') FROM public.transactions
)
INSERT INTO public.providers (user_id, name, service_type)
SELECT user_id,
       CASE WHEN service_type = 'internet' THEN 'Default Internet' ELSE 'Default Cable Network' END,
       service_type
FROM user_services
ON CONFLICT (user_id, service_type, name) DO NOTHING;

-- 4. Wire existing rows to those defaults
UPDATE public.packs p
SET provider_id = pr.id
FROM public.providers pr
WHERE pr.user_id = p.user_id
  AND pr.service_type = COALESCE(p.service_type,'cable')
  AND pr.name = CASE WHEN COALESCE(p.service_type,'cable') = 'internet' THEN 'Default Internet' ELSE 'Default Cable Network' END
  AND p.provider_id IS NULL;

UPDATE public.transactions t
SET provider_id = pr.id
FROM public.providers pr
WHERE pr.user_id = t.user_id
  AND pr.service_type = COALESCE(t.service_type,'cable')
  AND pr.name = CASE WHEN COALESCE(t.service_type,'cable') = 'internet' THEN 'Default Internet' ELSE 'Default Cable Network' END
  AND t.provider_id IS NULL;

UPDATE public.subscribers s
SET cable_provider_id = pr.id
FROM public.providers pr
WHERE pr.user_id = s.user_id
  AND pr.service_type = 'cable'
  AND pr.name = 'Default Cable Network'
  AND s.cable_provider_id IS NULL
  AND 'cable' = ANY(s.services);

UPDATE public.subscribers s
SET internet_provider_id = pr.id
FROM public.providers pr
WHERE pr.user_id = s.user_id
  AND pr.service_type = 'internet'
  AND pr.name = 'Default Internet'
  AND s.internet_provider_id IS NULL
  AND 'internet' = ANY(s.services);

-- 5. Helper: is a provider in use?
CREATE OR REPLACE FUNCTION public.is_provider_in_use(provider_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.packs        WHERE provider_id = provider_uuid AND user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.transactions WHERE provider_id = provider_uuid AND user_id = auth.uid()
    UNION ALL
    SELECT 1 FROM public.subscribers  WHERE (cable_provider_id = provider_uuid OR internet_provider_id = provider_uuid) AND user_id = auth.uid()
  );
$$;

-- 6. Helpful indexes
CREATE INDEX IF NOT EXISTS idx_packs_provider_id        ON public.packs(provider_id);
CREATE INDEX IF NOT EXISTS idx_transactions_provider_id ON public.transactions(provider_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_cable_provider_id    ON public.subscribers(cable_provider_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_internet_provider_id ON public.subscribers(internet_provider_id);
CREATE INDEX IF NOT EXISTS idx_providers_user_service  ON public.providers(user_id, service_type);
