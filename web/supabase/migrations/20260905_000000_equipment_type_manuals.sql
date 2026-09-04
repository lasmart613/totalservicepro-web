-- Equipment-type rooms for the manuals library (RepairPlanet biomed expansion).
-- Apply in the Supabase SQL editor if you are not running `supabase db push`.
-- Lasers remain the default. No PDF binaries are inserted.

-- 1. manuals.equipment_type — room the book lives in
ALTER TABLE public.manuals
  ADD COLUMN IF NOT EXISTS equipment_type text;

UPDATE public.manuals
SET equipment_type = 'laser'
WHERE equipment_type IS NULL OR btrim(equipment_type) = '';

ALTER TABLE public.manuals
  ALTER COLUMN equipment_type SET DEFAULT 'laser';

ALTER TABLE public.manuals
  ALTER COLUMN equipment_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'manuals_equipment_type_check'
  ) THEN
    ALTER TABLE public.manuals
      ADD CONSTRAINT manuals_equipment_type_check
      CHECK (equipment_type IN ('laser', 'lithotriptor', 'c_arm', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_manuals_equipment_type ON public.manuals (equipment_type);

COMMENT ON COLUMN public.manuals.equipment_type IS
  'laser | lithotriptor | c_arm | other. Library "room". Existing rows backfilled to laser.';

-- 2. laser_models.equipment_type — catalog models can be non-laser biomed
ALTER TABLE public.laser_models
  ADD COLUMN IF NOT EXISTS equipment_type text;

UPDATE public.laser_models
SET equipment_type = 'laser'
WHERE equipment_type IS NULL OR btrim(equipment_type) = '';

ALTER TABLE public.laser_models
  ALTER COLUMN equipment_type SET DEFAULT 'laser';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'laser_models_equipment_type_check'
  ) THEN
    ALTER TABLE public.laser_models
      ADD CONSTRAINT laser_models_equipment_type_check
      CHECK (equipment_type IS NULL OR equipment_type IN ('laser', 'lithotriptor', 'c_arm', 'other'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_laser_models_equipment_type ON public.laser_models (equipment_type);

COMMENT ON COLUMN public.laser_models.equipment_type IS
  'Catalog type for this model. laser_models is the shared make/model table (name kept).';

COMMENT ON TABLE public.laser_models IS
  'Manufacturer models for dropdowns and manuals attach. Not lasers-only after 2026-09 biomed expansion.';

-- 3. Manufacturers Larry will attach the first holmium Litho + C-arm manuals to
--    Quanta Litho / Cyber Ho / Litho EVO are holmium lasers (not lithotriptors).
INSERT INTO public.manufacturers (name)
VALUES ('Quanta System'), ('GE OEC')
ON CONFLICT (name) DO NOTHING;

-- 4. Models (idempotent by manufacturer + name)
INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'Litho', 'Litho', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name = 'Quanta System'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'Litho'
  );

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'Litho 60', 'Litho 60 / Cyber Ho 60', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name = 'Quanta System'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'Litho 60'
  );

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'Litho 100', 'Litho 100 / Cyber Ho 100', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name = 'Quanta System'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'Litho 100'
  );

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT 'Litho EVO', 'Litho EVO', m.id, 'laser'
FROM public.manufacturers m
WHERE m.name = 'Quanta System'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = 'Litho EVO'
  );

INSERT INTO public.laser_models (name, label, manufacturer_id, equipment_type)
SELECT '9900', 'OEC 9900', m.id, 'c_arm'
FROM public.manufacturers m
WHERE m.name = 'GE OEC'
  AND NOT EXISTS (
    SELECT 1 FROM public.laser_models lm
    WHERE lm.manufacturer_id = m.id AND lm.name = '9900'
  );

NOTIFY pgrst, 'reload schema';
