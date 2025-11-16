-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table for user authentication
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles RLS policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Create trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create packs table
CREATE TABLE public.packs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  price NUMERIC(10, 2) NOT NULL,
  channels TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own packs"
  ON public.packs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own packs"
  ON public.packs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own packs"
  ON public.packs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own packs"
  ON public.packs FOR DELETE
  USING (auth.uid() = user_id);

-- Create regions table
CREATE TABLE public.regions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, user_id)
);

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own regions"
  ON public.regions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own regions"
  ON public.regions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own regions"
  ON public.regions FOR DELETE
  USING (auth.uid() = user_id);

-- Create subscribers table
CREATE TABLE public.subscribers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  stb_number TEXT,
  current_pack TEXT,
  region TEXT,
  latitude NUMERIC(10, 8),
  longitude NUMERIC(11, 8),
  balance NUMERIC(10, 2) NOT NULL DEFAULT 0,
  join_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_subscription JSONB,
  subscription_history JSONB[] DEFAULT ARRAY[]::JSONB[],
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subscriber_id, user_id)
);

ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscribers"
  ON public.subscribers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscribers"
  ON public.subscribers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscribers"
  ON public.subscribers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own subscribers"
  ON public.subscribers FOR DELETE
  USING (auth.uid() = user_id);

-- Create transactions table
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('payment', 'charge', 'refund')),
  amount NUMERIC(10, 2) NOT NULL,
  description TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own transactions"
  ON public.transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own transactions"
  ON public.transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
  ON public.transactions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
  ON public.transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Create complaints table
CREATE TABLE public.complaints (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscriber_id UUID REFERENCES public.subscribers(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in-progress', 'resolved')),
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_date TIMESTAMPTZ,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.complaints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own complaints"
  ON public.complaints FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own complaints"
  ON public.complaints FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own complaints"
  ON public.complaints FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own complaints"
  ON public.complaints FOR DELETE
  USING (auth.uid() = user_id);

-- Create billing_history table
CREATE TABLE public.billing_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month TEXT NOT NULL,
  total_revenue NUMERIC(10, 2) NOT NULL,
  total_subscribers INTEGER NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(month, user_id)
);

ALTER TABLE public.billing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own billing history"
  ON public.billing_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own billing history"
  ON public.billing_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_subscribers_updated_at
  BEFORE UPDATE ON public.subscribers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();