-- Taxonomy correction (Larry 2026-09-04): Dornier H20 / H30 (Medilas-class)
-- are holmium lasers, not lithotriptors. Lithotriptor room stays for true
-- shockwave / ESWL (Dornier Compact Delta, etc.).
-- Also add manuals.is_incomplete so incomplete PDFs (H20/H30) can show a badge
-- without hardcoding a title.
-- Apply in the Supabase SQL editor if you are not running `supabase db push`.

-- 1. Durable incomplete flag
ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS is_incomplete boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.manuals.is_incomplete IS
  'When true, library + viewer show an Incomplete badge. Seeded for the Dornier H20/H30 PDF (known incomplete, still included).';

-- 2. Catalog manufacturer + holmium models
INSERT INTO public.manufacturers (name)
VALUES ('Dornier')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'H20', 'H20 (Medilas holmium)', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name IN ('Dornier', 'Dornier MedTech', 'Dornier Medilas')
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'H20'
  );

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'H30', 'H30 (Medilas holmium)', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name IN ('Dornier', 'Dornier MedTech', 'Dornier Medilas')
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'H30'
  );

UPDATE public.laser_models lm
SET equipment_type = 'laser'
FROM public.manufacturers m
WHERE lm.manufacturer_id = m.id
  AND (
    m.name ~* 'dornier|medilas'
    OR lm.name ~* '\yh[- ]?20\y|\yh[- ]?30\y|\ymedilas\y'
    OR COALESCE(lm.label, '') ~* '\yh[- ]?20\y|\yh[- ]?30\y|\ymedilas\y'
  )
  AND COALESCE(lm.equipment_type, '') IN ('lithotriptor', '')
  AND COALESCE(lm.name, '') !~* 'lithotrip|compact|delta|sigma|doli|gemini|hm3|eswl'
  AND COALESCE(lm.label, '') !~* 'lithotrip|compact|delta|sigma|doli|gemini|hm3|eswl';

-- 3. Manuals: H20 / H30 / Medilas → laser (skip true ESWL titles)
UPDATE public.manuals
SET equipment_type = 'laser'
WHERE (
    title ~* '\yh[- ]?20\y'
    OR title ~* '\yh[- ]?30\y'
    OR title ~* '\ymedilas\y'
    OR COALESCE(model, '') ~* '\yh[- ]?20\y|\yh[- ]?30\y|\ymedilas\y'
    OR COALESCE(storage_path, '') ~* 'h[- ]?20|h[- ]?30|medilas'
    OR brand ~* 'medilas'
  )
  AND (
    brand ~* 'dornier|medilas'
    OR title ~* 'dornier|medilas'
    OR COALESCE(model, '') ~* 'dornier|medilas'
  )
  AND title !~* 'lithotrip|shock\s*wave|shockwave|\beswl\b|\bswl\b|compact\s+delta|compact\s+sigma';

-- 4. Incomplete flag: H20 / H30 rows only (Larry: include the incomplete PDF)
UPDATE public.manuals
SET is_incomplete = true
WHERE (
    title ~* '\yh[- ]?20\y'
    OR title ~* '\yh[- ]?30\y'
    OR COALESCE(model, '') ~* '\yh[- ]?20\y|\yh[- ]?30\y'
    OR COALESCE(storage_path, '') ~* 'h[- ]?20|h[- ]?30'
  )
  AND (
    brand ~* 'dornier|medilas'
    OR title ~* 'dornier|medilas'
    OR COALESCE(model, '') ~* 'dornier|medilas'
  )
  AND title !~* 'lithotrip|shock\s*wave|shockwave|\beswl\b|\bswl\b';

COMMENT ON COLUMN public.manuals.equipment_type IS
  'laser | lithotriptor | c_arm | other. Library room. Quanta Litho / Cyber Ho / Litho EVO and Dornier H20 / H30 (Medilas) are laser (holmium). Lithotriptor is shockwave/ESWL (Dornier Compact Delta etc.), not holmium.';

NOTIFY pgrst, 'reload schema';
