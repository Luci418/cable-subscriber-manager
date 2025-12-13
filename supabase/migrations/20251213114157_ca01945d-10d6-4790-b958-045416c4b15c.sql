
-- Create STB status enum
CREATE TYPE public.stb_status AS ENUM ('available', 'assigned', 'faulty', 'decommissioned');

-- Create STB inventory table
CREATE TABLE public.stb_inventory (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  serial_number TEXT NOT NULL,
  status stb_status NOT NULL DEFAULT 'available',
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(serial_number, user_id)
);

-- Enable RLS on stb_inventory
ALTER TABLE public.stb_inventory ENABLE ROW LEVEL SECURITY;

-- RLS policies for stb_inventory
CREATE POLICY "Users can view their own STBs"
ON public.stb_inventory FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own STBs"
ON public.stb_inventory FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own STBs"
ON public.stb_inventory FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own STBs"
ON public.stb_inventory FOR DELETE
USING (auth.uid() = user_id);

-- Add is_active column to packs for soft delete
ALTER TABLE public.packs ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;

-- Trigger for stb_inventory updated_at
CREATE TRIGGER update_stb_inventory_updated_at
BEFORE UPDATE ON public.stb_inventory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to check if region is in use
CREATE OR REPLACE FUNCTION public.is_region_in_use(region_name TEXT, owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
    WHERE region = region_name AND user_id = owner_id
  )
$$;

-- Function to check if pack is in use
CREATE OR REPLACE FUNCTION public.is_pack_in_use(pack_name TEXT, owner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscribers
    WHERE current_pack = pack_name AND user_id = owner_id
  )
$$;
