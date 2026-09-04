-- Taxonomy correction (Larry): Quanta Litho / Cyber Ho / Litho EVO are holmium
-- lasers, not shockwave lithotriptors. Lithotriptor room stays for Dornier /
-- ESWL / ultrasonic stone systems.
-- Apply in the Supabase SQL editor if you are not running `supabase db push`.
-- Fixes live manuals.equipment_type including id=144 Litho IFU (EN).

-- 1. Catalog models seeded as lithotriptor by 20260905_000000
UPDATE public.laser_models lm
SET equipment_type = 'laser'
FROM public.manufacturers m
WHERE lm.manufacturer_id = m.id
  AND m.name IN ('Quanta System', 'Quanta')
  AND (
    lm.name IN ('Litho', 'Litho 60', 'Litho 100', 'Litho EVO')
    OR lm.label ~* 'cyber\s*ho|litho\s*(evo|60|100)?'
  )
  AND COALESCE(lm.equipment_type, '') = 'lithotriptor';

-- 2. Manuals: explicit id 144 plus Quanta / Litho / Cyber Ho holmium rows
UPDATE public.manuals
SET equipment_type = 'laser'
WHERE (
    id::text = '144'
    OR brand ~* 'quanta'
    OR title ~* 'cyber\s*ho'
    OR title ~* 'litho\s*(evo|60|100)\b'
    OR title ~* '\blitho\b'
    OR COALESCE(model, '') ~* 'litho|cyber\s*ho'
  )
  AND COALESCE(equipment_type, '') IN ('lithotriptor', '')
  AND title !~* 'dornier|shock\s*wave|shockwave|\beswl\b|\bswl\b|lithotrip'
  AND COALESCE(brand, '') !~* 'dornier';

COMMENT ON COLUMN public.manuals.equipment_type IS
  'laser | lithotriptor | c_arm | other. Library room. Quanta Litho / Cyber Ho / Litho EVO are laser (holmium). Lithotriptor is shockwave/ESWL (Dornier), not holmium.';

NOTIFY pgrst, 'reload schema';
