-- Run this in the Supabase SQL Editor
-- Creates the tables needed for the Service Manuals library

-- 1. Main manuals table
CREATE TABLE IF NOT EXISTS public.manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text,
  title text NOT NULL,
  storage_path text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- 2. User's personal library (many-to-many)
CREATE TABLE IF NOT EXISTS public.user_manuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  manual_id uuid NOT NULL REFERENCES public.manuals(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  UNIQUE (user_id, manual_id)
);

-- Enable Row Level Security
ALTER TABLE public.manuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_manuals ENABLE ROW LEVEL SECURITY;

-- Policies (basic but functional)
-- Anyone authenticated can browse the list of manuals
DROP POLICY IF EXISTS "Authenticated can read manuals" ON public.manuals;
CREATE POLICY "Authenticated can read manuals"
  ON public.manuals FOR SELECT
  TO authenticated
  USING (true);

-- Users can only manage their own library entries
DROP POLICY IF EXISTS "Users manage own library" ON public.user_manuals;
CREATE POLICY "Users manage own library"
  ON public.user_manuals FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Optional: seed a couple of example rows (remove or edit the storage_path values)
-- INSERT INTO public.manuals (brand, title, storage_path) VALUES
-- ('Candela', 'GentleMax Pro User Manual', 'manuals/candela-gentlemax-pro.pdf'),
-- ('Syneron', 'eLight User Manual', 'manuals/syneron-elight.pdf');
