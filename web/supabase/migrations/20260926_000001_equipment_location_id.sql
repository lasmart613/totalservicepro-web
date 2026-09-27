-- Tie a customer laser to one customer location.
--
-- locations (20260924_000000_customer_locations.sql) is the multi-site model.
-- equipment had no location or site column, so a service report could not
-- tell which lasers belong at the site on the report. This adds a nullable
-- equipment.location_id. Existing rows stay NULL and the report lists them
-- under "Other / unassigned". Nothing in the app writes this column yet, so
-- applying the file does not move lasers.
--
-- Safe to re-run.
--
-- APPLY ON LIVE SUPABASE (SQL editor or CLI). Until then the report form
-- still loads equipment and treats every row as unassigned.
-- Preview and production do not apply this automatically.

DO $$
DECLARE
  loc_id_type text;
  col_type text;
BEGIN
  IF to_regclass('public.equipment') IS NULL THEN
    RETURN;
  END IF;

  SELECT data_type INTO loc_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'locations' AND column_name = 'id';

  IF loc_id_type IS NULL OR loc_id_type NOT IN ('bigint', 'integer', 'smallint') THEN
    loc_id_type := 'bigint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'equipment'
      AND column_name = 'location_id'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.equipment ADD COLUMN location_id %s',
      loc_id_type
    );
  END IF;

  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'equipment'
    AND column_name = 'location_id';

  IF col_type IS NOT NULL
     AND col_type = loc_id_type
     AND to_regclass('public.locations') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'equipment_location_id_fkey'
     ) THEN
    ALTER TABLE public.equipment
      ADD CONSTRAINT equipment_location_id_fkey
      FOREIGN KEY (location_id)
      REFERENCES public.locations (id)
      ON DELETE SET NULL;
  END IF;

  CREATE INDEX IF NOT EXISTS equipment_location_id_idx
    ON public.equipment (location_id);

  COMMENT ON COLUMN public.equipment.location_id IS
    'Customer location (public.locations) this laser is installed at. NULL means unassigned; service reports still show those rows.';
END $$;
